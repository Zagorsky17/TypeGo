const fs = require('fs'), vm = require('vm'), path = require('path');
const root = process.argv[2];
const store = {};
let clock = 0;
const ctx = {
  console, Math, JSON, Date, Set, Map, Object, Array, String, Number, setTimeout: () => 0, clearTimeout(){}, setInterval: () => 0, clearInterval(){},
  navigator: { language: 'ru-RU' },
  localStorage: { getItem: k => store[k] || null, setItem: (k, v) => { store[k] = v; } },
  performance: { now: () => clock },
  document: { addEventListener(){}, documentElement: {} },
  addEventListener(){},
};
ctx.window = ctx;
vm.createContext(ctx);
const files = ['config','util','i18n','layouts','data/words-ru','data/words-en','data/texts','storage','texts','stats','mastery','curriculum','generator','engine'];
for (const f of files) vm.runInContext(fs.readFileSync(path.join(root, 'js', f + '.js'), 'utf8'), ctx, { filename: f });
const TG = ctx.TG;
TG.Store.load();

function typeText(ex, lang, errRate, speedMs) {
  let result = null;
  const eng = TG.Engine.create(ex, { lang, onChange(){}, onFinish(r, s) { result = { r, s }; } });
  let guard = 0;
  while (!result && guard++ < 5000) {
    const exp = eng.expected();
    if (exp == null) break;
    clock += speedMs * (0.7 + Math.random() * 0.6);
    const L = TG.Layout.get(lang);
    let ch = exp;
    if (Math.random() < errRate) { ch = L.letters[Math.floor(Math.random() * L.letters.length)]; }
    eng.keydown({ key: ch, code: '', preventDefault(){}, getModifierState(){ return false; } });
    if (ex.timeLimit && eng.elapsed() > ex.timeLimit) eng.finish();
  }
  if (!result) eng.finish();
  return result;
}

for (const lang of ['ru', 'en']) {
  const p = TG.Store.profile(lang);
  const st = TG.Store.settings();
  const L = TG.Curriculum.lessons(lang);
  console.log('\n=== ' + lang + ': ' + L.length + ' lessons');
  let attempts = 0;
  while (p.lessonIndex < L.length && attempts < 400) {
    attempts++;
    const idx = p.lessonIndex;
    const ex = TG.Gen.lesson(p, lang, idx, st);
    TG.Curriculum.introduce(p, ex.lesson);
    const text = TG.Gen.clean(ex.text);
    if (!text) { console.log('EMPTY TEXT', idx, ex.lesson.type); break; }
    // проверка допустимых символов
    const set = TG.Curriculum.unlocked(p, lang);
    ex.lesson.keys.forEach(k => set.add(k));
    const bad = [...new Set([...text].filter(c => !TG.Curriculum.charAllowed(c, set, lang)))];
    const res = typeText(ex, lang, 0.02, 180);
    TG.Mastery.applySession(p, res.s.events, lang);
    p.sessions.push({ date: Date.now(), mode: 'lesson', wpm: res.r.wpm, acc: res.r.acc, keystrokes: res.r.keystrokes });
    const ev = TG.Curriculum.evaluate(ex.lesson, res.r, p, lang, st.thresholds);
    if (ev.passed) TG.Curriculum.markPassed(p, idx, lang);
    if (attempts <= 200) console.log(idx, ex.lesson.type, (ex.lesson.keys||[]).join(''), '| len', text.length, '| wpm', res.r.wpm, 'acc', res.r.acc, ev.passed ? 'PASS' : 'fail ' + JSON.stringify(ev.reasons), bad.length ? 'BADCHARS:' + bad.join('') : '', '|', text.slice(0, 70));
  }
  console.log('overall mastery', TG.Mastery.overall(p, lang), 'level', p.level);
  for (const m of ['adaptive', 'weak', 'accuracy', 'speed', 'review', 'warmup']) {
    const ex = TG.Gen[m](p, lang, TG.Store.settings(), 1);
    console.log(m, '→', ex ? ex.text.slice(0, 110) : null);
  }
  const t = TG.Gen.test(p, lang, TG.Store.settings(), 60);
  console.log('test →', t.text.slice(0, 110));
  const tx = TG.Gen.text(p, lang, TG.Store.settings(), null);
  console.log('text →', tx.text.slice(0, 110));
  console.log('weakKeys', JSON.stringify(TG.Mastery.weakKeys(p, lang, 5, TG.Store.th())));
  console.log('bigrams', JSON.stringify(TG.Mastery.problemBigrams(p, lang, 4)));
  console.log('fingers', JSON.stringify(TG.Mastery.fingerStats(p, lang).map(f => [f.f, f.mastery])));
}
// placement for fresh profile
const fresh = TG.Store.newProfile();
const pl = TG.Gen.placement(fresh, 'ru');
const pr = typeText(pl, 'ru', 0.01, 120);
TG.Mastery.applySession(fresh, pr.s.events, 'ru');
console.log('\nplacement wpm', pr.r.wpm, 'acc', pr.r.acc, '→ lessonIndex', TG.Curriculum.placement(fresh, 'ru', pr.r, pr.r.perKey));
