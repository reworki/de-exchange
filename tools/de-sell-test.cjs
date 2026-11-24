// Проверка: после продажи монеты не возвращаются на баланс.
// Логин через localStorage (тестовый аккаунт), продажа — как в игре (amt--, usdt+, trades.push, save()).
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const url = process.argv[2] || 'https://de-exchange.surge.sh';
const outDir = process.argv[3] || '_tmp/sell';
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9970 + Math.floor(Math.random() * 20);
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-sell-'));
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
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0].slice(0, 160));
  };
  const { targetId } = await send(ws, 'Target.createTarget', { url: 'about:blank' });
  const sessionId = (await send(ws, 'Target.attachToTarget', { targetId, flatten: true })).sessionId;
  const S = (m, p) => send(ws, m, p, sessionId);
  const ev = async (e) => { try { const r = await S('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return 'ERR ' + (r.exceptionDetails.exception?.description || '').split('\n')[0]; return r.result.value; } catch (e) { return 'EXC ' + e.message; } };
  await S('Page.enable'); await S('Runtime.enable');

  // 1. логин тестового аккаунта через localStorage
  await S('Page.navigate', { url });
  await sleep(2500);
  await ev(`localStorage.setItem('de_accounts_v1', JSON.stringify({list:[{nick:'kent_vasya',nick_lc:'kent_vasya',pass:'${process.env.DE_PASS||''}',wallet:'69621193'}],current:'kent_vasya'}))`);
  await S('Page.reload');
  await sleep(7000);

  const acc = await ev(`JSON.stringify({ acc: !!(window.__DE_ACC && window.__DE_ACC.nick), usdt: state.usdt, btc: BY.BTC.amt, eth: BY.ETH.amt })`);

  // 2а. покупка: набираем BTC и ETH, чтобы было что продавать
  const bought = await ev(`(function(){
    var out = {};
    ['BTC','ETH'].forEach(function(k){
      var a = BY[k], spend = state.usdt * 0.02;
      if (!(spend > 0)) return;
      var q = spend / a.price;
      a.amt += q; state.usdt -= spend;
      state.trades.push({ t: Date.now(), side: 'BUY', sym: k, qty: q, price: a.price, total: spend });
      out[k] = a.amt;
    });
    save(); renderAll();
    return JSON.stringify({ bought: out, usdt: state.usdt });
  })()`);
  await sleep(9000);                       // отправка сделки наверх + опрос состояния

  // 2б. продажа половины BTC и ETH по текущей цене
  const sold = await ev(`(function(){
    var out = {};
    ['BTC','ETH'].forEach(function(k){
      var a = BY[k], q = a.amt * 0.5;
      if (!(q > 0)) { out[k] = 'пусто'; return; }
      a.amt -= q; state.usdt += q * a.price;
      state.trades.push({ t: Date.now(), side: 'SELL', sym: k, qty: q, price: a.price, total: q * a.price });
      out[k] = a.amt;
    });
    save(); renderAll();
    return JSON.stringify({ left: out, usdt: state.usdt, localAt: window.DX_LOCAL_AT || 0 });
  })()`);

  await sleep(9000);
  const mid = await ev(`JSON.stringify({ btc: BY.BTC.amt, eth: BY.ETH.amt, usdt: state.usdt })`);
  await sleep(21000);
  const after = await ev(`JSON.stringify({ btc: BY.BTC.amt, eth: BY.ETH.amt, usdt: state.usdt })`);
  const srv = await ev(`fetch('https://de-exchange.netlify.app/api/state?nick=kent_vasya&pass=${process.env.DE_PASS||''}',{cache:'no-store'}).then(r=>r.json()).then(j=>{
    var st = j.state && j.state.ex ? JSON.parse(j.state.ex) : null;
    return JSON.stringify({ btc: st && st.amounts ? st.amounts.BTC : null, eth: st && st.amounts ? st.amounts.ETH : null, usdt: st ? st.usdt : null, updated: j.updated });
  }).catch(e=>'ERR '+e.message)`);

  const A = JSON.parse(acc || '{}'), Sd = JSON.parse(sold || '{}'), M = JSON.parse(mid || '{}'), F = JSON.parse(after || '{}');
  const s = String(srv).startsWith('{') ? JSON.parse(srv) : { raw: srv };
  const left = Sd.left || {};
  const okBtc = typeof left.BTC === 'number' && Math.abs((F.btc || 0) - left.BTC) < 1e-9;
  const okEth = typeof left.ETH === 'number' && Math.abs((F.eth || 0) - left.ETH) < 1e-9;
  const shot = await S('Page.captureScreenshot', { format: 'jpeg', quality: 84 });
  fs.writeFileSync(path.join(outDir, 'after-sell.jpg'), Buffer.from(shot.data, 'base64'));

  console.log(JSON.stringify({
    account: A,
    bought: JSON.parse(bought || '{}'),
    sold: Sd,
    after9s: M,
    after30s: F,
    server: s,
    verdict: (okBtc && okEth) ? 'OK: проданное не вернулось' : 'ПЛОХО: баланс откатился',
    logs: [...new Set(logs)].slice(0, 4)
  }, null, 1));
  ws.close(); child.kill(); await sleep(200); process.exit(0);
})().catch((e) => { console.error('FAIL', e.message); child.kill(); process.exit(1); });
