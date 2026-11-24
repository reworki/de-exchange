// Старая сессия (аккаунт по почте) должна сама переехать на ник.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const url = process.argv[2];
const outDir = process.argv[3] || '_tmp/legacy';
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9940 + Math.floor(Math.random() * 20);
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-leg-'));
const child = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars', '--mute-audio',
  `--user-data-dir=${prof}`, `--remote-debugging-port=${port}`, '--window-size=1400,1000', 'about:blank'], { stdio: 'ignore' });
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
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0].slice(0, 140));
  };
  const { targetId } = await send(ws, 'Target.createTarget', { url: 'about:blank' });
  const sessionId = (await send(ws, 'Target.attachToTarget', { targetId, flatten: true })).sessionId;
  const S = (m, p) => send(ws, m, p, sessionId);
  const ev = async (e) => { const r = await S('Runtime.evaluate', { expression: e, returnByValue: true }); return r.exceptionDetails ? 'ERR ' + (r.exceptionDetails.exception?.description || '').split('\n')[0] : r.result.value; };
  const shot = async (n) => { const s = await S('Page.captureScreenshot', { format: 'jpeg', quality: 84 }); fs.writeFileSync(path.join(outDir, n), Buffer.from(s.data, 'base64')); };
  await S('Page.enable'); await S('Runtime.enable');
  await S('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });

  await S('Page.navigate', { url });
  await sleep(3500);
  const seeded = await ev(`(() => {
    var email = 'kent.vasya@rework.mail';
    var db = { list: [{ email: email, pass: '${process.env.DE_PASS||''}', wallet: '69621193', admin: false, created: 1794946652143 }], current: email };
    localStorage.setItem('de_accounts_v1', JSON.stringify(db));
    localStorage.setItem('de_exchange_v3__' + email, JSON.stringify({ v: 3, usdt: 576727759732629, amounts: {}, trades: [] }));
    localStorage.setItem('de_sync_v1__' + email, String(Date.now()));
    localStorage.setItem('de_started_v1__' + email, '1');
    return 'seeded';
  })()`);
  await S('Page.reload', { ignoreCache: true });
  await sleep(8000);
  const afterHeal = await ev(`JSON.stringify({
    db: JSON.parse(localStorage.getItem('de_accounts_v1') || '{}'),
    chip: (document.getElementById('accChip') || {}).innerText || '',
    accNick: (window.__DE_ACC || {}).nick || null,
    accBasis: (window.__DE_ACC || {}).nick_lc || (window.__DE_ACC || {}).email || null,
    keys: Object.keys(localStorage).filter(function (k) { return /exchange_v3__|sync_v1__/.test(k); }),
    total: (document.body.innerText.match(/ОБЩИЙ БАЛАНС[\\s\\S]{0,30}/) || [''])[0].replace(/\\s+/g, ' ')
  })`);
  await shot('01-after-heal.jpg');

  await ev(`(() => { const t=[...document.querySelectorAll('.tab')].find(x=>x.dataset.view==='profile'); if(t)t.click(); })()`);
  await sleep(3000);
  const prof = await ev(`(() => { const v=document.getElementById('view-profile'); return JSON.stringify({ text: v?v.innerText.replace(/\\s+/g,' ').slice(0,220):'', guest: v?/Войди, чтобы увидеть/.test(v.innerText):true }); })()`);
  await shot('02-profile.jpg');

  console.log(JSON.stringify({ seeded, afterHeal: JSON.parse(afterHeal), profile: JSON.parse(prof), logs: [...new Set(logs)].slice(0, 6) }, null, 1));
  ws.close(); child.kill(); await sleep(200); process.exit(0);
})().catch((e) => { console.error('FAIL', e.message); child.kill(); process.exit(1); });
