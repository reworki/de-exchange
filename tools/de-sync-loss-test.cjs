// DE: проверяем, что будет, если локальные данные аккаунта пропали, а метка синка осталась.
// POST /api/state блокируется на уровне CDP — чтобы тест ничего не затёр на сервере.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const url = process.argv[2] || 'https://de-exchange.surge.sh';
const outDir = process.argv[3] || '_tmp/sync-loss';
const email = process.argv[4];
const pass = process.argv[5];
const mode = process.argv[6] || 'stamp';   // stamp | clear | reset

fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9900 + Math.floor(Math.random() * 90);
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-sync-'));
const child = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars', '--mute-audio',
  `--user-data-dir=${prof}`, `--remote-debugging-port=${port}`, '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });

let id = 0; const pending = new Map(); const logs = []; let blocked = 0;
const send = (ws, m, p = {}, s) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p, sessionId: s })); });

(async () => {
  let wsUrl;
  for (let i = 0; i < 100; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); const j = await r.json(); if (j.webSocketDebuggerUrl) { wsUrl = j.webSocketDebuggerUrl; break; } } catch {} await sleep(200); }
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let sessionId = null;
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); return; }
    if (m.method === 'Fetch.requestPaused') {
      const r = m.params.request;
      if (r.method === 'POST' && /\/api\/state/.test(r.url)) {
        blocked++;
        send(ws, 'Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 500, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from('{"err":"blocked by test"}').toString('base64') }, m.sessionId).catch(() => {});
      } else {
        send(ws, 'Fetch.continueRequest', { requestId: m.params.requestId }, m.sessionId).catch(() => {});
      }
      return;
    }
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0]);
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') logs.push('LOG ' + m.params.entry.text.slice(0, 140));
  };

  const { targetId } = await send(ws, 'Target.createTarget', { url: 'about:blank' });
  ({ sessionId } = await send(ws, 'Target.attachToTarget', { targetId, flatten: true }));
  const S = (m, p) => send(ws, m, p, sessionId);
  const ev = async (e, aw = false) => { const r = await S('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: aw }); if (r.exceptionDetails) return 'ERR ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text).split('\n')[0]; return r.result.value; };
  const totalNow = () => ev(`(() => { const m = document.body.innerText.match(/ОБЩИЙ БАЛАНС[\\s\\S]{0,60}/); return m ? m[0].replace(/\\s+/g, ' ') : 'нет строки'; })()`);

  await S('Page.enable'); await S('Runtime.enable'); await S('Log.enable');
  await S('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  await S('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  const login = async () => {
    await S('Page.navigate', { url });
    await sleep(3500);
    await ev(`(() => { const t = [...document.querySelectorAll('button,div,span')].find(e => e.textContent.trim() === 'Вход'); if (t) t.click(); return !!t; })()`);
    await sleep(800);
    await ev(`(() => {
      const inputs = [...document.querySelectorAll('input')];
      const set = (el, v) => { el.focus(); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
      const mail = inputs.find(i => i.id === 'authEmail');
      const pw = inputs.find(i => i.id === 'authPass');
      if (mail) set(mail, ${JSON.stringify(email)});
      if (pw) set(pw, ${JSON.stringify(pass)});
      const b = [...document.querySelectorAll('button')].find(x => /войти|вход/i.test(x.textContent));
      if (b) b.click();
      return !!b;
    })()`);
    await sleep(9000);
  };

  await login();
  const before = await totalNow();

  let lost = '{"skipped":true}';
  if (mode === 'resetall') {
    lost = await ev(`(() => { resetAll(); return JSON.stringify({ called: true, reset: localStorage.getItem('de_reset_v1__' + (window.__DE_DB || {}).current) }); })()`);
  } else if (mode === 'oldreset') {
    lost = await ev(`(() => { resetAll(); localStorage.setItem('de_reset_v1__' + (window.__DE_DB || {}).current, String(Date.now() - 3600000)); return JSON.stringify({ called: true, aged: true }); })()`);
  } else if (mode !== 'plain') {
  lost = await ev(`(() => {
    const email = window.__DE_DB && window.__DE_DB.current;
    const drop = [];
    Object.keys(localStorage).forEach(k => {
      if (k.indexOf('de_exchange_v3__') === 0) { localStorage.removeItem(k); drop.push(k); }
      if (k.indexOf('de_nft_v1__') === 0) { localStorage.removeItem(k); drop.push(k); }
      if (k.indexOf('de_ext_v1__') === 0) { localStorage.removeItem(k); drop.push(k); }
      if (${JSON.stringify(mode)} === 'clear' && k.indexOf('de_sync_v1__') === 0) { localStorage.removeItem(k); drop.push(k); }
    });
    if (${JSON.stringify(mode)} === 'reset') { localStorage.setItem('de_started_v1__' + email, '1'); }
    if (${JSON.stringify(mode)} === 'panel') { localStorage.setItem('de_reset_v1__' + email, String(Date.now())); }
    return JSON.stringify({ email, drop });
  })()`);
  }

  await S('Page.reload', { ignoreCache: true });
  await sleep(9000);
  const after = await totalNow();
  const afterBoot = await ev(`JSON.stringify({ keys: Object.keys(localStorage).filter(k => /exchange|sync|started/.test(k)), usdt: (function(){ try { var j = JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.indexOf('de_exchange_v3') === 0) || 'x') || 'null'); return j && j.usdt; } catch(e){ return 'parse'; } })(), healN: sessionStorage.getItem('de_heal_n'), toast: (document.getElementById('toast') || {}).textContent || '' })`);

  let panel = null;
  if (mode === 'panel') {
    await ev(`(() => { dxAccPanel(true); return 'opened'; })()`);
    await sleep(2500);
    const before2 = await ev(`JSON.stringify({ srv: (document.getElementById('accSrvVal') || {}).textContent, loc: (document.getElementById('accLocVal') || {}).textContent, btn: !!(document.getElementById('accPull')) })`);
    await ev(`(() => { window.confirm = function () { return true; }; dxForcePull(); return 'pulled'; })()`);
    await sleep(8000);
    const after2 = await totalNow();
    const keys2 = await ev(`JSON.stringify({ reset: localStorage.getItem('de_reset_v1__' + (window.__DE_DB || {}).current), ex: !!localStorage.getItem('de_exchange_v3__' + (window.__DE_DB || {}).current) })`);
    panel = { before2: JSON.parse(before2), after2, keys2: JSON.parse(keys2) };
  }

  console.log(JSON.stringify({ mode, before, lost: JSON.parse(lost), after, afterBoot: JSON.parse(afterBoot), panel, blockedPushes: blocked, logs: [...new Set(logs)].slice(0, 6) }, null, 1));
  ws.close(); child.kill(); await sleep(200); process.exit(0);
})().catch((e) => { console.error('FAIL', e.message); child.kill(); process.exit(1); });
