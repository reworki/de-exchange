// Диагностика отправки состояния: почему POST /api/state не доходит.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const url = process.argv[2] || 'https://de-exchange.surge.sh';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9990 + Math.floor(Math.random() * 20);
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-push-'));
const child = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--mute-audio',
  `--user-data-dir=${prof}`, `--remote-debugging-port=${port}`, '--window-size=1200,900', 'about:blank'], { stdio: 'ignore' });
let id = 0; const pending = new Map(); const net = [];
const send = (ws, m, p = {}, s) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p, sessionId: s })); });
(async () => {
  let wsUrl;
  for (let i = 0; i < 100; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); const j = await r.json(); if (j.webSocketDebuggerUrl) { wsUrl = j.webSocketDebuggerUrl; break; } } catch {} await sleep(200); }
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); return; }
    if (m.method === 'Network.requestWillBeSent' && /\/api\/state/.test(m.params.request.url)) net.push(m.params.request.method + ' ' + m.params.request.url.slice(-90));
    if (m.method === 'Network.responseReceived' && /\/api\/state/.test(m.params.response.url)) net.push('  → ' + m.params.response.status);
  };
  const { targetId } = await send(ws, 'Target.createTarget', { url: 'about:blank' });
  const sessionId = (await send(ws, 'Target.attachToTarget', { targetId, flatten: true })).sessionId;
  const S = (m, p) => send(ws, m, p, sessionId);
  const ev = async (e) => { try { const r = await S('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return 'ERR ' + (r.exceptionDetails.exception?.description || '').split('\n')[0]; return r.result.value; } catch (e) { return 'EXC ' + e.message; } };
  await S('Page.enable'); await S('Runtime.enable'); await S('Network.enable');

  await S('Page.navigate', { url });
  await sleep(2500);
  await ev(`localStorage.setItem('de_accounts_v1', JSON.stringify({list:[{nick:'kent_vasya',nick_lc:'kent_vasya',pass:'${process.env.DE_PASS||''}',wallet:'69621193'}],current:'kent_vasya'}))`);
  await S('Page.reload');
  await sleep(6000);

  const diag1 = await ev(`JSON.stringify({
    basis: (typeof deBasis==='function') ? deBasis(window.__DE_ACC) : 'нет deBasis',
    accKeys: window.__DE_ACC ? Object.keys(window.__DE_ACC) : null,
    online: (typeof deApiOnline==='function') ? deApiOnline() : null,
    blocked: window.dePushBlocked, hasSaveWrapper: (''+save).indexOf('deSyncQueue') >= 0,
    lastPush: window.deLastPush || '', busy: !!window.DX_STATE_BUSY
  })`);
  await sleep(2500);

  const diag2 = await ev(`JSON.stringify({
    lastPush: window.deLastPush || '', busy: !!window.DX_STATE_BUSY, blocked: window.dePushBlocked,
    stamp: deSyncStamp(deBasis(window.__DE_ACC)),
    localAt: window.DX_LOCAL_AT || 0
  })`);
  await sleep(2500);
  // ручная отправка ТЕКУЩЕГО локального состояния: работает ли POST вообще
  const manual = await ev(`fetch('https://de-exchange.netlify.app/api/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nick:'kent_vasya',pass:'${process.env.DE_PASS||''}',state:deStateBundle()})}).then(r=>r.text()).then(t=>t.slice(0,160)).catch(e=>'ERR '+e.message)`);

  console.log(JSON.stringify({
    diag1: JSON.parse(diag1 || '{}'),
    diag2: JSON.parse(diag2 || '{}'),
    manualPost: manual,
    stateTraffic: net.slice(0, 10)
  }, null, 1));
  ws.close(); child.kill(); await sleep(200); process.exit(0);
})().catch((e) => { console.error('FAIL', e.message); child.kill(); process.exit(1); });
