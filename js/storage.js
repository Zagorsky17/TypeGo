/*
 * Хранение данных.
 * Основное хранилище — localStorage (работает при открытии файла через file:// во всех браузерах).
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

  const Store = {
    state: null,
    storageOk: true,

    load() {
      let data = null;
      try {
        const raw = localStorage.getItem(C.STORAGE_KEY);
        if (raw) data = JSON.parse(raw);
      } catch (e) {
        storageOk = false;
      }
      Store.storageOk = storageOk;
      Store.state = validate(data) ? migrate(data) : defaults();
      return Store.state;
    },

    save() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(Store.saveNow, 400);
    },

    saveNow() {
      clearTimeout(saveTimer);
      if (!Store.state) return;
      try {
        compact(Store.state);
        localStorage.setItem(C.STORAGE_KEY, JSON.stringify(Store.state));
        Store.storageOk = true;
      } catch (e) {
        Store.storageOk = false;
        console.warn('TypeGo: не удалось сохранить в localStorage', e);
      }
    },

    profile(lang) {
      return Store.state.profiles[lang || Store.state.settings.layoutLang];
    },

    settings() {
      return Store.state.settings;
    },

    th() {
      return Store.state.settings.thresholds;
    },

    /** Скачать файл с прогрессом. */
    exportFile() {
      Store.saveNow();
      const payload = Object.assign({ exportedAt: new Date().toISOString() }, Store.state);
      const blob = new Blob([JSON.stringify(payload, null, 1)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'typego-progress-' + TG.Util.today() + '.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    },

    /** Загрузить прогресс из текста JSON. Возвращает true при успехе. */
    importText(text) {
      let data;
      try { data = JSON.parse(text); } catch (e) { return false; }
      if (!validate(data)) return false;
      delete data.exportedAt;
      Store.state = migrate(data);
      Store.saveNow();
      return true;
    },

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
