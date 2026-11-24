// Проверка, что новый NFT-контент подмешался в клиент, и скрин вкладки «Кейсы».
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const url = process.argv[2];
const outDir = process.argv[3] || '_tmp/nft-merge';
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9970 + Math.floor(Math.random() * 20);
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-nftm-'));
const child = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars', '--mute-audio',
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
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0].slice(0, 140));
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') logs.push('LOG ' + m.params.entry.text.slice(0, 120));
  };
  const { targetId } = await send(ws, 'Target.createTarget', { url: 'about:blank' });
  const sessionId = (await send(ws, 'Target.attachToTarget', { targetId, flatten: true })).sessionId;
  const S = (m, p) => send(ws, m, p, sessionId);
  const ev = async (e) => { const r = await S('Runtime.evaluate', { expression: e, returnByValue: true }); return r.exceptionDetails ? 'ERR ' + (r.exceptionDetails.exception?.description || '').split('\n')[0] : r.result.value; };
  const shot = async (n) => { const s = await S('Page.captureScreenshot', { format: 'jpeg', quality: 84 }); fs.writeFileSync(path.join(outDir, n), Buffer.from(s.data, 'base64')); };
  await S('Page.enable'); await S('Runtime.enable'); await S('Log.enable');
  await S('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await S('Page.navigate', { url });
  await sleep(4500);

  const info = await ev(`JSON.stringify({
    assets: (window.ASSETS || []).length,
    byKeys: Object.keys(window.BY || {}).length,
    dex: !!(window.BY && window.BY.DEX),
    dexAmt: window.BY && window.BY.DEX ? window.BY.DEX.amt : null,
    ticker: document.querySelectorAll('.tk').length,
    btc: window.BY && window.BY.BTC ? Math.round(window.BY.BTC.price) : null,
    liveOk: (window.DX_LIVE && window.DX_LIVE.lastOk) ? 1 : 0,
    skins: ['zoo_case','luxe_case','empire_case'].map(function (k) {
      return (window.CASE_ART && window.CASE_ART[k] ? window.CASE_ART[k].length : 0);
    }),
    swOptions: document.getElementById('swFrom') ? document.getElementById('swFrom').options.length : 0,
    cases: (window.CASES || []).length,
    models: (window.MODEL_LIST || []).length,
    arts: Object.keys(window.ART || {}).length,
    extra: !!window.DX_NFT_EXTRA,
    newCase: !!(window.CASE_BY && window.CASE_BY.zoo_case),
    newModel: !!(window.MODEL_BY && window.MODEL_BY.whale_tycoon),
    artLen: ((window.ART && window.ART.whale_tycoon) || '').length,
    caseNames: (window.CASES || []).map(function (c) { return c.ru || c.name; })
  })`);

  await ev(`(() => { const t=[...document.querySelectorAll('.tab')].find(x=>x.dataset.view==='cases'); if(t)t.click(); })()`);
  await sleep(2500);
  const casesText = await ev(`(() => { const v=document.getElementById('view-cases'); return v ? v.innerText.replace(/\\s+/g,' ').slice(0, 500) : ''; })()`);
  const cards = await ev(`document.querySelectorAll('#casesGrid .case-card').length`);
  const evBanner = await ev(`(() => { const e=document.getElementById('evBanner'); return e ? getComputedStyle(e).display : 'нет'; })()`);
  console.log('cards=' + cards + ' evBanner=' + evBanner);
  await shot('01-cases.jpg');

  console.log(JSON.stringify({ info: JSON.parse(info), casesText, logs: [...new Set(logs)].slice(0, 6) }, null, 1));
  ws.close(); child.kill(); await sleep(200); process.exit(0);
})().catch((e) => { console.error('FAIL', e.message); child.kill(); process.exit(1); });
