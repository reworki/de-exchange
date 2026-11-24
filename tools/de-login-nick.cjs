// Вход по нику + проверка занятости ника (без регистрации).
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const url = process.argv[2];
const outDir = process.argv[3] || '_tmp/login-nick';
const who = process.argv[4] || 'kent_vasya';
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9940 + Math.floor(Math.random() * 40);
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-nick-'));
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
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0].slice(0, 200));
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) logs.push(m.params.type.toUpperCase() + ' ' + m.params.args.map(a => a.value ?? a.description ?? a.type).join(' ').slice(0, 160));
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') logs.push('LOG ' + m.params.entry.text.slice(0, 160));
  };
  const { targetId } = await send(ws, 'Target.createTarget', { url: 'about:blank' });
  const sessionId = (await send(ws, 'Target.attachToTarget', { targetId, flatten: true })).sessionId;
  const S = (m, p) => send(ws, m, p, sessionId);
  const ev = async (e) => { const r = await S('Runtime.evaluate', { expression: e, returnByValue: true }); return r.exceptionDetails ? 'ERR ' + (r.exceptionDetails.exception?.description || '').split('\n')[0] : r.result.value; };

  await S('Page.enable'); await S('Runtime.enable'); await S('Log.enable');
  await S('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await S('Page.navigate', { url });
  await sleep(4000);

  const formOk = await ev(`JSON.stringify({ nick: !!document.getElementById('authNick'), email: !!document.getElementById('authEmail'), sub: (document.getElementById('authSub')||{}).textContent })`);

  // режим «Регистрация» — проверяем подсказки, никого не создаём
  await ev(`(() => { const t = document.querySelector('#authTabs .at[data-mode="reg"]'); if (t) t.click(); return !!t; })()`);
  await sleep(700);
  const typeNick = async (v) => {
    await ev(`(() => { const el = document.getElementById('authNick'); el.focus(); el.value = ${JSON.stringify(v)}; el.dispatchEvent(new Event('input', { bubbles: true })); return el.value; })()`);
  };
  await typeNick('ke');
  await sleep(500);
  const shortStat = await ev(`(document.getElementById('authNickStat') || {}).textContent || ''`);
  await typeNick('kent_vasya');
  await sleep(1500);
  const busyStat = await ev(`(document.getElementById('authNickStat') || {}).textContent || ''`);
  const regErr = await ev(`(document.getElementById('authErr') || {}).textContent || ''`);
  const accCountBefore = await ev(`(window.__DE_DB && window.__DE_DB.list) ? window.__DE_DB.list.length : -1`);
  await S('Page.captureScreenshot', { format: 'jpeg', quality: 80 }).then((s) => fs.writeFileSync(path.join(outDir, '01-reg.png'), Buffer.from(s.data, 'base64')));

  // режим «Вход» — входим существующим аккаунтом
  await ev(`(() => { const t = document.querySelector('#authTabs .at[data-mode="login"]'); if (t) t.click(); return !!t; })()`);
  await sleep(600);
  await ev(`(() => {
    const set = (el, v) => { el.focus(); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
    set(document.getElementById('authNick'), ${JSON.stringify(who)});
    set(document.getElementById('authPass'), 'kent-vasya-2026');
    const b = document.getElementById('authGo');
    if (b) b.click();
    return 'submitted';
  })()`);
  await sleep(12000);

  const state = await ev(`JSON.stringify({
    title: document.title,
    total: ((document.body.innerText.match(/ОБЩИЙ БАЛАНС[\\s\\S]{0,40}/) || [''])[0] || '').replace(/\\s+/g, ' '),
    keys: Object.keys(localStorage).filter(k => /exchange_v3|sync_v1|accounts/.test(k)),
    hasNickKey: !!localStorage.getItem('de_exchange_v3__kent_vasya'),
    usdt: (function () { try { var j = JSON.parse(localStorage.getItem('de_exchange_v3__kent_vasya') || 'null'); return j && j.usdt; } catch (e) { return 'parse'; } })(),
    cur: (window.__DE_DB && window.__DE_DB.current) || null,
    accNick: (window.__DE_ACC && (window.__DE_ACC.nick || window.__DE_ACC.nick_lc)) || null,
    panel: (document.getElementById('accEmail') || {}).textContent || '',
    authVisible: !!document.getElementById('auth') && getComputedStyle(document.getElementById('auth')).display !== 'none'
  })`);
  const accCountAfter = await ev(`(window.__DE_DB && window.__DE_DB.list) ? window.__DE_DB.list.length : -1`);
  await S('Page.captureScreenshot', { format: 'jpeg', quality: 80 }).then((s) => fs.writeFileSync(path.join(outDir, '02-login.png'), Buffer.from(s.data, 'base64')));

  console.log(JSON.stringify({
    form: JSON.parse(formOk),
    reg: { shortStat, busyStat, regErr, accCountBefore, accCountAfter },
    login: JSON.parse(state),
    logs: [...new Set(logs)].slice(0, 8)
  }, null, 1));
  ws.close(); child.kill(); await sleep(200); process.exit(0);
})().catch((e) => { console.error('FAIL', e.message); child.kill(); process.exit(1); });
