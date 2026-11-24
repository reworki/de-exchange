// Рендерим сцену с тестовыми данными (квартира + ювелирка + номера) и снимаем скрин.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const url = process.argv[2];
const outDir = process.argv[3] || '_tmp/scene';
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9950 + Math.floor(Math.random() * 30);
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-scene-'));
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
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0].slice(0, 140));
  };
  const { targetId } = await send(ws, 'Target.createTarget', { url: 'about:blank' });
  const sessionId = (await send(ws, 'Target.attachToTarget', { targetId, flatten: true })).sessionId;
  const S = (m, p) => send(ws, m, p, sessionId);
  const ev = async (e) => { const r = await S('Runtime.evaluate', { expression: e, returnByValue: true }); return r.exceptionDetails ? 'ERR ' + (r.exceptionDetails.exception?.description || '').split('\n')[0] : r.result.value; };
  await S('Page.enable'); await S('Runtime.enable');
  await S('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
  await S('Page.navigate', { url });
  await sleep(4000);

  const cases = [
    { name: '01-flat', home: 'flat', wear: [], stands: ['55555555', '12345678', '11110000'] },
    { name: '02-penthouse', home: 'penthouse', wear: [], stands: ['55555555', '87378525', '69621193', '00000002'] },
    { name: '03-castle', home: 'castle', wear: [], stands: ['11111111', '22222222'] }
  ];

  for (const c of cases) {
    await ev(`(() => {
      let box = document.getElementById('dxSceneDemo');
      if (!box) {
        box = document.createElement('div');
        box.id = 'dxSceneDemo';
        box.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#0b0f1a;padding:24px;display:flex;align-items:center;justify-content:center';
        document.body.appendChild(box);
      }
      box.innerHTML = '<div id="dxSceneTarget" style="width:min(1200px,96vw)"></div>';
      window.dxScene.render(document.getElementById('dxSceneTarget'), ${JSON.stringify({ nick: 'kent_vasya', home: c.home, wear: c.wear, stands: c.stands, avatar: { emoji: '🐺', color: '#c0561b' } })});
      return 'ok';
    })()`);
    await sleep(1200);
    const shot = await S('Page.captureScreenshot', { format: 'jpeg', quality: 88 });
    fs.writeFileSync(path.join(outDir, c.name + '.jpg'), Buffer.from(shot.data, 'base64'));
  }

  const info = await ev(`JSON.stringify({ hasScene: !!window.dxScene, imgs: document.querySelectorAll('#dxSceneTarget img').length, svg: !!document.querySelector('#dxSceneTarget svg') })`);
  console.log(JSON.stringify({ info: JSON.parse(info), logs: [...new Set(logs)].slice(0, 5), out: outDir }, null, 1));
  ws.close(); child.kill(); await sleep(200); process.exit(0);
})().catch((e) => { console.error('FAIL', e.message); child.kill(); process.exit(1); });
