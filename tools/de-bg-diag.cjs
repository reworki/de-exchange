// Кто рисует фон страницы: цепочка элементов под точкой (5,5) и их фоны.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const url = process.argv[2] || 'http://127.0.0.1:8807/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9850 + Math.floor(Math.random() * 20);
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-bgdiag-'));
const child = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--mute-audio',
  `--user-data-dir=${prof}`, `--remote-debugging-port=${port}`, '--window-size=1200,900', 'about:blank'], { stdio: 'ignore' });
let id = 0; const pending = new Map();
const send = (ws, m, p = {}, s) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p, sessionId: s })); });
(async () => {
  let wsUrl;
  for (let i = 0; i < 100; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); const j = await r.json(); if (j.webSocketDebuggerUrl) { wsUrl = j.webSocketDebuggerUrl; break; } } catch {} await sleep(200); }
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
  };
  const { targetId } = await send(ws, 'Target.createTarget', { url: 'about:blank' });
  const sessionId = (await send(ws, 'Target.attachToTarget', { targetId, flatten: true })).sessionId;
  const S = (m, p) => send(ws, m, p, sessionId);
  const ev = async (e) => { const r = await S('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? 'ERR ' + (r.exceptionDetails.exception?.description || '').split('\n')[0] : r.result.value; };
  await S('Page.enable'); await S('Runtime.enable');
  await S('Page.navigate', { url });
  await sleep(2500);
  await ev(`localStorage.setItem('de_accounts_v1', JSON.stringify({list:[{nick:'kent_vasya',nick_lc:'kent_vasya',pass:'${process.env.DE_PASS||''}',wallet:'69621193'}],current:'kent_vasya'}))`);
  await S('Page.reload');
  await sleep(6000);
  const out = await ev(`(function(){
    var rows = [], el = document.elementFromPoint(6, 6), guard = 0;
    while (el && guard++ < 14) {
      var cs = getComputedStyle(el);
      rows.push({
        tag: el.tagName, id: el.id || '', cls: (el.className || '').toString().slice(0, 40),
        bg: cs.backgroundColor, img: (cs.backgroundImage || '').slice(0, 70),
        z: cs.zIndex, pos: cs.position, op: cs.opacity
      });
      el = el.parentElement;
    }
    var probe = null;
    try {
      var c = document.getElementById('dx-bg-canvas');
      if (c) {
        var g = c.getContext('2d');
        var d = g.getImageData(0, 0, Math.min(300, c.width), Math.min(300, c.height)).data;
        var sum = 0, max = 0, n = d.length / 4;
        for (var i = 3; i < d.length; i += 4) { sum += d[i]; if (d[i] > max) max = d[i]; }
        probe = { alphaAvg: Math.round(sum / n), alphaMax: max, w: c.width, h: c.height, dpr: window.devicePixelRatio };
      }
    } catch (e) { probe = 'ERR ' + e.message; }
    return JSON.stringify({ rows: rows, dark: document.body.classList.contains('dark'), probe: probe,
      hero: (function(){ var h = document.querySelector('.hero'); if (!h) return null; var cs = getComputedStyle(h); return { bgImg: (cs.backgroundImage||'').slice(0,120), bgColor: cs.backgroundColor, blur: cs.backdropFilter || cs.webkitBackdropFilter, border: cs.borderColor }; })(),
      canvas: (function(){ var c = document.getElementById('dx-bg-canvas'); if (!c) return null; var r = c.getBoundingClientRect(); var cs = getComputedStyle(c); return { w: r.width, h: r.height, z: cs.zIndex, pos: cs.position, vis: cs.visibility, display: cs.display, parentId: c.parentElement.id }; })() });
  })()`);
  console.log(JSON.stringify(JSON.parse(out || '{}'), null, 1));
  ws.close(); child.kill(); await sleep(200); process.exit(0);
})().catch((e) => { console.error('FAIL', e.message); child.kill(); process.exit(1); });
