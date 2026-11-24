/* ============================================================================
   Калибровочный симулятор ботов DE Exchange.
   Запуск из C:\KNOT\SITE:  node tools/sim-bots.mjs

   50 ботов, 3000 тиков (тик = 20 минут игрового времени ≈ «день»).
   Считает капитал по базовым ценам, применяет заявки transfer_plan (как это
   делал бы runtime: атомарно, в одном проходе) и печатает срез распределения
   на 60 / 300 / 1000 / 3000 тиках, а также проверки на детерминизм и мусор.

   Ничего не пишет на диск и не ходит в сеть — только console.log.
   ============================================================================ */

import {
  BOT_START_USDT,
  TICK_MS,
  personaFor,
  startCapital,
  stepBot,
  mulberry32
} from '../netlify/functions/bot-brain.js';

const BOTS = 50;
const TICKS = 3000;
/* второй аргумент — сид: 
ode tools/sim-bots.mjs 2. Разные ники дают
   разные броски, поэтому один и тот же код проверяется на нескольких сидах. */
const SEED = Math.max(1, Math.floor(Number(process.argv[2]) || 1));
const T0 = Date.UTC(2026, 0, 1, 0, 0, 0);

import { MARKET_PRICES } from '../netlify/functions/market-coins.js';

const PRICES = Object.assign({
  KNT: 325000, BTC: 80000, ETH: 3200, SOL: 220,
  LTC: 60, GRAM: 2.5, ZBS: 1.2,
  SHIB: 0.00000065, STOCK: 180, BOND: 1350
}, MARKET_PRICES);

/* ---------- аккаунты ---------- */

function makeAccount(i) {
  const persona = personaFor(i);
  const rnd = mulberry32(0x9e3779b9 ^ Math.imul(i + 1, 0x85ebca6b));
  const cap = startCapital(persona, rnd);
  const nick = SEED === 1 ? 'bot' + (i + 1) : 'bot' + SEED + '_' + (i + 1);
  return {
    nick: nick,
    nick_lc: nick,
    pass: 'x',
    wallet: String(10000001 + i),
    admin: false,
    bot: true,
    persona: persona,
    created: T0,
    updated: T0,
    last_seen: T0,
    bio: '',
    avatar: { emoji: '🐺', color: '#c0561b' },
    privacy: { hideBalance: false, private: false },
    social: { followers: 0, following: 0 },
    state: {
      ex: JSON.stringify({ v: 3, usdt: cap, amounts: {}, trades: [] }),
      nft: null,
      ext: null,
      led: null
    }
  };
}

function readEx(acc) {
  let obj = null;
  try { obj = JSON.parse(acc.state.ex); } catch (e) { obj = null; }
  const ex = (obj && typeof obj === 'object') ? obj : {};
  ex.usdt = Number(ex.usdt) || 0;
  ex.amounts = (ex.amounts && typeof ex.amounts === 'object') ? ex.amounts : {};
  ex.trades = Array.isArray(ex.trades) ? ex.trades : [];
  return ex;
}

function writeEx(acc, ex) {
  acc.state = Object.assign({}, acc.state, { ex: JSON.stringify(ex) });
}

function capitalOf(acc) {
  const ex = readEx(acc);
  let cap = Number(ex.usdt) || 0;
  for (const k in ex.amounts) {
    const p = PRICES[String(k).toUpperCase()];
    if (p) cap += (Number(ex.amounts[k]) || 0) * p;
  }
  return isFinite(cap) && cap > 0 ? cap : 0;
}

/* runtime-часть перевода: списываем и зачисляем в одном проходе */
function applyTransfer(fromAcc, toAcc, amount, now) {
  const from = readEx(fromAcc);
  if (!(amount > 0) || from.usdt < amount) return 0;
  from.usdt -= amount;
  from.trades.unshift({ t: now, side: 'SEND', sym: 'USDT', qty: amount, price: 1, total: amount });
  if (from.trades.length > 60) from.trades.length = 60;
  writeEx(fromAcc, from);

  const to = readEx(toAcc);
  to.usdt += amount;
  to.trades.unshift({ t: now, side: 'RECV', sym: 'USDT', qty: amount, price: 1, total: amount });
  if (to.trades.length > 60) to.trades.length = 60;
  writeEx(toAcc, to);
  return amount;
}

/* ---------- статистика ---------- */

function sortedCaps(accs) {
  return accs.map(capitalOf).sort((a, b) => a - b);
}

function pct(sorted, p) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[i];
}

function gini(values) {
  const v = values.filter((x) => x > 0).sort((a, b) => a - b);
  const n = v.length;
  if (!n) return 0;
  let sum = 0;
  let w = 0;
  for (let i = 0; i < n; i++) {
    sum += v[i];
    w += (i + 1) * v[i];
  }
  if (!(sum > 0)) return 0;
  return (2 * w) / (n * sum) - (n + 1) / n;
}

function snapshot(accs) {
  const sorted = sortedCaps(accs);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    tick: 0,
    median: pct(sorted, 0.5),
    p90: pct(sorted, 0.9),
    p99: pct(sorted, 0.99),
    max: sorted[sorted.length - 1],
    min: sorted[0],
    gini: gini(sorted),
    over1e9: sorted.filter((x) => x > 1e9).length,
    over1e12: sorted.filter((x) => x > 1e12).length,
    over1e15: sorted.filter((x) => x > 1e15).length,
    over1e16: sorted.filter((x) => x > 1e16).length,
    over2e15: sorted.filter((x) => x > 2e15).length,
    under100k: sorted.filter((x) => x < 1e5).length,
    total: sum,
    sorted: sorted
  };
}

/* ---------- формат ---------- */

function fmt(n) {
  const a = Math.abs(n);
  if (!isFinite(n)) return 'Infinity!';
  if (a >= 1e15) return (n / 1e15).toFixed(2) + 'Q';
  if (a >= 1e12) return (n / 1e12).toFixed(2) + 'T';
  if (a >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (a >= 1e4) return (n / 1e3).toFixed(1) + 'k';
  return String(Math.round(n));
}

function exact(n) {
  const r = Math.round(n);
  if (!isFinite(r)) return 'Infinity!';
  if (Math.abs(r) >= 1e15) return fmt(r);
  const s = String(r);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ' ';
    out += s[i];
  }
  return out;
}

function pad(s, w, right) {
  s = String(s);
  while (s.length < w) s = right ? s + ' ' : ' ' + s;
  return s;
}

function growth(x, base) {
  return '×' + (base > 0 ? (x / base).toFixed(x / base >= 100 ? 0 : 2) : '0');
}

/* ============================================================================
   ПРОГОН
   ============================================================================ */

const accs = [];
for (let i = 0; i < BOTS; i++) accs.push(makeAccount(i));

const startCaps = accs.map(capitalOf);
const baseMedian = startCaps.slice().sort((a, b) => a - b)[Math.floor(BOTS / 2)];

const checkpointTicks = [60, 300, 1000, 3000];
const snaps = [];
const startSnap = snapshot(accs);
startSnap.tick = 0;
snaps.push(startSnap);
let planCount = 0;
let planSum = 0;

const startedAt = Date.now();

for (let tick = 1; tick <= TICKS; tick++) {
  const now = T0 + tick * TICK_MS;

  for (let i = 0; i < BOTS; i++) {
    const res = stepBot(accs[i], accs[i].persona, { now: now, prices: PRICES, tick: tick });
    accs[i] = res.acc;
    if (res.notes && res.notes.plan) {
      const plan = res.notes.plan;
      let j = plan.toSeed % (BOTS - 1);
      if (j >= i) j += 1;                      // получатель — всегда другой бот
      applyTransfer(accs[i], accs[j], plan.amount, now);
      planCount++;
      planSum += plan.amount;
    }
  }

  if (checkpointTicks.indexOf(tick) >= 0) {
    const s = snapshot(accs);
    s.tick = tick;
    snaps.push(s);
  }
}

const elapsed = Date.now() - startedAt;

/* ============================================================================
   ПРОВЕРКИ
   ============================================================================ */

function checkInside(name, acc) {
  const problems = [];
  if (!acc || typeof acc !== 'object') return [name + ': аккаунт не объект'];
  const state = acc.state && typeof acc.state === 'object' ? acc.state : null;
  if (!state) return [name + ': нет state'];
  if (typeof state.ex !== 'string' || !state.ex.length) return [name + ': нет state.ex'];
  let ex = null;
  try { ex = JSON.parse(state.ex); } catch (e) { return [name + ': ex не парсится']; }
  if (!ex || typeof ex !== 'object') return [name + ': ex не объект'];
  if (typeof ex.usdt !== 'number' || !isFinite(ex.usdt) || ex.usdt < 0) problems.push('usdt=' + ex.usdt);
  const amounts = ex.amounts && typeof ex.amounts === 'object' ? ex.amounts : {};
  for (const k in amounts) {
    const v = amounts[k];
    if (typeof v !== 'number' || !isFinite(v) || v < 0) problems.push('amounts.' + k + '=' + v);
  }
  if (/e[+-]\d/i.test(state.ex)) problems.push('экспоненциальная запись в ex');
  if (Array.isArray(ex.trades) && ex.trades.length > 60) problems.push('trades=' + ex.trades.length + ' > 60');
  return problems.length ? [name + ': ' + problems.join(', ')] : [];
}

function runChecks() {
  const out = [];
  const now = T0 + 100 * TICK_MS;
  const ctx = { now: now, prices: PRICES, tick: 100 };

  /* --- детерминизм --- */
  const probe = makeAccount(7);
  const p = personaFor(7);
  const a1 = stepBot(JSON.parse(JSON.stringify(probe)), p, ctx);
  const a2 = stepBot(JSON.parse(JSON.stringify(probe)), p, ctx);
  const same = JSON.stringify(a1.acc) === JSON.stringify(a2.acc) &&
    JSON.stringify(a1.events) === JSON.stringify(a2.events) &&
    JSON.stringify(a1.notes) === JSON.stringify(a2.notes);
  out.push(['детерминизм (один now дважды)', same ? 'ok' : 'FAIL']);
  out.push(['входной аккаунт не мутируется', JSON.stringify(probe) === JSON.stringify(makeAccount(7)) ? 'ok' : 'FAIL']);

  /* --- сон бота: 10 разных тиков, часть должна быть «спит» --- */
  let slept = 0;
  for (let t = 0; t < 40; t++) {
    const r = stepBot(makeAccount(3), personaFor(3), { now: T0 + t * TICK_MS, prices: PRICES, tick: t });
    if (!r.events.length && r.acc.state.ex === makeAccount(3).state.ex) slept++;
  }
  out.push(['спящие тики не трогают счёт', slept > 0 ? 'ok (' + slept + '/40)' : 'FAIL']);

  /* --- кривые входы --- */
  const broken = [
    ['без state', { nick: 'x', nick_lc: 'x' }],
    ['state без ex', { nick: 'x', nick_lc: 'x', state: { nft: null } }],
    ['битый JSON', { nick: 'x', nick_lc: 'x', state: { ex: '{oops' } }],
    ['usdt: 0', { nick: 'x', nick_lc: 'x', state: { ex: '{"v":3,"usdt":0,"amounts":{},"trades":[]}' } }],
    ['usdt: 1e15', { nick: 'x', nick_lc: 'x', state: { ex: '{"v":3,"usdt":1e15,"amounts":{"KNT":3e9},"trades":[]}' } }],
    ['минус и NaN', { nick: 'x', nick_lc: 'x', state: { ex: '{"v":3,"usdt":-50,"amounts":{"BTC":-2,"ETH":null,"SOL":"abc"},"trades":[]}' } }],
    ['nft строкой', { nick: 'x', nick_lc: 'x', state: { ex: '{"v":3,"usdt":90000,"amounts":{}}', nft: '{"items":[],"opened":0}' } }]
  ];
  for (const [name, acc] of broken) {
    let problems = [];
    try {
      for (let t = 0; t < 12; t++) {
        const r = stepBot(acc, personaFor(11), { now: T0 + (200 + t) * TICK_MS, prices: PRICES, tick: 200 + t });
        problems = problems.concat(checkInside(name, r.acc));
      }
    } catch (e) {
      problems.push(name + ': упал — ' + e.message);
    }
    out.push(['кривой вход: ' + name, problems.length ? problems[0] : 'ok']);
  }

  /* --- гигантский капитал не рождает Infinity --- */
  const hugeAcc = makeAccount(9);
  hugeAcc.state.ex = JSON.stringify({ v: 3, usdt: 1e18, amounts: { KNT: 1e9, ZBS: 1e18 }, trades: [] });
  let hugeOk = true;
  for (let t = 0; t < 30; t++) {
    const r = stepBot(hugeAcc, personaFor(9), { now: T0 + (400 + t) * TICK_MS, prices: PRICES, tick: 400 + t });
    hugeAcc.state = r.acc.state;
    const ex = readEx(hugeAcc);
    if (!isFinite(ex.usdt) || ex.usdt < 0) hugeOk = false;
    for (const k in ex.amounts) if (!isFinite(ex.amounts[k])) hugeOk = false;
    if (/e[+-]\d/i.test(hugeAcc.state.ex)) hugeOk = false;
  }
  out.push(['1e18 в счёте: без Infinity/NaN/экспоненты', hugeOk ? 'ok' : 'FAIL']);

  /* --- события: текст и длина --- */
  let evTotal = 0;
  let evBad = 0;
  let evKeys = {};
  for (let i = 0; i < BOTS; i++) {
    for (let t = 0; t < 30; t++) {
      const r = stepBot(makeAccount(i), personaFor(i), { now: T0 + (600 + t) * TICK_MS, prices: PRICES, tick: 600 + t });
      for (const e of r.events) {
        evTotal++;
        evKeys[e.kind] = (evKeys[e.kind] || 0) + 1;
        if (!e.text || Array.from(e.text).length > 90 || /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(e.text)) evBad++;
      }
    }
  }
  out.push(['события: тексты ≤90 символов, без эмодзи', evBad === 0 ? 'ok (' + evTotal + ' шт.)' : 'FAIL (' + evBad + '/' + evTotal + ')']);
  out.push(['виды событий', Object.keys(evKeys).sort().join(', ')]);

  return out;
}

/* ============================================================================
   ПЕЧАТЬ
   ============================================================================ */

console.log('');
console.log('DE Exchange — калибровка ботов-игроков');
console.log('ботов: ' + BOTS + ', тиков: ' + TICKS + ' (по ' + (TICK_MS / 60000) + ' мин), старт: ' + BOT_START_USDT + ' USDT, сид: ' + SEED);
console.log('стартовый капитал: медиана ' + exact(baseMedian) + ', разброс ' +
  exact(startCaps.slice().sort((a, b) => a - b)[0]) + '..' +
  exact(startCaps.slice().sort((a, b) => a - b)[BOTS - 1]));
console.log('');

console.log('=== распределение капитала ===');
console.log(pad('тик', 6, true) + pad('медиана', 12, true) + pad('p90', 12, true) +
  pad('p99', 12, true) + pad('max', 12, true) + pad('min', 10, true) + pad('джини', 8, true));
for (const s of snaps) {
  console.log(
    pad(String(s.tick), 6, true) +
    pad(fmt(s.median), 12, true) +
    pad(fmt(s.p90), 12, true) +
    pad(fmt(s.p99), 12, true) +
    pad(fmt(s.max), 12, true) +
    pad(fmt(s.min), 10, true) +
    pad(s.gini.toFixed(3), 8, true)
  );
}

console.log('');
console.log('=== рост к медиане старта (×) ===');
console.log(pad('тик', 6, true) + pad('медиана', 10, true) + pad('p90', 10, true) +
  pad('p99', 10, true) + pad('max', 12, true) + pad('min', 10, true));
for (const s of snaps) {
  console.log(
    pad(String(s.tick), 6, true) +
    pad(growth(s.median, baseMedian), 10, true) +
    pad(growth(s.p90, baseMedian), 10, true) +
    pad(growth(s.p99, baseMedian), 10, true) +
    pad(growth(s.max, baseMedian), 12, true) +
    pad(growth(s.min, baseMedian), 10, true)
  );
}

console.log('');
console.log('=== хвост: сколько ботов перевалило порог ===');
console.log(pad('тик', 6, true) + pad('>1e12', 8, true) + pad('>1e15', 8, true) +
  pad('>1e16', 8, true) + pad('>2e15', 8, true) + pad('<100k', 8, true) + pad('сумма', 14, true));
for (const s of snaps) {
  console.log(
    pad(String(s.tick), 6, true) +
    pad(String(s.over1e12), 8, true) +
    pad(String(s.over1e15), 8, true) +
    pad(String(s.over1e16), 8, true) +
    pad(String(s.over2e15), 8, true) +
    pad(String(s.under100k), 8, true) +
    pad(fmt(s.total), 14, true)
  );
}

/* топ и дно на последнем чекпоинте */
const last = snaps[snaps.length - 1];
const rows = accs.map((acc, i) => ({
  nick: acc.nick,
  cap: capitalOf(acc),
  start: startCaps[i],
  persona: acc.persona
})).sort((a, b) => b.cap - a.cap);

console.log('');
console.log('=== топ-5 на тике ' + last.tick + ' ===');
for (let i = 0; i < 5; i++) {
  const r = rows[i];
  console.log(pad(r.nick, 7, true) + pad(exact(r.cap), 24, true) + '  (×' +
    (r.cap / r.start).toFixed(1) + ', risk ' + r.persona.risk.toFixed(2) +
    ', skill ' + r.persona.skill.toFixed(2) + ', tier ' + r.persona.salaryTier + ')');
}
console.log('');
console.log('=== дно-5 на тике ' + last.tick + ' ===');
for (let i = rows.length - 1; i >= rows.length - 5; i--) {
  const r = rows[i];
  console.log(pad(r.nick, 7, true) + pad(exact(r.cap), 24, true) + '  (×' +
    (r.cap / r.start).toFixed(2) + ', risk ' + r.persona.risk.toFixed(2) +
    ', skill ' + r.persona.skill.toFixed(2) + ', tier ' + r.persona.salaryTier + ')');
}

/* ============================================================================
   ЦЕЛИ
   ============================================================================ */

function mark(ok) { return ok ? 'ok' : 'FAIL'; }

const at60 = snaps.find((s) => s.tick === 60);
const at300 = snaps.find((s) => s.tick === 300);
const at3000 = snaps.find((s) => s.tick === 3000);

console.log('');
console.log('=== цели калибровки (после смены целей) ===');
console.log('--- короткий горизонт (60 тиков) ---');
console.log('  медиана ~1.5x:          ' + growth(at60.median, baseMedian) + '   ' + mark(at60.median / baseMedian >= 1.35 && at60.median / baseMedian <= 1.8));
console.log('  p90 5..10x:             ' + growth(at60.p90, baseMedian) + '   ' + mark(at60.p90 / baseMedian >= 4 && at60.p90 / baseMedian <= 12));
console.log('  top (не гонимся):       ' + growth(at60.max, baseMedian));
console.log('--- расслоение видно к 300-600 тикам ---');
console.log('  p90 x5 на 300:          ' + growth(at300.p90, baseMedian) + '   ' + mark(at300.p90 / baseMedian >= 5));
console.log('--- длинный горизонт (3000 тиков) ---');
console.log('  top в 1e16..1e17:       ' + exact(at3000.max) + '   ' + mark(at3000.max >= 1e16 && at3000.max <= 1e17));
console.log('  ботов > 2e15: 3..8:     ' + at3000.over2e15 + '/50   ' + mark(at3000.over2e15 >= 3 && at3000.over2e15 <= 8));
console.log('  хоть один > 1e15:       ' + at3000.over1e15 + '   ' + mark(at3000.over1e15 >= 1));
console.log('  медиана (как есть):     ' + exact(at3000.median));
console.log('  половина < 100k:        ' + at3000.under100k + '/50   ' + mark(at3000.under100k >= 15));
console.log('  нет Infinity/NaN:       ' + mark(at3000.max < 1e21 && isFinite(at3000.total)));
console.log('');
console.log('=== проверки ===');
const checks = runChecks();
for (const [name, res] of checks) console.log('  ' + pad(name, 46, false) + ' ' + res);

console.log('');
console.log('переводов-заявок: ' + planCount + ' на ' + fmt(planSum) + ' USDT; время прогона ' + elapsed + ' мс');
console.log('');
