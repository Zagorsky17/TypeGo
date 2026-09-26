/*
 * Хранение данных.
 * Основное хранилище — localStorage (работает при открытии файла через file:// во всех браузерах).
 * У каждого пользователя (профиля ученика) своё состояние под отдельным ключом.
 * Запись отложенная (debounce) + принудительная при уходе со страницы (pagehide/visibilitychange).
 * Резервная копия — JSON-файл, который пользователь сохраняет и загружает кнопками.
 */
(function () {
  const C = TG.CONFIG;
  let saveTimer = null;

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
  function compact(state, emergency) {
    const limit = emergency ? C.HISTORY_EMERGENCY : C.HISTORY_LIMIT;
    ['ru', 'en'].forEach(l => {
      const p = state.profiles[l];
      if (p.sessions.length > limit) p.sessions = p.sessions.slice(-limit);
      const prune = (obj, limit, field) => {
        const ks = Object.keys(obj);
        if (ks.length <= limit) return;
        ks.sort((a, b) => (obj[b][field] || obj[b]) - (obj[a][field] || obj[a]));
        ks.slice(limit).forEach(k => delete obj[k]);
      };
      prune(p.trigrams, emergency ? 100 : 400, 'n');
      prune(p.bigrams, emergency ? 200 : 600, 'n');
      prune(p.confusions, emergency ? 50 : 200);
    });
    const days = Object.keys(state.dailyLog).sort();
    if (days.length > 400) days.slice(0, days.length - 400).forEach(d => delete state.dailyLog[d]);
  }

  /*
   * Пользователи (профили учеников) — без паролей.
   * Индекс: USERS_KEY → {current, users:[{id, name, color, createdAt, lastActive}]}.
   * Состояние каждого пользователя хранится отдельно: STORAGE_KEY + '.u.' + id.
   * Слово «profile» в коде означает прогресс по раскладке внутри состояния пользователя.
   *
   * Защита данных:
   * - повреждённые данные не перезаписываются: сырой текст сохраняется в '<ключ>.corrupt.<время>';
   * - индекс, который не читается, восстанавливается по ключам пользователей;
   * - номер ревизии (state.rev) не даёт вкладке затереть более свежие данные другой вкладки;
   * - индекс обновляется по схеме «прочитать → изменить → записать»;
   * - ошибки записи (переполнение, недоступность) не маскируются и показываются пользователю.
   */
  const USERS_KEY = C.STORAGE_KEY + '.users';
  const USER_KEY_RE = /^typego\.v1\.u\.([A-Za-z0-9]+)$/;
  const COLORS = ['#3b6cf6', '#1f9d62', '#d9534f', '#c98a12', '#8e5bd6', '#0f9bb0', '#d6548f', '#6b7384'];
  const userKey = id => C.STORAGE_KEY + '.u.' + id;
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  const memory = {};       // резерв на случай недоступного localStorage
  const blocked = {};      // id → true: запись запрещена (повреждённые данные не удалось сохранить в копию)
  let loadedRev = 0;       // ревизия текущего пользователя на момент загрузки/последней записи
  let lastJson = null;     // последнее записанное/загруженное состояние (без rev) — чтобы не писать без изменений

  /** JSON состояния без поля rev верхнего уровня. */
  function stateJson(st) {
    return JSON.stringify(st, function (k, v) { return this === st && k === 'rev' ? undefined : v; });
  }
  let available = true;    // localStorage вообще доступен

  function isQuota(e) {
    return e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014);
  }

  /** Прочитать ключ: {status: 'missing' | 'ok' | 'corrupt' | 'unavailable', data, backedUp} */
  function readRaw(key) {
    let raw;
    try {
      raw = localStorage.getItem(key);
    } catch (e) {
      available = false;
      return { status: 'unavailable' };
    }
    if (raw == null) return { status: 'missing' };
    try {
      return { status: 'ok', data: JSON.parse(raw) };
    } catch (e) {
      return { status: 'corrupt', backedUp: backupCorrupt(key, raw) };
    }
  }

  /** Сохранить повреждённые данные рядом, чтобы их можно было восстановить вручную. */
  function backupCorrupt(key, raw) {
    try {
      localStorage.setItem(key + '.corrupt.' + Date.now(), raw);
      return true;
    } catch (e) {
      return false;
    }
  }

  /** Записать JSON. Возвращает true | 'quota' | 'unavailable'. */
  function writeRaw(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.warn('TypeGo: не удалось сохранить в localStorage', e);
      return isQuota(e) ? 'quota' : 'unavailable';
    }
  }

  function validIndex(x) {
    return x && typeof x === 'object' && Array.isArray(x.users) && x.users.length > 0 &&
      x.users.every(u => u && typeof u.id === 'string' && USER_KEY_RE.test(userKey(u.id)));
  }

  /** Восстановить индекс по сохранённым ключам пользователей. */
  function rebuildIndex() {
    const users = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const m = USER_KEY_RE.exec(localStorage.key(i) || '');
        if (m) users.push({ id: m[1], name: '', color: COLORS[users.length % COLORS.length], createdAt: Date.now(), lastActive: 0 });
      }
    } catch (e) { return null; }
    return users.length ? { current: users[0].id, users } : null;
  }

  /** Свежий индекс из хранилища (или текущий из памяти, если прочитать нельзя). */
  function freshIndex() {
    const r = readRaw(USERS_KEY);
    if (r.status === 'ok' && validIndex(r.data)) return r.data;
    return Store.index;
  }

  /**
   * Загрузить состояние пользователя.
   * Возвращает {state, rev, issue}. Повреждённые/несовместимые данные никогда не перезаписываются молча.
   */
  function loadUser(id) {
    const r = readRaw(userKey(id));
    if (r.status === 'unavailable') {
      const m = memory[id];
      return { state: validate(m) ? migrate(m) : defaults(), rev: 0, issue: 'unavailable' };
    }
    if (r.status === 'missing') return { state: defaults(), rev: 0 };
    if (r.status === 'corrupt' || !validate(r.data)) {
      const backedUp = r.status === 'corrupt' ? r.backedUp : backupCorrupt(userKey(id), JSON.stringify(r.data));
      if (!backedUp) blocked[id] = true; // копию сохранить не удалось — не трогаем исходные данные
      return { state: defaults(), rev: 0, issue: 'corrupt' };
    }
    if ((r.data.version || 0) > C.SCHEMA_VERSION) {
      blocked[id] = true; // данные новой версии приложения — не «понижаем» их
      return { state: migrate(r.data), rev: r.data.rev || 0, issue: 'newer' };
    }
    return { state: migrate(r.data), rev: r.data.rev || 0 };
  }

  function nextColor(index) {
    return COLORS[index.users.length % COLORS.length];
  }

  const Store = {
    state: null,      // состояние текущего пользователя
    index: null,      // {current, users}
    storageOk: true,  // последняя запись прошла успешно
    conflict: false,  // данные изменены в другой вкладке — запись приостановлена
    issues: [],       // проблемы для показа пользователю: quota | unavailable | corrupt | newer | conflict
    onIssue: null,    // обработчик (задаёт интерфейс)
    onExternalChange: null, // данные текущего пользователя обновлены из другой вкладки

    issue(kind) {
      if (Store.issues.indexOf(kind) < 0) Store.issues.push(kind);
      if (Store.onIssue) Store.onIssue(kind);
    },

    clearIssue(kind) {
      Store.issues = Store.issues.filter(k => k !== kind);
      if (Store.onIssue) Store.onIssue(null);
    },

    load() {
      const ir = readRaw(USERS_KEY);
      let index = ir.status === 'ok' && validIndex(ir.data) ? ir.data : null;

      if (!index && ir.status !== 'missing' && ir.status !== 'unavailable') {
        // индекс есть, но повреждён: восстанавливаем по ключам пользователей
        if (ir.status === 'ok') backupCorrupt(USERS_KEY, JSON.stringify(ir.data));
        index = rebuildIndex();
        if (index) Store.issue('corrupt');
      }
      if (!index && ir.status === 'missing') index = rebuildIndex(); // индекс удалён, а пользователи остались

      if (index) {
        Store.index = index;
        if (!index.users.some(u => u.id === index.current)) index.current = index.users[0].id;
        Store._useUser(index.current);
        if (ir.status !== 'ok' || !validIndex(ir.data)) writeRaw(USERS_KEY, index);
      } else {
        // первый запуск или переход со старой версии без профилей
        const id = newId();
        Store.index = { current: id, users: [{ id, name: '', color: COLORS[0], createdAt: Date.now(), lastActive: Date.now() }] };
        const legacy = readRaw(C.STORAGE_KEY);
        const hasLegacy = legacy.status === 'ok' && validate(legacy.data);
        Store.state = hasLegacy ? migrate(legacy.data) : defaults();
        loadedRev = 0;
        lastJson = null;
        if (legacy.status === 'corrupt') Store.issue('corrupt');
        if (Store.saveNow() && hasLegacy) {
          try { localStorage.removeItem(C.STORAGE_KEY); } catch (e) { /* не критично */ }
        }
      }
      if (!available) Store.issue('unavailable');
      return Store.state;
    },

    /** Сделать пользователя текущим в памяти (без записи). */
    _useUser(id) {
      const r = loadUser(id);
      Store.state = r.state;
      loadedRev = r.rev;
      lastJson = r.issue ? null : stateJson(r.state);
      if (r.issue) Store.issue(r.issue);
    },

    save() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(Store.saveNow, 400);
    },

    /** Записать состояние текущего пользователя и индекс. Возвращает true при успехе. */
    saveNow() {
      clearTimeout(saveTimer);
      if (!Store.state || !Store.index) return false;
      const id = Store.index.current;
      memory[id] = Store.state;
      if (!available) { Store.storageOk = false; return false; }
      if (Store.conflict || blocked[id]) return false;

      // другая вкладка удалила этого пользователя или записала более свежие данные?
      const idx = freshIndex();
      if (idx !== Store.index && !idx.users.some(u => u.id === id)) { Store.setConflict(); return false; }
      const cur = readRaw(userKey(id));
      if (cur.status === 'ok' && (cur.data.rev || 0) > loadedRev) {
        // другая вкладка записала более свежие данные: без своих изменений — принимаем их, иначе конфликт
        if (Store.adoptExternal()) return true;
        Store.setConflict();
        return false;
      }

      compact(Store.state);
      let res = true;
      const json = stateJson(Store.state);
      // без изменений не пишем и ревизию не поднимаем: иначе простое переключение вкладок
      // (visibilitychange) выдавало бы другим вкладкам ложный конфликт
      if (json !== lastJson) {
        Store.state.rev = loadedRev + 1;
        res = writeRaw(userKey(id), Store.state);
        if (res === 'quota') {
          // аварийное сжатие истории и повторная попытка
          compact(Store.state, true);
          res = writeRaw(userKey(id), Store.state);
        }
        if (res === true) { loadedRev = Store.state.rev; lastJson = stateJson(Store.state); }
        else Store.state.rev = loadedRev;
      }

      const me = idx.users.find(u => u.id === id);
      if (me) me.lastActive = Date.now();
      idx.current = id;
      Store.index = idx;
      const resIdx = writeRaw(USERS_KEY, idx);

      Store.storageOk = res === true && resIdx === true;
      if (!Store.storageOk) Store.issue(res === 'quota' || resIdx === 'quota' ? 'quota' : 'unavailable');
      else if (Store.issues.indexOf('quota') >= 0) Store.clearIssue('quota');
      return Store.storageOk;
    },

    /** Есть ли изменения, которые ещё не записаны. */
    hasLocalChanges() {
      return !Store.state || stateJson(Store.state) !== lastJson;
    },

    /**
     * Принять данные текущего пользователя, записанные другой вкладкой, если своих изменений нет.
     * Возвращает true, если данные приняты.
     */
    adoptExternal() {
      if (Store.conflict || Store.hasLocalChanges()) return false;
      const id = Store.index.current;
      const r = loadUser(id);
      if (r.issue) return false;
      Store.state = r.state;
      loadedRev = r.rev;
      lastJson = stateJson(r.state);
      if (Store.onExternalChange) Store.onExternalChange();
      return true;
    },

    setConflict() {
      if (Store.conflict) return;
      Store.conflict = true;
      Store.issue('conflict');
    },

    /** Перечитать индекс (например, перед показом списка профилей). */
    refreshIndex() {
      const idx = freshIndex();
      if (idx && idx !== Store.index) {
        if (!idx.users.some(u => u.id === Store.index.current)) Store.setConflict();
        else Store.index = Object.assign(idx, { current: Store.index.current });
      }
      return Store.index;
    },

    /* ---------- пользователи ---------- */

    users() { return Store.index.users; },

    user(id) {
      const uid = id || (Store.index && Store.index.current);
      return Store.index ? Store.index.users.find(u => u.id === uid) : null;
    },

    /** Имя для отображения: безымянный профиль получает имя по номеру. */
    userName(u) {
      u = u || Store.user();
      if (!u) return '';
      if (u.name) return u.name;
      const n = Store.index.users.indexOf(u) + 1;
      return (TG.I18n ? TG.I18n.t('profileDefaultName') : 'Profile') + ' ' + n;
    },

    /** Краткая сводка без переключения: для списка профилей. */
    userSummary(id) {
      const st = id === Store.index.current ? Store.state : (() => {
        const r = readRaw(userKey(id));
        return r.status === 'ok' && validate(r.data) ? migrate(r.data) : (validate(memory[id]) ? memory[id] : null);
      })();
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

    /**
     * Создать пользователя. Язык и тема наследуются от текущего, прогресс — с нуля.
     * Возвращает id или null, если записать не удалось.
     */
    createUser(name, state) {
      if (Store.conflict) return null;
      Store.saveNow();
      const id = newId();
      const cur = Store.state && Store.state.settings;
      const st = state || defaults();
      if (!state && cur) {
        st.settings.uiLang = cur.uiLang;
        st.settings.layoutLang = cur.layoutLang;
        st.settings.theme = cur.theme;
      }
      st.rev = 0;
      memory[id] = st;
      const res = available ? writeRaw(userKey(id), st) : true;
      if (res !== true) {
        Store.storageOk = false;
        Store.issue(res === 'quota' ? 'quota' : 'unavailable');
        return null;
      }
      const idx = freshIndex();
      idx.users.push({ id, name: (name || '').trim().slice(0, 40), color: nextColor(idx), createdAt: Date.now(), lastActive: Date.now() });
      idx.current = Store.index.current;
      Store.index = idx;
      if (available) writeRaw(USERS_KEY, idx);
      return id;
    },

    switchUser(id) {
      Store.refreshIndex();
      if (!Store.user(id) || Store.conflict) return false;
      Store.saveNow();
      Store.index.current = id;
      Store._useUser(id);
      Store.saveNow();
      return true;
    },

    renameUser(id, name) {
      const idx = freshIndex();
      const u = idx.users.find(x => x.id === id);
      if (!u) return;
      u.name = (name || '').trim().slice(0, 40);
      idx.current = Store.index.current;
      Store.index = idx;
      if (available) writeRaw(USERS_KEY, idx);
    },

    /** Удалить пользователя и его прогресс. Последнего удалить нельзя. */
    deleteUser(id) {
      const idx = freshIndex();
      if (idx.users.length <= 1 || !idx.users.some(u => u.id === id)) return false;
      idx.users = idx.users.filter(u => u.id !== id);
      idx.current = Store.index.current;
      delete memory[id];
      delete blocked[id];
      try { localStorage.removeItem(userKey(id)); } catch (e) { /* не критично */ }
      Store.index = idx;
      if (idx.current === id) {
        idx.current = idx.users[0].id;
        Store._useUser(idx.current);
      }
      if (available) writeRaw(USERS_KEY, idx);
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
      delete payload.rev;
      const blob = new Blob([JSON.stringify(payload, null, 1)], { type: 'application/json' });
      const safe = name.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40) || 'profile';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'typego-' + safe + '-' + TG.Util.today() + '.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    },

    /** Причина последней неудачной загрузки файла: 'invalid' | 'newer'. */
    parseError: null,

    /** Разобрать файл прогресса. Возвращает {state, name} или null (причина — в Store.parseError). */
    parseFile(text) {
      Store.parseError = 'invalid';
      let data;
      try { data = JSON.parse(text); } catch (e) { return null; }
      if (!validate(data)) return null;
      if ((data.version || 0) > C.SCHEMA_VERSION) { Store.parseError = 'newer'; return null; }
      Store.parseError = null;
      const name = typeof data.profileName === 'string' ? data.profileName : '';
      delete data.exportedAt;
      delete data.profileName;
      delete data.rev;
      return { state: migrate(data), name };
    },

    /** Загрузить прогресс из JSON в текущего пользователя. Возвращает true при успехе. */
    importText(text) {
      const r = Store.parseFile(text);
      if (!r || Store.conflict) return false;
      Store.state = r.state;
      delete blocked[Store.index.current]; // пользователь сознательно заменил данные
      return Store.saveNow();
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
      delete blocked[Store.index.current];
      Store.saveNow();
    },

    newProfile
  };

  // Сохранение при уходе со страницы. pagehide надёжнее beforeunload на мобильных и не мешает bfcache.
  window.addEventListener('pagehide', () => Store.saveNow());
  document.addEventListener('visibilitychange', () => { if (document.hidden) Store.saveNow(); });

  // Другая вкладка изменила данные текущего пользователя (или очистила хранилище) — не затираем их.
  window.addEventListener('storage', e => {
    if (!Store.index) return;
    if (e.key === null || e.key === userKey(Store.index.current)) {
      let rev = 0;
      try { rev = e.newValue ? JSON.parse(e.newValue).rev || 0 : Infinity; } catch (err) { rev = Infinity; }
      if (rev > loadedRev && !(e.newValue && Store.adoptExternal())) Store.setConflict();
    } else if (e.key === USERS_KEY) {
      Store.refreshIndex();
    }
  });

  TG.Store = Store;
})();
