// Проверка админ-панели цены: появляется ли и что отвечает сервер.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const url = process.argv[2] || 'https://de-exchange.surge.sh/';
const outDir = process.argv[3] || '_tmp/admin';
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9930 + Math.floor(Math.random() * 15);
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-admin-'));
const child = spawn(EDGE, ['--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader', '--no-first-run', '--hide-scrollbars', '--mute-audio',
  `--user-data-dir=${prof}`, `--remote-debugging-port=${port}`, '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });
let id = 0; const pending = new Map(); const logs = []; const net = [];
const send = (ws, m, p = {}, s) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p, sessionId: s })); });
(async () => {
  let wsUrl;
  for (let i = 0; i < 100; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); const j = await r.json(); if (j.webSocketDebuggerUrl) { wsUrl = j.webSocketDebuggerUrl; break; } } catch {} await sleep(200); }
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); return; }
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (m.params.exceptionDetails.exception?.description || '').split('\n')[0].slice(0, 140));
    if (m.method === 'Network.responseReceived' && /market\/set/.test(m.params.response.url)) net.push(m.params.response.status);
  };
  const { targetId } = await send(ws, 'Target.createTarget', { url: 'about:blank' });
  const sessionId = (await send(ws, 'Target.attachToTarget', { targetId, flatten: true })).sessionId;
  const S = (m, p) => send(ws, m, p, sessionId);
  const ev = async (e) => { const r = await S('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? 'ERR ' + (r.exceptionDetails.exception?.description || '').split('\n')[0] : r.result.value; };
  await S('Page.enable'); await S('Runtime.enable'); await S('Network.enable');
  await S('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

  await S('Page.navigate', { url });
  await sleep(3000);
  // логин с флагом admin на клиенте (сервер всё равно проверит своё)
  const ownerMode = process.argv[4] === 'owner';
  const nickArg = ownerMode ? 'knote6037' : 'kent_vasya';
  const passArg = ownerMode ? 'fake-pass-for-ui-test' : (process.env.DE_PASS || '');
  await ev(`localStorage.setItem('de_accounts_v1', JSON.stringify({list:[{nick:'${nickArg}',nick_lc:'${nickArg}',pass:'${passArg}',wallet:'69621193',admin:${ownerMode}}],current:'${nickArg}'}))`);
  await S('Page.reload');
  await sleep(6000);

  const before = await ev(`JSON.stringify({
    panel: !!document.getElementById('dxAdmin'),
    display: (document.getElementById('dxAdmin')||{}).style ? document.getElementById('dxAdmin').style.display : null,
    script: (document.querySelector('script[src*="admin-market"]')||{}).src || null,
    accAdmin: !!(window.__DE_ACC && window.__DE_ACC.admin),
    basis: (typeof deBasis === 'function' ? deBasis(window.__DE_ACC) : null)
  })`);

  // открываем карточку ZEC
  await ev(`(function(){ if (typeof openAsset === 'function') openAsset('ZEC'); var g = document.getElementById('dxAdminBtn'); if (g) g.click(); return 1; })()`);
  await sleep(1500);
  const shot1 = await S('Page.captureScreenshot', { format: 'jpeg', quality: 82 });
  fs.writeFileSync(path.join(outDir, 'panel.jpg'), Buffer.from(shot1.data, 'base64'));

  const mid = await ev(`JSON.stringify({
    current: window.current ? window.current.key : null,
    price: window.current ? Math.round(window.current.price * 100) / 100 : null,
    gear: !!document.getElementById('dxAdminBtn'),
    display: (document.getElementById('dxAdmin')||{}).style ? document.getElementById('dxAdmin').style.display : null,
    buttons: document.querySelectorAll('#dxAdmin button').length
  })`);

  // жмём +5
  const clicked = await ev(`(function(){
    var b = document.querySelector('#dxAdmin button[data-pct="5"]');
    if (!b) return 'нет кнопки';
    b.click();
    return 'clicked';
  })()`);
  await sleep(3000);
  const after = await ev(`JSON.stringify({
    price: window.current ? Math.round(window.current.price * 100) / 100 : null,
    toast: (document.querySelector('.toast')||{}).textContent || null
  })`);

  console.log(JSON.stringify({
    before: JSON.parse(before || '{}'),
    mid: JSON.parse(mid || '{}'),
    clicked: clicked,
    after: JSON.parse(after || '{}'),
    setResponses: net,
    logs: [...new Set(logs)].slice(0, 5)
  }, null, 1));
  ws.close(); child.kill(); await sleep(200); process.exit(0);
})().catch((e) => { console.error('FAIL', e.message); child.kill(); process.exit(1); });
