/* ============================================================================
   DE — NFT-МАРКЕТ: кейсы ботов, витрина лотов и покупка.
   Netlify Functions (ESM) + Netlify Blobs; хранилище общее с api.js/social.js.

   Ключи в store 'de':
     accounts    { [nick_lc]: account }                  — как в api.js
     nft_market  { lots:[...], updated, totalOpened }

   Предмет в state.nft.items (JSON-строка state.nft):
     { id, model, aura, attr, mult, value, price, seller, t }
   Лот в nft_market.lots:
     { id, seller, model, aura, mult, value, price, t }
     id лота = id предмета у продавца, поэтому при продаже предмет реально
     переезжает, а не дублируется.

   Экспорт:
     runNftActivity(now)          — 3–5 ботов за запуск вскрывают кейсы,
                                    половину дропа сразу выставляют на продажу;
     listLots()                   — витрина: { lots, updated, totalOpened };
     buyLot(nick, lotId)          — покупка человеком/ботом;
     handleNft(req, p, body, u)   — роутер для api.js:
         GET  /api/nft/market → { ok:true, lots:[...], updated }
         POST /api/nft/buy    → тело { nick, pass, lotId }

   Подключение в api.js (одна строка импорта + вызов после handleSocial):
     import { handleNft } from './nft-market.js';
     ...
     const nft = await handleNft(req, p, body, u);
     if (nft) return nft;

   Деньги — KNT из state.ex.amounts. Цена кейса — priceKnt из nft-content.js,
   цена лота = value × (1.1…1.6), комиссия биржи 5% сжигается (продавцу не идёт).
   ============================================================================ */

import { getStore } from '@netlify/blobs';
import { pushEvent } from './social.js';
import { NFT_MODELS, NFT_CASES } from './nft-content.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400'
};

function json(obj, code) {
  return new Response(JSON.stringify(obj), {
    status: code || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS }
  });
}

/* ошибка в едином формате: { ok:false, err:'код', msg:'текст' } */
function fail(code, status, msg) {
  return json({ ok: false, err: code, msg: msg || '' }, status);
}

function store() {
  return getStore({ name: 'de', consistency: 'strong' });
}

const ACCOUNTS_KEY = 'accounts';
const MARKET_KEY = 'nft_market';

const ITEMS_MAX = 60;                       // кэп коллекции одного аккаунта
const LOTS_MAX = 40;                        // витрина
const LOT_TTL = 3 * 24 * 60 * 60 * 1000;    // лот живёт 3 суток
const FEED_MAX = 3;                         // событий в ленту за запуск
const OPEN_MIN = 3;                         // ботов за запуск
const OPEN_MAX = 5;
const SLOT_MS = 20 * 60 * 1000;             // слот выбора = тик ботов (20 минут)
const LIST_CHANCE = 0.5;                    // каждый второй дроп — на продажу
const PRICE_MULT_MIN = 1.1;                 // наценка продавца
const PRICE_MULT_MAX = 1.6;
const FEE_RATE = 0.05;                      // комиссия биржи, сжигается
const KNT_SYM = 'KNT';
const KNT_USD = 325000;          // курс KNT в долларах — как в банке игры
const SWAP_FEE = 0.0035;         // комиссия банка-конвертера (DX_SWAP_FEE в клиенте)

/* ауры: вес, границы множителя. none/common — ровно ×1 */
const AURAS = [
  { id: 'none', w: 34, min: 1, max: 1 },
  { id: 'common', w: 41, min: 1, max: 1 },
  { id: 'uncommon', w: 15, min: 1.2, max: 1.5 },
  { id: 'rare', w: 7, min: 1.5, max: 3 },
  { id: 'epic', w: 2.5, min: 5, max: 15 },
  { id: 'legendary', w: 0.5, min: 100, max: 1000 }
];

/* атрибут ауры — как в клиенте: только у предметов с аурой */
const AURA_ATTRS = ['Backdrop', 'Symbol', 'Model'];

/* ============================================================================
   КОНТЕНТ: nft-content.js (его пишет отдельный агент; контракт —
   NFT_MODELS[{id,name,ru,base,rar,collection}], NFT_CASES[{id,ru,priceKnt,slots}]).
   Импортируем статически. Если экспорт окажется пустым или битым (нет base,
   нет валидных слотов) — берём встроенный аварийный набор, чтобы рынок жил.
   ============================================================================ */

let contentCache = null;

const FALLBACK_MODELS = [
  { id: 'pepe', name: 'Plush Pepe', ru: 'Плюшевый Пепе', base: 150000, rar: 'legendary', collection: 'classic' },
  { id: 'watch', name: 'Swiss Watch', ru: 'Швейцарские часы', base: 80000, rar: 'epic', collection: 'classic' },
  { id: 'locket', name: 'Heart Locket', ru: 'Кулон-сердце', base: 70000, rar: 'epic', collection: 'classic' },
  { id: 'cat', name: 'Scared Cat', ru: 'Испуганный кот', base: 60000, rar: 'epic', collection: 'classic' },
  { id: 'bag', name: 'Loot Bag', ru: 'Мешок добычи', base: 50000, rar: 'epic', collection: 'classic' },
  { id: 'cap', name: 'Durov’s Cap', ru: 'Кепка Дурова', base: 35000, rar: 'rare', collection: 'classic' },
  { id: 'gem', name: 'Ion Gem', ru: 'Ионный самоцвет', base: 25000, rar: 'rare', collection: 'classic' },
  { id: 'peach', name: 'Precious Peach', ru: 'Драгоценный персик', base: 15000, rar: 'rare', collection: 'classic' },
  { id: 'ring', name: 'Signet Ring', ru: 'Печатка', base: 8000, rar: 'common', collection: 'classic' },
  { id: 'oscar', name: 'Mini Oscar', ru: 'Мини-Оскар', base: 3000, rar: 'common', collection: 'classic' }
];

/* цены кейсов — в KNT (не в USD): как в контракте nft-content.js */
const FALLBACK_CASES = [
  { id: 'base', ru: 'Базовый', priceKnt: 0.015, slots: [['common', 60], ['rare', 30], ['epic', 10]] },
  { id: 'mid', ru: 'Средний', priceKnt: 0.05, slots: [['common', 40], ['rare', 40], ['epic', 15], ['legendary', 5]] },
  { id: 'premium', ru: 'Премиум', priceKnt: 0.2, slots: [['rare', 50], ['epic', 30], ['legendary', 15], ['common', 5]] },
  { id: 'ultra', ru: 'Ультра', priceKnt: 0.8, slots: [['epic', 40], ['legendary', 35], ['rare', 25]] }
];

function sanitizeModels(src) {
  const out = [];
  if (!Array.isArray(src)) return out;
  for (let i = 0; i < src.length && out.length < 200; i++) {
    const raw = src[i];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const id = String(raw.id || '').trim();
    if (!id) continue;
    const base = num(raw.base);
    if (!(base > 0)) continue;
    if (out.some(function (m) { return m.id === id; })) continue;
    const rar = String(raw.rar || 'common').trim().toLowerCase() || 'common';
    out.push({
      id: id,
      name: cut(String(raw.name || id), 60),
      ru: cut(String(raw.ru || raw.name || id), 60),
      base: base,
      rar: rar,
      collection: String(raw.collection || 'classic')
    });
  }
  return out;
}

function sanitizeCases(src) {
  const out = [];
  if (!Array.isArray(src)) return out;
  for (let i = 0; i < src.length && out.length < 50; i++) {
    const raw = src[i];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const id = String(raw.id || '').trim();
    if (!id) continue;
    if (out.some(function (c) { return c.id === id; })) continue;
    let priceKnt = num(raw.priceKnt);
    if (raw.priceKnt === undefined || raw.priceKnt === null) priceKnt = num(raw.price);
    if (!isFinite(priceKnt) || priceKnt < 0) priceKnt = 0;

    const slots = [];
    if (Array.isArray(raw.slots)) {
      for (let j = 0; j < raw.slots.length && slots.length < 32; j++) {
        const s = raw.slots[j];
        let rar = '';
        let w = 0;
        if (Array.isArray(s)) { rar = String(s[0] || '').trim().toLowerCase(); w = num(s[1]); }
        else if (s && typeof s === 'object') {
          rar = String(s.rar || s.aura || s.id || '').trim().toLowerCase();
          w = num(s.w !== undefined ? s.w : s.weight);
        }
        if (!rar || !(w > 0)) continue;
        slots.push([rar, w]);
      }
    }
    if (!slots.length) slots.push(['common', 1]);

    out.push({ id: id, ru: cut(String(raw.ru || raw.name || id), 40), priceKnt: round6(priceKnt), slots: slots });
  }
  return out;
}

/* пулы моделей по редкости: слот кейса — редкость модели */
function makePools(models) {
  const pools = Object.create(null);
  for (let i = 0; i < models.length; i++) {
    const m = models[i];
    if (!pools[m.rar]) pools[m.rar] = [];
    pools[m.rar].push(m);
  }
  return pools;
}

async function content() {
  if (contentCache) return contentCache;

  let models = sanitizeModels(NFT_MODELS);
  let cases = sanitizeCases(NFT_CASES);
  let source = 'nft-content';

  if (!models.length) {
    models = sanitizeModels(FALLBACK_MODELS);
    source = 'fallback';
  }
  if (!cases.length) {
    cases = sanitizeCases(FALLBACK_CASES);
    source = 'fallback';
  }

  contentCache = {
    models: models,
    cases: cases,
    pools: makePools(models),
    source: source
  };
  return contentCache;
}

/* ============================================================================
   МЕЛОЧИ
   ============================================================================ */

function normNick(s) {
  return String(s === null || s === undefined ? '' : s).trim().toLowerCase();
}

function num(v) {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

function round2(n) {
  return Math.round(num(n) * 100) / 100;
}

function round6(n) {
  return Math.round(num(n) * 1e6) / 1e6;
}

function errText(e) {
  return String((e && e.message) || e || 'error');
}

/* обрезаем по символам, а не по кодовым единицам — эмодзи не рвутся */
function cut(s, max) {
  const arr = Array.from(String(s === null || s === undefined ? '' : s).trim());
  return arr.length > max ? arr.slice(0, max).join('') : arr.join('');
}

function parseJson(v, fallback) {
  if (v === null || v === undefined || v === '') return fallback;
  if (typeof v === 'object') return v;
  try {
    const o = JSON.parse(String(v));
    return (o && typeof o === 'object') ? o : fallback;
  } catch (e) {
    return fallback;
  }
}

/* FNV-1a 32-bit: стабильный хеш строки для детерминизма по слоту */
function hashSeed(s) {
  const t = String(s === null || s === undefined ? '' : s);
  let h = 2166136261;
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

/* тот же мульберри, что в bot-brain.js */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* [[значение, вес], ...] → значение */
function weightedPick(rand, pairs) {
  if (!Array.isArray(pairs) || !pairs.length) return null;
  let total = 0;
  for (let i = 0; i < pairs.length; i++) total += num(pairs[i][1]);
  if (!(total > 0)) return pairs[0][0];
  let r = rand() * total;
  for (let i = 0; i < pairs.length; i++) {
    r -= num(pairs[i][1]);
    if (r <= 0) return pairs[i][0];
  }
  return pairs[pairs.length - 1][0];
}

let idSeq = 0;
function newItemId() {
  idSeq = (idSeq + 1) % 46656;
  return 'nm' + Date.now().toString(36) + idSeq.toString(36) + Math.floor(Math.random() * 1296).toString(36);
}

/* ============================================================================
   ХРАНИЛИЩЕ
   ============================================================================ */

/* Пустой объект вместо accounts означал бы, что запись сотрёт всех игроков,
   поэтому неожиданный формат — исключение, а не тихий {} (как в bots-tick.js). */
async function readAll() {
  const v = await store().get(ACCOUNTS_KEY, { type: 'json' });
  if (v === null || v === undefined) return {};
  if (typeof v !== 'object' || Array.isArray(v)) throw new Error('accounts: неожиданный формат');
  return v;
}

async function writeAll(list) {
  await store().setJSON(ACCOUNTS_KEY, list);
}

async function readMarket() {
  const v = await store().get(MARKET_KEY, { type: 'json' });
  const m = (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
  return {
    lots: Array.isArray(m.lots) ? m.lots : [],
    updated: num(m.updated),
    totalOpened: num(m.totalOpened)
  };
}

async function writeMarket(market) {
  await store().setJSON(MARKET_KEY, {
    lots: market.lots,
    updated: market.updated,
    totalOpened: market.totalOpened
  });
}

/* ============================================================================
   АККАУНТ: состояние, KNT, NFT
   ============================================================================ */

function stateOf(acc) {
  const raw = acc && acc.state;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.length) {
    const o = parseJson(raw, null);
    if (o && typeof o === 'object' && !Array.isArray(o)) return o;
  }
  return {};
}

/* битый JSON не роняет ручку: считаем счёт пустым и чиним при записи */
function exOf(acc) {
  const st = stateOf(acc);
  const raw = parseJson(st.ex, null);
  const ex = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  if (!ex.amounts || typeof ex.amounts !== 'object' || Array.isArray(ex.amounts)) ex.amounts = {};
  if (!Array.isArray(ex.trades)) ex.trades = [];
  if (!ex.v) ex.v = 3;
  return { ex: ex };
}

function kntOf(acc) {
  const s = exOf(acc);
  let key = KNT_SYM;
  for (const k in s.ex.amounts) {
    if (String(k).toUpperCase() === KNT_SYM) { key = k; break; }
  }
  return { ex: s.ex, key: key, value: num(s.ex.amounts[key]) };
}

function setKnt(ex, key, v) {
  const q = round6(v);
  if (!(q > 0)) {
    if (Object.prototype.hasOwnProperty.call(ex.amounts, key)) delete ex.amounts[key];
    return;
  }
  ex.amounts[key] = q;
}

/* пишем в ТЕКУЩИЙ state: ex и nft не должны затирать друг друга */
function saveEx(acc, ex) {
  acc.state = Object.assign({}, stateOf(acc), { ex: JSON.stringify(ex) });
}

function nftOf(acc) {
  const st = stateOf(acc);
  const raw = parseJson(st.nft, null);
  const nft = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  if (!Array.isArray(nft.items)) nft.items = [];
  nft.opened = num(nft.opened);
  return { nft: nft };
}

function saveNft(acc, nft) {
  acc.state = Object.assign({}, stateOf(acc), {
    /* чужие поля state.nft (если появятся) не теряем */
    nft: JSON.stringify(Object.assign({}, nft, { items: nft.items, opened: nft.opened }))
  });
}

function nickOf(acc, fallback) {
  if (!acc || typeof acc !== 'object') return String(fallback || '');
  return String(acc.nick || acc.nick_lc || acc.legacy_email || acc.email || fallback || '');
}

/* свой поиск аккаунта — копия api.js: ник_lc, ник, почта, старый ключ */
function findAcc(list, who) {
  const lc = normNick(who);
  if (!lc) return null;
  if (list[lc] && typeof list[lc] === 'object') return { key: lc, acc: list[lc] };
  for (const k in list) {
    const a = list[k];
    if (!a || typeof a !== 'object') continue;
    if (k === lc) return { key: k, acc: a };
    if (normNick(a.nick_lc) === lc) return { key: k, acc: a };
    if (normNick(a.nick) === lc) return { key: k, acc: a };
    if (normNick(a.legacy_email) === lc) return { key: k, acc: a };
    if (normNick(a.email) === lc) return { key: k, acc: a };
  }
  return null;
}

/* ============================================================================
   ЛОТЫ
   ============================================================================ */

function validLot(l) {
  return !!l && typeof l === 'object' && !Array.isArray(l) && l.id && l.seller && num(l.price) > 0;
}

/* чистим просроченные и мусорные лоты, сортируем «новые сверху», режем до 40 */
function tidyLots(lots, at) {
  const out = [];
  if (!Array.isArray(lots)) return out;
  for (let i = 0; i < lots.length; i++) {
    const l = lots[i];
    if (!validLot(l)) continue;
    const t = num(l.t);
    if (t > 0 && at - t > LOT_TTL) continue;
    out.push({
      id: String(l.id),
      seller: String(l.seller),
      model: String(l.model || ''),
      aura: String(l.aura || 'none'),
      mult: round2(num(l.mult) || 1),
      value: Math.max(0, Math.round(num(l.value))),
      price: Math.max(1, Math.round(num(l.price))),
      t: t > 0 ? t : at
    });
  }
  out.sort(function (x, y) { return y.t - x.t; });
  if (out.length > LOTS_MAX) out.length = LOTS_MAX;
  return out;
}

/* снимаем метку «на продаже» с предметов, чьих лотов больше нет на витрине
   (истекли 3 суток или вытеснены кэпом 40) */
function syncLotMarkers(list, lots) {
  const live = Object.create(null);
  for (let i = 0; i < lots.length; i++) {
    if (lots[i] && lots[i].id) live[String(lots[i].id)] = true;
  }
  for (const k in list) {
    const a = list[k];
    if (!a || typeof a !== 'object' || a.bot !== true) continue;
    const nft = nftOf(a);
    let dirty = false;
    for (let j = 0; j < nft.nft.items.length; j++) {
      const it = nft.nft.items[j];
      if (it && num(it.price) > 0 && !live[String(it.id)]) {
        it.price = 0;
        dirty = true;
      }
    }
    if (dirty) saveNft(a, nft.nft);
  }
}

/* ============================================================================
   РОЛЛЫ КЕЙСА
   ============================================================================ */

function rollAura(rand) {
  const pairs = AURAS.map(function (a) { return [a, a.w]; });
  return weightedPick(rand, pairs) || AURAS[0];
}

function rollModel(rand, pools, models, slotRar) {
  const pool = (pools[slotRar] && pools[slotRar].length) ? pools[slotRar] : models;
  if (!pool.length) return null;
  return pool[Math.floor(rand() * pool.length) % pool.length];
}

/* ============================================================================
   АКТИВНОСТЬ БОТОВ: 3–5 кейсов за запуск
   ============================================================================ */

function botCandidates(list, minPrice) {
  const out = [];
  for (const k of Object.keys(list)) {
    const a = list[k];
    if (!a || typeof a !== 'object' || a.bot !== true) continue;
    const lc = normNick(a.nick_lc || a.nick || k);
    if (!lc) continue;
    const knt = kntOf(a).value;
    /* кейс стоит в KNT, а боты живут в USDT: считаем, что бот может купить
       KNT на бирже по курсу, поэтому смотрим на суммарную покупательную силу */
    const usdt = num((a.state && a.state.ex) ? (function () {
      try { return JSON.parse(a.state.ex).usdt; } catch (e) { return 0; }
    })() : 0);
    const power = knt + usdt / KNT_USD;
    if (!(power > 0) || !(power >= minPrice)) continue;
    out.push({ key: k, acc: a, lc: lc });
  }
  return out;
}

export async function runNftActivity(now) {
  const at = (isFinite(Number(now)) && Number(now) > 0) ? Number(now) : Date.now();
  const cnt = await content();
  const models = cnt.models;
  const cases = cnt.cases;
  const pools = cnt.pools;

  let list;
  try { list = await readAll(); }
  catch (e) { return { ok: false, err: 'read', msg: errText(e), at: at }; }

  let market;
  try { market = await readMarket(); }
  catch (e) { return { ok: false, err: 'market', msg: errText(e), at: at }; }

  /* слот фиксирует и число ботов, и самих ботов: два вызова подряд в одном
     20-минутном окне выберут тех же ботов, а не новых */
  const slot = Math.floor(at / SLOT_MS);
  const slotRnd = mulberry32(hashSeed('nft-slot|' + slot));
  const want = OPEN_MIN + Math.floor(slotRnd() * (OPEN_MAX - OPEN_MIN + 1));

  let minPrice = Infinity;
  for (let i = 0; i < cases.length; i++) if (cases[i].priceKnt < minPrice) minPrice = cases[i].priceKnt;

  const candidates = botCandidates(list, minPrice);
  if (!candidates.length) {
    return {
      ok: true, at: at, slot: slot, want: want, opened: 0, listed: 0, feed: 0,
      reason: 'nobots', lots: market.lots.length, totalOpened: market.totalOpened,
      content: cnt.source
    };
  }

  /* ротация: у каждого бота свой «жребий» от слота, порядок стабилен */
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    c.rank = mulberry32(hashSeed('nft-pick|' + slot + '|' + c.lc))();
  }
  candidates.sort(function (x, y) {
    if (x.rank !== y.rank) return x.rank - y.rank;
    return x.lc < y.lc ? -1 : x.lc > y.lc ? 1 : 0;
  });

  market.lots = tidyLots(market.lots, at);

  const opened = [];
  const listed = [];
  const feed = [];

  for (let i = 0; i < candidates.length && opened.length < want; i++) {
    const cand = candidates[i];
    const acc = cand.acc;
    const nick = nickOf(acc, cand.key);

    const knt = kntOf(acc);
    /* если KNT не хватает — покупаем в банке за USDT, как это делает игрок:
       курс 1 KNT = KNT_USD, комиссия банка 0.35% */
    if (knt.value < minPrice) {
      const need = round6(minPrice - knt.value);
      const cost = round2(need / (1 - SWAP_FEE) * KNT_USD);
      const usdt = num(knt.ex.usdt);
      if (!(usdt >= cost)) continue;
      knt.ex.usdt = round2(usdt - cost);
      setKnt(knt.ex, knt.key, round6(knt.value + need));
      knt.value = round6(knt.value + need);
      saveEx(acc, knt.ex);
    }
    if (!(knt.value >= minPrice)) continue;

    const affordable = [];
    for (let j = 0; j < cases.length; j++) {
      if (cases[j].priceKnt <= knt.value + 1e-9) affordable.push(cases[j]);
    }
    if (!affordable.length) continue;

    const rnd = mulberry32(hashSeed('nft-open|' + slot + '|' + cand.lc));
    const cs = affordable[Math.floor(rnd() * affordable.length) % affordable.length];

    /* 1. платим за кейс */
    setKnt(knt.ex, knt.key, knt.value - cs.priceKnt);

    /* 2. редкость по слотам кейса → модель этой редкости */
    const slotRar = String(weightedPick(rnd, cs.slots) || 'common').toLowerCase();
    const model = rollModel(rnd, pools, models, slotRar);
    if (!model) continue;                       // пустой контент — не списываем

    /* 3. аура по весам, множитель — в границах ауры */
    const aura = rollAura(rnd);
    const isNone = aura.id === 'none';
    const mult = isNone ? 1 : round2(aura.min + rnd() * (aura.max - aura.min));
    const value = Math.max(1, Math.round(model.base * mult));
    const attr = isNone ? null : AURA_ATTRS[Math.floor(rnd() * AURA_ATTRS.length) % AURA_ATTRS.length];

    const item = {
      id: newItemId(),
      model: model.id,
      aura: aura.id,
      attr: attr,
      mult: mult,
      value: value,
      price: 0,
      seller: '',
      t: at
    };

    /* 4. каждый второй дроп — сразу на витрину */
    let lot = null;
    if (rnd() < LIST_CHANCE) {
      const price = Math.max(1, Math.round(value * (PRICE_MULT_MIN + rnd() * (PRICE_MULT_MAX - PRICE_MULT_MIN))));
      lot = {
        id: item.id,
        seller: nick,
        model: model.id,
        aura: aura.id,
        mult: mult,
        value: value,
        price: price,
        t: at
      };
      item.price = price;
    }

    /* 5. предмет — в коллекцию, новые сверху, кэп 60 */
    const nft = nftOf(acc);
    nft.nft.items.unshift(item);
    if (nft.nft.items.length > ITEMS_MAX) nft.nft.items.length = ITEMS_MAX;
    nft.nft.opened = num(nft.nft.opened) + 1;
    saveNft(acc, nft.nft);
    saveEx(acc, knt.ex);
    acc.updated = at;
    acc.last_seen = at;

    if (lot) {
      market.lots.unshift(lot);
      listed.push(lot);
    }
    opened.push({ nick: nick, model: model.id, aura: aura.id, value: value, listed: !!lot });

    /* 6. события: сначала дроп, потом (если есть) лот */
    feed.push({ nick: nick, type: 'nft_open', text: 'вскрыл кейс «' + cs.ru + '» — выпал ' + model.name + ' (' + aura.id + ')' });
    if (lot) {
      feed.push({
        nick: nick, type: 'nft_list',
        text: 'выставил на продажу ' + model.name + ' (' + aura.id + ') за ' + lot.price + ' KNT',
        extra: { money: lot.price, sym: KNT_SYM }
      });
    }
  }

  if (!opened.length) {
    return {
      ok: true, at: at, slot: slot, want: want, opened: 0, listed: 0, feed: 0,
      reason: 'nopick', lots: market.lots.length, totalOpened: market.totalOpened,
      content: cnt.source
    };
  }

  if (market.lots.length > LOTS_MAX) market.lots.length = LOTS_MAX;
  market.totalOpened = num(market.totalOpened) + opened.length;
  market.updated = at;

  /* у вытесненных и просроченных лотов снимаем метку «на продаже» у предмета,
     иначе карточка в коллекции врёт про цену */
  syncLotMarkers(list, market.lots);

  try { await writeAll(list); }
  catch (e) { return { ok: false, err: 'write', msg: errText(e), at: at, opened: opened.length }; }
  try { await writeMarket(market); }
  catch (e) { return { ok: false, err: 'write_market', msg: errText(e), at: at, opened: opened.length, listed: listed.length }; }

  let sent = 0;
  for (let i = 0; i < feed.length && sent < FEED_MAX; i++) {
    try {
      if (await pushEvent(feed[i].nick, feed[i].type, feed[i].text, feed[i].extra)) sent++;
    } catch (e) { /* лента не должна ронять запуск */ }
  }

  return {
    ok: true,
    at: at,
    slot: slot,
    want: want,
    opened: opened.length,
    listed: listed.length,
    feed: sent,
    bots: opened.map(function (x) { return x.nick; }),
    lots: market.lots.length,
    totalOpened: market.totalOpened,
    content: cnt.source
  };
}

/* ============================================================================
   ВИТРИНА
   ============================================================================ */

export async function listLots() {
  let market = { lots: [], updated: 0, totalOpened: 0 };
  try { market = await readMarket(); }
  catch (e) { globalThis.__deErr = errText(e); }

  const at = Date.now();
  return {
    lots: tidyLots(market.lots, at),
    updated: num(market.updated),
    totalOpened: num(market.totalOpened)
  };
}

/* ============================================================================
   ПОКУПКА
   ============================================================================ */

export async function buyLot(nick, lotId) {
  const want = String(lotId === null || lotId === undefined ? '' : lotId).trim();
  if (!want) return { ok: false, err: 'nolot', msg: 'Лот не найден' };

  let list;
  let market;
  try { list = await readAll(); }
  catch (e) { return { ok: false, err: 'server', msg: errText(e) }; }
  try { market = await readMarket(); }
  catch (e) { return { ok: false, err: 'server', msg: errText(e) }; }

  const buyerHit = findAcc(list, nick);
  if (!buyerHit) return { ok: false, err: 'noacc', msg: 'Аккаунт не найден' };

  const idx = market.lots.findIndex(function (l) { return l && String(l.id) === want; });
  if (idx < 0) return { ok: false, err: 'nolot', msg: 'Лот уже продан или снят' };
  const lot = market.lots[idx];

  const price = Math.round(num(lot.price));
  if (!(price > 0)) return { ok: false, err: 'nolot', msg: 'Лот уже продан или снят' };

  const sellerHit = findAcc(list, lot.seller);
  if (!sellerHit) return { ok: false, err: 'nolot', msg: 'Продавец не найден' };
  if (sellerHit.acc === buyerHit.acc) return { ok: false, err: 'self', msg: 'Нельзя купить свой лот' };

  const buyer = kntOf(buyerHit.acc);
  if (!(buyer.value >= price)) {
    return { ok: false, err: 'nomoney', have: buyer.value, need: price, msg: 'Не хватает KNT' };
  }

  const fee = round2(price * FEE_RATE);
  const net = round2(price - fee);

  /* деньги: покупатель платит ровно цену, продавец получает 95% */
  setKnt(buyer.ex, buyer.key, buyer.value - price);
  saveEx(buyerHit.acc, buyer.ex);

  const seller = kntOf(sellerHit.acc);
  setKnt(seller.ex, seller.key, seller.value + net);
  saveEx(sellerHit.acc, seller.ex);

  /* предмет уходит из коллекции продавца (id лота = id предмета) */
  const sellerNft = nftOf(sellerHit.acc);
  const itemIdx = sellerNft.nft.items.findIndex(function (x) { return x && String(x.id) === String(lot.id); });
  let moved = null;
  if (itemIdx >= 0) moved = sellerNft.nft.items.splice(itemIdx, 1)[0];
  saveNft(sellerHit.acc, sellerNft.nft);

  const now = Date.now();
  const item = {
    id: String((moved && moved.id) || lot.id),
    model: String((moved && moved.model) || lot.model || ''),
    aura: String((moved && moved.aura) || lot.aura || 'none'),
    attr: (moved && moved.attr) || null,
    mult: round2(num((moved && moved.mult) || lot.mult) || 1),
    value: Math.max(1, Math.round(num((moved && moved.value) || lot.value) || price)),
    price: 0,
    seller: nickOf(sellerHit.acc, lot.seller),
    t: now
  };

  const buyerNft = nftOf(buyerHit.acc);
  buyerNft.nft.items.unshift(item);
  if (buyerNft.nft.items.length > ITEMS_MAX) buyerNft.nft.items.length = ITEMS_MAX;
  saveNft(buyerHit.acc, buyerNft.nft);

  buyerHit.acc.updated = now;
  sellerHit.acc.updated = now;

  market.lots.splice(idx, 1);
  market.updated = now;

  try { await writeAll(list); }
  catch (e) { return { ok: false, err: 'write', msg: errText(e) }; }
  try { await writeMarket(market); }
  catch (e) { return { ok: false, err: 'write_market', msg: errText(e) }; }

  try {
    await pushEvent(buyerHit.acc.nick || nick, 'nft_buy',
      'купил ' + item.model + ' (' + item.aura + ') у @' + item.seller + ' за ' + price + ' KNT',
      { money: price, sym: KNT_SYM });
    await pushEvent(sellerHit.acc.nick || lot.seller, 'nft_sell',
      'продал ' + item.model + ' (' + item.aura + ') @' + (buyerHit.acc.nick || nick) + ' за ' + net + ' KNT',
      { money: net, sym: KNT_SYM });
  } catch (e) { /* лента не должна ломать покупку */ }

  return { ok: true, item: item, price: price, fee: fee };
}

/* ============================================================================
   РОУТЕР ДЛЯ api.js
   Вызывать после handleSocial: если путь не наш — null, api.js идёт дальше.
   ============================================================================ */

export async function handleNft(req, p, body, u) {
  if (!req || !p) return null;
  const path = String(p).replace(/\/+$/, '') || '/';
  if (path !== '/api/nft/market' && path !== '/api/nft/buy') return null;

  const m = String(req.method || 'GET').toUpperCase();

  try {
    if (path === '/api/nft/market') {
      if (m !== 'GET') return fail('method', 405, 'Только GET');
      const out = await listLots();
      return json({ ok: true, lots: out.lots, updated: out.updated });
    }

    /* /api/nft/buy — обычное игровое действие, без админских ключей */
    if (m !== 'POST') return fail('method', 405, 'Только POST');
    if (!body) return fail('badreq', 400, 'Плохой запрос');

    let list;
    try { list = await readAll(); }
    catch (e) { return fail('server', 500, 'Хранилище недоступно'); }

    const hit = findAcc(list, body.nick);
    if (!hit) return fail('noacc', 404, 'Аккаунт не найден');
    if (hit.acc.pass !== String(body.pass || '')) return fail('badpass', 403, 'Неверный пароль');

    const res = await buyLot(body.nick, body.lotId);
    if (res.ok) return json(res);

    if (res.err === 'badpass') return fail('badpass', 403, 'Неверный пароль');
    if (res.err === 'nolot') return fail('nolot', 404, res.msg || 'Лот не найден');
    if (res.err === 'nomoney') {
      return json({ ok: false, err: 'nomoney', have: res.have, need: res.need, msg: res.msg || 'Не хватает KNT' }, 400);
    }
    if (res.err === 'self') return fail('self', 400, res.msg || 'Нельзя купить свой лот');
    if (res.err === 'noacc') return fail('noacc', 404, 'Аккаунт не найден');
    return fail('server', 500, 'Внутренняя ошибка');
  } catch (e) {
    return fail('server', 500, 'Внутренняя ошибка');
  }
}
