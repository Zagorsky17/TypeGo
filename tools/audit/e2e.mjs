import { spawn } from 'node:child_process';
import fs from 'node:fs';
const SP = process.argv[2], FILE = process.argv[3];
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ['--headless=new', '--remote-debugging-port=9333', '--user-data-dir=' + SP + '/chrome-prof', '--window-size=1280,1000', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50; i++) { try { targets = await (await fetch('http://127.0.0.1:9333/json')).json(); if (targets.length) break; } catch {} await sleep(200); }
const page = targets.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pending = {}; const logs = []; const reqs = [];
ws.onmessage = m => {
  const d = JSON.parse(m.data);
  if (d.id && pending[d.id]) { pending[d.id](d); delete pending[d.id]; }
  if (d.method === 'Runtime.consoleAPICalled') logs.push(d.params.type + ': ' + d.params.args.map(a => a.value ?? a.description).join(' '));
  if (d.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION: ' + JSON.stringify(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text));
  if (d.method === 'Network.requestWillBeSent') reqs.push(d.params.request.url.slice(0, 120));
};
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result.exceptionDetails) return 'ERR ' + JSON.stringify(r.result.exceptionDetails.exception?.description); return r.result.result.value; };
const shot = async name => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(SP + '/' + name + '.png', Buffer.from(r.result.data, 'base64')); };
const key = async ch => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch, unmodifiedText: ch });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
};
await send('Runtime.enable'); await send('Network.enable'); await send('Page.enable');
await send('Page.navigate', { url: 'file://' + FILE });
await sleep(1200);
console.log('title:', await ev('document.title'));
await ev('localStorage.clear(); location.reload()'); await sleep(1000);
await shot('01-home');
// onboarding → урок 0 (посадка)
await ev("document.querySelector('[data-action=onboard-zero]').click()"); await sleep(300);
await shot('02-posture');
async function typeCurrent(errEvery) {
  let n = 0;
  for (let guard = 0; guard < 3000; guard++) {
    const st = await ev("(()=>{const r=TG.UI.route(); if(r!=='session') return null; const t=document.querySelector('.cur'); return t? t.textContent : null})()");
    if (st == null) break;
    n++;
    if (errEvery && n % errEvery === 0) await key('щ' === st ? 'ш' : 'щ');
    await key(st);
    await sleep(70);
  }
}
await typeCurrent(0); await sleep(300);
await shot('03-results');
console.log('results text:', (await ev("document.querySelector('.results')?.innerText.slice(0,400)")));
// next lessons a few
for (let i = 0; i < 3; i++) { await ev("document.querySelector('[data-action=next]').click()"); await sleep(200); if (i==0) await shot('04-lesson1'); await typeCurrent(25); await sleep(200); }
console.log('lessonIndex', await ev('TG.Store.profile().lessonIndex'), 'sessions', await ev('TG.Store.profile().sessions.length'));
await shot('05-results2');
for (const r of ['home', 'train', 'stats', 'texts', 'settings']) { await ev(`TG.UI.go('${r}')`); await sleep(300); await shot('06-' + r); }
// adaptive + test60 in EN
await ev(`TG.UI.go('train')`); await ev("document.querySelector('[data-action=\"start:adaptive\"]').click()"); await sleep(200); await shot('07-adaptive');
await typeCurrent(12); await sleep(200);
console.log('adaptive result:', await ev("document.querySelector('.results')?.innerText.slice(0,300)"));
// theme dark
await ev(`TG.Store.settings().theme='dark'; TG.App.applyPrefs(); TG.UI.go('home')`); await sleep(300); await shot('08-home-dark');
// uilang en
await ev(`TG.Store.settings().uiLang='en'; TG.Store.settings().layoutLang='en'; TG.App.applyPrefs(); TG.UI.go('train')`); await sleep(300); await shot('09-train-en');
// reload persistence
await ev('TG.Store.saveNow(); location.reload()'); await sleep(1000);
console.log('after reload ru lessonIndex', await ev('TG.Store.state.profiles.ru.lessonIndex'), 'uiLang', await ev('TG.Store.settings().uiLang'));
// export/import roundtrip
console.log('import roundtrip', await ev(`(()=>{const s=JSON.stringify(TG.Store.state); TG.Store.reset(); const ok=TG.Store.importText(s); return ok + ' ' + TG.Store.state.profiles.ru.lessonIndex})()`));
console.log('--- console/errors:'); logs.forEach(l => console.log(l));
console.log('--- non-file requests:', reqs.filter(u => !u.startsWith('file://') && !u.startsWith('data:')));
ws.close(); chrome.kill();
process.exit(0);
