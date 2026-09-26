import { spawn } from 'node:child_process';
import fs from 'node:fs';
const SP = process.argv[2], FILE = process.argv[3];
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ['--headless=new', '--remote-debugging-port=9334', '--user-data-dir=' + SP + '/chrome-prof2', '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50; i++) { try { targets = await (await fetch('http://127.0.0.1:9334/json')).json(); if (targets.length) break; } catch {} await sleep(200); }
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pending = {}; const logs = [];
ws.onmessage = m => { const d = JSON.parse(m.data);
  if (d.id && pending[d.id]) { pending[d.id](d); delete pending[d.id]; }
  if (d.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION: ' + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text));
  if (d.method === 'Runtime.consoleAPICalled' && d.params.type !== 'log') logs.push(d.params.type + ': ' + d.params.args.map(a => a.value ?? a.description).join(' '));
};
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result.exceptionDetails ? 'ERR ' + r.result.exceptionDetails.exception?.description : r.result.result.value; };
const shot = async name => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(SP + '/' + name + '.png', Buffer.from(r.result.data, 'base64')); };
const reload = async () => { await ev('TG.Store.saveNow(); location.reload()'); await sleep(900); };
await send('Runtime.enable'); await send('Page.enable');
await send('Page.navigate', { url: 'file://' + FILE }); await sleep(1000);

// 1. Старые данные без профилей → перенос в первый профиль
await ev(`(()=>{TG.Store.saveNow=()=>{}; const st=JSON.parse(JSON.stringify(TG.Store.state)); st.profiles.ru.lessonIndex=5; st.profiles.ru.bestWpm=33; st.settings.uiLang='ru'; localStorage.clear(); localStorage.setItem('typego.v1', JSON.stringify(st)); })()`);
await send('Page.reload'); await sleep(900);
console.log('1 migrate:', await ev(`JSON.stringify({users:TG.Store.users().length, li:TG.Store.profile('ru').lessonIndex, legacyKey: localStorage.getItem('typego.v1')===null, route:TG.UI.route(), name:TG.Store.userName()})`));

// 2. Создать второй профиль через форму
await ev(`TG.UI.go('profiles')`); await sleep(200);
await ev(`document.getElementById('newUserName').value='Маша'; document.getElementById('newUserForm').requestSubmit()`); await sleep(300);
console.log('2 create:', await ev(`JSON.stringify({users:TG.Store.users().length, cur:TG.Store.userName(), li:TG.Store.profile('ru').lessonIndex, route:TG.UI.route(), header:document.querySelector('.user-chip').innerText})`));
// изменить прогресс Маши
await ev(`TG.Store.profile('ru').lessonIndex=2; TG.Store.state.customTexts.push({id:'c-x',lang:'ru',title:'Машин текст',body:'Текст Маши.',added:1}); TG.Store.settings().theme='light'; TG.Store.saveNow()`);

// 3. Перезагрузка → выбор профиля
await reload();
console.log('3 reload route:', await ev('TG.UI.route()'), '| heading:', await ev(`document.querySelector('.profiles h2').innerText`));
await shot('p1-picker');
const firstId = await ev('TG.Store.users()[0].id');
await ev(`document.querySelector('[data-action="user-select:${firstId}"]').click()`); await sleep(300);
console.log('3 first user:', await ev(`JSON.stringify({name:TG.Store.userName(), li:TG.Store.profile('ru').lessonIndex, best:TG.Store.profile('ru').bestWpm, texts:TG.Store.state.customTexts.length, theme:TG.Store.settings().theme, route:TG.UI.route()})`));
const secondId = await ev('TG.Store.users()[1].id');
await ev(`TG.UI.go('profiles')`); await sleep(100);
await ev(`document.querySelector('[data-action="user-select:${secondId}"]').click()`); await sleep(300);
console.log('3 second user:', await ev(`JSON.stringify({name:TG.Store.userName(), li:TG.Store.profile('ru').lessonIndex, texts:TG.Store.state.customTexts.length, theme:TG.Store.settings().theme})`));

// 4. Переименование через модальное окно
await ev(`TG.UI.go('profiles')`); await sleep(100);
await ev(`document.querySelector('[data-action="user-rename:${firstId}"]').click()`); await sleep(100);
await shot('p2-rename');
await ev(`document.querySelector('.modal input').value='Петя'; document.querySelector('.modal').requestSubmit()`); await sleep(200);
console.log('4 rename:', await ev(`TG.Store.userName(TG.Store.user('${firstId}'))`));

// 5. Импорт как новый профиль (экспорт текущего в строку)
const payload = await ev(`JSON.stringify(Object.assign({profileName: TG.Store.userName()}, TG.Store.state))`);
const newId = await ev(`TG.Store.importAsNewUser(${JSON.stringify(payload)})`);
console.log('5 import:', await ev(`JSON.stringify({users:TG.Store.users().map(u=>TG.Store.userName(u)), imported: TG.Store.userSummary('${newId}').lessonIndex})`));
console.log('5 bad file:', await ev(`TG.Store.importAsNewUser('{"x":1}')`));
await ev(`TG.UI.go('profiles')`); await sleep(200); await shot('p3-profiles');

// 6. Удаление текущего профиля
await ev(`document.querySelector('[data-action="user-delete:${secondId}"]').click()`); await sleep(100);
await ev(`document.querySelector('.modal [data-m=yes]').click()`); await sleep(300);
console.log('6 delete:', await ev(`JSON.stringify({users:TG.Store.users().map(u=>TG.Store.userName(u)), cur:TG.Store.userName(), keyGone: localStorage.getItem('typego.v1.u.${secondId}')===null})`));

// 7. Урок в одном профиле не влияет на другой
await ev(`TG.UI.go('home')`); await sleep(100);
await shot('p4-home');
console.log('7 keys:', await ev(`Object.keys(localStorage).sort().join(', ')`));
console.log('--- errors:'); logs.forEach(l => console.log(l));
ws.close(); chrome.kill(); process.exit(0);
