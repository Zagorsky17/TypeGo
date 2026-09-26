// Проверка исправлений этапа 3 (XSS и CSP): C1.
// Запуск из корня проекта: node tools/audit/verify-xss.mjs "$(mktemp -d)" "$PWD/index.html"
import { spawn } from 'node:child_process';
const [, , PROFILE_DIR, HTML] = process.argv;
const FILE = 'file://' + HTML;
const PORT = 9339;
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
  let id = 0; const pending = {}; const errors = []; const csp = [];
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id && pending[d.id]) { pending[d.id](d); delete pending[d.id]; }
    if (d.method === 'Log.entryAdded' && /Content Security Policy/i.test(d.params.entry.text)) csp.push(d.params.entry.text.slice(0, 160));
    if (d.method === 'Runtime.consoleAPICalled' && /Content Security Policy/i.test(JSON.stringify(d.params.args))) csp.push('console: ' + JSON.stringify(d.params.args).slice(0, 160));
    if (d.method === 'Runtime.exceptionThrown') errors.push((d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text).split('\n')[0]);
  };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    return r.result.exceptionDetails ? 'ERR ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0] : r.result.result.value;
  };
  await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable');
  return {
    ev, errors, csp,
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

// CSP установлена и не мешает приложению
check('CSP задана в документе', await A.ev(`!!document.querySelector('meta[http-equiv="Content-Security-Policy"]')`));
for (const r of ['home', 'train', 'stats', 'texts', 'settings', 'profiles']) await A.ev(`TG.UI.go('${r}')`);
await A.ev(`TG.UI.go('train'); document.querySelector('[data-action="lesson:0"]').click()`);
check('Приложение работает под CSP (экраны и урок)', await A.ev(`TG.UI.route() === 'session' && document.querySelectorAll('.key').length > 40`));
await A.ev(`TG.UI.go('home'); TG.Store.exportFile()`); await sleep(300);
check('Под CSP нет нарушений при обычной работе и выгрузке файла', A.csp.length === 0, JSON.stringify(A.csp));

// CSP блокирует встроенные обработчики (второй уровень защиты)
await A.ev(`document.body.insertAdjacentHTML('beforeend', '<img id="probe" src="x" onerror="window.__inline=1">')`); await sleep(300);
check('CSP блокирует встроенный onerror', await A.ev('window.__inline === undefined'));
A.csp.length = 0;
await A.ev(`document.getElementById('probe').remove()`);

// Экранирование: строки-ловушки в каждом поле, минуя sanitize (как будто проверку схемы обошли)
const P = `<img src=x class=pwn onerror=window.__pwned=1>`;
const ATTR = `"><img src=x class=pwn onerror=window.__pwned=1>`;
await A.ev(`(() => {
  const P = ${JSON.stringify(P)}, ATTR = ${JSON.stringify(ATTR)};
  const st = TG.Store.state, p = TG.Store.profile();
  TG.Store.saveNow = () => true; // ничего не записываем
  p.bestWpm = P; st.streak.best = P; st.streak.current = P; st.streak.lastDay = TG.Util.today();
  p.sessions = [{date: Date.now(), mode: P, wpm: P, cpm: P, acc: P, errors: P, corrections: P, rtAvg: P, stability: P, durationS: 60, keystrokes: 100}];
  p.lessonsDone[TG.Curriculum.lessons(TG.Store.settings().layoutLang)[0].id] = {date: 1, best: P};
  p.lessonIndex = 3;
  const k = TG.Curriculum.lessons(TG.Store.settings().layoutLang)[1].keys;
  p.keys[k[0]] = {h: ATTR, e: 1, rec: [[1, 300], [0, 0], [1, 280], [1, 250], [1, 260]], last: Date.now(), ease: 2.3, ivl: 1, reps: 1, due: 0};
  p.bigrams[k[0] + k[1]] = {n: 50, e: 20, rt: P};
  p.trigrams[k[0] + k[1] + k[0]] = {n: 10, e: 5};
  p.trigrams[k[1] + k[0] + k[1]] = {n: P, e: P};
  p.confusions[k[0] + '>' + k[1]] = P;
  st.daily = {date: TG.Util.today(), lang: TG.Store.settings().layoutLang, minutes: TG.Store.settings().dailyMinutes, steps: [{type: 'warmup', min: P, done: false}]};
  st.customTexts = [{id: ATTR, title: 't', body: 'текст', lang: TG.Store.settings().layoutLang, added: 1}];
  st.settings.thresholds.accLow = ATTR;
  st.settings.fontSize = ATTR;
  TG.Store.index.users[0].name = P;
  TG.Store.index.users[0].color = 'red;background:url(x)';
})()`);
for (const r of ['home', 'train', 'stats', 'texts', 'settings', 'profiles']) {
  await A.ev(`TG.UI.go('${r}')`);
  const n = await A.ev(`document.querySelectorAll('img.pwn').length`);
  check('Экранирование: экран ' + r + ' без внедрённых элементов', n === 0, n);
}
await A.ev(`TG.UI.go('train'); document.querySelector('[data-action="lesson:0"]').click()`);
check('Экранирование: экран урока без внедрённых элементов', await A.ev(`document.querySelectorAll('img.pwn').length`) === 0);
check('Ни один внедрённый код не выполнился', await A.ev('window.__pwned === undefined'));

// Цвет профиля из хранилища нормализуется
await A.ev(`localStorage.clear()`); await A.reloadRaw();
await A.ev(`(() => { const i = JSON.parse(localStorage.getItem('typego.v1.users')); i.users[0].color = 'red;background:url(x)'; i.users[0].name = 5; localStorage.setItem('typego.v1.users', JSON.stringify(i)); })()`);
await A.reloadRaw();
check('Цвет профиля нормализован', /^#[0-9a-f]{6}$/i.test(await A.ev(`TG.Store.user().color`)), await A.ev(`TG.Store.user().color`));

check('Нет необработанных исключений', !A.errors.length, JSON.stringify(A.errors));
chrome.kill();
console.log(failed ? `\n${failed} FAIL` : '\nВСЁ PASS');
process.exit(failed ? 1 : 0);
