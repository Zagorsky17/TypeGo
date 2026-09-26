// Проверка исправлений этапа 2 (схема данных и восстановление): H1, H2, M7, L2.
// Запуск из корня проекта: node tools/audit/verify-schema.mjs "$(mktemp -d)" "$PWD/index.html"
import { spawn } from 'node:child_process';
const [, , PROFILE_DIR, HTML] = process.argv;
const FILE = 'file://' + HTML;
const PORT = 9338;
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
const CUR_KEY = `'typego.v1.u.' + TG.Store.index.current`;
// выбрать файл в <input type=file> и вызвать change
const pickFile = (inputId, content) => `(() => { const dt = new DataTransfer(); dt.items.add(new File([${content}], 'p.json', {type: 'application/json'}));
  const i = document.getElementById('${inputId}'); i.files = dt.files; i.dispatchEvent(new Event('change')); })()`;

const A = await tab(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await A.go(FILE);
await A.ev('localStorage.clear()'); await A.reloadRaw();

// H1: данные неожиданной формы не ломают приложение
await A.ev(`(() => { const s = JSON.parse(localStorage.getItem(${CUR_KEY}));
  s.profiles.ru.sessions = null; s.profiles.en.keys = 'x'; s.settings.fontSize = '"><img src=x onerror="window.__pwned=1">';
  s.settings.thresholds.accLow = 'abc'; s.streak = 5; s.customTexts = [{id: '"><b>', body: 'x'}, {id: 'ok-1', title: 't', body: 'текст', lang: 'ru'}];
  s.profiles.ru.bestWpm = '<img src=x onerror="window.__pwned=1">';
  localStorage.setItem(${CUR_KEY}, JSON.stringify(s)); })()`);
await A.reloadRaw();
for (const r of ['home', 'train', 'stats', 'texts', 'settings', 'profiles']) await A.ev(`TG.UI.go('${r}')`);
check('H1 все экраны открываются с повреждёнными полями', !A.errors.length && await A.ev(`TG.UI.route()`) === 'profiles', JSON.stringify(A.errors));
check('H1 sessions:null → []', await A.ev(`Array.isArray(TG.Store.profile('ru').sessions)`));
check('H1 fontSize из списка допустимых', await A.ev(`TG.Store.settings().fontSize`) === 'm');
check('H1 порог-строка заменён значением по умолчанию', await A.ev(`TG.Store.th().accLow`) === 85);
check('H1 текст с недопустимым id отброшен', await A.ev(`TG.Store.state.customTexts.map(x => x.id).join()`) === 'ok-1');
check('H1 строки в числовых полях не выполняются как код', await A.ev('window.__pwned === undefined'));

// H1: ошибка отрисовки → экран восстановления, а не пустая страница
await A.ev(`window.__orig = TG.Mastery.overall; TG.Mastery.overall = () => { throw new Error('boom'); }; TG.UI.go('home')`);
check('H1 ошибка отрисовки показывает экран восстановления', await A.ev(`!!document.querySelector('.recovery') && TG.UI.route() === 'recovery'`));
await A.ev(`TG.Mastery.overall = window.__orig; document.querySelector('.recovery [data-action="nav:home"]').click()`);
check('H1 из экрана восстановления можно вернуться', await A.ev(`TG.UI.route()`) === 'home');

// H2: импорт в текущий профиль — подтверждение, резервная копия, отмена
await A.ev('localStorage.clear()'); await A.reloadRaw();
await A.ev(`TG.Store.profile('ru').lessonIndex = 3; TG.Store.saveNow()`);
const other = await A.ev(`JSON.stringify(Object.assign({}, JSON.parse(JSON.stringify(TG.Store.state)), {profileName: 'Чужой', profiles: Object.assign({}, TG.Store.state.profiles, {ru: Object.assign({}, TG.Store.state.profiles.ru, {lessonIndex: 20})})}))`);
await A.ev(`TG.UI.go('settings')`);
await A.ev(pickFile('importFile', JSON.stringify(other)));
await sleep(300);
check('H2 импорт спрашивает подтверждение', await A.ev(`!!document.querySelector('.modal') && document.querySelector('.modal').innerText.includes('Чужой')`));
check('H2 до подтверждения данные не заменены', await A.ev(`TG.Store.profile('ru').lessonIndex`) === 3);
await A.ev(`document.querySelector('.modal [data-m=no]').click()`);
check('H2 отмена оставляет данные', await A.ev(`TG.Store.profile('ru').lessonIndex`) === 3);
await A.ev(pickFile('importFile', JSON.stringify(other))); await sleep(300);
await A.ev(`document.querySelector('.modal [data-m=yes]').click()`); await sleep(200);
check('H2 после подтверждения данные заменены', await A.ev(`TG.Store.profile('ru').lessonIndex`) === 20);
check('H2 резервная копия создана', await A.ev(`TG.Store.backupTime() > 0`));
await A.ev(`TG.UI.go('settings')`);
await A.ev(`document.querySelector('[data-action="restore-backup"]').click()`);
await A.ev(`document.querySelector('.modal [data-m=yes]').click()`); await sleep(200);
check('H2 «Вернуть данные» восстанавливает прежний прогресс', await A.ev(`TG.Store.profile('ru').lessonIndex`) === 3);
check('H2 восстановленные данные записаны', await A.ev(`JSON.parse(localStorage.getItem(${CUR_KEY})).profiles.ru.lessonIndex`) === 3);

// M7: слишком большой файл отклоняется
await A.ev(`TG.UI.go('settings')`);
await A.ev(pickFile('importFile', `'x'.repeat(11 * 1024 * 1024)`)); await sleep(500);
check('M7 файл больше 10 МБ отклонён без подтверждения', await A.ev(`!document.querySelector('.modal') && [...document.querySelectorAll('.toast')].some(t => t.innerText.includes('10'))`));

// L2: повторный импорт профиля с тем же именем — предупреждение
await A.ev(`TG.Store.renameUser(TG.Store.index.current, 'Чужой'); TG.UI.go('profiles')`);
await A.ev(pickFile('userImportFile', JSON.stringify(other))); await sleep(300);
check('L2 дубль имени профиля требует подтверждения', await A.ev(`!!document.querySelector('.modal') && TG.Store.users().length === 1`));
await A.ev(`document.querySelector('.modal [data-m=yes]').click()`); await sleep(200);
check('L2 после подтверждения профиль добавлен', await A.ev(`TG.Store.users().length`) === 2);

check('Нет необработанных исключений', !A.errors.length, JSON.stringify(A.errors));
chrome.kill();
console.log(failed ? `\n${failed} FAIL` : '\nВСЁ PASS');
process.exit(failed ? 1 : 0);
