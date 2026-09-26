/*
 * Генератор упражнений.
 * Выбирает материал на основе Mastery каждой клавиши, слабых пальцев, проблемных пар,
 * путаниц и сроков интервального повторения. Смешивает слабое, повторение и новое (interleaving).
 */
(function () {
  const U = TG.Util;
  const SHIFT = () => TG.Curriculum.SHIFT;

  const PANGRAMS = {
    ru: ['съешь же ещё этих мягких французских булок да выпей чаю', 'в чащах юга жил бы цитрус да но фальшивый экземпляр',
      'широкая электрификация южных губерний даст мощный толчок подъёму сельского хозяйства'],
    en: ['the quick brown fox jumps over the lazy dog', 'pack my box with five dozen liquor jugs',
      'how vexingly quick daft zebras jump', 'sphinx of black quartz judge my vow']
  };

  const CONTRACTIONS = ["don't", "it's", "can't", "let's", "that's", "we're", "you're", "isn't", "won't", "they're", "i'd"];

  /* ---------- контекст ---------- */

  function makeCtx(profile, lang, extra) {
    const lay = TG.Layout.get(lang);
    const set = TG.Curriculum.unlocked(profile, lang);
    (extra && extra.addKeys || []).forEach(k => set.add(k));
    const letters = [...set].filter(k => k.length === 1 && lay.isLetter(k));
    const ctx = {
      profile, lang, lay, set, letters,
      due: new Set(TG.Mastery.dueKeys(profile, lang)),
      fresh: new Set((profile.introduced || []).filter(k => !profile.keys[k] || profile.keys[k].h < 40)),
      fingers: new Set(TG.Mastery.weakFingers(profile, lang)),
      level: profile.level || 2
    };
    Object.assign(ctx, extra || {});
    if (ctx.freshKeys) ctx.freshKeys.forEach(k => ctx.fresh.add(k));
    ctx.w = {};
    [...set].forEach(k => { ctx.w[k] = TG.Mastery.weight(profile, k, ctx); });
    ctx.punct = [...set].filter(k => k.length === 1 && k !== SHIFT() && !lay.isLetter(k) && !/[0-9 ]/.test(k) && lay.byChar[k]);
    ctx.digits = [...set].filter(k => /^[0-9]$/.test(k));
    ctx.shift = set.has(SHIFT());
    ctx.maxLen = ctx.maxLen || Math.min(14, 3 + Math.ceil(ctx.level * 0.9));
    return ctx;
  }

  const isVowel = (ctx, c) => ctx.lay.vowels.indexOf(c) >= 0;

  function pickKey(ctx, pool, focus) {
    return U.weighted(pool, k => (ctx.w[k] || 0.2) * (focus && focus.indexOf(k) >= 0 ? 3 : 1));
  }

  /* ---------- единицы упражнений ---------- */

  function drill(ctx, keys, focus) {
    const len = 2 + U.rand(3);
    let s = '';
    for (let i = 0; i < len; i++) s += pickKey(ctx, keys, focus);
    return s;
  }

  function pseudoWord(ctx, len, focus) {
    const letters = ctx.letters.filter(c => c !== 'ъ' && c !== 'ь' && c !== 'ё');
    const soft = ctx.letters.filter(c => c === 'ь' || c === 'ъ' || c === 'ё');
    const vowels = letters.filter(c => isVowel(ctx, c));
    const cons = letters.filter(c => !isVowel(ctx, c));
    if (!letters.length) return '';
    let s = '';
    let wantVowel = Math.random() < 0.5;
    for (let i = 0; i < len; i++) {
      const pool = wantVowel ? (vowels.length ? vowels : cons) : (cons.length ? cons : vowels);
      s += pickKey(ctx, pool, focus);
      wantVowel = Math.random() < 0.8 ? !wantVowel : wantVowel;
    }
    if (soft.length && Math.random() < 0.15 && s.length > 2) {
      const i = 1 + U.rand(s.length - 1);
      s = s.slice(0, i) + U.pick(soft) + s.slice(i + 1);
    }
    const f = (focus || []).filter(k => ctx.letters.indexOf(k) >= 0);
    if (f.length && ![...s].some(c => f.indexOf(c) >= 0)) {
      const i = U.rand(s.length);
      s = s.slice(0, i) + U.pick(f) + s.slice(i + 1);
    }
    return s;
  }

  function wordPool(ctx) {
    if (ctx._pool) return ctx._pool;
    const src = TG.DATA[ctx.lang].words;
    const seen = new Set();
    ctx._pool = src.filter(w => {
      if (seen.has(w)) return false;
      seen.add(w);
      return TG.Curriculum.textAllowed(w, ctx.set, ctx.lang);
    });
    return ctx._pool;
  }

  function word(ctx, opt) {
    opt = opt || {};
    const maxLen = opt.maxLen || ctx.maxLen;
    const minLen = opt.minLen || 1;
    const focus = opt.focus || [];
    let pool = wordPool(ctx).filter(w => w.length <= maxLen && w.length >= minLen);
    if (focus.length) {
      const f = pool.filter(w => focus.some(k => w.indexOf(k) >= 0));
      if (f.length >= 3) pool = f;
      else if (Math.random() < 0.6 || !pool.length) return pseudoWord(ctx, 2 + U.rand(Math.max(2, Math.min(5, maxLen - 1))), focus);
    }
    if (pool.length < 8 && Math.random() < 0.5 || !pool.length) {
      return pseudoWord(ctx, 2 + U.rand(Math.max(2, Math.min(5, maxLen - 1))), focus);
    }
    return U.weighted(pool, w => {
      let s = 0;
      for (const c of w) s += ctx.w[c] || 0.2;
      let v = s / w.length;
      if (focus.length) for (const c of w) if (focus.indexOf(c) >= 0) v += 0.5;
      if (ctx.lastWord === w) v *= 0.05;
      return v;
    });
  }

  function words(ctx, n, opt) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const w = word(ctx, opt);
      ctx.lastWord = w;
      if (w) out.push(w);
    }
    return out;
  }

  function capitalize(ctx, w) {
    if (!ctx.shift || !w) return w;
    return w[0].toUpperCase() + w.slice(1);
  }

  function number(ctx, focus) {
    const pool = ctx.digits.length ? ctx.digits : ['1'];
    const len = 1 + U.rand(Math.min(4, 1 + Math.floor(ctx.level / 3)));
    let s = '';
    for (let i = 0; i < len; i++) s += pickKey(ctx, pool, focus);
    if (s.length > 1 && s[0] === '0') s = pickKey(ctx, pool.filter(d => d !== '0').length ? pool.filter(d => d !== '0') : pool) + s.slice(1);
    return s;
  }

  /** Вставка знака препинания/символа в поток слов. */
  function applyPunct(ctx, list, i, ch) {
    const w = list[i];
    const lang = ctx.lang;
    switch (ch) {
      case ',': case ';': case ':': list[i] = w + ch; break;
      case '.': case '!': case '?':
        list[i] = w + ch;
        if (i + 1 < list.length) list[i + 1] = capitalize(ctx, list[i + 1]);
        break;
      case '-': list[i] = w + ' -'; break;
      case '"': list[i] = '"' + w + '"'; break;
      case '(': case ')': list[i] = '(' + w + ')'; break;
      case "'": {
        const c = CONTRACTIONS.filter(x => TG.Curriculum.textAllowed(x, ctx.set, lang));
        list[i] = c.length && Math.random() < 0.7 ? U.pick(c) : "'" + w + "'";
        break;
      }
      case '%': list[i] = number(ctx) + '%'; break;
      case '№': list[i] = '№' + (ctx.digits.length ? ' ' + number(ctx) : ''); break;
      case '*': case '+': case '=': case '/':
        list[i] = ctx.digits.length ? number(ctx) + ch + number(ctx) : w + ch + list[Math.max(0, i - 1)];
        break;
      case '@': list[i] = w + '@' + U.pick(wordPool(ctx).length ? wordPool(ctx) : [w]); break;
      case '#': list[i] = '#' + (ctx.digits.length ? number(ctx) : w); break;
      case '$': list[i] = '$' + (ctx.digits.length ? number(ctx) : w); break;
      case '&': list[i] = w + ' &'; break;
      case '_': list[i] = w + '_' + U.pick(wordPool(ctx).length ? wordPool(ctx) : [w]); break;
      default: list[i] = w + ch;
    }
  }

  /** Собрать «предложения» из слов с заглавными и пунктуацией из доступного набора. */
  function sentenceFromWords(ctx, n, focusPunct, opt) {
    const list = words(ctx, n, opt);
    if (!list.length) return '';
    list[0] = capitalize(ctx, list[0]);
    const inner = ctx.punct.filter(p => '.!?'.indexOf(p) < 0);
    const rate = opt && opt.punctRate || (focusPunct && focusPunct.length ? 0.45 : 0.15);
    for (let i = 0; i < list.length - 1; i++) {
      if (Math.random() < rate) {
        const cand = focusPunct && focusPunct.length ? focusPunct : inner;
        if (cand.length) applyPunct(ctx, list, i, U.pick(cand));
      }
      if (ctx.digits.length && Math.random() < (opt && opt.digitRate || 0.05)) list[i] = list[i] + ' ' + number(ctx);
    }
    const ends = ctx.punct.filter(p => '.!?'.indexOf(p) >= 0);
    const endFocus = (focusPunct || []).filter(p => '.!?'.indexOf(p) >= 0);
    if (ends.length) {
      const e = endFocus.length && Math.random() < 0.6 ? U.pick(endFocus) : (Math.random() < 0.75 && ends.indexOf('.') >= 0 ? '.' : U.pick(ends));
      list[list.length - 1] += e;
    }
    return list.join(' ');
  }

  /** Предложения из библиотеки, подходящие под доступные клавиши. */
  function libSentences(ctx) {
    if (ctx._sent) return ctx._sent;
    const D = TG.DATA[ctx.lang];
    const all = D.sentences.slice();
    TG.Texts.all(ctx.lang).forEach(t => {
      TG.Texts.sentences(t.body).forEach(s => { if (s.length > 10 && s.length < 140) all.push(s); });
    });
    ctx._sent = all.filter(s => TG.Curriculum.textAllowed(s, ctx.set, ctx.lang));
    return ctx._sent;
  }

  /** Заполнить строку единицами до нужной длины. */
  function fill(target, unitFn) {
    const parts = [];
    let len = 0, guard = 0;
    while (len < target && guard++ < 500) {
      const u = unitFn(parts.length);
      if (!u) continue;
      parts.push(u);
      len += u.length + 1;
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }

  function targetLen(ctx, mult) {
    const S = TG.CONFIG.SESSION;
    return Math.round((S.baseChars + ctx.level * S.charsPerLevel) * (mult || 1));
  }

  const isSym = (ctx, k) => ctx.letters.indexOf(k) < 0 && k !== ' ';

  /** Символ или цифра в естественном контексте слов. */
  function symUnit(ctx, sym) {
    if (/^[0-9]$/.test(sym)) return Math.random() < 0.5 ? number(ctx, [sym]) : word(ctx, { maxLen: 6 }) + ' ' + number(ctx, [sym]);
    const list = [word(ctx, { maxLen: 7 }), word(ctx, { maxLen: 7 })];
    applyPunct(ctx, list, 0, sym);
    return list.join(' ');
  }

  /* ---------- слабые места ---------- */

  function weakFocus(ctx, th) {
    // самые слабые клавиши (ниже порога) + ближайшие к ним, чтобы материал не был однообразным
    const all = [...ctx.set].filter(k => k !== ' ' && k !== SHIFT())
      .map(k => ({ k, s: TG.Mastery.score(ctx.profile, k) })).sort((a, b) => a.s - b.s);
    const below = all.filter(x => x.s < th.weakMastery);
    const weak = (below.length >= 4 ? below.slice(0, 5) : all.slice(0, 4)).map(x => x.k);
    const onlyLetters = x => [...x].every(c => ctx.letters.indexOf(c) >= 0);
    const bigrams = TG.Mastery.problemBigrams(ctx.profile, ctx.lang, 6).map(b => b.k).filter(onlyLetters).slice(0, 4);
    const trigrams = TG.Mastery.problemTrigrams(ctx.profile, ctx.lang, 5).map(t => t.k).filter(onlyLetters).slice(0, 3);
    const conf = TG.Mastery.topConfusions(ctx.profile, 4)
      .filter(c => ctx.set.has(c.exp) && ctx.set.has(c.got));
    return { weak, bigrams, trigrams, conf };
  }

  /** Контрастное упражнение для путающихся клавиш: «а о ао оа». */
  function contrast(ctx, c) {
    const a = c.exp, b = c.got;
    return U.pick([a + b, b + a, a + a + b, a + b + a, b + a + a]);
  }

  function bigramUnit(ctx, bg) {
    const pool = wordPool(ctx).filter(w => w.indexOf(bg) >= 0 && w.length <= ctx.maxLen + 2);
    if (pool.length && Math.random() < 0.6) return U.pick(pool);
    const v = ctx.letters.filter(c => isVowel(ctx, c));
    const r = Math.random();
    if (r < 0.3) return bg + bg;
    if (r < 0.6 && v.length) return bg + U.pick(v);
    if (v.length) return U.pick(v) + bg;
    return bg;
  }

  /** Единица «слабого» материала. */
  function weakUnit(ctx, wf) {
    const r = Math.random();
    if (wf.conf.length && r < 0.15) return contrast(ctx, U.pick(wf.conf));
    if (wf.bigrams.length && r < 0.35) return bigramUnit(ctx, U.pick(wf.bigrams));
    if (wf.trigrams.length && r < 0.45) {
      const t = U.pick(wf.trigrams);
      const pool = wordPool(ctx).filter(w => w.indexOf(t) >= 0);
      return pool.length ? U.pick(pool) : t;
    }
    // слабые символы тренируем в контексте слов, слабые буквы — в упражнениях и словах
    const weakSym = wf.weak.filter(k => isSym(ctx, k));
    const weakLet = wf.weak.filter(k => ctx.letters.indexOf(k) >= 0);
    if (weakSym.length && (!weakLet.length || Math.random() < weakSym.length / wf.weak.length)) return symUnit(ctx, U.pick(weakSym));
    if (ctx.letters.length < 6 || r < 0.55) return drill(ctx, weakLet.length ? weakLet.concat(ctx.letters.slice(0, 4)) : ctx.letters, weakLet);
    return word(ctx, { focus: weakLet });
  }

  /** Единица повторения (SRS + общий охват доступных клавиш). */
  function reviewUnit(ctx) {
    const due = [...ctx.due];
    const k = due.length ? U.pick(due) : null;
    if (k && isSym(ctx, k)) return symUnit(ctx, k);
    const dueLet = due.filter(x => !isSym(ctx, x));
    if (ctx.letters.length < 6) return drill(ctx, ctx.letters, dueLet);
    return word(ctx, { focus: k ? [k] : [] });
  }

  function freshUnit(ctx) {
    const all = [...ctx.fresh].filter(k => ctx.set.has(k) && k !== SHIFT());
    const sym = all.filter(k => isSym(ctx, k));
    if (sym.length && Math.random() < sym.length / all.length) return symUnit(ctx, U.pick(sym));
    const f = all.filter(k => !isSym(ctx, k));
    if (!f.length) return reviewUnit(ctx);
    if (ctx.letters.length < 6 || Math.random() < 0.3) return drill(ctx, f.concat(ctx.letters), f);
    return word(ctx, { focus: f });
  }

  /** Добавить заглавные/пунктуацию/цифры, если они уже доступны (этапы 7–9). */
  function richify(ctx, text) {
    if (!ctx.shift && !ctx.punct.length && !ctx.digits.length) return text;
    const list = text.split(' ');
    const out = [];
    for (let i = 0; i < list.length;) {
      const n = 4 + U.rand(5);
      const chunk = list.slice(i, i + n);
      i += n;
      if (!chunk.length) break;
      if (ctx.shift) chunk[0] = capitalize(ctx, chunk[0]);
      const inner = ctx.punct.filter(p => '.!?'.indexOf(p) < 0);
      for (let j = 0; j < chunk.length - 1; j++) {
        if (inner.length && Math.random() < 0.12) applyPunct(ctx, chunk, j, U.pick(inner));
        if (ctx.digits.length && Math.random() < 0.06) chunk[j] += ' ' + number(ctx);
      }
      const ends = ctx.punct.filter(p => '.!?'.indexOf(p) >= 0);
      if (ends.length) chunk[chunk.length - 1] += Math.random() < 0.8 && ends.indexOf('.') >= 0 ? '.' : U.pick(ends);
      out.push(chunk.join(' '));
    }
    return out.join(' ');
  }

  /* ---------- уроки ---------- */

  /** Знакомство с новыми символами: каждый несколько раз в простом контексте. */
  function symIntro(ctx, keys) {
    const out = [];
    keys.forEach(k => {
      if (/^[0-9]$/.test(k)) out.push(k + k + k, k + k, k);
      else for (let i = 0; i < 3; i++) out.push(symUnit(ctx, k));
    });
    return out.join(' ');
  }

  function introUnits(keys, known) {
    const out = [];
    keys.forEach(k => { out.push(k + k + k, k + k + k + k); });
    if (keys.length > 1) {
      const [a, b] = keys;
      out.push(a + b, b + a, a + b + a, b + a + b, a + a + b + b);
    }
    if (known.length) {
      for (let i = 0; i < 4; i++) {
        const k = U.pick(keys), n = U.pick(known);
        out.push(U.pick([k + n, n + k, k + n + k, n + k + n]));
      }
    }
    return out;
  }

  function lessonText(profile, lang, lesson, st) {
    const L = TG.CONFIG.SESSION.lessonChars;
    const newKeys = lesson.keys.filter(k => k !== SHIFT());
    const ctx = makeCtx(profile, lang, { addKeys: lesson.keys, freshKeys: newKeys });
    const known = ctx.letters.filter(k => newKeys.indexOf(k) < 0);
    switch (lesson.type) {
      case 'posture': {
        const h = TG.Layout.get(lang).homeKeys;
        const left = h.slice(0, 4).join(''), right = h.slice(4).join('');
        return [left, right, left, right, left + ' ' + right, h.join(' ')].join(' ');
      }
      case 'keys': {
        const intro = introUnits(newKeys, known).join(' ');
        const mixed = fill(L * 0.35, () => drill(ctx, newKeys.concat(known), newKeys));
        const wordsPart = fill(L * 0.35, () => ctx.letters.length >= 5 ? word(ctx, { focus: newKeys, maxLen: 6 }) : pseudoWord(ctx, 3 + U.rand(2), newKeys));
        return intro + ' ' + mixed + ' ' + wordsPart;
      }
      case 'review':
        return fill(L, () => ctx.letters.length >= 6 && Math.random() < 0.6 ? word(ctx, { maxLen: 6 }) : drill(ctx, ctx.letters));
      case 'combos': {
        const D = TG.DATA[lang];
        const wf = weakFocus(ctx, st.thresholds);
        let bgs = D.bigrams.filter(b => TG.Curriculum.textAllowed(b, ctx.set, lang));
        bgs = wf.bigrams.concat(bgs);
        return fill(L, () => lesson.variant === 1 ? U.pick(bgs.slice(0, 20)) + ' ' + U.pick(bgs.slice(0, 20)) : bigramUnit(ctx, U.pick(bgs)));
      }
      case 'syllables': {
        const D = TG.DATA[lang];
        const v = ctx.letters.filter(c => isVowel(ctx, c) && c !== 'ё');
        const c = ctx.letters.filter(x => !isVowel(ctx, x) && x !== 'ь' && x !== 'ъ');
        const tri = D.trigrams.filter(t => TG.Curriculum.textAllowed(t, ctx.set, lang));
        return fill(L, () => {
          if (lesson.variant === 1) return pickKey(ctx, c) + pickKey(ctx, v) + (Math.random() < 0.5 ? ' ' + pickKey(ctx, c) + pickKey(ctx, v) : '');
          if (Math.random() < 0.4 && tri.length) return U.pick(tri);
          return pickKey(ctx, c) + pickKey(ctx, v) + pickKey(ctx, c) + pickKey(ctx, v);
        });
      }
      case 'words':
        return fill(L * 1.2, () => word(ctx, { maxLen: lesson.maxLen, minLen: lesson.maxLen > 5 ? 3 : 1 }));
      case 'sentences': {
        const lib = libSentences(ctx);
        return fill(L * 1.3, () => lib.length > 3 && Math.random() < 0.5 ? U.pick(lib) : sentenceFromWords(ctx, 3 + U.rand(4)));
      }
      case 'punct':
        return symIntro(ctx, newKeys) + ' ' + fill(L * (1 + 0.15 * newKeys.length), () => sentenceFromWords(ctx, 3 + U.rand(4), newKeys, { punctRate: 0.65 }));
      case 'digits':
        if (lesson.mixed) return fill(L * 1.2, () => sentenceFromWords(ctx, 4 + U.rand(3), null, { digitRate: 0.35 }));
        return symIntro(ctx, newKeys) + ' ' + fill(L * 1.2, () => Math.random() < 0.6 ? number(ctx, newKeys) : word(ctx, { maxLen: 6 }));
      case 'texts':
        return TG.Texts.passage(profile, lang, ctx, 220 + lesson.variant * 80, lesson.variant === 1);
      case 'speed':
        return fill(L * 1.4, () => word(ctx, { maxLen: 6 }));
      case 'advanced':
        if (lesson.variant === 'symbols') return symIntro(ctx, newKeys) + ' ' + fill(L * 1.8, () => sentenceFromWords(ctx, 3 + U.rand(3), newKeys, { punctRate: 0.7 }));
        if (lesson.variant === 'mixed') return richify(ctx, fill(L * 1.6, () => word(ctx, { maxLen: 12 })));
        return TG.Texts.passage(profile, lang, ctx, 600, false);
    }
    return fill(L, () => word(ctx));
  }

  /* ---------- публичный API ---------- */

  const Gen = {
    makeCtx,

    lesson(profile, lang, idx, st) {
      const lesson = TG.Curriculum.lessons(lang)[idx];
      const learning = ['posture', 'keys', 'review', 'combos', 'syllables'].indexOf(lesson.type) >= 0;
      return {
        mode: 'lesson', lessonIdx: idx, lesson,
        text: lessonText(profile, lang, lesson, st),
        stopOnError: learning ? true : st.stopOnError,
        backspace: !learning && st.backspace,
        focusKeys: lesson.keys.filter(k => k !== SHIFT())
      };
    },

    adaptive(profile, lang, st, mult) {
      const th = st.thresholds;
      const ctx = makeCtx(profile, lang);
      if (ctx.letters.length < 2) return null;
      const wf = weakFocus(ctx, th);
      const last = profile.sessions.filter(s => s.adaptive).slice(-1)[0];
      const G = TG.CONFIG.GENERATOR;
      let weakShare = G.weakShare, reviewShare = G.reviewShare;
      let band = 'start';
      if (last) {
        if (last.acc < th.accLow) { band = 'low'; weakShare = 0.7; reviewShare = 0.3; ctx.maxLen = Math.max(3, ctx.maxLen - 2); }
        else if (last.acc < th.accMid) { band = 'mid'; weakShare = 0.65; reviewShare = 0.3; }
        else if (last.acc < th.accHigh) { band = 'good'; weakShare = 0.5; reviewShare = 0.35; }
        else { band = 'high'; weakShare = 0.4; reviewShare = 0.35; }
      }
      let text = fill(targetLen(ctx, mult), () => {
        const r = Math.random();
        if (r < weakShare) return weakUnit(ctx, wf);
        if (r < weakShare + reviewShare) return reviewUnit(ctx);
        return freshUnit(ctx);
      });
      if (band !== 'low') text = richify(ctx, text);
      return {
        mode: 'adaptive', text, band, adaptive: true,
        stopOnError: st.stopOnError, backspace: false,
        focusKeys: wf.weak
      };
    },

    weak(profile, lang, st, mult) {
      const ctx = makeCtx(profile, lang);
      if (ctx.letters.length < 2) return null;
      const wf = weakFocus(ctx, st.thresholds);
      ctx.maxLen = Math.max(4, ctx.maxLen - 1);
      return {
        mode: 'weak', adaptive: true,
        text: fill(targetLen(ctx, 0.9 * (mult || 1)), () => weakUnit(ctx, wf)),
        stopOnError: st.stopOnError, backspace: false, focusKeys: wf.weak,
        weakInfo: wf
      };
    },

    accuracy(profile, lang, st, mult) {
      const ctx = makeCtx(profile, lang, { level: Math.max(1, (profile.level || 2) - 1) });
      if (ctx.letters.length < 2) return null;
      const wf = weakFocus(ctx, st.thresholds);
      const text = fill(targetLen(ctx, 0.9 * (mult || 1)), () => Math.random() < 0.3 ? weakUnit(ctx, wf) : reviewUnit(ctx));
      return { mode: 'accuracy', text: richify(ctx, text), stopOnError: true, backspace: false, adaptive: true };
    },

    speed(profile, lang, st, mult) {
      const th = st.thresholds;
      let mastered = TG.Mastery.masteredKeys(profile, lang, th).filter(k => TG.Layout.get(lang).isLetter(k));
      const ctx = makeCtx(profile, lang);
      if (ctx.letters.length < 2) return null;
      if (mastered.length >= 8) {
        ctx.set = new Set(mastered.concat([' ']));
        ctx.letters = mastered;
        ctx._pool = null;
      }
      const pool = wordPool(ctx);
      const text = fill(targetLen(ctx, 1.1 * (mult || 1)), () => pool.length > 10 ? word(ctx, { maxLen: 7 }) : pseudoWord(ctx, 2 + U.rand(3)));
      return { mode: 'speed', text, stopOnError: false, backspace: st.backspace, masteredOnly: mastered.length >= 8 };
    },

    review(profile, lang, st, mult) {
      const ctx = makeCtx(profile, lang);
      if (ctx.letters.length < 2) return null;
      let focus = [...ctx.due];
      if (!focus.length) {
        focus = ctx.letters.filter(k => profile.keys[k]).sort((a, b) => profile.keys[a].last - profile.keys[b].last).slice(0, 4);
      }
      const text = fill(targetLen(ctx, 0.8 * (mult || 1)), () => {
        const k = U.pick(focus.length ? focus : ctx.letters);
        if (isSym(ctx, k)) return symUnit(ctx, k);
        return ctx.letters.length < 6 ? drill(ctx, ctx.letters, [k]) : word(ctx, { focus: [k] });
      });
      return { mode: 'review', text, stopOnError: st.stopOnError, backspace: false, hideHints: true, focusKeys: focus, adaptive: true };
    },

    warmup(profile, lang, st) {
      const ctx = makeCtx(profile, lang);
      const home = TG.Layout.get(lang).homeKeys.filter(k => ctx.set.has(k));
      const keys = home.length >= 2 ? home : ctx.letters;
      if (keys.length < 2) return null;
      const text = fill(70, () => ctx.letters.length >= 8 && Math.random() < 0.5 ? word(ctx, { maxLen: 5 }) : drill(ctx, keys));
      return { mode: 'warmup', text, stopOnError: st.stopOnError, backspace: false };
    },

    text(profile, lang, st, textObj) {
      const ctx = makeCtx(profile, lang);
      const passage = textObj ? TG.Texts.passageOf(profile, textObj, 700) : TG.Texts.passage(profile, lang, ctx, 500, false);
      return { mode: 'texts', text: passage, stopOnError: false, backspace: st.backspace, textId: textObj ? textObj.id : null };
    },

    test(profile, lang, st, seconds) {
      const ctx = makeCtx(profile, lang);
      if (ctx.letters.length < 2) return null;
      const more = () => {
        const t = fill(400, () => word(ctx, { maxLen: 9 }));
        return ctx.letters.length >= 20 ? richify(ctx, t) : t;
      };
      return {
        mode: seconds >= 120 ? 'test120' : 'test60', text: more(), more,
        timeLimit: seconds, stopOnError: false, backspace: st.backspace
      };
    },

    placement(profile, lang) {
      const pg = PANGRAMS[lang];
      const ctx = makeCtx(profile, lang, { addKeys: TG.Layout.get(lang).letters.split('') });
      const extra = fill(120, () => word(ctx, { maxLen: 8 }));
      return {
        mode: 'placement', text: U.shuffle(pg).join(' ') + ' ' + extra,
        stopOnError: false, backspace: false, timeLimit: 90
      };
    },

    /** Нормализация текста упражнения. */
    clean(text) {
      return text.replace(/\s+/g, ' ').trim();
    }
  };

  TG.Gen = Gen;
})();
