// Проверка вкладок после удаления «Игроков»: кликаем по каждой, ловим ошибки.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const url = process.argv[2];
const outDir = process.argv[3] || '_tmp/tabs';
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9920 + Math.floor(Math.random() * 40);
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-tabs-'));
const child = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars', '--mute-audio',
  `--user-data-dir=${prof}`, `--remote-debugging-port=${port}`, '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
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
  await S('Page.enable'); await S('Runtime.enable'); await S('Log.enable');
  await S('Page.navigate', { url });
  await sleep(3500);
  const needLogin = await ev(`!!document.getElementById('authEmail') && getComputedStyle(document.getElementById('auth')).display !== 'none'`);
  if (needLogin) {
    await ev(`(() => { const t = [...document.querySelectorAll('button,div,span')].find(e => e.textContent.trim() === 'Вход'); if (t) t.click(); })()`);
    await sleep(800);
    await ev(`(() => { const set=(e,v)=>{e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));}; set(document.getElementById('authEmail'),'kent.vasya@rework.mail'); set(document.getElementById('authPass'),'kent-vasya-2026'); const b=[...document.querySelectorAll('button')].find(x=>/войти/i.test(x.textContent)); if(b)b.click(); })()`);
    await sleep(9000);
  }
  const tabs = await ev(`JSON.stringify([...document.querySelectorAll('.tab')].map(t => ({ v: t.dataset.view, t: t.textContent.trim() })))`);
  const res = [];
  for (const t of JSON.parse(tabs)) {
    const r = await ev(`(() => { const tab=[...document.querySelectorAll('.tab')].find(x=>x.dataset.view===${JSON.stringify(t.v)}); if(!tab) return 'нет таба'; tab.click(); const sec=document.getElementById('view-${t.v}'); return JSON.stringify({ shown: !!sec && sec.classList.contains('show'), h: sec ? Math.round(sec.getBoundingClientRect().height) : 0 }); })()`);
    await sleep(500);
    res.push({ view: t.v, name: t.t, ...JSON.parse(r === 'нет таба' ? '{"shown":"нет таба"}' : r) });
  }
  const nav = await ev(`JSON.stringify([...document.querySelectorAll('.tab')].map(t => t.textContent.trim()))`);
  const total = await ev(`(document.body.innerText.match(/ОБЩИЙ БАЛАНС[\\s\\S]{0,40}/) || [''])[0].replace(/\\s+/g,' ')`);
  console.log(JSON.stringify({ tabs: res, nav: JSON.parse(nav), total, logs: [...new Set(logs)].slice(0, 8) }, null, 1));
  ws.close(); child.kill(); await sleep(200); process.exit(0);
})().catch((e) => { console.error('FAIL', e.message); child.kill(); process.exit(1); });
