// Проверка движка ввода (этап 4): H3 (раскладка ОС отличается от урока), M1 (автоповтор),
// M2 (нажатия после окончания теста), L3 (AltGr на Windows).
// Запуск из корня проекта: node tools/audit/repro-engine.js   (код выхода 1 при провале)
global.window = global;
window.TG = {};
['config', 'util', 'layouts', 'data/words-ru', 'data/words-en', 'data/texts'].forEach(f => require('../../js/' + f + '.js'));
let clock = 1000;
global.performance = { now: () => clock };
global.setInterval = () => 0;      // таймер движка не нужен: время двигаем вручную
global.clearInterval = () => {};
TG.Gen = { clean: s => s };
TG.Stats = { summarize: () => ({}) };
require('../../js/engine.js');

let failed = 0;
const check = (name, ok, detail) => { if (!ok) failed++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? '  → ' + detail : '')); };
const ev = (key, code, o) => Object.assign({ key, code, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, repeat: false,
  preventDefault() {}, getModifierState(m) { return m === 'AltGraph' && !!(o && o.altGraph); } }, o || {});

/** Набрать текст урока `lang`, нажимая физические клавиши, а символы брать из раскладки ОС `osLang`. */
function typeWithOs(lang, osLang, text) {
  const target = TG.Layout.get(lang), os = TG.Layout.get(osLang);
  const e = TG.Engine.create({ text, stopOnError: true }, { lang, onChange() {} });
  const wrong = [];
  for (const ch of text) {
    const info = target.byChar[ch];
    const osChar = info.code === 'Space' ? ' ' : (info.shift ? os.byCode[info.code].s : os.byCode[info.code].n);
    clock += 100;
    const before = e.state.events.length;
    e.keydown(ev(osChar, info.code, { shiftKey: info.shift }));
    const last = e.state.events[before];
    if (!last || !last.ok) wrong.push(ch + '(' + osChar + ')');
  }
  e.abort();
  return wrong;
}

// H3: все клавиши раскладки, включая знаки, когда в ОС другая раскладка
const ruAll = TG.Layout.get('ru').letters + ' .,';
const enAll = TG.Layout.get('en').letters + " ;',./[]";
let w = typeWithOs('ru', 'en', 'фыва ' + ruAll);
check('H3 урок RU, в ОС EN: все буквы и знаки засчитаны', !w.length, w.join(' '));
w = typeWithOs('en', 'ru', 'asdf ' + enAll);
check('H3 урок EN, в ОС RU: все буквы и знаки засчитаны', !w.length, w.join(' '));
// раскладка ОС распознаётся даже если урок начинается со знака (не с буквы)
w = typeWithOs('ru', 'en', 'ж.б,ю фыва');
check('H3 урок RU начинается со знаков, в ОС EN', !w.length, w.join(' '));
// обычный случай — раскладки совпадают — не сломан
w = typeWithOs('ru', 'ru', 'фыва ' + ruAll + ' Ж! "№;%:?*()');
check('H3 урок RU, в ОС RU (без сопоставления)', !w.length, w.join(' '));
w = typeWithOs('en', 'en', 'asdf ' + enAll + ' A!@#$%^&*()_+{}:"<>?');
check('H3 урок EN, в ОС EN (без сопоставления)', !w.length, w.join(' '));
// неверная клавиша по-прежнему ошибка
{
  const e = TG.Engine.create({ text: 'аа', stopOnError: true }, { lang: 'ru', onChange() {} });
  e.keydown(ev('j', 'KeyJ'));   // в ОС EN, физическая J = «о», ожидали «а»
  check('H3 неверная физическая клавиша остаётся ошибкой', e.state.events[0] && e.state.events[0].ok === false);
  e.abort();
}

// M1: автоповтор при удержании клавиши не засчитывается
{
  const e = TG.Engine.create({ text: 'аааа', stopOnError: true }, { lang: 'ru', onChange() {} });
  for (let i = 0; i < 5; i++) { clock += 30; e.keydown(ev('о', 'KeyJ', { repeat: i > 0 })); }
  const errs = e.state.events.filter(x => !x.ok).length;
  check('M1 удержание клавиши = одно нажатие', errs === 1, errs);
  e.abort();
}

// M2: нажатия после окончания теста не засчитываются
{
  let res = null;
  const e = TG.Engine.create({ text: 'а'.repeat(500), stopOnError: false, timeLimit: 60 }, { lang: 'ru', onChange() {}, onFinish(r, s) { res = s; } });
  clock = 10000;
  e.keydown(ev('а', 'KeyF'));
  clock += 59000; e.keydown(ev('а', 'KeyF'));
  clock += 2000;  e.keydown(ev('а', 'KeyF'));   // через 61 с после начала — тест уже закончился
  check('M2 тест завершён по времени при следующем нажатии', !!res);
  check('M2 нажатие после конца теста не засчитано', res && res.events.length === 2, res && res.events.length);
  check('M2 время окончания = начало + лимит', res && res.endT === 10000 + 60000, res && res.endT);
}

// L3: AltGr (на Windows приходит как Ctrl+Alt) не отсекается
{
  const e = TG.Engine.create({ text: '@@', stopOnError: true }, { lang: 'en', onChange() {} });
  e.keydown(ev('@', 'Digit2', { ctrlKey: true, altKey: true, altGraph: true }));
  check('L3 символ через AltGr принят', e.state.events.length === 1 && e.state.events[0].ok);
  const e2 = TG.Engine.create({ text: 'aa', stopOnError: true }, { lang: 'en', onChange() {} });
  e2.keydown(ev('a', 'KeyA', { ctrlKey: true }));
  check('L3 сочетания с Ctrl по-прежнему не считаются вводом', e2.state.events.length === 0);
  e.abort(); e2.abort();
}

console.log(failed ? `\n${failed} FAIL` : '\nВСЁ PASS');
process.exit(failed ? 1 : 0);
