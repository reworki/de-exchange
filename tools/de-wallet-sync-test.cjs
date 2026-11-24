// Verify that a stale local wallet is corrected from the server on load.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const url = process.argv[2];
const outDir = process.argv[3];
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9985 + Math.floor(Math.random() * 10);
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp21-'));
const child = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars', '--mute-audio',
  `--user-data-dir=${prof}`, `--remote-debugging-port=${port}`, '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
let id = 0; const pending = new Map(); const logs = [];
const send = (ws, m, p = {}, s) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p, sessionId: s })); });
(async () => {
  let wsUrl;
  for (let i = 0; i < 100; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); const j = await r.json(); if (j.webSocketDebuggerUrl) { wsUrl = j.webSocketDebuggerUrl; break; } } catch {} await sleep(200); }
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); return; } if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (m.params.exceptionDetails.exception?.description || '').split('\n')[0]); };
  const { targetId } = await send(ws, 'Target.createTarget', { url: 'about:blank' });
  const sessionId = (await send(ws, 'Target.attachToTarget', { targetId, flatten: true })).sessionId;
  const S = (m, p) => send(ws, m, p, sessionId);
  const ev = async (e) => { const r = await S('Runtime.evaluate', { expression: e, returnByValue: true }); return r.exceptionDetails ? 'ERR ' + (r.exceptionDetails.exception?.description || '').split('\n')[0] : r.result.value; };
  await S('Page.enable'); await S('Runtime.enable');
  await S('Page.navigate', { url });
  await sleep(4200);
  await ev(`(() => { const t = [...document.querySelectorAll('button,div,span')].find(e => e.textContent.trim() === 'Вход'); if (t) t.click(); })()`);
  await sleep(700);
  await ev(`(() => { const i = [...document.querySelectorAll('input')]; const set = (e, v) => { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }; const m = i.find(x => x.type === 'email'); const p = i.filter(x => x.type === 'password')[0]; if (m) set(m, 'kent.vasya@rework.mail'); if (p) set(p, 'kent-vasya-2026'); const b = [...document.querySelectorAll('button')].find(x => /войти/i.test(x.textContent)); if (b) b.click(); })()`);
  await sleep(9000);
  const before = await ev(`JSON.stringify({ wallet: (window.__DE_ACC || {}).wallet })`);

  // ломаем локальный кошелёк и перезагружаем
  await ev(`(() => { var db = JSON.parse(localStorage.getItem('de_accounts_v1')); db.list.forEach(function (a) { if (a.email === 'kent.vasya@rework.mail') a.wallet = '11111111'; }); localStorage.setItem('de_accounts_v1', JSON.stringify(db)); return 'broken'; })()`);
  await S('Page.reload');
  await sleep(7000);
  const after = await ev(`JSON.stringify({ wallet: (window.__DE_ACC || {}).wallet, panel: (document.getElementById('accWallet') || {}).textContent || '' })`);
  const toast = await ev(`(document.getElementById('toast') || {}).textContent || ''`);
  console.log(JSON.stringify({ before: JSON.parse(before), after: JSON.parse(after), toast, logs: [...new Set(logs)].slice(0, 4) }, null, 1));
  ws.close(); child.kill(); await sleep(200); process.exit(0);
})().catch((e) => { console.error('FAIL', e.message); child.kill(); process.exit(1); });
