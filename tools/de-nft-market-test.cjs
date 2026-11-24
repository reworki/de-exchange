// Живой маркет NFT: видны ли лоты ботов, не падает ли вкладка.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const url = process.argv[2];
const outDir = process.argv[3] || '_tmp/nft-market';
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9990 + Math.floor(Math.random() * 9);
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-mk-'));
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
  await sleep(4000);

  const needLogin = await ev(`!!document.getElementById('authNick') && getComputedStyle(document.getElementById('auth')).display !== 'none'`);
  if (needLogin) {
    await ev(`(() => { const t=[...document.querySelectorAll('#authTabs .at')].find(x=>x.dataset.mode==='login'); if(t)t.click(); })()`);
    await sleep(400);
    await ev(`(() => { const set=(e,v)=>{e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));};
      set(document.getElementById('authNick'),'kent_vasya');
      set(document.getElementById('authPass'),'kent-vasya-2026');
      const b=[...document.querySelectorAll('#authForm button')].find(x=>/войти/i.test(x.textContent)); if(b)b.click(); })()`);
    await sleep(9000);
  }

  await ev(`(() => { const t=[...document.querySelectorAll('.tab')].find(x=>x.dataset.view==='market'); if(t)t.click(); })()`);
  await sleep(4000);
  const info = await ev(`(() => {
    const grid = document.getElementById('mkGrid');
    const lots = [...document.querySelectorAll('#mkGrid .mk-lot')];
    const sellers = lots.map(x => ((x.querySelector('.by')||{}).textContent||'').replace('продавец: ','')).filter(Boolean);
    return JSON.stringify({
      count: lots.length,
      sellerSample: sellers.slice(0, 6),
      hasBotLots: (window.ext && ext.market && ext.market.lots ? ext.market.lots.filter(l=>l.botLot).length : 0),
      text: grid ? grid.innerText.replace(/\\s+/g,' ').slice(0, 260) : ''
    });
  })()`);
  await shot('01-market.jpg');
  console.log(JSON.stringify({ info: JSON.parse(info), logs: [...new Set(logs)].slice(0, 6) }, null, 1));
  ws.close(); child.kill(); await sleep(200); process.exit(0);
})().catch((e) => { console.error('FAIL', e.message); child.kill(); process.exit(1); });
