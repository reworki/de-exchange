// Универсальный снимок страницы: node shot.cjs <url> <out> [waitMs] [w] [h]
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const url = process.argv[2];
const out = process.argv[3] || '_tmp/shot.png';
const wait = Number(process.argv[4] || 3000);
const W = Number(process.argv[5] || 1600), H = Number(process.argv[6] || 900);
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9600 + Math.floor(Math.random() * 60);
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-shot-'));
const child = spawn(EDGE, ['--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader', '--no-first-run',
  '--hide-scrollbars', '--mute-audio', `--user-data-dir=${prof}`, `--remote-debugging-port=${port}`,
  `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' });

let id = 0; const pending = new Map(); const logs = [];
const send = (ws, m, p = {}, s) => new Promise((res, rej) => {
  const i = ++id; pending.set(i, { res, rej });
  ws.send(JSON.stringify({ id: i, method: m, params: p, sessionId: s }));
});

(async () => {
  let wsUrl;
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      const j = await r.json();
      if (j.webSocketDebuggerUrl) { wsUrl = j.webSocketDebuggerUrl; break; }
    } catch {}
    await sleep(200);
  }
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
      return;
    }
    if (m.method === 'Runtime.exceptionThrown') {
      logs.push('EXC ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0].slice(0, 200));
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      logs.push('ERR ' + (m.params.args || []).map(a => a.value || a.description).join(' ').slice(0, 200));
    }
  };
  const { targetId } = await send(ws, 'Target.createTarget', { url: 'about:blank' });
  const sessionId = (await send(ws, 'Target.attachToTarget', { targetId, flatten: true })).sessionId;
  const S = (m, p) => send(ws, m, p, sessionId);
  await S('Page.enable'); await S('Runtime.enable');
  await S('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await S('Page.navigate', { url });
  await sleep(wait);
  const probe = await S('Runtime.evaluate', { expression: 'JSON.stringify(window.__diamond || null)', returnByValue: true }).catch(() => null);
  const shot = await S('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log(JSON.stringify({ ok: true, out, probe: probe && probe.result && probe.result.value, logs: [...new Set(logs)].slice(0, 5) }));
  ws.close(); child.kill(); await sleep(150); process.exit(0);
})().catch(e => { console.error('FAIL', e.message); child.kill(); process.exit(1); });
