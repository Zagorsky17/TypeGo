/*
 * Движок набора: принимает нажатия, сверяет с текстом, считает ошибки,
 * исправления и время реакции, сообщает интерфейсу об изменениях.
 */
(function () {
  let audioCtx = null;
  function beep() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = 220;
      g.gain.setValueAtTime(0.05, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.12);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(); o.stop(audioCtx.currentTime + 0.13);
    } catch (e) { /* звук необязателен */ }
  }

  function create(ex, opts) {
    const layout = () => TG.Layout.get(opts.lang); // вариант раскладки может смениться посреди урока
    const s = {
      ex,
      text: TG.Gen.clean(ex.text),
      pos: 0,
      typed: [],
      errorAt: new Set(),
      pendingError: false,
      events: [],
      corrections: 0,
      okCount: 0,          // верных нажатий (счётчики вместо пересчёта событий на каждое нажатие)
      correct: 0,          // верно набранных позиций (режим без остановки на ошибке)
      startT: 0,
      lastT: 0,
      endT: 0,
      finished: false,
      mismatchNotified: false,
      lastErrorChar: null,
      codeMode: false,     // раскладка ОС отличается от урока — символ определяется по физической клавише
      osLang: null,        // язык раскладки ОС по последней набранной букве
      timer: null
    };

    const now = () => performance.now();

    function changed(extra) { opts.onChange && opts.onChange(s, extra || {}); }

    function ensureText() {
      if (ex.more && s.text.length - s.pos < 120) s.text += ' ' + TG.Gen.clean(ex.more());
    }

    function startTimer() {
      if (s.timer) return;
      s.timer = setInterval(() => {
        if (s.finished) return;
        if (ex.timeLimit && s.startT && now() - s.startT >= ex.timeLimit * 1000) {
          finish(s.startT + ex.timeLimit * 1000);
        } else changed({ tick: true });
      }, 250);
    }

    /**
     * Преобразовать нажатие в символ раскладки урока.
     * Если в ОС включена другая раскладка, символ определяется по физической клавише (e.code).
     * Раскладку ОС выдаёт любая буква; знаки препинания есть в обеих раскладках, поэтому по ним
     * одним ничего не понять — для них, пока раскладка неизвестна, засчитывается физически верная клавиша.
     */
    function resolveChar(e) {
      const key = e.key;
      if (!key || key.length !== 1) return { ch: null };
      const lay = layout();
      const map = lay.byCode[e.code];
      const mapped = map ? (e.shiftKey ? map.s : map.n) : null;
      const src = TG.Layout.detect(key);
      if (src) { s.osLang = src; s.codeMode = src !== opts.lang && !!map; }
      // русская раскладка ОС: знак подсказывает, «ПК» это или Mac «Русская»
      if (opts.lang === 'ru' && s.osLang === 'ru' && opts.onVariant) {
        const v = TG.Layout.variantSignal(e.code, e.shiftKey, key);
        if (v && v !== TG.Layout.variant('ru')) {
          opts.onVariant(v);
          if (TG.Layout.variant('ru') === v) return resolveChar(e); // вариант переключён — перечитать клавишу
        }
      }
      if (s.codeMode && mapped) return { ch: mapped, mapped: true };
      if (lay.byChar[key]) {
        const exp = s.text[s.pos];
        if (key !== exp && mapped === exp) {
          s.codeMode = true; // символ другой раскладки на физически верной клавише
          return { ch: mapped, mapped: true };
        }
        return { ch: key };
      }
      if (mapped) return { ch: mapped, mapped: true };
      return { ch: key };
    }

    function press(ch, mapped) {
      if (s.finished || !ch) return;
      const t = now();
      // время теста вышло, а таймер ещё не сработал (или вкладка была в фоне) — нажатие не считаем
      if (ex.timeLimit && s.startT && t - s.startT >= ex.timeLimit * 1000) {
        finish(s.startT + ex.timeLimit * 1000);
        return;
      }
      if (!s.startT) { s.startT = t; startTimer(); }
      const rt = s.lastT ? t - s.lastT : 0;
      s.lastT = t;
      const exp = s.text[s.pos];
      const ok = ch === exp;
      s.events.push({
        exp, got: ch, ok, rt, t,
        prev: s.text[s.pos - 1], prev2: s.text[s.pos - 2],
        retry: s.pendingError
      });
      if (ok) { s.lastErrorChar = null; s.okCount++; }
      else {
        s.errorAt.add(s.pos);
        s.lastErrorChar = exp;
        if (opts.sound) beep();
      }
      if (ex.stopOnError) {
        if (ok) { s.pos++; s.pendingError = false; }
        else s.pendingError = true;
      } else {
        s.typed[s.pos] = ch;
        if (ok) s.correct++;
        s.pos++;
      }
      ensureText();
      const notice = mapped && !s.mismatchNotified ? 'mapped' : null;
      if (notice) s.mismatchNotified = true;
      changed({ ok, exp, got: ch, notice });
      if (s.pos >= s.text.length && !ex.timeLimit) finish(t);
      else if (s.pos >= s.text.length && ex.timeLimit) finish(t);
    }

    function backspace() {
      if (s.finished || ex.stopOnError || !ex.backspace || s.pos === 0) return false;
      s.pos--;
      if (s.typed[s.pos] === s.text[s.pos]) s.correct--;
      s.typed.length = s.pos;
      s.corrections++;
      changed({ corrected: true });
      return true;
    }

    function correctChars() {
      return ex.stopOnError ? s.pos : s.correct;
    }

    function finish(endT) {
      if (s.finished) return;
      s.finished = true;
      clearInterval(s.timer);
      s.endT = endT || now();
      const res = TG.Stats.summarize(s.events, {
        correctChars: correctChars(), corrections: s.corrections, startT: s.startT, endT: s.endT
      }, opts.lang);
      res.completed = s.pos >= s.text.length;
      opts.onFinish && opts.onFinish(res, s);
    }

    return {
      state: s,
      keydown(e) {
        // AltGr на Windows приходит как Ctrl+Alt — такие символы нужно пропускать
        const altGr = !!(e.getModifierState && e.getModifierState('AltGraph'));
        if (e.metaKey || (!altGr && (e.ctrlKey || e.altKey))) return false;
        if (e.repeat) { e.preventDefault(); return true; } // удержание клавиши — не новое нажатие
        if (e.key === 'Backspace') { e.preventDefault(); backspace(); return true; }
        if (e.key === 'Dead' || e.key === 'Process' || e.key === 'Unidentified') return false;
        if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); return true; }
        const r = resolveChar(e);
        if (!r.ch) return false;
        e.preventDefault();
        press(r.ch, r.mapped);
        return true;
      },
      /** Резерв для мобильных клавиатур, которые не сообщают e.key. */
      inputText(data) { for (const ch of data) press(ch, false); },
      correctChars,
      elapsed() { return s.startT ? ((s.finished ? s.endT : now()) - s.startT) / 1000 : 0; },
      live() {
        const sec = this.elapsed();
        const total = s.events.length;
        const ok = s.okCount;
        return {
          wpm: sec > 1 ? Math.round(correctChars() / 5 / (sec / 60)) : 0,
          acc: total ? Math.round(ok / total * 100) : 100,
          errors: total - ok,
          sec,
          left: ex.timeLimit ? Math.max(0, ex.timeLimit - sec) : null,
          progress: ex.timeLimit ? Math.min(1, sec / ex.timeLimit) : s.pos / s.text.length
        };
      },
      expected() { return s.text[s.pos]; },
      finish() { finish(s.startT ? now() : 0); },
      abort() { s.finished = true; clearInterval(s.timer); }
    };
  }

  TG.Engine = { create };
})();
