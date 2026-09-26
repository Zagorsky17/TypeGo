/*
 * Хранение данных.
 * Основное хранилище — localStorage (работает при открытии файла через file:// во всех браузерах).
 * У каждого пользователя (профиля ученика) своё состояние под отдельным ключом.
 * Запись отложенная (debounce) + принудительная при закрытии страницы.
 * Резервная копия — JSON-файл, который пользователь сохраняет и загружает кнопками.
 */
(function () {
  const C = TG.CONFIG;
  let saveTimer = null;
  let storageOk = true;

  function newProfile() {
    return {
      lessonIndex: 0,
      introduced: [],
      level: C.LEVEL.start,
      keys: {},        // статистика по клавишам
      bigrams: {},     // пары клавиш
      trigrams: {},    // последовательности из трёх символов
      confusions: {},  // 'ожидали>нажали' → количество
      sessions: [],    // история тренировок
      lessonsDone: {},
      placementDone: false,
      bestWpm: 0,
      totalKeystrokes: 0,
      totalSeconds: 0,
      textPos: {}      // позиция в длинных текстах
    };
  }

  function detectLang() {
    const l = (navigator.language || 'ru').toLowerCase();
    return l.indexOf('ru') === 0 || l.indexOf('uk') === 0 || l.indexOf('be') === 0 ? 'ru' : 'en';
  }

  function defaults() {
    const lang = detectLang();
    return {
      app: 'TypeGo',
      version: C.SCHEMA_VERSION,
      createdAt: Date.now(),
      settings: {
        uiLang: lang,
        layoutLang: lang,
        theme: 'auto',
        thresholds: Object.assign({}, C.THRESHOLDS),
        dailyMinutes: C.DAILY.defaultMinutes,
        hintsMode: 'auto',       // auto | always | never
        stopOnError: true,       // в обучающих режимах ждать правильного нажатия
        backspace: true,         // разрешить исправления в тестах и текстах
        sound: false,
        fontSize: 'm',           // s | m | l
        showKeyboard: true,
        showFingers: true
      },
      profiles: { ru: newProfile(), en: newProfile() },
      streak: { current: 0, best: 0, lastDay: null },
      dailyLog: {},              // 'YYYY-MM-DD' → секунды практики
      daily: null,               // план ежедневной тренировки на сегодня
      customTexts: [],
      onboarded: false
    };
  }

  /** Глубокое слияние: добавляет недостающие поля из шаблона (для миграций). */
  function fill(target, tpl) {
    Object.keys(tpl).forEach(k => {
      if (target[k] === undefined) target[k] = tpl[k];
      else if (tpl[k] && typeof tpl[k] === 'object' && !Array.isArray(tpl[k]) &&
        target[k] && typeof target[k] === 'object' && !Array.isArray(target[k]) &&
        k !== 'keys' && k !== 'bigrams' && k !== 'trigrams' && k !== 'confusions' &&
        k !== 'lessonsDone' && k !== 'dailyLog' && k !== 'textPos') {
        fill(target[k], tpl[k]);
      }
    });
    return target;
  }

  function migrate(data) {
    const d = defaults();
    fill(data, d);
    ['ru', 'en'].forEach(l => fill(data.profiles[l], newProfile()));
    data.version = C.SCHEMA_VERSION;
    return data;
  }

  function validate(data) {
    return data && typeof data === 'object' && data.app === 'TypeGo' &&
      data.settings && data.profiles && data.profiles.ru && data.profiles.en;
  }

  /** Ограничение размера: история и редкие последовательности обрезаются. */
  function compact(state) {
    ['ru', 'en'].forEach(l => {
      const p = state.profiles[l];
      if (p.sessions.length > C.HISTORY_LIMIT) p.sessions = p.sessions.slice(-C.HISTORY_LIMIT);
      const prune = (obj, limit, field) => {
        const ks = Object.keys(obj);
        if (ks.length <= limit) return;
        ks.sort((a, b) => (obj[b][field] || obj[b]) - (obj[a][field] || obj[a]));
        ks.slice(limit).forEach(k => delete obj[k]);
      };
      prune(p.trigrams, 400, 'n');
      prune(p.bigrams, 600, 'n');
      prune(p.confusions, 200);
    });
    const days = Object.keys(state.dailyLog).sort();
    if (days.length > 400) days.slice(0, days.length - 400).forEach(d => delete state.dailyLog[d]);
  }

  /*
   * Пользователи (профили учеников) — без паролей.
   * Индекс: USERS_KEY → {current, users:[{id, name, color, createdAt, lastActive}]}.
   * Состояние каждого пользователя хранится отдельно: STORAGE_KEY + '.u.' + id.
   * Слово «profile» в коде означает прогресс по раскладке внутри состояния пользователя.
   */
  const USERS_KEY = C.STORAGE_KEY + '.users';
  const COLORS = ['#3b6cf6', '#1f9d62', '#d9534f', '#c98a12', '#8e5bd6', '#0f9bb0', '#d6548f', '#6b7384'];
  const userKey = id => C.STORAGE_KEY + '.u.' + id;
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  function readJSON(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      storageOk = false;
      return null;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      Store.storageOk = true;
      return true;
    } catch (e) {
      Store.storageOk = false;
      console.warn('TypeGo: не удалось сохранить в localStorage', e);
      return false;
    }
  }

  const memory = {}; // резерв, если localStorage недоступен

  function loadUserState(id) {
    const data = readJSON(userKey(id)) || memory[id];
    return validate(data) ? migrate(data) : null;
  }

  function nextColor() {
    return COLORS[Store.index.users.length % COLORS.length];
  }

  const Store = {
    state: null,      // состояние текущего пользователя
    index: null,      // {current, users}
    storageOk: true,

    load() {
      let index = readJSON(USERS_KEY);
      if (!index || !Array.isArray(index.users) || !index.users.length) {
        // первый запуск или переход со старой версии без профилей
        const legacy = readJSON(C.STORAGE_KEY);
        const id = newId();
        index = { current: id, users: [{ id, name: '', color: COLORS[0], createdAt: Date.now(), lastActive: Date.now() }] };
        Store.index = index;
        Store.state = validate(legacy) ? migrate(legacy) : defaults();
        Store.saveNow();
        if (validate(legacy) && Store.storageOk) {
          try { localStorage.removeItem(C.STORAGE_KEY); } catch (e) { /* не критично */ }
        }
      } else {
        Store.index = index;
        if (!index.users.some(u => u.id === index.current)) index.current = index.users[0].id;
        Store.state = loadUserState(index.current) || defaults();
      }
      Store.storageOk = Store.storageOk && storageOk;
      return Store.state;
    },

    save() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(Store.saveNow, 400);
    },

    saveNow() {
      clearTimeout(saveTimer);
      if (!Store.state || !Store.index) return;
      compact(Store.state);
      const u = Store.user();
      if (u) u.lastActive = Date.now();
      memory[Store.index.current] = Store.state;
      writeJSON(userKey(Store.index.current), Store.state);
      writeJSON(USERS_KEY, Store.index);
    },

    /* ---------- пользователи ---------- */

    users() { return Store.index.users; },

    user(id) {
      const uid = id || (Store.index && Store.index.current);
      return Store.index ? Store.index.users.find(u => u.id === uid) : null;
    },

    /** Имя для отображения: безымянный первый профиль получает имя по номеру. */
    userName(u) {
      u = u || Store.user();
      if (!u) return '';
      if (u.name) return u.name;
      const n = Store.index.users.indexOf(u) + 1;
      return (TG.I18n ? TG.I18n.t('profileDefaultName') : 'Profile') + ' ' + n;
    },

    /** Краткая сводка без переключения: для списка профилей. */
    userSummary(id) {
      const st = id === Store.index.current ? Store.state : loadUserState(id);
      if (!st) return null;
      const lang = st.settings.layoutLang;
      const p = st.profiles[lang];
      return {
        lang,
        lessonIndex: p.lessonIndex,
        sessions: st.profiles.ru.sessions.length + st.profiles.en.sessions.length,
        bestWpm: Math.max(st.profiles.ru.bestWpm || 0, st.profiles.en.bestWpm || 0),
        streak: st.streak
      };
    },

    /** Создать пользователя. Язык и тема наследуются от текущего, прогресс — с нуля. */
    createUser(name, state) {
      Store.saveNow();
      const id = newId();
      const cur = Store.state && Store.state.settings;
      const st = state || defaults();
      if (!state && cur) {
        st.settings.uiLang = cur.uiLang;
        st.settings.layoutLang = cur.layoutLang;
        st.settings.theme = cur.theme;
      }
      Store.index.users.push({ id, name: (name || '').trim().slice(0, 40), color: nextColor(), createdAt: Date.now(), lastActive: Date.now() });
      memory[id] = st;
      writeJSON(userKey(id), st);
      writeJSON(USERS_KEY, Store.index);
      return id;
    },

    switchUser(id) {
      if (!Store.user(id)) return false;
      Store.saveNow();
      Store.index.current = id;
      Store.state = loadUserState(id) || defaults();
      Store.saveNow();
      return true;
    },

    renameUser(id, name) {
      const u = Store.user(id);
      if (!u) return;
      u.name = (name || '').trim().slice(0, 40);
      writeJSON(USERS_KEY, Store.index);
    },

    /** Удалить пользователя и его прогресс. Последнего удалить нельзя. */
    deleteUser(id) {
      if (Store.index.users.length <= 1 || !Store.user(id)) return false;
      Store.index.users = Store.index.users.filter(u => u.id !== id);
      delete memory[id];
      try { localStorage.removeItem(userKey(id)); } catch (e) { /* не критично */ }
      if (Store.index.current === id) {
        Store.index.current = Store.index.users[0].id;
        Store.state = loadUserState(Store.index.current) || defaults();
      }
      Store.saveNow();
      return true;
    },

    /* ---------- текущий пользователь ---------- */

    profile(lang) {
      return Store.state.profiles[lang || Store.state.settings.layoutLang];
    },

    settings() {
      return Store.state.settings;
    },

    th() {
      return Store.state.settings.thresholds;
    },

    /** Скачать файл с прогрессом текущего пользователя. */
    exportFile() {
      Store.saveNow();
      const name = Store.userName();
      const payload = Object.assign({ exportedAt: new Date().toISOString(), profileName: name }, Store.state);
      const blob = new Blob([JSON.stringify(payload, null, 1)], { type: 'application/json' });
      const safe = name.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40) || 'profile';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'typego-' + safe + '-' + TG.Util.today() + '.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    },

    /** Разобрать файл прогресса. Возвращает {state, name} или null. */
    parseFile(text) {
      let data;
      try { data = JSON.parse(text); } catch (e) { return null; }
      if (!validate(data)) return null;
      const name = typeof data.profileName === 'string' ? data.profileName : '';
      delete data.exportedAt;
      delete data.profileName;
      return { state: migrate(data), name };
    },

    /** Загрузить прогресс из JSON в текущего пользователя. Возвращает true при успехе. */
    importText(text) {
      const r = Store.parseFile(text);
      if (!r) return false;
      Store.state = r.state;
      Store.saveNow();
      return true;
    },

    /** Создать нового пользователя из файла прогресса. Возвращает id или null. */
    importAsNewUser(text) {
      const r = Store.parseFile(text);
      if (!r) return null;
      return Store.createUser(r.name, r.state);
    },

    /** Сбросить прогресс текущего пользователя. */
    reset(keepSettings) {
      const s = Store.state && Store.state.settings;
      Store.state = defaults();
      if (keepSettings && s) Store.state.settings = s;
      Store.saveNow();
    },

    newProfile
  };

  window.addEventListener('beforeunload', () => Store.saveNow());
  document.addEventListener('visibilitychange', () => { if (document.hidden) Store.saveNow(); });

  TG.Store = Store;
})();
