/* ============================================================================
   DE — API аккаунтов на Netlify Functions + Netlify Blobs (хранилище).
   Постоянный адрес, твой компьютер больше не нужен.
   ============================================================================ */

import { getStore } from '@netlify/blobs';
import { MARKET_PRICES } from './market-coins.js';
import { handleSocial, pushEvent } from './social.js';
import { handleNft } from './nft-market.js';
import { handleMarket, setPricesAny } from './market-prices.js';
import { runLive, runTick, seedBots, seedFollows, boostBots, decorateBots } from './bots-tick.js';

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

function norm(email) { return String(email || '').trim().toLowerCase(); }

/* ---------- НИКИ ---------- */
const NICK_RE = /^[a-zа-яё0-9][a-zа-яё0-9_-]{2,15}$/i;
const NICK_RESERVED = new Set(['admin', 'root', 'system', 'support', 'de', 'exchange', 'bot', 'api',
  'test', 'moderator', 'mod', 'owner', 'null', 'undefined', 'вася', 'кент']);
const OWNER_NICKS = new Set(['knote6037']);

function normNick(s) { return String(s || '').trim().toLowerCase(); }

/* «kent.vasya@rework.mail» → «kent_vasya» (для миграции старых аккаунтов) */
function nickFromEmail(email) {
  let n = String(email || '').split('@')[0].replace(/[^a-zа-яё0-9_-]/gi, '_').slice(0, 16);
  if (!n) n = 'user';
  return n;
}

/* ищем по нику, по старой почте, по ключу — что найдётся */
function findAcc(list, who) {
  const lc = normNick(who);
  if (!lc) return null;
  if (list[lc]) return list[lc];
  for (const k in list) {
    const a = list[k];
    if (!a || typeof a !== 'object') continue;
    if (normNick(a.nick_lc) === lc) return a;
    if (normNick(a.nick) === lc) return a;
    if (normNick(a.email) === lc) return a;
    if (normNick(a.legacy_email) === lc) return a;
    if (k === lc) return a;
  }
  return null;
}

function nickTaken(list, nick, self) {
  const lc = normNick(nick);
  for (const k in list) {
    const a = list[k];
    if (!a || typeof a !== 'object' || a === self) continue;
    if (k === lc) return true;
    if (normNick(a.nick_lc) === lc || normNick(a.nick) === lc) return true;
    if (normNick(a.email) === lc || normNick(a.legacy_email) === lc) return true;
  }
  return false;
}

/* кошелёк из ника: 8 цифр, детерминированно, с обходом занятых */
function walletFromNick(nick) {
  const t = 'de-wallet|' + normNick(nick);
  let h = 2166136261;
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return String(h % 100000000).padStart(8, '0');
}
function freeWallet(list, nick) {
  let w = walletFromNick(nick);
  for (let i = 0; i < 100; i++) {
    let busy = false;
    for (const k in list) if (list[k] && String(list[k].wallet) === w) { busy = true; break; }
    if (!busy) return w;
    w = String((Number(w) + 1) % 100000000).padStart(8, '0');
  }
  return String(Math.floor(Math.random() * 100000000)).padStart(8, '0');
}

function nickProblem(nick) {
  const n = String(nick || '').trim();
  if (!n) return 'nick_bad';
  if (/^\d{8}$/.test(n)) return 'nick_wallet';
  if (!NICK_RE.test(n)) return 'nick_bad';
  if (NICK_RESERVED.has(normNick(n))) return 'nick_reserved';
  return null;
}

function newAccount(list, nick, pass, extra) {
  const lc = normNick(nick);
  const now = Date.now();
  return Object.assign({
    nick: nick,
    nick_lc: lc,
    pass: String(pass || ''),
    wallet: freeWallet(list, lc),
    admin: OWNER_NICKS.has(lc),
    created: now,
    updated: now,
    last_seen: now,
    bio: '',
    avatar: { emoji: '🐺', color: '#c0561b' },
    privacy: { hideBalance: false, private: false },
    social: { followers: 0, following: 0 },
    rec: '',
    state: null
  }, extra || {});
}

function publicAcc(a) {
  return {
    nick: a.nick || a.email || '',
    email: a.legacy_email || a.email || '',
    wallet: a.wallet,
    admin: !!a.admin,
    created: a.created,
    updated: a.updated
  };
}

async function readAll() {
  try {
    const v = await getStore({ name: 'de', consistency: 'strong' }).get('accounts', { type: 'json' });
    return (v && typeof v === 'object') ? v : {};
  } catch (e) { globalThis.__deErr = String(e && e.message || e); return {}; }
}

async function writeAll(list) {
  await getStore({ name: 'de', consistency: 'strong' }).setJSON('accounts', list);
}

export default async (req) => {
  const u = new URL(req.url);

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  /* путь после /.netlify/functions/api — либо /api/... при прямом вызове */
  let p = u.pathname.replace(/^\/\.netlify\/functions\/api/, '');
  if (!p.startsWith('/')) p = '/' + p;
  if (p === '/' ) p = '/health';

  let body = null;
  if (req.method === 'POST') {
    try { body = JSON.parse(await req.text()); } catch (e) { body = null; }
  }

  if (p === '/health') {
    const list = await readAll();
    return json({ ok: true, accounts: Object.keys(list).length, where: 'netlify', err: globalThis.__deErr || null });
  }

  if (p === '/api/register' && req.method === 'POST') {
    if (!body) return json({ err: 'плохой запрос' }, 400);
    const list = await readAll();

    /* новый клиент шлёт nick, старый — email: ник выводим из почты */
    let nick = String(body.nick || '').trim();
    if (!nick && body.email) nick = nickFromEmail(body.email);

    const why = nickProblem(nick);
    if (why === 'nick_bad') return json({ err: 'nick_bad', msg: 'Ник: 3–16 символов, буквы, цифры, _ и -' }, 400);
    if (why === 'nick_wallet') return json({ err: 'nick_bad', msg: 'Ник не может быть из 8 цифр — это номер кошелька' }, 400);
    if (why === 'nick_reserved') return json({ err: 'nick_reserved', msg: 'Этот ник занят системой' }, 400);
    if (nickTaken(list, nick)) {
      return json({ err: 'nick_taken', msg: 'Ник «' + nick + '» уже занят. Попробуй другой.' }, 409);
    }

    const acc = newAccount(list, nick, body.pass);
    if (body.rec) acc.rec = String(body.rec);
    if (body.email) acc.legacy_email = norm(body.email);
    list[acc.nick_lc] = acc;
    await writeAll(list);
    try { await pushEvent(acc.nick, 'join', 'присоединился к бирже'); } catch (e) {}
    return json({ ok: true, acc: publicAcc(acc), nick: acc.nick, wallet: acc.wallet });
  }

  if (p === '/api/login' && req.method === 'POST') {
    if (!body) return json({ err: 'плохой запрос' }, 400);
    const list = await readAll();
    const acc = findAcc(list, body.login || body.nick || body.email);
    if (!acc) return json({ err: 'notfound', msg: 'Такого ника нет — переключись на «Регистрация»' }, 404);
    if (acc.pass !== String(body.pass || '')) return json({ err: 'badpass', msg: 'Неверный пароль' }, 403);
    return json({ ok: true, acc: publicAcc(acc) });
  }

  if (p === '/api/has') {
    const list = await readAll();
    return json({ ok: true, exists: !!findAcc(list, u.searchParams.get('nick') || u.searchParams.get('email')) });
  }

  if (p === '/api/state' && req.method === 'GET') {
    const list = await readAll();
    const acc = findAcc(list, u.searchParams.get('nick') || u.searchParams.get('email'));
    if (!acc) return json({ err: 'notfound' }, 404);
    if (acc.pass !== String(u.searchParams.get('pass') || '')) return json({ err: 'badpass' }, 403);
    return json({ ok: true, state: acc.state || null, updated: acc.updated });
  }

  if (p === '/api/state' && req.method === 'POST') {
    if (!body) return json({ err: 'плохой запрос' }, 400);
    const list = await readAll();
    const acc = findAcc(list, body.nick || body.email);
    if (!acc) return json({ err: 'notfound' }, 404);
    if (acc.pass !== String(body.pass || '')) return json({ err: 'badpass' }, 403);
    const now = Date.now();
    if (body.state && typeof body.state === 'object') acc.state = body.state;
    acc.updated = now;
    acc.last_seen = now;
    await writeAll(list);
    return json({ ok: true, updated: now });
  }

  if (p === '/api/users' && req.method === 'POST') {
    if (!body) return json({ err: 'плохой запрос' }, 400);
    const list = await readAll();
    const admin = findAcc(list, body.nick || body.email);
    if (!admin || !admin.admin) return json({ err: 'notadmin' }, 403);
    if (admin.pass !== String(body.pass || '')) return json({ err: 'badpass' }, 403);
    const out = Object.keys(list).map(function (k) {
      const a = list[k];
      return { nick: a.nick || a.email || k, email: a.legacy_email || a.email || '', wallet: a.wallet, admin: !!a.admin, created: a.created, updated: a.updated, lastSeen: a.last_seen || null };
    });
    return json({ ok: true, list: out });
  }

  if (p === '/api/ping' && req.method === 'POST') {
    if (body) {
      const list = await readAll();
      const acc = findAcc(list, body.nick || body.email);
      if (acc && acc.pass === String(body.pass || '')) {
        acc.last_seen = Date.now();
        await writeAll(list);
      }
    }
    return json({ ok: true });
  }

  if (p === '/api/delete' && req.method === 'POST') {
    if (!body) return json({ err: 'плохой запрос' }, 400);
    const list = await readAll();
    const admin = findAcc(list, body.nick || body.email);
    if (!admin || !admin.admin) return json({ err: 'notadmin' }, 403);
    if (admin.pass !== String(body.pass || '')) return json({ err: 'badpass' }, 403);
    const victim = findAcc(list, body.target);
    if (!victim) return json({ err: 'нет такого аккаунта' }, 404);
    if (victim === admin) return json({ err: 'нельзя удалить себя' }, 400);
    for (const k in list) if (list[k] === victim) delete list[k];
    await writeAll(list);
    return json({ ok: true });
  }

  /* ---- поиск получателя по номеру кошелька ---- */
  if (p === '/api/lookup' && req.method === 'GET') {
    const list = await readAll();
    const w = String(u.searchParams.get('wallet') || '').replace(/\D/g, '');
    if (w.length !== 8) return json({ ok: true, found: false });
    let hit = null;
    for (const k in list) {
      if (list[k] && String(list[k].wallet) === w) { hit = list[k]; break; }
    }
    if (!hit) return json({ ok: true, found: false });
    if (hit.nick) return json({ ok: true, found: true, masked: hit.nick, nick: hit.nick });
    const parts = String(hit.email || '').split('@');
    const name = parts[0] || '';
    const masked = (name.charAt(0) || '?') + '***' + (name.length > 1 ? name.charAt(name.length - 1) : '') +
                   '@' + (parts[1] || '');
    return json({ ok: true, found: true, masked: masked });
  }

  /* ---- прямой перевод по номеру кошелька ---- */
  if (p === '/api/send' && req.method === 'POST') {
    if (!body) return json({ err: 'плохой запрос' }, 400);
    const list = await readAll();
    const from = findAcc(list, body.nick || body.email);
    if (!from) return json({ err: 'notfound' }, 404);
    if (from.pass !== String(body.pass || '')) return json({ err: 'badpass' }, 403);

    /* получателя ищем по НОМЕРУ КОШЕЛЬКА — как на настоящей бирже */
    const w = String(body.toWallet || '').replace(/\D/g, '');
    if (w.length !== 8) return json({ err: 'badwallet', msg: 'Номер кошелька — ровно 8 цифр.' }, 400);

    let to = null;
    for (const k in list) {
      if (list[k] && String(list[k].wallet) === w) { to = list[k]; break; }
    }
    if (!to) return json({ err: 'noacc', msg: 'Кошелёк ' + w + ' не найден на бирже.' }, 404);
    if (to === from) {
      return json({ err: 'self', msg: 'Это твой собственный кошелёк.' }, 400);
    }

    const key = String(body.key || 'USDT').toUpperCase();
    const amt = Number(body.amount) || 0;
    let net = Number(body.net);
    if (!isFinite(net) || net < 0) net = amt;
    if (!(amt > 0)) return json({ err: 'bad', msg: 'Сумма должна быть больше нуля.' }, 400);

    const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch (e) { return null; } };
    const blank = () => ({ v: 3, usdt: 0, amounts: {}, trades: [] });
    const getAmt = (ex) => key === 'USDT' ? (Number(ex.usdt) || 0) : (Number((ex.amounts || {})[key]) || 0);
    const setAmt = (ex, v) => {
      if (key === 'USDT') ex.usdt = v;
      else { ex.amounts = ex.amounts || {}; ex.amounts[key] = v; }
    };

    const fs = from.state || {};
    const fex = parse(fs.ex) || blank();
    const have = getAmt(fex);
    if (have < amt) {
      return json({ err: 'nomoney', have: have, msg: 'Не хватает средств: есть ' + have + ' ' + key }, 400);
    }
    setAmt(fex, have - amt);
    fex.trades = Array.isArray(fex.trades) ? fex.trades : [];
    fex.trades.unshift({ t: Date.now(), side: 'SEND', sym: key, qty: amt, total: amt, to: to.nick || to.email });
    if (fex.trades.length > 200) fex.trades.length = 200;
    from.state = Object.assign({}, fs, { ex: JSON.stringify(fex) });
    from.updated = Date.now();

    const ts = to.state || {};
    const tex = parse(ts.ex) || blank();
    setAmt(tex, getAmt(tex) + net);
    tex.trades = Array.isArray(tex.trades) ? tex.trades : [];
    tex.trades.unshift({ t: Date.now(), side: 'RECV', sym: key, qty: net, total: net, from: from.nick || from.email });
    if (tex.trades.length > 200) tex.trades.length = 200;
    to.state = Object.assign({}, ts, { ex: JSON.stringify(tex) });
    to.updated = Date.now();

    await writeAll(list);
    try {
      await pushEvent(from.nick, 'transfer_out', 'отправил ' + amt + ' ' + key + ' → @' + (to.nick || to.email),
        { money: amt, sym: key });
      await pushEvent(to.nick, 'transfer_in', 'получил ' + net + ' ' + key + ' от @' + (from.nick || from.email),
        { money: net, sym: key });
    } catch (e) {}
    return json({ ok: true, to: to.nick || to.email, sent: amt, got: net, key: key });
  }

  /* ---- смена кошелька: сервер должен узнать о ней сразу ----
     Иначе он держит старый номер, и переводы по кошельку уходят не туда.
     Здесь же проверяем уникальность: один номер — один аккаунт. */
  if (p === '/api/wallet' && req.method === 'POST') {
    if (!body) return json({ err: 'плохой запрос' }, 400);
    const list = await readAll();
    const acc = findAcc(list, body.nick || body.email);
    if (!acc) return json({ err: 'notfound' }, 404);
    if (acc.pass !== String(body.pass || '')) return json({ err: 'badpass' }, 403);

    const w = String(body.wallet || '').replace(/\D/g, '');
    if (w.length !== 8) return json({ err: 'badwallet', msg: 'Кошелёк — ровно 8 цифр.' }, 400);
    if (String(acc.wallet) === w) return json({ ok: true, wallet: w });

    for (const k in list) {
      if (!list[k]) continue;
      if (list[k] === acc) continue;
      if (String(list[k].wallet) === w) {
        return json({ err: 'taken', msg: 'Кошелёк ' + w + ' уже занят другим игроком.' }, 409);
      }
    }
    acc.wallet = w;
    acc.updated = Date.now();
    await writeAll(list);
    return json({ ok: true, wallet: w });
  }

  /* ---- блатные номера: список знают все, менять может только владелец ---- */
  if (p === '/api/elite' && req.method === 'GET') {
    let list = [];
    try { list = (await getStore({ name: 'de', consistency: 'strong' }).get('elite', { type: 'json' })) || []; }
    catch (e) { list = []; }
    if (!Array.isArray(list)) list = [];
    return json({ ok: true, list: list });
  }

  if (p === '/api/elite' && req.method === 'POST') {
    if (!body) return json({ err: 'плохой запрос' }, 400);
    const accs = await readAll();
    const admin = findAcc(accs, body.nick || body.email);
    if (!admin || !admin.admin) return json({ err: 'notadmin' }, 403);
    if (admin.pass !== String(body.pass || '')) return json({ err: 'badpass' }, 403);

    const w = String(body.wallet || '').replace(/\D/g, '');
    if (w.length !== 8) return json({ err: 'badwallet' }, 400);

    const store = getStore({ name: 'de', consistency: 'strong' });
    let list = [];
    try { list = (await store.get('elite', { type: 'json' })) || []; } catch (e) { list = []; }
    if (!Array.isArray(list)) list = [];

    const has = list.indexOf(w) >= 0;
    if (body.on && !has) list.push(w);
    if (!body.on && has) list = list.filter((x) => x !== w);
    await store.setJSON('elite', list);
    return json({ ok: true, list: list });
  }

  /* ---- занятые номера: реестр на сервере, а не в браузере ----
     Иначе номер, купленный на телефоне, снова появлялся на витрине на ПК. */
  if (p === '/api/sold' && req.method === 'GET') {
    let list = [];
    try { list = (await getStore({ name: 'de', consistency: 'strong' }).get('sold', { type: 'json' })) || []; }
    catch (e) { list = []; }
    if (!Array.isArray(list)) list = [];
    return json({ ok: true, list: list });
  }

  if (p === '/api/sold' && req.method === 'POST') {
    if (!body) return json({ err: 'плохой запрос' }, 400);
    const accs = await readAll();
    const me = findAcc(accs, body.nick || body.email);
    if (!me) return json({ err: 'notfound' }, 404);
    if (me.pass !== String(body.pass || '')) return json({ err: 'badpass' }, 403);
    const w = String(body.wallet || '').replace(/\D/g, '');
    if (w.length !== 8) return json({ err: 'badwallet' }, 400);

    const store = getStore({ name: 'de', consistency: 'strong' });
    let list = [];
    try { list = (await store.get('sold', { type: 'json' })) || []; } catch (e) { list = []; }
    if (!Array.isArray(list)) list = [];
    if (list.indexOf(w) < 0) {
      list.push(w);
      await store.setJSON('sold', list);
    }
    return json({ ok: true, list: list });
  }

  /* ---- ВЫДАЧА ВЛАДЕЛЬЦЕМ: валюта, номер, NFT ----
     Только владелец. Цель — своя почта, чужая почта или номер кошелька. */
  if (p === '/api/grant' && req.method === 'POST') {
    if (!body) return json({ err: 'плохой запрос' }, 400);
    const list = await readAll();
    const admin = findAcc(list, body.nick || body.email);
    if (!admin || !admin.admin) return json({ err: 'notadmin', msg: 'Только владелец биржи может выдавать.' }, 403);
    if (admin.pass !== String(body.pass || '')) return json({ err: 'badpass' }, 403);

    let to = null;
    if (body.targetWallet) {
      const w = String(body.targetWallet).replace(/\D/g, '');
      for (const k in list) if (list[k] && String(list[k].wallet) === w) { to = list[k]; break; }
    } else if (body.target) {
      to = findAcc(list, body.target);
    } else {
      to = admin;                       // себе
    }
    if (!to) return json({ err: 'noacc', msg: 'Получатель не найден.' }, 404);

    const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch (e) { return null; } };
    const st = to.state || {};
    const kind = String(body.kind || 'currency');

    if (kind === 'currency') {
      const key = String(body.key || 'USDT').toUpperCase();
      const amt = Number(body.amount) || 0;
      if (!(amt > 0)) return json({ err: 'bad', msg: 'Сумма должна быть больше нуля.' }, 400);
      const ex = parse(st.ex) || { v: 3, usdt: 0, amounts: {}, trades: [] };
      if (key === 'USDT') ex.usdt = (Number(ex.usdt) || 0) + amt;
      else { ex.amounts = ex.amounts || {}; ex.amounts[key] = (Number(ex.amounts[key]) || 0) + amt; }
      ex.trades = Array.isArray(ex.trades) ? ex.trades : [];
      ex.trades.unshift({ t: Date.now(), side: 'RECV', sym: key, qty: amt, total: amt, from: 'ВЛАДЕЛЕЦ' });
      if (ex.trades.length > 200) ex.trades.length = 200;
      to.state = Object.assign({}, st, { ex: JSON.stringify(ex) });
    } else if (kind === 'number') {
      const w = String(body.wallet || '').replace(/\D/g, '');
      if (w.length !== 8) return json({ err: 'badwallet', msg: 'Номер — ровно 8 цифр.' }, 400);
      const ext = parse(st.ext) || { v: 1 };
      ext.numbers = Array.isArray(ext.numbers) ? ext.numbers : [];
      if (ext.numbers.indexOf(w) < 0) ext.numbers.push(w);
      to.state = Object.assign({}, st, { ext: JSON.stringify(ext) });
      const store = getStore({ name: 'de', consistency: 'strong' });
      let sold = [];
      try { sold = (await store.get('sold', { type: 'json' })) || []; } catch (e) { sold = []; }
      if (!Array.isArray(sold)) sold = [];
      if (sold.indexOf(w) < 0) { sold.push(w); await store.setJSON('sold', sold); }
    } else if (kind === 'nft') {
      const model = String(body.model || 'pepe');
      const aura = String(body.aura || 'none');
      const count = Math.max(1, Math.min(50, Number(body.count) || 1));
      const nft = parse(st.nft) || { items: [], opened: 0 };
      nft.items = Array.isArray(nft.items) ? nft.items : [];
      const mult = { none: 1, common: 1, uncommon: 1.35, rare: 2, epic: 8, legendary: 400 }[aura] || 1;
      const base = { pepe: 150000, watch: 80000, locket: 70000, cat: 60000, bag: 50000,
                     cap: 35000, gem: 25000, peach: 15000, ring: 8000, oscar: 3000 }[model] || 1000;
      for (let i = 0; i < count; i++) {
        nft.items.push({
          id: 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
          model: model, aura: aura, attr: null, mult: mult,
          value: Math.round(base * mult), price: 0, seller: 'ВЛАДЕЛЕЦ', t: Date.now()
        });
      }
      to.state = Object.assign({}, st, { nft: JSON.stringify(nft) });
    } else {
      return json({ err: 'badkind' }, 400);
    }

    to.updated = Date.now();
    await writeAll(list);
    return json({ ok: true, to: to.nick || to.email, wallet: to.wallet, kind: kind });
  }

  /* ---- передача NFT по номеру кошелька ---- */
  if (p === '/api/nft-send' && req.method === 'POST') {
    if (!body) return json({ err: 'плохой запрос' }, 400);
    const list = await readAll();
    const from = findAcc(list, body.nick || body.email);
    if (!from) return json({ err: 'notfound' }, 404);
    if (from.pass !== String(body.pass || '')) return json({ err: 'badpass' }, 403);

    const w = String(body.toWallet || '').replace(/\D/g, '');
    if (w.length !== 8) return json({ err: 'badwallet', msg: 'Номер кошелька — ровно 8 цифр.' }, 400);
    let to = null;
    for (const k in list) if (list[k] && String(list[k].wallet) === w) { to = list[k]; break; }
    if (!to) return json({ err: 'noacc', msg: 'Кошелёк ' + w + ' не найден.' }, 404);
    if (to === from) return json({ err: 'self', msg: 'Это твой собственный кошелёк.' }, 400);

    const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch (e) { return null; } };
    const fs = from.state || {};
    const fx = parse(fs.nft) || { items: [], opened: 0 };
    fx.items = Array.isArray(fx.items) ? fx.items : [];
    const idx = fx.items.findIndex((x) => x && x.id === body.nftId);
    if (idx < 0) return json({ err: 'nonft', msg: 'Такого подарка у тебя нет.' }, 404);
    const item = fx.items.splice(idx, 1)[0];

    const ts = to.state || {};
    const tx = parse(ts.nft) || { items: [], opened: 0 };
    tx.items = Array.isArray(tx.items) ? tx.items : [];
    item.from = from.nick || from.email;
    item.t = Date.now();
    tx.items.unshift(item);

    from.state = Object.assign({}, fs, { nft: JSON.stringify(fx) });
    to.state = Object.assign({}, ts, { nft: JSON.stringify(tx) });
    from.updated = Date.now();
    to.updated = Date.now();
    await writeAll(list);
    try {
      await pushEvent(from.nick, 'nft_out', 'подарил NFT → @' + (to.nick || to.email));
      await pushEvent(to.nick, 'nft_in', 'получил NFT от @' + (from.nick || from.email));
    } catch (e) {}
    return json({ ok: true, to: to.nick || to.email, model: item.model, aura: item.aura });
  }

  /* ---------- ПУБЛИЧНЫЕ ПРОФИЛИ ИГРОКОВ ---------- */
  function deMask(email) {
    const s = String(email || '');
    const at = s.indexOf('@');
    if (at < 1) return '***';
    const name = s.slice(0, at);
    return name[0] + '***' + (name.length > 1 ? name[name.length - 1] : '') + s.slice(at);
  }

  function deParse(v, fallback) {
    if (v === null || v === undefined || v === '') return fallback;
    if (typeof v === 'object') return v;
    try { return JSON.parse(v); } catch (e) { return fallback; }
  }

  function dePublicStats(acc) {
    const st = deParse(acc.state, {}) || {};
    const ex = deParse(st.ex, {}) || {};
    const nft = deParse(st.nft, {}) || {};
    const amounts = ex.amounts && typeof ex.amounts === 'object' ? ex.amounts : {};
    return {
      usdt: typeof ex.usdt === 'number' ? ex.usdt : 0,
      amounts: amounts,
      nft: Array.isArray(nft.items) ? nft.items.length : 0,
      trades: Array.isArray(ex.trades) ? ex.trades.length : 0,
      assets: 0
    };
  }

  function dePlayer(acc) {
    const stats = dePublicStats(acc);
    return {
      wallet: acc.wallet || '',
      nick: acc.nick || '',
      email: deMask(acc.legacy_email || acc.email || ''),
      created: acc.created || null,
      lastSeen: acc.last_seen || null,
      admin: !!acc.admin,
      stats: stats
    };
  }

  if (p === '/api/players') {
    const list = await readAll();
    const out = Object.keys(list)
      .map((k) => list[k])
      .filter((a) => a && a.wallet && !a.hidden)
      .map(dePlayer)
      .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
    return json({ ok: true, players: out });
  }

  /* ---- смена ника ---- */
  if (p === '/api/nick' && req.method === 'POST') {
    if (!body) return json({ err: 'плохой запрос' }, 400);
    const list = await readAll();
    const me = findAcc(list, body.nick || body.email);
    if (!me) return json({ err: 'notfound' }, 404);
    if (me.pass !== String(body.pass || '')) return json({ err: 'badpass' }, 403);

    const next = String(body.next || '').trim();
    const why = nickProblem(next);
    if (why) return json({ err: why, msg: why === 'nick_reserved' ? 'Этот ник занят системой' : 'Ник: 3–16 символов, буквы, цифры, _ и -' }, 400);
    if (nickTaken(list, next, me)) return json({ err: 'nick_taken', msg: 'Ник «' + next + '» уже занят' }, 409);
    const week = 7 * 24 * 60 * 60 * 1000;
    if (me.nick_changed && Date.now() - me.nick_changed < week) {
      return json({ err: 'too_often', msg: 'Ник можно менять раз в 7 дней' }, 429);
    }

    let oldKey = null;
    for (const k in list) if (list[k] === me) { oldKey = k; break; }
    const prev = me.nick;
    me.nick = next;
    me.nick_lc = normNick(next);
    me.nick_changed = Date.now();
    me.updated = Date.now();
    if (oldKey && oldKey !== me.nick_lc) delete list[oldKey];
    list[me.nick_lc] = me;
    await writeAll(list);
    return json({ ok: true, nick: me.nick, prev: prev, wallet: me.wallet });
  }

  /* ---- восстановление по коду ---- */
  if (p === '/api/recover' && req.method === 'POST') {
    if (!body) return json({ err: 'плохой запрос' }, 400);
    const list = await readAll();
    const me = findAcc(list, body.nick || body.login || body.email);
    if (!me) return json({ err: 'notfound' }, 404);
    if (!me.rec) return json({ err: 'nocode', msg: 'У этого аккаунта нет кода восстановления' }, 400);
    if (me.rec !== String(body.code || '')) return json({ err: 'badcode', msg: 'Код не подошёл' }, 403);
    me.pass = String(body.newPass || '');
    me.rec = String(body.rec || '');
    me.updated = Date.now();
    await writeAll(list);
    return json({ ok: true, nick: me.nick });
  }

  /* ---- одноразовая миграция: ключи accounts → ник ---- */
  if (p === '/api/admin/migrate' && req.method === 'POST') {
    if (!body) return json({ err: 'плохой запрос' }, 400);
    const list = await readAll();
    const admin = findAcc(list, body.nick || body.email);
    if (!admin || !admin.admin) return json({ err: 'notadmin' }, 403);
    if (admin.pass !== String(body.pass || '')) return json({ err: 'badpass' }, 403);

    const next = {};
    const used = new Set();
    const report = [];
    const keys = Object.keys(list);

    /* сначала уже мигрированные — их ники резервируем как есть */
    for (const k of keys) {
      const a = list[k];
      if (a && a.nick_lc && a.nick) { used.add(a.nick_lc); next[a.nick_lc] = a; }
    }
    for (const k of keys) {
      const a = list[k];
      if (!a || typeof a !== 'object') continue;
      if (a.nick_lc && a.nick && next[a.nick_lc] === a) continue;

      const email = a.email || (k.indexOf('@') >= 0 ? k : '');
      let nick = a.nick || nickFromEmail(email || k);
      let lc = normNick(nick);
      let i = 2;
      while (used.has(lc)) { nick = nick.slice(0, 14) + '_' + i; lc = normNick(nick); i++; }
      used.add(lc);

      a.nick = nick;
      a.nick_lc = lc;
      if (email) a.legacy_email = norm(email);
      if (!a.social) a.social = { followers: 0, following: 0 };
      next[lc] = a;
      report.push({ from: k, nick: nick, wallet: a.wallet });
    }
    await writeAll(next);
    return json({ ok: true, moved: report.length, accounts: Object.keys(next).length, report: report });
  }

  const social = await handleSocial(req, p, body, u);
  if (social) return social;

  /* ---- витрина профиля: квартира, ювелирка на себе, номера на стендах ---- */
  if (p === '/api/showcase') {
    const list = await readAll();

    if (req.method === 'GET') {
      const acc = findAcc(list, u.searchParams.get('nick') || u.searchParams.get('email'));
      if (!acc) return json({ ok: false, err: 'noacc', msg: 'Игрок не найден' }, 404);
      return json({ ok: true, show: acc.show || { home: null, wear: [], stands: [] } });
    }

    if (req.method === 'POST') {
      if (!body) return json({ err: 'плохой запрос' }, 400);
      const acc = findAcc(list, body.nick || body.email);
      if (!acc) return json({ err: 'notfound' }, 404);
      if (acc.pass !== String(body.pass || '')) return json({ err: 'badpass', msg: 'Неверный пароль' }, 403);

      const st = (acc.state && typeof acc.state === 'object') ? acc.state : {};
      const parse = (v) => {
        if (!v) return null;
        if (typeof v === 'object') return v;
        try { return JSON.parse(v); } catch (e) { return null; }
      };
      const ext = parse(st.ext) || {};
      const owned = Array.isArray(ext.assets) ? ext.assets.map(String) : [];
      const numbers = Array.isArray(ext.numbers) ? ext.numbers.map(String) : [];

      const home = body.home ? String(body.home).slice(0, 64) : null;
      if (home && owned.indexOf(home) < 0) {
        return json({ err: 'notowned', msg: 'Этой квартиры у тебя нет' }, 400);
      }
      const wear = (Array.isArray(body.wear) ? body.wear : [])
        .map((x) => String(x).slice(0, 64))
        .filter((x) => owned.indexOf(x) >= 0).slice(0, 5);
      const stands = (Array.isArray(body.stands) ? body.stands : [])
        .map((x) => String(x).replace(/\D/g, ''))
        .filter((x) => numbers.indexOf(x) >= 0).slice(0, 6);

      acc.show = { home: home, wear: wear, stands: stands, t: Date.now() };
      acc.updated = Date.now();
      await writeAll(list);
      return json({ ok: true, show: acc.show });
    }

    return json({ err: 'плохой метод' }, 405);
  }

  /* ---- БОТЫ: создание, ручной тик, метрики ---- */
  /* доступ: ключ BOTS_KEY из окружения ИЛИ аккаунт владельца (ник + пароль) */
  function botsAllowed(list, b) {
    const envKey = (typeof process !== 'undefined' && process.env && process.env.BOTS_KEY)
      ? String(process.env.BOTS_KEY) : '';
    const given = (b && b.key !== undefined && b.key !== null) ? String(b.key) : '';
    if (envKey && given && given.length === envKey.length && given === envKey) return true;
    const acc = findAcc(list, (b && (b.nick || b.email)) || '');
    if (!acc) return false;
    if (acc.pass !== String((b && b.pass) || '')) return false;
    if (acc.admin) return true;
    /* владелец по нику: даже если флаг admin в записи потерялся */
    return String(acc.nick || '').toLowerCase() === 'knote6037';
  }

  if (p === '/api/bots/seed' && req.method === 'POST') {
    if (!body) return json({ err: 'плохой запрос' }, 400);
    const list = await readAll();
    if (!botsAllowed(list, body)) return json({ ok: false, err: 'notadmin', msg: 'Нужен ключ BOTS_KEY или вход владельца' }, 403);
    const force = body.force === true || body.force === 1 || body.force === '1' || body.force === 'true';
    const res = await seedBots(force);
    return json(Object.assign({ ok: true }, res));
  }

  if (p === '/api/bots/tick' && req.method === 'POST') {
    if (!body) return json({ err: 'плохой запрос' }, 400);
    const list = await readAll();
    if (!botsAllowed(list, body)) return json({ ok: false, err: 'notadmin', msg: 'Нужен ключ BOTS_KEY или вход владельца' }, 403);
    const force = body.force === true || body.force === 1 || body.force === '1' || body.force === 'true';
    const res = await runTick(Date.now(), force ? { force: true } : undefined);
    return json(Object.assign({ ok: true }, res));
  }

  if (p === '/api/bots/stats') {
    const list = await readAll();
    /* у GET нет тела — ключ и владельца принимаем ещё и из строки запроса */
    const q = body || {};
    const auth = {
      key: q.key !== undefined ? q.key : u.searchParams.get('key'),
      nick: q.nick || q.email || u.searchParams.get('nick') || u.searchParams.get('email'),
      pass: q.pass !== undefined ? q.pass : u.searchParams.get('pass')
    };
    if (!botsAllowed(list, auth)) return json({ ok: false, err: 'notadmin', msg: 'Нужен ключ BOTS_KEY или вход владельца' }, 403);

    /* курс тот же, что у ботов и в social.js: старые монеты + единый
       справочник новых market-coins.js */
    const PR = Object.assign({
      KNT: 325000, BTC: 80000, ETH: 3200, SOL: 220,
      LTC: 60, GRAM: 2.5, ZBS: 1.2
    }, MARKET_PRICES);
    const bots = [];
    for (const k in list) {
      const a = list[k];
      if (!a || typeof a !== 'object' || a.bot !== true) continue;
      const st = dePublicStats(a);
      let capital = st.usdt;
      for (const sym in st.amounts) {
        const price = PR[String(sym).toUpperCase()];
        if (price) capital += (Number(st.amounts[sym]) || 0) * price;
      }
      bots.push({
        nick: a.nick || k,
        capital: Math.round(capital * 1e6) / 1e6,
        usdt: st.usdt,
        lastSeen: a.last_seen || null
      });
    }
    bots.sort(function (x, y) { return y.capital - x.capital; });

    let meta = null;
    try { meta = await getStore({ name: 'de', consistency: 'strong' }).get('bots_meta', { type: 'json' }); }
    catch (e) { meta = null; }
    return json({ ok: true, meta: meta || null, bots: bots });
  }

  if (p === '/api/bots/follow-seed' && req.method === 'POST') {
    if (!body) return json({ err: 'плохой запрос' }, 400);
    const list = await readAll();
    if (!botsAllowed(list, body)) return json({ ok: false, err: 'notadmin', msg: 'Нужен ключ BOTS_KEY или вход владельца' }, 403);
    const res = await seedFollows();
    return json(Object.assign({ ok: true }, res));
  }

  /* ---- прямой эфир: мелкие действия ботов. Ручка ПУБЛИЧНАЯ, без ключа —
     её дёргает браузер игрока. От спама защищает 4-секундный замок в runLive:
     лишний вызов возвращает { ok: true, skipped: 'lock' } и ничего не меняет. */
  if (p === '/api/bots/live' && (req.method === 'POST' || req.method === 'GET')) {
    const res = await runLive(Date.now());
    return json(Object.assign({ ok: true }, res));
  }

  /* ---- разгон капитала: одноразово поднимает ботов до крупных сумм,
     чтобы в ленте были сделки и переводы на сотни тысяч и миллионы USDT.
     Повторный вызов безопасен: получившие помечены a.boosted и пропускаются. ---- */
  if (p === '/api/bots/boost' && req.method === 'POST') {
    if (!body) return json({ err: 'плохой запрос' }, 400);
    const list = await readAll();
    if (!botsAllowed(list, body)) return json({ ok: false, err: 'notadmin', msg: 'Нужен ключ BOTS_KEY или вход владельца' }, 403);
    const res = await boostBots(Number(body.count) || 12);
    return json(Object.assign({ ok: true }, res));
  }

  /* ---- витрина профилей ботов: разово выдаёт show (дом, украшения, номера)
     и нормальные аватары уже созданным ботам. Идемпотентна: второй прогон
     возвращает changed: 0. Доступ — как у seed/tick (ключ BOTS_KEY или владелец). ---- */
  if (p === '/api/bots/decorate' && req.method === 'POST') {
    if (!body) return json({ err: 'плохой запрос' }, 400);
    const list = await readAll();
    if (!botsAllowed(list, body)) return json({ ok: false, err: 'notadmin', msg: 'Нужен ключ BOTS_KEY или вход владельца' }, 403);
    const res = await decorateBots();
    return json(Object.assign({ ok: true }, res));
  }

  /* ---- ПОСМОТРЕТЬ ЗАПИСЬ АККАУНТА (только владелец) ----
     Отдаёт хеш пароля и кошелёк. Нужно, чтобы владелец мог восстановить
     доступ к старому аккаунту: хеш короткий, клиент подбирает пароль локально. */
  if (p === '/api/peek' && req.method === 'POST') {
    if (!body) return json({ err: 'плохой запрос' }, 400);
    const list = await readAll();
    if (!botsAllowed(list, body)) return json({ ok: false, err: 'notadmin' }, 403);
    const acc = findAcc(list, body.target);
    if (!acc) return json({ ok: false, err: 'notfound' }, 404);
    return json({
      ok: true,
      nick: acc.nick || acc.email || '',
      pass: acc.pass || '',
      wallet: acc.wallet || '',
      admin: !!acc.admin
    });
  }

  /* ---- РЫНОК: ручная правка цены владельцем (кнопки в интерфейсе) ---- */
  if (p === '/api/market/set' && req.method === 'POST') {
    if (!body) return json({ err: 'плохой запрос' }, 400);
    const list = await readAll();
    if (!botsAllowed(list, body)) {
      return json({ ok: false, err: 'notadmin', msg: 'Только владелец' }, 403);
    }
    const r = await setPricesAny(body.prices, { anchor: body.anchor === true });
    return json(r);
  }

  /* ---- NFT-рынок ботов: лоты и покупка ---- */
  const nftRoute = await handleNft(req, p, body, u);
  if (nftRoute) return nftRoute;

  /* ---- живой рынок: публичная витрина цен.
     Цена двигается сделками ботов (market-prices.js), поэтому ручка открыта
     всем: это витрина биржи, а не приватные данные. ---- */
  const marketRoute = await handleMarket(req, p, u);
  if (marketRoute) return marketRoute;

  return json({ err: 'нет такого метода' }, 404);
};
