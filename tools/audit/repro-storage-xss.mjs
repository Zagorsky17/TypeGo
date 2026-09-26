import { spawn } from 'node:child_process';
const SP = process.argv[2], FILE = 'file://' + process.argv[3];
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ['--headless=new', '--remote-debugging-port=9335', '--user-data-dir=' + SP + '/chrome-audit', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50; i++) { try { targets = await (await fetch('http://127.0.0.1:9335/json')).json(); if (targets.length) break; } catch {} await sleep(200); }
async function tab(wsUrl) {
  const ws = new WebSocket(wsUrl); await new Promise(r => ws.onopen = r);
  let id = 0; const pending = {}; const errs = [];
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pending[d.id]) { pending[d.id](d); delete pending[d.id]; }
    if (d.method === 'Runtime.exceptionThrown') errs.push((d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text).split('\n')[0]); };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return r.result.exceptionDetails ? 'ERR ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0] : r.result.result.value; };
  await send('Runtime.enable'); await send('Page.enable');
  return { send, ev, errs, go: async u => { await send('Page.navigate', { url: u }); await sleep(900); }, reload: async () => { await send('Page.reload'); await sleep(900); } };
}
const A = await tab(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await A.go(FILE);
await A.ev('localStorage.clear(); TG.Store.saveNow=()=>{}'); await A.reload();

// 1. XSS через импорт файла прогресса
const evil = await A.ev(`(()=>{const s=JSON.parse(JSON.stringify(TG.Store.state)); s.profiles[s.settings.layoutLang].sessions=[{date:Date.now(),mode:'test60',wpm:'<img src=x onerror="window.__pwned=(window.__pwned||0)+1">',acc:90,errors:0,corrections:0,durationS:60,keystrokes:100}]; return JSON.stringify(s)})()`);
await A.ev(`TG.Store.importText(${JSON.stringify(evil)}); TG.UI.go('stats')`); await sleep(400);
console.log('1 XSS via imported file (stats history):', await A.ev('window.__pwned||0'));
await A.ev('TG.Store.saveNow()'); await A.reload(); await A.ev(`TG.UI.go('stats')`); await sleep(400);
console.log('1b persists after reload:', await A.ev('window.__pwned||0'));

// 2. Повреждённые данные «окирпичивают» приложение
await A.ev(`(()=>{const s=JSON.parse(JSON.stringify(TG.Store.state)); s.profiles.ru.sessions=null; s.profiles.en.sessions=null; localStorage.setItem('typego.v1.u.'+TG.Store.index.current, JSON.stringify(s)); TG.Store.saveNow=()=>{}; })()`);
A.errs.length = 0; await A.reload();
console.log('2 corrupted sessions=null → errors on load:', JSON.stringify(A.errs), '| main empty:', await A.ev(`document.getElementById('main').innerHTML.length`));

// 3. Повреждённый JSON индекса → профили «пропадают», старые данные осиротевают
await A.ev('localStorage.clear()'); await A.reload();
await A.ev(`TG.Store.createUser('Маша'); TG.Store.createUser('Петя'); TG.Store.saveNow()`);
console.log('3 before: users', await A.ev('TG.Store.users().length'), 'keys', await A.ev('Object.keys(localStorage).length'));
await A.ev(`localStorage.setItem('typego.v1.users', '{"current":'); TG.Store.saveNow=()=>{}`); await A.reload();
console.log('3 after corrupt index: users', await A.ev('TG.Store.users().length'), '| keys in storage', await A.ev('Object.keys(localStorage).length'));

// 4. Две вкладки: вторая создаёт профиль, первая при сохранении его теряет
await A.ev('localStorage.clear()'); await A.reload();
const t2 = await (await fetch('http://127.0.0.1:9335/json/new?about:blank', { method: 'PUT' })).json();
const B = await tab(t2.webSocketDebuggerUrl); await B.go(FILE);
await B.ev(`TG.Store.createUser('Маша'); TG.Store.saveNow()`);
console.log('4 tab B created profile; stored users:', await B.ev(`JSON.parse(localStorage.getItem('typego.v1.users')).users.length`));
await A.ev(`TG.Store.profile().bestWpm = 42; TG.Store.saveNow()`);   // вкладка A сохраняет (например, закончила урок)
console.log('4 after tab A save; stored users:', await A.ev(`JSON.parse(localStorage.getItem('typego.v1.users')).users.length`), '| orphan keys:', await A.ev(`Object.keys(localStorage).filter(k=>k.startsWith('typego.v1.u.')).length`));
// та же вкладка-профиль в двух вкладках: последняя запись побеждает
await B.ev(`TG.Store.switchUser(TG.Store.users()[0].id)`);
await A.ev(`TG.Store.profile().lessonIndex = 7; TG.Store.saveNow()`);
await B.ev(`TG.Store.profile().bestWpm = 1; TG.Store.saveNow()`);
console.log('4b same profile in 2 tabs, lessonIndex stored:', await A.ev(`JSON.parse(localStorage.getItem('typego.v1.u.'+TG.Store.index.current)).profiles[TG.Store.settings().layoutLang].lessonIndex`), '(A set 7)');

// 5. Огромный свой текст → квота → сохранение прогресса перестаёт работать
await A.ev('localStorage.clear()'); await A.reload();
await A.ev(`TG.Texts.add('big', 'слово '.repeat(1100000), 'ru')`);
await A.ev(`TG.Store.profile().bestWpm = 55; TG.Store.saveNow()`);
console.log('5 after 6.6MB text: storageOk', await A.ev('TG.Store.storageOk'), '| bestWpm stored:', await A.ev(`(JSON.parse(localStorage.getItem('typego.v1.u.'+TG.Store.index.current))||{profiles:{ru:{}}}).profiles.ru.bestWpm`));

// 6. Импорт в текущий профиль без подтверждения / удержание клавиши
console.log('6 import handler has confirm:', await A.ev(`/confirm/i.test(TG.Store.importText.toString())`));
chrome.kill(); process.exit(0);
