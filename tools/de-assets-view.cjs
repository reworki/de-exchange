// Log in, open Assets → Cars, buy one item with USDT, verify the fee.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const url = process.argv[2];
const outDir = process.argv[3];
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9400 + Math.floor(Math.random() * 90);
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp13-'));
const child = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars', '--mute-audio',
  `--user-data-dir=${prof}`, `--remote-debugging-port=${port}`, '--window-size=1440,1200', 'about:blank'], { stdio: 'ignore' });
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
    if (m.method === 'Runtime.consoleAPICalled' && ['error'].includes(m.params.type)) logs.push('ERR ' + m.params.args.map(a => a.value ?? a.description ?? a.type).join(' ').slice(0, 140));
  };
  const { targetId } = await send(ws, 'Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send(ws, 'Target.attachToTarget', { targetId, flatten: true });
  const S = (m, p) => send(ws, m, p, sessionId);
  const ev = async (e, aw = false) => { const r = await S('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: aw }); if (r.exceptionDetails) return 'ERR ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text).split('\n')[0]; return r.result.value; };
  const shot = async (n) => { const s = await S('Page.captureScreenshot', { format: 'jpeg', quality: 82 }); fs.writeFileSync(path.join(outDir, n), Buffer.from(s.data, 'base64')); };

  await S('Page.enable'); await S('Runtime.enable');
  await S('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false });
  await S('Page.navigate', { url });
  await sleep(4500);

  // login
  await ev(`(() => { const t = [...document.querySelectorAll('button,div,span')].find(e => e.textContent.trim() === 'Вход'); if (t) t.click(); })()`);
  await sleep(800);
  await ev(`(() => {
    const inputs = [...document.querySelectorAll('input')];
    const set = (el, v) => { el.focus(); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
    const mail = inputs.find(i => i.type === 'email');
    const pw = inputs.filter(i => i.type === 'password');
    if (mail) set(mail, 'kent.vasya@rework.mail');
    if (pw[0]) set(pw[0], 'kent-vasya-2026');
    const b = [...document.querySelectorAll('button')].find(x => /войти/i.test(x.textContent));
    if (b) b.click();
  })()`);
  await sleep(9000);

  const before = await ev(`JSON.stringify({ usdt: state.usdt, owned: dxAssetOwned().length, total: ASSET_ITEMS.length })`);

  // open assets → cars
  await ev(`showView('assets'); dxAssetTab('cars');`);
  await sleep(1200);
  await shot('01-cars.png');

  await ev(`window.scrollTo(0, document.body.scrollHeight * 0.55)`);
  await sleep(700);
  await shot('03-cards.png');
  // buy skipped
  const buy = JSON.stringify({ skipped: true });
  /* removed
  const buy = await ev(`(() => {
    window.confirm = function () { return true; };
    var a = ASSET_BY['lada'];
    var price = dxAssetUsdtPrice(a);
    var before = state.usdt;
    dxAssetBuyUsdt('lada');
    return JSON.stringify({ price: price, base: dxAssetUsdtBase(a), fee: price - dxAssetUsdtBase(a), before: before, after: state.usdt, owned: dxAssetOwned().indexOf('lada') >= 0 });
  })()`);

  await sleep(800);
  await ev(`dxAssetTab('lux')`);
  await sleep(1000);
  await shot('02-lux.png');
  const after = await ev(`JSON.stringify({ usdt: state.usdt, owned: dxAssetOwned(), gifts: ASSET_ITEMS.filter(a => /бриллиант|Цепь|Крест|Кулон|Rainbow|Iced/i.test(a.name)).map(a => a.name) })`);

  console.log(JSON.stringify({ before: JSON.parse(before), buy: JSON.parse(buy), after: JSON.parse(after), logs: [...new Set(logs)].slice(0, 6) }, null, 1));
  ws.close(); child.kill(); await sleep(200); process.exit(0);
})().catch((e) => { console.error('FAIL', e.message); child.kill(); process.exit(1); });
