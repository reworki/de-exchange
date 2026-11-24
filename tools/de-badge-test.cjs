// Check the version badge fits in the header at several widths.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const url = process.argv[2];
const outDir = process.argv[3];
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9920 + Math.floor(Math.random() * 40);
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp19-'));
const child = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars', '--mute-audio',
  `--user-data-dir=${prof}`, `--remote-debugging-port=${port}`, '--window-size=1440,700', 'about:blank'], { stdio: 'ignore' });
let id = 0; const pending = new Map(); const logs = [];
const send = (ws, m, p = {}, s) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p, sessionId: s })); });
(async () => {
  let wsUrl;
  for (let i = 0; i < 100; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); const j = await r.json(); if (j.webSocketDebuggerUrl) { wsUrl = j.webSocketDebuggerUrl; break; } } catch {} await sleep(200); }
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); return; } if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (m.params.exceptionDetails.exception?.description || '').split('\n')[0]); if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push('ERR ' + m.params.args.map(a => a.value ?? a.description ?? a.type).join(' ').slice(0, 120)); };
  const { targetId } = await send(ws, 'Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send(ws, 'Target.attachToTarget', { targetId, flatten: true });
  const S = (m, p) => send(ws, m, p, sessionId);
  const ev = async (e) => { const r = await S('Runtime.evaluate', { expression: e, returnByValue: true }); return r.exceptionDetails ? 'ERR ' + (r.exceptionDetails.exception?.description || '').split('\n')[0] : r.result.value; };
  const shot = async (n) => { const s = await S('Page.captureScreenshot', { format: 'jpeg', quality: 85 }); fs.writeFileSync(path.join(outDir, n), Buffer.from(s.data, 'base64')); };
  await S('Page.enable'); await S('Runtime.enable');

  const results = [];
  for (const width of [1440, 1180, 1024]) {
    await S('Emulation.setDeviceMetricsOverride', { width, height: 700, deviceScaleFactor: 1, mobile: false });
    await S('Page.navigate', { url });
    await sleep(4200);
    const info = await ev(`JSON.stringify((function(){
      var b = document.getElementById('deCountdown') || document.getElementById('deVer');
      var head = b ? b.closest('.topbar, header') : null;
      var r = b ? b.getBoundingClientRect() : null;
      var hr = head ? head.getBoundingClientRect() : null;
      return {
        text: b ? b.textContent : 'no badge',
        right: r ? Math.round(r.right) : null,
        headerRight: hr ? Math.round(hr.right) : null,
        inside: r && hr ? (r.right <= hr.right + 1 && r.left >= hr.left - 1) : null,
        clipped: b ? (b.scrollWidth > b.clientWidth + 1) : null,
        scrollW: document.documentElement.scrollWidth,
        innerW: window.innerWidth,
        toast: (document.getElementById('toast') || {}).textContent || ''
      };
    })())`);
    results.push({ width, info: JSON.parse(info) });
    await shot('badge-' + width + '.png');
  }
  await sleep(3000);
  const toastLater = await ev(`(document.getElementById('toast') || {}).textContent || ''`);
  console.log(JSON.stringify({ results, toastLater, logs: [...new Set(logs)].slice(0, 5) }, null, 1));
  ws.close(); child.kill(); await sleep(200); process.exit(0);
})().catch((e) => { console.error('FAIL', e.message); child.kill(); process.exit(1); });
