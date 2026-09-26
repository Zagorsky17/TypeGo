// Проверка движка ввода: H3 (раскладка ОС отличается от урока), M1 (автоповтор),
// M2 (нажатия после окончания теста), L3 (AltGr на Windows), M5 (Mac «Русская»).
// Запуск из корня проекта: node tools/audit/repro-engine.js   (код выхода 1 при провале)
global.window = global;
window.TG = {};
['config', 'util', 'layouts', 'data/words-ru', 'data/words-en', 'data/texts', 'curriculum'].forEach(f => require('../../js/' + f + '.js'));
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
function typeWithOs(lang, osLang, text, osVariant, onVariant) {
  const target = TG.Layout.get(lang), os = TG.Layout.get(osLang, osVariant);
  const e = TG.Engine.create({ text, stopOnError: true }, { lang, onChange() {}, onVariant });
  const wrong = [];
  for (const ch of text) {
    // язык ОС совпадает с уроком — человек жмёт знак там, где он стоит в его системе;
    // иначе — физическую клавишу раскладки урока
    const info = (osLang === lang ? os : target).byChar[ch];
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

// L5: счётчики верных символов при исправлениях совпадают с полным пересчётом
{
  const e = TG.Engine.create({ text: 'абвгд', stopOnError: false, backspace: true }, { lang: 'ru', onChange() {} });
  const seq = [['а', 'KeyF'], ['х', 'BracketLeft'], ['Backspace', 'Backspace'], ['б', 'Comma'], ['в', 'KeyD'], ['Backspace', 'Backspace'], ['Backspace', 'Backspace'], ['б', 'Comma'], ['в', 'KeyD'], ['г', 'KeyU']];
  for (const [k, c] of seq) { clock += 100; e.keydown(ev(k, c)); }
  const s = e.state;
  let full = 0; for (let i = 0; i < s.pos; i++) if (s.typed[i] === s.text[i]) full++;
  check('L5 верные символы: счётчик = пересчёт', e.correctChars() === full && full === 4, e.correctChars() + ' / ' + full);
  check('L5 верные нажатия: счётчик = пересчёт', s.okCount === s.events.filter(x => x.ok).length, s.okCount);
  e.abort();
}

// M5: Mac «Русская»
{
  TG.Layout.setVariant('ru', 'pc');
  let got = null;
  // в ОС Mac «Русская»: буква, затем точка через Shift+7 — это сигнал варианта mac
  const w5 = typeWithOs('ru', 'ru', 'фыва. ,', 'mac', v => { got = v; TG.Layout.setVariant('ru', v); });
  check('M5 Mac «Русская» определена по нажатию знака', got === 'mac', got);
  check('M5 знаки на Mac-позициях засчитаны', !w5.length, w5.join(' '));
  const all = TG.Layout.get('ru').letters + ' .,!"№%:;()-/?';
  let w = typeWithOs('ru', 'ru', 'фыва ' + all, 'mac');
  check('M5 вариант mac: все буквы и знаки при ОС Mac «Русская»', !w.length, w.join(' '));
  w = typeWithOs('ru', 'en', 'фыва ' + TG.Layout.get('ru').letters + ' .,', 'pc');
  check('M5 вариант mac: урок RU при ОС EN (по физическим клавишам Mac)', !w.length, w.join(' '));
  check('M5 вариант mac: в уроке спецсимволов нет «*»', TG.Curriculum.lessons('ru').filter(l => l.variant === 'symbols')[0].keys.indexOf('*') < 0);
  let got2 = null;
  typeWithOs('ru', 'ru', 'фыва. ,', 'pc', v => { got2 = v; TG.Layout.setVariant('ru', v); });
  check('M5 обратно определяется ПК-вариант', got2 === 'pc', got2);
  TG.Layout.setVariant('ru', 'pc');
  check('M5 вариант pc: «*» в уроке спецсимволов есть', TG.Curriculum.lessons('ru').filter(l => l.variant === 'symbols')[0].keys.indexOf('*') >= 0);
  let got3 = null;
  typeWithOs('ru', 'en', 'фыва ./', 'pc', v => { got3 = v; });
  check('M5 при ОС EN вариант не «определяется» ошибочно', got3 === null, got3);
}

console.log(failed ? `\n${failed} FAIL` : '\nВСЁ PASS');
process.exit(failed ? 1 : 0);
