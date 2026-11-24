/* ============================================================================
   DE — БОТЫ: жизнь 50 игроков на бирже.
   Здесь три дела: создать ботов (seedBots), первично подписать их (seedFollows)
   и прокрутить один тик (runTick).
   Netlify Functions (ESM) + Netlify Blobs; хранилище общее с api.js.

   Кто вызывает:
     • крон Netlify — export default (расписание в netlify.toml, каждые 20 минут);
     • вручную — POST /api/bots/tick из api.js (runTick).
   Железные правила:
     • деньги и профиль трогаем только у ботов; соцсчётчики — всем аккаунтам;
     • accounts пишем ровно один раз за вызов, даже если догнали 24 дня;
     • edges читаем и пишем один раз за тик, счётчики — строго по edges;
     • до 10 событий в ленту за вызов (догон суток не спамит):
       transfer_in / transfer_out / milestone / follow;
     • follow-событий в ленте не больше двух, остальные подписки — молча;
     • 12% переводов уходят человеку: деньги на счёт можно, профиль — нельзя;
     • замок bots_lock на 4 минуты: свежий тик не накладывается на предыдущий;
     • пропущенный из-за простоя тик догоняем: до 24 игровых дней за вызов и
       не дольше ~8 секунд; не влезли — мета запоминает прожитый день, и
       следующий вызов продолжает ровно с него;
     • живой режим (runLive) живёт отдельно и экономику не двигает: раз в 4–5
       секунд 1–2 бота делают действие и пишут до 5 событий в ленту; сделки и
       переводы идут на суммы от сотни тысяч USDT, чтобы лента была живым рынком.
   ============================================================================ */

import { getStore } from '@netlify/blobs';
import { pushEvent, readSocialEdges, writeSocialEdges, socialCounts, applySocialCounts } from './social.js';
import { BOT_NICKS, BOT_BIOS, BOT_AVATARS } from './bot-names.js';
import { BOT_START_USDT, TICK_MS, mulberry32, personaFor, startCapital, stepBot } from './bot-brain.js';
import { runNftActivity } from './nft-market.js';
import { MARKET_PRICES } from './market-coins.js';
import { applyFlows, tickPrices, getPrices, MARKET_TICK_MS } from './market-prices.js';

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

function store() {
  return getStore({ name: 'de', consistency: 'strong' });
}

/* курс тот же, что на клиенте и в social.js — боты живут по этим ценам.
   Старые монеты перечислены явно, новые приходят из единого справочника
   market-coins.js, поэтому тик, прямой эфир и клиент не расходятся. */
const PRICES = Object.assign({
  KNT: 325000,
  BTC: 80000,
  ETH: 3200,
  SOL: 220,
  LTC: 60,
  GRAM: 2.5,
  ZBS: 1.2
}, MARKET_PRICES);

const LOCK_KEY = 'bots_lock';
const META_KEY = 'bots_meta';
const LOCK_MS = 4 * 60 * 1000;          // замок: не чаще одного тика в 4 минуты
const BOT_COUNT = 50;                   // сколько всего ботов
const FEED_LIMIT = 10;                  // событий в ленту за вызов (не за день)
const CATCHUP_MAX_DAYS = 24;            // максимум игровых дней за один вызов
const CATCHUP_BUDGET_MS = 8 * 1000;     // ~8 секунд на догон, потом продолжим
const CATCHUP_MILESTONES_MAX = 120;     // вехи копим с запасом: в ленту войдут 10
const TRANSFER_FEED_MAX = 6;            // из них максимум 6 — про переводы, остальное вехи
const FEED_TYPES = ['transfer_in', 'transfer_out', 'milestone'];
const TRADES_MAX = 60;                  // как у bot-brain и живого режима: история не растёт
const BIO_MAX = 120;                    // как в social.js
const TEXT_MAX = 200;                   // как в pushEvent
const DAY = 24 * 60 * 60 * 1000;
const AVATAR_FALLBACK = { emoji: '🐺', color: '#c0561b' };
const PLAN_MAX = 3;                     // больше трёх переводов от одного бота за тик не надо
const HUMAN_TRANSFER_P = 0.12;          // 12% переводов бота уходят человеку
const HUMAN_TRADES_MAX = 200;           // как в api.js: историю человека не укорачиваем

/* социальная жизнь ботов */
const FOLLOW_MAX = 40;                  // больше 40 подписок бот не держит
const FOLLOW_TICK_CHANCE = 0.10;        // шанс подписки бота за тик
const UNFOLLOW_TICK_CHANCE = 0.01;      // шанс отписки бота за тик
const FOLLOW_FEED_MAX = 2;              // follow-событий в ленте за тик
const SEED_FOLLOW_MIN = 2;              // первичная социализация: 2–4 подписки на бота
const SEED_FOLLOW_MAX = 4;
const SEED_BOT_CHANCE = 0.7;            // 70% целей — боты, 30% — люди
const OWNER_LC = 'knote6037';           // владелец: подписчиков ему задаём отдельно
const OWNER_FOLLOW_MIN = 12;
const OWNER_FOLLOW_MAX = 18;

/* ---------- мелкие помощники ---------- */

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

/* детерминированный seed из строки: один и тот же ник даёт один и тот же
   «случайный» набор подписок, поэтому seedFollows идемпотентен */
function hashSeed(s) {
  const t = String(s === null || s === undefined ? '' : s);
  let h = 2166136261;
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

function lcOfAcc(acc, fallback) {
  if (!acc || typeof acc !== 'object') return normNick(fallback);
  return normNick(acc.nick_lc || acc.nick || acc.legacy_email || acc.email || fallback);
}

/* ник цели — как есть, без приведения к нижнему регистру */
function nickOfAcc(acc, fallback) {
  if (!acc || typeof acc !== 'object') return String(fallback || '');
  return String(acc.nick || acc.nick_lc || acc.legacy_email || acc.email || fallback || '');
}

/* все аккаунты (боты и люди) в стабильном порядке — цели подписок */
function accountTargets(list) {
  const out = [];
  for (const k in list) {
    const a = list[k];
    if (!a || typeof a !== 'object') continue;
    const lc = lcOfAcc(a, k);
    if (!lc) continue;
    out.push({ key: k, acc: a, lc: lc });
  }
  out.sort(function (x, y) { return x.lc < y.lc ? -1 : x.lc > y.lc ? 1 : 0; });
  return out;
}

function findAccByLc(list, want) {
  const lc = normNick(want);
  if (!lc) return null;
  if (list[lc] && typeof list[lc] === 'object') return { key: lc, acc: list[lc] };
  for (const k in list) {
    const a = list[k];
    if (!a || typeof a !== 'object') continue;
    if (lcOfAcc(a, k) === lc) return { key: k, acc: a };
  }
  return null;
}

/* ---------- хранилище ----------
   В отличие от api.js здесь НЕ глотаем ошибку чтения: пустой объект вместо
   accounts означал бы, что следующий writeAll сотрёт вообще всех игроков.
   Поэтому readAll бросает — тик прервётся до записи. */

async function readAll() {
  const v = await store().get('accounts', { type: 'json' });
  if (v === null || v === undefined) return {};                 // хранилище ещё пустое
  if (typeof v !== 'object' || Array.isArray(v)) throw new Error('accounts: неожиданный формат');
  return v;
}

async function writeAll(list) {
  await store().setJSON('accounts', list);
}

async function releaseLock(s) {
  try { await s.delete(LOCK_KEY); return true; }
  catch (e) {
    try { await s.setJSON(LOCK_KEY, 0); return true; } catch (e2) { return false; }
  }
}

/* ---------- состояние счёта бота ---------- */

/* достаём ex так, чтобы потом аккуратно вернуть строкой в state.ex */
function exOf(acc) {
  const st = (acc && acc.state && typeof acc.state === 'object') ? acc.state : {};
  const ex = parseJson(st.ex, null) || {};
  ex.usdt = num(ex.usdt);
  ex.amounts = (ex.amounts && typeof ex.amounts === 'object' && !Array.isArray(ex.amounts)) ? ex.amounts : {};
  ex.trades = Array.isArray(ex.trades) ? ex.trades : [];
  if (!ex.v) ex.v = 3;
  return { st: st, ex: ex };
}

function saveEx(acc, st, ex) {
  acc.state = Object.assign({}, st, { ex: JSON.stringify(ex) });
  return acc;
}

function usdtOf(acc) {
  try { return exOf(acc).ex.usdt; } catch (e) { return 0; }
}

function addTrade(ex, row, maxRows) {
  ex.trades.unshift(row);
  const lim = (maxRows > 0) ? maxRows : TRADES_MAX;
  if (ex.trades.length > lim) ex.trades.length = lim;
}

/* ---------- боты в списке ---------- */

/* только bot === true; порядок по нику — чтобы выбор получателя был
   одинаковым при одном и том же seed (детерминизм тика) */
function botEntries(list) {
  const out = [];
  for (const k of Object.keys(list)) {
    const a = list[k];
    if (!a || typeof a !== 'object' || a.bot !== true) continue;
    out.push({ key: k, acc: a });
  }
  out.sort(function (x, y) {
    const nx = String(x.acc.nick_lc || x.acc.nick || x.key).toLowerCase();
    const ny = String(y.acc.nick_lc || y.acc.nick || y.key).toLowerCase();
    return nx < ny ? -1 : nx > ny ? 1 : 0;
  });
  for (let i = 0; i < out.length; i++) out[i].rank = i;
  return out;
}

/* ---------- план переводов ---------- */

function planAmount(plan) {
  if (typeof plan === 'number') return plan > 0 ? num(plan) : 0;
  if (!plan || typeof plan !== 'object') return 0;
  const keys = ['amount', 'usdt', 'sum', 'value', 'qty'];
  for (let i = 0; i < keys.length; i++) {
    const n = num(plan[keys[i]]);
    if (n > 0) return n;
  }
  return 0;
}

/* получатель: toSeed из плана (так его задаёт bot-brain), иначе явный ник/кошелёк,
   иначе — по seed тика. В списке только боты, поэтому человек получить перевод
   от бота не может. */
function pickRecipient(entries, self, plan, tick) {
  const others = entries.filter(function (e) { return e !== self; });
  if (!others.length) return null;

  if (plan && typeof plan === 'object') {
    /* bot-brain: notes.plan = { toSeed, amount } — получатель выбирается из seed */
    if (plan.toSeed !== undefined && plan.toSeed !== null && isFinite(Number(plan.toSeed))) {
      const n = Math.floor(Math.abs(Number(plan.toSeed)));
      return others[n % others.length];
    }
    const wantRaw = plan.to !== undefined ? plan.to : (plan.nick !== undefined ? plan.nick : plan.toNick);
    const want = normNick(wantRaw);
    if (want) {
      for (let i = 0; i < others.length; i++) {
        const a = others[i].acc;
        if (normNick(a.nick) === want || normNick(a.nick_lc) === want) return others[i];
        if (String(a.wallet) === String(wantRaw).replace(/\D/g, '')) return others[i];
      }
    }
    const idxRaw = (plan.toIndex !== undefined) ? plan.toIndex : (typeof plan.to === 'number' ? plan.to : NaN);
    if (isFinite(Number(idxRaw))) {
      const idx = Number(idxRaw);
      for (let i = 0; i < others.length; i++) {
        if (num(others[i].acc.botIndex) === idx) return others[i];
      }
    }
  }

  const seed = ((Math.abs(Math.floor(tick)) % 2147483647) * 7919 + self.rank * 104729 + 13) >>> 0;
  const r = mulberry32(seed)();
  return others[Math.floor(r * others.length) % others.length];
}

/* люди, которым можно зачислить USDT: не боты, и у них есть кошелёк.
   Личные поля (pass, wallet, bio) не трогаем — только деньги. */
function humanTargets(list) {
  const all = [];
  for (const k of Object.keys(list)) {
    const a = list[k];
    if (!a || typeof a !== 'object' || a.bot === true) continue;
    const lc = lcOfAcc(a, k);
    if (!lc) continue;
    all.push({ key: k, acc: a, lc: lc });
  }
  all.sort(function (x, y) { return x.lc < y.lc ? -1 : x.lc > y.lc ? 1 : 0; });
  const withWallet = all.filter(function (t) {
    const w = String(t.acc.wallet === undefined || t.acc.wallet === null ? '' : t.acc.wallet).trim();
    return !!w;
  });
  return withWallet.length ? withWallet : all;   // ни у кого нет кошелька — берём людей как есть
}

/* получатель-человек: владелец, а если его нет — случайный человек */
function pickHuman(humans, rnd) {
  if (!Array.isArray(humans) || !humans.length) return null;
  for (let i = 0; i < humans.length; i++) {
    if (humans[i].lc === OWNER_LC) return humans[i];
  }
  return humans[Math.floor(rnd() * humans.length) % humans.length];
}

/* кэша на перевод не хватает — продаём монеты, начиная с крупнейшей позиции.
   Возвращает кэш после продаж; монеты уходят по курсу PRICES, в минус ничего
   не уходит, история сделок режется как обычно. */
function raiseCash(ex, need, now) {
  let cash = num(ex.usdt);
  let left = need - cash;
  for (let pass = 0; pass < 4 && left > 0; pass++) {
    let best = null;
    let bestVal = 0;
    for (const sym in ex.amounts) {
      const p = num(PRICES[sym]);
      const q = num(ex.amounts[sym]);
      const v = q * p;
      if (p > 0 && q > 0 && v > bestVal) { best = sym; bestVal = v; }
    }
    if (!best) break;
    const p = num(PRICES[best]);
    const take = Math.min(bestVal, left);
    const q = roundQty(take / p);
    if (!(q > 0)) break;
    const got = round2(q * p);
    if (!(got > 0)) break;
    const rest = num(ex.amounts[best]) - q;
    if (rest > 0) ex.amounts[best] = roundQty(rest);
    else delete ex.amounts[best];
    cash = round2(cash + got);
    left -= got;
    addTrade(ex, { t: now, side: 'SELL', sym: best, qty: q, price: p, total: got });
  }
  return cash;
}

/* сам перевод: хватает денег — списали/начислили и записали сделку,
   не хватает — false (план отменяется, ничего не трогаем).
   Кэша мало — бот продаёт монеты: перевод это доля капитала, а не только
   свободного USDT.
   toHuman — получатель человек: его историю режем по 200 строк, как api.js,
   а не по 60, иначе боты стирали бы людям старые строки. */
function transferUsdt(from, to, amount, now, toHuman) {
  if (!from || !to || from === to) return false;
  if (!(amount > 0)) return false;

  const f = exOf(from);
  let cash = num(f.ex.usdt);
  if (!(cash >= amount)) cash = raiseCash(f.ex, amount, now);
  if (!(cash >= amount)) return false;
  f.ex.usdt = round2(cash - amount);
  addTrade(f.ex, { t: now, side: 'SEND', sym: 'USDT', qty: amount, total: amount, to: String(to.nick || '') });
  saveEx(from, f.st, f.ex);

  const t = exOf(to);
  t.ex.usdt = round2(t.ex.usdt + amount);
  addTrade(t.ex, { t: now, side: 'RECV', sym: 'USDT', qty: amount, total: amount, from: String(from.nick || '') },
    toHuman ? HUMAN_TRADES_MAX : TRADES_MAX);
  saveEx(to, t.st, t.ex);
  return true;
}

/* ---------- события ---------- */

function botEvent(nick, ev) {
  if (!ev) return null;
  if (typeof ev === 'string') {
    const t = cut(ev, TEXT_MAX);
    return t ? { nick: nick, type: 'milestone', text: t, extra: null } : null;
  }
  if (typeof ev !== 'object') return null;

  /* bot-brain кладёт вид события в kind: trade / jump / dump / broke / profile /
     nft / transfer_plan. В ленте допустимы только transfer_in / transfer_out /
     milestone, поэтому всё живое превращаем в веху, а заявку на перевод
     пропускаем — настоящий перевод оформляет сам тик. */
  const kind = String(ev.kind || ev.type || 'milestone');
  if (kind === 'transfer_plan') return null;

  const text = cut(ev.text !== undefined ? ev.text : (ev.msg !== undefined ? ev.msg : ev.message), TEXT_MAX);
  if (!text) return null;

  if (FEED_TYPES.indexOf(kind) >= 0 && kind !== 'milestone') {
    return { nick: nick, type: kind, text: text, extra: (ev.extra && typeof ev.extra === 'object') ? ev.extra : null };
  }

  const extra = {};
  if (isFinite(Number(ev.pnl))) extra.money = Number(ev.pnl);
  if (ev.sym) extra.sym = String(ev.sym);
  return {
    nick: nick,
    type: 'milestone',
    text: text,
    extra: Object.keys(extra).length ? extra : ((ev.extra && typeof ev.extra === 'object') ? ev.extra : null)
  };
}

/* ---------- заплатка профиля из плана ---------- */

function applyPatch(acc, patch) {
  if (!patch || typeof patch !== 'object') return false;
  let touched = false;

  if (typeof patch.bio === 'string') {
    acc.bio = cut(patch.bio, BIO_MAX);
    touched = true;
  }

  const av = patch.avatar;
  if (av && typeof av === 'object') {
    const cur = (acc.avatar && typeof acc.avatar === 'object') ? acc.avatar : AVATAR_FALLBACK;
    const emoji = (typeof av.emoji === 'string' && av.emoji.trim()) ? cut(av.emoji, 8) : '';
    const colorRaw = String(av.color || '').trim();
    const color = /^#[0-9a-f]{6}$/i.test(colorRaw) ? colorRaw : '';
    acc.avatar = {
      emoji: emoji || cur.emoji || AVATAR_FALLBACK.emoji,
      color: color || cur.color || AVATAR_FALLBACK.color
    };
    touched = true;
  }

  return touched;
}

/* ---------- социальная жизнь за тик ----------
   До 10% активных ботов подписываются на случайного игрока, 1% — отписываются.
   edges читаем и пишем ровно один раз; счётчики пересчитываем по итоговым
   edges и проставляем ВСЕМ аккаунтам, включая людей: у них должны расти
   подписчики. Follow-события в ленту ограничены двумя за тик. */

async function socialLife(list, worked, tick, atMs, addFeed) {
  let edges = null;
  try { edges = await readSocialEdges(); }
  catch (e) { edges = null; }
  if (!edges || typeof edges !== 'object' || Array.isArray(edges)) edges = {};

  const targets = accountTargets(list);
  const counts = socialCounts(edges);
  let followed = 0;
  let unfollowed = 0;
  let feedFollows = 0;

  for (let i = 0; i < worked.length; i++) {
    const me = worked[i].acc;
    const from = lcOfAcc(me, worked[i].key);
    if (!from) continue;

    /* свой поток случайности на бота и тик — тик воспроизводим */
    const rnd = mulberry32(hashSeed('social|' + tick + '|' + from));

    if (rnd() < FOLLOW_TICK_CHANCE && (counts.following[from] || 0) < FOLLOW_MAX) {
      const pool = [];
      for (let j = 0; j < targets.length; j++) {
        const t = targets[j];
        if (!t.lc || t.lc === from) continue;
        if (edges[from + '>' + t.lc]) continue;      // уже читает — не дублируем
        pool.push(t);
      }
      if (pool.length) {
        const to = pool[Math.floor(rnd() * pool.length) % pool.length];
        edges[from + '>' + to.lc] = atMs;
        counts.following[from] = (counts.following[from] || 0) + 1;
        counts.followers[to.lc] = (counts.followers[to.lc] || 0) + 1;
        followed++;

        /* в ленту — максимум 2 подписки, остальные молча */
        if (feedFollows < FOLLOW_FEED_MAX) {
          feedFollows++;
          addFeed({
            nick: nickOfAcc(me, from),
            type: 'follow',
            text: 'подписался на @' + nickOfAcc(to.acc, to.lc),
            extra: null
          });
        }
      }
    }

    if (rnd() < UNFOLLOW_TICK_CHANCE) {
      const prefix = from + '>';
      const mine = [];
      for (const key in edges) {
        if (key.indexOf(prefix) === 0) mine.push(key);
      }
      if (mine.length) {
        const drop = mine[Math.floor(rnd() * mine.length) % mine.length];
        const toLc = drop.slice(prefix.length);
        delete edges[drop];
        counts.following[from] = Math.max(0, (counts.following[from] || 0) - 1);
        counts.followers[toLc] = Math.max(0, (counts.followers[toLc] || 0) - 1);
        unfollowed++;
      }
    }
  }

  /* одна запись edges за тик */
  let ok = true;
  try { await writeSocialEdges(edges); }
  catch (e) { ok = false; }

  /* счётчики — только по тому, что реально записалось */
  if (ok) {
    const finalCounts = socialCounts(edges);
    for (let i = 0; i < targets.length; i++) {
      applySocialCounts(targets[i].acc, targets[i].lc, finalCounts);
    }
  }

  return { ok: ok, followed: followed, unfollowed: unfollowed, edges: Object.keys(edges).length };
}

/* ============================================================================
   РЫНОК: сделки ботов двигают цену (market-prices.js)

   Раньше боты торговали по фиксированному PRICES с шумом на клиенте. Теперь
   цена живая: сделки шага собираются в нетто-поток по символу в USDT
   (покупки минус продажи) и applyFlows двигает цену на поток/ликвидность.
   Источник — ex.trades: bot-brain кладёт туда { t, side, sym, qty, price,
   total, pnl }, где total — сумма сделки в USDT, а t — время шага. Берём
   только записи этого шага: история хранит 60 строк, поток окна — ровно новые.
   ============================================================================ */

/* нетто-поток одного счёта за шаг: { SYM: ±USDT } */
function flowsOfTrades(acc, atMs) {
  const out = {};
  let ex = null;
  try { ex = exOf(acc).ex; } catch (e) { return out; }
  const rows = Array.isArray(ex.trades) ? ex.trades : [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r || typeof r !== 'object') continue;
    if (num(r.t) !== atMs) continue;                  // только сделки этого шага
    const sym = String(r.sym || '').toUpperCase();
    if (!sym) continue;
    const total = num(r.total);
    if (!(total > 0)) continue;
    const side = String(r.side || '').toUpperCase();
    const sign = side === 'SELL' ? -1 : (side === 'BUY' ? 1 : 0);
    if (!sign) continue;
    out[sym] = (out[sym] || 0) + sign * total;
  }
  return out;
}

/* суммируем потоки нескольких ботов в один объект */
function mergeFlows(dst, src) {
  const out = dst || {};
  const from = src || {};
  for (const sym in from) {
    const v = num(from[sym]);
    if (!v) continue;
    out[sym] = (out[sym] || 0) + v;
  }
  return out;
}

function hasFlow(flows) {
  for (const sym in (flows || {})) {
    if (num(flows[sym]) !== 0) return true;
  }
  return false;
}

/* минутный шум: не чаще раза в MARKET_TICK_MS. Метка живёт и в модуле, и в
   самой записи рынка (tt), поэтому ни эфир каждые 4 секунды, ни второй
   инстанс функции не зашумят цену дважды за минуту. */
let marketTickAt = 0;

async function marketTick(now) {
  if (now - marketTickAt < MARKET_TICK_MS) return null;
  try {
    const r = await tickPrices(now);
    marketTickAt = now;
    return r && !r.skipped ? r : null;
  } catch (e) {
    return null;
  }
}

/* один шаг рынка: потоки сделок (мгновенная реакция) + минутный шум.
   Возвращает компактный отчёт для ответа; сбой рынка тик не роняет. */
async function marketStep(flows, atMs) {
  const rep = { flows: 0, moved: 0, tick: 0 };

  if (hasFlow(flows)) {
    try {
      const r = await applyFlows(flows, atMs);
      rep.flows = 1;
      rep.moved = Array.isArray(r.moved) ? r.moved.length : 0;
      rep.top = Array.isArray(r.moved) ? r.moved.slice(0, 3) : [];
    } catch (e) { /* рынок не должен валить шаг */ }
  }

  const t = await marketTick(atMs);
  if (t) rep.tick = 1;
  return rep;
}

/* ---------- ОДИН ТИК ----------
   now  — время тика (мс), opts.force — обойти замок и проверку «этот тик уже был»
   (только для ручного запуска админом; крон ходит без force). */

export async function runTick(now, opts) {
  const at = Number(now);
  const atMs = (isFinite(at) && at > 0) ? at : Date.now();
  const force = !!(opts && opts.force);
  const s = store();
  const tick = Math.floor(atMs / TICK_MS);

  /* 1. замок: свежий тик поверх вчерашнего не запускаем */
  let lock = 0;
  try { lock = num(await s.get(LOCK_KEY, { type: 'json' })); } catch (e) { lock = 0; }
  if (!force && lock > 0 && Math.abs(atMs - lock) < LOCK_MS) {
    return { ok: true, skipped: 'lock', tick: tick, at: atMs };
  }

  /* 7/8. метрики прошлого запуска: тот же 20-минутный слот не крутим дважды.
     После простоя считаем, сколько игровых дней пропущено: один тик = один
     день, поэтому разница номеров слотов и есть число дней. Опираемся и на
     tick, и на lastRun — если одно поле в мете потерялось, второе выручит. */
  let prevMeta = null;
  try { prevMeta = await s.get(META_KEY, { type: 'json' }); } catch (e) { prevMeta = null; }
  if (!prevMeta || typeof prevMeta !== 'object' || Array.isArray(prevMeta)) prevMeta = null;

  /* замок снят, но прошлый тик был только что: меньше 4 минут — не частим */
  if (!force && prevMeta && num(prevMeta.lastRun) > 0 && Math.abs(atMs - num(prevMeta.lastRun)) < LOCK_MS) {
    return { ok: true, skipped: 'lock', tick: tick, at: atMs };
  }

  /* тот же 20-минутный слот не крутим дважды */
  if (!force && prevMeta && num(prevMeta.tick) === tick) {
    return { ok: true, skipped: 'tick', tick: tick, at: atMs };
  }

  /* последний прожитый день и сколько дней пропущено. prevTick — номер слота
     последнего дня, tick — номер текущего. Минимум 1 день: обычный тик после
     короткой паузы работает ровно как раньше. */
  const prevLast = (prevMeta && num(prevMeta.lastRun) > 0) ? num(prevMeta.lastRun) : 0;
  let prevTick = (prevMeta && num(prevMeta.tick) > 0) ? Math.floor(num(prevMeta.tick)) : 0;
  if (!(prevTick > 0) && prevLast > 0) prevTick = Math.floor(prevLast / TICK_MS);
  if (!(prevTick > 0)) prevTick = tick - 1;
  if (prevTick > tick) prevTick = tick - 1;                 // часы ушли назад — не крутим назад
  const behindTicks = Math.max(1, tick - prevTick);         // сколько дней пропущено
  const gap = prevLast > 0 ? behindTicks : 0;

  try { await s.setJSON(LOCK_KEY, atMs); }
  catch (e) { return { ok: false, err: 'lock', msg: errText(e), at: atMs }; }

  let list;
  try { list = await readAll(); }
  catch (e) {
    await releaseLock(s);
    return { ok: false, err: 'read', msg: errText(e), at: atMs, tick: tick };
  }

  /* 2. только боты; людей не трогаем вообще */
  const bots = botEntries(list);
  if (!bots.length) {
    await releaseLock(s);
    return { ok: true, skipped: 'nobots', tick: tick, at: atMs };
  }

  const feed = [];
  const milestones = [];
  const seen = new Set();
  function addFeed(ev) {
    if (!ev) return;
    const key = ev.nick + '|' + ev.type + '|' + ev.text;
    if (seen.has(key)) return;                  // повторный тик не плодит копии
    seen.add(key);
    if (feed.length < FEED_LIMIT) feed.push(ev);
  }

  /* 3. догон. Обычный тик — один день; после простоя проживаем до 24 дней.
     Каждый день: stepBot по всем ботам со своим tick (от него зависит случай),
     затем переводы и патчи. accounts внутри цикла НЕ пишем — одна общая запись
     в конце, поэтому 24 дня стоят одного обращения к Blobs. Курс для шагов —
     живой (рынок есть — берём его цены, иначе статику PRICES): бот считает
     портфель по рынку. Сбой рынка шаг не ломает. */
  let stepPrices = PRICES;
  try {
    const live = await getPrices();
    if (live && live.prices && typeof live.prices === 'object') stepPrices = live.prices;
  } catch (e) {
    stepPrices = PRICES;
  }

  const baseAt = prevLast > 0 ? prevLast : prevTick * TICK_MS;
  const daysPlanned = Math.min(CATCHUP_MAX_DAYS, behindTicks);
  const budgetEnd = Date.now() + CATCHUP_BUDGET_MS;

  const state = new Map();                  // ключ бота → текущий счёт (копится по дням)
  const stepped = new Set();
  for (let i = 0; i < bots.length; i++) state.set(bots[i].key, bots[i].acc);

  const applied = [];
  const canceled = [];
  let failed = 0;
  let transferFeed = 0;
  let daysDone = 0;
  let lastDayAt = atMs;
  let lastDayTick = prevTick;
  let lastWorked = [];

  const humans = humanTargets(list);        // люди не меняются — цели считаем один раз

  for (let d = 1; d <= daysPlanned; d++) {
    /* бюджет ~8 секунд: минимум один день делаем всегда, остальные — пока
       влезаем. Не влезли — мета запишет прожитый день, следующий вызов
       продолжит ровно с него. */
    if (d > 1 && Date.now() > budgetEnd) break;

    const dayTick = prevTick + d;
    /* день идёт ровно на TICK_MS вперёд от прошлого lastRun; последний
       пропущенный день прижимаем к now, чтобы обычный тик вёл себя как раньше */
    let dayAt = baseAt + d * TICK_MS;
    if (d === behindTicks || dayAt > atMs) dayAt = atMs;

    const dayWorked = [];
    for (let i = 0; i < bots.length; i++) {
      const b = bots[i];
      const acc = state.get(b.key) || b.acc;
      const persona = (acc.persona && typeof acc.persona === 'object') ? acc.persona : personaFor(b.rank);
      let res = null;
      try {
        res = stepBot(acc, persona, { now: dayAt, prices: Object.assign({}, stepPrices), tick: dayTick });
      } catch (e) {
        failed++;                             // один упавший бот не роняет день
        continue;
      }

      const next = Object.assign({}, acc, (res && res.acc && typeof res.acc === 'object') ? res.acc : {});
      /* личность не даём затереть: это ключи, ник и вход */
      next.nick = acc.nick;
      next.nick_lc = acc.nick_lc;
      next.wallet = acc.wallet;
      next.pass = acc.pass;
      next.bot = true;
      next.persona = (next.persona && typeof next.persona === 'object') ? next.persona : persona;

      const events = (res && Array.isArray(res.events)) ? res.events : [];
      for (let j = 0; j < events.length; j++) {
        if (milestones.length >= CATCHUP_MILESTONES_MAX) break;
        const ev = botEvent(next.nick, events[j]);
        if (ev) milestones.push(ev);          // в ленту — после переводов
      }

      const item = {
        key: b.key,
        acc: next,
        rank: b.rank,
        notes: (res && res.notes && typeof res.notes === 'object') ? res.notes : null
      };
      dayWorked.push(item);
      state.set(b.key, next);
      stepped.add(b.key);
    }

    /* 4. переводы этого дня: те же правила, что у одиночного тика */
    const humanRnd = mulberry32(hashSeed('human|' + dayTick));
    for (let i = 0; i < dayWorked.length; i++) {
      const it = dayWorked[i];
      const plan = it.notes ? it.notes.plan : null;
      if (!plan) continue;
      const plans = Array.isArray(plan) ? plan.slice(0, PLAN_MAX) : [plan];

      for (let j = 0; j < plans.length; j++) {
        const p = plans[j];
        const amount = round2(planAmount(p));
        if (!(amount > 0)) {
          canceled.push({ from: it.acc.nick, why: 'bad_amount' });
          continue;
        }

        /* 12% переводов идут человеку: деньги на счёт, профиль не трогаем.
           Владельцу — если он есть в списке, иначе случайному человеку. */
        let human = null;
        if (humans.length && humanRnd() < HUMAN_TRANSFER_P) human = pickHuman(humans, humanRnd);
        const to = human || pickRecipient(dayWorked, it, p, dayTick);
        if (!to) {
          canceled.push({ from: it.acc.nick, amount: amount, why: 'no_target' });
          continue;
        }
        const toNick = String(to.acc.nick || to.key || '');
        if (!transferUsdt(it.acc, to.acc, amount, dayAt, !!human)) {
          canceled.push({ from: it.acc.nick, to: toNick, amount: amount, why: 'refused' });
          continue;
        }
        applied.push({ from: it.acc.nick, to: toNick, amount: amount, human: !!human });
        /* в ленту — максимум 6 событий про переводы за ВЕСЬ вызов */
        if (transferFeed < TRANSFER_FEED_MAX) {
          transferFeed += 2;
          addFeed({
            nick: it.acc.nick,
            type: 'transfer_out',
            text: 'отправил ' + fmtMoney(amount) + ' USDT → @' + toNick,
            extra: { money: amount, sym: 'USDT' }
          });
          addFeed({
            nick: toNick,
            type: 'transfer_in',
            text: 'получил ' + fmtMoney(amount) + ' USDT от @' + it.acc.nick,
            extra: { money: amount, sym: 'USDT' }
          });
        }
      }
    }

    /* 5. заплатки профиля и метки времени — в памяти, без записи accounts */
    for (let i = 0; i < dayWorked.length; i++) {
      const it = dayWorked[i];
      if (it.notes && it.notes.patch) applyPatch(it.acc, it.notes.patch);
      it.acc.updated = dayAt;
      it.acc.last_seen = dayAt;
    }

    daysDone = d;
    lastDayAt = dayAt;
    lastDayTick = dayTick;
    lastWorked = dayWorked;
  }

  /* итоги догона переносим в общий список — ровно один write ниже */
  const worked = [];
  for (let i = 0; i < bots.length; i++) {
    const b = bots[i];
    if (!stepped.has(b.key)) continue;
    const acc = state.get(b.key);
    if (!acc) continue;
    list[b.key] = acc;
    worked.push({ key: b.key, acc: acc, rank: b.rank, notes: null });
  }

  /* 5b. рынок: потоки сделок последнего прожитого дня двигают цены.
     Спали все (потоков нет) — всё равно крутим шум, иначе рынок замирает
     между тиками; при большом разрыве tickPrices сам догонит рынок шагами.
     Сбой рынка тик не роняет. */
  let market = null;
  try {
    const flows = {};
    for (let i = 0; i < lastWorked.length; i++) mergeFlows(flows, flowsOfTrades(lastWorked[i].acc, lastDayAt));
    market = await marketStep(flows, atMs);
  } catch (e) { market = null; }

  /* 6. соцжизнь: edges — один read и один write за тик, счётчики по итогам */
  if (worked.length) {
    try { await socialLife(list, worked, tick, atMs, addFeed); }
    catch (e) { /* соцжизнь не должна ронять тик */ }
  }

  /* остаток ленты — вехи ботов. Начинаем с разного места, иначе в ленту
     всегда попадали бы одни и те же первые по алфавиту боты. */
  if (milestones.length) {
    const start = Math.abs(Math.floor(tick)) % milestones.length;
    for (let i = 0; i < milestones.length; i++) addFeed(milestones[(start + i) % milestones.length]);
  }

  /* 7. одна запись accounts; люди лежат в том же объекте нетронутыми */
  if (worked.length) {
    try { await writeAll(list); }
    catch (e) {
      await releaseLock(s);
      return { ok: false, err: 'write', msg: errText(e), at: atMs, tick: tick, ran: worked.length };
    }
  }

  /* 8. лента — не больше 10 событий за тик */
  let sent = 0;
  for (let i = 0; i < feed.length && i < FEED_LIMIT; i++) {
    try {
      if (await pushEvent(feed[i].nick, feed[i].type, feed[i].text, feed[i].extra || undefined)) sent++;
    } catch (e) { /* лента не должна мешать тику */ }
  }

  /* метрики и снятие замка: считаем по всем ботам (упавший тоже в счёте) */
  let totalUsdt = 0;
  let maxNick = null;
  let maxUsdt = 0;
  for (let i = 0; i < bots.length; i++) {
    const a = list[bots[i].key] || bots[i].acc;
    const u = usdtOf(a);
    totalUsdt += u;
    if (maxNick === null || u > maxUsdt) { maxNick = a.nick; maxUsdt = u; }
  }

  const daysBehind = Math.max(0, behindTicks - daysDone);
  const meta = {
    tick: lastDayTick,
    lastRun: lastDayAt,
    count: bots.length,
    totalUsdt: round2(totalUsdt),
    maxNick: maxNick,
    maxUsdt: round2(maxUsdt),
    ran: worked.length,
    caughtUp: daysDone,
    daysBehind: daysBehind
  };
  let metaOk = true;
  /* чужие поля меты (liveAt от runLive) не затираем */
  try { await s.setJSON(META_KEY, Object.assign({}, prevMeta || {}, meta)); }
  catch (e) { metaOk = false; }
  await releaseLock(s);

  /* NFT-жизнь: несколько ботов вскрывают кейсы и выставляют лоты.
     У runNftActivity свои чтение/запись, поэтому вызываем уже после тика. */
  let nft = null;
  try { nft = await runNftActivity(atMs); }
  catch (e) { nft = { ok: false, err: errText(e) }; }

  return {
    ok: true,
    tick: tick,
    at: atMs,
    ran: worked.length,
    count: bots.length,
    totalUsdt: meta.totalUsdt,
    transfers: applied.length,
    canceled: canceled.length,
    events: sent,
    failed: failed,
    gap: gap > 0 ? gap : 0,
    caughtUp: daysDone,
    daysBehind: daysBehind,
    nft: nft,
    market: market,
    metaOk: metaOk
  };
}

/* ---------- ПЕРВИЧНАЯ СОЦИАЛИЗАЦИЯ ----------
   Один прогон после seedBots: у ботов появляются подписки, у людей —
   подписчики. Всё детерминировано от ника бота, поэтому повторный вызов
   не плодит новые рёбра: набор целей выбирается заново тот же, а ключи
   from>to, которые уже есть, просто пропускаются. */

export async function seedFollows() {
  let list;
  try { list = await readAll(); }
  catch (e) { return { ok: false, err: 'read', msg: errText(e) }; }

  let edges;
  try { edges = await readSocialEdges(); }
  catch (e) { return { ok: false, err: 'edges', msg: errText(e) }; }
  if (!edges || typeof edges !== 'object' || Array.isArray(edges)) edges = {};

  const all = accountTargets(list);
  const bots = all.filter(function (t) { return t.acc.bot === true; });
  if (!bots.length) return { ok: true, edges: Object.keys(edges).length, newFollows: 0 };

  const owner = findAccByLc(list, OWNER_LC);
  const ownerLc = owner ? lcOfAcc(owner.acc, owner.key) : '';

  /* Случайные цели — боты и люди. Владельца в общий поток не берём: его
     12–18 подписчиков задаются отдельным шагом, иначе при единственном
     живом человеке на него подписались бы все 50 ботов. */
  const botPool = bots;
  const humanPool = all.filter(function (t) {
    if (t.acc.bot === true) return false;
    if (ownerLc && t.lc === ownerLc) return false;
    return true;
  });

  const now = Date.now();
  let newFollows = 0;

  function addEdge(fromLc, toLc) {
    if (!fromLc || !toLc || fromLc === toLc) return false;
    const key = fromLc + '>' + toLc;
    if (edges[key]) return false;
    edges[key] = now;
    newFollows++;
    return true;
  }

  /* 1. каждый бот — 2–4 подписки, 70% на бота, 30% на человека.
        Цели выбираем в отдельный список ДО проверки edges: иначе повторный
        вызов, увидев занятые рёбра, выбрал бы следующие цели и добавил их. */
  for (let bi = 0; bi < bots.length; bi++) {
    const from = bots[bi].lc;
    if (!from) continue;
    const rnd = mulberry32(hashSeed('seed-follows|' + from));
    const want = SEED_FOLLOW_MIN + Math.floor(rnd() * (SEED_FOLLOW_MAX - SEED_FOLLOW_MIN + 1));
    const picked = Object.create(null);
    const selected = [];
    const triesMax = want * 12 + 12;

    for (let tries = 0; tries < triesMax && selected.length < want; tries++) {
      const onBot = rnd() < SEED_BOT_CHANCE;
      let pool = onBot ? botPool : humanPool;
      if (!pool.length) pool = onBot ? humanPool : botPool;
      if (!pool.length) break;

      const to = pool[Math.floor(rnd() * pool.length) % pool.length];
      if (!to || !to.lc || to.lc === from) continue;
      if (picked[to.lc]) continue;             // 2–4 разных цели, без дублей
      picked[to.lc] = true;
      selected.push(to.lc);
    }

    for (let i = 0; i < selected.length; i++) addEdge(from, selected[i]);
  }

  /* 2. 12–18 ботов — на владельца. Порядок стабилен: хеш от ника бота. */
  if (ownerLc) {
    const rndOwner = mulberry32(hashSeed('seed-follows|owner|' + ownerLc));
    const ownerWant = OWNER_FOLLOW_MIN +
      Math.floor(rndOwner() * (OWNER_FOLLOW_MAX - OWNER_FOLLOW_MIN + 1));
    const ranked = bots.filter(function (t) { return t.lc && t.lc !== ownerLc; })
      .map(function (t) {
        return { t: t, r: mulberry32(hashSeed('owner-pick|' + t.lc))() };
      })
      .sort(function (x, y) {
        if (x.r !== y.r) return x.r - y.r;
        return x.t.lc < y.t.lc ? -1 : x.t.lc > y.t.lc ? 1 : 0;
      });
    const take = Math.min(ownerWant, ranked.length);
    for (let i = 0; i < take; i++) addEdge(ranked[i].t.lc, ownerLc);
  }

  /* 3. edges — один раз */
  try { await writeSocialEdges(edges); }
  catch (e) { return { ok: false, err: 'edges_write', msg: errText(e), newFollows: newFollows }; }

  /* 4. счётчики строго по edges — всем аккаунтам, включая людей */
  const counts = socialCounts(edges);
  for (let i = 0; i < all.length; i++) applySocialCounts(all[i].acc, all[i].lc, counts);

  /* 5. accounts — один раз */
  try { await writeAll(list); }
  catch (e) { return { ok: false, err: 'write', msg: errText(e), newFollows: newFollows }; }

  return { ok: true, edges: Object.keys(edges).length, newFollows: newFollows };
}

/* ============================================================================
   ВИТРИНА БОТОВ: дом, ювелирка на себе, номера на стендах.

   Поле аккаунта — acc.show = { home, wear: [], stands: [], t } (формат тот же,
   что у POST /api/showcase в api.js). Владение не проверяем: по легенде боты
   всё это уже купили, а ext.assets с настоящими лотами живёт у людей.
   Выбор детерминирован от ника: mulberry32(hashSeed('show|' + ник)) — у одного
   и того же бота витрина не меняется от тика к тику, но у разных ботов разная.
   Доли подобраны под живую ленту: ~70% ботов носят украшение, ~40% держат
   номера на стендах. Номера — 8-значные строки, первая цифра не ноль.
   ============================================================================ */

/* дома: id — как в клиентском ASSET_ITEMS, ru — короткое имя для ленты */
const BOT_HOMES = [
  { id: 'flat', ru: 'Квартира в центре Москвы' },
  { id: 'studio_msk', ru: 'Студия в Москве' },
  { id: 'flat_spb', ru: 'Квартира в Петербурге' },
  { id: 'flat_sochi', ru: 'Квартира в Сочи' },
  { id: 'flat_dubai', ru: 'Квартира в Дубае' },
  { id: 'flat_ny', ru: 'Квартира в Нью-Йорке' },
  { id: 'flat_tokyo', ru: 'Квартира в Токио' },
  { id: 'townhouse', ru: 'Таунхаус в Лондоне' },
  { id: 'house_msk', ru: 'Дом в Подмосковье' },
  { id: 'house_la', ru: 'Дом в Лос-Анджелесе' },
  { id: 'house_amsterdam', ru: 'Дом в Амстердаме' },
  { id: 'chalet', ru: 'Шале в Альпах' },
  { id: 'mansion', ru: 'Английское поместье' },
  { id: 'maldives', ru: 'Вилла на Мальдивах' },
  { id: 'villa', ru: 'Вилла на Лазурном берегу' },
  { id: 'villa_miami', ru: 'Вилла в Майами' },
  { id: 'villa_tuscany', ru: 'Вилла в Тоскане' },
  { id: 'villa_ibiza', ru: 'Вилла на Ибице' },
  { id: 'penthouse', ru: 'Пентхаус «Москва-Сити»' },
  { id: 'penthouse_dubai', ru: 'Пентхаус в Дубае' },
  { id: 'penthouse_ny', ru: 'Пентхаус в Нью-Йорке' },
  { id: 'castle', ru: 'Замок в Баварии' },
  { id: 'castle_loire', ru: 'Замок в Луаре' }
];

/* украшения: те же id, что у клиентских предметов категории wear */
const BOT_WEAR = [
  'rolex', 'ap', 'watch', 'richard', 'daytona_rainbow', 'nautilus_dia',
  'royaloak_iced', 'rm_dia', 'daydate_dia', 'hublot_dia', 'ap_offshore_dia',
  'iced_square_rose', 'iced_set_blue', 'iced_set_emerald', 'chain_cuban',
  'chain_tennis', 'chain_snake', 'cross_dia', 'pendant_skull',
  'bracelet_tennis_white', 'diamondstone', 'gold'
];

/* доли витрины: сколько ботов с украшением и с номерами */
const SHOW_WEAR_P = 0.70;
const SHOW_WEAR_TWO_P = 0.65;      // из тех, у кого есть украшение: 65% — одно
const SHOW_STANDS_P = 0.40;
const SHOW_STANDS_TWO_P = 0.70;    // 1 номер, иначе 2–3

/* название дома для ленты: id → «Пентхаус в Дубае» */
function homeName(id) {
  const key = String(id === null || id === undefined ? '' : id);
  if (!key) return '';
  for (let i = 0; i < BOT_HOMES.length; i++) {
    if (BOT_HOMES[i].id === key) return BOT_HOMES[i].ru;
  }
  return '';
}

/* 8-значный номер, первая цифра не ноль: 47382910 */
function randomNumber(rnd) {
  let s = String(1 + Math.floor(rnd() * 9));
  while (s.length < 8) s += String(Math.floor(rnd() * 10));
  return s;
}

/* n разных элементов массива — без повторов (два одинаковых перстня на себе
   выглядели бы странно) */
function pickDistinct(arr, n, rnd) {
  const pool = Array.isArray(arr) ? arr.slice() : [];
  const out = [];
  let want = Math.floor(num(n));
  if (want > pool.length) want = pool.length;
  for (let i = 0; i < want; i++) {
    const j = Math.floor(rnd() * pool.length) % pool.length;
    out.push(pool[j]);
    pool.splice(j, 1);
  }
  return out;
}

/* витрина бота: детерминирована от ника, поэтому не «прыгает» между тиками */
function showFor(nick, at) {
  const rnd = mulberry32(hashSeed('show|' + normNick(nick)));

  const home = BOT_HOMES[Math.floor(rnd() * BOT_HOMES.length) % BOT_HOMES.length].id;

  /* украшения: 70% ботов хотя бы с одним, из них 65% — с одним */
  let wear = [];
  if (rnd() < SHOW_WEAR_P) {
    const cnt = rnd() < SHOW_WEAR_TWO_P ? 1 : 2;
    wear = pickDistinct(BOT_WEAR, cnt, rnd);
  }

  /* номера: 40% ботов, из них 70% — с одним */
  let stands = [];
  if (rnd() < SHOW_STANDS_P) {
    const cnt = rnd() < SHOW_STANDS_TWO_P ? 1 : (rnd() < 0.60 ? 2 : 3);
    const used = new Set();
    for (let i = 0; i < cnt; i++) {
      let numStr = randomNumber(rnd);
      for (let k = 0; k < 4 && used.has(numStr); k++) numStr = randomNumber(rnd);
      if (used.has(numStr)) continue;
      used.add(numStr);
      stands.push(numStr);
    }
  }

  return { home: home, wear: wear, stands: stands, t: num(at) };
}

/* аватар бота по его индексу: (index*7+3) % BOT_AVATARS.length.
   7 и 24 взаимно просты, поэтому по 50 ботам эмодзи идут вперемешку, а не
   «всем 🐺». 🐺 — служебная заглушка (AVATAR_FALLBACK): если формула попала
   в неё, берём соседнюю, чтобы заглушку нельзя было спутать с живым аватаром. */
function botAvatarAt(index) {
  const n = (Array.isArray(BOT_AVATARS) && BOT_AVATARS.length) ? BOT_AVATARS.length : 0;
  if (!n) return { emoji: AVATAR_FALLBACK.emoji, color: AVATAR_FALLBACK.color };
  const i = Math.abs(Math.floor(num(index)));
  let pick = BOT_AVATARS[(i * 7 + 3) % n];
  if (!pick || !pick.emoji || pick.emoji === AVATAR_FALLBACK.emoji) {
    pick = BOT_AVATARS[(i * 7 + 4) % n];
  }
  const emoji = pick && pick.emoji ? (cut(pick.emoji, 8) || AVATAR_FALLBACK.emoji) : AVATAR_FALLBACK.emoji;
  const color = (pick && /^#[0-9a-f]{6}$/i.test(String(pick.color || '')))
    ? String(pick.color) : AVATAR_FALLBACK.color;
  return { emoji: emoji, color: color };
}

/* индекс бота для выбора аватара: botIndex, а если его нет — стабильный хеш */
function botIndexFor(acc, nick) {
  const idx = num(acc && acc.botIndex);
  if (isFinite(idx) && idx >= 0 && idx < 1e6) return Math.floor(idx);
  return hashSeed(normNick(nick)) % 997;
}

/* ============================================================================
   РАЗОВАЯ ПОЧИНКА УЖЕ СОЗДАННЫХ БОТОВ (экспорт, ручку в api.js не заводим).

   У кого нет show.home или стоит дефолтный 🐺 — выдаём витрину и нормальный
   аватар по той же логике, что в seedBots. Идемпотентна: второй прогон не
   находит ни одного «пустого» бота и ничего не пишет.
   ============================================================================ */

export async function decorateBots() {
  let list;
  try { list = await readAll(); }
  catch (e) { return { ok: false, err: 'read', msg: errText(e) }; }

  const at = Date.now();
  const keys = Object.keys(list);
  const nicks = [];
  let bots = 0;

  for (let k = 0; k < keys.length; k++) {
    const key = keys[k];
    const acc = list[key];
    if (!acc || typeof acc !== 'object' || acc.bot !== true) continue;
    bots++;

    const nick = nickOfAcc(acc, key);
    let touched = false;

    /* витрина: нет дома — собираем целиком; есть — чиним только структуру */
    const show = (acc.show && typeof acc.show === 'object' && !Array.isArray(acc.show)) ? acc.show : null;
    if (!show || !show.home) {
      acc.show = showFor(nick, at);
      touched = true;
    } else {
      if (!Array.isArray(show.wear)) { show.wear = []; touched = true; }
      if (!Array.isArray(show.stands)) { show.stands = []; touched = true; }
      if (!(num(show.t) > 0)) { show.t = at; touched = true; }
    }

    /* аватар: пустой или служебный 🐺 — меняем на «свой» по индексу */
    const av = (acc.avatar && typeof acc.avatar === 'object' && !Array.isArray(acc.avatar)) ? acc.avatar : null;
    const emoji = av ? String(av.emoji || '') : '';
    if (!emoji || emoji === AVATAR_FALLBACK.emoji) {
      acc.avatar = botAvatarAt(botIndexFor(acc, nick));
      touched = true;
    }

    if (!touched) continue;
    list[key] = acc;
    nicks.push(nick);
  }

  if (nicks.length) {
    try { await writeAll(list); }
    catch (e) { return { ok: false, err: 'write', msg: errText(e), changed: 0 }; }
  }

  /* сводка по всем ботам — чтобы было видно, что витрины не пустые */
  let withHome = 0;
  let withWear = 0;
  let withStands = 0;
  for (let k = 0; k < keys.length; k++) {
    const acc = list[keys[k]];
    if (!acc || typeof acc !== 'object' || acc.bot !== true) continue;
    const sh = (acc.show && typeof acc.show === 'object') ? acc.show : {};
    if (sh.home) withHome++;
    if (Array.isArray(sh.wear) && sh.wear.length) withWear++;
    if (Array.isArray(sh.stands) && sh.stands.length) withStands++;
  }

  return {
    ok: true,
    bots: bots,
    changed: nicks.length,
    withHome: withHome,
    withWear: withWear,
    withStands: withStands,
    nicks: nicks
  };
}

/* ---------- СОЗДАНИЕ БОТОВ ----------
   50 аккаунтов из готовых ников/био/аватаров. Живых аккаунтов не касаемся:
   если ник занят человеком — бота под этим ником не создаём.
   force !== true и боты уже есть — ничего не дублируем. */

/* кошелёк из ника — тот же FNV-1a, что в api.js */
function walletFromNick(nick) {
  const t = 'de-wallet|' + normNick(nick);
  let h = 2166136261;
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return String(h % 100000000).padStart(8, '0');
}

function freeWallet(list, nick, skipKey) {
  let w = walletFromNick(nick);
  for (let i = 0; i < 100; i++) {
    let busy = false;
    for (const k in list) {
      if (skipKey && k === skipKey) continue;               // свой же старый кошелёк не мешает
      if (list[k] && String(list[k].wallet) === w) { busy = true; break; }
    }
    if (!busy) return w;
    w = String((Number(w) + 1) % 100000000).padStart(8, '0');
  }
  return String(Math.floor(Math.random() * 100000000)).padStart(8, '0');
}

function pickFrom(arr, i) {
  if (!Array.isArray(arr) || !arr.length) return null;
  if (arr[i] !== undefined && arr[i] !== null) return arr[i];
  return arr[i % arr.length];
}

function randPass(rand) {
  let s = '';
  while (s.length < 16) s += Math.floor(rand() * 16).toString(16);
  return 'h' + s;
}

export async function seedBots(force) {
  const at = Date.now();
  let list;
  try { list = await readAll(); }
  catch (e) { return { ok: false, err: 'read', msg: errText(e) }; }

  let existed = 0;
  for (const k in list) {
    const a = list[k];
    if (a && typeof a === 'object' && a.bot === true) existed++;
  }
  if (existed && force !== true) return { ok: true, existed: true, count: existed };

  let created = 0;
  const skipped = [];

  const used = new Set();                     // ники, занятые в этом прогоне
  for (let i = 0; i < BOT_COUNT; i++) {
    const nickRaw = pickFrom(BOT_NICKS, i);
    const nick = (typeof nickRaw === 'string' || typeof nickRaw === 'number') ? String(nickRaw).trim() : '';
    if (!nick) { skipped.push({ index: i, why: 'nonick' }); continue; }
    const lc = normNick(nick);
    if (!lc) { skipped.push({ index: i, why: 'nonick' }); continue; }
    if (used.has(lc)) { skipped.push({ index: i, nick: nick, why: 'dup' }); continue; }
    used.add(lc);

    /* уже занято человеком — не перезаписываем ни при каком force */
    let busyHuman = false;
    for (const k in list) {
      const a = list[k];
      if (!a || typeof a !== 'object' || a.bot === true) continue;
      if (normNick(a.nick) === lc || normNick(a.nick_lc) === lc || normNick(a.email) === lc ||
          normNick(a.legacy_email) === lc || k === lc) { busyHuman = true; break; }
    }
    if (busyHuman) { skipped.push({ index: i, nick: nick, why: 'human' }); continue; }

    const persona = personaFor(i);

    /* капитал: startCapital(persona, mulberry32(index*7919)) */
    let capital = 0;
    try { capital = num(startCapital(persona, mulberry32(i * 7919))); } catch (e) { capital = 0; }
    if (!(capital > 0)) capital = BOT_START_USDT;
    capital = round2(capital);

    const rnd = mulberry32(i * 7919 + 1);

    /* created — по последним 45 дням, от свежих к старым */
    const createdAt = at - Math.round((45 * DAY) * ((i + 0.5) / BOT_COUNT)) - Math.floor(rnd() * 6 * 60 * 60 * 1000);
    /* last_seen — последние 3 дня, но не раньше создания */
    const minSeen = Math.max(createdAt + 60 * 1000, at - 3 * DAY);
    const lastSeen = minSeen + Math.floor(rnd() * Math.max(1, at - minSeen));

    const bioRaw = pickFrom(BOT_BIOS, i);
    /* аватар: (index*7+3) % длины — разнообразие вместо «🐺 на всех» */
    const avatar = botAvatarAt(i);

    const acc = {
      nick: nick,
      nick_lc: lc,
      pass: randPass(mulberry32(i * 7919 + 3)),
      wallet: freeWallet(list, lc, lc),
      admin: false,
      bot: true,
      botIndex: i,
      persona: persona,
      created: createdAt,
      updated: lastSeen,
      last_seen: lastSeen,
      bio: cut(bioRaw === null ? '' : bioRaw, BIO_MAX),
      avatar: avatar,
      /* витрина: дом, украшения, номера — детерминированно от ника */
      show: showFor(nick, at),
      privacy: { hideBalance: false, private: false },
      social: { followers: 0, following: 0 },
      rec: '',
      state: {
        ex: JSON.stringify({ v: 3, usdt: capital, amounts: {}, trades: [] }),
        nft: JSON.stringify({ items: [], opened: 0 }),
        ext: null,
        led: null
      }
    };

    list[lc] = acc;
    created++;
  }

  if (created) {
    try { await writeAll(list); }
    catch (e) { return { ok: false, err: 'write', msg: errText(e), created: 0 }; }
  }

  return { ok: true, created: created, existed: false, skipped: skipped.length ? skipped : undefined };
}

/* ============================================================================
   РАЗГОН КАПИТАЛА — ручка POST /api/bots/boost (одноразовая).

   Боты получают USDT по ступенчатой схеме, поэтому в ленте сразу появляются
   обороты в миллионы, а не только проценты. Порядок детерминированный:
   сортировка по FNV(ник), потом по нику — один и тот же список ботов всегда
   даёт один и тот же расклад ступеней. Повторный вызов ничего не добавляет:
   получившие помечены a.boosted, их видно в ответе как skipped.
   ============================================================================ */

const BOOST_STEPS = [
  50000000, 20000000, 10000000, 5000000, 2000000, 1000000,
  500000, 250000, 100000, 100000, 50000, 25000
];
const BOOST_OTHER = 10000;        // всем, кто дальше ступеней
const BOOST_FEED_MAX = 3;         // событий в ленту за разгон

export async function boostBots(count) {
  const want = Math.floor(num(count));
  const n = want > 0 ? want : 12;

  let list;
  try { list = await readAll(); }
  catch (e) { return { ok: false, err: 'read', msg: errText(e) }; }

  /* боты в порядке FNV(ник): ступень достаётся не по алфавиту, а «как легло» */
  const picks = [];
  for (const k of Object.keys(list)) {
    const a = list[k];
    if (!a || typeof a !== 'object' || a.bot !== true) continue;
    const nick = nickOfAcc(a, k);
    if (!nick) continue;
    picks.push({ key: k, acc: a, nick: nick, h: hashSeed(normNick(nick)) });
  }
  picks.sort(function (x, y) {
    if (x.h !== y.h) return x.h < y.h ? -1 : 1;
    return x.nick < y.nick ? -1 : x.nick > y.nick ? 1 : 0;
  });

  const take = picks.slice(0, Math.min(n, picks.length));
  const at = Date.now();
  const boosted = [];
  const skippedBots = [];
  let added = 0;

  for (let i = 0; i < take.length; i++) {
    const it = take[i];
    const acc = it.acc;

    /* уже получал — второй раз не раздуваем */
    if (acc.boosted === true || acc.boosted === 1) {
      skippedBots.push(it.nick);
      continue;
    }

    const step = i < BOOST_STEPS.length ? BOOST_STEPS[i] : BOOST_OTHER;
    const f = exOf(acc);
    const after = round2(num(f.ex.usdt) + step);
    if (!isFinite(after) || after < 0) continue;      // NaN/Infinity в счёт не пускаем

    f.ex.usdt = after;
    if (!Array.isArray(f.ex.trades)) f.ex.trades = [];
    saveEx(acc, f.st, f.ex);

    acc.boosted = true;
    acc.boostedAt = at;
    acc.boostedSum = round2(num(acc.boostedSum) + step);

    added += step;
    boosted.push({ nick: it.nick, added: step, usdt: after });
  }

  /* одна запись accounts на весь разгон; люди в том же объекте не тронуты */
  if (boosted.length) {
    try { await writeAll(list); }
    catch (e) {
      return { ok: false, err: 'write', msg: errText(e), added: 0, boosted: 0, skipped: skippedBots.length };
    }
  }

  /* до трёх событий в ленту — про первые ступени, то есть про самые крупные */
  let events = 0;
  for (let i = 0; i < boosted.length && events < BOOST_FEED_MAX; i++) {
    const b = boosted[i];
    try {
      if (await pushEvent(b.nick, 'milestone',
        'пополнил капитал до ' + fmtUsdt(b.usdt) + ' USDT',
        { money: b.usdt, sym: 'USDT' })) events++;
    } catch (e) { /* лента не должна ронять разгон */ }
  }

  return {
    count: take.length,
    added: round2(added),
    boosted: boosted.length,
    skipped: skippedBots.length,
    events: events,
    bots: boosted,
    skippedBots: skippedBots
  };
}

/* ============================================================================
   ЖИВОЙ РЕЖИМ — «прямой эфир» биржи.

   Раз в несколько секунд один-два случайных бота делают действие: сделка,
   перевод, смена био или подписка. Это не экономический тик (он остаётся
   раз в 20 минут и двигает капитал), а жизнь: в ленте постоянно появляются
   новые события, а цифры на экране шевелятся. Суммы — как на живой бирже:
   сделка 0.5–3% портфеля (от 100 USDT), перевод 0.3–2% кэша (100..300 000),
   поэтому у разогнанных ботов в эфире видны сотни тысяч USDT. 12% переводов
   уходят человеку — деньги на счёт можно, профиль трогать нельзя.

   Правила:
     • профиль и действия — только у ботов (bot === true); человеку можно
       зачислить USDT переводом, но pass / wallet / bio у него не трогаем;
     • accounts пишем ровно один раз за шаг;
     • в ленту — не больше 5 событий за шаг;
     • bots_meta обновляем только полем liveAt, остальные поля не затираем;
     • замок bots_live_lock на 4 секунды: шаг не чаще раза в 4 секунды;
     • весь «случай» выводится из слота Math.floor(now / 5000), поэтому один
       и тот же now даёт одних и тех же ботов и те же виды действий;
     • если шанс не сыграл или действие не сложилось (нет денег, все подписки
       уже стоят) — даём одну сделку, а без денег — смену био:
       лента не должна замирать.
   ============================================================================ */

const LIVE_LOCK_KEY = 'bots_live_lock';
const LIVE_LOCK_MS = 4 * 1000;            // шаг не чаще раза в 4 секунды
const LIVE_SLOT_MS = 5 * 1000;            // слот выбора: каждые 5 секунд новые боты
const LIVE_TRADES_MAX = 60;               // история сделок живого режима
const LIVE_FEED_MAX = 5;                  // событий в ленту за шаг
const LIVE_TRADE_P = 0.55;                // шанс сделки
const LIVE_TRANSFER_P = 0.15;             // шанс перевода другому боту
const LIVE_PROFILE_P = 0.10;              // шанс смены био
const LIVE_FOLLOW_P = 0.10;               // шанс подписки
/* профиль меняется не только био: смена био заодно может обновить аватар
   (40%) и реже — квартиру в витрине (25%). Так профили ботов живут, а не
   стоят с одной картинкой с момента создания. */
const LIVE_AVATAR_P = 0.40;
const LIVE_HOME_P = 0.25;
/* перевод: 0.3..2% своего USDT, но не меньше 100 и не больше 300 000 USDT.
   У разогнанных ботов это сотни тысяч — в ленте видно настоящие обороты. */
const LIVE_TRANSFER_SHARE_MIN = 0.003;
const LIVE_TRANSFER_SHARE_MAX = 0.02;
const LIVE_TRANSFER_MIN = 100;            // перевод «на жизнь»: от 100 USDT
const LIVE_TRANSFER_MAX = 300000;         // ...до 300 000 USDT
/* сделка: 0.5..3% портфеля, но не меньше 100 USDT по стоимости */
const LIVE_SHARE_MIN = 0.005;
const LIVE_SHARE_MAX = 0.030;
const LIVE_TRADE_MIN = 100;
const LIVE_PNL_MIN = 0.002;               // исход сделки ±0.2%
const LIVE_PNL_MAX = 0.008;               // ...±0.8%
const LIVE_QTY_MIN = 1e-6;                // пыль не торгуем
const LIVE_SYMBOLS = Object.keys(PRICES); // те же монеты, что у тика

/* ---------- живые помощники ---------- */

/* количество монеты для текста события: 1200 → «1 200», 0.3 → «0.3» */
function fmtQty(n) {
  const v = Math.abs(num(n));
  if (!(v > 0)) return '0';
  if (v >= 1000) return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  if (v >= 10) return String(Math.round(v * 100) / 100);
  if (v >= 1) return String(Math.round(v * 1000) / 1000);
  if (v >= 0.001) return String(Math.round(v * 10000) / 10000);
  const s = v.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  return s || '0';
}

/* исход сделки для текста: 0.004 → «+0.4%», -0.002 → «-0.2%» */
function fmtPct(r) {
  const v = num(r);
  const p = Math.round(Math.abs(v) * 1000) / 10;
  return (v >= 0 ? '+' : '-') + p.toFixed(1) + '%';
}

/* сумма для текста: 1250000 → «1 250 000». Крупные обороты читаются только
   с пробелами — в живой ленте это и нужно. */
function fmtUsdt(n) {
  const v = Math.round(num(n));
  if (!(v > 0) || !isFinite(v)) return '0';
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/* та же сумма, но с копейками: 4813710.5 → «4 813 710.5» (переводы не
   округляем — в счёте должны остаться точные цифры) */
function fmtMoney(n) {
  const v = round2(n);
  if (!(v > 0) || !isFinite(v)) return '0';
  const s = String(v);
  const dot = s.indexOf('.');
  const head = dot >= 0 ? s.slice(0, dot) : s;
  const tail = dot >= 0 ? s.slice(dot) : '';
  return head.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + tail;
}

/* количество с точностью хранилища: пыль ниже 1e-6 не держим */
function roundQty(n) {
  const v = num(n);
  if (!(v > 0)) return 0;
  if (v >= 1e6) return Math.round(v);
  const r = Math.round(v * 1e6) / 1e6;
  return r > 0 ? r : 0;
}

function setAmountLive(ex, sym, v) {
  const q = roundQty(v);
  if (q > 0) ex.amounts[sym] = q;
  else delete ex.amounts[sym];
}

function trimLiveTrades(ex) {
  if (!Array.isArray(ex.trades)) { ex.trades = []; return; }
  if (ex.trades.length > LIVE_TRADES_MAX) ex.trades.length = LIVE_TRADES_MAX;
}

function addLiveTrade(ex, row) {
  if (!Array.isArray(ex.trades)) ex.trades = [];
  ex.trades.unshift(row);
  trimLiveTrades(ex);
}

/* портфель по тем же курсам, что у тика и на клиенте */
function liveEquity(ex) {
  let eq = num(ex.usdt);
  for (const sym in ex.amounts) {
    const price = num(PRICES[sym]);
    if (!(price > 0)) continue;
    eq += num(ex.amounts[sym]) * price;
  }
  if (!isFinite(eq) || eq < 0) return 0;
  return eq;
}

/* монета под покупку: количество не должно быть пылью */
function liveBuySymbol(m, rnd) {
  const pool = [];
  for (let i = 0; i < LIVE_SYMBOLS.length; i++) {
    const sym = LIVE_SYMBOLS[i];
    const price = num(PRICES[sym]);
    if (!(price > 0)) continue;
    if (m / price >= LIVE_QTY_MIN) pool.push(sym);
  }
  if (!pool.length) return null;
  return pool[Math.floor(rnd() * pool.length) % pool.length];
}

function markActive(acc, now) {
  if (!acc || typeof acc !== 'object') return;
  acc.updated = now;
  acc.last_seen = now;
}

/* страховка от битых данных: отрицательный кэш и пропавшую историю чиним
   у выбранного бота до действия — в минус счёт не отпускаем. */
function sanitizeBot(acc) {
  if (!acc || typeof acc !== 'object' || acc.bot !== true) return;
  const f = exOf(acc);
  let dirty = false;
  if (!(num(f.ex.usdt) >= 0)) { f.ex.usdt = 0; dirty = true; }
  if (!Array.isArray(f.ex.trades)) { f.ex.trades = []; dirty = true; }
  if (dirty) saveEx(acc, f.st, f.ex);
}

/* ---------- живые действия ---------- */

/* сделка в эфире: 0.5–3% портфеля, но не меньше 100 USDT по стоимости;
   исход ±0.2–0.8%. Покупаем на часть свободного USDT, продаём самую крупную
   позицию — так сделка не упирается в пыль и не уводит счёт в минус. */
function liveTrade(acc, rnd, now) {
  const f = exOf(acc);
  const ex = f.ex;

  /* битый отрицательный кэш чиним на месте, в минус счёт не отпускаем */
  const cash = Math.max(0, num(ex.usdt));
  if (cash !== num(ex.usdt)) ex.usdt = cash;

  const eq = liveEquity(ex);
  if (!(eq > 0)) return null;

  const share = LIVE_SHARE_MIN + (LIVE_SHARE_MAX - LIVE_SHARE_MIN) * rnd();
  let stake = eq * share;
  if (stake < LIVE_TRADE_MIN) stake = Math.min(LIVE_TRADE_MIN, eq);   // не мельче 100 USDT
  if (!(stake > 0)) return null;

  const have = [];
  for (const sym in ex.amounts) {
    const price = num(PRICES[sym]);
    const qty = num(ex.amounts[sym]);
    if (price > 0 && qty > 0) have.push({ sym: sym, qty: qty, value: qty * price });
  }
  have.sort(function (x, y) { return y.value - x.value; });

  let side = rnd() < 0.5 ? 'BUY' : 'SELL';
  if (side === 'BUY' && !(cash > 0)) side = 'SELL';
  if (side === 'SELL' && !have.length) side = 'BUY';
  /* самая крупная позиция меньше половины замаха, а кэш есть — продажа
     ушла бы в пыль: покупаем, чтобы сумма в ленте была настоящей */
  if (side === 'SELL' && cash > 0 && have[0].value < stake * 0.5) side = 'BUY';

  let sym = null;
  let price = 0;
  let qty = 0;
  let m = 0;

  if (side === 'SELL') {
    const pos = have[0];
    price = num(PRICES[pos.sym]);
    m = Math.min(stake, pos.value);
    if (!(price > 0) || !(m > 0)) return null;
    qty = m / price;
    if (qty > pos.qty) { qty = pos.qty; m = qty * price; }
    sym = pos.sym;
  } else {
    m = Math.min(stake, cash * 0.98);
    if (!(m > 0)) return null;
    sym = liveBuySymbol(m, rnd);
    if (!sym) return null;
    price = num(PRICES[sym]);
    if (!(price > 0)) return null;
    qty = m / price;
  }

  const qtyR = roundQty(qty);
  if (!(qtyR > 0)) return null;

  const r = (rnd() < 0.5 ? 1 : -1) * (LIVE_PNL_MIN + (LIVE_PNL_MAX - LIVE_PNL_MIN) * rnd());
  if (!isFinite(r)) return null;
  const pnl = m * r;
  if (!isFinite(pnl)) return null;

  if (side === 'BUY') {
    setAmountLive(ex, sym, num(ex.amounts[sym]) + qty * (1 + r));
    ex.usdt = Math.max(0, round2(cash - m));
  } else {
    setAmountLive(ex, sym, num(ex.amounts[sym]) - qty);
    ex.usdt = Math.max(0, round2(cash + m * (1 + r)));
  }
  if (!(ex.usdt >= 0) || !isFinite(ex.usdt)) ex.usdt = 0;

  addLiveTrade(ex, {
    t: now,
    side: side,
    sym: sym,
    qty: qtyR,
    price: price,
    total: round2(m),
    pnl: round6(pnl)
  });
  saveEx(acc, f.st, ex);

  return { kind: 'trade', sym: sym, side: side, qty: qtyR, r: r, pnl: pnl, total: round2(m) };
}

/* перевод в эфире: 0.3–2% своего USDT, но не меньше 100 и не больше
   300 000 USDT. Деньги реально уходят и приходят. 12% переводов уходят
   человеку (владельцу или случайному человеку с кошельком) — людям можно
   начислять USDT, но их профиль живой режим не трогает. */
function liveTransfer(acc, pool, self, rnd, now, humans) {
  if (!Array.isArray(pool) || !pool.length) return null;
  const others = [];
  for (let i = 0; i < pool.length; i++) {
    if (pool[i] !== self && pool[i] && pool[i].acc) others.push(pool[i]);
  }
  if (!others.length) return null;

  const have = usdtOf(acc);
  if (!(have >= LIVE_TRANSFER_MIN)) return null;

  const share = LIVE_TRANSFER_SHARE_MIN + (LIVE_TRANSFER_SHARE_MAX - LIVE_TRANSFER_SHARE_MIN) * rnd();
  let amount = have * share;
  if (amount < LIVE_TRANSFER_MIN) amount = LIVE_TRANSFER_MIN;
  if (amount > LIVE_TRANSFER_MAX) amount = LIVE_TRANSFER_MAX;
  if (amount > have) amount = Math.floor(have * 100) / 100;   // больше кэша не шлём
  amount = round2(amount);
  if (!(amount > 0)) return null;

  /* 12% — человеку; остальное, как раньше, случайному боту */
  let to = null;
  let human = false;
  if (Array.isArray(humans) && humans.length && rnd() < HUMAN_TRANSFER_P) {
    to = pickHuman(humans, rnd);
    human = !!to;
  }
  if (!to) to = others[Math.floor(rnd() * others.length) % others.length];

  if (!transferUsdt(acc, to.acc, amount, now, human)) return null;

  /* кэп истории сделок — 60 у ботов; человеку историю не укорачиваем */
  const f = exOf(acc);
  trimLiveTrades(f.ex);
  saveEx(acc, f.st, f.ex);
  const t = exOf(to.acc);
  if (!human) trimLiveTrades(t.ex);
  saveEx(to.acc, t.st, t.ex);

  return { amount: amount, toNick: nickOfAcc(to.acc, to.key), human: human };
}

/* профиль бота: био из bot-names.js, иногда заодно аватар и квартира.
   Возвращает { bio, avatar, home } — что именно сменилось (для ленты). */
function liveProfile(acc, rnd, now) {
  if (!acc || typeof acc !== 'object') return null;

  /* 1. био — как раньше, из готового списка, не повторяя текущее */
  let bio = '';
  if (Array.isArray(BOT_BIOS) && BOT_BIOS.length) {
    const n = BOT_BIOS.length;
    let idx = Math.floor(rnd() * n) % n;
    bio = cut(BOT_BIOS[idx] === undefined ? '' : BOT_BIOS[idx], BIO_MAX);
    const cur = String(acc.bio === undefined || acc.bio === null ? '' : acc.bio);
    for (let i = 0; i < 4 && (!bio || bio === cur); i++) {
      idx = (idx + 1) % n;
      bio = cut(BOT_BIOS[idx] === undefined ? '' : BOT_BIOS[idx], BIO_MAX);
    }
  }
  if (!bio) return null;
  acc.bio = bio;

  /* 2. аватар: 40% — другой эмодзи из BOT_AVATARS (цвет парный, как в seed) */
  let avatar = null;
  if (rnd() < LIVE_AVATAR_P) {
    const n = (Array.isArray(BOT_AVATARS) && BOT_AVATARS.length) ? BOT_AVATARS.length : 0;
    if (n) {
      const curEmoji = String((acc.avatar && acc.avatar.emoji) || '');
      let idx = Math.floor(rnd() * n) % n;
      for (let i = 0; i < 4 && BOT_AVATARS[idx] && BOT_AVATARS[idx].emoji === curEmoji; i++) {
        idx = (idx + 1) % n;
      }
      const src = BOT_AVATARS[idx] || null;
      if (src && src.emoji) {
        avatar = {
          emoji: cut(src.emoji, 8) || AVATAR_FALLBACK.emoji,
          color: /^#[0-9a-f]{6}$/i.test(String(src.color || '')) ? String(src.color) : AVATAR_FALLBACK.color
        };
        acc.avatar = avatar;
      }
    }
  }

  /* 3. квартира: 25% — новый дом из BOT_HOMES, витрина создаётся при нехватке */
  let home = null;
  if (rnd() < LIVE_HOME_P) {
    const show = (acc.show && typeof acc.show === 'object' && !Array.isArray(acc.show))
      ? acc.show : null;
    const curHome = show ? String(show.home || '') : '';
    let idx = Math.floor(rnd() * BOT_HOMES.length) % BOT_HOMES.length;
    for (let i = 0; i < 4 && BOT_HOMES[idx].id === curHome; i++) {
      idx = (idx + 1) % BOT_HOMES.length;
    }
    if (BOT_HOMES[idx].id !== curHome || !show || !show.home) {
      home = BOT_HOMES[idx].id;
      const next = show || { home: null, wear: [], stands: [], t: num(now) };
      if (!Array.isArray(next.wear)) next.wear = [];
      if (!Array.isArray(next.stands)) next.stands = [];
      next.home = home;
      next.t = num(now);
      acc.show = next;
    }
  }

  return { bio: bio, avatar: avatar, home: home };
}

/* подписка на случайный аккаунт: edges — один read и один write.
   Счётчики пересчитываем строго по edges и проставляем ТОЛЬКО ботам:
   аккаунт человека живой режим не трогает вообще. */
async function liveFollow(acc, it, list, rnd, now) {
  const from = lcOfAcc(acc, it.key);
  if (!from) return null;

  let edges = null;
  try { edges = await readSocialEdges(); }
  catch (e) { edges = null; }
  if (!edges || typeof edges !== 'object' || Array.isArray(edges)) edges = {};

  const counts = socialCounts(edges);
  if ((counts.following[from] || 0) >= FOLLOW_MAX) return null;   // больше 40 подписок не держим

  const targets = accountTargets(list);
  const pool = [];
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    if (!t.lc || t.lc === from) continue;
    if (edges[from + '>' + t.lc]) continue;                      // уже читает — не дублируем
    pool.push(t);
  }
  if (!pool.length) return null;

  const to = pool[Math.floor(rnd() * pool.length) % pool.length];
  edges[from + '>' + to.lc] = now;
  try { await writeSocialEdges(edges); }
  catch (e) { return null; }

  const finalCounts = socialCounts(edges);
  const all = accountTargets(list);
  for (let i = 0; i < all.length; i++) {
    if (all[i].acc.bot !== true) continue;
    applySocialCounts(all[i].acc, all[i].lc, finalCounts);
  }

  return { toNick: nickOfAcc(to.acc, to.lc) };
}

/* одно действие бота; null — не сложилось, шаг попробует другой вариант */
async function liveAct(kind, it, ctx) {
  if (!kind || !it || !it.acc || typeof it.acc !== 'object') return null;
  const acc = it.acc;
  if (acc.bot !== true) return null;                 // людей не трогаем никогда
  sanitizeBot(acc);                                  // битый кэш чиним до действия

  const list = ctx.list;
  const now = ctx.now;
  const rnd = ctx.rnd;
  const addFeed = ctx.addFeed;
  const nick = nickOfAcc(acc, it.key);

  if (kind === 'trade') {
    const tr = liveTrade(acc, rnd, now);
    if (!tr) return null;
    if (addFeed) {
      addFeed(nick, 'trade',
        (tr.side === 'BUY' ? 'взял ' : 'продал ') + fmtQty(tr.qty) + ' ' + tr.sym +
        ' на ' + fmtUsdt(tr.total) + ' USDT · ' + fmtPct(tr.r),
        { sym: tr.sym, money: round2(tr.pnl) });
    }
    markActive(acc, now);
    return { kind: 'trade', sym: tr.sym, side: tr.side, pnl: round2(tr.pnl), total: round2(tr.total) };
  }

  if (kind === 'transfer') {
    const tr = liveTransfer(acc, ctx.pool, it, rnd, now, ctx.humans);
    if (!tr) return null;
    if (addFeed) {
      addFeed(nick, 'transfer_out', 'отправил ' + fmtMoney(tr.amount) + ' USDT → @' + tr.toNick,
        { money: tr.amount, sym: 'USDT' });
      addFeed(tr.toNick, 'transfer_in', 'получил ' + fmtMoney(tr.amount) + ' USDT от @' + nick,
        { money: tr.amount, sym: 'USDT' });
    }
    markActive(acc, now);
    return { kind: 'transfer', to: tr.toNick, amount: tr.amount };
  }

  if (kind === 'profile') {
    const p = liveProfile(acc, rnd, now);
    if (!p) return null;
    /* в ленту — самое заметное из изменений: квартира важнее аватара, а
       аватар важнее био (био и так видно в профиле) */
    let text = 'сменил био: ' + p.bio;
    if (p.home) {
      const name = homeName(p.home);
      text = 'сменил квартиру на «' + (name || p.home) + '»';
    } else if (p.avatar) {
      text = 'обновил аватар';
    }
    if (addFeed) addFeed(nick, 'profile', text, null);
    markActive(acc, now);
    return { kind: 'profile', bio: p.bio, avatar: p.avatar ? p.avatar.emoji : null, home: p.home };
  }

  if (kind === 'follow') {
    const f = await liveFollow(acc, it, list, rnd, now);
    if (!f) return null;
    if (addFeed) addFeed(nick, 'follow', 'подписался на @' + f.toNick, null);
    markActive(acc, now);
    return { kind: 'follow', to: f.toNick };
  }

  return null;
}

/* шансы одного бота: 0.55 сделка / 0.15 перевод / 0.10 био / 0.10 подписка,
   остальные 10% — пауза (шаг потом добирает её фолбэком) */
function liveChance(rnd) {
  const r = rnd();
  if (r < LIVE_TRADE_P) return 'trade';
  if (r < LIVE_TRADE_P + LIVE_TRANSFER_P) return 'transfer';
  if (r < LIVE_TRADE_P + LIVE_TRANSFER_P + LIVE_PROFILE_P) return 'profile';
  if (r < LIVE_TRADE_P + LIVE_TRANSFER_P + LIVE_PROFILE_P + LIVE_FOLLOW_P) return 'follow';
  return null;
}

/* боты, которых можно оживить: bot === true и есть state.ex. Если state.ex нет
   ни у кого (пустое хранилище, битые данные) — берём всех ботов: каждое
   действие само переживает и отсутствие state, и битый JSON. */
function livePool(list) {
  const all = [];
  const keys = Object.keys(list);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const a = list[k];
    if (!a || typeof a !== 'object' || a.bot !== true) continue;
    const st = (a.state && typeof a.state === 'object') ? a.state : null;
    const hasEx = !!(st && st.ex !== undefined && st.ex !== null && st.ex !== '');
    all.push({ key: k, acc: a, hasEx: hasEx, cap: usdtOf(a) });
  }
  all.sort(function (x, y) {
    const nx = String(x.acc.nick_lc || x.acc.nick || x.key).toLowerCase();
    const ny = String(y.acc.nick_lc || y.acc.nick || y.key).toLowerCase();
    return nx < ny ? -1 : nx > ny ? 1 : 0;
  });
  const withEx = all.filter(function (b) { return b.hasEx; });
  const pool = withEx.length ? withEx : all;
  for (let i = 0; i < pool.length; i++) pool[i].rank = i;
  return pool;
}

/* 1–2 разных бота от слота: каждые 5 секунд набор новый, внутри слота — тот же */
function livePicked(pool, slot) {
  const n = pool.length;
  if (!n) return [];
  const rnd = mulberry32(hashSeed('live-pick|' + slot));

  /* богатые боты должны мелькать в ленте чаще: иначе сорок ботов
     с десятью тысячами забивают двенадцать крупных */
  let src = pool;
  if (rnd() < 0.6) {
    const rich = pool.filter(function (b) { return b.cap >= 1000000; });
    if (rich.length) src = rich;
  }
  const m = src.length;
  const first = Math.floor(rnd() * m) % m;
  const out = [src[first]];
  if (m > 1 && rnd() < 0.55) {
    const off = 1 + (Math.floor(rnd() * (m - 1)) % (m - 1));
    out.push(src[(first + off) % m]);
  }
  return out;
}

/* ---------- ОДИН ЖИВОЙ ШАГ ----------
   now — время шага (мс). Замок: { ok: true, skipped: 'lock' } — если прошлый
   шаг был меньше 4 секунд назад. Дел: 1–2 действия, до 5 событий. */

export async function runLive(now) {
  const at = Number(now);
  const atMs = (isFinite(at) && at > 0) ? at : Date.now();
  const s = store();

  /* 1. замок: чаще раза в 4 секунды не живём */
  let lock = 0;
  try { lock = num(await s.get(LIVE_LOCK_KEY, { type: 'json' })); } catch (e) { lock = 0; }
  if (lock > 0 && Math.abs(atMs - lock) < LIVE_LOCK_MS) {
    return { ok: true, skipped: 'lock', at: atMs };
  }
  try { await s.setJSON(LIVE_LOCK_KEY, atMs); }
  catch (e) { return { ok: false, err: 'lock', msg: errText(e), at: atMs }; }

  /* 2. аккаунты: людей в этом списке только читаем */
  let list;
  try { list = await readAll(); }
  catch (e) { return { ok: false, err: 'read', msg: errText(e), at: atMs }; }

  const pool = livePool(list);
  if (!pool.length) return { ok: true, skipped: 'nobots', at: atMs };
  const humans = humanTargets(list);            // люди: им можно деньги, профиль — нет

  /* 3. слот: одни и те же боты и те же виды действий в пределах пяти секунд */
  const slot = Math.floor(atMs / LIVE_SLOT_MS);
  const picked = livePicked(pool, slot);

  const feed = [];
  const seen = new Set();
  function addFeed(nick, type, text, extra) {
    if (feed.length >= LIVE_FEED_MAX) return false;
    const name = String(nick === null || nick === undefined ? '' : nick).trim();
    if (!name) return false;
    const key = name + '|' + type + '|' + text;
    if (seen.has(key)) return false;
    seen.add(key);
    feed.push({ nick: name, type: String(type || 'milestone'), text: text, extra: extra || null });
    return true;
  }

  /* потоки сделок этого шага: покупка двигает цену вверх, продажа — вниз.
     В эфире всего 1–2 сделки, зато реакция мгновенная: «купили много →
     цена скакнула» видно сразу, а не через двадцать минут. */
  const flows = {};

  async function act(kind, it, rnd) {
    try {
      const res = await liveAct(kind, it, { list: list, pool: pool, humans: humans, now: atMs, rnd: rnd, addFeed: addFeed });
      if (res && res.kind === 'trade' && res.sym && num(res.total) > 0) {
        const sign = String(res.side || '').toUpperCase() === 'SELL' ? -1 : 1;
        flows[res.sym] = (flows[res.sym] || 0) + sign * num(res.total);
      }
      return res;
    } catch (e) {
      return null;                                   // одно действие не роняет шаг
    }
  }

  const done = [];
  let actions = 0;

  /* 4. каждому выбранному боту — одно действие по шансу */
  for (let i = 0; i < picked.length; i++) {
    const it = picked[i];
    const nick = nickOfAcc(it.acc, it.key);
    const rnd = mulberry32(hashSeed('live|' + slot + '|' + normNick(nick)));
    const kind = liveChance(rnd);
    if (!kind) continue;                            // пауза: бот просто смотрит
    const res = await act(kind, it, rnd);
    if (res) { actions++; done.push({ nick: nick, kind: res.kind }); }
  }

  /* 5. лента не должна замирать: шанс не сыграл или действие не сложилось —
        даём одну мелкую сделку, а без денег — смену био */
  if (!actions) {
    const warm = ['trade', 'profile'];
    for (let i = 0; i < picked.length && !actions; i++) {
      const it = picked[i];
      const nick = nickOfAcc(it.acc, it.key);
      const rnd = mulberry32(hashSeed('live-warm|' + slot + '|' + normNick(nick)));
      for (let j = 0; j < warm.length; j++) {
        const res = await act(warm[j], it, rnd);
        if (res) { actions++; done.push({ nick: nick, kind: res.kind, warm: true }); break; }
      }
    }
  }

  /* 5b. рынок: сделки эфира применяем к ценам сразу после микросделок */
  let market = null;
  try { market = await marketStep(flows, atMs); }
  catch (e) { market = null; }

  /* 6. одна запись accounts: люди лежат в том же объекте нетронутыми */
  if (actions) {
    try { await writeAll(list); }
    catch (e) {
      return { ok: false, err: 'write', msg: errText(e), at: atMs, slot: slot, actions: actions };
    }
  }

  /* 7. мета: дописываем только liveAt, поля прошлого тика сохраняем как есть */
  let metaOk = true;
  try {
    let prev = null;
    try { prev = await s.get(META_KEY, { type: 'json' }); } catch (e) { prev = null; }
    const base = (prev && typeof prev === 'object' && !Array.isArray(prev)) ? prev : {};
    await s.setJSON(META_KEY, Object.assign({}, base, { liveAt: atMs }));
  } catch (e) { metaOk = false; }

  /* 8. лента: не больше пяти событий за шаг */
  let sent = 0;
  for (let i = 0; i < feed.length && i < LIVE_FEED_MAX; i++) {
    try {
      if (await pushEvent(feed[i].nick, feed[i].type, feed[i].text, feed[i].extra || undefined)) sent++;
    } catch (e) { /* лента не должна мешать шагу */ }
  }

  return {
    ok: true,
    at: atMs,
    slot: slot,
    bots: picked.length,
    actions: actions,
    events: sent,
    kinds: done,
    market: market,
    metaOk: metaOk
  };
}

/* ---------- вызов по расписанию ---------- */

export default async (req) => {
  try {
    const res = await runTick(Date.now());
    return json(res);
  } catch (e) {
    return json({ ok: false, err: 'tick', msg: errText(e) }, 500);
  }
};
