// Log into DE Exchange with the test account, screenshot the dashboard, collect console errors.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const url = process.argv[2];
const outDir = process.argv[3];
const email = process.argv[4];
const pass = process.argv[5];
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9900 + Math.floor(Math.random() * 90);
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp12-'));
const child = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars', '--mute-audio',
  `--user-data-dir=${prof}`, `--remote-debugging-port=${port}`, '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
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
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) logs.push(m.params.type.toUpperCase() + ' ' + m.params.args.map(a => a.value ?? a.description ?? a.type).join(' ').slice(0, 160));
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') logs.push('LOG ' + m.params.entry.text.slice(0, 140));
  };
  const { targetId } = await send(ws, 'Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send(ws, 'Target.attachToTarget', { targetId, flatten: true });
  const S = (m, p) => send(ws, m, p, sessionId);
  const ev = async (e, aw = false) => { const r = await S('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: aw }); if (r.exceptionDetails) return 'ERR ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text).split('\n')[0]; return r.result.value; };
  const shot = async (n) => { const s = await S('Page.captureScreenshot', { format: 'jpeg', quality: 82 }); fs.writeFileSync(path.join(outDir, n), Buffer.from(s.data, 'base64')); };
  await S('Page.enable'); await S('Runtime.enable'); await S('Log.enable');
  await S('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await S('Page.navigate', { url });
  await sleep(4000);

  // switch to the login tab
  const tabbed = await ev(`(() => { const t = [...document.querySelectorAll('button,div,span')].find(e => e.textContent.trim() === 'Вход'); if (!t) return 'no tab'; t.click(); return 'clicked'; })()`);
  await sleep(900);
  const fields = await ev(`JSON.stringify([...document.querySelectorAll('input')].map(i => ({ type: i.type, ph: i.placeholder, id: i.id })))`);

  await ev(`(() => {
    const inputs = [...document.querySelectorAll('input')];
    const set = (el, v) => { el.focus(); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
    const mail = inputs.find(i => i.type === 'email' || /mail|почт/i.test(i.placeholder));
    const pw = inputs.filter(i => i.type === 'password');
    if (mail) set(mail, ${JSON.stringify(email)});
    if (pw[0]) set(pw[0], ${JSON.stringify(pass)});
    return 'filled';
  })()`);
  await sleep(400);
  await ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => /войти|вход/i.test(x.textContent)); if (b) b.click(); return !!b; })()`);
  await sleep(11000);
  await shot('01-login.png');
  const state = await ev(`JSON.stringify({ title: document.title, balance: (document.body.innerText.match(/СВОБОДНЫЙ USDT[\\s\\S]{0,40}/) || [])[0], total: (document.body.innerText.match(/ОБЩИЙ БАЛАНС[\\s\\S]{0,40}/) || [])[0], text: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 200) })`);
  const dump = await ev(`JSON.stringify({ keys: Object.keys(localStorage).filter(k => /exchange|sync|accounts|nft/.test(k)), ex: (localStorage.getItem(Object.keys(localStorage).find(k => k.indexOf('de_exchange_v3') === 0) || 'x') || '').slice(0, 200), cur: (window.__DE_DB && window.__DE_DB.current) || null })`);
  console.log(JSON.stringify({ dump: JSON.parse(dump), tabbed, fields: JSON.parse(fields), state: JSON.parse(state), logs: [...new Set(logs)].slice(0, 8) }, null, 1));
  ws.close(); child.kill(); await sleep(200); process.exit(0);
})().catch((e) => { console.error('FAIL', e.message); child.kill(); process.exit(1); });
