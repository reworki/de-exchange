/* ============================================================================
   DE Exchange · социальный модуль
   Профиль игрока, живая лента событий и топ биржи.

   Модуль самодостаточный: сам добавляет вкладки и секции, сам рисует экраны
   и ходит на сервер только через deApiReq(). Никаких библиотек и разметки
   в index.html добавлять не нужно — достаточно подключить этот файл.

   Наружу отдаётся только window.dxSocialRefresh (необязательный помощник).
   ============================================================================ */
(function () {
  'use strict';

  /* ---------------------------------------------------------------- константы */

  var EMOJI = ['🐺', '🦊', '🐯', '🦁', '🐸', '🐼', '🦅', '🐉', '🦄', '👑', '💎', '🚀'];
  var COLORS = ['#ff8c1a', '#e05a7a', '#7c5cff', '#0f9d6b', '#2f9dd6', '#c9922e', '#8a5a2b', '#5b6570'];
  var VIEWS = ['profile', 'feed', 'top'];
  var PAGE = 20;
  var FEED_LIMIT = 50;
  var PROFILE_FEED_LIMIT = 15;
  var FEED_INTERVAL = 5000;

  var TABS = [
    { view: 'profile', label: '👤 Профиль' },
    { view: 'feed', label: '🌐 Лента' },
    { view: 'top', label: '🏆 Топ' }
  ];

  /* ----------------------------------------------------------------- состояние */

  var state = {
    booted: false,
    hookTries: 0,
    showTick: 0,
    active: '',

    profileNick: '',
    profileData: null,
    profileTab: 'followers',

    /* кэш списков подписчиков/подписок — чтобы не дёргать сервер лишний раз */
    lists: {
      followers: { items: [], offset: 0, done: false, busy: false, loaded: false, hasMore: true },
      following: { items: [], offset: 0, done: false, busy: false, loaded: false, hasMore: true }
    },

    feed: [],
    feedAt: 0,
    feedBusy: false,

    topBy: 'capital',
    topBusy: false,
    topLoadingBy: '',

    edit: { bio: '', emoji: EMOJI[0], color: COLORS[0] },
    privacy: { hideBalance: false, private: false },

    seq: { profile: 0, followEvents: 0, followList: 0, feed: 0, top: 0, showcase: 0 }
  };

  var EVENT_META = {
    follow: { icon: '👥', tone: 'gold' },
    unfollow: { icon: '👋', tone: 'dim' },
    trade: { icon: '💱', tone: 'gold' },
    buy: { icon: '📈', tone: 'up' },
    sell: { icon: '📉', tone: 'down' },
    receive: { icon: '📥', tone: 'up' },
    received: { icon: '📥', tone: 'up' },
    deposit: { icon: '📥', tone: 'up' },
    transfer: { icon: '💸', tone: 'gold' },
    send: { icon: '📤', tone: 'gold' },
    gift: { icon: '🎁', tone: 'gold' },
    tip: { icon: '🎁', tone: 'gold' },
    win: { icon: '🏆', tone: 'up' },
    lose: { icon: '💥', tone: 'down' },
    loss: { icon: '💥', tone: 'down' },
    nft: { icon: '🖼️', tone: 'gold' },
    mint: { icon: '🖼️', tone: 'gold' },
    level: { icon: '⬆️', tone: 'up' },
    levelup: { icon: '⬆️', tone: 'up' },
    level_up: { icon: '⬆️', tone: 'up' },
    milestone: { icon: '📣', tone: 'gold' },
    register: { icon: '✨', tone: 'gold' },
    profile: { icon: '✏️', tone: 'dim' },
    privacy: { icon: '🔒', tone: 'dim' }
  };

  /* -------------------------------------------------------------- утилиты DOM */

  function byId(id) { return document.getElementById(id); }

  function each(list, fn) { Array.prototype.forEach.call(list || [], fn); }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }

  function closest(node, selector) {
    while (node && node.nodeType === 1) {
      if (node.matches && node.matches(selector)) return node;
      node = node.parentNode;
    }
    return null;
  }

  function esc(value) {
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function (ch) {
      if (ch === '&') return '&amp;';
      if (ch === '<') return '&lt;';
      if (ch === '>') return '&gt;';
      if (ch === '"') return '&quot;';
      return '&#39;';
    });
  }

  /* ------------------------------------------------------------- аккаунт и API */

  function acc() { return window.__DE_ACC || null; }

  function myNick() {
    var a = acc();
    if (!a) return '';
    /* email — для старых локальных записей, которые ещё не переехали на ник */
    return String(a.nick || a.nick_lc || a.username || a.login || a.email || '').replace(/^@+/, '').trim();
  }

  function myPass() {
    var a = acc();
    return a && a.pass ? String(a.pass) : '';
  }

  function norm(nick) { return String(nick || '').trim().toLowerCase(); }

  function isMe(nick) {
    var me = myNick();
    return !!me && norm(me) === norm(nick);
  }

  /* ник для запросов: без @, без пробелов и символов, ломающих URL */
  function cleanNick(raw) {
    var s = String(raw === null || raw === undefined ? '' : raw).trim().replace(/^@+/, '');
    if (!s || s.length > 32) return '';
    if (/[\s\/?#&=<>"']/.test(s)) return '';
    return s;
  }

  function api(method, path, body, cb) {
    if (typeof window.deApiReq !== 'function') { cb({ offline: true }); return; }
    try {
      window.deApiReq(method, path, body, function (res) {
        try { cb(res || { offline: true }); }
        catch (e) { if (window.console) console.error('[social] ответ API', e); }
      });
    } catch (e) {
      cb({ offline: true });
    }
  }

  function okRes(res) {
    if (!res || res.offline) return false;
    if (Number(res.code) !== 200) return false;
    var b = res.body;
    if (b && (b.ok === false || b.success === false)) return false;
    return true;
  }

  function errText(res) {
    if (!res || res.offline) return 'Нет связи с сервером';

    var code = Number(res.code || 0);
    var b = (res.body && typeof res.body === 'object') ? res.body : {};
    var raw = String(b.err || b.error || b.msg || b.message || '').trim();
    var low = raw.toLowerCase();

    var map = {
      'private': 'Профиль закрыт',
      'closed': 'Профиль закрыт',
      'not_found': 'Игрок не найден',
      'notfound': 'Игрок не найден',
      'no_user': 'Игрок не найден',
      'bad_pass': 'Неверный пароль',
      'wrong_pass': 'Неверный пароль',
      'self': 'Нельзя подписаться на себя',
      'self_follow': 'Нельзя подписаться на себя',
      'rate_limit': 'Слишком часто — подожди немного',
      'too_many': 'Слишком часто — подожди немного'
    };
    if (map[low]) return map[low];

    if (code === 403) {
      if (b.private === true) return 'Профиль закрыт';
      return 'Доступ запрещён';
    }
    if (code === 404) return 'Игрок не найден';
    if (code === 401) return 'Войди в аккаунт';
    if (code === 429) return 'Слишком часто — подожди немного';
    if (code >= 500) return 'Сервер ошибся — попробуй позже';
    if (code === 200) return raw || 'Сервер не принял запрос';
    if (code) return raw || ('Ошибка ' + code);
    return 'Нет связи с сервером';
  }

  function say(text, tone) {
    try {
      if (typeof window.toast === 'function') window.toast(String(text), tone || 'info');
    } catch (e) { /* уведомление не должно ломать экран */ }
  }

  /* --------------------------------------------------------- данные и форматы */

  function hasOwn(obj, key) {
    return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
  }

  /* поле может лежать как в самом объекте, так и в stats/counters */
  function rawField(obj, keys) {
    if (!obj || typeof obj !== 'object') return undefined;
    var i, j, k, sub;
    for (i = 0; i < keys.length; i++) {
      k = keys[i];
      if (hasOwn(obj, k)) return obj[k];
    }
    /* live API кладёт часть полей в stats/social/privacy, а не в корень */
    var subs = [obj.stats, obj.counters, obj.numbers, obj.social, obj.privacy, obj.relations];
    for (j = 0; j < subs.length; j++) {
      sub = subs[j];
      if (!sub || typeof sub !== 'object') continue;
      for (i = 0; i < keys.length; i++) {
        k = keys[i];
        if (hasOwn(sub, k)) return sub[k];
      }
    }
    return undefined;
  }

  function firstField(obj, keys) {
    for (var i = 0; i < keys.length; i++) {
      var v = rawField(obj, [keys[i]]);
      if (v !== undefined && v !== null && v !== '') return v;
    }
    return undefined;
  }

  function boolField(obj, keys) {
    var v = rawField(obj, keys);
    if (v === undefined || v === null) return false;
    if (typeof v === 'string') {
      var s = v.toLowerCase();
      return s === '1' || s === 'true' || s === 'yes' || s === 'on';
    }
    return !!v;
  }

  function countField(obj, keys) {
    var v = rawField(obj, keys);
    if (Array.isArray(v)) return v.length;
    var n = Number(v);
    return isFinite(n) ? n : 0;
  }

  function fmtCount(n) {
    if (n === null || n === undefined || n === '' || !isFinite(Number(n))) return '0';
    try {
      if (typeof window.fmtAmt === 'function') return window.fmtAmt(Number(n), 0);
    } catch (e) { /* ниже запасной вариант */ }
    try { return Number(n).toLocaleString('ru-RU'); } catch (e2) { return String(n); }
  }

  function fmtMoney(n) {
    if (n === null || n === undefined || n === '') return '—';
    var num = Number(n);
    if (!isFinite(num)) return '—';
    try {
      if (typeof window.fmt === 'function') return window.fmt(num);
    } catch (e) { /* ниже запасной вариант */ }
    try { return '$' + num.toLocaleString('en-US', { maximumFractionDigits: 2 }); }
    catch (e2) { return '$' + num; }
  }

  function fmtAmount(n) {
    if (n === null || n === undefined || !isFinite(Number(n))) return '';
    try {
      if (typeof window.fmtAmt === 'function') return window.fmtAmt(Math.abs(Number(n)), 2);
    } catch (e) { /* ниже запасной вариант */ }
    try { return Math.abs(Number(n)).toLocaleString('en-US', { maximumFractionDigits: 2 }); }
    catch (e2) { return String(Math.abs(Number(n))); }
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function asDate(v) {
    if (v === null || v === undefined || v === '') return null;
    var s = String(v).trim();
    if (/^\d+$/.test(s)) {
      var n = Number(s);
      if (!isFinite(n) || n <= 0) return null;
      if (n < 100000000000) n *= 1000;           // секунды → миллисекунды
      var d = new Date(n);
      return isNaN(d.getTime()) ? null : d;
    }
    if (/^\d{1,2}:\d{2}/.test(s)) return null;   // это уже готовое время
    var d2 = new Date(s.indexOf(' ') >= 0 ? s.replace(' ', 'T') : s);
    return isNaN(d2.getTime()) ? null : d2;
  }

  function dateShort(d) {
    if (!d) return '';
    return pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) + '.' + d.getFullYear();
  }

  function profileSince(p) {
    var d = asDate(firstField(p, ['created', 'createdAt', 'created_at', 'since', 'registered', 'reg_date', 'reg']));
    return d ? dateShort(d) : '';
  }

  function eventTimeText(ev) {
    var raw = firstField(ev, ['t', 'time', 'at', 'ts', 'date', 'created', 'created_at', 'createdAt', 'when', 'stamp']);
    if (typeof raw === 'string') {
      var s = raw.trim();
      if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) return s.slice(0, 5);
    }
    var d = asDate(raw);
    if (!d) {
      if (typeof raw === 'string' && raw.length <= 16) return raw;
      return '';
    }
    var now = new Date();
    if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()) {
      return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    }
    return pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1);
  }

  function clockText(d) {
    var x = d || new Date();
    return pad2(x.getHours()) + ':' + pad2(x.getMinutes());
  }

  /* ------------------------------------------------------------ общие куски UI */

  function safeColor(value) {
    var s = String(value || '').trim();
    if (/^#[0-9a-f]{3}$/i.test(s) || /^#[0-9a-f]{6}$/i.test(s) || /^#[0-9a-f]{8}$/i.test(s)) return s;
    return COLORS[0];
  }

  function avatarInfo(p) {
    var av = p ? (p.avatar !== undefined ? p.avatar : p.ava) : null;
    var emoji = '';
    var color = '';

    if (typeof av === 'string') {
      emoji = av;
    } else if (av && typeof av === 'object') {
      emoji = av.emoji || av.icon || av.e || '';
      color = av.color || av.bg || av.background || '';
    }
    if (!emoji) emoji = firstField(p, ['avatar_emoji', 'ava_emoji', 'emoji']) || '👤';
    if (!color) color = firstField(p, ['avatar_color', 'ava_color', 'color']) || COLORS[0];

    emoji = String(emoji || '👤').slice(0, 16);
    return { emoji: emoji || '👤', color: safeColor(color) };
  }

  function nickOf(obj) {
    if (!obj) return '';
    if (typeof obj === 'string') return String(obj).replace(/^@+/, '').trim();
    return String(firstField(obj, ['nick', 'nick_lc', 'login', 'username', 'name']) || '')
      .replace(/^@+/, '').trim();
  }

  function actorOf(ev) {
    return String(firstField(ev, ['actor', 'nick', 'user', 'login', 'by', 'from', 'from_nick', 'sender', 'src']) || '')
      .replace(/^@+/, '').trim();
  }

  function fromOf(ev) {
    return String(firstField(ev, ['from', 'from_nick', 'sender', 'src']) || '')
      .replace(/^@+/, '').trim();
  }

  function targetOf(ev) {
    return String(firstField(ev, ['target', 'to', 'to_nick', 'peer', 'recipient', 'recipient_nick', 'friend']) || '')
      .replace(/^@+/, '').trim();
  }

  function nickLink(nick) {
    if (!nick) return '';
    return '<button type="button" class="dxsoc-nick" data-dxs-nick="' + esc(nick) + '">@' + esc(nick) + '</button>';
  }

  function personHtml(nick) {
    return nick ? nickLink(nick) : '<span class="dxsoc-muted">игрок</span>';
  }

  function errorHtml(message) {
    return '<div class="dx-empty dxsoc-error">' + esc(message) + '</div>';
  }

  function loadingHtml(message) {
    return '<div class="dx-empty">' + esc(message || 'Загружаю…') + '</div>';
  }

  function setProfileHero(hint) {
    var t = byId('dxsProfileTitle');
    var h = byId('dxsProfileHint');
    /* ник живёт только в карточке — в шапке не дублируем */
    if (t) t.textContent = 'Профиль игрока';
    if (h) h.textContent = hint || '';
  }

  function pickProfile(body) {
    if (!body) return null;
    var p = body.profile || body.user || body.player || body.data || body;
    if (p && typeof p === 'object' && p.profile && typeof p.profile === 'object') p = p.profile;
    return (p && typeof p === 'object') ? p : null;
  }

  /* некоторые серверы кладут признаки подписки/приватности рядом с profile */
  function inheritProfileFlags(p, body) {
    if (!p || !body || body === p || typeof body !== 'object') return;
    ['isFollowing', 'is_following', 'isSubscribed', 'is_subscribed',
     'hideBalance', 'hide_balance', 'hideCapital', 'private', 'isPrivate', 'is_private',
     'isSelf', 'is_self', 'self'].forEach(function (key) {
      if (p[key] === undefined && body[key] !== undefined) p[key] = body[key];
    });
  }

  function asList(body, keys) {
    if (Array.isArray(body)) return body;
    if (!body || typeof body !== 'object') return [];
    var i;
    for (i = 0; i < keys.length; i++) {
      if (Array.isArray(body[keys[i]])) return body[keys[i]];
      if (body[keys[i]] && typeof body[keys[i]] === 'object' && Array.isArray(body[keys[i]].list)) {
        return body[keys[i]].list;
      }
    }
    var data = body.data;
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object') {
      for (i = 0; i < keys.length; i++) {
        if (Array.isArray(data[keys[i]])) return data[keys[i]];
        if (data[keys[i]] && typeof data[keys[i]] === 'object' && Array.isArray(data[keys[i]].list)) {
          return data[keys[i]].list;
        }
      }
    }
    return [];
  }

  /* ------------------------------------------------------------- стили модуля */

  function ensureStyle() {
    if (byId('dxsSocialStyle')) return;
    var css = [
      '#view-profile .hero .total { font-size: clamp(28px, 5.4vw, 48px); }',

      '.dxsoc-toolbar { display:flex; align-items:center; justify-content:center; gap:10px; flex-wrap:wrap; max-width:760px; margin:20px auto 0; }',
      '.dxsoc-toolbar .dx-inp { flex:1 1 260px; width:auto; min-width:0; }',
      '.dxsoc-toolbar .btn { flex:0 0 auto; }',

      '.dxsoc-profilebar { display:flex; align-items:center; justify-content:space-between; gap:10px 18px; min-height:76px; margin:24px 0 0; padding:14px 22px; border-radius:20px; overflow:hidden; }',
      '.dxsoc-profilebar-title { color:var(--text,#2a1b0b); font-size:19px; font-weight:900; letter-spacing:.2px; white-space:nowrap; }',
      '.dxsoc-profilebar-hint { color:var(--dim,#8a7358); font-size:12px; text-align:right; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; }',
      '.dxsoc-card { border-radius:22px; padding:24px; margin-top:20px; }',
      '.dxsoc-showcase { margin-top:2px; }',
      '.dxsoc-scene-ready { aspect-ratio:16 / 9; background:#0d1220; }',
      '.dxsoc-scene-empty { display:flex; align-items:center; gap:14px; flex-wrap:wrap; min-height:132px; margin:14px 0 18px; padding:18px 20px; border:1px dashed var(--border,rgba(184,124,48,.3)); border-radius:18px; background:rgba(255,255,255,.16); }',
      '.dxsoc-scene-empty[hidden], .dxsoc-sceneact[hidden], .dxsoc-scene-empty .btn[hidden] { display:none !important; }',
      '.dxsoc-scene-empty-ico { flex:0 0 auto; font-size:32px; line-height:1; opacity:.9; }',
      '.dxsoc-scene-empty-text { flex:1 1 220px; min-width:0; }',
      '.dxsoc-scene-empty-title { color:var(--text,#2a1b0b); font-size:14px; font-weight:900; }',
      '.dxsoc-scene-empty-hint { color:var(--dim,#8a7358); font-size:11.5px; line-height:1.4; margin-top:3px; }',
      '.dxsoc-scene-empty .btn { flex:0 0 auto; height:34px; margin-left:auto; padding:0 14px; font-size:12.5px; }',
      'body.dark .dxsoc-scene-empty { background:rgba(255,255,255,.035); }',
      '.dxsoc-sceneact { display:flex; justify-content:flex-end; margin:-8px 0 16px; }',
      '.dxsoc-sceneact .btn { height:34px; padding:0 14px; font-size:12.5px; }',
      '.dxsoc-phead { display:flex; align-items:flex-start; gap:18px; flex-wrap:wrap; }',
      '.dxsoc-ava { width:92px; height:92px; flex:0 0 auto; border-radius:50%; display:flex; align-items:center; justify-content:center; position:relative; overflow:hidden; border:2px solid rgba(255,255,255,.55); box-shadow: inset 0 0 28px rgba(0,0,0,.18), 0 10px 28px rgba(0,0,0,.22); }',
      '.dxsoc-ava::after { content:\'\'; position:absolute; inset:0; background:radial-gradient(circle at 30% 24%, rgba(255,255,255,.42), transparent 52%); pointer-events:none; }',
      '.dxsoc-ava b { position:relative; z-index:1; font-size:46px; line-height:1; text-shadow:0 2px 8px rgba(0,0,0,.25); }',
      '.dxsoc-pinfo { flex:1 1 260px; min-width:0; }',
      '.dxsoc-pname { font-size:clamp(21px,3vw,29px); font-weight:900; line-height:1.15; word-break:break-word; }',
      '.dxsoc-crown { color:var(--gold,#c9922e); font-size:.8em; }',
      '.dxsoc-pbio { color:var(--text,#2a1b0b); font-size:13.5px; line-height:1.55; margin-top:7px; white-space:pre-wrap; word-break:break-word; }',
      '.dxsoc-pmeta { display:flex; flex-wrap:wrap; gap:6px 14px; color:var(--dim,#8a7358); font-size:12px; margin-top:9px; }',
      '.dxsoc-pacts { margin-left:auto; display:flex; align-items:center; gap:8px; flex-wrap:wrap; }',
      '.dxsoc-pacthint { font-size:12px; color:var(--dim,#8a7358); }',
      '.dxsoc-muted { color:var(--dim,#8a7358); }',
      '.dxsoc-admin { color:var(--gold,#c9922e); font-weight:800; }',

      '.dxsoc-stats { display:grid; grid-template-columns:repeat(auto-fit, minmax(112px, 1fr)); gap:10px; margin-top:22px; }',
      '.dxsoc-stat { border:1px solid var(--border,rgba(184,124,48,.24)); border-radius:14px; padding:12px 14px; background:rgba(255,255,255,.24); }',
      '.dxsoc-stat .k { color:var(--dim,#8a7358); font-size:10px; letter-spacing:1.4px; text-transform:uppercase; font-weight:800; }',
      '.dxsoc-stat .v { color:var(--text,#2a1b0b); font-size:20px; font-weight:900; margin-top:4px; overflow-wrap:anywhere; }',
      '.dxsoc-stat.gold .v { color:var(--gold,#c9922e); }',
      'body.dark .dxsoc-stat { background:rgba(255,255,255,.035); }',

      '.dxsoc-followbox { margin-top:20px; }',
      '.dxsoc-followseg { margin-bottom:10px; }',
      '.dxsoc-followseg i { cursor:pointer; }',
      '.dxsoc-people { max-height:none; border-radius:18px; }',
      '.dxsoc-person { display:flex; align-items:center; gap:12px; padding:11px 16px; border-bottom:1px solid rgba(255,255,255,.055); cursor:pointer; transition:background .18s ease; }',
      '.dxsoc-person:last-child { border-bottom:none; }',
      '.dxsoc-person:hover { background:rgba(255,140,26,.08); }',
      '.dxsoc-person:focus-visible { outline:2px solid var(--gold,#c9922e); outline-offset:-2px; }',
      '.dxsoc-person-main { flex:1 1 auto; min-width:0; display:flex; flex-direction:column; }',
      '.dxsoc-person-nick { color:var(--text,#2a1b0b); font-weight:800; font-size:13.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }',
      '.dxsoc-person-bio { color:var(--dim,#8a7358); font-size:11.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-top:2px; }',
      '.dxsoc-person-go { color:var(--dim,#8a7358); font-size:20px; line-height:1; flex:0 0 auto; }',
      '.dxsoc-mini-ava { width:38px; height:38px; flex:0 0 auto; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:20px; line-height:1; border:1px solid rgba(255,255,255,.45); box-shadow:inset 0 0 14px rgba(0,0,0,.14); }',
      '.dxsoc-more { display:flex; justify-content:center; margin-top:12px; }',

      '.dxsoc-log { max-height:520px; }',
      '.dxsoc-eventrow { grid-template-columns:64px 26px minmax(0,1fr) auto; gap:10px; padding:10px 16px; }',
      '.dxsoc-eventrow .q { line-height:1.45; word-break:break-word; }',
      '.dxsoc-eventrow .tt { white-space:nowrap; font-size:12.5px; }',
      '.dxsoc-eventrow .tt.dxsoc-up { color:var(--up,#0f9d6b); }',
      '.dxsoc-eventrow .tt.dxsoc-down { color:var(--down,#d1455c); }',
      '.dxsoc-eventrow .dxsoc-event-icon { font-size:15px; text-align:center; letter-spacing:0; }',
      '.dxsoc-tone-up { color:var(--up,#0f9d6b); }',
      '.dxsoc-tone-down { color:var(--down,#d1455c); }',
      '.dxsoc-tone-gold { color:var(--gold,#c9922e); }',
      '.dxsoc-tone-dim { color:var(--dim,#8a7358); }',

      '.dxsoc-nick { border:0; background:none; padding:0; margin:0; font:inherit; font-weight:800; color:var(--gold,#c9922e); cursor:pointer; text-align:left; }',
      '.dxsoc-nick:hover { text-decoration:underline; }',
      '.dxsoc-nick:focus-visible { outline:2px solid var(--gold,#c9922e); outline-offset:2px; border-radius:4px; }',

      '.dxsoc-feedbar { display:flex; align-items:center; justify-content:center; gap:12px; flex-wrap:wrap; margin:18px 0 4px; }',
      '.dxsoc-feedstat { color:var(--dim,#8a7358); font-size:12px; letter-spacing:.3px; }',
      '.dxsoc-feedstat.dxsoc-err { color:var(--down,#d1455c); }',

      '.dxsoc-edit { margin-top:20px; }',
      '.dxsoc-edithead { color:var(--gold,#c9922e); font-size:12.5px; letter-spacing:2.4px; text-transform:uppercase; font-weight:800; margin-bottom:16px; }',
      '.dxsoc-editgrid { display:grid; grid-template-columns:minmax(0,1.3fr) minmax(220px,.7fr); gap:22px; }',
      '.dxsoc-bio { height:auto; min-height:92px; padding:12px 14px; resize:vertical; line-height:1.55; }',
      '.dxsoc-count { color:var(--dim,#8a7358); font-size:11px; text-align:right; margin-top:5px; }',
      '.dxsoc-emojis { display:flex; flex-wrap:wrap; gap:8px; }',
      '.dxsoc-emoji { width:42px; height:42px; border-radius:12px; border:1px solid var(--border,rgba(184,124,48,.24)); background:rgba(255,255,255,.35); cursor:pointer; font-size:22px; line-height:1; display:flex; align-items:center; justify-content:center; transition:transform .16s ease, border-color .16s ease, background .16s ease; }',
      '.dxsoc-emoji:hover { transform:translateY(-2px); border-color:var(--gold,#c9922e); }',
      '.dxsoc-emoji.on { border-color:var(--gold,#c9922e); background:rgba(255,140,26,.18); box-shadow:0 0 0 2px rgba(255,140,26,.25); }',
      'body.dark .dxsoc-emoji { background:rgba(255,255,255,.05); }',
      '.dxsoc-colors { display:flex; flex-wrap:wrap; gap:10px; margin-top:14px; }',
      '.dxsoc-color { width:30px; height:30px; padding:0; border-radius:50%; border:2px solid rgba(255,255,255,.7); cursor:pointer; transition:transform .16s ease; }',
      '.dxsoc-color:hover { transform:scale(1.1); }',
      '.dxsoc-color.on { outline:2px solid var(--gold,#c9922e); outline-offset:2px; transform:scale(1.08); }',
      '.dxsoc-privacy { display:flex; flex-wrap:wrap; gap:18px 26px; margin-top:20px; padding-top:16px; border-top:1px solid var(--border,rgba(184,124,48,.24)); }',
      '.dxsoc-switch { display:flex; align-items:center; gap:10px; cursor:pointer; user-select:none; max-width:290px; }',
      '.dxsoc-switch input { position:absolute; opacity:0; pointer-events:none; }',
      '.dxsoc-track { width:42px; height:24px; flex:0 0 auto; border-radius:999px; background:rgba(120,100,80,.25); border:1px solid var(--border,rgba(184,124,48,.24)); position:relative; transition:background .18s ease, border-color .18s ease; }',
      '.dxsoc-track i { position:absolute; left:3px; top:2px; width:18px; height:18px; border-radius:50%; background:var(--dim,#8a7358); transition:transform .18s ease, background .18s ease; }',
      '.dxsoc-switch input:checked + .dxsoc-track { background:rgba(255,140,26,.35); border-color:rgba(255,140,26,.55); }',
      '.dxsoc-switch input:checked + .dxsoc-track i { transform:translateX(16px); background:var(--gold,#c9922e); }',
      '.dxsoc-switch input:focus-visible + .dxsoc-track { outline:2px solid var(--gold,#c9922e); outline-offset:2px; }',
      '.dxsoc-switch-txt { color:var(--text,#2a1b0b); font-size:12.5px; line-height:1.35; }',
      '.dxsoc-switch-txt small { display:block; color:var(--dim,#8a7358); font-size:11px; margin-top:2px; }',

      '.dxsoc-guest { text-align:center; padding:36px 24px; }',
      '.dxsoc-guesticon { font-size:42px; line-height:1; }',
      '.dxsoc-guesttitle { font-size:19px; font-weight:900; margin-top:10px; }',
      '.dxsoc-error { color:var(--down,#d1455c) !important; }',

      '.dxsoc-topseg { display:flex; justify-content:center; margin:20px 0 14px; }',
      '.dxsoc-table { border-radius:20px; overflow:hidden; }',
      '.dxsoc-thead, .dxsoc-toprow { display:grid; grid-template-columns:52px minmax(0,1.5fr) minmax(110px,.9fr) 110px 78px; gap:12px; align-items:center; padding:12px 18px; }',
      '.dxsoc-thead { color:var(--dim,#8a7358); font-size:10.5px; letter-spacing:1.4px; text-transform:uppercase; font-weight:800; border-bottom:1px solid var(--border,rgba(184,124,48,.24)); }',
      '.dxsoc-thead span:last-child { text-align:right; }',
      '.dxsoc-toprow { border-bottom:1px solid rgba(255,255,255,.055); cursor:pointer; transition:background .18s ease; }',
      '.dxsoc-toprow:last-child { border-bottom:none; }',
      '.dxsoc-toprow:hover { background:rgba(255,140,26,.075); }',
      '.dxsoc-toprow:focus-visible { outline:2px solid var(--gold,#c9922e); outline-offset:-2px; }',
      '.dxsoc-toprow.self { background:linear-gradient(90deg, rgba(255,140,26,.20), rgba(255,140,26,.05)); box-shadow:inset 3px 0 0 var(--accent,#ff8c1a); }',
      '.dxsoc-rank { color:var(--dim,#8a7358); font-size:14px; font-weight:900; }',
      '.dxsoc-rank.r1 { color:#e7b84b; }',
      '.dxsoc-rank.r2 { color:#b9c3cd; }',
      '.dxsoc-rank.r3 { color:#c98a5a; }',
      '.dxsoc-player { display:flex; align-items:center; gap:10px; min-width:0; }',
      '.dxsoc-player .dxsoc-nick { display:block; max-width:100%; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }',
      '.dxsoc-player .dxsoc-mini-ava { width:32px; height:32px; font-size:17px; }',
      '.dxsoc-metric { color:var(--gold,#c9922e); font-weight:800; white-space:nowrap; }',
      '.dxsoc-followers { color:var(--dim,#8a7358); font-weight:700; white-space:nowrap; }',
      '.dxsoc-delta { font-weight:800; white-space:nowrap; text-align:right; }',
      '.dxsoc-delta.up { color:var(--up,#0f9d6b); }',
      '.dxsoc-delta.down { color:var(--down,#d1455c); }',
      '.dxsoc-delta.flat { color:var(--dim,#8a7358); }',
      '.dxsoc-pinnedwrap { margin-top:14px; }',
      '.dxsoc-pinnedlbl { color:var(--dim,#8a7358); font-size:11px; letter-spacing:.4px; font-weight:800; margin:0 0 7px 5px; }',

      '@media (max-width:760px) {',
      '  .dxsoc-editgrid { grid-template-columns:1fr; gap:18px; }',
      '  .dxsoc-pacts { margin-left:0; width:100%; }',
      '}',
      '@media (max-width:680px) {',
      '  .dxsoc-thead, .dxsoc-toprow { grid-template-columns:38px minmax(0,1fr) 92px 64px; gap:8px; padding:11px 13px; }',
      '  .dxsoc-col-followers, .dxsoc-thead .dxsoc-col-followers { display:none; }',
      '  .dxsoc-thead span:nth-child(4) { display:none; }',
      '}',
      '@media (max-width:560px) {',
      '  .dxsoc-card { padding:18px 16px; }',
      '  .dxsoc-profilebar { min-height:70px; padding:13px 16px; flex-wrap:wrap; gap:3px 12px; }',
      '  .dxsoc-profilebar-hint { text-align:left; white-space:normal; }',
      '  .dxsoc-ava { width:74px; height:74px; }',
      '  .dxsoc-ava b { font-size:38px; }',
      '  .dxsoc-sceneact { margin:-6px 0 14px; }',
      '  .dxsoc-scene-empty { padding:16px; gap:10px; }',
      '  .dxsoc-stats { grid-template-columns:repeat(2, minmax(0,1fr)); }',
      '  .dxsoc-eventrow { grid-template-columns:46px 20px minmax(0,1fr) auto; gap:7px; padding:10px 12px; font-size:12px; }',
      '  .dxsoc-eventrow .tt { font-size:11.5px; }',
      '  .dxsoc-toolbar .dx-inp { flex-basis:100%; }',
      '}'
    ].join('\n');

    var style = document.createElement('style');
    style.id = 'dxsSocialStyle';
    style.textContent = css;
    document.head.appendChild(style);
  }

  /* ---------------------------------------------------------------- скелет DOM */

  var PROFILE_HTML =
    '<div class="dxsoc-profilebar glass goldline">' +
      '<div class="dxsoc-profilebar-title" id="dxsProfileTitle">Профиль игрока</div>' +
      '<div class="dxsoc-profilebar-hint" id="dxsProfileHint">социальный профиль биржи DE</div>' +
    '</div>' +
    '<div class="dxsoc-toolbar">' +
      '<input class="dx-inp" id="dxsProfileSearch" type="text" maxlength="32" autocomplete="off" spellcheck="false" placeholder="Найти игрока по нику" aria-label="Ник игрока">' +
      '<button class="btn ghost small" id="dxsProfileFind" type="button" data-dxs-act="find">🔍 Найти</button>' +
      '<button class="btn ghost small" id="dxsProfileMe" type="button" data-dxs-act="me">👤 Мой профиль</button>' +
    '</div>' +
    '<div id="dxsProfileBody"></div>';

  var FEED_HTML =
    '<div class="hero">' +
      '<div class="label">Лента биржи</div>' +
      '<div class="total">События</div>' +
      '<div class="hint">сделки, подписки, подарки и уровни игроков</div>' +
    '</div>' +
    '<div class="dxsoc-feedbar">' +
      '<div class="dxsoc-feedstat" id="dxsFeedStat">загружаю…</div>' +
      '<button class="btn ghost small" id="dxsFeedRefresh" type="button" data-dxs-act="feed-refresh">↻ Обновить</button>' +
    '</div>' +
    '<div id="dxsFeedBody"></div>';

  var TOP_HTML =
    '<div class="hero">' +
      '<div class="label">Зал славы</div>' +
      '<div class="total">Топ игроков</div>' +
      '<div class="hint">капитал, подписчики и сделки за всё время</div>' +
    '</div>' +
    '<div class="dxsoc-topseg">' +
      '<div class="dx-seg" id="dxsTopSeg">' +
        '<i data-dxs-top="capital" class="on" role="button" tabindex="0">По капиталу</i>' +
        '<i data-dxs-top="followers" role="button" tabindex="0">По подписчикам</i>' +
        '<i data-dxs-top="trades" role="button" tabindex="0">По сделкам</i>' +
      '</div>' +
    '</div>' +
    '<div id="dxsTopBody"></div>';

  function makeSection(html) {
    var box = document.createElement('div');
    box.innerHTML = html;
    return box.firstElementChild;
  }

  /* секции ставим к остальным .view, но перед <footer>, если он лежит
     в том же контейнере — иначе профиль окажется под подвалом сайта */
  function appendViewSection(parent, section) {
    var footer = null;
    for (var i = 0; i < parent.children.length; i++) {
      if (parent.children[i].tagName === 'FOOTER') { footer = parent.children[i]; break; }
    }
    if (footer) parent.insertBefore(section, footer);
    else parent.appendChild(section);
  }

  function buildSkeleton() {
    var nav = document.querySelector('nav');
    var firstView = document.querySelector('section.view');
    var parent = firstView && firstView.parentNode;
    if (!nav || !parent) return false;

    /* вкладки */
    TABS.forEach(function (item) {
      var existing = nav.querySelector('.tab[data-view="' + item.view + '"]');
      if (existing) {
        /* если вкладку добавили вручную без onclick — подключим сами */
        if (!existing.getAttribute('onclick')) {
          existing.addEventListener('click', function () {
            if (typeof window.showView === 'function') window.showView(item.view);
            else { fallbackShow(item.view); onViewShown(item.view); }
          });
        }
        return;
      }
      var tab = document.createElement('div');
      tab.className = 'tab';
      tab.setAttribute('data-view', item.view);
      tab.setAttribute('onclick', "showView('" + item.view + "')");
      tab.textContent = item.label;
      nav.appendChild(tab);
    });

    /* секции — в конец контейнера, где уже лежат остальные .view */
    if (!byId('view-profile')) {
      var sp = makeSection('<section id="view-profile" class="view">' + PROFILE_HTML + '</section>');
      appendViewSection(parent, sp);
    }
    if (!byId('view-feed')) {
      var sf = makeSection('<section id="view-feed" class="view">' + FEED_HTML + '</section>');
      appendViewSection(parent, sf);
    }
    if (!byId('view-top')) {
      var st = makeSection('<section id="view-top" class="view">' + TOP_HTML + '</section>');
      appendViewSection(parent, st);
    }
    return true;
  }

  /* ---------------------------------------------------------- переключение вкладок */

  function fallbackShow(name) {
    each(document.querySelectorAll('.tab'), function (t) {
      t.classList.toggle('active', t.getAttribute('data-view') === name);
    });
    each(document.querySelectorAll('section.view'), function (s) {
      s.classList.toggle('show', s.id === 'view-' + name);
    });
  }

  function installShowViewHook() {
    var orig = window.showView;
    if (typeof orig !== 'function') {
      if (state.hookTries < 50) {
        state.hookTries++;
        setTimeout(installShowViewHook, 100);
      }
      return;
    }
    if (orig.__dxsSocialWrapped) return;

    var wrapped = function (name) {
      var out;
      try {
        out = orig.apply(this, arguments);
      } finally {
        var n = String(name || '');
        state.showTick++;
        state.active = n;
        if (VIEWS.indexOf(n) !== -1) {
          try { onViewShown(n); }
          catch (e) { if (window.console) console.error('[social] showView', e); }
        }
      }
      return out;
    };
    try { wrapped.__dxsSocialWrapped = true; } catch (e) { /* не критично */ }
    window.showView = wrapped;
  }

  function onViewShown(name) {
    state.active = name;
    if (name === 'profile') {
      if (!state.profileNick) state.profileNick = myNick();
      if (!state.profileNick) { renderGuest(); return; }
      loadProfile(state.profileNick, { silent: !!state.profileData });
      return;
    }
    if (name === 'feed') {
      loadFeed({ silent: state.feed.length > 0 });
      return;
    }
    if (name === 'top') {
      loadTop(state.topBy, {});
    }
  }

  function openProfile(rawNick) {
    var nick = cleanNick(rawNick);
    if (!nick) { say('Такой ник не подойдёт', 'bad'); return; }

    if (norm(state.profileNick) !== norm(nick)) {
      resetProfileLists();
      state.profileData = null;
    }
    state.profileNick = nick;
    state.profileTab = 'followers';

    if (typeof window.showView === 'function') {
      var tick = state.showTick;
      try { window.showView('profile'); }
      catch (e) { fallbackShow('profile'); onViewShown('profile'); return; }
      /* если хук showView по какой-то причине не сработал — грузим сами */
      if (state.showTick === tick) {
        fallbackShow('profile');
        onViewShown('profile');
      }
    } else {
      fallbackShow('profile');
      onViewShown('profile');
    }
  }

  /* ------------------------------------------------------------- профиль: каркас */

  function resetProfileLists() {
    state.lists = {
      followers: { items: [], offset: 0, done: false, busy: false, loaded: false, hasMore: true },
      following: { items: [], offset: 0, done: false, busy: false, loaded: false, hasMore: true }
    };
    state.seq.followList++;
    state.seq.followEvents++;
  }

  function renderGuest() {
    state.profileData = null;
    setProfileHero('войди в аккаунт');
    var box = byId('dxsProfileBody');
    if (!box) return;
    box.innerHTML =
      '<div class="dxsoc-card glass goldline dxsoc-guest">' +
        '<div class="dxsoc-guesticon">🔒</div>' +
        '<div class="dxsoc-guesttitle">Войди, чтобы увидеть профиль</div>' +
        '<div class="dx-hint">После входа здесь появятся твой капитал, подписчики и настройки профиля.</div>' +
      '</div>';
  }

  /* ------------------------------------------------------------- профиль: запрос */

  function profilePath(nick) {
    var path = '/api/profile?nick=' + encodeURIComponent(nick);
    if (isMe(nick) && myPass()) path += '&pass=' + encodeURIComponent(myPass());
    return path;
  }

  function loadProfile(nick, opts) {
    opts = opts || {};
    nick = String(nick || '').trim();
    if (!nick || !cleanNick(nick)) { state.profileNick = ''; renderGuest(); return; }

    var box = byId('dxsProfileBody');
    if (!box) return;

    if (norm(nick) !== norm(state.profileNick)) {
      resetProfileLists();
      state.profileTab = 'followers';
      state.profileData = null;
    }
    state.profileNick = nick;

    setProfileHero('загружаю профиль…');
    if (!(opts.silent && state.profileData)) box.innerHTML = loadingHtml('Загружаю профиль…');

    var seq = ++state.seq.profile;
    api('GET', profilePath(nick), null, function (res) {
      if (seq !== state.seq.profile) return;
      if (!okRes(res)) {
        var msg = errText(res);
        setProfileHero(msg);
        box.innerHTML = errorHtml(msg);
        say(msg, 'bad');
        return;
      }

      var p = pickProfile(res.body);
      if (!p) {
        setProfileHero('Игрок не найден');
        box.innerHTML = errorHtml('Игрок не найден');
        say('Игрок не найден', 'bad');
        return;
      }

      inheritProfileFlags(p, res.body);
      var displayNick = nickOf(p) || nick;
      state.profileData = p;
      state.profileNick = displayNick;
      renderProfile(p, displayNick);
    });
  }

  /* ----------------------------------------------------------- профиль: отрисовка */

  function profileFollowers(p) {
    return countField(p, ['followers', 'followersCount', 'followers_count', 'subscribers', 'subs']);
  }

  function profileFollowing(p) {
    return countField(p, ['following', 'followingCount', 'following_count', 'subscriptions']);
  }

  function profileTrades(p) {
    return countField(p, ['trades', 'tradesCount', 'trades_count', 'deals']);
  }

  function profileNft(p) {
    return countField(p, ['nft', 'nftCount', 'nft_count', 'nfts']);
  }

  function profileAdmin(p) {
    if (boolField(p, ['admin', 'isAdmin', 'is_admin', 'owner', 'isOwner', 'is_owner'])) return true;
    var role = norm(firstField(p, ['role', 'status']));
    return role === 'admin' || role === 'owner';
  }

  function profileLevel(p) {
    var v = firstField(p, ['level', 'lvl', 'level_num']);
    return v === undefined ? '—' : String(v);
  }

  function profileRank(p) {
    var raw = firstField(p, ['rank', 'place', 'position', 'top']);
    if (raw === undefined || raw === null || raw === '') return '';
    var n = parseInt(String(raw).replace(/[^\d-]/g, ''), 10);
    return isFinite(n) && n > 0 ? n : '';
  }

  function isFollowingProfile(p) {
    var v = rawField(p, ['isFollowing', 'is_following', 'subscribed', 'isSubscribed', 'is_subscribed', 'followed']);
    if (typeof v === 'boolean') return v;
    if (v === 1 || v === '1' || v === 'true') return true;
    if (v === 0 || v === '0' || v === 'false') return false;
    var f = rawField(p, ['following']);
    return typeof f === 'boolean' ? f : false;
  }

  function isSelfProfile(p, nick) {
    if (isMe(nick)) return true;
    return p.isSelf === true || p.is_self === true || p.isMe === true || p.is_me === true || p.self === true || p.me === true;
  }

  function profileBio(p) {
    var v = firstField(p, ['bio', 'about', 'description', 'status_text']);
    return v === undefined ? '' : String(v).slice(0, 120);
  }

  function profileCardHtml(p, nick, self) {
    var av = avatarInfo(p);
    var bio = profileBio(p);
    var since = profileSince(p);
    var wallet = String(firstField(p, ['wallet', 'wallet_num', 'walletNumber']) || '');
    var admin = profileAdmin(p);
    var followers = profileFollowers(p);
    var following = profileFollowing(p);

    var capRaw = rawField(p, ['capital', 'netWorth', 'net_worth', 'balance', 'totalBalance']);
    var capHidden = capRaw === null || capRaw === '';
    if (!self && boolField(p, ['hideBalance', 'hide_balance', 'hideCapital', 'capitalHidden'])) capHidden = true;
    var capText = capHidden ? 'скрыто' : (capRaw === undefined ? '—' : fmtMoney(capRaw));

    var rank = profileRank(p);
    var nft = profileNft(p);
    var trades = profileTrades(p);
    var level = profileLevel(p);

    var stats = [
      { k: 'Капитал', v: capText, gold: true },
      { k: 'Подписчики', v: fmtCount(followers) },
      { k: 'Подписок', v: fmtCount(following) },
      { k: 'Сделок', v: fmtCount(trades) },
      { k: 'NFT', v: fmtCount(nft) },
      { k: 'Место в топе', v: rank ? ('#' + rank) : '—' },
      { k: 'Уровень', v: level }
    ].map(function (s) {
      return '<div class="dxsoc-stat' + (s.gold ? ' gold' : '') + '">' +
        '<div class="k">' + esc(s.k) + '</div>' +
        '<div class="v">' + esc(s.v) + '</div>' +
      '</div>';
    }).join('');

    var actions = '';
    if (self) {
      actions = '<button class="btn ghost small" type="button" data-dxs-act="focus-edit">✏ Редактировать</button>';
    } else if (myNick()) {
      var followingProfile = isFollowingProfile(p);
      actions = '<button class="btn ' + (followingProfile ? 'ghost' : 'primary') + ' small" type="button" ' +
        'data-dxs-act="follow" aria-pressed="' + (followingProfile ? 'true' : 'false') + '">' +
        (followingProfile ? '✓ Подписан' : 'Подписаться') + '</button>';
    } else {
      actions = '<span class="dxsoc-pacthint">Войди, чтобы подписаться</span>';
    }

    /* дата основания уже есть в карточке — в компактной шапке не дублируем */
    var hint = self ? 'твой профиль' : 'игрок DE Exchange';

    /* витрина: рисуем только если подключён scene-модуль */
    var sceneOn = !!(window.dxScene && typeof window.dxScene.render === 'function');
    var canEditScene = !!(self && window.dxProfileEditor && typeof window.dxProfileEditor.open === 'function');
    var showcaseHtml = '';

    if (sceneOn) {
      showcaseHtml =
        '<div class="dxsoc-showcase">' +
          '<div id="dxSceneBox" style="margin:14px 0 18px;border-radius:18px;overflow:hidden;display:none"></div>' +
          '<div class="dxsoc-scene-empty" id="dxSceneEmpty">' +
            '<div class="dxsoc-scene-empty-ico">🏙️</div>' +
            '<div class="dxsoc-scene-empty-text">' +
              '<div class="dxsoc-scene-empty-title" id="dxSceneEmptyTitle">Загружаю витрину…</div>' +
              '<div class="dxsoc-scene-empty-hint" id="dxSceneEmptyHint">Квартира, украшения и номера</div>' +
            '</div>' +
            (canEditScene
              ? '<button class="btn ghost" type="button" id="dxSceneEmptyBtn" data-dxs-act="edit-showcase" hidden>🎨 Настроить витрину</button>'
              : '') +
          '</div>' +
          (canEditScene
            ? '<div class="dxsoc-sceneact" id="dxSceneActions" hidden>' +
                '<button class="btn ghost" type="button" data-dxs-act="edit-showcase">🎨 Редактор витрины</button>' +
              '</div>'
            : '') +
        '</div>';
    } else {
      /* scene-модуль не подключён: контейнер остаётся пустым и не занимает 16:9 */
      showcaseHtml = '<div class="dxsoc-showcase">' +
        '<div id="dxSceneBox" style="margin:14px 0 18px;border-radius:18px;overflow:hidden;display:none"></div>' +
      '</div>';
    }

    return {
      hint: hint,
      html:
        '<div class="dxsoc-card glass goldline">' +
          '<div class="dxsoc-phead">' +
            '<div class="dxsoc-ava" style="background:' + av.color + '"><b>' + esc(av.emoji) + '</b></div>' +
            '<div class="dxsoc-pinfo">' +
              '<div class="dxsoc-pname">@' + esc(nick) +
                (admin ? ' <span class="dxsoc-crown" title="Владелец биржи">👑</span>' : '') +
              '</div>' +
              '<div class="dxsoc-pbio">' + (bio ? esc(bio) : '<span class="dxsoc-muted">Без био</span>') + '</div>' +
              '<div class="dxsoc-pmeta">' +
                '<span>📅 на бирже с ' + esc(since || '—') + '</span>' +
                '<span>💼 ' + (wallet ? 'кошелёк ' + esc(wallet) : 'кошелёк не привязан') + '</span>' +
                (admin ? '<span class="dxsoc-admin">👑 админ</span>' : '') +
              '</div>' +
            '</div>' +
            '<div class="dxsoc-pacts">' + actions + '</div>' +
          '</div>' +
          showcaseHtml +
          '<div class="dxsoc-stats">' + stats + '</div>' +
        '</div>'
    };
  }

  function editHtml(p, self) {
    if (!self) return '';

    var bio = state.edit.bio;
    var av = { emoji: state.edit.emoji, color: state.edit.color };

    var emojiBtns = EMOJI.map(function (e) {
      return '<button type="button" class="dxsoc-emoji' + (e === av.emoji ? ' on' : '') + '" ' +
        'data-dxs-emoji="' + esc(e) + '" aria-label="Аватар ' + esc(e) + '">' + esc(e) + '</button>';
    }).join('');

    var colorBtns = COLORS.map(function (c) {
      return '<button type="button" class="dxsoc-color' + (c.toLowerCase() === String(av.color).toLowerCase() ? ' on' : '') + '" ' +
        'data-dxs-color="' + esc(c) + '" style="background:' + safeColor(c) + '" aria-label="Цвет ' + esc(c) + '"></button>';
    }).join('');

    var hide = state.privacy.hideBalance;
    var priv = state.privacy.private;

    return '<div class="dxsoc-card glass dxsoc-edit" id="dxsProfileEdit">' +
      '<div class="dxsoc-edithead">✏ Настройки профиля</div>' +
      '<div class="dxsoc-editgrid">' +
        '<div>' +
          '<label class="dx-lbl" for="dxsBio">Био · до 120 символов</label>' +
          '<textarea class="dx-inp dxsoc-bio" id="dxsBio" maxlength="120" placeholder="Расскажи о себе…" spellcheck="false">' + esc(bio) + '</textarea>' +
          '<div class="dxsoc-count"><span id="dxsBioCount">' + esc(String(bio.length)) + '</span>/120</div>' +
          '<div class="dx-acts"><button class="btn primary" type="button" data-dxs-act="save-profile">Сохранить</button></div>' +
        '</div>' +
        '<div>' +
          '<span class="dx-lbl">Аватар</span>' +
          '<div class="dxsoc-emojis">' + emojiBtns + '</div>' +
          '<div class="dxsoc-colors">' + colorBtns + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="dxsoc-privacy">' +
        '<label class="dxsoc-switch">' +
          '<input type="checkbox" data-dxs-priv="hideBalance"' + (hide ? ' checked' : '') + '>' +
          '<span class="dxsoc-track"><i></i></span>' +
          '<span class="dxsoc-switch-txt">Скрыть капитал<small>другие увидят «скрыто» вместо суммы</small></span>' +
        '</label>' +
        '<label class="dxsoc-switch">' +
          '<input type="checkbox" data-dxs-priv="private"' + (priv ? ' checked' : '') + '>' +
          '<span class="dxsoc-track"><i></i></span>' +
          '<span class="dxsoc-switch-txt">Закрытый профиль<small>карточка и подписки видны только тебе</small></span>' +
        '</label>' +
      '</div>' +
      '<div class="dx-hint">Приватность сохраняется сразу, био и аватар — по кнопке «Сохранить».</div>' +
    '</div>';
  }

  function followBoxHtml() {
    var tab = state.profileTab === 'following' ? 'following' : 'followers';
    return '<div class="dxsoc-followbox">' +
      '<div class="dx-seg dxsoc-followseg" id="dxsFollowSeg">' +
        '<i data-dxs-tab="followers" role="button" tabindex="0"' + (tab === 'followers' ? ' class="on"' : '') + '>Подписчики</i>' +
        '<i data-dxs-tab="following" role="button" tabindex="0"' + (tab === 'following' ? ' class="on"' : '') + '>Подписки</i>' +
      '</div>' +
      '<div class="log dxsoc-people glass goldline" id="dxsFollowList">' + loadingHtml('Загружаю список…') + '</div>' +
      '<div id="dxsFollowMore"></div>' +
    '</div>';
  }

  function renderProfile(p, nick) {
    var box = byId('dxsProfileBody');
    if (!box) return;

    var self = isSelfProfile(p, nick);
    var bio = profileBio(p);
    var av = avatarInfo(p);

    state.edit = { bio: bio, emoji: av.emoji, color: av.color };
    state.privacy = {
      hideBalance: boolField(p, ['hideBalance', 'hide_balance', 'hideCapital', 'capitalHidden']),
      private: boolField(p, ['private', 'isPrivate', 'is_private', 'closed'])
    };

    var card = profileCardHtml(p, nick, self);
    setProfileHero(card.hint);

    box.innerHTML =
      card.html +
      editHtml(p, self) +
      followBoxHtml() +
      '<div class="block-title">🕒 Последние события <span class="cnt">последние 15</span></div>' +
      '<div id="dxsProfileEvents">' + loadingHtml('Загружаю события…') + '</div>';

    loadShowcase(p, nick);
    activeFollowTabUpdate();

    var slot = state.lists[state.profileTab];
    if (slot.loaded || slot.items.length) renderFollowList();
    else loadFollowList(true);

    loadProfileEvents(nick);
  }

  /* --------------------------------------------------------- профиль: подписки */

  function activeFollowTabUpdate() {
    var seg = byId('dxsFollowSeg');
    if (!seg) return;
    each(seg.children, function (item) {
      item.classList.toggle('on', item.getAttribute('data-dxs-tab') === state.profileTab);
    });
  }

  function switchFollowTab(tab) {
    if (tab !== 'followers' && tab !== 'following') return;
    if (state.profileTab === tab) return;
    state.profileTab = tab;
    activeFollowTabUpdate();
    var slot = state.lists[tab];
    if (slot.loaded || slot.items.length) renderFollowList();
    else loadFollowList(true);
  }

  function followEmptyText() {
    return state.profileTab === 'following' ? 'Пока ни на кого не подписан.' : 'Пока никто не подписался.';
  }

  function renderFollowList() {
    var box = byId('dxsFollowList');
    if (!box) return;
    var slot = state.lists[state.profileTab];

    if (slot.busy && !slot.items.length) {
      box.innerHTML = loadingHtml('Загружаю список…');
      renderFollowMore();
      return;
    }
    if (!slot.items.length) {
      box.innerHTML = '<div class="empty">' + esc(followEmptyText()) + '</div>';
      renderFollowMore();
      return;
    }

    var html = slot.items.map(function (item) {
      var person = (item && item.profile && typeof item.profile === 'object') ? item.profile : item;
      var nick = nickOf(person) || nickOf(item);
      if (!nick) return '';
      var av = avatarInfo(person);
      var bio = String(firstField(person, ['bio', 'about', 'description']) || '');
      var admin = profileAdmin(person);
      return '<div class="dxsoc-person" data-dxs-nick="' + esc(nick) + '" role="button" tabindex="0">' +
        '<span class="dxsoc-mini-ava" style="background:' + av.color + '">' + esc(av.emoji) + '</span>' +
        '<span class="dxsoc-person-main">' +
          '<span class="dxsoc-person-nick">@' + esc(nick) + (admin ? ' 👑' : '') + '</span>' +
          '<span class="dxsoc-person-bio">' + esc(bio || 'игрок DE Exchange') + '</span>' +
        '</span>' +
        '<span class="dxsoc-person-go">›</span>' +
      '</div>';
    }).join('');

    box.innerHTML = html || '<div class="empty">' + esc(followEmptyText()) + '</div>';
    renderFollowMore();
  }

  function renderFollowMore() {
    var box = byId('dxsFollowMore');
    if (!box) return;
    var slot = state.lists[state.profileTab];
    if (!slot.hasMore) { box.innerHTML = ''; return; }
    box.innerHTML = '<div class="dxsoc-more"><button class="btn ghost small" type="button" data-dxs-act="follow-more"' +
      (slot.busy ? ' disabled' : '') + '>' + (slot.busy ? 'Загружаю…' : 'Ещё ' + PAGE) + '</button></div>';
  }

  function loadFollowList(reset) {
    var nick = state.profileNick;
    var tab = state.profileTab;
    if (!nick) return;

    var slot = state.lists[tab];
    if (slot.busy) return;
    if (!reset && (slot.done || slot.loaded && !slot.hasMore)) return;

    if (reset) {
      slot.items = [];
      slot.offset = 0;
      slot.done = false;
      slot.loaded = false;
      slot.hasMore = true;
    }

    slot.busy = true;
    renderFollowList();

    var path = '/api/' + tab + '?nick=' + encodeURIComponent(nick) +
      '&limit=' + PAGE + '&offset=' + slot.offset;
    var seq = ++state.seq.followList;

    api('GET', path, null, function (res) {
      /* устаревший ответ всё равно снимает busy со своего слота,
         иначе вкладка может навсегда остаться в состоянии «Загружаю…» */
      if (seq !== state.seq.followList) { slot.busy = false; return; }
      if (norm(state.profileNick) !== norm(nick) || state.profileTab !== tab) {
        slot.busy = false;
        return;
      }

      slot.busy = false;
      if (!okRes(res)) {
        var msg = errText(res);
        if (reset || !slot.items.length) {
          slot.loaded = true;
          slot.done = true;
          slot.hasMore = false;
          var box = byId('dxsFollowList');
          if (box) box.innerHTML = errorHtml(msg);
        } else {
          /* уже загруженную часть списка не выбрасываем — можно повторить */
          renderFollowList();
        }
        renderFollowMore();
        say(msg, 'bad');
        return;
      }

      var page = asList(res.body, [tab, 'list', 'users', 'items', 'people', 'rows']);
      page.forEach(function (item) {
        var person = (item && item.profile && typeof item.profile === 'object') ? item.profile : item;
        var n = nickOf(person) || nickOf(item);
        if (!n) return;
        var exists = slot.items.some(function (old) {
          var op = (old && old.profile && typeof old.profile === 'object') ? old.profile : old;
          return norm(nickOf(op) || nickOf(old)) === norm(n);
        });
        if (!exists) slot.items.push(item);
      });

      slot.offset = slot.items.length;
      slot.loaded = true;

      var total = null;
      var body = res.body || {};
      var totalRaw = rawField(body, ['total', 'count']);
      if (totalRaw !== undefined && totalRaw !== null && !Array.isArray(totalRaw)) {
        var tn = Number(totalRaw);
        if (isFinite(tn)) total = tn;
      }

      if (total !== null) {
        slot.hasMore = slot.items.length < total;
      } else {
        slot.hasMore = page.length === PAGE;
      }
      slot.done = !slot.hasMore;

      renderFollowList();
    });
  }

  /* -------------------------------------------------------- профиль: события */

  function renderEventList(box, list) {
    if (!box) return;
    box.innerHTML = '';
    if (!list.length) {
      box.innerHTML = '<div class="empty">Событий пока нет.</div>';
      return;
    }
    var log = el('div', 'log dxsoc-log glass goldline');
    list.forEach(function (ev) {
      if (typeof ev === 'string') ev = { text: ev };
      if (!ev || typeof ev !== 'object') return;
      log.appendChild(eventRow(ev));
    });
    box.appendChild(log);
  }

  function loadProfileEvents(nick) {
    var box = byId('dxsProfileEvents');
    if (!box || !nick) return;

    var seq = ++state.seq.followEvents;
    api('GET', '/api/feed?nick=' + encodeURIComponent(nick) + '&limit=' + PROFILE_FEED_LIMIT, null, function (res) {
      if (seq !== state.seq.followEvents) return;
      if (norm(state.profileNick) !== norm(nick)) return;
      if (!okRes(res)) {
        var msg = errText(res);
        box.innerHTML = errorHtml(msg);
        if (Number(res && res.code) !== 403) say(msg, 'bad');
        return;
      }
      var list = asList(res.body, ['feed', 'events', 'list', 'items']).slice(0, PROFILE_FEED_LIMIT);
      renderEventList(box, list);
    });
  }

  /* ---------------------------------------------------------- витрина профиля */

  function showcaseList(value) {
    if (Array.isArray(value)) return value.slice(0, 20);
    if (typeof value === 'string' && value.trim()) {
      return value.split(/[,\s]+/).filter(function (item) { return !!item; }).slice(0, 20);
    }
    return [];
  }

  function showcaseSource(body) {
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) { return null; }
    }
    if (!body || typeof body !== 'object') return null;

    var src = body.show;
    if (!src || typeof src !== 'object') src = body.showcase;
    if (!src || typeof src !== 'object') src = body.data;
    if (!src || typeof src !== 'object') src = body;
    if (src && typeof src === 'object' && src.show && typeof src.show === 'object') src = src.show;
    return (src && typeof src === 'object') ? src : null;
  }

  function parseShowcase(body) {
    var src = showcaseSource(body);
    if (!src) return { home: null, wear: [], stands: [] };

    var home = src.home;
    if (home && typeof home === 'object') home = home.id || home.key || home.name || '';
    home = (home === null || home === undefined || home === '') ? null : (String(home).trim() || null);

    return {
      home: home,
      wear: showcaseList(src.wear),
      stands: showcaseList(src.stands)
    };
  }

  function clearShowcaseBox(box) {
    if (!box) return;
    try {
      if (window.dxScene && typeof window.dxScene.clear === 'function') window.dxScene.clear(box);
    } catch (e) { /* сцена не должна ломать профиль */ }
    try { box.innerHTML = ''; } catch (e2) { /* ignore */ }
    if (box.classList) box.classList.remove('dxs-host');
  }

  function setShowcaseEmpty(title, hint, showButton) {
    var box = byId('dxSceneBox');
    var empty = byId('dxSceneEmpty');
    var actions = byId('dxSceneActions');
    var button = byId('dxSceneEmptyBtn');
    var t = byId('dxSceneEmptyTitle');
    var h = byId('dxSceneEmptyHint');

    if (box) {
      box.style.display = 'none';
      if (box.classList) box.classList.remove('dxsoc-scene-ready');
    }
    if (empty) {
      empty.hidden = false;
      if (t) t.textContent = title;
      if (h) h.textContent = hint;
    }
    if (actions) actions.hidden = true;
    if (button) button.hidden = !showButton;
  }

  function renderShowcase(box, p, nick, show) {
    if (!box || byId('dxSceneBox') !== box) return false;
    if (!window.dxScene || typeof window.dxScene.render !== 'function') return false;

    clearShowcaseBox(box);
    try {
      return !!window.dxScene.render(box, {
        nick: nick,
        home: (show && show.home) || null,
        wear: (show && show.wear) || [],
        stands: (show && show.stands) || [],
        avatar: avatarInfo(p)
      });
    } catch (e) {
      if (window.console && typeof console.error === 'function') console.error('[social] витрина', e);
      return false;
    }
  }

  function applyShowcase(p, nick, show) {
    var box = byId('dxSceneBox');
    if (!box) return;

    var self = isSelfProfile(p, nick);
    var canEdit = !!(self && window.dxProfileEditor && typeof window.dxProfileEditor.open === 'function');

    if (!window.dxScene || typeof window.dxScene.render !== 'function') {
      setShowcaseEmpty('Витрина недоступна', 'Модуль сцены не подключён', false);
      return;
    }

    if (!show || !show.home) {
      setShowcaseEmpty(
        'Витрина не настроена',
        self ? 'Выбери квартиру, украшения и номера' : 'Игрок ещё не выбрал квартиру',
        canEdit
      );
      return;
    }

    var empty = byId('dxSceneEmpty');
    if (empty) empty.hidden = true;
    box.style.display = '';
    if (box.classList) box.classList.add('dxsoc-scene-ready');

    if (renderShowcase(box, p, nick, show)) {
      var actions = byId('dxSceneActions');
      if (actions) actions.hidden = !canEdit;
      return;
    }

    /* сцена не смогла отрисоваться — не оставляем пустой тёмный прямоугольник */
    setShowcaseEmpty('Витрина недоступна', 'Не удалось показать сцену', false);
  }

  function loadShowcase(p, nick) {
    var box = byId('dxSceneBox');
    if (!box || !nick) return;
    /* если scene-модуль не подключён — контейнер остаётся пустым */
    if (!window.dxScene || typeof window.dxScene.render !== 'function') return;

    var seq = ++state.seq.showcase;
    clearShowcaseBox(box);
    setShowcaseEmpty('Загружаю витрину…', 'Квартира, украшения и номера', false);

    var empty = byId('dxSceneEmpty');
    if (empty) {
      try { empty.setAttribute('aria-busy', 'true'); } catch (e) { /* ignore */ }
    }

    api('GET', '/api/showcase?nick=' + encodeURIComponent(nick), null, function (res) {
      if (seq !== state.seq.showcase) return;
      if (byId('dxSceneBox') !== box) return;
      if (norm(state.profileNick) !== norm(nick)) return;

      if (empty) {
        try { empty.removeAttribute('aria-busy'); } catch (e) { /* ignore */ }
      }

      /* 404/ошибка/offline = пустая витрина; профиль уже нарисован */
      var show = { home: null, wear: [], stands: [] };
      if (okRes(res)) show = parseShowcase(res.body);
      applyShowcase(p, nick, show);
    });
  }

  function openShowcaseEditor() {
    var editor = window.dxProfileEditor;
    if (!editor || typeof editor.open !== 'function') {
      say('Редактор витрины недоступен', 'bad');
      return;
    }
    var me = myNick();
    if (!me) { say('Войди в аккаунт', 'bad'); return; }

    try {
      editor.open({
        nick: me,
        onSaved: function () {
          /* перерисовка профиля заново запросит витрину и соберёт сцену */
          if (state.profileNick && isMe(state.profileNick)) {
            loadProfile(state.profileNick, { silent: true });
          }
        }
      });
    } catch (e) {
      if (window.console && typeof window.console.error === 'function') console.error('[social] редактор витрины', e);
      say('Не удалось открыть редактор витрины', 'bad');
    }
  }

  /* --------------------------------------------------------- профиль: действия */

  function focusEditor() {
    var panel = byId('dxsProfileEdit');
    if (panel && panel.scrollIntoView) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    var bio = byId('dxsBio');
    if (bio) setTimeout(function () { try { bio.focus(); } catch (e) { /* ignore */ } }, 220);
  }

  function saveProfile(btn) {
    var a = acc();
    var p = state.profileData;
    if (!a) { say('Войди в аккаунт', 'bad'); return; }
    if (!p || !isMe(state.profileNick)) { say('Редактировать можно только свой профиль', 'bad'); return; }

    var ta = byId('dxsBio');
    var bio = ta ? String(ta.value || '') : state.edit.bio;
    bio = bio.slice(0, 120);

    var avatar = { emoji: state.edit.emoji, color: safeColor(state.edit.color) };
    var nick = myNick() || state.profileNick;

    if (btn) {
      btn.disabled = true;
      btn.setAttribute('data-dxs-oldtext', btn.textContent);
      btn.textContent = 'Сохраняю…';
    }

    api('POST', '/api/profile', {
      nick: nick,
      pass: a.pass || '',
      bio: bio,
      avatar: avatar
    }, function (res) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = btn.getAttribute('data-dxs-oldtext') || 'Сохранить';
      }
      if (!okRes(res)) { say(errText(res), 'bad'); return; }
      say('Профиль обновлён', 'info');
      /* если человек уже ушёл на другой экран/профиль — не дёргаем его обратно */
      if (state.active === 'profile' && isMe(state.profileNick)) {
        loadProfile(state.profileNick, { silent: true });
      }
    });
  }

  function toggleFollow(btn) {
    var a = acc();
    var p = state.profileData;
    var target = state.profileNick;
    if (!a) { say('Войди, чтобы подписаться', 'bad'); return; }
    if (!p || !target) return;
    if (isMe(target)) return;

    var followed = isFollowingProfile(p);
    var path = followed ? '/api/unfollow' : '/api/follow';
    var oldText = btn ? btn.textContent : '';

    if (btn) {
      btn.disabled = true;
      btn.textContent = followed ? 'Отписываю…' : 'Подписываюсь…';
    }

    api('POST', path, {
      nick: myNick(),
      pass: a.pass || '',
      target: target
    }, function (res) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = oldText;
      }
      if (!okRes(res)) { say(errText(res), 'bad'); return; }

      var now = res.body ? rawField(res.body, ['following', 'isFollowing', 'is_following', 'subscribed']) : undefined;
      if (typeof now !== 'boolean') now = !followed;
      /* не трогаем p.following: это число подписок, а не признак подписки */
      p.isFollowing = now;

      say(now ? ('Ты подписан на @' + target) : ('Ты отписался от @' + target), 'info');
      /* перезагружаем цифры только если всё ещё смотрим этот профиль */
      if (state.active === 'profile' && norm(state.profileNick) === norm(target)) {
        loadProfile(target, { silent: true });
      }
    });
  }

  function savePrivacy(input, key) {
    var a = acc();
    if (!a || !isMe(state.profileNick)) { say('Настройки доступны только своему профилю', 'bad'); return; }

    var owner = state.profileNick;
    var prev = !!state.privacy[key];
    var val = !!input.checked;
    if (prev === val) return;

    var hb = document.querySelector('[data-dxs-priv="hideBalance"]');
    var pv = document.querySelector('[data-dxs-priv="private"]');

    var body = {
      nick: myNick() || state.profileNick,
      pass: a.pass || '',
      hideBalance: hb ? !!hb.checked : state.privacy.hideBalance,
      private: pv ? !!pv.checked : state.privacy.private
    };

    state.privacy[key] = val;
    if (hb) hb.disabled = true;
    if (pv) pv.disabled = true;

    api('POST', '/api/privacy', body, function (res) {
      if (hb) hb.disabled = false;
      if (pv) pv.disabled = false;
      if (!okRes(res)) {
        state.privacy[key] = prev;
        input.checked = prev;
        say(errText(res), 'bad');
        return;
      }
      state.privacy.hideBalance = body.hideBalance;
      state.privacy.private = body.private;
      if (state.profileData && norm(state.profileNick) === norm(owner)) {
        state.profileData.hideBalance = body.hideBalance;
        state.profileData.private = body.private;
      }
      say('Приватность обновлена', 'info');
    });
  }

  /* ------------------------------------------------------------------- лента */

  function renderFeed() {
    var box = byId('dxsFeedBody');
    if (!box) return;

    if (!state.feed.length) {
      box.innerHTML = '<div class="dx-empty">Пока тихо. Первые сделки и подписки появятся здесь.</div>';
      return;
    }

    var log = el('div', 'log dxsoc-log glass goldline');
    state.feed.forEach(function (ev) {
      if (typeof ev === 'string') ev = { text: ev };
      if (!ev || typeof ev !== 'object') return;
      log.appendChild(eventRow(ev));
    });
    box.innerHTML = '';
    box.appendChild(log);
  }

  function setFeedStat(text, isError) {
    var s = byId('dxsFeedStat');
    if (!s) return;
    s.textContent = text;
    s.className = 'dxsoc-feedstat' + (isError ? ' dxsoc-err' : '');
  }

  function loadFeed(opts) {
    opts = opts || {};
    if (state.feedBusy) return;

    var box = byId('dxsFeedBody');
    if (!box) return;

    state.feedBusy = true;
    if (!state.feed.length || !opts.silent) {
      box.innerHTML = loadingHtml('Загружаю ленту…');
      setFeedStat('загружаю…', false);
    }

    var seq = ++state.seq.feed;
    api('GET', '/api/feed?limit=' + FEED_LIMIT, null, function (res) {
      if (seq !== state.seq.feed) return;
      state.feedBusy = false;

      if (!okRes(res)) {
        var msg = errText(res);
        if (state.feed.length) renderFeed();          // показываем старую ленту, а не вечную загрузку
        else box.innerHTML = errorHtml(msg);
        setFeedStat(state.feed.length ? ('нет связи · данные от ' + clockText(new Date(state.feedAt))) : msg, true);
        if (!opts.silent) say(msg, 'bad');
        return;
      }

      var list = asList(res.body, ['feed', 'events', 'list', 'items']).filter(function (ev) {
        return ev && (typeof ev === 'object' || typeof ev === 'string');
      });
      state.feed = list;
      state.feedAt = Date.now();
      renderFeed();
      setFeedStat('обновлено ' + clockText(new Date(state.feedAt)) + ' · ' + list.length + ' событий', false);
    });
  }

  /* --------------------------------------------------------------------- топ */

  function validTopBy(by) {
    return by === 'capital' || by === 'followers' || by === 'trades' ? by : 'capital';
  }

  function topMetricLabel(by) {
    if (by === 'followers') return 'Подписчики';
    if (by === 'trades') return 'Сделки';
    return 'Капитал';
  }

  function topMetricText(row, by, self) {
    if (by === 'followers') return fmtCount(countField(row, ['followers', 'followersCount', 'followers_count', 'subscribers', 'subs']));
    if (by === 'trades') return fmtCount(countField(row, ['trades', 'tradesCount', 'trades_count', 'deals']));

    var cap = rawField(row, ['capital', 'netWorth', 'net_worth', 'balance', 'totalBalance']);
    if (cap === null || cap === '') return 'скрыто';
    if (!self && boolField(row, ['hideBalance', 'hide_balance', 'hideCapital', 'capitalHidden'])) return 'скрыто';
    return cap === undefined ? '—' : fmtMoney(cap);
  }

  function topDelta(row) {
    var raw = rawField(row, ['delta7', 'delta_7', 'delta7d', 'delta_7d', 'delta7Pct', 'delta7_pct',
      'change7', 'change_7', 'change7d', 'change_7d', 'd7', 'growth7', 'growth_7', 'weekChange']);
    if (raw === undefined || raw === null || raw === '') return { text: '—', cls: 'flat' };

    var s = String(raw).trim();
    var n = parseFloat(s.replace(/\s/g, '').replace('%', '').replace(',', '.'));
    if (!isFinite(n)) return { text: s.slice(0, 12), cls: 'flat' };

    if (n > 0) return { text: '+' + n.toFixed(1).replace('.', ',') + '%', cls: 'up' };
    if (n < 0) return { text: n.toFixed(1).replace('.', ',') + '%', cls: 'down' };
    return { text: '0%', cls: 'flat' };
  }

  function mergeObjects(a, b) {
    var out = {}, k;
    if (typeof a === 'string') a = { nick: a };
    if (typeof b === 'string') b = { nick: b };
    if (!a || typeof a !== 'object') a = {};
    if (!b || typeof b !== 'object') b = {};
    for (k in a) if (hasOwn(a, k)) out[k] = a[k];
    for (k in b) if (hasOwn(b, k)) out[k] = b[k];
    return out;
  }

  /* строка топа может быть плоской или вида { profile: {...}, metric: ... } */
  function rowPerson(row) {
    if (row && typeof row === 'object' && row.profile && typeof row.profile === 'object') {
      return mergeObjects(row, row.profile);
    }
    return row;
  }

  function topRank(row, fallback) {
    row = rowPerson(row);
    var raw = rawField(row, ['rank', 'place', 'position', 'top', 'place_num']);
    if (raw === undefined || raw === null || raw === '') return fallback || '';
    var n = parseInt(String(raw).replace(/[^\d-]/g, ''), 10);
    return isFinite(n) && n > 0 ? n : (fallback || '');
  }

  function topRowHtml(row, rank, self) {
    row = rowPerson(row);
    var nick = nickOf(row) || '—';
    var av = avatarInfo(row);
    var admin = profileAdmin(row);
    var followers = countField(row, ['followers', 'followersCount', 'followers_count', 'subscribers', 'subs']);
    var metric = topMetricText(row, state.topBy, self);
    var delta = topDelta(row);
    var rankText = rank ? ('#' + rank) : '—';
    var rankCls = rank === 1 || rank === '1' ? ' r1' : rank === 2 || rank === '2' ? ' r2' : rank === 3 || rank === '3' ? ' r3' : '';
    var deltaAttr = delta.text === undefined ? '' : delta.text;

    return '<div class="dxsoc-toprow' + (self ? ' self' : '') + '" data-dxs-nick="' + esc(nick === '—' ? '' : nick) + '" role="button" tabindex="0">' +
      '<span class="dxsoc-rank' + rankCls + '">' + esc(rankText) + '</span>' +
      '<span class="dxsoc-player">' +
        '<span class="dxsoc-mini-ava" style="background:' + av.color + '">' + esc(av.emoji) + '</span>' +
        '<span class="dxsoc-nick">@' + esc(nick) + (admin ? ' 👑' : '') + '</span>' +
      '</span>' +
      '<span class="dxsoc-metric">' + esc(metric) + '</span>' +
      '<span class="dxsoc-followers dxsoc-col-followers">' + esc(fmtCount(followers)) + '</span>' +
      '<span class="dxsoc-delta ' + delta.cls + '">' + esc(deltaAttr) + '</span>' +
    '</div>';
  }

  function topSegUpdate() {
    var seg = byId('dxsTopSeg');
    if (!seg) return;
    each(seg.children, function (item) {
      item.classList.toggle('on', item.getAttribute('data-dxs-top') === state.topBy);
    });
  }

  function renderTopPinned(p) {
    var slot = byId('dxsTopSelfSlot');
    if (!slot) return;
    var rank = profileRank(p);
    var label = 'твоё место' + (rank ? ' · #' + rank : '');
    slot.className = 'dxsoc-pinnedwrap';
    slot.innerHTML = '<div class="dxsoc-pinnedlbl">' + esc(label) + '</div>' +
      '<div class="glass goldline dxsoc-table">' +
        topRowHtml(p, rank, true) +
      '</div>';
  }

  /* если сервер не прислал свою строку и в топ мы не попали —
     аккуратно дозагружаем свой профиль только для закреплённой строки */
  function loadTopSelf(me, by, seq) {
    api('GET', profilePath(me), null, function (res) {
      if (seq !== state.seq.top) return;
      if (state.topBy !== by || state.active !== 'top') return;
      if (norm(myNick()) !== norm(me)) return;
      if (!okRes(res)) return;
      var p = pickProfile(res.body);
      if (!p || norm(nickOf(p)) !== norm(me)) return;
      renderTopPinned(p);
    });
  }

  function loadTop(by, opts) {
    opts = opts || {};
    by = validTopBy(by);
    state.topBy = by;
    topSegUpdate();

    /* если уже грузим этот же срез — не дублируем; при смене среза грузим новый */
    if (state.topBusy && state.topLoadingBy === by) return;
    var box = byId('dxsTopBody');
    if (!box) return;

    state.topBusy = true;
    state.topLoadingBy = by;
    if (!opts.silent) box.innerHTML = loadingHtml('Считаю топ…');

    var seq = ++state.seq.top;
    api('GET', '/api/top?by=' + encodeURIComponent(by), null, function (res) {
      if (seq !== state.seq.top) return;
      state.topBusy = false;
      state.topLoadingBy = '';

      if (!okRes(res)) {
        var msg = errText(res);
        box.innerHTML = errorHtml(msg);
        say(msg, 'bad');
        return;
      }

      var body = res.body || {};
      var rows = asList(body, ['list', 'top', 'users', 'items', 'rows', 'players']).filter(function (row) {
        return !!row && (typeof row === 'object' || typeof row === 'string');
      });
      var selfRow = body.me || body.self || body.my || body.you || null;
      var me = myNick();

      /* ищем себя в списке: отдельная строка body.me тоже поддерживается */
      var selfIndex = -1;
      if (me) {
        rows.forEach(function (r, i) {
          if (norm(nickOf(rowPerson(r))) === norm(me)) selfIndex = i;
        });
      }

      /* своя строка остаётся в общем списке — иначе первый в списке чужой
         игрок получал номер #1 и выглядел «первым местом» */
      var pinned = null;
      if (selfIndex < 0) {
        if (selfRow && typeof selfRow === 'object' && me) {
          pinned = mergeObjects(rowPerson(selfRow), {});
          pinned.__rank = topRank(selfRow, '');
        } else if (me && state.profileData && norm(nickOf(state.profileData)) === norm(me)) {
          /* сервер не вернул отдельную строку — покажем закреплённым свой профиль */
          pinned = mergeObjects(state.profileData, {});
          pinned.__rank = topRank(pinned, '');
        }
      }

      if (!rows.length && !pinned && !me) {
        box.innerHTML = '<div class="dx-empty">Топ пока пуст.</div>';
        return;
      }

      var html = '<div class="glass goldline dxsoc-table">' +
        '<div class="dxsoc-thead">' +
          '<span>#</span>' +
          '<span>Игрок</span>' +
          '<span>' + esc(topMetricLabel(by)) + '</span>' +
          '<span class="dxsoc-col-followers">Подписчики</span>' +
          '<span>Δ7</span>' +
        '</div>' +
        rows.map(function (row, i) {
          /* нумеруем по серверному месту, иначе — по позиции; своя строка
             остаётся на своём месте и просто подсвечивается */
          return topRowHtml(row, topRank(row, i + 1), i === selfIndex);
        }).join('') +
      '</div>';

      if (pinned) {
        var pinnedRank = pinned.__rank || '';
        var pinnedLabel = 'твоё место' + (pinnedRank ? ' · #' + pinnedRank : '');
        html += '<div class="dxsoc-pinnedwrap">' +
          '<div class="dxsoc-pinnedlbl">' + esc(pinnedLabel) + '</div>' +
          '<div class="glass goldline dxsoc-table">' +
            topRowHtml(pinned, pinnedRank, true) +
          '</div>' +
        '</div>';
      } else if (me) {
        html += '<div id="dxsTopSelfSlot"></div>';
      }

      box.innerHTML = html;
      if (!pinned && me) loadTopSelf(me, by, seq);
    });
  }

  /* -------------------------------------------------------- события: одна строка */

  function eventType(ev) {
    var raw = String(firstField(ev, ['type', 'kind', 'action', 'event', 'what']) || '').toLowerCase();
    return raw.replace(/[^a-z0-9_-]/g, '');
  }

  function eventMeta(ev) {
    var type = eventType(ev);
    var base = EVENT_META[type] || { icon: '•', tone: 'dim' };
    var tone = base.tone;
    var serverTone = String(firstField(ev, ['tone', 'color']) || '').toLowerCase();

    if (serverTone === 'up' || serverTone === 'down' || serverTone === 'gold' || serverTone === 'dim') tone = serverTone;

    var n = Number(firstField(ev, ['amount', 'value', 'sum', 'qty', 'price', 'money']));
    if (isFinite(n) && n < 0) tone = 'down';
    else if (!EVENT_META[type] && isFinite(n) && n > 0) tone = 'up';
    return { icon: base.icon, tone: tone };
  }

  function eventAmountText(ev, tone) {
    var ready = firstField(ev, ['amountText', 'amount_text', 'sumText', 'sum_text']);
    if (ready !== undefined) return String(ready).slice(0, 40);

    var raw = firstField(ev, ['amount', 'value', 'sum', 'qty', 'price', 'money']);
    if (raw === undefined || raw === null || raw === '') return '';
    var n = Number(raw);
    if (!isFinite(n) || n === 0) return '';

    var asset = String(firstField(ev, ['asset', 'symbol', 'currency', 'coin', 'token', 'sym']) || 'USDT').slice(0, 12);
    var text = fmtAmount(Math.abs(n)) + ' ' + asset;
    if (n < 0 || tone === 'down') return '−' + text;
    if (tone === 'up') return '+' + text;
    return text;
  }

  function eventLineHtml(ev) {
    var type = eventType(ev);
    var explicitActor = String(firstField(ev, ['nick', 'actor', 'user', 'login', 'by']) || '')
      .replace(/^@+/, '').trim();
    var from = fromOf(ev);
    var target = targetOf(ev);
    var actor = explicitActor || actorOf(ev);

    /* у события «получил» действующее лицо — получатель, а не отправитель */
    if ((type === 'receive' || type === 'received' || type === 'deposit') && !explicitActor && target) {
      actor = target;
      target = from || actorOf(ev);
    }

    var asset = String(firstField(ev, ['asset', 'symbol', 'currency', 'coin', 'token', 'sym']) || '').slice(0, 12);
    var rawType = String(firstField(ev, ['type', 'kind', 'action', 'event']) || '').slice(0, 24);

    var html = actor ? nickLink(actor) : '<span class="dxsoc-muted">Кто-то</span>';

    if (type === 'follow') {
      html += ' подписался на ' + personHtml(target || from);
    } else if (type === 'unfollow') {
      html += ' отписался от ' + personHtml(target || from);
    } else if (type === 'receive' || type === 'received' || type === 'deposit') {
      html += ' — получил' + ((from || target) ? ' от ' + personHtml(from || target) : '');
    } else if (type === 'transfer' || type === 'send') {
      html += ' — перевёл' + (target ? ' → ' + personHtml(target) : '');
    } else if (type === 'gift' || type === 'tip') {
      html += ' — подарил' + (target ? ' ' + personHtml(target) : '');
    } else if (type === 'buy') {
      html += ' — купил' + (asset ? ' ' + esc(asset) : '');
    } else if (type === 'sell') {
      html += ' — продал' + (asset ? ' ' + esc(asset) : '');
    } else if (type === 'trade') {
      html += ' — закрыл сделку' + (asset ? ' · ' + esc(asset) : '');
    } else if (type === 'win') {
      html += ' — выиграл';
    } else if (type === 'lose' || type === 'loss') {
      html += ' — потерял';
    } else if (type === 'level' || type === 'levelup' || type === 'level_up') {
      html += ' — новый уровень';
    } else if (type === 'register') {
      html += ' — присоединился к бирже';
    } else if (type === 'nft' || type === 'mint') {
      html += ' — NFT' + (target ? ' · ' + personHtml(target) : '');
    } else {
      var label = rawType || type || 'событие';
      html += ' — ' + esc(label);
      if (target) html += ' · ' + personHtml(target);
    }

    /* событие без актёра, но с целью — покажем хотя бы цель */
    if (!actor && target) html = personHtml(target) + ' — событие';

    return html;
  }

  function eventRow(ev) {
    var meta = eventMeta(ev);
    var row = el('div', 'logrow dxsoc-eventrow');

    row.appendChild(el('span', 't', eventTimeText(ev) || '—'));

    var icon = el('span', 'side dxsoc-event-icon dxsoc-tone-' + meta.tone, meta.icon);
    if (meta.tone === 'up') icon.className += ' buy';
    if (meta.tone === 'down') icon.className += ' sell';
    row.appendChild(icon);

    var q = el('span', 'q');
    var text = firstField(ev, ['text', 'message', 'title', 'description', 'desc']);
    var actor = String(firstField(ev, ['nick', 'actor', 'user', 'login', 'by']) || '').replace(/^@+/, '').trim();
    if (text !== undefined && String(text).trim()) {
      /* кто это сделал: для событий без @ника в тексте подставляем автора */
      if (actor && String(text).indexOf('@' + actor) < 0) {
        var who = el('span', 'dxsoc-who', '@' + actor);
        who.style.cssText = 'font-weight:900;color:#e26e0a;margin-right:7px';
        q.appendChild(who);
      }
      q.appendChild(document.createTextNode(String(text)));
    } else q.innerHTML = eventLineHtml(ev);
    row.appendChild(q);

    var amount = eventAmountText(ev, meta.tone);
    var tt = el('span', 'tt' + (meta.tone === 'up' ? ' dxsoc-up' : meta.tone === 'down' ? ' dxsoc-down' : ''), amount);
    row.appendChild(tt);

    return row;
  }

  /* ------------------------------------------------------------ обработка кликов */

  function findProfile() {
    var inp = byId('dxsProfileSearch');
    var nick = cleanNick(inp ? inp.value : '');
    if (!nick) {
      say('Введи ник игрока', 'bad');
      if (inp) { try { inp.focus(); } catch (e) { /* ignore */ } }
      return;
    }
    openProfile(nick);
  }

  function goMe() {
    var me = myNick();
    if (!me) {
      renderGuest();
      say('Войди, чтобы увидеть профиль', 'bad');
      return;
    }
    openProfile(me);
  }

  function handleAction(actionEl, section) {
    var act = actionEl.getAttribute('data-dxs-act');
    if (!act) return;

    if (act === 'find') { findProfile(); return; }
    if (act === 'me') { goMe(); return; }
    if (act === 'follow') { toggleFollow(actionEl); return; }
    if (act === 'focus-edit') { focusEditor(); return; }
    if (act === 'edit-showcase') { openShowcaseEditor(); return; }
    if (act === 'save-profile') { saveProfile(actionEl); return; }
    if (act === 'follow-more') { loadFollowList(false); return; }
    if (act === 'feed-refresh') { loadFeed({}); return; }
  }

  function onDocumentClick(e) {
    var target = e.target;
    var section = closest(target, '#view-profile, #view-feed, #view-top');
    if (!section) return;

    var actionEl = closest(target, '[data-dxs-act]');
    if (actionEl) { handleAction(actionEl, section); return; }

    var tabEl = closest(target, '[data-dxs-tab]');
    if (tabEl) { switchFollowTab(tabEl.getAttribute('data-dxs-tab')); return; }

    var topEl = closest(target, '[data-dxs-top]');
    if (topEl) { loadTop(topEl.getAttribute('data-dxs-top'), {}); return; }

    var emojiEl = closest(target, '[data-dxs-emoji]');
    if (emojiEl) {
      var em = emojiEl.getAttribute('data-dxs-emoji');
      if (EMOJI.indexOf(em) !== -1) {
        state.edit.emoji = em;
        each(section.querySelectorAll('.dxsoc-emoji'), function (x) {
          x.classList.toggle('on', x.getAttribute('data-dxs-emoji') === em);
        });
      }
      return;
    }

    var colorEl = closest(target, '[data-dxs-color]');
    if (colorEl) {
      var col = String(colorEl.getAttribute('data-dxs-color') || '').toLowerCase();
      var found = COLORS.some(function (c) { return c.toLowerCase() === col; });
      if (found) {
        state.edit.color = colorEl.getAttribute('data-dxs-color');
        each(section.querySelectorAll('.dxsoc-color'), function (x) {
          x.classList.toggle('on', String(x.getAttribute('data-dxs-color')).toLowerCase() === col);
        });
      }
      return;
    }

    var nickEl = closest(target, '[data-dxs-nick]');
    if (nickEl) {
      var nick = nickEl.getAttribute('data-dxs-nick');
      if (nick) openProfile(nick);
    }
  }

  function onDocumentInput(e) {
    var t = e.target;
    if (t && t.id === 'dxsBio') {
      var value = String(t.value || '').slice(0, 120);
      state.edit.bio = value;
      var counter = byId('dxsBioCount');
      if (counter) counter.textContent = String(value.length);
    }
  }

  function onDocumentChange(e) {
    var t = e.target;
    if (!t) return;
    var key = t.getAttribute && t.getAttribute('data-dxs-priv');
    if (key !== 'hideBalance' && key !== 'private') return;
    if (!closest(t, '#view-profile')) return;
    savePrivacy(t, key);
  }

  function onDocumentKeydown(e) {
    var t = e.target;
    if (!t) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;

    if (t.id === 'dxsProfileSearch' && e.key === 'Enter') {
      e.preventDefault();
      findProfile();
      return;
    }

    var roleEl = closest(t, '[role="button"][tabindex]');
    if (!roleEl) return;
    if (!closest(roleEl, '#view-profile, #view-feed, #view-top')) return;
    if (t.tagName === 'BUTTON' || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return;
    e.preventDefault();
    roleEl.click();
  }

  function bindEvents() {
    document.addEventListener('click', onDocumentClick);
    document.addEventListener('input', onDocumentInput);
    document.addEventListener('change', onDocumentChange);
    document.addEventListener('keydown', onDocumentKeydown);
  }

  /* --------------------------------------------------------------- автообновление */

  function isFeedVisible() {
    var sec = byId('view-feed');
    return state.active === 'feed' && !!sec && sec.classList.contains('show');
  }

  function startFeedTimer() {
    setInterval(function () {
      if (document.hidden) return;
      if (!isFeedVisible()) return;
      if (Date.now() - state.feedAt < FEED_INTERVAL - 1000) return;
      /* подтолкнуть «прямой эфир»: сервер сам решит, пора ли (замок 4 секунды) */
      try { api('GET', '/api/bots/live', null, function () {}); } catch (e) {}
      loadFeed({ silent: true });
    }, FEED_INTERVAL);

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) return;
      if (!isFeedVisible()) return;
      if (Date.now() - state.feedAt > FEED_INTERVAL) loadFeed({ silent: true });
    });
  }

  /* ------------------------------------------------------------------- запуск */

  function syncInitialView() {
    var activeTab = document.querySelector('.tab.active[data-view]');
    if (activeTab) state.active = activeTab.getAttribute('data-view');

    var activeSection = document.querySelector('section.view.show');
    if (activeSection) {
      var id = activeSection.id || '';
      if (id.indexOf('view-') === 0) {
        var name = id.slice(5);
        if (VIEWS.indexOf(name) !== -1) { onViewShown(name); return; }
      }
    }

    var hash = String(location.hash || '').replace(/^#/, '');
    if (VIEWS.indexOf(hash) !== -1 && typeof window.showView === 'function') {
      window.showView(hash);
    }
  }

  function boot() {
    if (state.booted) return;
    if (document.documentElement.getAttribute('data-dxs-social') === '1') return;
    if (!buildSkeleton()) return;

    state.booted = true;
    document.documentElement.setAttribute('data-dxs-social', '1');

    ensureStyle();
    bindEvents();
    installShowViewHook();
    startFeedTimer();
    syncInitialView();

    /* необязательный помощник: обновить текущий экран */
    window.dxSocialRefresh = function () {
      if (state.active === 'profile') {
        if (state.profileNick) loadProfile(state.profileNick, { silent: !!state.profileData });
        else renderGuest();
      } else if (state.active === 'feed') {
        loadFeed({ silent: state.feed.length > 0 });
      } else if (state.active === 'top') {
        loadTop(state.topBy, {});
      }
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
