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
    shape(data);
    fill(data, d);
    ['ru', 'en'].forEach(l => fill(data.profiles[l], newProfile()));
    sanitize(data);
    data.version = C.SCHEMA_VERSION;
    return data;
  }

  /* ---------- проверка схемы ----------
   * Данные из хранилища и из файлов считаются недоверенными: неверные типы приводятся
   * к допустимым, лишнее отбрасывается. Иначе одно неожиданное значение ломает интерфейс
   * (null вместо массива) или попадает в разметку.
   */
  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const obj = v => (isObj(v) ? v : {});
  const arr = v => (Array.isArray(v) ? v : []);
  const bool = (v, d) => (typeof v === 'boolean' ? v : d);
  const str = (v, max, d) => (typeof v === 'string' ? v.slice(0, max) : d);
  const oneOf = (v, list, d) => (list.indexOf(v) >= 0 ? v : d);
  function num(v, d, min, max) {
    if (typeof v !== 'number' || !isFinite(v)) return d;
    if (min != null && v < min) return min;
    if (max != null && v > max) return max;
    return v;
  }
  const int = (v, d, min, max) => Math.round(num(v, d, min, max));

  /** Каркас: объекты там, где fill() ожидает объекты. */
  function shape(data) {
    data.settings = obj(data.settings);
    data.settings.thresholds = obj(data.settings.thresholds);
    data.profiles = obj(data.profiles);
    ['ru', 'en'].forEach(l => { data.profiles[l] = obj(data.profiles[l]); });
    data.streak = obj(data.streak);
  }

  /** Отфильтровать записи словаря: оставить только корректные, с ключом допустимой длины. */
  function cleanMap(m, maxKeyLen, fn) {
    const out = {};
    Object.keys(obj(m)).forEach(k => {
      if (k.length > maxKeyLen || k === '__proto__') return;
      const v = fn(m[k]);
      if (v !== undefined) out[k] = v;
    });
    return out;
  }

  function sanitizeProfile(p) {
    p.lessonIndex = int(p.lessonIndex, 0, 0, 1000);
    p.introduced = arr(p.introduced).filter(k => typeof k === 'string' && k.length >= 1 && k.length <= 2);
    p.level = num(p.level, C.LEVEL.start, C.LEVEL.min, C.LEVEL.max);
    p.keys = cleanMap(p.keys, 2, r => {
      if (!isObj(r)) return undefined;
      return {
        h: int(r.h, 0, 0), e: int(r.e, 0, 0),
        rec: arr(r.rec).filter(x => Array.isArray(x)).slice(-C.MASTERY.recentSize)
          .map(x => [x[0] ? 1 : 0, num(x[1], 0, 0, C.MASTERY.rtCap)]),
        last: num(r.last, 0, 0), ease: num(r.ease, C.SRS.startEase, C.SRS.minEase, 5),
        ivl: num(r.ivl, 0, 0, 3650), reps: int(r.reps, 0, 0), due: num(r.due, 0, 0)
      };
    });
    p.bigrams = cleanMap(p.bigrams, 2, b => (isObj(b) ? { n: int(b.n, 0, 0), e: int(b.e, 0, 0), rt: num(b.rt, 0, 0) } : undefined));
    p.trigrams = cleanMap(p.trigrams, 3, t => (isObj(t) ? { n: int(t.n, 0, 0), e: int(t.e, 0, 0) } : undefined));
    p.confusions = cleanMap(p.confusions, 5, n => (typeof n === 'number' && isFinite(n) ? Math.max(0, Math.round(n)) : undefined));
    p.sessions = arr(p.sessions).filter(isObj).map(x => ({
      date: num(x.date, 0, 0), mode: str(x.mode, 20, 'adaptive'),
      wpm: num(x.wpm, 0, 0, 1000), cpm: num(x.cpm, 0, 0, 5000), acc: num(x.acc, 0, 0, 100),
      errors: int(x.errors, 0, 0), corrections: int(x.corrections, 0, 0), rtAvg: num(x.rtAvg, 0, 0),
      stability: num(x.stability, 0, 0, 100), durationS: num(x.durationS, 0, 0), keystrokes: int(x.keystrokes, 0, 0),
      adaptive: !!x.adaptive, lessonId: str(x.lessonId, 20, null), free: x.free ? true : undefined
    }));
    p.lessonsDone = cleanMap(p.lessonsDone, 20, d => (isObj(d) ? { date: num(d.date, 0, 0), best: num(d.best, 0, 0, 1000), placement: d.placement ? true : undefined } : undefined));
    p.placementDone = bool(p.placementDone, false);
    p.bestWpm = num(p.bestWpm, 0, 0, 1000);
    p.totalKeystrokes = int(p.totalKeystrokes, 0, 0);
    p.totalSeconds = num(p.totalSeconds, 0, 0);
    p.textPos = cleanMap(p.textPos, 40, v => (typeof v === 'number' && isFinite(v) ? Math.max(0, Math.round(v)) : undefined));
  }

  function sanitize(data) {
    const st = data.settings, D = defaults().settings;
    st.uiLang = oneOf(st.uiLang, ['ru', 'en'], D.uiLang);
    st.layoutLang = oneOf(st.layoutLang, ['ru', 'en'], D.layoutLang);
    st.theme = oneOf(st.theme, ['auto', 'light', 'dark'], 'auto');
    st.dailyMinutes = oneOf(st.dailyMinutes, C.DAILY.options, C.DAILY.defaultMinutes);
    st.hintsMode = oneOf(st.hintsMode, ['auto', 'always', 'never'], 'auto');
    st.fontSize = oneOf(st.fontSize, ['s', 'm', 'l'], 'm');
    ['stopOnError', 'backspace', 'sound', 'showKeyboard', 'showFingers'].forEach(k => { st[k] = bool(st[k], D[k]); });
    const th = {};
    Object.keys(C.THRESHOLDS).forEach(k => {
      th[k] = k === 'stableSessions' ? int(st.thresholds[k], C.THRESHOLDS[k], 1, 10) : num(st.thresholds[k], C.THRESHOLDS[k], 0, 100);
    });
    if (!(th.accLow < th.accMid && th.accMid < th.accHigh)) ['accLow', 'accMid', 'accHigh'].forEach(k => { th[k] = C.THRESHOLDS[k]; });
    if (!(th.weakMastery < th.masteredMastery)) ['weakMastery', 'masteredMastery'].forEach(k => { th[k] = C.THRESHOLDS[k]; });
    st.thresholds = th;
    ['ru', 'en'].forEach(l => sanitizeProfile(data.profiles[l]));
    data.streak = { current: int(data.streak.current, 0, 0), best: int(data.streak.best, 0, 0), lastDay: str(data.streak.lastDay, 10, null) };
    data.dailyLog = cleanMap(data.dailyLog, 10, v => (typeof v === 'number' && isFinite(v) ? Math.max(0, v) : undefined));
    const dl = data.daily;
    data.daily = isObj(dl) && typeof dl.date === 'string' ? {
      date: dl.date.slice(0, 10), lang: oneOf(dl.lang, ['ru', 'en'], 'ru'), minutes: num(dl.minutes, 10, 1, 60),
      steps: arr(dl.steps).filter(isObj).slice(0, 10).map(x => ({ type: str(x.type, 20, 'adaptive'), min: num(x.min, 1, 0, 30), done: !!x.done }))
    } : null;
    const seen = new Set();
    data.customTexts = arr(data.customTexts).filter(x => isObj(x) && typeof x.body === 'string' && typeof x.id === 'string' &&
      /^[\w-]{1,40}$/.test(x.id) && !seen.has(x.id) && seen.add(x.id)).map(x => ({
      id: x.id, title: str(x.title, 80, ''), body: x.body.slice(0, C.TEXTS.maxChars),
      lang: oneOf(x.lang, ['ru', 'en'], 'ru'), added: num(x.added, 0, 0)
    }));
    data.onboarded = bool(data.onboarded, false);
    data.createdAt = num(data.createdAt, Date.now(), 0);
    data.rev = int(data.rev, 0, 0);
    return data;
  }

  function validate(data) {
    return isObj(data) && data.app === 'TypeGo' && isObj(data.profiles);
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
  const backupKey = id => userKey(id) + '.bak';
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
    if (!(x && typeof x === 'object' && Array.isArray(x.users) && x.users.length > 0 &&
      x.users.every(u => u && typeof u.id === 'string' && USER_KEY_RE.test(userKey(u.id))))) return false;
    // привести поля к допустимым значениям: имя и цвет попадают в разметку
    x.users.forEach((u, i) => {
      u.name = typeof u.name === 'string' ? u.name.slice(0, 40) : '';
      if (typeof u.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(u.color)) u.color = COLORS[i % COLORS.length];
      u.createdAt = num(u.createdAt, 0, 0);
      u.lastActive = num(u.lastActive, 0, 0);
    });
    if (typeof x.current !== 'string') x.current = x.users[0].id;
    return true;
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
      try { localStorage.removeItem(userKey(id)); localStorage.removeItem(backupKey(id)); } catch (e) { /* не критично */ }
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

    /**
     * Резервная копия текущего пользователя перед заменой данных (импорт, сброс).
     * Возвращает true, если копия записана (или хранилище недоступно и писать некуда).
     */
    backupCurrent() {
      const id = Store.index.current;
      let raw = null;
      try { raw = localStorage.getItem(userKey(id)); } catch (e) { return !available; }
      if (raw == null) raw = JSON.stringify(Store.state);
      try {
        localStorage.setItem(backupKey(id), JSON.stringify({ savedAt: Date.now(), data: raw }));
        return true;
      } catch (e) {
        return false;
      }
    },

    /** Время резервной копии текущего пользователя или 0. */
    backupTime() {
      const r = readRaw(backupKey(Store.index.current));
      return r.status === 'ok' && isObj(r.data) && typeof r.data.data === 'string' ? num(r.data.savedAt, 0, 0) : 0;
    },

    /** Вернуть данные из резервной копии. Возвращает true при успехе. */
    restoreBackup() {
      const id = Store.index.current;
      const r = readRaw(backupKey(id));
      if (r.status !== 'ok' || !isObj(r.data) || typeof r.data.data !== 'string') return false;
      let data;
      try { data = JSON.parse(r.data.data); } catch (e) { return false; }
      if (!validate(data)) return false;
      Store.state = migrate(data);
      delete blocked[id];
      if (!Store.saveNow()) return false;
      try { localStorage.removeItem(backupKey(id)); } catch (e) { /* не критично */ }
      return true;
    },

    /**
     * Скачать данные текущего пользователя «как есть» — сырой текст из хранилища,
     * даже если он повреждён (для восстановления вручную).
     */
    exportRaw() {
      const id = Store.index ? Store.index.current : 'unknown';
      let raw = null;
      try { raw = localStorage.getItem(userKey(id)); } catch (e) { /* недоступно */ }
      if (raw == null) {
        try { raw = JSON.stringify(Store.state); } catch (e) { raw = '{}'; }
      }
      const blob = new Blob([raw], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'typego-raw-' + id + '-' + TG.Util.today() + '.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    },

    /** Загрузить прогресс из JSON в текущего пользователя (с резервной копией). Возвращает true при успехе. */
    importText(text) {
      const r = Store.parseFile(text);
      if (!r || Store.conflict) return false;
      if (!Store.backupCurrent()) { Store.parseError = 'backup'; return false; }
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

    /** Сбросить прогресс текущего пользователя (с резервной копией). */
    reset(keepSettings) {
      Store.backupCurrent();
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
