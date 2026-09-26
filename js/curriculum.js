/*
 * Учебный план: 12 этапов от посадки до продвинутых упражнений.
 * Новые клавиши вводятся небольшими группами. Переход дальше — только после освоения (Mastery Learning).
 */
(function () {
  const SHIFT = '⇧'; // псевдоклавиша: заглавные буквы через Shift

  const PLAN = {
    ru: {
      home: [['а', 'о'], ['в', 'л'], ['ы', 'д'], ['ф', 'ж'], ['п', 'р']],
      keys: [['е', 'н'], ['к', 'г'], ['м', 'т'], ['и', 'ь'], ['у', 'ш'], ['с', 'б'], ['я', 'ч'], ['ц', 'щ'], ['й', 'з'], ['х', 'ъ'], ['э', 'ю'], ['ё']],
      punct: [[','], ['!', '?'], ['-', ':', ';'], ['"', '(', ')']],
      digits: [['1', '2', '3', '4', '5'], ['6', '7', '8', '9', '0']],
      symbols: ['№', '%', '*', '+', '=', '_', '/']
    },
    en: {
      home: [['f', 'j'], ['d', 'k'], ['s', 'l'], ['a', ';'], ['g', 'h']],
      keys: [['e', 'i'], ['r', 'u'], ['t', 'o'], ['n', 'y'], ['c', 'm'], ['w', 'p'], ['v', 'b'], ['x', 'q'], ['z']],
      punct: [[','], ["'"], ['!', '?'], ['-', ':'], ['"', '(', ')']],
      digits: [['1', '2', '3', '4', '5'], ['6', '7', '8', '9', '0']],
      symbols: ['@', '#', '$', '%', '&', '*', '+', '=', '/']
    }
  };

  const cache = {};

  function build(lang) {
    const lay = TG.Layout.get(lang);
    const key = lang + ':' + lay.variant;
    if (cache[key]) return cache[key];
    const P = PLAN[lang];
    const has = k => k === SHIFT || !!lay.byChar[k]; // в Mac «Русская» нет, например, «*»
    const L = [];
    const add = (stage, type, keys, extra) => {
      L.push(Object.assign({ id: lang + '-' + L.length, stage, type, keys: keys || [] }, extra || {}));
    };
    add(1, 'posture', []);
    P.home.forEach(g => add(2, 'keys', g));
    add(2, 'review', [], { scope: 'home' });
    P.keys.forEach(g => add(3, 'keys', g));
    add(4, 'combos', [], { variant: 1 });
    add(4, 'combos', [], { variant: 2 });
    add(5, 'syllables', [], { variant: 1 });
    add(5, 'syllables', [], { variant: 2 });
    add(6, 'words', [], { maxLen: 5 });
    add(6, 'words', [], { maxLen: 8 });
    add(6, 'words', [], { maxLen: 14 });
    add(7, 'sentences', [SHIFT, '.']);
    add(7, 'sentences', []);
    P.punct.forEach(g => add(8, 'punct', g));
    P.digits.forEach(g => add(9, 'digits', g));
    add(9, 'digits', [], { mixed: true });
    add(10, 'texts', [], { variant: 1 });
    add(10, 'texts', [], { variant: 2 });
    add(10, 'texts', [], { variant: 3 });
    add(11, 'speed', [], { targetWpm: 25 });
    add(11, 'speed', [], { targetWpm: 35 });
    add(11, 'speed', [], { targetWpm: 45 });
    add(12, 'advanced', P.symbols.filter(has), { variant: 'symbols' });
    add(12, 'advanced', [], { variant: 'mixed' });
    add(12, 'advanced', [], { variant: 'long' });
    cache[key] = L;
    return L;
  }

  TG.Curriculum = {
    SHIFT,
    STAGES: 12,
    lessons: build,

    current(profile, lang) {
      const L = build(lang);
      return L[Math.min(profile.lessonIndex, L.length - 1)];
    },

    isComplete(profile, lang) {
      return profile.lessonIndex >= build(lang).length;
    },

    stageOf(profile, lang) {
      if (TG.Curriculum.isComplete(profile, lang)) return 12;
      return TG.Curriculum.current(profile, lang).stage;
    },

    /** Все клавиши, доступные для упражнений: из пройденных уроков + уже представленные. */
    unlocked(profile, lang) {
      const L = build(lang);
      const set = new Set([' ']);
      for (let i = 0; i < Math.min(profile.lessonIndex, L.length); i++) L[i].keys.forEach(k => set.add(k));
      (profile.introduced || []).forEach(k => set.add(k));
      return set;
    },

    /** Буквы из набора доступных клавиш. */
    unlockedLetters(profile, lang) {
      const lay = TG.Layout.get(lang);
      return [...TG.Curriculum.unlocked(profile, lang)].filter(k => k.length === 1 && lay.isLetter(k));
    },

    /** Можно ли набрать символ с текущим набором клавиш. */
    charAllowed(ch, set, lang) {
      if (ch === ' ') return true;
      const lay = TG.Layout.get(lang);
      if (lay.isLetter(ch)) {
        if (ch !== ch.toLowerCase() && !set.has(SHIFT)) return false;
        return set.has(ch.toLowerCase());
      }
      return set.has(ch) && !!lay.byChar[ch];
    },

    textAllowed(text, set, lang) {
      for (const ch of text) if (!TG.Curriculum.charAllowed(ch, set, lang)) return false;
      return true;
    },

    /** Представить ключи урока (они начинают появляться в адаптивной практике). */
    introduce(profile, lesson) {
      profile.introduced = profile.introduced || [];
      lesson.keys.forEach(k => { if (profile.introduced.indexOf(k) < 0) profile.introduced.push(k); });
    },

    /**
     * Оценка урока. Возвращает {passed, reasons}.
     * reasons — массив ключей i18n с параметрами, объясняющих, чего не хватило.
     */
    evaluate(lesson, result, profile, lang, th) {
      const reasons = [];
      if (lesson.type === 'posture') return { passed: result.acc >= 80, reasons };
      if (lesson.type === 'speed') {
        if (result.wpm < lesson.targetWpm) reasons.push(['reasonSpeed', { v: lesson.targetWpm }]);
        if (result.acc < th.minAccForSpeed) reasons.push(['reasonAcc', { v: th.minAccForSpeed }]);
      } else {
        if (result.acc < th.lessonPassAcc) reasons.push(['reasonAcc', { v: th.lessonPassAcc }]);
      }
      const keys = lesson.keys.filter(k => k !== SHIFT).map(k => TG.Layout.keyId(lang, k));
      const scores = keys.map(k => TG.Mastery.score(profile, k));
      let weakNew;
      if (keys.length <= 3) {
        weakNew = keys.filter((k, i) => scores[i] < th.unlockMastery);
      } else {
        // в уроках с большим числом символов каждый встречается реже: средний уровень + нижняя граница
        const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
        weakNew = avg < th.unlockMastery ? keys.filter((k, i) => scores[i] < th.unlockMastery)
          : keys.filter((k, i) => scores[i] < th.unlockMastery - 20);
      }
      if (weakNew.length) reasons.push(['reasonMastery', { keys: weakNew.join(' '), v: th.unlockMastery }]);
      return { passed: reasons.length === 0, reasons };
    },

    /** Отметить урок пройденным и сдвинуть указатель плана. */
    markPassed(profile, lessonIdx, lang) {
      const L = build(lang);
      const lesson = L[lessonIdx];
      profile.lessonsDone[lesson.id] = profile.lessonsDone[lesson.id] || { date: Date.now(), best: 0 };
      TG.Curriculum.introduce(profile, lesson);
      if (lessonIdx === profile.lessonIndex) profile.lessonIndex++;
    },

    /**
     * Mastery Learning в адаптивной практике: если результат стабильно высокий,
     * а текущие клавиши освоены — ввести клавиши следующего урока.
     * Возвращает массив новых клавиш или null.
     */
    autoIntroduce(profile, lang, th) {
      if (TG.Curriculum.isComplete(profile, lang)) return null;
      const lesson = TG.Curriculum.current(profile, lang);
      if (lesson.type !== 'keys' || !lesson.keys.length) return null;
      if (lesson.keys.every(k => (profile.introduced || []).indexOf(k) >= 0)) return null;
      const recent = profile.sessions.filter(s => s.adaptive).slice(-th.stableSessions);
      if (recent.length < th.stableSessions || recent.some(s => s.acc <= th.accHigh)) return null;
      const letters = TG.Curriculum.unlockedLetters(profile, lang);
      if (!letters.length || letters.some(k => TG.Mastery.score(profile, k) < th.unlockMastery)) return null;
      TG.Curriculum.introduce(profile, lesson);
      return lesson.keys.slice();
    },

    /** Урок с введёнными клавишами автоматически засчитывается, если они освоены. */
    autoPass(profile, lang, th, sessionAcc) {
      if (TG.Curriculum.isComplete(profile, lang)) return null;
      const lesson = TG.Curriculum.current(profile, lang);
      if (lesson.type !== 'keys') return null;
      const intro = profile.introduced || [];
      if (!lesson.keys.every(k => intro.indexOf(k) >= 0)) return null;
      if (sessionAcc < th.lessonPassAcc) return null;
      if (lesson.keys.some(k => TG.Mastery.score(profile, k) < th.unlockMastery)) return null;
      TG.Curriculum.markPassed(profile, profile.lessonIndex, lang);
      return lesson;
    },

    /**
     * Диагностика: по результатам теста определить, какие уроки уже освоены.
     * perKey — {key: {n, ok}} за сессию диагностики.
     */
    placement(profile, lang, result, perKey) {
      const L = build(lang);
      let idx = 1; // посадку показываем всегда как пройденную после диагностики
      profile.lessonsDone[L[0].id] = { date: Date.now(), best: 0, placement: true };
      const keyOk = k => {
        const s = perKey[k];
        if (!s || s.n < 4) return result.acc >= 90; // клавиша встретилась редко — судим по общей точности
        return s.ok / s.n >= 0.85;
      };
      while (idx < L.length) {
        const les = L[idx];
        if (les.type === 'keys') {
          if (!les.keys.every(keyOk)) break;
        } else if (les.type === 'review') {
          // пропускается, если все клавиши до него освоены
        } else if (['combos', 'syllables', 'words'].indexOf(les.type) >= 0) {
          if (result.acc < 92 || result.wpm < 20) break;
        } else break;
        profile.lessonsDone[les.id] = { date: Date.now(), best: 0, placement: true };
        TG.Curriculum.introduce(profile, les);
        idx++;
      }
      profile.lessonIndex = Math.max(profile.lessonIndex, idx);
      profile.placementDone = true;
      return idx;
    }
  };
})();
