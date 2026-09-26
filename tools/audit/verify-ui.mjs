// Проверка исправлений этапа 5 (интерфейс и методика): M8, M9, M11, M12, L4.
// Запуск из корня проекта: node tools/audit/verify-ui.mjs "$(mktemp -d)" "$PWD/index.html"
import { spawn } from 'node:child_process';
const [, , PROFILE_DIR, HTML] = process.argv;
const FILE = 'file://' + HTML;
const PORT = 9340;
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

// набрать символ из текущей позиции (без хитростей с шаблонами)
const typeCur = async n => {
  for (let i = 0; i < n; i++) {
    const ch = await A.ev(`TG.UI.route() === 'session' ? document.querySelector('.cur')?.textContent : null`);
    if (ch == null) return;
    await A.ev(`document.dispatchEvent(new KeyboardEvent('keydown', {key: ${JSON.stringify(ch)}, bubbles: true}))`);
    await sleep(40);
  }
};
const modal = () => A.ev(`!!document.querySelector('.modal')`);
const click = sel => A.ev(`document.querySelector(${JSON.stringify(sel)}).click()`);

// M9: запуск урока без прохождения не открывает его клавиши
await A.ev(`TG.Store.profile().lessonIndex = 1; TG.Store.saveNow(); TG.UI.go('train')`);
await click('[data-action="lesson:1"]');
check('M9 урок запущен', await A.ev(`TG.UI.route()`) === 'session');
await click('[data-action="exit"]');
check('M9 выход без нажатий — без подтверждения', await A.ev(`TG.UI.route()`) === 'train' && !(await modal()));
check('M9 клавиши урока не открыты после выхода', await A.ev(`TG.Store.profile().introduced.length`) === 0, await A.ev(`JSON.stringify(TG.Store.profile().introduced)`));

// M8: уход с тренировки с прогрессом требует подтверждения
await click('[data-action="lesson:1"]');
await typeCur(3);
await click('[data-action="nav:home"]');
check('M8 переход из шапки во время урока спрашивает подтверждение', await modal() && await A.ev(`TG.UI.route()`) === 'session');
await A.ev(`document.dispatchEvent(new KeyboardEvent('keydown', {key: 'щ', bubbles: true}))`);
check('M8 пока открыто окно, нажатия не попадают в урок', await A.ev(`document.getElementById('lvErr').textContent`) === '0');
await click('.modal [data-m=no]');
check('M8 «Отмена» — урок продолжается', await A.ev(`TG.UI.route()`) === 'session' && !(await modal()));
await A.ev(`document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}))`);
check('M8 Esc с прогрессом тоже спрашивает', await modal());
await click('.modal [data-m=yes]');
check('M8 подтверждение — выход', await A.ev(`TG.UI.route()`) === 'train');
check('M8 переключение языка во время урока спрашивает', await (async () => {
  await click('[data-action="lesson:1"]'); await typeCur(2);
  await click('[data-action="uilang-toggle"]');
  const r = await modal() && await A.ev(`TG.UI.route()`) === 'session';
  await click('.modal [data-m=no]');
  return r;
})());

// M9: после завершённой попытки клавиши урока открыты
await typeCur(400);
check('M9 урок завершён', await A.ev(`TG.UI.route()`) === 'results');
check('M9 клавиши открыты после попытки', await A.ev(`TG.Store.profile().introduced.length`) >= 2, await A.ev(`JSON.stringify(TG.Store.profile().introduced)`));

// M11: план дня пересоздан во время шага → отмечается шаг нужного типа
await A.ev(`(() => { const st = TG.Store.state; st.daily = {date: TG.Util.today(), lang: TG.Store.settings().layoutLang, minutes: TG.Store.settings().dailyMinutes,
  steps: [{type: 'lesson', min: 1, done: false}, {type: 'warmup', min: 1, done: false}]}; TG.UI.go('home'); })()`);
await click('[data-action="daily"]');
check('M11 шаг «урок» запущен', await A.ev(`TG.UI.route()`) === 'session');
await A.ev(`TG.Store.state.daily.steps = [{type: 'warmup', min: 1, done: false}, {type: 'lesson', min: 1, done: false}]`);
await typeCur(400);
check('M11 отмечен шаг «урок», а не шаг с тем же номером',
  await A.ev(`JSON.stringify(TG.Store.state.daily.steps.map(s => s.type + ':' + s.done))`) === '["warmup:false","lesson:true"]',
  await A.ev(`JSON.stringify(TG.Store.state.daily.steps.map(s => s.type + ':' + s.done))`));

// M12: несогласованные пороги отклоняются
await A.ev(`TG.UI.go('settings')`);
const setTh = async (k, v) => A.ev(`(() => { const el = document.querySelector('[data-th="${k}"]'); el.value = '${v}'; el.dispatchEvent(new Event('change')); return el.value; })()`);
await setTh('accLow', 95);
check('M12 нижний порог выше среднего отклонён', await A.ev(`TG.Store.th().accLow`) === 85 && await A.ev(`document.querySelector('[data-th="accLow"]').value`) === '85');
await setTh('lessonPassAcc', 100);
check('M12 требование 100% отклонено', await A.ev(`TG.Store.th().lessonPassAcc`) === 94);
await setTh('weakMastery', 90);
check('M12 порог слабой клавиши ≥ освоенной отклонён', await A.ev(`TG.Store.th().weakMastery`) === 60);
await setTh('accLow', 80);
check('M12 допустимое значение принимается', await A.ev(`TG.Store.th().accLow`) === 80);
check('M12 несогласованные пороги из файла заменяются значениями по умолчанию',
  await A.ev(`(() => { const s = JSON.parse(JSON.stringify(TG.Store.state)); s.settings.thresholds.accLow = 99; const r = TG.Store.parseFile(JSON.stringify(s)); return r.state.settings.thresholds.accLow; })()`) === 85);

// L4: вставка в свободной печати запрещена
await A.ev(`TG.UI.go('train')`); await click('[data-action="start:free"]');
check('L4 вставка текста в свободной печати отменена', await A.ev(`!document.getElementById('freeArea').dispatchEvent(new Event('paste', {cancelable: true}))`));

check('Нет необработанных исключений', !A.errors.length, JSON.stringify(A.errors));
chrome.kill();
console.log(failed ? `\n${failed} FAIL` : '\nВСЁ PASS');
process.exit(failed ? 1 : 0);
