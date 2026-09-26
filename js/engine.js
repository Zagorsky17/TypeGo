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
    const lay = TG.Layout.get(opts.lang);
    const s = {
      ex,
      text: TG.Gen.clean(ex.text),
      pos: 0,
      typed: [],
      errorAt: new Set(),
      pendingError: false,
      events: [],
      corrections: 0,
      startT: 0,
      lastT: 0,
      endT: 0,
      finished: false,
      mismatchNotified: false,
      lastErrorChar: null,
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

    /** Преобразовать нажатие в символ текущей раскладки (если в ОС включена другая). */
    function resolveChar(e) {
      let ch = e.key;
      if (ch && ch.length === 1 && lay.byChar[ch]) return { ch };
      const map = lay.byCode[e.code];
      if (map && ch && ch.length === 1) {
        return { ch: e.shiftKey ? map.s : map.n, mapped: true };
      }
      return { ch: ch && ch.length === 1 ? ch : null };
    }

    function press(ch, mapped) {
      if (s.finished || !ch) return;
      const t = now();
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
      if (ok) s.lastErrorChar = null;
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
      s.typed.length = s.pos;
      s.corrections++;
      changed({ corrected: true });
      return true;
    }

    function correctChars() {
      if (ex.stopOnError) return s.pos;
      let n = 0;
      for (let i = 0; i < s.pos; i++) if (s.typed[i] === s.text[i]) n++;
      return n;
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
        if (e.ctrlKey || e.metaKey || e.altKey && !e.getModifierState('AltGraph')) return false;
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
        const ok = s.events.filter(e => e.ok).length;
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
