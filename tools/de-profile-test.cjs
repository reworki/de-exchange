// Профиль/лента/топ + витрина: логинимся по нику и проверяем вкладки и сцену.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const url = process.argv[2];
const outDir = process.argv[3] || '_tmp/profile';
const nick = process.argv[4] || 'kent_vasya';
const pass = process.argv[5] || 'kent-vasya-2026';
const W = Number(process.argv[6] || 1440);
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9930 + Math.floor(Math.random() * 40);
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-prof-'));
const child = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars', '--mute-audio',
  `--user-data-dir=${prof}`, `--remote-debugging-port=${port}`, `--window-size=${W},1000`, 'about:blank'], { stdio: 'ignore' });
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
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') logs.push('LOG ' + m.params.entry.text.slice(0, 140));
  };
  const { targetId } = await send(ws, 'Target.createTarget', { url: 'about:blank' });
  const sessionId = (await send(ws, 'Target.attachToTarget', { targetId, flatten: true })).sessionId;
  const S = (m, p) => send(ws, m, p, sessionId);
  const ev = async (e) => { const r = await S('Runtime.evaluate', { expression: e, returnByValue: true }); return r.exceptionDetails ? 'ERR ' + (r.exceptionDetails.exception?.description || '').split('\n')[0] : r.result.value; };
  const shot = async (n) => { const s = await S('Page.captureScreenshot', { format: 'jpeg', quality: 82 }); fs.writeFileSync(path.join(outDir, n), Buffer.from(s.data, 'base64')); };
  await S('Page.enable'); await S('Runtime.enable'); await S('Log.enable');
  await S('Emulation.setDeviceMetricsOverride', { width: W, height: 1000, deviceScaleFactor: 1, mobile: W < 600 });
  await S('Page.navigate', { url });
  await sleep(4000);

  const needLogin = await ev(`!!document.getElementById('authNick') && getComputedStyle(document.getElementById('auth')).display !== 'none'`);
  if (needLogin) {
    await ev(`(() => { const t=[...document.querySelectorAll('#authTabs .at')].find(x=>x.dataset.mode==='login'); if (t) t.click(); })()`);
    await sleep(500);
    await ev(`(() => { const set=(e,v)=>{e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));};
      set(document.getElementById('authNick'), ${JSON.stringify(nick)});
      set(document.getElementById('authPass'), ${JSON.stringify(pass)});
      const b=[...document.querySelectorAll('#authForm button')].find(x=>/войти|зарегистр/i.test(x.textContent)); if(b)b.click(); })()`);
    await sleep(9000);
  }
  const afterLogin = await ev(`JSON.stringify({ acc: (window.__DE_ACC||{}).nick || null, total: (document.body.innerText.match(/ОБЩИЙ БАЛАНС[\\s\\S]{0,40}/)||[''])[0].replace(/\\s+/g,' ') })`);

  // профиль
  await ev(`(() => { const t=[...document.querySelectorAll('.tab')].find(x=>x.dataset.view==='profile'); if(t) t.click(); })()`);
  await sleep(3000);
  const profile = await ev(`(() => {
    const v = document.getElementById('view-profile');
    const box = document.getElementById('dxSceneBox');
    return JSON.stringify({
      shown: !!v && v.classList.contains('show'),
      text: v ? v.innerText.replace(/\\s+/g,' ').slice(0, 420) : '',
      sceneBox: !!box,
      sceneHtml: box ? box.innerHTML.length : 0,
      sceneImg: box ? !!box.querySelector('img') : false,
      sceneSvg: box ? !!box.querySelector('svg') : false,
      editorBtn: !!([...document.querySelectorAll('#view-profile .btn, #view-profile button')].find(b => /Редактор/i.test(b.textContent)))
    });
  })()`);
  await shot('01-profile.jpg');

  // редактор витрины
  const editor = await ev(`(() => { const b=[...document.querySelectorAll('#view-profile .btn, #view-profile button')].find(x=>/Редактор/i.test(x.textContent)); if(!b) return 'нет кнопки'; b.click(); return 'clicked'; })()`);
  await sleep(2500);
  const editorState = await ev(`(() => { const o=document.getElementById('dxPeOverlay'); return JSON.stringify({ opened: !!o && getComputedStyle(o).display !== 'none', text: o ? o.innerText.replace(/\\s+/g,' ').slice(0,260) : '' }); })()`);
  await shot('02-editor.jpg');
  await ev(`(() => { const o=document.getElementById('dxPeOverlay'); if(o){ const c=o.querySelector('button[aria-label*="Закр"], .dxpe-x, button'); } const esc=new KeyboardEvent('keydown',{key:'Escape',bubbles:true}); document.dispatchEvent(esc); return 'esc'; })()`);
  await sleep(600);

  // лента и топ
  await ev(`(() => { const t=[...document.querySelectorAll('.tab')].find(x=>x.dataset.view==='feed'); if(t)t.click(); })()`);
  await sleep(2500);
  const feed = await ev(`(() => { const v=document.getElementById('view-feed'); return JSON.stringify({ shown: !!v && v.classList.contains('show'), text: v ? v.innerText.replace(/\\s+/g,' ').slice(0,300) : '' }); })()`);
  await ev(`(() => { const t=[...document.querySelectorAll('.tab')].find(x=>x.dataset.view==='top'); if(t)t.click(); })()`);
  await sleep(2500);
  const top = await ev(`(() => { const v=document.getElementById('view-top'); return JSON.stringify({ shown: !!v && v.classList.contains('show'), text: v ? v.innerText.replace(/\\s+/g,' ').slice(0,300) : '' }); })()`);
  await shot('03-top.jpg');

  console.log(JSON.stringify({
    afterLogin: JSON.parse(afterLogin),
    profile: JSON.parse(profile),
    editor,
    editorState: JSON.parse(editorState),
    feed: JSON.parse(feed),
    top: JSON.parse(top),
    logs: [...new Set(logs)].slice(0, 10)
  }, null, 1));
  ws.close(); child.kill(); await sleep(200); process.exit(0);
})().catch((e) => { console.error('FAIL', e.message); child.kill(); process.exit(1); });
