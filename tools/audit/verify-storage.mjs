// Проверка исправлений этапа 1 (хранилище): C2, C3, C4, M6, L1, H4.
// Запуск из корня проекта: node tools/audit/verify-storage.mjs "$(mktemp -d)" "$PWD/index.html"
import { spawn } from 'node:child_process';
const [, , PROFILE_DIR, HTML] = process.argv;
const FILE = 'file://' + HTML;
const PORT = 9337;
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
const KEYS = `Object.keys(localStorage).sort()`;
const CUR_KEY = `'typego.v1.u.' + TG.Store.index.current`;

const A = await tab(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await A.go(FILE);
await A.ev('localStorage.clear()'); await A.reloadRaw();

// C3: повреждённый индекс → профили восстанавливаются по ключам
await A.ev(`TG.Store.createUser('Маша'); TG.Store.createUser('Петя'); TG.Store.saveNow()`);
await A.ev(`localStorage.setItem('typego.v1.users', '{"current":')`); await A.reloadRaw();
check('C3 повреждённый индекс: 3 профиля восстановлены', await A.ev('TG.Store.users().length') === 3, await A.ev('TG.Store.users().length'));
check('C3 копия повреждённого индекса сохранена', await A.ev(`${KEYS}.some(k => k.startsWith('typego.v1.users.corrupt.'))`));
check('C3 показано сообщение corrupt', await A.ev(`TG.Store.issues.includes('corrupt') && !document.getElementById('banner').hidden`));
check('L1 повреждение не выдаётся за «хранилище недоступно»', await A.ev(`!TG.Store.issues.includes('unavailable')`));

// C3: повреждённые данные профиля → копия, исходные данные не теряются
await A.ev(`localStorage.setItem(${CUR_KEY}, '{"app":"TypeGo","broken')`); await A.reloadRaw();
check('C3 повреждённый профиль: копия сохранена', await A.ev(`${KEYS}.some(k => /^typego\\.v1\\.u\\.[a-z0-9]+\\.corrupt\\./.test(k))`));
check('C3 приложение работает после повреждения', await A.ev(`document.getElementById('main').innerHTML.length > 100`));
const corruptRaw = await A.ev(`localStorage.getItem(Object.keys(localStorage).find(k => /\\.u\\.[a-z0-9]+\\.corrupt\\./.test(k)))`);
check('C3 в копии исходный текст', corruptRaw === '{"app":"TypeGo","broken', corruptRaw);

// M6: данные из более новой версии не перезаписываются
await A.ev('localStorage.clear()'); await A.reloadRaw();
await A.ev(`(() => { const s = JSON.parse(localStorage.getItem(${CUR_KEY})); s.version = 99; s.profiles.ru.lessonIndex = 9; localStorage.setItem(${CUR_KEY}, JSON.stringify(s)); })()`);
await A.reloadRaw();
await A.ev(`TG.Store.profile('ru').lessonIndex = 0; TG.Store.saveNow()`);
check('M6 данные новой версии не затёрты', await A.ev(`JSON.parse(localStorage.getItem(${CUR_KEY})).profiles.ru.lessonIndex`) === 9);
check('M6 показано сообщение newer', await A.ev(`TG.Store.issues.includes('newer')`));
check('M6 импорт файла новой версии отклонён', await A.ev(`TG.Store.parseFile(JSON.stringify(Object.assign({}, TG.Store.state, {version: 99}))) === null && TG.Store.parseError === 'newer'`));

// C2: две вкладки
await A.ev('localStorage.clear()'); await A.reloadRaw();
const t2 = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const B = await tab(t2.webSocketDebuggerUrl);
await B.go(FILE);
await B.ev(`TG.Store.createUser('Маша')`);
await A.ev(`TG.Store.profile().bestWpm = 42; TG.Store.saveNow()`);
check('C2 профиль из другой вкладки не теряется', await A.ev(`JSON.parse(localStorage.getItem('typego.v1.users')).users.length`) === 2);
check('C2 сохранение первой вкладки прошло', await A.ev(`JSON.parse(localStorage.getItem(${CUR_KEY})).profiles[TG.Store.settings().layoutLang].bestWpm`) === 42);

// один профиль в двух вкладках без своих изменений: вкладка принимает свежие данные, ничего не теряется
await B.ev(`TG.Store.switchUser(TG.Store.users()[0].id)`);
await A.ev(`TG.Store.profile().lessonIndex = 7; TG.Store.saveNow()`);
await sleep(200);
await B.ev(`TG.Store.profile().bestWpm = 1; TG.Store.saveNow()`);
const both = await A.ev(`(() => { const p = JSON.parse(localStorage.getItem(${CUR_KEY})).profiles[TG.Store.settings().layoutLang]; return p.lessonIndex + '/' + p.bestWpm; })()`);
check('C2 вкладка без изменений принимает свежие данные (урок 7 сохранён, рекорд 1 записан)', both === '7/1', both);

// одновременные несохранённые изменения: устаревшая вкладка не затирает, показывает конфликт
await B.ev(`TG.Store.profile().totalSeconds = 111`);          // изменение в B, ещё не записано
await A.ev(`TG.Store.profile().lessonIndex = 8; TG.Store.saveNow()`);
await sleep(200);
const bSaved = await B.ev(`TG.Store.saveNow()`);
check('C2 устаревшая вкладка с изменениями не записывает', bSaved === false, bSaved);
check('C2 свежие данные сохранены', await A.ev(`JSON.parse(localStorage.getItem(${CUR_KEY})).profiles[TG.Store.settings().layoutLang].lessonIndex`) === 8);
check('C2 устаревшая вкладка показывает конфликт', await B.ev(`TG.Store.conflict && document.querySelector('.banner-conflict') !== null`));

// удаление профиля в другой вкладке не отменяется
await A.ev('localStorage.clear()'); await A.reloadRaw();
await B.reload();
const mashaId = await A.ev(`TG.Store.createUser('Маша')`);
await B.ev(`TG.Store.switchUser('${mashaId}')`);
await A.ev(`TG.Store.deleteUser('${mashaId}')`);
await B.ev(`TG.Store.profile().bestWpm = 5; TG.Store.saveNow()`);
check('C2 удалённый профиль не восстанавливается', await A.ev(`localStorage.getItem('typego.v1.u.${mashaId}') === null && JSON.parse(localStorage.getItem('typego.v1.users')).users.length === 1`));

// C4: переполнение хранилища
await A.ev('localStorage.clear()'); await A.reloadRaw();
check('C4 слишком длинный свой текст отклонён', await A.ev(`TG.Texts.add('big', 'слово '.repeat(10000), 'ru').error`) === 'tooLong');
await A.ev(`(() => { let s = 'x'.repeat(1 << 20), i = 0; try { for (;;) localStorage.setItem('filler' + i++, s); } catch (e) {}
  s = 'x'.repeat(1 << 14); try { for (;;) localStorage.setItem('filler' + i++, s); } catch (e) {} })()`);
const qSaved = await A.ev(`TG.Store.profile().bestWpm = 55; (() => { for (let i = 0; i < 400; i++) TG.Store.profile().sessions.push({date: Date.now(), mode: 'test60', wpm: 1, acc: 99, errors: 0, corrections: 0, durationS: 60, keystrokes: 100, pad: 'z'.repeat(200)}); })(); TG.Store.saveNow()`);
check('C4 при переполнении saveNow сообщает об ошибке', qSaved === false, qSaved);
check('C4 storageOk = false', await A.ev('TG.Store.storageOk') === false);
check('C4 баннер quota виден', await A.ev(`document.querySelector('.banner-quota') !== null`));
await A.ev(`Object.keys(localStorage).filter(k => k.startsWith('filler')).forEach(k => localStorage.removeItem(k))`);
check('C4 после освобождения места сохранение проходит', await A.ev('TG.Store.saveNow()') === true);
check('C4 баннер quota убран', await A.ev(`document.querySelector('.banner-quota') === null`));

// H4: результат тренировки записывается сразу, а не через 400 мс
await A.ev('localStorage.clear()'); await A.reloadRaw();
await A.ev(`TG.UI.go('train')`);
await A.ev(`document.querySelector('[data-action="lesson:0"]').click()`);
for (let i = 0; i < 60; i++) {
  const ch = await A.ev(`TG.UI.route() === 'session' ? document.querySelector('.cur')?.textContent : null`);
  if (ch == null) break;
  await A.ev(`document.dispatchEvent(new KeyboardEvent('keydown', {key: ${JSON.stringify(ch)}, bubbles: true}))`);
  await sleep(60);
}
check('H4 результат урока уже в хранилище сразу после финиша', await A.ev(`TG.UI.route() === 'results' && JSON.parse(localStorage.getItem(${CUR_KEY})).profiles[TG.Store.settings().layoutLang].sessions.length === 1`));

check('Нет необработанных исключений', !A.errors.length && !B.errors.length, JSON.stringify(A.errors.concat(B.errors)));
chrome.kill();
console.log(failed ? `\n${failed} FAIL` : '\nВСЁ PASS');
process.exit(failed ? 1 : 0);
