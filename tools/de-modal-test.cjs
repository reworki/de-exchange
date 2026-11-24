// Open an asset card and check that photos + modal work.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const url = process.argv[2];
const outDir = process.argv[3];
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9750 + Math.floor(Math.random() * 60);
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp16-'));
const child = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars', '--mute-audio',
  `--user-data-dir=${prof}`, `--remote-debugging-port=${port}`, '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });
let id = 0; const pending = new Map(); const logs = [];
const send = (ws, m, p = {}, s) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p, sessionId: s })); });
(async () => {
  let wsUrl;
  for (let i = 0; i < 100; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); const j = await r.json(); if (j.webSocketDebuggerUrl) { wsUrl = j.webSocketDebuggerUrl; break; } } catch {} await sleep(200); }
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); return; }
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0]);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push('ERR ' + m.params.args.map(a => a.value ?? a.description ?? a.type).join(' ').slice(0, 120));
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') logs.push('LOG ' + m.params.entryText?.slice?.(0, 100) || m.params.entry.text.slice(0, 100));
  };
  const { targetId } = await send(ws, 'Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send(ws, 'Target.attachToTarget', { targetId, flatten: true });
  const S = (m, p) => send(ws, m, p, sessionId);
  const ev = async (e) => { const r = await S('Runtime.evaluate', { expression: e, returnByValue: true }); return r.exceptionDetails ? 'ERR ' + (r.exceptionDetails.exception?.description || '').split('\n')[0] : r.result.value; };
  const shot = async (n) => { const s = await S('Page.captureScreenshot', { format: 'jpeg', quality: 82 }); fs.writeFileSync(path.join(outDir, n), Buffer.from(s.data, 'base64')); };
  await S('Page.enable'); await S('Runtime.enable'); await S('Log.enable');
  await S('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await S('Page.navigate', { url });
  await sleep(4500);
  await ev(`(() => { const t = [...document.querySelectorAll('button,div,span')].find(e => e.textContent.trim() === 'Вход'); if (t) t.click(); })()`);
  await sleep(700);
  await ev(`(() => { const i = [...document.querySelectorAll('input')]; const set = (e, v) => { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }; const m = i.find(x => x.type === 'email'); const p = i.filter(x => x.type === 'password')[0]; if (m) set(m, 'kent.vasya@rework.mail'); if (p) set(p, 'kent-vasya-2026'); const b = [...document.querySelectorAll('button')].find(x => /войти/i.test(x.textContent)); if (b) b.click(); })()`);
  await sleep(9000);
  await ev(`showView('assets'); dxAssetTab('homes');`);
  await sleep(1500);
  const info = await ev(`(() => { const cards = [...document.querySelectorAll('.aitem')]; const srcs = cards.map(c => (c.querySelector('img') || {}).src || ''); return JSON.stringify({ cards: cards.length, photos: srcs.filter(s => s.indexOf('/img/') >= 0).length, unique: new Set(srcs).size }); })()`);
  await shot('cards.png');
  await ev(`dxAssetOpen('castle_loire')`);
  await sleep(1600);
  const modal = await ev(`(() => { const m = document.getElementById('assetModal'); const img = document.getElementById('amImg'); return JSON.stringify({ open: m.classList.contains('on'), src: img.getAttribute('src'), loaded: img.complete && img.naturalWidth > 0, thumbs: document.querySelectorAll('#amThumbs img').length, title: document.getElementById('amTitle').textContent, credits: document.getElementById('amCredits').textContent.slice(0, 90) }); })()`);
  await shot('modal.png');
  console.log(JSON.stringify({ info: JSON.parse(info), modal: JSON.parse(modal), logs: [...new Set(logs)].slice(0, 5) }, null, 1));
  ws.close(); child.kill(); await sleep(200); process.exit(0);
})().catch((e) => { console.error('FAIL', e.message); child.kill(); process.exit(1); });
