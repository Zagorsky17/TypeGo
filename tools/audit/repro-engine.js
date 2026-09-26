// Воспроизведение H3 (другая раскладка в ОС) и M1 (автоповтор клавиши).
// Запуск из корня проекта: node tools/audit/repro-engine.js
global.window = global;
window.TG = {};
['config', 'util', 'layouts', 'data/words-ru', 'data/words-en', 'data/texts'].forEach(f => require('../../js/' + f + '.js'));
global.performance = { now: () => Date.now() };
TG.Gen = { clean: s => s };
TG.Stats = { summarize: () => ({}) };
require('../../js/engine.js');

const key = (k, code, repeat) => ({ key: k, code, repeat, shiftKey: false, preventDefault() {}, getModifierState() { return false; } });
const ru = TG.Layout.get('ru');
let fail = 0;
for (const [code, osKey] of [['Semicolon', ';'], ['Comma', ','], ['Period', '.'], ['KeyF', 'f']]) {
  const exp = ru.byCode[code].n;
  let got = null;
  const e = TG.Engine.create({ text: exp + exp, stopOnError: true }, { lang: 'ru', onChange: (s, i) => { got = i.got; } });
  e.keydown(key(osKey, code));
  e.abort();
  if (got !== exp) fail++;
  console.log('H3 ОС=EN, клавиша', code, '→ ожидали', exp, 'получили', got, got === exp ? 'OK' : 'FAIL');
}
const e2 = TG.Engine.create({ text: 'аааа', stopOnError: true }, { lang: 'ru', onChange() {} });
for (let i = 0; i < 5; i++) e2.keydown(key('о', 'KeyJ', i > 0));
e2.abort();
const errs = e2.state.events.filter(x => !x.ok).length;
if (errs > 1) fail++;
console.log('M1 удержание клавиши → ошибок:', errs, errs > 1 ? 'FAIL' : 'OK');
process.exit(fail ? 1 : 0);
