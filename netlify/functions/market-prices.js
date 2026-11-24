/* ============================================================================
   DE — ЖИВОЙ РЫНОК: цена двигается от сделок ботов, а не от фиксированного
   прайса с шумом. Netlify Functions (ESM) + Netlify Blobs, чистый ESM.

   Хранилище общее с api.js/social.js/bots-tick.js: store 'de', ключ 'market'.
   Формат записи:
     {
       prices: { KNT: 325000, BTC: 80000, ..., DEX: 1.00 },  — живые цены
       base:   { ... },                                      — база (якорь)
       t:      1795000000000,                                — время записи, мс
       tt:     1795000000000,        — время последнего шага шума (раз в 20 с)
       flow:   { SYM: netUsdt },     — нетто-поток окна (обнуляется после
                                       применения: потоки считаются за окно)
       buy:    { SYM: время },       — отметка «в этом окне были покупки»
                                       (нужна правилу «нет покупок → −0.15%»)
       hist:   { SYM: [до 30 цен] }  — история для change24
     }

   МОДЕЛЬ
     1. Сделка бота (BUY/SELL на сумму в USDT) даёт нетто-поток по символу.
        applyFlows(flows) сразу двигает цену:
          impact = clamp(flowUsdt / liquidity, -0.25, +0.25)
          price *= (1 + impact)
        Ликвидность — «глубина» монеты: чем она меньше, тем сильнее тот же
        поток двигает цену (мемы ходят на десятки процентов от пары миллионов,
        KNT/BTC/ETH — на проценты).
     2. tickPrices(now) — шаг рынка (20 с): шум σ=0.7%, возврат к базе 1.5%
        разрыва и «нет покупок → ещё −0.1%». База — якорь, поэтому цена не
        улетает: после серии продаж она садится примерно на 5% ниже базы и
        там стоит, а не уходит в ноль.
     3. Жёсткие рамки на каждую цену: 0.05·base ≤ price ≤ 50·base, всегда > 0
        и никогда NaN/Infinity — иначе капитал профиля и рейтинг ломаются.

   Кто зовёт:
     • bots-tick.js  — runTick (раз в 20 минут) и runLive (раз в 4 секунды):
                       потоки сделок → applyFlows, лениво → tickPrices;
     • api.js        — GET /api/market (публично) через handleMarket;
     • social.js     — читает prices для капитала профиля и рейтинга.
   ============================================================================ */

import { getStore } from '@netlify/blobs';
import { MARKET_PRICES } from './market-coins.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400'
};

const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  ...CORS
};

const DB = { name: 'de', consistency: 'strong' };
const KEY = 'market';
const ROUTE = '/api/market';

/* минт: раз в 20 секунд — чтобы цена шевелилась на глазах, без обновлений */
export const MARKET_TICK_MS = 20 * 1000;
const HIST_MAX = 90;
/* догон рынка: максимум шагов за один вызов. 90 шагов = 30 минут жизни
   рынка; вернулся через сутки — цена всё равно прошла 90 шумовых шагов,
   как будто рынок жил, а не один. Остаток разрыва не копим: tt уходит на now. */
const CATCHUP_STEPS_MAX = 90;
/* догон не должен выглядеть скачком: за один вызов цена сдвигается не больше
   чем на 4% (даже если рынок «прожил» полчаса без нас). Иначе обновление
   страницы показывало прыжок на несколько процентов. */
const CATCHUP_MAX_MOVE = 0.04;

/* ---------- ЧАСОВЫЕ СРЕЗЫ: настоящие 24 часа ----------
   hist — 90 точек по 20 секунд, это только полчаса. Поэтому «изменение за
   24ч» раньше считалось по этим получасу и показывало +38% там, где реально
   было +1%. Теперь раз в час пишем пару [время, цена] (до 26 штук: сутки с
   запасом) и считаем процент от среза, ближайшего к суткам назад.
   Пропущенные часы (сайт стоял) заполняем последней ценой — шкала не врёт. */
const HOUR_MS = 3600 * 1000;
const HOUR_KEEP = 26;

/* база рынка: старые монеты биржи + каталог market-coins.js.
   Старые перечислены явно, новые приходят из справочника — так база не
   расходится с client/bot-brain/social. */
export const BASE_PRICES = Object.assign({
  KNT: 325000,
  BTC: 80000,
  ETH: 3200,
  SOL: 220,
  LTC: 60,
  GRAM: 2.5,
  ZBS: 1.2,
  SHIB: 0.00000065,
  STOCK: 180,
  BOND: 1350
}, MARKET_PRICES);

export const SYMBOLS = Object.keys(BASE_PRICES);

/* ликвидность (глубина) в USDT: impact = поток / ликвидность.
   KNT/BTC/ETH — 20 млн: миллион покупки даёт +5%;
   SOL/LTC/BNB/XRP/DOGE — 5 млн;
   мемы — 400 тыс.: 2 млн продажи упираются в кламп −25%;
   остальные — 1.5 млн. */
const LIQ_BIG = 20000000;
const LIQ_MID = 5000000;
const LIQ_MEME = 400000;
const LIQ_BASE = 1500000;

const LIQUIDITY = (function () {
  const out = {};
  for (let i = 0; i < SYMBOLS.length; i++) out[SYMBOLS[i]] = LIQ_BASE;
  ['KNT', 'BTC', 'ETH'].forEach(function (s) { if (out[s] !== undefined) out[s] = LIQ_BIG; });
  ['SOL', 'LTC', 'BNB', 'XRP', 'DOGE'].forEach(function (s) { if (out[s] !== undefined) out[s] = LIQ_MID; });
  ['PEPE', 'BONK', 'FLOKI', 'SHIB'].forEach(function (s) { if (out[s] !== undefined) out[s] = LIQ_MEME; });
  return out;
})();

/* коэффициенты модели */
const IMPACT_MAX = 0.06;      // кламп влияния сделок, ±6% (было 25% — один бот
                              // двигал цену на четверть, графики врали)
const NOISE_SIGMA = 0.007;    // шум шага (20 с), σ = 0.7%
const REVERT = 0.015;         // 1.5% разрыва до базы за шаг
const NO_BUY_DROP = 0.001;    // нет покупок в окне: ещё −0.1%
const FLOOR = 0.000001;       // цена не ниже миллионной доли базы (защита от нуля)
const CEIL = 1000000;         // и не выше миллиона баз — потолка по цене нет
const SIG_DIGITS = 10;        // значащих цифр в цене (SHIB 6.5e-7 не теряется)

/* ---------- мелкие помощники ---------- */

function num(v) {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

function asObj(v) {
  return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
}

function round2(n) {
  const v = num(n);
  return Math.round(v * 100) / 100;
}

function errText(e) {
  return String((e && e.message) || e || 'error');
}

function store() {
  return getStore(DB);
}

/* понятное число значащих цифр: 341250.00000000006 → 341250,
   6.5e-7 остаётся 6.5e-7, а не превращается в 0.000001 */
function sigRound(v) {
  const x = num(v);
  if (!(x > 0) || !isFinite(x)) return 0;
  const mag = Math.floor(Math.log10(x));
  const f = Math.pow(10, SIG_DIGITS - 1 - mag);
  if (!isFinite(f) || !(f > 0)) return x;
  const out = Math.round(x * f) / f;
  return (isFinite(out) && out > 0) ? out : x;
}

/* база символа: сначала из записи, потом из справочника. Пустая/битая база
   в записи не должна обнулять цену — иначе капитал и рейтинг получат 0. */
function baseOf(sym, base) {
  const src = asObj(base);
  let b = num(src[sym]);
  if (!(b > 0) || !isFinite(b)) b = num(BASE_PRICES[sym]);
  return (b > 0 && isFinite(b)) ? b : 0;
}

/* цена всегда в рамках [5% базы; 50 баз], > 0, не NaN */
function clampPrice(v, base) {
  const b = num(base);
  let p = num(v);
  if (!(b > 0)) return 0;
  if (!(p > 0) || !isFinite(p)) p = b;                 // мусор → база
  const lo = b * FLOOR;
  const hi = b * CEIL;
  if (p < lo) p = lo;
  if (p > hi) p = hi;
  return sigRound(p);
}

function liqOf(sym) {
  const l = num(LIQUIDITY[sym]);
  return l > 0 ? l : LIQ_BASE;
}

/* один поток в USDT → множитель цены */
function impactOf(flowUsdt, sym) {
  let i = num(flowUsdt) / liqOf(sym);
  if (!isFinite(i)) i = 0;
  if (i > IMPACT_MAX) i = IMPACT_MAX;
  if (i < -IMPACT_MAX) i = -IMPACT_MAX;
  return i;
}

/* ---------- часовые срезы ---------- */

function slotOf(t) {
  const v = num(t);
  return Math.floor((v > 0 ? v : Date.now()) / HOUR_MS) * HOUR_MS;
}

/* записать цену в часовой срез: в текущий час — перезаписываем, за пропущенные
   часы (сайт стоял) добавляем ту же цену, чтобы шкала «24ч» не была дырявой */
function hourPush(doc, sym, at, price) {
  const p = num(price);
  if (!(p > 0)) return;
  const box = asObj(doc.hour);
  const arr = Array.isArray(box[sym]) ? box[sym].slice() : [];
  const slot = slotOf(at);
  const last = arr.length ? arr[arr.length - 1] : null;
  const lastT = (last && Array.isArray(last)) ? num(last[0]) : 0;

  if (lastT && slotOf(lastT) === slot) {
    arr[arr.length - 1] = [slot, p];
  } else {
    let t = lastT ? slotOf(lastT) + HOUR_MS : slot;
    let guard = 0;
    while (t < slot && guard++ < HOUR_KEEP) { arr.push([t, p]); t += HOUR_MS; }
    arr.push([slot, p]);
  }
  while (arr.length > HOUR_KEEP) arr.shift();
  box[sym] = arr;
  doc.hour = box;
}

/* ---------- сериализация доступа ----------
   Тик (раз в 20 минут) и эфир (раз в 4 секунды) могут прийти одновременно:
   read-modify-write по одному ключу иначе теряет часть потоков. Внутри одного
   инстанса функции ставим записи в очередь; между инстансами остаётся
   last-write-wins (см. ограничения в отчёте). */
let chain = Promise.resolve();

function withLock(fn) {
  const run = chain.then(fn, fn);
  chain = run.then(function () { }, function () { });
  return run;
}

/* ---------- чтение / запись ---------- */

function freshDoc(now) {
  const prices = {};
  const base = {};
  const hist = {};
  const hour = {};
  const slot = slotOf(now);
  for (let i = 0; i < SYMBOLS.length; i++) {
    const sym = SYMBOLS[i];
    const b = baseOf(sym, BASE_PRICES);
    base[sym] = b;
    prices[sym] = b;
    hist[sym] = [b];
    hour[sym] = [[slot, b]];
  }
  return { prices: prices, base: base, t: num(now), tt: 0, flow: {}, buy: {}, hist: hist, hour: hour };
}

/* чиним любую дырку в записи: цену берём из base, базу — из справочника,
   мусорные значения не пропускаем. Возвращает {doc, dirty}. */
function normalize(raw, now) {
  const src = asObj(raw);
  const base = {};
  const prices = {};
  const hist = {};
  const srcPrices = asObj(src.prices);
  const srcBase = asObj(src.base);
  const srcHist = asObj(src.hist);
  let dirty = false;

  for (let i = 0; i < SYMBOLS.length; i++) {
    const sym = SYMBOLS[i];
    const b = baseOf(sym, srcBase);
    base[sym] = b;

    const rawP = num(srcPrices[sym]);
    const p = (rawP > 0 && isFinite(rawP)) ? rawP : b;
    if (rawP !== p) dirty = true;
    const c = clampPrice(p, b);
    if (c !== rawP) dirty = true;
    prices[sym] = c;

    const arr = Array.isArray(srcHist[sym]) ? srcHist[sym] : null;
    if (arr) {
      const out = [];
      for (let j = 0; j < arr.length; j++) {
        const v = num(arr[j]);
        if (v > 0 && isFinite(v)) out.push(v);
      }
      if (out.length !== arr.length) dirty = true;
      if (out.length > HIST_MAX) { out.length = HIST_MAX; dirty = true; }
      hist[sym] = out.length ? out : [c];
      if (!out.length) dirty = true;
    } else {
      hist[sym] = [c];
      dirty = true;
    }
  }

  const flow = {};
  const srcFlow = asObj(src.flow);
  for (const sym in srcFlow) {
    const v = num(srcFlow[sym]);
    if (!v) continue;
    const key = String(sym).toUpperCase();
    if (LIQUIDITY[key] === undefined) continue;
    flow[key] = v;
  }

  const buy = {};
  const srcBuy = asObj(src.buy);
  for (const sym in srcBuy) {
    const v = num(srcBuy[sym]);
    if (!(v > 0)) continue;
    const key = String(sym).toUpperCase();
    if (LIQUIDITY[key] === undefined) continue;
    buy[key] = v;
  }

  const t = num(src.t);
  const tt = num(src.tt);

  /* часовые срезы: только валидные пары [время, цена], лишнее режем */
  const hour = {};
  const srcHour = asObj(src.hour);
  for (let i = 0; i < SYMBOLS.length; i++) {
    const sym = SYMBOLS[i];
    const arr = Array.isArray(srcHour[sym]) ? srcHour[sym] : [];
    const out = [];
    for (let j = 0; j < arr.length; j++) {
      const row = Array.isArray(arr[j]) ? arr[j] : null;
      if (!row) { dirty = true; continue; }
      const rt = num(row[0]), rp = num(row[1]);
      if (rt > 0 && rp > 0 && isFinite(rp)) out.push([slotOf(rt), rp]);
      else dirty = true;
    }
    if (out.length > HOUR_KEEP) { out.splice(0, out.length - HOUR_KEEP); dirty = true; }
    if (!out.length) { out.push([slotOf(now), prices[sym]]); dirty = true; }
    hour[sym] = out;
  }

  const doc = {
    prices: prices,
    base: base,
    t: t > 0 ? t : num(now),
    tt: tt > 0 ? tt : 0,
    flow: flow,
    buy: buy,
    hist: hist,
    hour: hour
  };
  return { doc: doc, dirty: dirty, existed: !!raw };
}

/* читает запись, при отсутствии — создаёт из базы. Ошибку хранилища
   пробрасывает: вызывающий решает, тикать ли дальше. */
async function loadDoc(now) {
  const s = store();
  let raw = null;
  try { raw = await s.get(KEY, { type: 'json' }); }
  catch (e) { throw e; }

  if (raw === null || raw === undefined) {
    const doc = freshDoc(now);
    await s.setJSON(KEY, doc);
    return doc;
  }

  const n = normalize(raw, now);
  if (n.dirty || !n.existed) {
    try { await s.setJSON(KEY, n.doc); } catch (e) { /* ремонт не критичен */ }
  }
  return n.doc;
}

/* цена одной монеты для внешних модулей (social.js, api.js) */
export function priceOf(sym, prices) {
  const key = String(sym === null || sym === undefined ? '' : sym).trim().toUpperCase();
  if (!key) return 0;
  const p = num(asObj(prices)[key]);
  if (p > 0 && isFinite(p)) return p;
  return baseOf(key, BASE_PRICES);
}

/* ---------- публичный доступ ---------- */

/* { prices, t }: читает, при отсутствии — создаёт из базы */
export async function getPrices() {
  return withLock(async function () {
    const doc = await loadDoc(Date.now());
    return { prices: Object.assign({}, doc.prices), t: num(doc.t) };
  });
}

/* карта цен без обёртки: удобно модулям, которым нужен объект, а не ответ
   ручки. При любой ошибке хранилища — база из справочника. */
export async function getPriceMap() {
  try {
    const g = await getPrices();
    return g.prices;
  } catch (e) {
    const out = {};
    for (let i = 0; i < SYMBOLS.length; i++) out[SYMBOLS[i]] = baseOf(SYMBOLS[i], BASE_PRICES);
    return out;
  }
}

/* потоки сделок → цены. flows: { SYM: netUsdt } (покупки минус продажи).
   Возвращает { prices, moved: [{ sym, pct }] }. */
export async function applyFlows(flows, now) {
  const src = asObj(flows);
  const entries = [];
  for (const sym in src) {
    const key = String(sym).toUpperCase();
    if (LIQUIDITY[key] === undefined) continue;            // неизвестную монету не оценить
    const v = num(src[sym]);
    if (!v) continue;
    entries.push({ sym: key, flow: v });
  }

  return withLock(async function () {
    const at = num(now) > 0 ? num(now) : Date.now();
    const doc = await loadDoc(at);
    const moved = [];

    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const before = num(doc.prices[e.sym]);
      if (!(before > 0)) continue;
      const impact = impactOf(e.flow, e.sym);
      if (!impact) continue;
      const after = clampPrice(before * (1 + impact), doc.base[e.sym]);
      doc.prices[e.sym] = after;
      hourPush(doc, e.sym, at, after);

      const hist = Array.isArray(doc.hist[e.sym]) ? doc.hist[e.sym] : [];
      hist.push(after);
      while (hist.length > HIST_MAX) hist.shift();
      doc.hist[e.sym] = hist;

      if (e.flow > 0) doc.buy[e.sym] = at;                  // в окне были покупки

      const pct = before > 0 ? round2((after / before - 1) * 100) : 0;
      moved.push({ sym: e.sym, pct: pct, impact: Math.round(impact * 10000) / 10000 });
    }

    /* потоки за окно применены — счётчик окна обнуляем, чтобы один и тот же
       поток не подействовал на цену дважды */
    doc.flow = {};
    doc.t = at;

    await store().setJSON(KEY, doc);
    return { prices: Object.assign({}, doc.prices), moved: moved };
  });
}

/* один шаг по одной монете: шум σ=0.7%, возврат к базе 1.5% разрыва,
   «нет покупок → ещё −0.1%». flow/buy учитываются только в первом окне
   догона — дальше окно уже закрыто. */
function stepSymbol(doc, sym, withFlow) {
  const base = num(doc.base[sym]);
  let p = num(doc.prices[sym]);
  if (!(p > 0)) p = base;
  if (!(base > 0)) { doc.prices[sym] = clampPrice(p, p); return; }

  /* шум: нормальное распределение с σ = 0.7% (Бокс–Мюллер) */
  let g = gauss();
  if (!isFinite(g)) g = 0;
  if (g > 3) g = 3;
  if (g < -3) g = -3;
  p *= (1 + g * NOISE_SIGMA);

  /* возврат к базе: 1.5% разрыва за шаг */
  p += (base - p) * REVERT;

  /* покупок в окне не было — ещё −0.1% */
  const net = withFlow ? num(doc.flow[sym]) : 0;
  const bought = withFlow && num(doc.buy[sym]) > 0;
  if (net <= 0 && !bought) p *= (1 - NO_BUY_DROP);

  const out = clampPrice(p, base);
  doc.prices[sym] = out;

  const hist = Array.isArray(doc.hist[sym]) ? doc.hist[sym] : [];
  hist.push(out);
  while (hist.length > HIST_MAX) hist.shift();
  doc.hist[sym] = hist;
}

/* шаг рынка: шум, возврат к базе и «нет покупок». Возвращает { prices, t, steps }.
   Шаг не чаще раза в 20 секунд (метка tt): крон и эфир могут звать его десятки
   раз, а цена должна дрожать ровно раз в окно. Если между вызовами прошло
   больше (крон не сработал, сайт стоял), прокручиваем по шагу на каждые
   20 секунд разрыва — до CATCHUP_STEPS_MAX. Остаток разрыва «сгорает»: это
   шум, а не деньги, зато tt уходит на now и следующий вызов не догоняет его. */
export async function tickPrices(now) {
  return withLock(async function () {
    const at = num(now) > 0 ? num(now) : Date.now();
    const doc = await loadDoc(at);

    /* уже тикали в это окно (например, из другого инстанса) — не шумим дважды */
    const last = num(doc.tt);
    if (last > 0 && (at - last) < MARKET_TICK_MS) {
      return { prices: Object.assign({}, doc.prices), t: num(doc.t), skipped: true, steps: 0 };
    }

    /* сколько шагов рынок прожил без нас: по одному на каждые 20 секунд.
       Свежая запись (tt = 0) — ровно один шаг, как раньше. */
    let steps = 1;
    if (last > 0) steps = Math.floor((at - last) / MARKET_TICK_MS);
    if (!(steps > 0)) steps = 1;
    if (steps > CATCHUP_STEPS_MAX) steps = CATCHUP_STEPS_MAX;

    const p0 = {};
    for (let i = 0; i < SYMBOLS.length; i++) p0[SYMBOLS[i]] = num(doc.prices[SYMBOLS[i]]);

    for (let s = 0; s < steps; s++) {
      const withFlow = s === 0;
      for (let i = 0; i < SYMBOLS.length; i++) stepSymbol(doc, SYMBOLS[i], withFlow);
      /* окно закрыто после первого шага: дальше flow/buy уже не действуют */
      if (withFlow) { doc.flow = {}; doc.buy = {}; }
    }

    /* догон после простоя не должен прыгать: держим движение за вызов в
       пределах ±4%. Иначе F5 показывал скачок цены на несколько процентов. */
    if (steps > 2) {
      for (let i = 0; i < SYMBOLS.length; i++) {
        const sym = SYMBOLS[i];
        const was = num(p0[sym]);
        let p = num(doc.prices[sym]);
        if (!(was > 0) || !(p > 0)) continue;
        const lo = was * (1 - CATCHUP_MAX_MOVE);
        const hi = was * (1 + CATCHUP_MAX_MOVE);
        if (p < lo) p = lo; else if (p > hi) p = hi;
        doc.prices[sym] = clampPrice(p, doc.base[sym]);
      }
    }

    /* часовой срез — чтобы «за 24ч» считалось по настоящим суткам */
    for (let i = 0; i < SYMBOLS.length; i++) hourPush(doc, SYMBOLS[i], at, doc.prices[SYMBOLS[i]]);

    /* окно закрыто: и потоки, и отметки покупок обнуляем */
    doc.flow = {};
    doc.buy = {};
    doc.t = at;
    doc.tt = at;

    await store().setJSON(KEY, doc);
    return { prices: Object.assign({}, doc.prices), t: at, steps: steps };
  });
}

/* нормальное распределение (Бокс–Мюллер): шум должен быть колоколом, а не
   ровным прямоугольником — тогда «шумные минуты» действительно редки */
function gauss() {
  const u = 1 - Math.random();
  const v = Math.random();
  if (!(u > 0)) return 0;
  const r = Math.sqrt(-2 * Math.log(u));
  return r * Math.cos(2 * Math.PI * v);
}

/* изменение за доступную историю (до 30 минутных точек), % */
function changeOf(hist, cur) {
  const arr = Array.isArray(hist) ? hist : [];
  let first = 0;
  for (let i = 0; i < arr.length; i++) {
    const v = num(arr[i]);
    if (v > 0) { first = v; break; }
  }
  const now = num(cur);
  if (!(first > 0) || !(now > 0)) return 0;
  return round2((now / first - 1) * 100);
}

/* изменение и настоящий срок: по часовым срезам считаем до суток назад.
   Срезов меньше двух или срок меньше часа — падаем на hist (полчаса) и
   честно отдаём h=0, клиент подпишет «за 30 мин», а не «24ч». */
function changeAndSpan(doc, sym) {
  const cur = num(doc.prices[sym]);
  if (!(cur > 0)) return { pct: 0, h: 0 };

  const arr = Array.isArray(asObj(doc.hour)[sym]) ? asObj(doc.hour)[sym] : [];
  if (arr.length >= 2) {
    const lastT = num(arr[arr.length - 1][0]);
    const target = lastT - 24 * HOUR_MS;
    let best = arr[0];
    for (let i = 0; i < arr.length; i++) {
      if (num(arr[i][0]) <= target) best = arr[i];
      else break;
    }
    const ref = num(best[1]);
    const hours = Math.max(0, Math.round((lastT - num(best[0])) / HOUR_MS));
    if (ref > 0 && hours >= 1) {
      return { pct: round2((cur / ref - 1) * 100), h: Math.min(24, hours) };
    }
  }
  return { pct: changeOf(doc.hist[sym], cur), h: 0 };
}

/* ---------- ручка ----------
   GET /api/market       → { ok:true, prices, t, change24, changeH, hist }.
   POST /api/market/set  → ручная правка цены владельцем (ключ BOTS_KEY).
   Публично только чтение: это витрина биржи.
   Любой другой путь/метод — null, чтобы api.js шёл дальше по цепочке. */

/* админская установка цены: { ZEC: 1100, BTC: 90000 }.
   Цена сразу ложится в запись и в историю, рамки [5% базы; 50 баз] те же.
   Поток и «нет покупок» не участвуют — это прямое вмешательство.
   Права проверяет вызывающий (api.js: ключ BOTS_KEY или аккаунт владельца). */
export async function setPricesAny(map, opts) {
  const anchor = !!(opts && opts.anchor);
  const src = asObj(map);
  const out = {};
  for (const rawSym in src) {
    const sym = String(rawSym).toUpperCase();
    if (LIQUIDITY[sym] === undefined) continue;
    const v = num(src[rawSym]);
    if (!(v > 0)) continue;
    out[sym] = v;
  }
  const names = Object.keys(out);
  if (!names.length) return { ok: false, err: 'empty' };

  return withLock(async function () {
    const at = Date.now();
    const doc = await loadDoc(at);
    const done = {};
    for (let i = 0; i < names.length; i++) {
      const sym = names[i];
      const p = clampPrice(out[sym], doc.base[sym]);
      doc.prices[sym] = p;
      /* «закрепить»: база (якорь) переезжает на новую цену, и рынок больше
         не тянет её обратно — дальше цена живёт вокруг нового уровня */
      if (anchor) doc.base[sym] = p;
      const hist = Array.isArray(doc.hist[sym]) ? doc.hist[sym] : [];
      hist.push(p);
      while (hist.length > HIST_MAX) hist.shift();
      doc.hist[sym] = hist;
      hourPush(doc, sym, at, p);
      doc.buy[sym] = at;
      done[sym] = p;
    }
    doc.flow = {};
    doc.t = at;
    doc.tt = at;
    await store().setJSON(KEY, doc);
    return { ok: true, prices: Object.assign({}, doc.prices), set: done };
  });
}

export async function handleMarket(req, p, u) {
  if (!req || !p) return null;
  const path = String(p).replace(/\/+$/, '') || '/';
  if (path !== ROUTE) return null;

  const m = String(req.method || 'GET').toUpperCase();
  if (m !== 'GET') return null;

  try {
    /* рынок двигает сам себя: каждое чтение проверяет, не пора ли пошуметь.
       Так цены живут и без крона, и без захода в игру. */
    try { await tickPrices(Date.now()); } catch (e) { /* шум не обязателен */ }

    const doc = await withLock(async function () {
      return await loadDoc(Date.now());
    });

    const change24 = {};
    const changeH = {};
    for (let i = 0; i < SYMBOLS.length; i++) {
      const sym = SYMBOLS[i];
      const ch = changeAndSpan(doc, sym);
      change24[sym] = ch.pct;
      changeH[sym] = ch.h;
    }

    return new Response(JSON.stringify({
      ok: true,
      prices: doc.prices,
      t: num(doc.t),
      change24: change24,
      changeH: changeH,
      hist: doc.hist,
      symbols: SYMBOLS
    }), { status: 200, headers: HEADERS });
  } catch (e) {
    return new Response(JSON.stringify({
      ok: false,
      err: 'market',
      msg: errText(e)
    }), { status: 200, headers: HEADERS });
  }
}
