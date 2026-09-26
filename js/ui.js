/*
 * Интерфейс: экраны, тренировка, результаты, статистика, тексты, настройки.
 */
(function () {
  const U = TG.Util;
  const t = (k, p) => TG.I18n.t(k, p);
  const esc = U.esc;
  const num = (v, d) => esc(U.num(v, d)); // число из данных → безопасная строка для разметки
  const FONT_SIZES = ['s', 'm', 'l'];
  const fontClass = () => 'fs-' + (FONT_SIZES.indexOf(ST().fontSize) >= 0 ? ST().fontSize : 'm');
  const S = () => TG.Store.state;
  const P = () => TG.Store.profile();
  const ST = () => TG.Store.settings();
  const TH = () => TG.Store.th();
  const LANG = () => ST().layoutLang;

  let main = null;          // контейнер экранов
  let route = 'home';
  let session = null;       // активная тренировка
  let lastResult = null;    // {ex, res, report}
  let heatMode = 'mastery';
  let pickerMode = false;   // экран профилей как выбор «Кто занимается?» при запуске

  /* ---------- утилиты отображения ---------- */

  function fmtKey(k) {
    if (k === ' ') return '␣';
    if (k === TG.Curriculum.SHIFT) return 'Shift';
    return TG.Layout.get(LANG()).isLetter(k) ? k.toUpperCase() : k;
  }
  const fmtKeys = keys => keys.map(fmtKey).join(' ');
  const roman = v => ({ 1: 'I', 2: 'II', 3: 'III' }[v] || v);

  function lessonTitle(lesson) {
    switch (lesson.type) {
      case 'posture': return t('lessonTitle.posture');
      case 'keys': return t('lessonTitle.keys', { keys: fmtKeys(lesson.keys) });
      case 'review': return t('lessonTitle.review');
      case 'combos': return t('lessonTitle.combos', { v: roman(lesson.variant) });
      case 'syllables': return t('lessonTitle.syllables', { v: roman(lesson.variant) });
      case 'words': return t('lessonTitle.words', { n: lesson.maxLen });
      case 'sentences': return lesson.keys.length ? t('lessonTitle.sentences') : t('lessonTitle.sentences2');
      case 'punct': return t('lessonTitle.punct', { keys: fmtKeys(lesson.keys) });
      case 'digits': return lesson.mixed ? t('lessonTitle.digitsMixed') : t('lessonTitle.digits', { keys: lesson.keys.join(' ') });
      case 'texts': return t('lessonTitle.texts', { v: roman(lesson.variant) });
      case 'speed': return t('lessonTitle.speed', { n: lesson.targetWpm });
      case 'advanced':
        if (lesson.variant === 'symbols') return t('lessonTitle.advSymbols', { keys: lesson.keys.join(' ') });
        return lesson.variant === 'mixed' ? t('lessonTitle.advMixed') : t('lessonTitle.advLong');
    }
    return '';
  }

  function lessonGoal(lesson) {
    const th = TH();
    const type = lesson.type === 'advanced' ? 'advanced' : lesson.type;
    return t('lessonGoal.' + type, { acc: lesson.type === 'speed' ? th.minAccForSpeed : th.lessonPassAcc, n: lesson.targetWpm });
  }

  function toast(msg) {
    const el = U.el('<div class="toast">' + esc(msg) + '</div>');
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 2600);
  }

  /** Собственное модальное окно подтверждения (без системных диалогов). */
  function confirmBox(msg, onOk) {
    const el = U.el('<div class="modal-back"><div class="modal"><p>' + esc(msg) + '</p><div class="row end">' +
      '<button class="btn ghost" data-m="no">' + t('cancel') + '</button>' +
      '<button class="btn danger" data-m="yes">' + t('confirm') + '</button></div></div></div>');
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-m]');
      if (!b && e.target !== el) return;
      el.remove();
      if (b && b.dataset.m === 'yes') onOk();
    });
    document.body.appendChild(el);
  }

  /** Модальное окно с полем ввода. */
  function promptBox(label, value, onOk) {
    const el = U.el('<div class="modal-back"><form class="modal"><label class="block">' + esc(label) +
      '<input type="text" maxlength="40" value="' + esc(value || '') + '"></label><div class="row end">' +
      '<button type="button" class="btn ghost" data-m="no">' + t('cancel') + '</button>' +
      '<button type="submit" class="btn primary">' + t('save') + '</button></div></form></div>');
    const input = el.querySelector('input');
    el.addEventListener('click', e => {
      if (e.target === el || e.target.closest('[data-m=no]')) el.remove();
    });
    el.querySelector('form').addEventListener('submit', e => {
      e.preventDefault();
      el.remove();
      onOk(input.value);
    });
    document.body.appendChild(el);
    input.focus();
    input.select();
  }

  function dateStr(ts) {
    const d = new Date(ts);
    return U.pad(d.getDate()) + '.' + U.pad(d.getMonth() + 1) + ' ' + U.pad(d.getHours()) + ':' + U.pad(d.getMinutes());
  }

  /* ---------- ежедневная тренировка ---------- */

  const DAILY_TEMPLATES = {
    5: [['warmup', 0.7], ['review', 1.3], ['lesson', 2], ['weak', 1]],
    10: [['warmup', 1], ['review', 2], ['lesson', 3], ['weak', 2], ['texts', 2]],
    15: [['warmup', 1], ['review', 2], ['lesson', 4], ['weak', 2], ['adaptive', 2], ['texts', 2], ['test60', 1]]
  };

  function dailyPlan() {
    const st = S();
    const lang = LANG();
    if (st.daily && st.daily.date === U.today() && st.daily.lang === lang && st.daily.minutes === ST().dailyMinutes) return st.daily;
    const prev = st.daily && st.daily.date === U.today() && st.daily.lang === lang ? st.daily : null;
    const tpl = DAILY_TEMPLATES[ST().dailyMinutes] || DAILY_TEMPLATES[10];
    const profile = P();
    const stage = TG.Curriculum.stageOf(profile, lang);
    const steps = tpl.map(([type, min]) => {
      if (type === 'texts' && stage < 7) type = 'adaptive';
      if (type === 'test60' && stage < 6) type = 'accuracy';
      return { type, min, done: false };
    });
    if (prev) steps.forEach((s, i) => { if (prev.steps[i] && prev.steps[i].type === s.type) s.done = prev.steps[i].done; });
    st.daily = { date: U.today(), lang, minutes: ST().dailyMinutes, steps };
    TG.Store.save();
    return st.daily;
  }

  function stepMult(min) {
    const avg = TG.Stats.recentAverages(P(), 10);
    const cpm = Math.max(40, (avg.wpm || 8) * 5);
    const lvl = P().level || 2;
    const base = TG.CONFIG.SESSION.baseChars + lvl * TG.CONFIG.SESSION.charsPerLevel;
    return U.clamp(min * cpm / base, 0.5, 3);
  }

  function startDaily() {
    const plan = dailyPlan();
    let i = plan.steps.findIndex(s => !s.done);
    if (i < 0) { startKind('adaptive'); return; }
    const step = plan.steps[i];
    let ex = makeEx(step.type, null, stepMult(step.min));
    if (!ex) ex = makeEx('lesson', null);
    ex.daily = { index: i, total: plan.steps.length };
    startSession(ex);
  }

  /* ---------- создание упражнений ---------- */

  function makeEx(kind, arg, mult) {
    const profile = P(), lang = LANG(), st = ST();
    let ex = null;
    switch (kind) {
      case 'lesson': {
        const L = TG.Curriculum.lessons(lang);
        let idx = arg != null ? +arg : profile.lessonIndex;
        if (idx >= L.length) return makeEx('adaptive', null, mult);
        ex = TG.Gen.lesson(profile, lang, idx, st);
        ex.title = lessonTitle(ex.lesson);
        ex.goal = lessonGoal(ex.lesson);
        break;
      }
      case 'adaptive': case 'weak': case 'accuracy': case 'speed': case 'review': case 'warmup':
        ex = TG.Gen[kind](profile, lang, st, mult);
        if (!ex && kind !== 'lesson') {
          if (profile.lessonIndex < TG.Curriculum.lessons(lang).length) return makeEx('lesson', null);
        }
        break;
      case 'texts':
        ex = TG.Gen.text(profile, lang, st, arg ? TG.Texts.byId(arg) : null);
        break;
      case 'test60': ex = TG.Gen.test(profile, lang, st, 60); break;
      case 'test120': ex = TG.Gen.test(profile, lang, st, 120); break;
      case 'placement': ex = TG.Gen.placement(profile, lang); break;
      case 'free': ex = { mode: 'free', text: '' }; break;
    }
    if (!ex) return null;
    ex.kind = kind;
    ex.arg = arg;
    ex.mult = mult;
    if (!ex.title) ex.title = t('mode.' + ex.mode);
    if (!ex.goal) {
      const avg = TG.Stats.recentAverages(profile, 10);
      ex.goal = t('modeGoal.' + ex.mode, { acc: kind === 'speed' ? TH().minAccForSpeed : TH().accMid, wpm: avg.wpm || '—' });
    }
    return ex;
  }

  function startKind(kind, arg) {
    const ex = makeEx(kind, arg, 1);
    if (!ex) { toast(t('needLessons')); return; }
    startSession(ex);
  }

  /* ---------- экран тренировки ---------- */

  function hintVisible(k, s) {
    const st = ST();
    if (st.hintsMode === 'never') return s.lastErrorChar === k;
    if (st.hintsMode === 'always') return true;
    const key = TG.Layout.keyId(LANG(), k);
    if (s.lastErrorChar === k) return true;
    if (session.errBoost[key] > 0) return true;
    if (session.ex.hideHints) return false;
    if (session.ex.mode === 'lesson' && (session.ex.focusKeys || []).indexOf(key) >= 0) return true;
    if (k === ' ') return TG.Mastery.overall(P(), LANG()) < TH().hintFadeMastery;
    return TG.Mastery.score(P(), key) < TH().hintFadeMastery;
  }

  function startSession(ex) {
    if (session && session.engine) session.engine.abort();
    route = 'session';
    updateNav();
    if (ex.mode === 'lesson' && ex.lesson) TG.Curriculum.introduce(P(), ex.lesson);
    if (ex.mode === 'free') { renderFree(ex); return; }
    const lang = LANG();
    const st = ST();
    const lay = TG.Layout.get(lang);
    const fs = fontClass();
    let brief = '';
    if (ex.mode === 'lesson' && ex.lesson.type === 'posture') {
      const home = lay.homeKeys.map(k => fmtKey(k)).join(' ');
      brief = '<div class="brief"><h3>' + t('postureTitle') + '</h3><ol>' +
        t('posture').map(line => '<li>' + esc(line.replace('{f}', fmtKey(lay.byCode.KeyF.n)).replace('{j}', fmtKey(lay.byCode.KeyJ.n)).replace('{home}', home)) + '</li>').join('') +
        '</ol></div>';
    } else if (ex.mode === 'lesson' && ex.focusKeys && ex.focusKeys.length) {
      brief = '<div class="brief"><b>' + t('newKeysBrief') + ':</b> ' + ex.focusKeys.map(k => {
        const info = lay.byChar[k] || lay.byChar[k.toLowerCase()];
        return '<span class="chip"><kbd>' + esc(fmtKey(k)) + '</kbd> ' + (info ? esc(t('finger.' + info.finger)) : '') + '</span>';
      }).join(' ') + '</div>';
    } else if (ex.hideHints) {
      brief = '<div class="brief">' + t('retrievalBrief') + '</div>';
    } else if (ex.mode === 'placement') {
      brief = '<div class="brief">' + t('takePlacementDesc') + '</div>';
    }
    const dailyTag = ex.daily ? '<span class="tag">' + t('mode.daily') + ' · ' + (ex.daily.index + 1) + '/' + ex.daily.total + '</span>' : '';
    main.innerHTML =
      '<section class="session">' +
      '<div class="sess-head"><div><div class="sess-title">' + dailyTag + '<h2>' + esc(ex.title) + '</h2></div>' +
      (ex.goal ? '<p class="muted">' + esc(ex.goal) + '</p>' : '') + '</div>' +
      '<div class="row"><button class="btn ghost" data-action="restart">' + t('restart') + '</button>' +
      '<button class="btn ghost" data-action="exit">' + t('exit') + ' <kbd>Esc</kbd></button></div></div>' +
      brief +
      '<div class="live">' +
      '<div><span class="lbl" id="lvTimeL">' + (ex.timeLimit ? t('left') : t('time')) + '</span><b id="lvTime">0:00</b></div>' +
      '<div><span class="lbl">' + t('wpm') + '</span><b id="lvWpm">0</b></div>' +
      '<div><span class="lbl">' + t('accuracy') + '</span><b id="lvAcc">100%</b></div>' +
      '<div><span class="lbl">' + t('errors') + '</span><b id="lvErr">0</b></div></div>' +
      '<div class="pbar"><span id="lvProg"></span></div>' +
      '<div class="textbox ' + fs + '" id="textbox" tabindex="-1"><div class="text-inner" id="textInner"></div>' +
      '<div class="start-hint" id="startHint">' + t('pressToStart') + '</div></div>' +
      '<div class="hintline" id="hintline"></div>' +
      '<div class="notice" id="notice" hidden></div>' +
      '<div id="kbWrap" class="kb-wrap' + (st.showKeyboard ? '' : ' hidden') + (ex.hideHints ? ' retrieval' : '') + '"></div>' +
      '<div id="fingerWrap"' + (st.showFingers ? '' : ' hidden') + '></div>' +
      '<div class="row center"><button class="btn link" data-action="toggle-kb">' + (st.showKeyboard ? t('hideKeyboard') : t('showKeyboard')) + '</button></div>' +
      '<input id="hiddenInput" class="hidden-input" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" aria-hidden="true">' +
      '</section>';

    const kb = TG.Keyboard.render(document.getElementById('kbWrap'), lang);
    kb.applyStatus(P(), TH(), st.hintsMode === 'auto');
    const fingers = TG.Keyboard.fingersBar(document.getElementById('fingerWrap'), t);
    const inner = document.getElementById('textInner');
    const spans = [];

    session = { ex, kb, fingers, spans, inner, lastPos: 0, errBoost: {}, handled: false };

    const appendSpans = text => {
      const frag = document.createDocumentFragment();
      for (let i = spans.length; i < text.length; i++) {
        const sp = document.createElement('span');
        sp.textContent = text[i];
        if (text[i] === ' ') sp.className = 'sp';
        spans.push(sp);
        frag.appendChild(sp);
      }
      inner.appendChild(frag);
    };

    const engine = TG.Engine.create(ex, {
      lang, sound: st.sound,
      onChange: (s, info) => {
        if (s.text.length > spans.length) appendSpans(s.text);
        if (!info.tick) {
          document.getElementById('startHint').hidden = true;
          if (info.ok === false) {
            kb.flashError(info.exp);
            session.errBoost[TG.Layout.keyId(lang, info.exp)] = 3;
            const box = document.getElementById('textbox');
            box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake');
          } else if (info.ok) {
            const k = TG.Layout.keyId(lang, info.exp);
            if (session.errBoost[k] > 0) session.errBoost[k]--;
          }
          if (info.notice === 'mapped') {
            const n = document.getElementById('notice');
            n.textContent = t('mappedNotice');
            n.hidden = false;
          }
          paintText(s);
          paintHint(s);
        }
        paintLive();
      },
      onFinish: (res, s) => finishSession(ex, res, s)
    });
    session.engine = engine;
    appendSpans(engine.state.text);
    paintText(engine.state);
    paintHint(engine.state);
    paintLive();
    focusInput();
  }

  function focusInput() {
    const inp = document.getElementById('hiddenInput');
    if (inp) inp.focus({ preventScroll: true });
  }

  function paintText(s) {
    const { spans, inner } = session;
    const from = Math.max(0, Math.min(session.lastPos, s.pos) - 1);
    const to = Math.min(spans.length - 1, Math.max(session.lastPos, s.pos) + 1);
    for (let i = from; i <= to; i++) {
      const sp = spans[i];
      let cls = s.text[i] === ' ' ? 'sp' : '';
      if (i < s.pos) {
        const wrong = !session.ex.stopOnError && s.typed[i] !== s.text[i];
        cls += wrong ? ' bad' : (s.errorAt.has(i) ? ' done fixed' : ' done');
      } else if (i === s.pos) {
        cls += ' cur' + (s.pendingError ? ' pend' : '');
      }
      sp.className = cls;
    }
    session.lastPos = s.pos;
    const cur = spans[Math.min(s.pos, spans.length - 1)];
    if (cur) {
      const lh = cur.offsetHeight || 40;
      const off = Math.max(0, cur.offsetTop - lh);
      inner.style.transform = 'translateY(' + (-off) + 'px)';
    }
  }

  function paintHint(s) {
    const lang = LANG();
    const exp = s.text[s.pos];
    const hl = document.getElementById('hintline');
    if (exp == null) { session.kb.clear(); session.fingers.set(null); hl.textContent = ''; return; }
    const show = hintVisible(exp, s);
    const info = session.kb.highlight(exp, show);
    const lay = TG.Layout.get(lang);
    const i2 = lay.byChar[exp];
    session.fingers.set(show && i2 ? i2.finger : null);
    if (show && i2) {
      let txt = '<kbd>' + esc(exp === ' ' ? '␣' : exp) + '</kbd> ' + esc(t('finger.' + i2.finger));
      if (i2.shift) txt += ' ' + esc(t('withShift', { side: t('shiftSide.' + TG.Layout.shiftSide(lang, exp)) }));
      hl.innerHTML = txt;
    } else hl.innerHTML = '&nbsp;';
    return info;
  }

  function paintLive() {
    if (!session || !session.engine) return;
    const lv = session.engine.live();
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('lvTime', U.fmtTime(lv.left != null ? lv.left : lv.sec));
    set('lvWpm', lv.wpm);
    set('lvAcc', lv.acc + '%');
    set('lvErr', lv.errors);
    const pr = document.getElementById('lvProg');
    if (pr) pr.style.width = (lv.progress * 100).toFixed(1) + '%';
  }

  /* ---------- свободная печать ---------- */

  function renderFree(ex) {
    main.innerHTML = '<section class="session">' +
      '<div class="sess-head"><div><h2>' + t('mode.free') + '</h2><p class="muted">' + t('freeHint') + '</p></div>' +
      '<div class="row"><button class="btn primary" data-action="finish-free">' + t('finish') + '</button>' +
      '<button class="btn ghost" data-action="exit">' + t('exit') + '</button></div></div>' +
      '<div class="live"><div><span class="lbl">' + t('time') + '</span><b id="lvTime">0:00</b></div>' +
      '<div><span class="lbl">' + t('wpm') + '</span><b id="lvWpm">0</b></div>' +
      '<div><span class="lbl">' + t('corrections') + '</span><b id="lvErr">0</b></div></div>' +
      '<textarea id="freeArea" class="free-area ' + fontClass() + '" spellcheck="false"></textarea></section>';
    const area = document.getElementById('freeArea');
    const fs = { ex, startT: 0, lastT: 0, events: [], corrections: 0, timer: null };
    session = { ex, free: fs };
    area.addEventListener('keydown', e => {
      const now = performance.now();
      if (!fs.startT) {
        fs.startT = now;
        fs.timer = setInterval(() => {
          const sec = (performance.now() - fs.startT) / 1000;
          document.getElementById('lvTime').textContent = U.fmtTime(sec);
          document.getElementById('lvWpm').textContent = Math.round(area.value.length / 5 / Math.max(sec / 60, 1 / 60));
        }, 500);
      }
      if (e.repeat) return; // удержание клавиши не считаем отдельными нажатиями
      if (e.key === 'Backspace') { fs.corrections++; document.getElementById('lvErr').textContent = fs.corrections; return; }
      if (e.key.length === 1) {
        fs.events.push({ ok: true, rt: fs.lastT ? now - fs.lastT : 0, t: now, got: e.key });
        fs.lastT = now;
      }
    });
    area.focus();
  }

  function finishFree() {
    const fs = session.free;
    clearInterval(fs.timer);
    const text = document.getElementById('freeArea').value;
    if (!fs.startT || text.length < TG.CONFIG.SESSION.freeMinChars) { toast(t('tooShort')); go('train'); return; }
    const res = TG.Stats.summarize(fs.events, { correctChars: text.length, corrections: fs.corrections, startT: fs.startT, endT: performance.now() }, LANG());
    res.acc = res.keystrokes ? Math.round(U.clamp((res.keystrokes - fs.corrections * 2) / res.keystrokes, 0, 1) * 1000) / 10 : 0;
    finishSession(fs.ex, res, { events: [] });
  }

  /* ---------- обработка результатов ---------- */

  function finishSession(ex, res, s) {
    if (!res.keystrokes || res.keystrokes < 5 || res.durationS < 2) {
      if (session && session.engine) session.engine.abort();
      toast(t('tooShort'));
      go(ex.daily ? 'home' : 'train');
      return;
    }
    const report = applyResult(ex, res, s.events);
    lastResult = { ex, res, report };
    TG.Store.saveNow(); // сразу: страницу могут закрыть или выгрузить в любой момент
    renderResults();
  }

  function applyResult(ex, res, events) {
    const st = S(), profile = P(), lang = LANG(), th = TH();
    const report = { msgs: [], lesson: null, record: false, speedCounted: res.acc >= th.minAccForSpeed };
    const free = ex.mode === 'free';
    if (!free) TG.Mastery.applySession(profile, events, lang);

    // адаптация сложности
    const adaptModes = ['adaptive', 'weak', 'accuracy', 'review', 'warmup', 'lesson'];
    if (adaptModes.indexOf(ex.mode) >= 0) {
      const L = TG.CONFIG.LEVEL;
      let msg;
      if (res.acc < th.accLow) { profile.level -= L.down; msg = ['adaptLow', { v: th.accLow }]; }
      else if (res.acc < th.accMid) msg = ['adaptMid'];
      else if (res.acc < th.accHigh) { profile.level += L.upSmall; msg = ['adaptGood']; }
      else { profile.level += L.upBig; msg = ['adaptHigh']; }
      profile.level = U.clamp(profile.level, L.min, L.max);
      if (ex.mode !== 'lesson') report.msgs.push(msg);
    }

    // запись сессии
    profile.sessions.push({
      date: Date.now(), mode: ex.mode, wpm: res.wpm, cpm: res.cpm, acc: res.acc, errors: res.errors,
      corrections: res.corrections, rtAvg: res.rtAvg, stability: res.stability, durationS: res.durationS,
      keystrokes: res.keystrokes, adaptive: !!ex.adaptive, lessonId: ex.lesson ? ex.lesson.id : null, free: free || undefined
    });
    profile.totalKeystrokes += res.keystrokes;
    profile.totalSeconds += res.durationS;
    TG.Stats.registerPractice(st, res.durationS);

    // рекорд скорости — только при достаточной точности
    const recordModes = ['test60', 'test120', 'speed', 'texts', 'adaptive'];
    if (report.speedCounted && recordModes.indexOf(ex.mode) >= 0 && res.keystrokes >= 50 && res.wpm > profile.bestWpm) {
      profile.bestWpm = res.wpm;
      report.record = true;
    }

    // урок
    if (ex.mode === 'lesson') {
      const ev = TG.Curriculum.evaluate(ex.lesson, res, profile, lang, th);
      report.lesson = ev;
      if (ev.passed) {
        TG.Curriculum.markPassed(profile, ex.lessonIdx, lang);
        const d = profile.lessonsDone[ex.lesson.id];
        d.best = Math.max(d.best || 0, res.wpm);
      }
    }

    // диагностика
    if (ex.mode === 'placement') {
      const n = TG.Curriculum.placement(profile, lang, res, res.perKey);
      const cur = TG.Curriculum.current(profile, lang);
      report.msgs.push(['placementResult', { n, t: lessonTitle(cur) }]);
    }

    // Mastery Learning: новые клавиши и автоматический зачёт урока
    if (ex.adaptive) {
      const passed = TG.Curriculum.autoPass(profile, lang, th, res.acc);
      if (passed) report.msgs.push(['autoPassed', { t: lessonTitle(passed) }]);
      const added = TG.Curriculum.autoIntroduce(profile, lang, th);
      if (added) report.msgs.push(['newKeysAdded', { keys: fmtKeys(added) }]);
    }

    if (!free) {
      const weak = TG.Mastery.weakKeys(profile, lang, 3, th).filter(x => x.practiced).map(x => x.k);
      if (weak.length) report.msgs.push(['nextFocus', { keys: fmtKeys(weak) }]);
    }

    // ежедневная тренировка
    if (ex.daily) {
      const plan = dailyPlan();
      if (plan.steps[ex.daily.index]) plan.steps[ex.daily.index].done = true;
      report.dailyNext = plan.steps.findIndex(x => !x.done);
      if (report.dailyNext < 0) report.msgs.push(['dailyCompleteMsg', { n: TG.Stats.currentStreak(st) }]);
    }
    st.onboarded = true;
    return report;
  }

  function renderResults() {
    route = 'results';
    updateNav();
    const { ex, res, report } = lastResult;
    const th = TH(), lang = LANG();
    const errKeys = Object.keys(res.perKey).map(k => ({ k, n: res.perKey[k].n, e: res.perKey[k].n - res.perKey[k].ok }))
      .filter(x => x.e > 0).sort((a, b) => b.e - a.e).slice(0, 12);
    let lessonBlock = '';
    if (report.lesson) {
      lessonBlock = '<div class="card ' + (report.lesson.passed ? 'ok' : 'warn') + '"><h3>' +
        (report.lesson.passed ? t('lessonPassed') : t('lessonNotPassed')) + '</h3>' +
        (report.lesson.reasons.length ? '<ul>' + report.lesson.reasons.map(r => '<li>' + esc(t(r[0], r[1])) + '</li>').join('') + '</ul>' : '') + '</div>';
    }
    const msgs = report.msgs.map(m => '<li>' + esc(t(m[0], m[1])) + '</li>').join('');
    let nextLabel = t('next');
    if (ex.daily && report.dailyNext >= 0) nextLabel = t('nextStep', { i: report.dailyNext + 1, n: ex.daily.total });
    const speedNote = !report.speedCounted && ex.mode !== 'free'
      ? '<p class="note warn">' + t('speedNotCounted', { acc: th.minAccForSpeed }) + '</p>' : '';
    const tile = (label, val, cls) => '<div class="metric ' + (cls || '') + '"><span class="lbl">' + esc(label) + '</span><b>' + esc(val) + '</b></div>';
    main.innerHTML =
      '<section class="results">' +
      '<div class="sess-head"><div><h2>' + t('results') + ' · ' + esc(ex.title) + '</h2></div></div>' +
      (report.record ? '<p class="note ok">★ ' + t('newRecord') + '</p>' : '') +
      '<div class="metrics">' +
      tile(t('wpm'), res.wpm, report.speedCounted ? '' : 'dim') +
      tile(t('cpm'), res.cpm, report.speedCounted ? '' : 'dim') +
      tile(t('accuracy'), res.acc + '%', res.acc >= th.accHigh ? 'good' : res.acc < th.accLow ? 'bad' : '') +
      tile(t('errors'), res.errors) +
      tile(t('corrections'), res.corrections) +
      tile(t('time'), U.fmtTime(res.durationS)) +
      tile(t('reaction'), res.rtAvg ? t('ms', { n: res.rtAvg }) : '—') +
      tile(t('stability'), res.stability ? res.stability + '%' : '—') +
      '</div>' + speedNote + lessonBlock +
      (msgs ? '<div class="card"><ul class="msgs">' + msgs + '</ul></div>' : '') +
      '<div class="grid2">' +
      '<div class="card"><h3>' + t('speedTimeline') + '</h3>' + TG.Charts.line([{ values: res.timeline, cls: 's1', area: true }], { height: 160, min: 0, empty: '—' }) + '</div>' +
      '<div class="card"><h3>' + t('keysWithErrors') + '</h3>' +
      (errKeys.length ? '<div class="chips">' + errKeys.map(x => '<span class="chip bad"><kbd>' + esc(fmtKey(x.k)) + '</kbd> ' + x.e + '/' + x.n + '</span>').join('') + '</div>' : '<p class="muted">' + t('noErrors') + '</p>') +
      '</div></div>' +
      '<div class="row center gap">' +
      '<button class="btn ghost" data-action="repeat">' + t('repeat') + '</button>' +
      '<button class="btn primary" data-action="next">' + nextLabel + ' <kbd>Enter</kbd></button>' +
      '<button class="btn ghost" data-action="nav:home">' + t('toHome') + '</button></div>' +
      '</section>';
    session = null;
  }

  function nextAfterResult() {
    const { ex, report } = lastResult;
    if (ex.daily && report.dailyNext >= 0) { startDaily(); return; }
    if (ex.daily) { go('home'); return; }
    if (ex.mode === 'lesson') {
      if (report.lesson && report.lesson.passed) startKind('lesson');
      else startKind('lesson', ex.lessonIdx);
      return;
    }
    if (ex.mode === 'placement') { startKind('lesson'); return; }
    startKind(ex.kind === 'texts' ? 'texts' : ex.kind, ex.kind === 'texts' ? ex.arg : null);
  }

  /* ---------- главная ---------- */

  function renderHome() {
    const st = S(), profile = P(), lang = LANG(), th = TH();
    const L = TG.Curriculum.lessons(lang);
    const done = Math.min(profile.lessonIndex, L.length);
    const stage = TG.Curriculum.stageOf(profile, lang);
    const unlocked = [...TG.Curriculum.unlocked(profile, lang)].filter(k => k !== ' ' && k !== TG.Curriculum.SHIFT);
    const mastered = TG.Mastery.masteredKeys(profile, lang, th).length;
    const overall = TG.Mastery.overall(profile, lang);
    const avg = TG.Stats.recentAverages(profile, 10);
    const hist = profile.sessions.filter(s => !s.free && s.keystrokes > 20).slice(-20);
    const plan = dailyPlan();
    const todaySec = TG.Stats.todaySeconds(st);
    const todayMin = Math.round(todaySec / 60);
    const planDone = plan.steps.every(s => s.done);
    const streak = TG.Stats.currentStreak(st);
    const cur = TG.Curriculum.isComplete(profile, lang) ? null : TG.Curriculum.current(profile, lang);
    const weak = TG.Mastery.weakKeys(profile, lang, 5, th).filter(x => x.practiced);
    const due = TG.Mastery.dueKeys(profile, lang);
    const fresh = !st.onboarded && profile.sessions.length === 0;

    // последние 14 дней для серии
    const days = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const k = U.dateKey(d);
      days.push('<i class="' + ((st.dailyLog[k] || 0) >= TG.CONFIG.SESSION.minSecondsForStreak ? 'on' : '') + '" title="' + k + '"></i>');
    }

    let html = '<section class="home">';
    if (fresh) {
      html += '<div class="card hero"><h2>' + t('welcomeTitle') + '</h2><p>' + t('welcomeText') + '</p>' +
        '<div class="choice">' +
        '<button class="choice-btn" data-action="onboard-zero"><b>' + t('startFromZero') + '</b><span>' + t('startFromZeroDesc') + '</span></button>' +
        '<button class="choice-btn" data-action="onboard-placement"><b>' + t('takePlacement') + '</b><span>' + t('takePlacementDesc') + '</span></button>' +
        '</div></div>';
    }
    if (todayMin >= TG.CONFIG.BREAK_REMINDER_MIN) html += '<p class="note">' + t('breakHint', { m: todayMin }) + '</p>';

    // Прогресс
    html += '<div class="card progress-card"><div class="card-head"><h3>' + t('progress') + '</h3><span class="muted">' + t('stageOf', { n: stage }) + ' · ' + esc(t('stage.' + stage)) + '</span></div>' +
      '<div class="stages">' + Array.from({ length: 12 }, (_, i) => '<i class="' + (i + 1 < stage || TG.Curriculum.isComplete(profile, lang) ? 'on' : i + 1 === stage ? 'cur' : '') + '" title="' + esc(t('stage.' + (i + 1))) + '"></i>').join('') + '</div>' +
      '<div class="kpis">' +
      '<div><b>' + num(done) + '/' + num(L.length) + '</b><span>' + t('lessonsDone') + '</span></div>' +
      '<div><b>' + num(mastered) + '/' + num(unlocked.length) + '</b><span>' + t('keysMastered') + '</span></div>' +
      '<div><b>' + num(overall) + '</b><span>' + t('overallMastery') + '</span></div></div></div>';

    // Сегодняшняя тренировка
    html += '<div class="card today"><div class="card-head"><h3>' + t('todayTraining') + '</h3><span class="muted">' +
      t('todayMinutes', { m: todayMin, g: ST().dailyMinutes }) + '</span></div>' +
      '<div class="pbar"><span style="width:' + Math.min(100, todaySec / 60 / ST().dailyMinutes * 100) + '%"></span></div>' +
      '<ol class="steps">' + plan.steps.map(s => '<li class="' + (s.done ? 'done' : '') + '">' + esc(t('dailySteps.' + s.type)) + ' <small>~' + num(s.min) + ' ' + (TG.I18n.lang === 'ru' ? 'мин' : 'min') + '</small></li>').join('') + '</ol>' +
      '<button class="btn primary big" data-action="daily">' + (planDone ? t('dailyAgain') : plan.steps.some(s => s.done) ? t('dailyContinue') : t('dailyStart')) + '</button>' +
      (planDone ? '<p class="muted small">✓ ' + t('dailyDone') + '</p>' : '') + '</div>';

    // Скорость / Точность / Серия
    html += '<div class="grid3">' +
      '<div class="card stat"><h3>' + t('speed') + '</h3><b class="big-num">' + (avg.count ? num(avg.wpm) : '—') + ' <small>WPM</small></b>' +
      TG.Charts.spark(hist.map(s => s.wpm), 's1') + '<span class="muted small">' + t('last10') + ' · ' + esc(t('bestWpm', { n: U.num(profile.bestWpm) || '—' })) + '</span></div>' +
      '<div class="card stat"><h3>' + t('accuracy') + '</h3><b class="big-num">' + (avg.count ? num(avg.acc) + '%' : '—') + '</b>' +
      TG.Charts.spark(hist.map(s => s.acc), 's2') + '<span class="muted small">' + t('last10') + '</span></div>' +
      '<div class="card stat"><h3>' + t('streak') + '</h3><b class="big-num">' + esc(t('streakDays', { n: U.num(streak) })) + '</b>' +
      '<div class="days">' + days.join('') + '</div><span class="muted small">' + esc(t('streakBest', { n: U.num(st.streak.best) })) + '</span></div>' +
      '</div>';

    // Продолжить обучение
    html += '<div class="card continue"><div class="card-head"><h3>' + t('continueLearning') + '</h3></div>';
    if (cur) {
      html += '<div class="continue-row"><div><b>' + esc(lessonTitle(cur)) + '</b><p class="muted">' + esc(t('stage.' + cur.stage)) + ' · ' + esc(lessonGoal(cur)) + '</p></div>' +
        '<button class="btn primary" data-action="start:lesson">' + t('start') + '</button></div>';
    } else html += '<p>' + t('allLessonsDone') + '</p><button class="btn primary" data-action="start:adaptive">' + t('mode.adaptive') + '</button>';
    if (weak.length || due.length) {
      html += '<div class="focus">';
      if (weak.length) html += '<div><span class="muted small">' + t('weakKeysTitle') + '</span><div class="chips">' + weak.map(x => '<span class="chip bad"><kbd>' + esc(fmtKey(x.k)) + '</kbd> ' + num(x.s) + '</span>').join('') + '</div></div>';
      if (due.length) html += '<div><span class="muted small">' + t('dueKeysTitle') + '</span><div class="chips">' + due.slice(0, 10).map(k => '<span class="chip"><kbd>' + esc(fmtKey(k)) + '</kbd></span>').join('') + '</div></div>';
      html += '</div>';
    }
    html += '</div></section>';
    main.innerHTML = html;
  }

  /* ---------- тренировки ---------- */

  function renderTrain() {
    const profile = P(), lang = LANG();
    const L = TG.Curriculum.lessons(lang);
    const enough = TG.Curriculum.unlockedLetters(profile, lang).length >= 2;
    const modes = [
      ['lesson', '◎', true], ['adaptive', '⟳', enough], ['weak', '◇', enough], ['accuracy', '✓', enough],
      ['speed', '»', enough], ['texts', '¶', true], ['free', '✎', true], ['test60', '60', enough], ['test120', '120', enough], ['review', '↺', enough]
    ];
    let html = '<section class="train"><h2>' + t('modesTitle') + '</h2><div class="modes">';
    html += '<button class="mode-card accent" data-action="daily"><span class="ico">☀</span><b>' + t('mode.daily') + '</b><span>' +
      t('minutesShort', { n: ST().dailyMinutes }) + '</span></button>';
    modes.forEach(([m, ico, ok]) => {
      html += '<button class="mode-card" data-action="start:' + m + '"' + (ok ? '' : ' disabled title="' + esc(t('needLessons')) + '"') + '>' +
        '<span class="ico">' + ico + '</span><b>' + t('mode.' + m) + '</b><span>' + t('modeDesc.' + m) + '</span></button>';
    });
    html += '</div><h2>' + t('lessonMap') + '</h2><div class="lesson-map">';
    for (let sIdx = 1; sIdx <= 12; sIdx++) {
      const items = L.map((l, i) => ({ l, i })).filter(x => x.l.stage === sIdx);
      html += '<div class="stage-block"><h4><span class="num">' + sIdx + '</span>' + esc(t('stage.' + sIdx)) + '</h4><ul>';
      items.forEach(({ l, i }) => {
        const st = i < profile.lessonIndex ? 'passed' : i === profile.lessonIndex ? 'current' : 'locked';
        const best = profile.lessonsDone[l.id] && profile.lessonsDone[l.id].best;
        html += '<li class="' + st + '">' + (st === 'locked' ? '<span>' : '<button class="lesson-link" data-action="lesson:' + i + '">') +
          '<i></i>' + esc(lessonTitle(l)) + (best ? ' <small>' + num(best) + ' WPM</small>' : '') +
          (st === 'locked' ? '</span>' : '</button>') + '</li>';
      });
      html += '</ul></div>';
    }
    html += '</div></section>';
    main.innerHTML = html;
  }

  /* ---------- статистика ---------- */

  function renderStats() {
    const st = S(), profile = P(), lang = LANG(), th = TH();
    const lay = TG.Layout.get(lang);
    const hist = profile.sessions.filter(s => !s.free && s.keystrokes > 20).slice(-60);
    const totalMin = Math.round(profile.totalSeconds / 60);
    const avgAcc = hist.length ? Math.round(U.mean(hist.map(s => s.acc)) * 10) / 10 : null;
    const labels = hist.map(s => dateStr(s.date));
    const weak = TG.Mastery.weakKeys(profile, lang, 8, th).filter(x => x.practiced);
    const pairs = TG.Mastery.problemBigrams(profile, lang, 8);
    const seqs = TG.Mastery.problemTrigrams(profile, lang, 6);
    const conf = TG.Mastery.topConfusions(profile, 8);
    const fingers = TG.Mastery.fingerStats(profile, lang).filter(f => f.f !== 'th');
    const weakF = TG.Mastery.weakFingers(profile, lang);

    const allKeys = lay.letters.split('').concat([...TG.Curriculum.unlocked(profile, lang)].filter(k => !lay.isLetter(k) && k !== ' ' && k !== TG.Curriculum.SHIFT));
    let html = '<section class="stats"><h2>' + t('statsTitle') + ' · ' + t('layoutName.' + lang) + '</h2>' +
      '<div class="metrics">' +
      '<div class="metric"><span class="lbl">' + t('totalTime') + '</span><b>' + (totalMin >= 60 ? num(Math.floor(totalMin / 60)) + 'h ' + num(totalMin % 60) + 'm' : num(totalMin) + ' min') + '</b></div>' +
      '<div class="metric"><span class="lbl">' + t('totalSessions') + '</span><b>' + num(profile.sessions.length) + '</b></div>' +
      '<div class="metric"><span class="lbl">WPM ★</span><b>' + (U.num(profile.bestWpm) || '—') + '</b></div>' +
      '<div class="metric"><span class="lbl">' + t('avgAcc') + '</span><b>' + (avgAcc != null ? num(avgAcc) + '%' : '—') + '</b></div>' +
      '<div class="metric"><span class="lbl">' + t('overallMastery') + '</span><b>' + num(TG.Mastery.overall(profile, lang)) + '</b></div>' +
      '<div class="metric"><span class="lbl">' + t('streak') + '</span><b>' + num(TG.Stats.currentStreak(st)) + '</b></div>' +
      '</div>' +
      '<div class="grid2">' +
      '<div class="card"><h3>' + t('speedProgress') + '</h3>' + TG.Charts.line([{ values: hist.map(s => s.wpm), cls: 's1', area: true, name: 'WPM' }], { labels, min: 0, empty: t('noData') }) + '</div>' +
      '<div class="card"><h3>' + t('accProgress') + '</h3>' + TG.Charts.line([{ values: hist.map(s => s.acc), cls: 's2', name: '%' }], { labels, max: 100, min: Math.max(0, Math.min(80, ...hist.map(s => s.acc)) - 2), empty: t('noData') }) + '</div>' +
      '</div>' +
      '<div class="card"><div class="card-head"><h3>' + t('heatmap') + '</h3><div class="seg">' +
      ['mastery', 'errors', 'speed'].map(m => '<button class="' + (heatMode === m ? 'on' : '') + '" data-action="heat:' + m + '">' + t('heatMode.' + m) + '</button>').join('') +
      '</div></div><div id="heatKb" class="kb-wrap"></div>' +
      '<div class="heat-legend"><span>0</span><i></i><span>100</span></div></div>' +
      '<div class="grid2">' +
      '<div class="card"><h3>' + t('fingerProgress') + '</h3>' + TG.Charts.bars(fingers.map(f => ({
        label: t('finger.' + f.f), value: f.mastery, cls: weakF.indexOf(f.f) >= 0 ? 'bad' : '',
        note: f.presses ? Math.round(f.errRate * 100) + '% ' + t('errRate') : ''
      }))) + '</div>' +
      '<div class="card"><h3>' + t('problemKeys') + '</h3>' +
      (weak.length ? '<div class="chips">' + weak.map(x => '<span class="chip bad"><kbd>' + esc(fmtKey(x.k)) + '</kbd> ' + num(x.s) + '</span>').join('') + '</div>' : '<p class="muted">' + t('noData') + '</p>') +
      '<h3>' + t('problemPairs') + '</h3>' +
      (pairs.length ? '<div class="chips">' + pairs.map(b => '<span class="chip"><kbd>' + esc(b.k) + '</kbd> ' + num(Math.round(b.errRate * 100)) + '% · ' + (U.num(b.rt) || '—') + 'ms</span>').join('') + '</div>' : '<p class="muted">—</p>') +
      '<h3>' + t('problemSeq') + '</h3>' +
      (seqs.length ? '<div class="chips">' + seqs.map(s => '<span class="chip"><kbd>' + esc(s.k) + '</kbd> ' + num(s.e) + '/' + num(s.n) + '</span>').join('') + '</div>' : '<p class="muted">—</p>') +
      '<h3>' + t('confusions') + '</h3>' +
      (conf.length ? '<div class="chips">' + conf.map(c => '<span class="chip">' + esc(t('confusionItem', { a: fmtKey(c.got), b: fmtKey(c.exp) })) + ' ×' + num(c.n) + '</span>').join('') + '</div>' : '<p class="muted">—</p>') +
      '</div></div>' +
      '<div class="card"><h3>' + t('keyMastery') + '</h3><div class="key-grid">' +
      allKeys.map(k => {
        const s = TG.Mastery.score(profile, k);
        const status = TG.Mastery.status(profile, k, th);
        const r = profile.keys[k];
        return '<div class="kcell st-' + status + '" title="' + esc(t('status.' + status)) + (r ? ' · ' + num(U.num(r.h) + U.num(r.e)) + ' ' + esc(t('hits')) : '') + '"><kbd>' + esc(fmtKey(k)) + '</kbd><b>' + (r ? s : '—') + '</b></div>';
      }).join('') + '</div>' +
      '<div class="legend">' + ['none', 'new', 'learning', 'good', 'mastered'].map(s => '<span class="st-' + s + '"><i></i>' + t('status.' + s) + '</span>').join('') + '</div></div>' +
      '<div class="card"><h3>' + t('history') + '</h3>' + historyTable(profile) + '</div>' +
      '</section>';
    main.innerHTML = html;
    const kb = TG.Keyboard.render(document.getElementById('heatKb'), lang);
    paintHeat(kb, profile, lang);
  }

  function paintHeat(kb, profile, lang) {
    kb.heatmap(k => {
      const r = profile.keys[k];
      if (!r || !r.rec.length) return null;
      const c = TG.Mastery.components(profile, k);
      const presses = r.h + r.e;
      if (heatMode === 'mastery') return { v: c.score / 100, title: k + ': ' + c.score };
      if (heatMode === 'errors') { const er = r.e / presses; return { v: 1 - Math.min(1, er * 5), title: k + ': ' + Math.round(er * 100) + '%' }; }
      return { v: c.speed, title: k + ': ' + Math.round(c.rtAvg) + ' ms' };
    });
  }

  function historyTable(profile) {
    const rows = profile.sessions.slice(-30).reverse();
    if (!rows.length) return '<p class="muted">' + t('noHistory') + '</p>';
    return '<div class="table-wrap"><table><thead><tr><th>' + t('date') + '</th><th>' + t('modeCol') + '</th><th>WPM</th><th>' + t('accuracy') +
      '</th><th>' + t('errors') + '</th><th>' + t('corrections') + '</th><th>' + t('reaction') + '</th><th>' + t('duration') + '</th></tr></thead><tbody>' +
      rows.map(s => '<tr><td>' + dateStr(s.date) + '</td><td>' + esc(t('mode.' + s.mode)) + '</td><td>' + num(s.wpm) + '</td><td>' + num(s.acc) + '%</td><td>' +
        num(s.errors) + '</td><td>' + num(s.corrections) + '</td><td>' + (U.num(s.rtAvg) ? num(s.rtAvg) + ' ms' : '—') + '</td><td>' + U.fmtTime(s.durationS) + '</td></tr>').join('') +
      '</tbody></table></div>';
  }

  /* ---------- тексты ---------- */

  function renderTexts() {
    const lang = LANG();
    const list = (arr, custom) => arr.map(x => '<li class="text-item"><div><b>' + esc(x.title) + '</b><p class="muted small">' +
      esc(x.body.slice(0, 120)) + (x.body.length > 120 ? '…' : '') + '</p><span class="muted small">' + t('chars', { n: x.body.length }) + '</span></div>' +
      '<div class="row"><button class="btn primary sm" data-action="text-type:' + esc(x.id) + '">' + t('type') + '</button>' +
      (custom ? '<button class="btn ghost sm" data-action="text-del:' + esc(x.id) + '">' + t('remove') + '</button>' : '') + '</div></li>').join('');
    const custom = TG.Texts.custom(lang);
    main.innerHTML = '<section class="texts"><h2>' + t('textsTitle') + ' · ' + t('layoutName.' + lang) + '</h2><p class="muted">' + t('textsIntro') + '</p>' +
      '<div class="card"><h3>' + t('addText') + '</h3>' +
      '<div class="form"><label>' + t('textTitle') + '<input id="ntTitle" type="text" maxlength="80"></label>' +
      '<label>' + t('textLang') + '<select id="ntLang"><option value="ru"' + (lang === 'ru' ? ' selected' : '') + '>Русский</option><option value="en"' + (lang === 'en' ? ' selected' : '') + '>English</option></select></label></div>' +
      '<label class="block">' + t('textBody') + '<textarea id="ntBody" rows="5"></textarea></label>' +
      '<button class="btn primary" data-action="text-add">' + t('add') + '</button></div>' +
      '<div class="card"><h3>' + t('myTexts') + '</h3>' + (custom.length ? '<ul class="text-list">' + list(custom, true) + '</ul>' : '<p class="muted">' + t('noCustomTexts') + '</p>') + '</div>' +
      '<div class="card"><h3>' + t('builtinTexts') + '</h3><ul class="text-list">' + list(TG.Texts.builtin(lang), false) + '</ul></div>' +
      '</section>';
  }

  /* ---------- профили ---------- */

  function avatar(u) {
    const name = TG.Store.userName(u);
    return '<i class="avatar" style="background:' + esc(u.color) + '">' + esc(name.charAt(0).toUpperCase()) + '</i>';
  }

  function renderProfiles() {
    TG.Store.refreshIndex();
    const users = TG.Store.users();
    const curId = TG.Store.index.current;
    let html = '<section class="profiles"><h2>' + (pickerMode ? t('whoIsLearning') : t('profiles')) + '</h2>' +
      '<p class="muted">' + t('profilesIntro') + '</p><div class="user-grid">';
    users.forEach(u => {
      const sum = TG.Store.userSummary(u.id);
      const isCur = u.id === curId;
      const L = sum ? TG.Curriculum.lessons(sum.lang).length : 0;
      const meta = sum && sum.sessions
        ? esc(t('profileStats', { l: Math.min(U.num(sum.lessonIndex) + 1, L) + '/' + L, s: U.num(sum.sessions), w: U.num(sum.bestWpm) || '—' })) + '<br>' +
          esc(t('lastActive', { d: dateStr(U.num(u.lastActive)) }))
        : t('noPractice');
      html += '<div class="user-card' + (isCur ? ' on' : '') + '">' +
        '<button class="user-main" data-action="user-select:' + esc(u.id) + '">' + avatar(u) +
        '<span><b>' + esc(TG.Store.userName(u)) + '</b>' + (isCur ? ' <span class="tag">' + t('activeProfile') + '</span>' : '') +
        '<small class="muted">' + meta + '</small></span></button>' +
        '<div class="row"><button class="btn link" data-action="user-rename:' + esc(u.id) + '">' + t('rename') + '</button>' +
        (users.length > 1 ? '<button class="btn link danger-text" data-action="user-delete:' + esc(u.id) + '">' + t('remove') + '</button>' : '') +
        '</div></div>';
    });
    html += '</div><div class="card"><h3>' + t('newProfile') + '</h3>' +
      '<form class="row wrap" id="newUserForm"><input id="newUserName" type="text" maxlength="40" placeholder="' + esc(t('profileNamePh')) + '" aria-label="' + esc(t('profileName')) + '">' +
      '<button class="btn primary" type="submit">' + t('create') + '</button>' +
      '<button class="btn ghost" type="button" data-action="user-import">' + t('importAsNew') + '</button></form>' +
      '<input type="file" id="userImportFile" accept=".json,application/json" hidden></div></section>';
    main.innerHTML = html;
    document.getElementById('newUserForm').addEventListener('submit', e => {
      e.preventDefault();
      const name = document.getElementById('newUserName').value.trim();
      const id = TG.Store.createUser(name);
      if (!id) { toast(t('profileCreateFail')); return; }
      switchUser(id);
      toast(t('profileCreated', { n: TG.Store.userName() }));
    });
    document.getElementById('userImportFile').addEventListener('change', e => readFile(e.target, text => {
      const parsed = TG.Store.parseFile(text);
      if (!parsed) { toast(importError()); return; }
      const add = () => {
        const id = TG.Store.importAsNewUser(text);
        if (!id) { toast(TG.Store.parseError ? importError() : t('profileCreateFail')); return; }
        toast(t('profileImported', { n: TG.Store.userName(TG.Store.user(id)) }));
        if (route === 'profiles') renderProfiles();
      };
      const dup = parsed.name && TG.Store.users().some(u => TG.Store.userName(u) === parsed.name);
      if (dup) confirmBox(t('confirmDuplicate', { n: parsed.name }), add);
      else add();
    }));
  }

  function importError() {
    const e = TG.Store.parseError;
    return e === 'newer' ? t('importNewer') : e === 'backup' ? t('importBackupFail') : t('importFail');
  }

  const MAX_FILE_BYTES = 10 * 1024 * 1024;

  /** Прочитать выбранный JSON-файл (с ограничением размера). */
  function readFile(input, onText) {
    const f = input.files[0];
    input.value = ''; // чтобы тот же файл можно было выбрать повторно
    if (!f) return;
    if (f.size > MAX_FILE_BYTES) { toast(t('fileTooBig')); return; }
    const r = new FileReader();
    r.onload = () => onText(String(r.result));
    r.onerror = () => toast(t('importFail'));
    r.readAsText(f);
  }

  /** Краткое описание файла прогресса для подтверждения. */
  function fileSummary(parsed) {
    const st = parsed.state, lang = st.settings.layoutLang;
    const L = TG.Curriculum.lessons(lang).length;
    return {
      n: parsed.name || '—',
      l: Math.min(st.profiles[lang].lessonIndex + 1, L) + '/' + L,
      s: st.profiles.ru.sessions.length + st.profiles.en.sessions.length
    };
  }

  /** Экран восстановления: показывается, если экран не удалось отрисовать. */
  function renderRecovery(err) {
    console.error('TypeGo:', err);
    if (session && session.engine) session.engine.abort();
    session = null;
    route = 'recovery';
    main.innerHTML = '<section class="card warn recovery"><h2>' + esc(t('recoveryTitle')) + '</h2><p>' + esc(t('recoveryText')) + '</p>' +
      '<div class="row wrap gap"><button class="btn primary" data-action="nav:home">' + esc(t('toHome')) + '</button>' +
      '<button class="btn ghost" data-action="export-raw">' + esc(t('exportRaw')) + '</button>' +
      '<button class="btn ghost danger-text" data-action="reset-all">' + esc(t('resetBtn')) + '</button></div></section>';
  }

  function switchUser(id) {
    if (!TG.Store.switchUser(id)) { toast(t('issue.conflict')); return; }
    pickerMode = false;
    TG.App.applyPrefs();
    go('home');
  }

  /* ---------- настройки ---------- */

  function renderSettings() {
    const st = ST();
    const sel = (key, opts, labels) => '<select data-setting="' + key + '">' + opts.map(o => '<option value="' + o + '"' + (String(st[key]) === String(o) ? ' selected' : '') + '>' + esc(labels(o)) + '</option>').join('') + '</select>';
    const chk = key => '<input type="checkbox" data-setting="' + key + '"' + (st[key] ? ' checked' : '') + '>';
    const ths = Object.keys(TG.CONFIG.THRESHOLDS);
    main.innerHTML = '<section class="settings"><h2>' + t('settingsTitle') + '</h2>' +
      '<div class="card"><h3>' + t('general') + '</h3><div class="set-list">' +
      '<label><span>' + t('uiLanguage') + '</span>' + sel('uiLang', ['ru', 'en'], o => o === 'ru' ? 'Русский' : 'English') + '</label>' +
      '<label><span>' + t('keyboardLayout') + '</span>' + sel('layoutLang', ['ru', 'en'], o => o === 'ru' ? 'Русская (ЙЦУКЕН)' : 'English (QWERTY)') + '</label>' +
      '<label><span>' + t('theme') + '</span>' + sel('theme', ['auto', 'light', 'dark'], o => t('themeOpt.' + o)) + '</label>' +
      '<label><span>' + t('dailyGoal') + '</span>' + sel('dailyMinutes', TG.CONFIG.DAILY.options, o => t('minutesShort', { n: o })) + '</label>' +
      '<label><span>' + t('fontSize') + '</span>' + sel('fontSize', ['s', 'm', 'l'], o => t('fontOpt.' + o)) + '</label>' +
      '</div></div>' +
      '<div class="card"><h3>' + t('training') + '</h3><div class="set-list">' +
      '<label><span>' + t('hintsMode') + '</span>' + sel('hintsMode', ['auto', 'always', 'never'], o => t('hintsOpt.' + o)) + '</label>' +
      '<label class="chk">' + chk('stopOnError') + '<span>' + t('stopOnError') + '</span></label>' +
      '<label class="chk">' + chk('backspace') + '<span>' + t('backspaceOpt') + '</span></label>' +
      '<label class="chk">' + chk('showKeyboard') + '<span>' + t('showKb') + '</span></label>' +
      '<label class="chk">' + chk('showFingers') + '<span>' + t('showFingersOpt') + '</span></label>' +
      '<label class="chk">' + chk('sound') + '<span>' + t('soundOpt') + '</span></label>' +
      '</div></div>' +
      '<div class="card"><div class="card-head"><h3>' + t('adaptiveTh') + '</h3><button class="btn ghost sm" data-action="reset-th">' + t('resetTh') + '</button></div><div class="th-list">' +
      ths.map(k => {
        const d = t('th.' + k);
        return '<label><span><b>' + esc(d[0]) + '</b><small>' + esc(d[1]) + '</small></span><input type="number" min="' + (k === 'stableSessions' ? 1 : 0) +
          '" max="' + (k === 'stableSessions' ? 10 : 100) + '" step="1" data-th="' + k + '" value="' + num(st.thresholds[k]) + '"></label>';
      }).join('') + '</div></div>' +
      '<div class="card"><h3>' + t('data') + ' · ' + esc(t('currentProfileData', { n: TG.Store.userName() })) + '</h3><p class="muted">' + t('dataInfo') + '</p><div class="row wrap gap">' +
      '<button class="btn primary" data-action="export">' + t('exportBtn') + '</button>' +
      '<button class="btn ghost" data-action="import">' + t('importBtn') + '</button>' +
      '<button class="btn ghost danger-text" data-action="reset-layout">' + t('resetLayoutBtn') + '</button>' +
      '<button class="btn ghost danger-text" data-action="reset-all">' + t('resetBtn') + '</button>' +
      (TG.Store.backupTime() ? '<button class="btn ghost" data-action="restore-backup">' + esc(t('restoreBackup', { d: dateStr(TG.Store.backupTime()) })) + '</button>' : '') +
      '</div>' +
      '<input type="file" id="importFile" accept=".json,application/json" hidden>' +
      '<p class="muted small">' + t('about') + '</p></div>' +
      '</section>';
    main.querySelectorAll('[data-setting]').forEach(el => el.addEventListener('change', () => {
      const k = el.dataset.setting;
      let v = el.type === 'checkbox' ? el.checked : el.value;
      if (k === 'dailyMinutes') v = +v;
      st[k] = v;
      TG.Store.save();
      if (k === 'uiLang' || k === 'theme' || k === 'layoutLang') TG.App.applyPrefs();
      toast(t('saved'));
    }));
    main.querySelectorAll('[data-th]').forEach(el => el.addEventListener('change', () => {
      const k = el.dataset.th;
      let v = Math.round(+el.value);
      if (isNaN(v)) v = TG.CONFIG.THRESHOLDS[k];
      v = k === 'stableSessions' ? U.clamp(v, 1, 10) : U.clamp(v, 0, 100);
      st.thresholds[k] = v;
      el.value = v;
      TG.Store.save();
      toast(t('saved'));
    }));
    document.getElementById('importFile').addEventListener('change', e => readFile(e.target, text => {
      const parsed = TG.Store.parseFile(text);
      if (!parsed) { toast(importError()); return; }
      const sum = fileSummary(parsed);
      confirmBox(t('confirmImport', { cur: TG.Store.userName(), n: sum.n, l: sum.l, s: sum.s }), () => {
        if (TG.Store.importText(text)) { toast(t('importOk')); TG.App.applyPrefs(); }
        else toast(importError());
      });
    }));
  }

  /* ---------- навигация и события ---------- */

  function updateNav() {
    document.querySelectorAll('[data-nav]').forEach(b => b.classList.toggle('on', b.dataset.nav === route));
    document.body.classList.toggle('in-session', route === 'session');
  }

  function go(r) {
    if (session && session.engine) session.engine.abort();
    if (session && session.free) clearInterval(session.free.timer);
    session = null;
    route = r;
    if (location.hash !== '#' + r) history.replaceState(null, '', '#' + r);
    updateNav();
    if (r !== 'profiles') pickerMode = false;
    try {
      ({ home: renderHome, train: renderTrain, stats: renderStats, texts: renderTexts, settings: renderSettings, profiles: renderProfiles }[r] || renderHome)();
    } catch (err) {
      renderRecovery(err);
    }
    window.scrollTo(0, 0);
  }

  function onAction(action, el) {
    const [cmd, arg] = [action.split(':')[0], action.split(':').slice(1).join(':')];
    switch (cmd) {
      case 'nav': go(arg); break;
      case 'start': startKind(arg); break;
      case 'lesson': startKind('lesson', +arg); break;
      case 'daily': startDaily(); break;
      case 'onboard-zero': S().onboarded = true; TG.Store.save(); startKind('lesson', 0); break;
      case 'onboard-placement': S().onboarded = true; TG.Store.save(); startKind('placement'); break;
      case 'repeat': {
        const ex = makeEx(lastResult.ex.kind, lastResult.ex.arg, lastResult.ex.mult);
        if (ex) { ex.daily = null; startSession(ex); }
        break;
      }
      case 'next': nextAfterResult(); break;
      case 'exit': go(session && session.ex && session.ex.daily ? 'home' : 'train'); break;
      case 'restart': {
        const ex = session.ex;
        const nx = makeEx(ex.kind, ex.arg, ex.mult);
        if (nx) { nx.daily = ex.daily; startSession(nx); }
        break;
      }
      case 'finish-free': finishFree(); break;
      case 'toggle-kb': {
        const st = ST();
        st.showKeyboard = !st.showKeyboard;
        TG.Store.save();
        document.getElementById('kbWrap').classList.toggle('hidden', !st.showKeyboard);
        el.textContent = st.showKeyboard ? t('hideKeyboard') : t('showKeyboard');
        focusInput();
        break;
      }
      case 'heat': heatMode = arg; renderStats(); break;
      case 'text-type': startKind('texts', arg); break;
      case 'text-del': TG.Texts.remove(arg); renderTexts(); break;
      case 'text-add': {
        const body = document.getElementById('ntBody').value;
        const added = TG.Texts.add(document.getElementById('ntTitle').value, body, document.getElementById('ntLang').value);
        if (added.error) {
          toast(added.error === 'empty' ? t('textEmpty') : added.error === 'tooLong'
            ? t('textTooLong', { n: TG.CONFIG.TEXTS.maxChars }) : t('textsFull', { n: TG.CONFIG.TEXTS.maxTotalChars }));
          break;
        }
        toast(t('textAdded'));
        renderTexts();
        break;
      }
      case 'export': TG.Store.exportFile(); toast(t('exported')); break;
      case 'import': document.getElementById('importFile').click(); break;
      case 'reset-th': ST().thresholds = Object.assign({}, TG.CONFIG.THRESHOLDS); TG.Store.save(); renderSettings(); toast(t('saved')); break;
      case 'reset-all': confirmBox(t('confirmReset'), () => { TG.Store.reset(true); TG.App.applyPrefs(); }); break;
      case 'reset-layout': confirmBox(t('confirmResetLayout', { l: t('layoutName.' + LANG()) }), () => {
        TG.Store.backupCurrent();
        S().profiles[LANG()] = TG.Store.newProfile();
        S().daily = null;
        TG.Store.saveNow();
        go('home');
      }); break;
      case 'layout-toggle': ST().layoutLang = LANG() === 'ru' ? 'en' : 'ru'; TG.Store.save(); TG.App.applyPrefs(); break;
      case 'uilang-toggle': ST().uiLang = ST().uiLang === 'ru' ? 'en' : 'ru'; TG.Store.save(); TG.App.applyPrefs(); break;
      case 'theme-toggle': {
        const cur = ST().theme;
        const dark = cur === 'dark' || (cur === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
        ST().theme = dark ? 'light' : 'dark';
        TG.Store.save();
        TG.App.applyTheme();
        break;
      }
      case 'save': TG.Store.exportFile(); toast(t('exported')); break;
      case 'reload': location.reload(); break;
      case 'export-raw': TG.Store.exportRaw(); break;
      case 'restore-backup': confirmBox(t('confirmRestore'), () => {
        if (TG.Store.restoreBackup()) { toast(t('restoreOk')); TG.App.applyPrefs(); }
        else toast(t('restoreFail'));
      }); break;
      case 'dismiss-issue': TG.App.dismissIssue(arg); break;
      case 'user-select':
        if (arg === TG.Store.index.current) { pickerMode = false; go('home'); break; }
        switchUser(arg);
        toast(t('switchedTo', { n: TG.Store.userName() }));
        break;
      case 'user-rename': {
        const u = TG.Store.user(arg);
        promptBox(t('profileName'), u.name || TG.Store.userName(u), v => {
          TG.Store.renameUser(arg, v);
          TG.App.renderHeader();
          renderProfiles();
        });
        break;
      }
      case 'user-delete': {
        const u = TG.Store.user(arg);
        confirmBox(t('confirmDeleteProfile', { n: TG.Store.userName(u) }), () => {
          const wasCur = arg === TG.Store.index.current;
          TG.Store.deleteUser(arg);
          if (wasCur) TG.App.applyPrefs();
          TG.App.renderHeader();
          go('profiles');
        });
        break;
      }
      case 'user-import': document.getElementById('userImportFile').click(); break;
    }
  }

  function onKeydown(e) {
    if (route === 'session' && session && session.engine) {
      if (e.key === 'Escape') { e.preventDefault(); onAction('exit'); return; }
      const cur = session; // сессия может завершиться внутри keydown
      try {
        cur.handled = cur.engine.keydown(e);
        if (cur.handled && cur.kb) cur.kb.press(e.code);
      } catch (err) {
        renderRecovery(err);
      }
      return;
    }
    if (route === 'session' && session && session.free) {
      if (e.key === 'Escape') { e.preventDefault(); go('train'); }
      return;
    }
    if (route === 'results' && e.key === 'Enter' && !e.target.closest('input,textarea,select,button')) {
      e.preventDefault();
      nextAfterResult();
    }
  }

  function onInput(e) {
    if (e.target.id !== 'hiddenInput' || !session || !session.engine) return;
    if (!session.handled && e.data) session.engine.inputText(e.data);
    session.handled = false;
    e.target.value = '';
  }

  TG.UI = {
    init(container) {
      main = container;
      document.addEventListener('click', e => {
        const a = e.target.closest('[data-action]');
        if (a && !a.disabled) {
          try { onAction(a.dataset.action, a); } catch (err) { renderRecovery(err); }
          return;
        }
        if (route === 'session' && session && session.engine && e.target.closest('.textbox')) focusInput();
      });
      document.addEventListener('keydown', onKeydown);
      document.addEventListener('input', onInput);
    },
    go,
    /** Показать выбор профиля (при запуске, если профилей несколько). */
    pickProfile() { pickerMode = true; go('profiles'); },
    rerender() {
      if (route === 'session' || route === 'results') go('home');
      else go(route);
    },
    route: () => route,
    renderRecovery,
    // для отладки и проверки
    _internals: { makeEx, startSession, applyResult, dailyPlan }
  };
})();
