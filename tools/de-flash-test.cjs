// Проверка цвета вспышек фона: up должно быть зелёным, down — красным.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const url = process.argv[2] || 'http://127.0.0.1:8807/';
const outDir = process.argv[3] || '_tmp/flash';
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9880 + Math.floor(Math.random() * 15);
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-flash-'));
const child = spawn(EDGE, ['--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader', '--no-first-run', '--hide-scrollbars', '--mute-audio',
  `--user-data-dir=${prof}`, `--remote-debugging-port=${port}`, '--window-size=1200,800', 'about:blank'], { stdio: 'ignore' });
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
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (m.params.exceptionDetails.exception?.description || '').split('\n')[0].slice(0, 120));
  };
  const { targetId } = await send(ws, 'Target.createTarget', { url: 'about:blank' });
  const sessionId = (await send(ws, 'Target.attachToTarget', { targetId, flatten: true })).sessionId;
  const S = (m, p) => send(ws, m, p, sessionId);
  const ev = async (e) => { const r = await S('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? 'ERR ' + (r.exceptionDetails.exception?.description || '').split('\n')[0] : r.result.value; };
  const shot = async (n) => { const s = await S('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(outDir, n), Buffer.from(s.data, 'base64')); };
  await S('Page.enable'); await S('Runtime.enable');
  await S('Emulation.setDeviceMetricsOverride', { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
  await S('Page.navigate', { url });
  await sleep(3000);
  await ev(`localStorage.setItem('de_accounts_v1', JSON.stringify({list:[{nick:'kent_vasya',nick_lc:'kent_vasya',pass:'${process.env.DE_PASS||''}',wallet:'69621193'}],current:'kent_vasya'}))`);
  await S('Page.reload');
  await sleep(6000);
  await shot('00-idle.png');
  /* цвет lerp-ится, поэтому сначала даём состоянию устояться */
  await ev(`window.dxBg && window.dxBg.setMarket({up:true, vol:0.8, pulse:null})`);
  await sleep(1800);
  await shot('01-up-base.png');
  await ev(`window.dxBg && window.dxBg.setMarket({up:true, vol:0.8, pulse:'up'})`);
  await sleep(90);
  await shot('02-pulse-up.png');
  await ev(`window.dxBg && window.dxBg.setMarket({up:false, vol:0.8, pulse:null})`);
  await sleep(1800);
  await shot('03-down-base.png');
  await ev(`window.dxBg && window.dxBg.setMarket({up:false, vol:0.8, pulse:'down'})`);
  await sleep(90);
  await shot('04-pulse-down.png');
  await ev(`window.dxBg && window.dxBg.setMarket({up:true, vol:0.8, pulse:null})`);
  await sleep(1500);
  await ev(`window.dxBg && window.dxBg.flash('up')`);
  await sleep(70);
  await shot('05-flash-up.png');
  await ev(`window.dxBg && window.dxBg.setMarket({up:false, vol:0.8, pulse:null})`);
  await sleep(1500);
  await ev(`window.dxBg && window.dxBg.flash('down')`);
  await sleep(70);
  await shot('06-flash-down.png');
  console.log(JSON.stringify({ ok: true, logs: [...new Set(logs)].slice(0, 4) }));
  ws.close(); child.kill(); await sleep(200); process.exit(0);
})().catch((e) => { console.error('FAIL', e.message); child.kill(); process.exit(1); });
