/* Offline test of market-prices.js: fake Netlify Blobs, simulated clock.
   Checks: hourly buckets -> real changeH/24h, catch-up clamp, payload shape. */
const fs = require('node:fs');
const path = require('node:path');

const SRC = 'C:\\KNOT\\SITE\\netlify\\functions';
const DIR = path.join(__dirname, '_mkt');
fs.mkdirSync(DIR, { recursive: true });

// stub store: in-memory map shared by all imports
fs.writeFileSync(path.join(DIR, 'blobs-stub.mjs'), `
const mem = new Map();
export function getStore() {
  return {
    async get(key) { return mem.has(key) ? JSON.parse(mem.get(key)) : null; },
    async setJSON(key, val) { mem.set(key, JSON.stringify(val)); return true; },
    async set(key, val) { mem.set(key, typeof val === 'string' ? val : JSON.stringify(val)); return true; }
  };
}
export function __mem() { return mem; }
`);

// copy market-coins.js as is, patch market-prices.js import
fs.copyFileSync(path.join(SRC, 'market-coins.js'), path.join(DIR, 'market-coins.js'));
let mp = fs.readFileSync(path.join(SRC, 'market-prices.js'), 'utf8');
mp = mp.replace("from '@netlify/blobs'", "from './blobs-stub.mjs'");
fs.writeFileSync(path.join(DIR, 'mp.mjs'), mp);

(async () => {
  const M = await import('file://' + path.join(DIR, 'mp.mjs').replace(/\\/g, '/'));

  const T0 = Date.UTC(2026, 10, 19, 6, 0, 0);       // старт
  const out = [];

  // 1. первый тик
  let r = await M.tickPrices(T0);
  out.push(['fresh tick', { steps: r.steps, btc: r.prices.BTC }]);

  // 2. сделка бота: покупка BTC на 20 млн ликвидности -> +6% (кламп)
  let f = await M.applyFlows({ BTC: 60000000 }, T0 + 20000);
  out.push(['flow +60M', { moved: f.moved, btc: f.prices.BTC }]);

  // 3. догон через час: не должен прыгнуть больше 4%
  const before = f.prices.BTC;
  r = await M.tickPrices(T0 + 3600 * 1000);
  const jump = Math.abs(r.prices.BTC / before - 1) * 100;
  out.push(['catchup 1h', { steps: r.steps, btc: r.prices.BTC, jumpPct: Math.round(jump * 100) / 100 }]);

  // 4. проживаем сутки по часу, смотрим часовые срезы и 24ч
  for (let h = 2; h <= 26; h++) {
    await M.tickPrices(T0 + h * 3600 * 1000);
  }
  const store = (await import('file://' + path.join(DIR, 'blobs-stub.mjs').replace(/\\/g, '/'))).__mem();
  const doc = JSON.parse(store.get('market'));
  out.push(['hour buckets BTC', { count: doc.hour.BTC.length, first: new Date(doc.hour.BTC[0][0]).toISOString(), last: new Date(doc.hour.BTC[doc.hour.BTC.length - 1][0]).toISOString() }]);
  out.push(['hist len BTC', doc.hist.BTC.length]);

  // 5. ручка: payload
  const req = new Request('https://x/api/market', { method: 'GET' });
  const res = await M.handleMarket(req, '/api/market', new URL('https://x/api/market'));
  const body = await res.json();
  out.push(['api ok', {
    ok: body.ok,
    hasHist: !!body.hist && Array.isArray(body.hist.BTC),
    histLen: body.hist ? body.hist.BTC.length : 0,
    btcChg: body.change24.BTC,
    btcSpanH: body.changeH.BTC,
    docKB: Math.round(store.get('market').length / 1024)
  }]);

  // 6. потолка по цене больше нет: при базе 80к просим 50 млн
  const big = await M.setPricesAny({ BTC: 50000000 }, { anchor: true });
  out.push(['no ceiling', { asked: 50000000, got: big.set ? big.set.BTC : null }]);
  const low = await M.setPricesAny({ BTC: 0.0001 }, { anchor: true });
  out.push(['no floor', { asked: 0.0001, got: low.set ? low.set.BTC : null }]);

  for (const row of out) console.log(row[0] + ': ' + JSON.stringify(row[1]));
})().catch(e => { console.error('FAIL', e); process.exit(1); });
