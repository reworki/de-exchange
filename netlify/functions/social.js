/* ============================================================================
   DE — социальный модуль: публичные профили, подписки, лента, рейтинги,
   приватность. Netlify Functions + Netlify Blobs, чистый ESM.
   Зависимость одна — @netlify/blobs (как в api.js).

   Хранилище общее с api.js: store 'de', ключ accounts — объект, где ключ
   записи = nick_lc. Дополнительные ключи этого модуля:
     edges          { "from>to": timestamp }   — подписки
     feed           [ ... ]                    — общая лента (до 500)
     feed:<lc>      [ ... ]                    — лента профиля (до 30)

   Вызывается из api.js в самом конце цепочки: если путь не наш — null.
   ============================================================================ */

import { getStore } from '@netlify/blobs';
import { MARKET_PRICES } from './market-coins.js';

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

/* ошибка в едином формате: { ok:false, err:"код", msg:"текст" } */
function fail(code, status, msg) {
  return json({ ok: false, err: code, msg: msg || '' }, status);
}

function store() {
  return getStore({ name: 'de', consistency: 'strong' });
}

/* курс для оценки капитала — тот же, что на клиенте.
   Старые монеты перечислены явно, новые приходят из единого справочника
   market-coins.js: так капитал профиля и рейтинга знает все монеты рынка,
   а значения старых при этом не переписываются. */
const PRICES = Object.assign({
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

/* ---------- живые цены ----------
   Капитал профиля и рейтинга обязан считаться по рынку, а не по статике:
   боты двигают цены сделками (market-prices.js), и статичная карта врёт.
   Ключ market читаем лениво и кэшируем на 30 секунд: профиль и топ ходят
   чаще, чем меняется цена, а лишние чтения Blobs ни к чему. */
const MARKET_KEY = 'market';
const MARKET_CACHE_MS = 30 * 1000;
let marketCache = { at: 0, prices: null };

/* карта цен рынка; нет записи/хранилища — статика PRICES */
async function marketPrices() {
  const now = Date.now();
  if (marketCache.prices && (now - marketCache.at) < MARKET_CACHE_MS) return marketCache.prices;

  let out = null;
  try {
    const m = await store().get(MARKET_KEY, { type: 'json' });
    const src = asObj(m).prices;
    if (src && typeof src === 'object' && !Array.isArray(src)) {
      const map = {};
      for (const sym in PRICES) {
        const v = num(src[sym]);
        map[sym] = (v > 0 && isFinite(v)) ? v : PRICES[sym];
      }
      out = map;
    }
  } catch (e) { out = null; }

  if (!out) out = PRICES;                       // рынка ещё нет — живём по статике
  marketCache = { at: now, prices: out };
  return out;
}

const AVATAR_EMOJI = ['🐺', '🦊', '🐯', '🦁', '🐸', '🐼', '🦅', '🐉', '🦄', '👑', '💎', '🚀'];
const DEFAULT_AVATAR = { emoji: '🐺', color: '#c0561b' };

const PAGE = 20;            // размер страницы подписчиков
const TOP_MAX = 100;        // размер рейтинга
const FEED_MAX = 500;       // общая лента
const USER_FEED_MAX = 30;   // лента профиля
const BIO_MAX = 120;
const HOUR = 60 * 60 * 1000;
const WEEK = 7 * 24 * HOUR;

const ROUTES = [
  '/api/profile',
  '/api/follow',
  '/api/unfollow',
  '/api/followers',
  '/api/following',
  '/api/feed',
  '/api/top',
  '/api/privacy'
];

/* ---------- маленькие помощники ---------- */

function normNick(s) {
  return String(s === null || s === undefined ? '' : s).trim().toLowerCase();
}

function asObj(v) {
  return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
}

function num(v) {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

function bool(v) {
  return v === true || v === 1 || v === '1' || v === 'true' || v === 'on' || v === 'yes';
}

function hexColor(v) {
  return /^#[0-9a-f]{6}$/i.test(String(v === null || v === undefined ? '' : v).trim());
}

/* обрезаем по символам, а не по кодовым единицам — эмодзи не рвутся */
function cutText(s, max) {
  const arr = Array.from(String(s === null || s === undefined ? '' : s).trim());
  return arr.length > max ? arr.slice(0, max).join('') : arr.join('');
}

/* капитал с человеческим числом знаков после запятой */
function tidy(n) {
  if (!isFinite(n)) return 0;
  if (Math.abs(n) >= 1e12) return n;
  return Math.round(n * 1e6) / 1e6;
}

/* ---------- чтение состояния аккаунта ---------- */

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

/* state.ex — строка JSON. Битый JSON не должен ронять ручку:
   считаем такой счётчик неизвестным (broken), капитал — 0. */
function exOf(acc) {
  const st = asObj(acc && acc.state);
  const raw = st.ex;
  let ex = null;
  let broken = false;
  if (raw && typeof raw === 'object') ex = raw;
  else if (typeof raw === 'string' && raw.length) {
    try { ex = JSON.parse(raw); } catch (e) { broken = true; }
  }
  if (!ex || typeof ex !== 'object') ex = {};
  return {
    usdt: num(ex.usdt),
    amounts: asObj(ex.amounts),
    trades: Array.isArray(ex.trades) ? ex.trades : [],
    broken: broken
  };
}

function nftOf(acc) {
  const st = asObj(acc && acc.state);
  const nft = parseJson(st.nft, {}) || {};
  return { count: Array.isArray(nft.items) ? nft.items.length : 0 };
}

/* капитал: USDT + монеты по переданным ценам. Цены не передали — берём
   статику PRICES (так модуль работает и без рынка). */
function capitalOf(acc, prices) {
  const map = (prices && typeof prices === 'object' && !Array.isArray(prices)) ? prices : PRICES;
  const ex = exOf(acc);
  let cap = ex.usdt;
  for (const k in ex.amounts) {
    const price = num(map[String(k).toUpperCase()]);
    if (!(price > 0)) continue;
    cap += num(ex.amounts[k]) * price;
  }
  return cap;
}

function trades7Of(acc, now) {
  const trades = exOf(acc).trades;
  const from = now - WEEK;
  let n = 0;
  for (const t of trades) if (t && typeof t === 'object' && num(t.t) > from) n++;
  return n;
}

function levelOf(cap) {
  if (!isFinite(cap)) return null;
  if (cap < 1e6) return 1;
  if (cap < 1e9) return 2;
  if (cap < 1e12) return 3;
  if (cap < 1e15) return 4;
  if (cap < 1e18) return 5;
  return 6;
}

/* процент изменения; нет базы — null */
function pctDelta(cur, base) {
  const b = Number(base);
  if (base === null || base === undefined || base === '' || !isFinite(b) || b <= 0) return null;
  return Math.round(((cur - b) / b) * 1000) / 10;
}

function snapOf(acc) {
  return asObj(acc && acc.snap);
}

function deltaOf(acc, cur, key) {
  const snap = snapOf(acc);
  return pctDelta(cur, snap[key]);
}

function snapOld(acc, now) {
  const t = num(snapOf(acc).t);
  return !(t && (now - t) < HOUR);
}

/* { ...snap, d1: капитал, d7: старый d7 или капитал, t: сейчас } */
function applySnap(acc, capital, now) {
  const snap = snapOf(acc);
  const hasD7 = !(snap.d7 === undefined || snap.d7 === null || snap.d7 === '');
  acc.snap = Object.assign({}, snap, {
    d1: capital,
    d7: hasD7 ? snap.d7 : capital,
    t: now
  });
  return acc.snap;
}

/* ---------- аккаунты ---------- */

function findAcc(list, who) {
  const lc = normNick(who);
  if (!lc) return null;
  const direct = list[lc];
  if (direct && typeof direct === 'object') return direct;
  for (const k in list) {
    const a = list[k];
    if (!a || typeof a !== 'object') continue;
    if (k === lc) return a;
    if (normNick(a.nick_lc) === lc) return a;
    if (normNick(a.nick) === lc) return a;
    if (normNick(a.legacy_email) === lc) return a;
    if (normNick(a.email) === lc) return a;
  }
  return null;
}

function lcOf(a) {
  if (!a || typeof a !== 'object') return '';
  return normNick(a.nick_lc || a.nick || a.legacy_email || a.email || '');
}

function nickOf(a, fallback) {
  if (!a || typeof a !== 'object') return String(fallback || '');
  return String(a.nick || a.nick_lc || a.legacy_email || a.email || fallback || '');
}

function avatarOf(a) {
  const av = asObj(a && a.avatar);
  const emoji = AVATAR_EMOJI.indexOf(av.emoji) >= 0 ? av.emoji : DEFAULT_AVATAR.emoji;
  const color = hexColor(av.color) ? String(av.color).trim().toLowerCase() : DEFAULT_AVATAR.color;
  return { emoji: emoji, color: color };
}

function privacyOf(a) {
  const p = asObj(a && a.privacy);
  return { hideBalance: !!p.hideBalance, private: !!p.private };
}

function socialOf(a) {
  const s = asObj(a && a.social);
  return {
    followers: Math.max(0, Math.floor(num(s.followers))),
    following: Math.max(0, Math.floor(num(s.following)))
  };
}

async function readAccounts() {
  try {
    const v = await store().get('accounts', { type: 'json' });
    return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
  } catch (e) {
    globalThis.__deErr = String((e && e.message) || e);
    return {};
  }
}

async function writeAccounts(list) {
  await store().setJSON('accounts', list);
}

async function readEdges() {
  try {
    const v = await store().get('edges', { type: 'json' });
    return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
  } catch (e) {
    globalThis.__deErr = String((e && e.message) || e);
    return {};
  }
}

async function writeEdges(edges) {
  await store().setJSON('edges', edges);
}

/* ---------- рейтинг ---------- */

/* все публичные аккаунты (без privacy.private), по капиталу вниз */
function capitalRows(list, prices) {
  const rows = [];
  for (const k in list) {
    const a = list[k];
    if (!a || typeof a !== 'object') continue;
    if (privacyOf(a).private) continue;
    rows.push({ acc: a, cap: capitalOf(a, prices) });
  }
  rows.sort(function (x, y) { return y.cap - x.cap; });
  return rows;
}

function rankOf(list, acc, prices) {
  const rows = capitalRows(list, prices);
  for (let i = 0; i < rows.length; i++) if (rows[i].acc === acc) return i + 1;
  return null;
}

/* ---------- профиль ---------- */

function buildProfile(list, acc, isMe, now, prices) {
  const ex = exOf(acc);
  const nft = nftOf(acc);
  const cap = tidy(capitalOf(acc, prices));
  const pv = privacyOf(acc);
  const hidden = pv.hideBalance && !isMe;

  const profile = {
    nick: nickOf(acc),
    avatar: avatarOf(acc),
    bio: String(acc.bio || ''),
    created: acc.created || null,
    wallet: String(acc.wallet || ''),
    admin: !!acc.admin,
    social: socialOf(acc),
    stats: {
      capital: hidden ? null : cap,
      usdt: hidden ? null : ex.usdt,
      nft: nft.count,
      trades: ex.trades.length,
      trades7: trades7Of(acc, now),
      delta1: deltaOf(acc, cap, 'd1'),
      delta7: deltaOf(acc, cap, 'd7'),
      level: hidden ? null : levelOf(cap),
      rank: hidden ? null : rankOf(list, acc, prices)
    },
    privacy: pv,
    isMe: !!isMe
  };

  return {
    profile: profile,
    capital: cap,
    snapDirty: !ex.broken && snapOld(acc, now)
  };
}

async function routeProfile(m, body, u) {
  const list = await readAccounts();
  const now = Date.now();
  const prices = await marketPrices();       // капитал — по живым ценам

  if (m === 'GET') {
    const who = u.searchParams.get('nick') || u.searchParams.get('email') || '';
    const acc = findAcc(list, who);
    if (!acc) return fail('noacc', 404, 'Аккаунт не найден');

    const pass = String(u.searchParams.get('pass') || '');
    const isMe = !!pass && acc.pass === pass;
    const pv = privacyOf(acc);
    if (pv.private && !isMe) return fail('private', 403, 'Профиль закрыт');

    const out = buildProfile(list, acc, isMe, now, prices);
    if (out.snapDirty) {
      applySnap(acc, out.capital, now);
      try { await writeAccounts(list); } catch (e) { /* снимок не критичнее ответа */ }
    }
    return json({ ok: true, profile: out.profile });
  }

  /* POST — своё редактирование */
  if (!body) return fail('badreq', 400, 'Плохой запрос');
  const acc = findAcc(list, body.nick || body.email);
  if (!acc) return fail('noacc', 404, 'Аккаунт не найден');
  if (acc.pass !== String(body.pass || '')) return fail('badpass', 403, 'Неверный пароль');

  if (body.bio !== undefined && body.bio !== null) {
    acc.bio = cutText(body.bio, BIO_MAX);
  }
  if (body.avatar !== undefined && body.avatar !== null) {
    const av = asObj(body.avatar);
    const emoji = String(av.emoji || '');
    const color = String(av.color || '').trim();
    if (AVATAR_EMOJI.indexOf(emoji) < 0) {
      return fail('badavatar', 400, 'Недопустимая эмодзи аватара');
    }
    if (!hexColor(color)) {
      return fail('badavatar', 400, 'Цвет аватара — в формате #rrggbb');
    }
    acc.avatar = { emoji: emoji, color: color.toLowerCase() };
  }
  acc.updated = now;
  await writeAccounts(list);

  const out = buildProfile(list, acc, true, now, prices);
  if (out.snapDirty) {
    applySnap(acc, out.capital, now);
    try { await writeAccounts(list); } catch (e) { /* не критично */ }
  }
  return json({ ok: true, profile: out.profile });
}

/* ---------- подписки ---------- */

function countEdges(edges) {
  const followers = Object.create(null);
  const following = Object.create(null);
  for (const key in edges) {
    const i = key.indexOf('>');
    if (i < 1) continue;
    const from = key.slice(0, i);
    const to = key.slice(i + 1);
    if (!from || !to) continue;
    followers[to] = (followers[to] || 0) + 1;
    following[from] = (following[from] || 0) + 1;
  }
  return { followers: followers, following: following };
}

/* пересчёт счётчиков строго по edges, без инкрементов */
function applyCounts(acc, lc, counts) {
  if (!acc || !lc) return;
  acc.social = {
    followers: counts.followers[lc] || 0,
    following: counts.following[lc] || 0
  };
}

async function followAction(body, un) {
  if (!body) return fail('badreq', 400, 'Плохой запрос');
  const list = await readAccounts();
  const me = findAcc(list, body.nick || body.email);
  if (!me) return fail('noacc', 404, 'Аккаунт не найден');
  if (me.pass !== String(body.pass || '')) return fail('badpass', 403, 'Неверный пароль');

  const target = findAcc(list, body.target);
  if (!target) return fail('noacc', 404, 'Игрок не найден');
  if (target === me) return fail('self', 400, 'Нельзя подписаться на себя');

  const from = lcOf(me);
  const to = lcOf(target);
  if (!from || !to) return fail('badreq', 400, 'Плохой запрос');

  const edges = await readEdges();
  const key = from + '>' + to;

  if (un) {
    if (!edges[key]) return fail('notfollowing', 409, 'Ты не подписан на этого игрока');
    delete edges[key];
  } else {
    if (edges[key]) return fail('already', 409, 'Ты уже подписан на этого игрока');
    edges[key] = Date.now();
  }

  await writeEdges(edges);

  const counts = countEdges(edges);
  applyCounts(target, to, counts);
  applyCounts(me, from, counts);
  const now = Date.now();
  target.updated = now;
  me.updated = now;
  await writeAccounts(list);

  if (!un) {
    try { await pushEvent(nickOf(target, to), 'follow', '@' + nickOf(me, from) + ' подписался на @' + nickOf(target, to)); }
    catch (e) { /* лента не должна ломать подписку */ }
  }

  return json({ ok: true, followers: socialOf(target).followers, following: socialOf(me).following });
}

async function routeLinks(u, mode) {
  const list = await readAccounts();
  const acc = findAcc(list, u.searchParams.get('nick') || u.searchParams.get('email'));
  if (!acc) return fail('noacc', 404, 'Аккаунт не найден');

  const lc = lcOf(acc);
  const prices = await marketPrices();       // капитал в списке — по живым ценам
  const edges = await readEdges();
  const rows = [];

  for (const key in edges) {
    const i = key.indexOf('>');
    if (i < 1) continue;
    const from = key.slice(0, i);
    const to = key.slice(i + 1);
    if (mode === 'followers' ? to !== lc : from !== lc) continue;
    rows.push({ who: mode === 'followers' ? from : to, t: num(edges[key]) });
  }
  rows.sort(function (x, y) { return y.t - x.t; });

  const total = rows.length;
  let offset = Number(u.searchParams.get('offset'));
  if (!isFinite(offset) || offset < 0) offset = 0;
  offset = Math.floor(offset);

  const byLc = Object.create(null);
  for (const k in list) {
    const a = list[k];
    if (!a || typeof a !== 'object') continue;
    const l = lcOf(a);
    if (l && !byLc[l]) byLc[l] = a;
  }

  const out = [];
  for (const r of rows.slice(offset, offset + PAGE)) {
    const a = byLc[r.who];
    if (!a) continue;                        // аккаунт удалён — ребро пропускаем
    const pv = privacyOf(a);
    const hidden = pv.hideBalance || pv.private;
    out.push({
      nick: nickOf(a, r.who),
      avatar: avatarOf(a),
      followers: socialOf(a).followers,
      capital: hidden ? null : tidy(capitalOf(a, prices))
    });
  }

  return json({ ok: true, total: total, list: out });
}

/* ---------- лента ---------- */

async function routeFeed(u) {
  const list = await readAccounts();
  const who = String(u.searchParams.get('nick') || u.searchParams.get('email') || '').trim();

  let key = 'feed';
  if (who) {
    const acc = findAcc(list, who);
    const lc = acc ? lcOf(acc) : normNick(who);
    if (!lc) return json({ ok: true, list: [] });
    key = 'feed:' + lc;
  }

  let limit = Number(u.searchParams.get('limit'));
  if (!isFinite(limit) || limit <= 0) limit = 20;
  limit = Math.min(100, Math.floor(limit));

  let arr = [];
  try { arr = await store().get(key, { type: 'json' }); } catch (e) { arr = []; }
  if (!Array.isArray(arr)) arr = [];

  const out = arr.filter(function (x) {
    return x && typeof x === 'object' && !Array.isArray(x);
  }).slice(0, limit);

  return json({ ok: true, list: out });
}

/* ---------- рейтинг ---------- */

async function routeTop(u) {
  const byRaw = String(u.searchParams.get('by') || 'capital').toLowerCase();
  if (byRaw !== 'capital' && byRaw !== 'followers' && byRaw !== 'trades') {
    return fail('badby', 400, 'Неизвестный рейтинг');
  }
  const by = byRaw;

  const list = await readAccounts();
  const now = Date.now();
  const prices = await marketPrices();       // рейтинг капитала — по живым ценам
  const rows = [];

  for (const k in list) {
    const a = list[k];
    if (!a || typeof a !== 'object') continue;
    const pv = privacyOf(a);
    if (pv.private) continue;                        // закрытые профили не рейтингуем
    const cap = tidy(capitalOf(a, prices));
    if (by === 'capital' && pv.hideBalance) continue; // скрытый баланс — вне рейтинга капитала
    rows.push({
      acc: a,
      nick: nickOf(a, k),
      avatar: avatarOf(a),
      capRaw: cap,
      capital: pv.hideBalance ? null : cap,
      followers: socialOf(a).followers,
      trades7: trades7Of(a, now),
      delta7: deltaOf(a, cap, 'd7'),
      level: pv.hideBalance ? null : levelOf(cap)
    });
  }

  rows.sort(function (x, y) {
    let d;
    if (by === 'capital') d = y.capRaw - x.capRaw;
    else if (by === 'followers') d = y.followers - x.followers;
    else d = y.trades7 - x.trades7;
    if (d) return d;
    return x.nick.localeCompare(y.nick);
  });

  const out = rows.slice(0, TOP_MAX).map(function (r, i) {
    return {
      rank: i + 1,
      nick: r.nick,
      avatar: r.avatar,
      capital: r.capital,
      followers: r.followers,
      delta7: r.delta7,
      level: r.level
    };
  });

  let me = null;
  const who = String(u.searchParams.get('nick') || u.searchParams.get('email') || '').trim();
  if (who) {
    const acc = findAcc(list, who);
    if (acc) {
      let idx = -1;
      for (let i = 0; i < rows.length; i++) if (rows[i].acc === acc) { idx = i; break; }
      const pv = privacyOf(acc);
      const closed = pv.hideBalance || pv.private;
      me = {
        rank: idx >= 0 ? idx + 1 : null,
        capital: closed ? null : tidy(capitalOf(acc, prices))
      };
    }
  }

  return json({ ok: true, list: out, me: me });
}

/* ---------- приватность ---------- */

async function routePrivacy(body) {
  if (!body) return fail('badreq', 400, 'Плохой запрос');
  const list = await readAccounts();
  const acc = findAcc(list, body.nick || body.email);
  if (!acc) return fail('noacc', 404, 'Аккаунт не найден');
  if (acc.pass !== String(body.pass || '')) return fail('badpass', 403, 'Неверный пароль');

  const pv = privacyOf(acc);
  if (body.hideBalance !== undefined) pv.hideBalance = bool(body.hideBalance);
  if (body.private !== undefined) pv.private = bool(body.private);
  acc.privacy = pv;
  acc.updated = Date.now();
  await writeAccounts(list);

  return json({ ok: true, privacy: pv });
}

/* ---------- событие в ленту (для api.js и внутренних ручек) ---------- */

/* ---------- для ботов: те же подписки, что у людей ----------
   Экспортируем доступ к edges и пересчёту счётчиков, чтобы рантайм ботов
   не держал вторую копию формата и не разъезжались счётчики. */
export async function readSocialEdges() { return readEdges(); }
export async function writeSocialEdges(edges) { return writeEdges(edges); }
export function socialCounts(edges) { return countEdges(edges); }
export function applySocialCounts(acc, lc, counts) { applyCounts(acc, lc, counts); }

export async function pushEvent(nick, type, text, extra) {
  try {
    const name = String(nick === null || nick === undefined ? '' : nick).trim();
    const lc = normNick(name);
    if (!name || !lc) return false;

    const now = Date.now();
    const ev = {
      id: 'e' + now.toString(36) + Math.random().toString(36).slice(2, 7),
      t: now,
      nick: name,
      lc: lc,
      type: String(type || 'milestone'),
      text: cutText(text, 200)
    };
    const ex = asObj(extra);
    if (ex.money !== undefined && ex.money !== null && isFinite(Number(ex.money))) {
      ev.money = Number(ex.money);
    }
    if (ex.sym !== undefined && ex.sym !== null && String(ex.sym)) {
      ev.sym = String(ex.sym).toUpperCase();
    }

    const s = store();
    let globalArr = [];
    let userArr = [];
    try { globalArr = await s.get('feed', { type: 'json' }); } catch (e) { globalArr = []; }
    if (!Array.isArray(globalArr)) globalArr = [];
    try { userArr = await s.get('feed:' + lc, { type: 'json' }); } catch (e) { userArr = []; }
    if (!Array.isArray(userArr)) userArr = [];

    globalArr.unshift(ev);
    if (globalArr.length > FEED_MAX) globalArr.length = FEED_MAX;
    userArr.unshift(ev);
    if (userArr.length > USER_FEED_MAX) userArr.length = USER_FEED_MAX;

    await s.setJSON('feed', globalArr);
    await s.setJSON('feed:' + lc, userArr);
    return true;
  } catch (e) {
    return false;                            // лента не должна ломать основную ручку
  }
}

/* ---------- маршрутизация ---------- */

export async function handleSocial(req, p, body, u) {
  if (!req || !p) return null;
  const path = String(p).replace(/\/+$/, '') || '/';
  if (ROUTES.indexOf(path) < 0) return null;

  const m = String(req.method || 'GET').toUpperCase();

  try {
    if (path === '/api/profile') {
      if (m !== 'GET' && m !== 'POST') return null;
      return await routeProfile(m, body, u);
    }
    if (path === '/api/follow') {
      return m === 'POST' ? await followAction(body, false) : null;
    }
    if (path === '/api/unfollow') {
      return m === 'POST' ? await followAction(body, true) : null;
    }
    if (path === '/api/followers' || path === '/api/following') {
      if (m !== 'GET') return null;
      return await routeLinks(u, path === '/api/followers' ? 'followers' : 'following');
    }
    if (path === '/api/feed') {
      return m === 'GET' ? await routeFeed(u) : null;
    }
    if (path === '/api/top') {
      return m === 'GET' ? await routeTop(u) : null;
    }
    if (path === '/api/privacy') {
      return m === 'POST' ? await routePrivacy(body) : null;
    }
    return null;
  } catch (e) {
    return fail('server', 500, 'Внутренняя ошибка сервера');
  }
}
