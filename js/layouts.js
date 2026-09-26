/*
 * Раскладки клавиатуры: ЙЦУКЕН и QWERTY.
 * Для каждой клавиши: код физической клавиши, символ, символ с Shift, палец и рука.
 */
(function () {
  const CODES = [
    ['Backquote', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus', 'Equal'],
    ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP', 'BracketLeft', 'BracketRight', 'Backslash'],
    ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon', 'Quote'],
    ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash']
  ];

  const CHARS = {
    ru: {
      normal: ['ё1234567890-=', 'йцукенгшщзхъ\\', 'фывапролджэ', 'ячсмитьбю.'],
      shift: ['Ё!"№;%:?*()_+', 'ЙЦУКЕНГШЩЗХЪ/', 'ФЫВАПРОЛДЖЭ', 'ЯЧСМИТЬБЮ,']
    },
    // Mac «Русская» (не «Русская – ПК»): знаки на Shift+цифры, «ё» на клавише \, / и ? на клавише Slash.
    // Получено из macOS (UCKeyTranslate, com.apple.keylayout.Russian). «Русская – ПК» совпадает с ru.
    ruMac: {
      normal: [']1234567890-=', 'йцукенгшщзхъё', 'фывапролджэ', 'ячсмитьбю/'],
      shift: ['[!"№%:,.;()_+', 'ЙЦУКЕНГШЩЗХЪЁ', 'ФЫВАПРОЛДЖЭ', 'ЯЧСМИТЬБЮ?']
    },
    en: {
      normal: ['`1234567890-=', 'qwertyuiop[]\\', "asdfghjkl;'", 'zxcvbnm,./'],
      shift: ['~!@#$%^&*()_+', 'QWERTYUIOP{}|', 'ASDFGHJKL:"', 'ZXCVBNM<>?']
    }
  };

  // Палец по физической клавише: l/r — рука; p,r,m,i — мизинец, безымянный, средний, указательный
  const FINGER = {
    Backquote: 'lp', Digit1: 'lp', Digit2: 'lr', Digit3: 'lm', Digit4: 'li', Digit5: 'li',
    Digit6: 'ri', Digit7: 'ri', Digit8: 'rm', Digit9: 'rr', Digit0: 'rp', Minus: 'rp', Equal: 'rp',
    KeyQ: 'lp', KeyW: 'lr', KeyE: 'lm', KeyR: 'li', KeyT: 'li', KeyY: 'ri', KeyU: 'ri', KeyI: 'rm',
    KeyO: 'rr', KeyP: 'rp', BracketLeft: 'rp', BracketRight: 'rp', Backslash: 'rp',
    KeyA: 'lp', KeyS: 'lr', KeyD: 'lm', KeyF: 'li', KeyG: 'li', KeyH: 'ri', KeyJ: 'ri', KeyK: 'rm',
    KeyL: 'rr', Semicolon: 'rp', Quote: 'rp',
    KeyZ: 'lp', KeyX: 'lr', KeyC: 'lm', KeyV: 'li', KeyB: 'li', KeyN: 'ri', KeyM: 'ri', Comma: 'rm',
    Period: 'rr', Slash: 'rp', Space: 'th'
  };

  const FINGERS = ['lp', 'lr', 'lm', 'li', 'th', 'ri', 'rm', 'rr', 'rp'];
  const HOME_CODES = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon'];

  const VOWELS = { ru: 'аеёиоуыэюя', en: 'aeiouy' };
  const LETTERS = {
    ru: 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя',
    en: 'abcdefghijklmnopqrstuvwxyz'
  };

  const cache = {};
  // Вариант раскладки для языка: ru — 'pc' (ЙЦУКЕН) или 'mac' (Mac «Русская»). Задаётся из настроек.
  const variants = { ru: 'pc', en: 'pc' };

  function build(lang, variant) {
    variant = variant || variants[lang] || 'pc';
    const key = lang + ':' + variant;
    if (cache[key]) return cache[key];
    const src = CHARS[lang === 'ru' && variant === 'mac' ? 'ruMac' : lang];
    const rows = [];
    const byChar = {};   // символ → {code, shift, finger, hand, base}
    const byCode = {};   // код → {n, s}
    CODES.forEach((codes, ri) => {
      const row = [];
      codes.forEach((code, ci) => {
        const n = src.normal[ri][ci];
        const s = src.shift[ri][ci];
        const finger = FINGER[code];
        row.push({ code, n, s, finger });
        byCode[code] = { n, s };
        if (!(n in byChar)) byChar[n] = { code, shift: false, finger, hand: finger[0], base: n };
        if (!(s in byChar)) byChar[s] = { code, shift: true, finger, hand: finger[0], base: n };
      });
      rows.push(row);
    });
    byChar[' '] = { code: 'Space', shift: false, finger: 'th', hand: 't', base: ' ' };
    byCode.Space = { n: ' ', s: ' ' };
    const layout = {
      lang, variant, rows, byChar, byCode,
      vowels: VOWELS[lang],
      letters: LETTERS[lang],
      homeKeys: HOME_CODES.map(c => byCode[c].n),
      isLetter: ch => LETTERS[lang].indexOf(ch.toLowerCase()) >= 0
    };
    cache[key] = layout;
    return layout;
  }

  TG.Layout = {
    FINGERS,
    HOME_CODES,
    get: build,
    variant: lang => variants[lang] || 'pc',
    setVariant(lang, v) { variants[lang] = lang === 'ru' && v === 'mac' ? 'mac' : 'pc'; },
    /**
     * По нажатию понять вариант русской раскладки ОС: знак, который в вариантах стоит на разных клавишах.
     * Возвращает 'mac' | 'pc' | null. Вызывать, только если в ОС включена русская раскладка.
     */
    variantSignal(code, shift, key) {
      const mac = build('ru', 'mac').byCode[code], pc = build('ru', 'pc').byCode[code];
      if (!mac || !pc || !key) return null;
      const m = shift ? mac.s : mac.n, p = shift ? pc.s : pc.n;
      if (m === p) return null;
      return key === m ? 'mac' : key === p ? 'pc' : null;
    },
    /** Идентификатор клавиши для статистики: буквы — в нижнем регистре, прочие символы — как есть. */
    keyId(lang, ch) {
      const L = build(lang);
      if (L.isLetter(ch)) return ch.toLowerCase();
      return ch;
    },
    /** Какая рука должна нажимать Shift для символа (противоположная). */
    shiftSide(lang, ch) {
      const info = build(lang).byChar[ch];
      if (!info || !info.shift) return null;
      return info.hand === 'l' ? 'ShiftRight' : 'ShiftLeft';
    },
    /** Определить, к какой раскладке относится символ. */
    detect(ch) {
      if (/[а-яё]/i.test(ch)) return 'ru';
      if (/[a-z]/i.test(ch)) return 'en';
      return null;
    }
  };
})();
