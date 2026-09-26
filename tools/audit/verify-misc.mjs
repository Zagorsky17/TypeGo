// Проверка исправлений этапа 6: M3, M4, M5, M10, L6, L8, L9.
// Запуск из корня проекта: node tools/audit/verify-misc.mjs "$(mktemp -d)" "$PWD/index.html"
import { spawn } from 'node:child_process';
const [, , PROFILE_DIR, HTML] = process.argv;
const FILE = 'file://' + HTML;
const PORT = 9341;
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE_DIR, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));

let targets;
for (let i = 0; i < 50; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (targets.length) break; } catch {}
  await sleep(200);
}

async function tab(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise(r => { ws.onopen = r; });
  let id = 0; const pending = {}; const errors = [];
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id && pending[d.id]) { pending[d.id](d); delete pending[d.id]; }
    if (d.method === 'Runtime.exceptionThrown') errors.push((d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text).split('\n')[0]);
  };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    return r.result.exceptionDetails ? 'ERR ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0] : r.result.result.value;
  };
  await send('Runtime.enable'); await send('Page.enable');
  return {
    ev, errors,
    go: async u => { await send('Page.navigate', { url: u }); await sleep(900); },
    // перезагрузка без сохранения старой страницей (чтобы проверять именно то, что лежит в хранилище)
    reloadRaw: async () => { await ev('TG.Store.saveNow = () => false'); await send('Page.reload'); await sleep(900); },
    reload: async () => { await send('Page.reload'); await sleep(900); }
  };
}

let failed = 0;
const check = (name, ok, detail) => { if (!ok) failed++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? '  → ' + detail : '')); };
const A = await tab(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await A.go(FILE);
await A.ev('localStorage.clear()'); await A.reloadRaw();
await A.ev(`TG.Store.settings().layoutLang = 'ru'; TG.Store.settings().uiLang = 'ru'; TG.App.applyPrefs()`);

// M3: свой текст с эмодзи, диакритикой и «ё» в разложенной форме
await A.ev(`TG.UI.go('texts')`);
await A.ev(`document.getElementById('ntTitle').value = 'Эмодзи'; document.getElementById('ntLang').value = 'ru';
  document.getElementById('ntBody').value = 'Привет 😀 мир — «ёлка» и кафе́'; document.querySelector('[data-action="text-add"]').click()`);
await sleep(200);
const body = await A.ev(`TG.Store.state.customTexts[0] && TG.Store.state.customTexts[0].body`);
check('M3 эмодзи и лишняя диакритика убраны, «ё» склеена', body === 'Привет мир - "ёлка" и кафе', body);
check('M3 пользователь узнал, сколько символов изменено', await A.ev(`[...document.querySelectorAll('.toast')].some(t => /заменено или удалено: [0-9]/.test(t.innerText))`));
await A.ev(`document.getElementById('ntLang').value = 'en'; document.getElementById('ntBody').value = 'Это русский текст целиком'; document.querySelector('[data-action="text-add"]').click()`);
check('M3 текст на другом языке не принимается', await A.ev(`TG.Store.state.customTexts.length`) === 1);
// текст из «чужого» файла с эмодзи набирается без непечатаемых символов
await A.ev(`TG.Store.state.customTexts.push({id: 'imp-1', title: 'i', body: 'Слово 🙂 слово', lang: 'ru', added: 1})`);
const ex = await A.ev(`TG.UI._internals.makeEx('texts', 'imp-1', 1).text`);
check('M3 текст из импорта очищается перед набором', ex === 'Слово слово', ex);

// M4: ввод через композицию (экранные клавиатуры Android)
await A.ev(`TG.Store.profile().lessonIndex = 6; TG.UI.go('train'); document.querySelector('[data-action="lesson:1"]').click()`);
const expected = await A.ev(`TG.UI.route() === 'session' ? [...document.querySelectorAll('#textInner span')].slice(0, 6).map(s => s.textContent).join('') : ''`);
const pos = () => A.ev(`document.querySelectorAll('#textInner .done').length`);
const comp = async (steps, finalData, extraAfter) => A.ev(`(() => {
  const i = document.getElementById('hiddenInput');
  i.dispatchEvent(new CompositionEvent('compositionstart', {bubbles: true, data: ''}));
  for (const d of ${JSON.stringify(steps)}) { i.value = d; i.dispatchEvent(new InputEvent('input', {bubbles: true, data: d, isComposing: true, inputType: 'insertCompositionText'})); }
  i.dispatchEvent(new CompositionEvent('compositionend', {bubbles: true, data: ${JSON.stringify(finalData)}}));
  ${extraAfter ? `i.dispatchEvent(new InputEvent('input', {bubbles: true, data: ${JSON.stringify(finalData)}, isComposing: false, inputType: 'insertCompositionText'}));` : ''}
})()`);
const w1 = expected.slice(0, 3);
await comp([w1[0], w1.slice(0, 2), w1], w1, false);
check('M4 композиция (Chrome): каждый символ введён один раз', await pos() === 3, await pos() + ' из 3');
const w2 = expected.slice(3, 5);
await comp([w2[0], w2], w2, true);
check('M4 композиция с повторным итоговым словом (Safari/Firefox): без дублей', await pos() === 5, await pos() + ' из 5');
await comp(['ъ', 'ъъ'], 'ы', false); // автозамена переписала слово — лишнего не вводим
check('M4 автозамена внутри композиции не добавляет символов', await pos() === 5 || await pos() === 6, await pos());
check('M4 поле ввода 16px (без масштабирования на iOS)', await A.ev(`getComputedStyle(document.getElementById('hiddenInput')).fontSize`) === '16px');
await A.ev(`TG.UI.go('home')`);
await sleep(100);
if (await A.ev(`!!document.querySelector('.modal')`)) await A.ev(`document.querySelector('.modal [data-m=yes]').click()`);

// M5: автоопределение Mac «Русская» по нажатию в уроке
await A.ev(`TG.Store.settings().ruVariant = 'auto'; TG.Store.settings().ruVariantDetected = 'pc'; TG.App.applyPrefs(); TG.UI.go('train')`);
await A.ev(`document.querySelector('[data-action="lesson:1"]').click()`);
const ch = await A.ev(`document.querySelector('.cur').textContent`);
await A.ev(`document.dispatchEvent(new KeyboardEvent('keydown', {key: ${JSON.stringify(ch)}, code: 'KeyF', bubbles: true}))`);
await A.ev(`document.dispatchEvent(new KeyboardEvent('keydown', {key: '.', code: 'Digit7', shiftKey: true, bubbles: true}))`);
check('M5 в уроке определена раскладка Mac «Русская»', await A.ev(`TG.Store.settings().ruVariantDetected`) === 'mac');
check('M5 пользователю показано сообщение', await A.ev(`!document.getElementById('notice').hidden && document.getElementById('notice').innerText.includes('Mac')`));
check('M5 клавиатура показывает Mac-раскладку («Ё» на клавише \\)', await A.ev(`document.querySelector('.key[data-code="Backslash"] .k-n').textContent`) === 'Ё');
check('M5 в Настройках вариант можно выбрать вручную', await A.ev(`TG.UI.go('settings'), !!document.querySelector('[data-setting="ruVariant"]')`));

// L9: серия неверных нажатий на одной позиции = одна ошибка в освоении
const l9 = await A.ev(`(() => { const p = TG.Store.profile('ru'); delete p.keys['ф'];
  TG.Mastery.applySession(p, [{exp: 'ф', got: 'ы', ok: false, rt: 200, retry: false}, {exp: 'ф', got: 'ы', ok: false, rt: 90, retry: true},
    {exp: 'ф', got: 'в', ok: false, rt: 90, retry: true}, {exp: 'ф', got: 'ф', ok: true, rt: 300, retry: true}], 'ru');
  return p.keys['ф'].e; })()`);
check('L9 серия ошибок на позиции = одна ошибка', l9 === 1, l9);

// M10, L8: пояснения и напоминание о резервной копии
check('M10 в Настройках объяснено, где хранятся данные', await A.ev(`TG.UI.go('settings'), document.querySelector('.settings').innerText.includes('инкогнито')`));
check('L8 на экране профилей предупреждение о приватности', await A.ev(`TG.UI.go('profiles'), document.querySelector('.profiles').innerText.includes('паролем')`));
await A.ev(`(() => { const p = TG.Store.profile('ru'); for (let i = 0; i < 6; i++) p.sessions.push({date: Date.now(), mode: 'adaptive', wpm: 20, cpm: 100, acc: 95, errors: 1, corrections: 0, rtAvg: 300, stability: 80, durationS: 60, keystrokes: 100}); TG.Store.state.lastExport = 0; })()`);
check('M10 напоминание о резервной копии показывается', await A.ev(`TG.UI.go('home'), [...document.querySelectorAll('.note')].some(n => n.innerText.includes('файл') && n.querySelector('[data-action="save"]'))`));
await A.ev(`TG.Store.exportFile()`); await sleep(200);
check('M10 после сохранения в файл напоминание исчезает', await A.ev(`TG.UI.go('home'), ![...document.querySelectorAll('.note')].some(n => n.querySelector('[data-action="save"]'))`));

check('Нет необработанных исключений', !A.errors.length, JSON.stringify(A.errors));
chrome.kill();
console.log(failed ? `\n${failed} FAIL` : '\nВСЁ PASS');
process.exit(failed ? 1 : 0);
