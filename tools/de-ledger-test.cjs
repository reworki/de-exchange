// Verify the append-only transfer ledger: import, reset survival, outgoing records.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const url = process.argv[2];
const outDir = process.argv[3];
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9870 + Math.floor(Math.random() * 40);
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp18-'));
const child = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars', '--mute-audio',
  `--user-data-dir=${prof}`, `--remote-debugging-port=${port}`, '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });
let id = 0; const pending = new Map(); const logs = [];
const send = (ws, m, p = {}, s) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p, sessionId: s })); });
(async () => {
  let wsUrl;
  for (let i = 0; i < 100; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); const j = await r.json(); if (j.webSocketDebuggerUrl) { wsUrl = j.webSocketDebuggerUrl; break; } } catch {} await sleep(200); }
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); return; } if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (m.params.exceptionDetails.exception?.description || '').split('\n')[0]); if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push('ERR ' + m.params.args.map(a => a.value ?? a.description ?? a.type).join(' ').slice(0, 120)); };
  const { targetId } = await send(ws, 'Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send(ws, 'Target.attachToTarget', { targetId, flatten: true });
  const S = (m, p) => send(ws, m, p, sessionId);
  const ev = async (e) => { const r = await S('Runtime.evaluate', { expression: e, returnByValue: true }); return r.exceptionDetails ? 'ERR ' + (r.exceptionDetails.exception?.description || '').split('\n')[0] : r.result.value; };
  const shot = async (n) => { const s = await S('Page.captureScreenshot', { format: 'jpeg', quality: 82 }); fs.writeFileSync(path.join(outDir, n), Buffer.from(s.data, 'base64')); };
  await S('Page.enable'); await S('Runtime.enable');
  await S('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await S('Page.navigate', { url });
  await sleep(4200);
  await ev(`(() => { const t = [...document.querySelectorAll('button,div,span')].find(e => e.textContent.trim() === 'Вход'); if (t) t.click(); })()`);
  await sleep(700);
  await ev(`(() => { const i = [...document.querySelectorAll('input')]; const set = (e, v) => { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }; const m = i.find(x => x.type === 'email'); const p = i.filter(x => x.type === 'password')[0]; if (m) set(m, 'kent.vasya@rework.mail'); if (p) set(p, 'kent-vasya-2026'); const b = [...document.querySelectorAll('button')].find(x => /войти/i.test(x.textContent)); if (b) b.click(); })()`);
  await sleep(9000);

  const before = await ev(`JSON.stringify({ ledger: dxLedger().length, sample: dxLedger().slice(-3), logRows: document.querySelectorAll('#tradeLog .logrow').length, logText: (document.querySelector('#tradeLog') || {}).innerText ? document.querySelector('#tradeLog').innerText.replace(/\\n+/g,' | ').slice(0,220) : '' })`);
  await shot('01-journal.png');

  const afterReset = await ev(`JSON.stringify((function(){ var n0 = dxLedger().length; resetAll(); return { before: n0, after: dxLedger().length }; })())`);

  const sendRes = await ev(`JSON.stringify((function(){
    window.confirm = function(){ return true; };
    state.usdt = 1000;
    showView('wallet');
    var to = document.getElementById('dsTo'), amt = document.getElementById('dsAmount'), cur = document.getElementById('dsCur');
    if (cur) { cur.value = 'USDT'; cur.dispatchEvent(new Event('change', { bubbles: true })); }
    to.value = '39848328'; to.dispatchEvent(new Event('input', { bubbles: true }));
    amt.value = '1'; amt.dispatchEvent(new Event('input', { bubbles: true }));
    dsGo();
    return { started: true };
  })())`);
  await sleep(3500);
  const afterSend = await ev(`JSON.stringify({ ledger: dxLedger().length, last: dxLedger().slice(-2) })`);
  await ev(`showView('exchange')`);
  await sleep(800);
  await shot('02-journal-after.png');

  console.log(JSON.stringify({ before: JSON.parse(before), afterReset: JSON.parse(afterReset), sendRes: JSON.parse(sendRes), afterSend: JSON.parse(afterSend), logs: [...new Set(logs)].slice(0, 6) }, null, 1));
  ws.close(); child.kill(); await sleep(200); process.exit(0);
})().catch((e) => { console.error('FAIL', e.message); child.kill(); process.exit(1); });
