/* ============================================================================
   DE Exchange — «мозг» ботов-игроков.

   Чистая логика: ни сети, ни БД, ни process.env, ни импортов. На вход — обычный
   аккаунт игры, характер и контекст тика; на выход — НОВЫЙ аккаунт, события и
   заметки для runtime.

     stepBot(acc, persona, ctx) -> { acc, events, notes }

     ctx = { now:Number, prices:{SYM:price}, tick:Number }
     notes.plan  = null | { toSeed, amount }   — заявка на перевод; деньги НЕ списаны
     notes.patch = null | { bio } | { avatar } — патч профиля, применяет runtime

   Деньги лежат в state.ex — строке JSON { v:3, usdt, amounts, trades[] }.
   Все числа проходят через storeNum(): конечные, неотрицательные, в десятичной
   записи (без 1e+21 / 1e-7), чтобы клиентский JSON.parse и вёрстка не сходили с ума.
   История сделок — новые сверху, максимум TRADES_MAX=60 записей.

   Детерминизм: seed = mulberry32(hash32(nick_lc) ^ tick). Один и тот же тик,
   вызванный дважды, даёт побайтово один и тот же результат.

   КАЛИБРОВКА (почему константы такие):
     Рынок ботов — степенное распределение, а не «все разбогатели».
     Дневной результат = личный дрейф (skill + growthBias) + шум 0.6..2.0%
     + редкие пампы и обвалы с тяжёлым хвостом. Жёсткого потолка нет, но
     есть НАСЫЩЕНИЕ: выше WEALTH_SAT (3.1e15) дрейф и шум множатся на
     1/(1+sqrt(cap/WEALTH_SAT)), а с того же порога включается налог на
     роскошь. Поэтому самый богатый садится в 1e16..1e17 — он в десятки раз
     богаче человека, но не в сотни тысяч раз. Бедных держит зарплата,
     середину — пропорциональные траты, верх — насыщение.
   ============================================================================ */

import { MARKET_COINS, MARKET_PRICES } from './market-coins.js';

export const BOT_START_USDT = 10000;
export const TICK_MS = 20 * 60 * 1000;

/* ---------- рынок ---------- */

/* старые монеты биржи: свой курс и свой характер торговли */
const OLD_SYMBOLS = ['KNT', 'BTC', 'ETH', 'SOL', 'LTC', 'GRAM', 'ZBS'];

/* новые монеты — из единого справочника market-coins.js, чтобы у клиента и
   у ботов был один каталог и одни цены */
const NEW_SYMBOLS = MARKET_COINS.map(function (c) { return c.sym; });

/* всё, что бот может купить или продать */
const SYMBOLS = OLD_SYMBOLS.concat(NEW_SYMBOLS);

/* базовые курсы, USD: старые + каталог новых. STOCK/BOND не торгуются, но
   участвуют в капитале, поэтому их цены здесь тоже нужны. */
const BASE_PRICES = Object.assign({
  KNT: 325000, BTC: 80000, ETH: 3200, SOL: 220,
  LTC: 60, GRAM: 2.5, ZBS: 1.2,
  STOCK: 180, BOND: 1350
}, MARKET_PRICES);

/* максимальный дневной размах по монете (доля цены). KNT — «голубая фишка»
   с умеренным ходом, GRAM/ZBS — дешёвая мамба, куда лезут азартные.
   Новые: крупные спокойнее, мемы шумнее всех, USDC почти стоит. */
const VOL = {
  KNT: 0.050, BTC: 0.025, ETH: 0.035,
  SOL: 0.060, LTC: 0.040, GRAM: 0.090, ZBS: 0.090,
  BNB: 0.035, XRP: 0.055, DOGE: 0.085, ADA: 0.060,
  AVAX: 0.070, LINK: 0.060, TRX: 0.050, SUI: 0.075,
  XLM: 0.055, BCH: 0.050, UNI: 0.060, DOT: 0.060,
  HBAR: 0.065, NEAR: 0.070, XMR: 0.045, ZEC: 0.070,
  HYPE: 0.090, PEPE: 0.110, BONK: 0.110, FLOKI: 0.100,
  USDC: 0.004, AAVE: 0.055, DEX: 0.045
};

/* ---------- пределы хранения ---------- */

const TRADES_MAX = 60;          // история сделок (Blobs не должен пухнуть)
const NFT_MAX = 60;             // вещей в коллекции
const AMOUNT_MIN = 1e-6;        // пыль ниже этого не храним (JSON без 1e-7)
const STORE_MAX = 1e20;         // предохранитель ФОРМАТА, не экономики: 1e21
                                // JSON.stringify печатает как "1e+21"
/* ---------- поведение ---------- */

/* ---- дневной результат: экспонента с малым средним и тяжёлой дисперсией ---- */
const DRIFT_BASE = 0.0075;      // +0.75%/день базового роста (съедается тратами)
const DRIFT_SKILL = 0.0240;     // ±2.4%/день за skill (2 * (skill-0.5) * 0.024)
const DRIFT_BIAS = 0.0350;      // ±3.5%/день за личный growthBias (степень 0.45)
const NOISE_MIN = 0.006;        // дневной шум 0.6..2.0%
const NOISE_SPAN = 0.014;
const EXP_MAX = 0.95;           // максимум капитала в одной сделке
const LEV_MAX = 4.5;            // «уверенность»: азартный ставит почти всё
/* редкий «крупный вход»: раз в ~17 сделок бот заходит на 30..60% портфеля.
   Именно он даёт в истории и в ленте суммы в сотни тысяч и миллионы USDT,
   когда у бота уже есть капитал. */
const BIG_TRADE_P = 0.06;
const BIG_TRADE_MIN = 0.30;
const BIG_TRADE_MAX = 0.60;

const SALARY_MIN = 50;          // salaryTier * 50..400 в день
const SALARY_SPAN = 350;
const TIER0_MIN = 35;           // у бомжа «почти нет» — но жить на что-то надо
const TIER0_SPAN = 65;

const DIV_MIN = 0.0002;         // дивиденды 0.02..0.08% в день
const DIV_MAX = 0.0008;
const DIV_FROM = 5e4;
const DIV_FULL = 5e5;

const LIFE_RATE_MIN = 0.0030;   // доля капитала на жизнь 0.30..0.45% в день
const LIFE_RATE_MAX = 0.0045;
const LIFE_RAMP_FROM = 1e5;
const LIFE_RAMP_TO = 1e8;
const TAX_P = 0.0002;           // налог на роскошь 0.02..0.05% в день
const TAX_SPAN = 0.0003;
const TAX_FROM = 1e9;
/* выше WEALTH_SAT включается «налог на роскошь» 0.5..0.8%/день — вместе с
   насыщением дрейфа он и держит самого богатого в районе 1e16..1e17 */
const LUX_FROM = 3e15;
const LUX_P = 0.0040;
const LUX_SPAN = 0.0025;

const JUMP_P = 0.012;           // редкий памп
const DUMP_P = 0.0215;          // обвал компенсирует памп по лог-ожиданию
const WEALTH_SAT = 3.1e15;        // выше этого рост затухает: бог не растёт бесконечно
const JUMP_UP_MIN = 1.1;        // лог-размер пампа 1.1..4.9 → ×3..×134
const JUMP_UP_SPAN = 3.8;
const JUMP_DN_MIN = 0.5;        // лог-размер обвала 0.5..3.1 → ×0.04..×0.6
const JUMP_DN_SPAN = 2.6;

/* джекпот и крах — редкие события, которые меняют счёт в разы. Именно они,
   а не ровный дрейф, разводят капиталы: кто-то за день умножает счёт на 40,
   кто-то теряет две трети. Вероятности в день, как просил владелец. */
const JACKPOT_P = 0.004;        // 0.4%/день — ×5..×40
const JACKPOT_MIN = 5;
const JACKPOT_MAX = 40;
const CRASH_P = 0.006;          // 0.6%/день — ×0.3..×0.6
const CRASH_MIN = 0.30;
const CRASH_MAX = 0.60;

const PROFILE_P = 0.03;
const NFT_P = 0.01;
const NFT_MIN_USDT = 50000;
const NFT_COOLDOWN = 120;       // тиков между покупками NFT (≈2 месяца)
/* перевод — жест, но уже не мелочь: 0.5..4% капитала (у бота в кэше — ровно
   0.5..4% USDT), от 150 до 5 000 000 USDT за раз. Верхняя ступень нужна,
   чтобы в ленте жили суммы в миллионы. */
const TRANSFER_SHARE_MIN = 0.005;
const TRANSFER_SHARE_MAX = 0.04;
const TRANSFER_MIN = 150;
const TRANSFER_CAP = 5000000;  // потолок одного перевода
const TRANSFER_BASE = 0.005;
const TRANSFER_SOCIAL = 0.03;
/* у крупного счёта жестов больше: добавка к вероятности перевода растёт
   с капиталом и насыщается на 100 млн. Обычный бот (до 10 млн) шлёт ровно
   с прежней вероятностью — формула для него не изменилась. Без этой добавки
   миллионные переводы физически не попадают в ленту: 0.5..4% дают миллионы
   только у крупных счетов, а их единицы, и при прежней вероятности событие
   случается раз в десятки тиков. */
const TRANSFER_WHALE = 0.10;    // до +10 п.п. вероятности у самых крупных
const WHALE_FROM = 1e7;         // с какого капитала добавка начинает расти
const WHALE_FULL = 1e8;         // и на каком выходит на полную

/* ---------- тексты ---------- */

const BIOS = [
  'коплю на тачку',
  'в KNT верю',
  'тут чисто ради номеров',
  'мама, я на бирже',
  'купил GRAM — сижу довольный',
  'не финансовый совет',
  'всё продал, купил ZBS',
  'жду иксы, не будите',
  'просто мимо проходил',
  'торгую по наитию',
  'дисциплина и ещё раз дисциплина',
  'моя стратегия — не смотреть в график',
  'был бы умный — не торговал',
  'когда-нибудь куплю остров',
  'работаю на дядю, торгую на себя',
  'тут спокойнее, чем на работе'
];

const AVATAR_EMOJI = ['🐺', '🦊', '🐯', '🦁', '🐸', '🐼', '🦅', '🐉', '🦄', '👑', '💎', '🚀'];
const AVATAR_COLOR = ['#c0561b', '#8a5cf6', '#2ea043', '#e11d48', '#0ea5e9', '#f59e0b', '#64748b', '#ec4899'];

const NFT_MODEL = ['Genesis', 'Neon Fox', 'Golden Key', 'Ice Tiger', 'Pixel Crown', 'Meteor', 'Void Cat', 'Solar Wolf'];
const NFT_AURA = ['common', 'rare', 'epic', 'legendary', 'mythic', 'glitch', 'holo', 'shadow'];

/* ============================================================================
   ПСЕВДОСЛУЧАЙНОСТЬ
   ============================================================================ */

/* FNV-1a 32-bit: стабильный хеш строки в любом браузере и в Node */
function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ============================================================================
   МАЛЕНЬКИЕ ПОМОЩНИКИ
   ============================================================================ */

function num(v) {
  const n = typeof v === 'number' ? v : Number(v);
  return isFinite(n) ? n : 0;
}

function clamp01(v) {
  const n = num(v);
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function clampInt(v, lo, hi) {
  const n = Math.floor(num(v));
  return n < lo ? lo : n > hi ? hi : n;
}

function asObj(v) {
  return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
}

function smoothstep(a, b, x) {
  if (!(b > a)) return x >= b ? 1 : 0;
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/* число для хранения в JSON: конечное, >=0, десятичная запись */
function storeNum(n) {
  if (typeof n !== 'number' || !isFinite(n) || n <= 0) return 0;
  if (n > STORE_MAX) n = STORE_MAX;
  if (n >= 1e6) return Math.round(n);
  const r = Math.round(n * 1e6) / 1e6;
  return r > 0 ? r : 0;
}

/* то же, но со знаком — для прибыли/убытка в истории сделок */
function signedNum(n) {
  if (typeof n !== 'number' || !isFinite(n)) return 0;
  if (n > STORE_MAX) n = STORE_MAX;
  if (n < -STORE_MAX) n = -STORE_MAX;
  if (Math.abs(n) >= 1e6) return Math.round(n);
  return Math.round(n * 1e6) / 1e6;
}

/* количество монеты: та же дисциплина, но с отсечкой пыли */
function storeQty(n) {
  const v = storeNum(n);
  return v < AMOUNT_MIN ? 0 : v;
}

/* короткое число для текста события */
function fmtShort(n) {
  const a = Math.abs(num(n));
  if (a >= 1e15) return (n / 1e15).toFixed(1) + 'Q';
  if (a >= 1e12) return (n / 1e12).toFixed(1) + 'T';
  if (a >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (a >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(Math.round(a));
}

/* сумма с разрядами: 2400000 → «2 400 000». Миллионы читаются только так. */
function fmtUsdt(n) {
  const v = Math.round(Math.abs(num(n)));
  if (!(v > 0) || !isFinite(v)) return '0';
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/* тексты событий — до 90 символов, без эмодзи */
function cutText(s) {
  const arr = Array.from(String(s === null || s === undefined ? '' : s));
  if (arr.length <= 90) return arr.join('');
  return arr.slice(0, 89).join('') + '…';
}

function event(kind, text, extra) {
  const e = { kind: kind, text: cutText(text) };
  if (extra) {
    for (const k in extra) e[k] = extra[k];
  }
  return e;
}

/* короткий текст сделки */
function tradeText(tr) {
  const amount = fmtShort(Math.abs(tr.pnl)) + ' USDT';
  if (tr.pnl >= 0) return 'вышел в плюс на ' + tr.sym + ' +' + amount;
  return 'ушел в минус на ' + tr.sym + ' -' + amount;
}

/* ============================================================================
   ХАРАКТЕР
   ============================================================================ */

/* один и тот же index всегда даёт один и тот же характер */
export function personaFor(index) {
  const idx = Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0;
  const rnd = mulberry32(hash32('de-bot/persona/' + idx));
  const r = function () { return rnd(); };
  const noise = function () { return r() - 0.5; };

  /* «талант» — общий фактор: талантливые и рискуют, и выигрывают чаще.
     Скошен влево: большинство середняки, но хвост доходит до 1. */
  const talent = Math.pow(clamp01(r()), 1.7);

  /* «фарт»: личный множитель роста, лог-нормальный и сильно скошенный —
     у большинства почти ноль, у редких счастливцев заметный плюс.
     Это и есть источник степенного хвоста, а не общий для всех дрейф. */
  const growthBias = Math.pow(clamp01(r()), 3);

  const skill = clamp01(0.10 + 0.86 * talent + 0.16 * noise());
  const risk = clamp01(0.04 + 0.92 * (0.30 * talent + 0.70 * Math.pow(clamp01(r()), 1.2)) + 0.08 * noise());
  const patience = clamp01(0.10 + 0.85 * r());
  const luck = clamp01(r());
  const spend = clamp01(Math.pow(clamp01(r()), 0.85));
  const social = clamp01(Math.pow(clamp01(r()), 1.7));
  const ambition = clamp01(0.08 + 0.52 * talent + 0.45 * Math.pow(clamp01(r()), 1.1));
  const activity = clamp01(0.25 + 0.70 * r());

  /* доход: 15% бомжи, 40% мелкий, 30% хороший, 15% рантье */
  const t = r();
  const salaryTier = t < 0.15 ? 0 : t < 0.55 ? 1 : t < 0.85 ? 2 : 3;

  return {
    index: idx,
    risk: risk,
    skill: skill,
    patience: patience,
    luck: luck,
    spend: spend,
    social: social,
    ambition: ambition,
    activity: activity,
    growthBias: growthBias,
    salaryTier: salaryTier
  };
}

/* стартовый капитал: медиана ~10k, разброс 0.7..1.3 */
export function startCapital(persona, rand) {
  const p = asObj(persona);
  const r = typeof rand === 'function' ? rand : mulberry32(0x51ed270b);
  const tier = clampInt(p.salaryTier, 0, 3);
  const roll = clamp01(r());
  const spread = 0.70 + 0.60 * roll;                       // 0.70..1.30
  const byTier = 1 + 0.04 * tier;                          // рантье стартуют чуть выше
  const byLuck = 1 + 0.06 * (clamp01(p.luck) - 0.5) * 2;   // 0.94..1.06
  const cap = BOT_START_USDT * spread * byTier * byLuck;
  return Math.max(1000, Math.round(cap / 10) * 10);
}

/* ============================================================================
   АККАУНТ: ЧТЕНИЕ / ЗАПИСЬ
   ============================================================================ */

function readEx(raw) {
  let obj = null;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) obj = raw;
  else if (typeof raw === 'string' && raw.length) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) obj = parsed;
    } catch (e) {
      obj = null;                       // битый JSON — начинаем с чистого счёта
    }
  }
  const src = asObj(obj);
  const ex = {};
  for (const k in src) ex[k] = src[k];   // чужие поля не теряем

  ex.v = 3;
  ex.usdt = storeNum(num(src.usdt));

  /* amounts: только известные активы, только конечные неотрицательные числа.
     Мусорные ключи и строки выбрасываем — иначе они всплывут в капитале. */
  const amounts = {};
  const srcAmounts = asObj(src.amounts);
  for (const k in srcAmounts) {
    const sym = String(k).toUpperCase();
    if (!BASE_PRICES[sym]) continue;
    const v = storeQty(num(srcAmounts[k]));
    if (v > 0) amounts[sym] = v;
  }
  ex.amounts = amounts;

  /* порядок не трогаем: он может быть любой, режем только длину */
  ex.trades = Array.isArray(src.trades) ? src.trades.slice(0, TRADES_MAX) : [];
  return ex;
}

function amountOf(ex, sym) {
  return num(ex.amounts[sym]);
}

function setAmount(ex, sym, v) {
  const q = storeQty(v);
  if (q > 0) ex.amounts[sym] = q;
  else delete ex.amounts[sym];
}

function addAmount(ex, sym, d) {
  setAmount(ex, sym, amountOf(ex, sym) + d);
}

function pushTrade(ex, rec) {
  ex.trades.unshift(rec);
  if (ex.trades.length > TRADES_MAX) ex.trades.length = TRADES_MAX;
}

function readNft(raw) {
  let obj = null;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) obj = raw;
  else if (typeof raw === 'string' && raw.length) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) obj = parsed;
    } catch (e) {
      obj = null;
    }
  }
  const nft = asObj(obj);
  return {
    items: Array.isArray(nft.items) ? nft.items.slice(0, NFT_MAX) : [],
    opened: clampInt(nft.opened, 0, 1e9)
  };
}

/* цены: только торгуемые символы, всегда положительные */
function normPrices(src) {
  const s = asObj(src);
  const out = {};
  for (let i = 0; i < SYMBOLS.length; i++) {
    const sym = SYMBOLS[i];
    const raw = s[sym] !== undefined ? s[sym] : BASE_PRICES[sym];
    const v = num(raw);
    out[sym] = (v > 0 && isFinite(v)) ? v : BASE_PRICES[sym];
  }
  return out;
}

function priceOf(sym, prices) {
  const p = num(prices[sym]) || num(BASE_PRICES[sym]);
  return (p > 0 && isFinite(p)) ? p : 0;
}

function equityOf(ex, prices) {
  let eq = num(ex.usdt);
  for (const sym in ex.amounts) {
    const p = priceOf(sym, prices);
    if (p > 0) eq += amountOf(ex, sym) * p;
  }
  if (!isFinite(eq) || eq < 0) return 0;
  return eq > STORE_MAX ? STORE_MAX : eq;
}

/* множитель на весь портфель: дневной результат бота.
   Цены в этой схеме фиксированы, поэтому «рынок сходил на M%» хранится как
   изменение количеств — капитал при этом меняется ровно в mult раз. */
function applyGrowth(ex, mult) {
  if (!(mult > 0) || !isFinite(mult)) return;
  ex.usdt = storeNum(num(ex.usdt) * mult);
  for (const s in ex.amounts) setAmount(ex, s, amountOf(ex, s) * mult);
}

/* финальная гигиена счёта: количество каждой монеты ограничиваем так,
   чтобы её СТОИМОСТЬ не превышала STORE_MAX. Иначе 1e20 KNT по 325000 —
   это 3e25 в капитале и «1e+25» в JSON, который ломает вёрстку клиента. */
function clampEx(ex, prices) {
  ex.usdt = storeNum(num(ex.usdt));
  for (const s in ex.amounts) {
    const p = priceOf(s, prices);
    if (!(p > 0)) { delete ex.amounts[s]; continue; }
    const q = amountOf(ex, s);
    if (!(q > 0) || !isFinite(q)) { delete ex.amounts[s]; continue; }
    const maxQ = STORE_MAX / p;
    if (q > maxQ) setAmount(ex, s, maxQ);
  }
}

/* крупнейшая позиция: продаём то, что реально есть на руках */
function largestHolding(ex, prices) {
  let sym = null;
  let best = 0;
  for (const s in ex.amounts) {
    const p = priceOf(s, prices);
    if (!(p > 0)) continue;
    const v = amountOf(ex, s) * p;
    if (v > best) { best = v; sym = s; }
  }
  return sym;
}

/* ============================================================================
   ТОРГОВЛЯ
   ============================================================================ */

/* ---------- веса выбора монеты ----------
   Старые монеты получают 55% выбора, все новые — 45%. Внутри новых DEX —
   собственная монета биржи — берётся редко, ровно 2% от общего выбора,
   остальные 43% делят популярные (BNB, XRP, DOGE…) и мемы (PEPE, BONK,
   FLOKI) по таблице NEW_WEIGHTS. Сумма долей = 55 + 45 = 100%. */
const OLD_SHARE = 0.55;
const NEW_SHARE = 0.45;
const DEX_SHARE = 0.02;
const NEW_REST_SHARE = NEW_SHARE - DEX_SHARE;   // 0.43 — на все новые, кроме DEX

/* популярные новые монеты берут больше шансов, мемы — меньше */
const NEW_WEIGHTS = {
  BNB: 5.0, XRP: 6.0, DOGE: 7.0, ADA: 5.0,
  AVAX: 5.0, LINK: 4.0, TRX: 5.0, SUI: 4.0,
  XLM: 2.6, BCH: 2.6, UNI: 2.2, DOT: 2.2,
  HBAR: 2.2, NEAR: 2.2, XMR: 1.6, ZEC: 1.6,
  HYPE: 2.6, USDC: 1.6, AAVE: 1.6,
  PEPE: 1.2, BONK: 1.2, FLOKI: 1.2
};

let NEW_WEIGHT_SUM = 0;
for (const k in NEW_WEIGHTS) NEW_WEIGHT_SUM += NEW_WEIGHTS[k];

/* вес новой монеты в общей сумме; незнакомая монета каталога получает
   крошечный шанс, но не ноль — иначе её нельзя было бы продать */
function newSymbolWeight(sym) {
  if (sym === 'DEX') return DEX_SHARE;
  const raw = NEW_WEIGHTS[sym];
  if (raw > 0 && NEW_WEIGHT_SUM > 0) return NEW_REST_SHARE * raw / NEW_WEIGHT_SUM;
  return 0.0001;
}

/* монета под характер: амбициозные — в KNT, азартные — в GRAM/ZBS,
   новые делят свою долю по популярности. */
function pickSymbol(p, rnd, prices, eq) {
  /* 1. личные веса старых монет */
  const oldRaw = [];
  let oldSum = 0;
  for (let i = 0; i < OLD_SYMBOLS.length; i++) {
    const sym = OLD_SYMBOLS[i];
    let x;
    if (sym === 'KNT') x = 0.25 + 3.0 * p.ambition * p.ambition;
    else if (sym === 'BTC') x = 0.50 + 1.50 * p.ambition * p.patience;
    else if (sym === 'ETH') x = 0.50 + 1.20 * p.ambition;
    else if (sym === 'SOL') x = 0.40 + 1.30 * p.risk;
    else if (sym === 'LTC') x = 0.40 + 0.80 * (1 - p.risk);
    else x = 0.15 + 3.20 * p.risk * (1 - p.patience);      // GRAM, ZBS
    if (!(x > 0)) x = 0.01;
    oldRaw.push(x);
    oldSum += x;
  }

  /* 2. веса новых монет из таблицы популярности */
  const newRaw = [];
  let newSum = 0;
  for (let i = 0; i < NEW_SYMBOLS.length; i++) {
    const sym = NEW_SYMBOLS[i];
    let x = newSymbolWeight(sym);
    /* дорогая монета бедному боту почти недоступна — скидка внутри группы */
    if (prices[sym] > eq * 0.25) x *= 0.12;
    if (!(x > 0)) x = 0.0001;
    newRaw.push(x);
    newSum += x;
  }

  /* 3. групповые доли фиксируем ПОСЛЕ скидки за дороговизну: старые — 55%,
        новые — 45%. Иначе KNT/BTC (их давит скидка) утягивали бы всю
        старую группу ниже заявленного веса. */
  const oldScale = oldSum > 0 ? OLD_SHARE / oldSum : 0;
  const newScale = newSum > 0 ? NEW_SHARE / newSum : 0;

  const w = [];
  let total = 0;
  for (let i = 0; i < oldRaw.length; i++) {
    const x = oldRaw[i] * oldScale;
    w.push(x);
    total += x;
  }
  for (let i = 0; i < newRaw.length; i++) {
    const x = newRaw[i] * newScale;
    w.push(x);
    total += x;
  }

  let roll = rnd() * total;
  for (let i = 0; i < w.length; i++) {
    roll -= w[i];
    if (roll <= 0) return SYMBOLS[i];
  }
  return SYMBOLS[SYMBOLS.length - 1];
}

/* размер дневного хода: 1..9%, зависит от монеты */
function ampOf(sym, rnd) {
  const base = VOL[sym] || 0.045;
  return base * (0.45 + 0.55 * rnd());
}

/* одна сделка: конвертация доли капитала с исполнением r.
   BUY:  потратил m USDT, получил (m/P)*(1+r) монет
   SELL: продал m/P монет, получил m*(1+r) USDT
   Капитал меняется ровно на m*r, монеты и USDT не уходят в минус. */
function tradeOnce(ex, p, rnd, now, prices, eq) {
  if (!(eq > 0)) return null;

  /* чем больше капитала уже в монетах, тем охотнее бот продаёт;
     продаём именно крупнейшую позицию, иначе сделка упирается в пыль */
  const coinShare = Math.max(0, Math.min(1, 1 - num(ex.usdt) / eq));
  let side = 'SELL';
  let sym = largestHolding(ex, prices);
  if (!sym || rnd() > Math.min(0.70, 0.10 + coinShare * 0.85)) {
    side = 'BUY';
    sym = pickSymbol(p, rnd, prices, eq);
  }
  if (!(prices[sym] > 0)) return null;

  /* доля капитала: 2..25% в обычной сделке, у азартных «уверенность» множит.
     С шансом BIG_TRADE_P бот входит по-крупному — на 30..60% портфеля: так
     в истории появляются суммы в сотни тысяч и миллионы USDT, а не только
     проценты. Обе ветки ограничены EXP_MAX сверху. */
  const sizeNoise = 0.55 + 0.75 * rnd();
  const conv = 1 + LEV_MAX * Math.pow(p.risk, 3);
  const bigRoll = rnd() < BIG_TRADE_P;
  const expo = bigRoll
    ? Math.min(EXP_MAX, BIG_TRADE_MIN + (BIG_TRADE_MAX - BIG_TRADE_MIN) * rnd())
    : Math.min(EXP_MAX, (0.02 + 0.23 * p.risk) * conv * sizeNoise);

  const stake = eq * expo;
  if (!(stake > 0)) return null;

  let m;
  if (side === 'SELL') {
    m = Math.min(stake, amountOf(ex, sym) * prices[sym]);
    if (!(m > eq * 0.002) && num(ex.usdt) > eq * 0.01) {
      side = 'BUY';
      sym = pickSymbol(p, rnd, prices, eq);
      m = Math.min(stake, num(ex.usdt) * 0.98);
    }
  } else {
    m = Math.min(stake, num(ex.usdt) * 0.98);
    if (!(m > eq * 0.002)) {
      const hold = largestHolding(ex, prices);
      if (hold) {
        side = 'SELL';
        sym = hold;
        m = Math.min(stake, amountOf(ex, hold) * prices[hold]);
      }
    }
  }
  if (!(m > eq * 0.002)) return null;
  const price = prices[sym];
  if (!(price > 0)) return null;
  if (!(m / price > 0)) return null;

  /* исход обычной сделки: симметричный, без перевеса — он в дневном
     результате. Амплитуда меньше, чтобы «болтанка» не перебивала дрейф. */
  const amp = ampOf(sym, rnd) * 0.4;
  const r = rnd() < 0.5 ? amp : -amp;
  const kind = 'trade';

  const qty = m / price;

  if (side === 'BUY') {
    setAmount(ex, sym, amountOf(ex, sym) + qty * (1 + r));
    ex.usdt = storeNum(num(ex.usdt) - m);
  } else {
    setAmount(ex, sym, amountOf(ex, sym) - qty);
    ex.usdt = storeNum(num(ex.usdt) + m * (1 + r));
  }

  const rec = {
    t: now,
    side: side,
    sym: sym,
    qty: storeQty(qty),
    price: price,
    total: storeNum(m),
    pnl: signedNum(m * r)
  };
  pushTrade(ex, rec);

  return { sym: sym, side: side, r: r, m: m, pnl: m * r, kind: kind };
}


/* ============================================================================
   ОСНОВНОЙ ШАГ
   ============================================================================ */

/* Починка битого входа: нет state, битый ex, отрицательные/строковые суммы.
   Чистый аккаунт возвращается ТЕМ ЖЕ объектом — спящего бота не трогаем. */
function repairAcc(acc) {
  if (!acc || typeof acc !== 'object') return acc;
  const hasState = acc.state && typeof acc.state === 'object';
  const st = asObj(acc.state);
  const ex = readEx(st.ex);
  clampEx(ex, BASE_PRICES);
  const fixed = JSON.stringify(ex);
  if (hasState && typeof st.ex === 'string' && st.ex === fixed) return acc;
  const out = {};
  for (const k in acc) out[k] = acc[k];
  out.state = Object.assign({}, st, { ex: fixed });
  return out;
}

export function stepBot(acc, persona, ctx) {
  const events = [];
  const notes = { plan: null, patch: null };

  if (!acc || typeof acc !== 'object') return { acc: acc, events: events, notes: notes };

  const p = normalizePersona(persona, acc);
  const c = asObj(ctx);
  const now = Math.max(0, Math.round(num(c.now)));
  const prices = normPrices(c.prices);
  const tick = Number.isFinite(c.tick) ? Math.floor(c.tick) : Math.floor(now / TICK_MS);

  const key = String(acc.nick_lc || acc.nick || 'bot').toLowerCase();
  const rnd = mulberry32(hash32(key) ^ (tick >>> 0));

  /* 1. спит — экономику не трогаем; чиним только битые данные */
  if (rnd() >= p.activity) return { acc: repairAcc(acc), events: events, notes: notes };

  /* дальше работаем с копией: входной аккаунт не мутируем */
  const out = {};
  for (const k in acc) out[k] = acc[k];
  out.state = asObj(acc.state);
  const ex = readEx(out.state.ex);

  const eq0 = equityOf(ex, prices);
  let income = 0;
  let spend = 0;

  /* 2. доход: зарплата + дивиденды */
  if (p.salaryTier > 0) {
    const weak = 1 + 0.08 * Math.log10(1 + eq0 / BOT_START_USDT);   // 1..~1.6
    income += p.salaryTier * (SALARY_MIN + SALARY_SPAN * rnd()) * Math.min(weak, 1.6);
  } else {
    income += TIER0_MIN + TIER0_SPAN * rnd();   // «почти нет»: подработка курьером
  }
  const divRamp = smoothstep(DIV_FROM, DIV_FULL, eq0);
  if (divRamp > 0) income += eq0 * (DIV_MIN + (DIV_MAX - DIV_MIN) * rnd()) * divRamp;
  if (income > 0) ex.usdt = storeNum(num(ex.usdt) + income);

  /* 3. траты: жизнь (растёт с капиталом мягко) + «игрушки» долей капитала
        + налог на роскошь. Бедный не может потратить больше, чем имеет, —
        поэтому «на мели» это равновесие, а не обнуление. */
  const rateRamp = smoothstep(LIFE_RAMP_FROM, LIFE_RAMP_TO, eq0);
  const lifeRate = LIFE_RATE_MIN + (LIFE_RATE_MAX - LIFE_RATE_MIN) * rateRamp;
  const richScale = Math.pow(Math.max(1, eq0 / BOT_START_USDT), 0.35);
  const baseLife = (15 + 60 * rnd()) * (0.45 + 1.10 * p.spend) * richScale;
  let life = baseLife + eq0 * lifeRate * (0.5 + p.spend);
  life = Math.min(life, eq0 * 0.02 + 15);
  if (eq0 > TAX_FROM) life += eq0 * (TAX_P + TAX_SPAN * rnd());
  if (eq0 > LUX_FROM) life += eq0 * (LUX_P + LUX_SPAN * rnd());
  spend = storeNum(life);

  const pay = Math.min(spend, num(ex.usdt));
  ex.usdt = storeNum(num(ex.usdt) - pay);
  let unpaid = spend - pay;
  if (unpaid > 0) {
    /* не хватило кэша — распродаём монеты и сразу отдаём выручку:
       на счёт она не зачисляется, иначе расход не состоялся бы */
    for (let pass = 0; pass < 3 && unpaid > 0; pass++) {
      const bs = largestHolding(ex, prices);
      if (!bs) break;
      const bv = amountOf(ex, bs) * priceOf(bs, prices);
      if (!(bv > 0)) break;
      const take = Math.min(bv, unpaid);
      const px = priceOf(bs, prices);
      const q = take / px;
      setAmount(ex, bs, amountOf(ex, bs) - q);
      unpaid -= take;
      pushTrade(ex, {
        t: now, side: 'SELL', sym: bs,
        qty: storeQty(q), price: px, total: storeNum(take)
      });
    }
  }
  const paidFully = unpaid <= 0 && spend > 0;
  if (!paidFully && eq0 < BOT_START_USDT * 0.4 && rnd() < 0.25) {
    events.push(event('broke', 'на мели'));
  }

  /* 4. результат дня — та самая экспонента: личный дрейф + шум + редкое
        событие. Применяем к портфелю целиком, поэтому множитель капитала
        ровно такой, какой задуман, и «бесплатного» перекоса нет. */
  const eqBefore = equityOf(ex, prices);
  /* bias входит дробной степенью 0.45 (growthBias = r^3, то есть r^1.35):
     медианный бот не получает -2%/день только за то, что родился без фарта,
     но «одарённые» уходят заметно выше среднего — отсюда и разброс. */
  const drift = DRIFT_BASE + DRIFT_SKILL * (p.skill - 0.5) * 2 + DRIFT_BIAS * (Math.pow(p.growthBias, 0.45) - 0.5) * 2;
  const sigma = NOISE_MIN + NOISE_SPAN * p.risk;
  /* насыщение: чем ближе капитал к WEALTH_SAT, тем слабее и дрейф, и шум.
     Это не кап, а естественное торможение — богатому всё труднее расти. */
  const sat = 1 / (1 + Math.sqrt(Math.max(0, eqBefore / WEALTH_SAT)));
  const noise = (rnd() * 2 - 1) * sigma;
  const dayLog = drift + noise;
  let jumpMult = 0;
  let jumpUp = false;
  const rollJ = rnd();
  if (rollJ < JUMP_P) {
    const u = rnd();
    jumpMult = Math.exp(JUMP_UP_MIN + JUMP_UP_SPAN * u * u * u);
    jumpUp = true;
  } else if (rollJ < JUMP_P + DUMP_P) {
    const u = rnd();
    jumpMult = Math.exp(-(JUMP_DN_MIN + JUMP_DN_SPAN * u * u * u));
    jumpUp = false;
  }
  const totalLog = (dayLog + (jumpMult > 0 ? Math.log(jumpMult) : 0)) * sat;
  const dayMult = Math.exp(totalLog);

  if (isFinite(dayMult) && dayMult > 0 && eqBefore > 0) {
    applyGrowth(ex, dayMult);
    const pnl = eqBefore * (dayMult - 1);
    if (jumpMult > 0) {
      const sym = largestHolding(ex, prices) || pickSymbol(p, rnd, prices, eqBefore);
      const px = priceOf(sym, prices);
      events.push(event(jumpUp ? 'jump' : 'dump',
        (jumpUp ? 'сорвал куш на ' : 'попал под обвал ') + sym + ' ×' + jumpMult.toFixed(1),
        { sym: sym, mult: jumpMult, pnl: signedNum(pnl) }));
      if (px > 0) {
        pushTrade(ex, {
          t: now, side: pnl >= 0 ? 'BUY' : 'SELL', sym: sym,
          qty: storeQty(Math.abs(pnl) / px), price: px, total: storeNum(Math.abs(pnl)),
          pnl: signedNum(pnl)
        });
      }
    }
  }

  /* 4b. джекпот или крах: редкое событие поверх дневного результата.
        Множитель не насыщается — это лотерея, а не дрейф, поэтому капиталы
        расходятся в разы, а не идут строем. */
  if (eq0 > 0) {
    const rollL = rnd();
    let luckMult = 0;
    let luckUp = false;
    if (rollL < JACKPOT_P) {
      const u = rnd();
      luckMult = JACKPOT_MIN + (JACKPOT_MAX - JACKPOT_MIN) * u * u;   // чаще ближе к ×5
      luckUp = true;
    } else if (rollL < JACKPOT_P + CRASH_P) {
      luckMult = CRASH_MIN + (CRASH_MAX - CRASH_MIN) * rnd();
      luckUp = false;
    }
    if (luckMult > 0) {
      const eqJ = equityOf(ex, prices);
      if (eqJ > 0) {
        applyGrowth(ex, luckMult);
        const delta = equityOf(ex, prices) - eqJ;
        if (isFinite(delta) && delta !== 0) {
          const abs = Math.abs(delta);
          events.push(event(luckUp ? 'jump' : 'dump',
            luckUp ? ('сорвал куш: +' + fmtUsdt(abs) + ' USDT')
              : ('обвал: -' + fmtUsdt(abs) + ' USDT'),
            { mult: luckMult, pnl: signedNum(delta) }));
        }
      }
    }
  }

  /* 5. обычные сделки: двигают amounts и оживляют историю, капитал почти
        не трогают (перевеса у них нет — он в дневном результате выше) */
  const pTrade = 0.35 + 0.55 * (0.45 * p.ambition + 0.55 * p.risk);
  let trades = 0;
  if (rnd() < pTrade) {
    const two = rnd() < 0.25 + 0.5 * Math.max(p.ambition, p.risk);
    const n = two ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const eq = equityOf(ex, prices);
      const tr = tradeOnce(ex, p, rnd, now, prices, eq);
      if (!tr) break;
      trades++;
      const text = tradeText(tr);
      events.push(event('trade', text, {
        side: tr.side, sym: tr.sym, pnl: signedNum(tr.pnl), r: tr.r
      }));
    }
  }

  /* 6. перевод другому боту: только заявка, деньги НЕ списываем.
        0.5..4% капитала (у бота, который держит всё в кэше, это ровно
        0.5..4% USDT), но не меньше 150 и не больше 5 000 000 USDT. Если кэша
        не хватит, рантайм продаст монеты — поэтому перевод остаётся крупным
        и у того, кто держит капитал в монетах, а не только в USDT. */
  const capNow = equityOf(ex, prices);
  const pTransfer = TRANSFER_BASE + TRANSFER_SOCIAL * p.social + TRANSFER_WHALE * smoothstep(WHALE_FROM, WHALE_FULL, capNow);
  if (capNow > 200 && rnd() < pTransfer) {
    const share = TRANSFER_SHARE_MIN + (TRANSFER_SHARE_MAX - TRANSFER_SHARE_MIN) * rnd();
    let raw = capNow * share;
    if (raw < TRANSFER_MIN) raw = Math.min(TRANSFER_MIN, capNow * 0.85);
    if (raw > TRANSFER_CAP) raw = TRANSFER_CAP;
    if (raw > capNow * 0.85) raw = capNow * 0.85;     // счёт не опустошаем
    const amount = storeNum(raw);
    if (amount >= 1) {
      const toSeed = Math.floor(rnd() * 2147483647);
      notes.plan = { toSeed: toSeed, amount: amount };
      const from = String(acc.nick || acc.nick_lc || 'бот');
      events.push(event('transfer_plan',
        'перевёл ' + fmtShort(amount) + ' USDT (исх. ' + from + ')',
        { from: from, amount: amount, toSeed: toSeed }));
    }
  }

  /* 7. профиль: био или аватар */
  if (rnd() < PROFILE_P) {
    if (rnd() < 0.5) {
      const bio = BIOS[Math.floor(rnd() * BIOS.length) % BIOS.length];
      notes.patch = { bio: bio };
      events.push(event('profile', 'сменил био: ' + bio, { bio: bio }));
    } else {
      const avatar = {
        emoji: AVATAR_EMOJI[Math.floor(rnd() * AVATAR_EMOJI.length) % AVATAR_EMOJI.length],
        color: AVATAR_COLOR[Math.floor(rnd() * AVATAR_COLOR.length) % AVATAR_COLOR.length]
      };
      notes.patch = { avatar: avatar };
      events.push(event('profile', 'сменил аватар', { avatar: avatar }));
    }
  }

  /* 8. NFT: только если есть чем и не покупал в последние два месяца */
  const usdtNft = num(ex.usdt);
  if (usdtNft > NFT_MIN_USDT && rnd() < NFT_P) {
    const nft = readNft(out.state.nft);
    const lastT = nft.items.length ? num(nft.items[0].t) : 0;
    const price = storeNum(usdtNft * (0.05 + 0.10 * rnd()));
    if (price >= 100 && now - lastT >= NFT_COOLDOWN * TICK_MS) {
      ex.usdt = storeNum(usdtNft - price);
      const item = {
        id: 'nft-' + hash32(key + ':' + tick).toString(16) + '-' + nft.items.length,
        model: NFT_MODEL[Math.floor(rnd() * NFT_MODEL.length) % NFT_MODEL.length],
        aura: NFT_AURA[Math.floor(rnd() * NFT_AURA.length) % NFT_AURA.length],
        value: price,
        t: now
      };
      nft.items.unshift(item);
      if (nft.items.length > NFT_MAX) nft.items.length = NFT_MAX;
      nft.opened = nft.opened + 1;
      out.state = Object.assign({}, out.state, { nft: JSON.stringify(nft) });
      events.push(event('nft', 'купил NFT "' + item.model + '"', { id: item.id, value: price }));
    }
  }

  /* 9. записываем счёт и метку */
  clampEx(ex, prices);
  out.state = Object.assign({}, out.state, { ex: JSON.stringify(ex) });
  out.last_seen = now;

  notes.trades = trades;
  notes.income = storeNum(income);
  notes.spend = spend;
  notes.dayLog = totalLog;
  if (events.length > 8) events.length = 8;

  return { acc: out, events: events, notes: notes };
}

/* ============================================================================
   НОРМАЛИЗАЦИЯ ВХОДА
   ============================================================================ */

function normalizePersona(persona, acc) {
  const src = (persona && typeof persona === 'object') ? persona
    : (acc && acc.persona && typeof acc.persona === 'object') ? acc.persona
      : null;
  if (!src) return personaFor(0);
  return {
    index: clampInt(src.index, 0, 1e9),
    risk: clamp01(src.risk),
    skill: clamp01(src.skill),
    patience: clamp01(src.patience),
    luck: clamp01(src.luck),
    spend: clamp01(src.spend),
    social: clamp01(src.social),
    ambition: clamp01(src.ambition),
    activity: src.activity === undefined ? 0.7 : clamp01(src.activity),
    growthBias: src.growthBias === undefined ? personaFor(clampInt(src.index, 0, 1e9)).growthBias : clamp01(src.growthBias),
    salaryTier: clampInt(src.salaryTier, 0, 3)
  };
}
