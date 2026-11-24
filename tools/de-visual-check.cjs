// Визуальная проверка демо: фон, сцена профиля, полёт монет.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const url = process.argv[2] || 'http://127.0.0.1:8807/';
const outDir = process.argv[3] || '_tmp/visual';
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9810 + Math.floor(Math.random() * 20);
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-visual-'));
const child = spawn(EDGE, ['--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader', '--no-first-run', '--hide-scrollbars', '--mute-audio',
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
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0].slice(0, 150));
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') logs.push('LOG ' + String(m.params.entry.text).slice(0, 120));
  };
  const { targetId } = await send(ws, 'Target.createTarget', { url: 'about:blank' });
  const sessionId = (await send(ws, 'Target.attachToTarget', { targetId, flatten: true })).sessionId;
  const S = (m, p) => send(ws, m, p, sessionId);
  const ev = async (e) => { try { const r = await S('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return 'ERR ' + (r.exceptionDetails.exception?.description || '').split('\n')[0]; return r.result.value; } catch (e) { return 'EXC ' + e.message; } };
  const shot = async (n) => { const s = await S('Page.captureScreenshot', { format: 'jpeg', quality: 86 }); fs.writeFileSync(path.join(outDir, n), Buffer.from(s.data, 'base64')); };
  await S('Page.enable'); await S('Runtime.enable'); await S('Log.enable');
  await S('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

  await S('Page.navigate', { url });
  await sleep(4000);
  await shot('01-login-bg.jpg');

  // вход тестовым аккаунтом и главный экран
  await ev(`localStorage.setItem('de_accounts_v1', JSON.stringify({list:[{nick:'kent_vasya',nick_lc:'kent_vasya',pass:'${process.env.DE_PASS||''}',wallet:'69621193'}],current:'kent_vasya'}))`);
  await S('Page.reload');
  await sleep(6500);
  if (process.argv[4] === 'light') {
    await ev(`(function(){ if (typeof applyTheme === 'function') applyTheme('light'); return 1; })()`);
    await sleep(1400);
  }
  await shot('05-app.jpg');

  // вкладка профиля — там сцена
  await ev(`(function(){ if (typeof showView === 'function') showView('profile'); return 1; })()`);
  await sleep(3500);
  await shot('06-profile.jpg');

  const boot = await ev(`JSON.stringify({
    bg: !!window.dxBg, canvas: !!document.getElementById('dx-bg-canvas'),
    fx: !!window.dxFx, scene: !!window.dxScene, plus: !!window.__dxsPlusInstalled
  })`);

  // сцена профиля в тестовый контейнер
  await ev(`(function(){
    var host = document.createElement('div');
    host.id = '__vis_host';
    host.style.cssText = 'position:fixed;left:40px;top:120px;width:420px;height:300px;z-index:99999;border-radius:18px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.6)';
    document.body.appendChild(host);
    window.__vis_scene = window.dxScene.render(host, { nick: 'kent_vasya', home: '', stands: [], capital: 2.1e15 });
    return !!window.__vis_scene;
  })()`);
  await sleep(1500);
  await shot('02-scene.jpg');

  // полёт монет
  await ev(`(function(){
    var a = document.getElementById('__vis_host');
    var b = document.querySelector('.auth-card') || a;
    if (window.dxFx && a) window.dxFx.trade({ side: 'SELL', total: 5e12, fromEl: a, toEl: b });
    return !!window.dxFx;
  })()`);
  await sleep(280);
  await shot('03-coins.jpg');
  await sleep(900);
  await shot('04-after.jpg');

  console.log(JSON.stringify({
    boot: JSON.parse(boot || '{}'),
    logs: [...new Set(logs)].slice(0, 6)
  }, null, 1));
  ws.close(); child.kill(); await sleep(200); process.exit(0);
})().catch((e) => { console.error('FAIL', e.message); child.kill(); process.exit(1); });
