const BASE = process.env.CDPBASE || "http://[::1]:9807";
// Scenario file is JS run with: goto, click, clickText, type, text, sleep, shot, fill, press.
import fs from 'node:fs';

const ver = await (await fetch(`${BASE}/json/version`)).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let mid = 0; const pending = new Map(); const events = [];
function send(method, params = {}, sessionId) {
  return new Promise((res, rej) => {
    const id = ++mid;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
}
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id); pending.delete(msg.id);
    msg.error ? p.rej(new Error(JSON.stringify(msg.error))) : p.res(msg.result);
  } else if (msg.method) events.push(msg);
};

// attach to first page target (create if none)
let list = await (await fetch(`${BASE}/json/list`)).json();
let page = list.find(t => t.type === 'page' && t.url.includes('107.175')) || list.find(t => t.type === 'page');
if (!page) { await fetch(`${BASE}/json/new?about:blank`, { method: 'PUT' }); list = await (await fetch(`${BASE}/json/list`)).json(); page = list.find(t => t.type === 'page'); }
const { sessionId } = await send('Target.attachToTarget', { targetId: page.id, flatten: true });
const S = send; // (method, params) with implicit session
const S2 = (m, p) => S(m, p, sessionId);

await S2('Page.enable');
await S2('Runtime.enable');
await S2('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await sleep(400);

async function evalJs(expression) {
  const r = await S2('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) throw new Error('PAGE-ERROR: ' + JSON.stringify(r.exceptionDetails).slice(0, 1500));
  return r.result.value;
}
async function goto(url) { await S2('Page.navigate', { url }); await sleep(3500); return 'nav'; }
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function text() { return evalJs('document.body.innerText'); }
async function centerOf(hint) {
  return evalJs(`(() => {
    const hint = ${JSON.stringify(hint)};
    let els;
    if (hint.startsWith('sel:')) els = [...document.querySelectorAll(hint.slice(4))];
    else els = [...document.querySelectorAll('button, a, [role=button], [role=tab], input[type=submit], input[type=button], label, .tab, [class*=tab], [class*=Tab]')].filter(e => (e.innerText || e.value || '').trim().includes(hint));
    for (const el of els) { const r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0) return { x: r.x + r.width / 2, y: r.y + r.height / 2, tag: el.tagName, txt: (el.innerText || el.value || '').slice(0, 60) }; }
    return null;
  })()`);
}
async function click(hint) {
  const c = await centerOf(hint);
  if (!c) throw new Error('no visible target: ' + hint);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await S2('Input.dispatchMouseEvent', { type, x: c.x, y: c.y, button: 'left', clickCount: 1 });
  }
  await sleep(600);
  return c;
}
async function fill(sel, value) {
  const c = await centerOf('sel:' + sel);
  if (!c) throw new Error('no field: ' + sel);
  await S2('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', clickCount: 1 });
  await S2('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', clickCount: 1 });
  await sleep(200);
  await S2('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 4, windowsVirtualKeyCode: 65 });
  await S2('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 4, windowsVirtualKeyCode: 65 });
  await S2('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
  await S2('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
  await sleep(200);
  await S2('Input.insertText', { text: value });
  await sleep(200);
  return c;
}
async function shot(path) {
  const { data } = await S2('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path, Buffer.from(data, 'base64'));
  return path;
}
const press = async (key) => { await S2('Input.dispatchKeyEvent', { type: 'keyDown', key }); await S2('Input.dispatchKeyEvent', { type: 'keyUp', key }); };

const scenario = fs.readFileSync(process.argv[2], 'utf8');
const cred = () => JSON.parse(fs.readFileSync('/tmp/yudian-cdp/cred.txt', 'utf8'));
const ev = (expression) => evalJs(expression);
const fn = new Function('goto', 'click', 'fill', 'text', 'sleep', 'shot', 'press', 'S2', 'cred', 'ev', `return (async () => { ${scenario} })()`);
try {
  const out = await fn(goto, click, fill, text, sleep, shot, press, S2, cred, ev);
  console.log(out === undefined ? '(no return)' : (typeof out === 'string' ? out : JSON.stringify(out, null, 1)));
} catch (e) { console.error('FAIL:', e.message); process.exitCode = 1; }
ws.close();
