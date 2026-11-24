// Проверка «цена переживает F5»: после перезагрузки курс не должен прыгать.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const url = process.argv[2] || 'https://de-exchange.surge.sh';
const outDir = process.argv[3] || '_tmp/refresh';
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9950 + Math.floor(Math.random() * 20);
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-refresh-'));
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
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0].slice(0, 160));
  };
  const { targetId } = await send(ws, 'Target.createTarget', { url: 'about:blank' });
  const sessionId = (await send(ws, 'Target.attachToTarget', { targetId, flatten: true })).sessionId;
  const S = (m, p) => send(ws, m, p, sessionId);
  const ev = async (e) => { try { const r = await S('Runtime.evaluate', { expression: e, returnByValue: true }); return r.exceptionDetails ? null : r.result.value; } catch { return null; } };
  await S('Page.enable'); await S('Runtime.enable');

  await S('Page.navigate', { url });
  await sleep(1200);
  const cold = await ev(`(window.BY && BY.BTC && BY.BTC.price) || null`);
  await sleep(5000);

  const before = await ev(`JSON.stringify({
    btc: window.BY && BY.BTC ? BY.BTC.price : null,
    hist: window.BY && BY.BTC ? BY.BTC.hist.length : 0,
    cache: (function(){ try { var o = JSON.parse(localStorage.getItem('de_mkt_v1')||'null'); return o ? Math.round((Date.now()-o.at)/1000) : -1; } catch(e){ return -2; } })(),
    srv: window.BY && BY.BTC ? !!BY.BTC.srv : false
  })`);

  /* тёплая перезагрузка: кэш уже есть — именно этот случай ругался у Никиты */
  await S('Page.reload');
  await sleep(3000);
  const warm = await ev(`JSON.stringify({ btc: window.BY && BY.BTC ? BY.BTC.price : null, hist: window.BY && BY.BTC ? BY.BTC.hist.length : 0 })`);

  await S('Page.reload');
  const samples = [];
  for (let i = 0; i < 40; i++) {
    await sleep(60);
    const p = await ev(`(window.BY && BY.BTC && BY.BTC.price) || null`);
    if (typeof p === 'number' && p > 0) samples.push(p);
  }
  await sleep(2500);
  const after = await ev(`JSON.stringify({
    btc: window.BY && BY.BTC ? BY.BTC.price : null,
    hist: window.BY && BY.BTC ? BY.BTC.hist.length : 0,
    srv: window.BY && BY.BTC ? !!BY.BTC.srv : false,
    nav: performance.getEntriesByType('navigation').length
  })`);

  const b = JSON.parse(before || '{}');
  const a = JSON.parse(after || '{}');
  const w = JSON.parse(warm || '{}');
  const base = Number(b.btc) || 0;
  const devs = samples.map((p) => Math.abs(p / base - 1) * 100);
  const worst = devs.length ? Math.max(...devs) : null;
  const shot = await S('Page.captureScreenshot', { format: 'jpeg', quality: 84 });
  fs.writeFileSync(path.join(outDir, 'after-reload.jpg'), Buffer.from(shot.data, 'base64'));

  console.log(JSON.stringify({
    coldLoadPriceAt1200ms: cold,
    basePriceForReference: 80000,
    beforeReload: b,
    warmReload: w,
    afterReload: a,
    firstSampleAfterReload: samples[0] || null,
    samplesCount: samples.length,
    worstDeviationPct: worst === null ? null : Math.round(worst * 100) / 100,
    verdict: (worst !== null && worst < 1.5) ? 'OK: F5 не двигает курс' : 'ПЛОХО: цена уехала',
    logs: [...new Set(logs)].slice(0, 5)
  }, null, 1));
  ws.close(); child.kill(); await sleep(200); process.exit(0);
})().catch((e) => { console.error('FAIL', e.message); child.kill(); process.exit(1); });
