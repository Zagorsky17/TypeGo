import { spawn } from 'node:child_process';
const SP = process.argv[2], FILE = 'file://' + process.argv[3];
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ['--headless=new', '--remote-debugging-port=9336', '--user-data-dir=' + SP + '/chrome-audit2', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50; i++) { try { targets = await (await fetch('http://127.0.0.1:9336/json')).json(); if (targets.length) break; } catch {} await sleep(200); }
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const pending = {}; const warns = [];
ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pending[d.id]) { pending[d.id](d); delete pending[d.id]; }
  if (d.method === 'Runtime.consoleAPICalled') warns.push(d.params.args.map(a => a.value ?? a.description).join(' ').slice(0, 90)); };
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true }); return r.result.exceptionDetails ? 'ERR' : r.result.result.value; };
await send('Runtime.enable'); await send('Page.navigate', { url: FILE }); await sleep(900);
await ev(`TG.Texts.add('big', 'слово '.repeat(1100000), 'ru')`);
await ev(`TG.Store.profile().bestWpm = 55; TG.Store.saveNow()`);
console.log('storageOk after save:', await ev('TG.Store.storageOk'));
console.log('stored bestWpm:', await ev(`(JSON.parse(localStorage.getItem('typego.v1.u.'+TG.Store.index.current))||{profiles:{ru:{}}}).profiles.ru.bestWpm`));
console.log('console:', warns.filter(w => /localStorage/.test(w)));
console.log('home warning shown:', await ev(`TG.UI.go('home'), !!document.querySelector('.note.warn')`));
chrome.kill(); process.exit(0);
