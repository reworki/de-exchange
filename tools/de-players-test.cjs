// Verify the players page with a mocked /api/players and /api/profile.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const url = process.argv[2];
const outDir = process.argv[3];
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9970 + Math.floor(Math.random() * 20);
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp20-'));
const child = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars', '--mute-audio',
  `--user-data-dir=${prof}`, `--remote-debugging-port=${port}`, '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });
let id = 0; const pending = new Map(); const logs = [];
const send = (ws, m, p = {}, s) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p, sessionId: s })); });

const PLAYERS = {
  ok: true,
  players: [
    { wallet: '55555555', email: 'k***7@gmail.com', admin: true, created: 1770000000000, lastSeen: Date.now() - 120000, stats: { usdt: 576727758731668, amounts: { KNT: 31205272.2433, BTC: 99790012.58 }, nft: 8, trades: 12 } },
    { wallet: '87378525', email: 's***d@c++.com', admin: false, created: 1794990000000, lastSeen: Date.now() - 3600000, stats: { usdt: 0, amounts: {}, nft: 1, trades: 0 } },
    { wallet: '69621193', email: 'k***a@rework.mail', admin: false, created: 1794946652143, lastSeen: Date.now() - 7200000, stats: { usdt: 576727759732638, amounts: {}, nft: 0, trades: 3 } }
  ]
};
const PROFILE = { ok: true, player: PLAYERS.players[0] };

(async () => {
  let wsUrl;
  for (let i = 0; i < 100; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); const j = await r.json(); if (j.webSocketDebuggerUrl) { wsUrl = j.webSocketDebuggerUrl; break; } } catch {} await sleep(200); }
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = async (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); return; }
    if (m.method === 'Fetch.requestPaused' && !process.env.NOMOCK) {
      const u = m.params.request.url;
      let body = null;
      if (u.includes('/api/players')) body = PLAYERS;
      else if (u.includes('/api/profile')) body = PROFILE;
      if (body) {
        await send(ws, 'Fetch.fulfillRequest', {
          requestId: m.params.requestId, responseCode: 200,
          responseHeaders: [{ name: 'content-type', value: 'application/json' }, { name: 'access-control-allow-origin', value: '*' }],
          body: Buffer.from(JSON.stringify(body)).toString('base64')
        }, sessionId);
        return;
      }
      await send(ws, 'Fetch.continueRequest', { requestId: m.params.requestId }, sessionId);
      return;
    }
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (m.params.exceptionDetails.exception?.description || '').split('\n')[0]);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push('ERR ' + m.params.args.map(a => a.value ?? a.description ?? a.type).join(' ').slice(0, 120));
  };
  const { targetId } = await send(ws, 'Target.createTarget', { url: 'about:blank' });
  var sessionId = (await send(ws, 'Target.attachToTarget', { targetId, flatten: true })).sessionId;
  const S = (m, p) => send(ws, m, p, sessionId);
  const ev = async (e) => { const r = await S('Runtime.evaluate', { expression: e, returnByValue: true }); return r.exceptionDetails ? 'ERR ' + (r.exceptionDetails.exception?.description || '').split('\n')[0] : r.result.value; };
  const shot = async (n) => { const s = await S('Page.captureScreenshot', { format: 'jpeg', quality: 82 }); fs.writeFileSync(path.join(outDir, n), Buffer.from(s.data, 'base64')); };
  await S('Page.enable'); await S('Runtime.enable');
  if (!process.env.NOMOCK) await S('Fetch.enable', { patterns: [{ urlPattern: '*api/players*' }, { urlPattern: '*api/profile*' }] });
  await S('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await S('Page.navigate', { url });
  await sleep(4200);
  await ev(`(() => { const t = [...document.querySelectorAll('button,div,span')].find(e => e.textContent.trim() === 'Вход'); if (t) t.click(); })()`);
  await sleep(700);
  await ev(`(() => { const i = [...document.querySelectorAll('input')]; const set = (e, v) => { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }; const m = i.find(x => x.type === 'email'); const p = i.filter(x => x.type === 'password')[0]; if (m) set(m, 'kent.vasya@rework.mail'); if (p) set(p, 'kent-vasya-2026'); const b = [...document.querySelectorAll('button')].find(x => /войти/i.test(x.textContent)); if (b) b.click(); })()`);
  await sleep(9000);
  await ev(`showView('players')`);
  await sleep(1500);
  const info = await ev(`JSON.stringify({ cards: document.querySelectorAll('#playersBox .aitem').length, first: (document.querySelector('#playersBox .anm') || {}).textContent || '', privacyBtn: (document.getElementById('plPrivacy') || {}).textContent || '' })`);
  await shot('players.png');
  await ev(`dxPlayerOpen('55555555')`);
  await sleep(1200);
  const modal = await ev(`JSON.stringify({ open: document.getElementById('playerModal').classList.contains('on'), title: document.getElementById('pmTitle').textContent, wallet: document.getElementById('pmWallet').textContent, total: document.getElementById('pmTotal').textContent, rows: document.querySelectorAll('#pmStats .logrow').length })`);
  await shot('player-profile.png');
  console.log(JSON.stringify({ info: JSON.parse(info), modal: JSON.parse(modal), logs: [...new Set(logs)].slice(0, 6) }, null, 1));
  ws.close(); child.kill(); await sleep(200); process.exit(0);
})().catch((e) => { console.error('FAIL', e.message); child.kill(); process.exit(1); });
