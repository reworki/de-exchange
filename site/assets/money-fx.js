/* DE Exchange 3.2 · «живые деньги» — монеты, волны, вспышки.
   Один самодостаточный файл, без сборки и внешних зависимостей.
   Наружу отдаём только window.dxFx: coins / trade / count / confetti / flash.

   Правила:
   - координаты берём из getBoundingClientRect (это уже CSS-пиксели вьюпорта),
     слой fixed, поэтому scroll к ним не прибавляем;
   - все ноды живут в одном слое #dx-fx-layer (z-index 9999), после анимации удаляются;
   - одновременно не больше 140 нод эффектов, при переполнении новые не создаются;
   - при document.hidden JS-тикер замирает, CSS-анимации ставятся на паузу;
   - prefers-reduced-motion: reduce отключает полёты, но не dxFx.count;
   - снаружи ничего не бросаем: любая ошибка глушится, чужой DOM не трогаем. */
(function (w, d) {
  'use strict';

  var STYLE_ID = 'dx-fx-style', LAYER_ID = 'dx-fx-layer', MAX_NODES = 140;
  var MAX_COINS = 24, DEFAULT_COINS = 8, GRAVITY = 1100;

  var CSS = [
    '#dx-fx-layer{position:fixed;left:0;top:0;width:100%;height:100%;overflow:hidden;pointer-events:none;z-index:9999}',
    '#dx-fx-layer .dxfx-coin{position:absolute;left:0;top:0;border-radius:50%;box-sizing:border-box;border:1px solid rgba(255,240,190,.9);background:radial-gradient(circle at 34% 28%,#fff8db 0%,#ffeaa9 24%,#f7dca6 46%,#e2a23a 72%,#a86a14 100%);box-shadow:0 0 8px rgba(255,190,90,.85),0 0 16px rgba(255,140,26,.35);transform-origin:50% 50%;backface-visibility:hidden;will-change:transform,opacity}',
    '#dx-fx-layer .dxfx-coin::after{content:"";position:absolute;left:18%;top:18%;right:18%;bottom:18%;border-radius:50%;border:1px solid rgba(122,72,12,.5);box-shadow:inset 0 0 3px rgba(255,240,190,.55)}',
    '#dx-fx-layer .dxfx-spark{position:absolute;left:0;top:0;will-change:transform,opacity;box-shadow:0 0 6px rgba(255,205,120,.6)}',
    '#dx-fx-layer .dxfx-wave{position:fixed;left:0;right:0;bottom:0;height:160px;pointer-events:none;opacity:0;animation:dxfx-wave .3s ease-out forwards}',
    '@keyframes dxfx-wave{0%{opacity:0;transform:translateY(26px) scaleY(.72)}30%{opacity:1;transform:translateY(0) scaleY(1)}100%{opacity:0;transform:translateY(12px) scaleY(1.04)}}',
    '#dx-fx-layer .dxfx-ring{position:fixed;left:50%;top:50%;width:140px;height:140px;margin:-70px 0 0 -70px;border-radius:50%;border:2px solid rgba(255,205,120,.95);box-shadow:0 0 34px rgba(255,170,60,.8),inset 0 0 26px rgba(255,205,120,.45);pointer-events:none;opacity:0;animation:dxfx-ring .62s cubic-bezier(.18,.72,.28,1) forwards}',
    '@keyframes dxfx-ring{0%{opacity:.95;transform:scale(.12)}50%{opacity:.75}100%{opacity:0;transform:scale(1.85)}}',
    '#dx-fx-layer.dxfx-paused .dxfx-wave,#dx-fx-layer.dxfx-paused .dxfx-ring{animation-play-state:paused}',
    '@media (prefers-reduced-motion:reduce){#dx-fx-layer{display:none}}'
  ].join('\n');

  var liveNodes = 0, items = [], tickId = 0, lastTs = 0, clock = 0, mqReduce = null;

  try {
    if (w.matchMedia) mqReduce = w.matchMedia('(prefers-reduced-motion: reduce)');
  } catch (e) { mqReduce = null; }
  function reduced() { return !!(mqReduce && mqReduce.matches); }
  function nowMs() { return (w.performance && w.performance.now) ? w.performance.now() : Date.now(); }

  var raf = (typeof w.requestAnimationFrame === 'function')
    ? function (cb) { return w.requestAnimationFrame(cb); }
    : function (cb) { return w.setTimeout(function () { cb(nowMs()); }, 16); };
  var caf = (typeof w.cancelAnimationFrame === 'function')
    ? function (id) { w.cancelAnimationFrame(id); }
    : function (id) { w.clearTimeout(id); };

  function ensureStyle() {
    try {
      if (d.getElementById(STYLE_ID)) return;
      var st = d.createElement('style');
      st.id = STYLE_ID;
      st.appendChild(d.createTextNode(CSS));
      (d.head || d.documentElement).appendChild(st);
    } catch (e) { /* стили не критичны */ }
  }

  function ensureLayer() {
    try {
      var layer = d.getElementById(LAYER_ID);
      if (layer) return layer;
      ensureStyle();
      layer = d.createElement('div');
      layer.id = LAYER_ID;
      layer.setAttribute('aria-hidden', 'true');
      if (d.hidden) layer.className = 'dxfx-paused';
      (d.body || d.documentElement).appendChild(layer);
      return layer;
    } catch (e) { return null; }
  }

  function syncPaused() {
    try {
      var layer = d.getElementById(LAYER_ID);
      if (!layer || !layer.classList) return;
      if (d.hidden) layer.classList.add('dxfx-paused');
      else layer.classList.remove('dxfx-paused');
    } catch (e) { /* ignore */ }
  }

  function killNode(el) {
    if (!el || el.__dxfxDead) return;
    el.__dxfxDead = true;
    try { if (el.parentNode) el.parentNode.removeChild(el); } catch (e) { /* ignore */ }
    if (liveNodes > 0) liveNodes -= 1;
  }

  function spawnNode(cls, styles) {
    if (liveNodes >= MAX_NODES) return null;
    var layer = ensureLayer();
    if (!layer) return null;
    var el = null;
    try {
      el = d.createElement('div');
      el.className = cls;
      if (styles) {
        for (var key in styles) {
          if (Object.prototype.hasOwnProperty.call(styles, key)) el.style[key] = styles[key];
        }
      }
      layer.appendChild(el);
      liveNodes += 1;
      return el;
    } catch (e) {
      if (el && el.parentNode) killNode(el);
      return null;
    }
  }

  function autoKill(el, life) {
    var done = false;
    function end() {
      if (done) return;
      done = true;
      killNode(el);
    }
    try { el.addEventListener('animationend', end, false); } catch (e) { /* ignore */ }
    w.setTimeout(end, life);
  }

  function addItem(it) {
    it.start = clock + (it.delay || 0);
    items.push(it);
    if (!tickId) {
      lastTs = nowMs();
      tickId = raf(tick);
    }
  }

  function tick(ts) {
    tickId = 0;
    if (d.hidden) {
      // Вкладка скрыта: часы не идут, анимации замирают и продолжатся при visible.
      tickId = raf(tick);
      return;
    }
    var now = (typeof ts === 'number') ? ts : nowMs();
    var dt = now - lastTs;
    lastTs = now;
    if (!(dt > 0)) dt = 16;
    if (dt > 48) dt = 48;
    clock += dt;

    for (var i = items.length - 1; i >= 0; i--) {
      var it = items[i];
      var t = clock - it.start;
      if (t < 0) continue;
      var k = t / it.dur;
      if (k > 1) k = 1;
      it.step(k, it);
      if (k >= 1) {
        items.splice(i, 1);
        killNode(it.el);
      }
    }
    if (items.length) tickId = raf(tick);
    else { tickId = 0; lastTs = 0; }
  }

  function centerOf(el) {
    if (!el || typeof el.getBoundingClientRect !== 'function') return null;
    var r = el.getBoundingClientRect();
    if (!r || (r.width <= 0 && r.height <= 0)) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  function defaultFmt(v) {
    var n = Number(v);
    if (!isFinite(n)) n = 0;
    var neg = n < 0;
    var s = Math.abs(n).toFixed(2).split('.');
    var int = s[0], out = '', c = 0;
    for (var i = int.length - 1; i >= 0; i--) {
      out = int.charAt(i) + out;
      c += 1;
      if (c % 3 === 0 && i > 0) out = ' ' + out;
    }
    return (neg ? '-' : '') + out + '.' + (s[1] || '00');
  }

  function setText(el, fn, v) {
    try {
      el.textContent = fn(v);
    } catch (e) {
      try { el.textContent = String(v); } catch (e2) { /* ignore */ }
    }
  }

  function coinStep(k, it) {
    var e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    var u = 1 - e;
    var x = u * u * it.x0 + 2 * u * e * it.cx + e * e * it.x1;
    var y = u * u * it.y0 + 2 * u * e * it.cy + e * e * it.y1;
    var sc = it.mode === 'in' ? (0.55 + 0.45 * Math.min(1, k * 3)) : 1;
    sc *= 1 - 0.64 * Math.pow(k, 2.2);
    var op = k < 0.72 ? 1 : 1 - (k - 0.72) / 0.28;
    if (op < 0) op = 0;
    var rot = it.rot + it.spin * e;
    it.el.style.transform = 'translate3d(' + (x - it.size / 2).toFixed(2) + 'px,' +
      (y - it.size / 2).toFixed(2) + 'px,0) rotate(' + rot.toFixed(1) + 'deg) scale(' + sc.toFixed(3) + ')';
    it.el.style.opacity = op.toFixed(3);
  }

  function sparkStep(k, it) {
    var sec = k * (it.dur / 1000);
    var x = it.x0 + it.vx * sec;
    var y = it.y0 + it.vy * sec + 0.5 * GRAVITY * sec * sec;
    var op = k < 0.68 ? 1 : 1 - (k - 0.68) / 0.32;
    if (op < 0) op = 0;
    it.el.style.transform = 'translate3d(' + (x - it.size / 2).toFixed(2) + 'px,' +
      (y - it.size / 2).toFixed(2) + 'px,0) rotate(' + (it.rot + it.spin * k).toFixed(1) + 'deg)';
    it.el.style.opacity = op.toFixed(3);
  }

  // 1. Монеты: дуга (квадратичная кривая Безье), вращение, уменьшение к концу.
  function coins(fromEl, toEl, count, kind) {
    try {
      if (reduced()) return 0;
      var a = centerOf(fromEl), b = centerOf(toEl);
      if (!a || !b) return 0;

      var n = count;
      if (n === undefined || n === null) n = DEFAULT_COINS;
      n = Math.floor(Number(n));
      if (!isFinite(n)) n = DEFAULT_COINS;
      if (n < 0) n = 0;
      if (n > MAX_COINS) n = MAX_COINS;
      var room = MAX_NODES - liveNodes;
      if (room <= 0) return 0;
      if (n > room) n = room;

      var mode = kind === 'out' ? 'out' : 'in';
      var baseDx = b.x - a.x, baseDy = b.y - a.y;
      var baseLen = Math.sqrt(baseDx * baseDx + baseDy * baseDy) || 1;
      ensureStyle();

      var made = 0;
      for (var i = 0; i < n; i++) {
        var size = 10 + Math.round(Math.random() * 6);
        var x0 = a.x + (Math.random() * 16 - 8);
        var y0 = a.y + (Math.random() * 16 - 8);
        var x1 = b.x + (Math.random() * 12 - 6);
        var y1 = b.y + (Math.random() * 12 - 6);
        var dx = x1 - x0, dy = y1 - y0;
        var len = Math.sqrt(dx * dx + dy * dy) || baseLen;
        var lift = len * (0.20 + Math.random() * 0.15);
        var cx = (x0 + x1) / 2 + (Math.random() - 0.5) * len * 0.10;
        var cy = (y0 + y1) / 2 - lift;
        var dur = 480 + Math.round(Math.random() * 280);
        var delay = Math.round((i / Math.max(1, n)) * 70 + Math.random() * 70);
        var spin = (Math.random() < 0.5 ? -1 : 1) * (160 + Math.random() * 220);

        var el = spawnNode('dxfx-coin');
        if (!el) break;
        el.style.width = size + 'px';
        el.style.height = size + 'px';
        el.style.opacity = '0';
        el.style.transform = 'translate3d(' + (x0 - size / 2).toFixed(2) + 'px,' +
          (y0 - size / 2).toFixed(2) + 'px,0) rotate(0deg) scale(' + (mode === 'in' ? 0.55 : 1) + ')';
        addItem({
          el: el, x0: x0, y0: y0, x1: x1, y1: y1, cx: cx, cy: cy,
          size: size, dur: dur, delay: delay, mode: mode,
          rot: Math.random() * 40 - 20, spin: spin, step: coinStep
        });
        made += 1;
      }
      return made;
    } catch (e) { return 0; }
  }

  function ring() {
    try {
      if (reduced()) return false;
      var el = spawnNode('dxfx-ring');
      if (!el) return false;
      autoKill(el, 760);
      return true;
    } catch (e) { return false; }
  }

  // 2. Сделка: монеты + волна по нижней кромке, для крупных сумм — кольцо из центра.
  function trade(opts) {
    try {
      if (!opts || reduced()) return false;
      var side = String(opts.side || '').toUpperCase();
      if (side !== 'BUY' && side !== 'SELL') return false;
      var total = Number(opts.total);
      if (!isFinite(total)) total = 0;
      var big = Math.abs(total) > 1e9;
      var isBuy = side === 'BUY';
      coins(opts.fromEl, opts.toEl, big ? 14 : 10, isBuy ? 'out' : 'in');
      flash(isBuy ? 'up' : 'down');
      if (big) ring();
      return true;
    } catch (e) { return false; }
  }

  // 3. Счётчик: плавная смена текста, с отменой предыдущей анимации на элементе.
  function count(el, from, to, fmt, ms) {
    try {
      if (!el || !el.style) return;
      var fn = (typeof fmt === 'function') ? fmt : defaultFmt;
      var a = Number(from), b = Number(to);
      if (!isFinite(a)) a = 0;
      if (!isFinite(b)) b = 0;
      var dur = Number(ms);
      if (ms === undefined || ms === null || !isFinite(dur) || dur < 0) dur = 700;

      if (el.__dxfxRaf) {
        caf(el.__dxfxRaf);
        el.__dxfxRaf = 0;
      }
      el.__dxfxTok = (el.__dxfxTok || 0) + 1;
      var tok = el.__dxfxTok;
      if (reduced() || dur <= 0) {
        setText(el, fn, b);
        return;
      }

      setText(el, fn, a);
      var last = nowMs(), elapsed = 0;

      function step(ts) {
        if (tok !== el.__dxfxTok) return;
        if (!el.parentNode) { el.__dxfxRaf = 0; return; }
        if (d.hidden) {
          el.__dxfxRaf = raf(step);
          return;
        }
        var t = (typeof ts === 'number') ? ts : nowMs();
        var dt = t - last;
        last = t;
        if (!(dt > 0)) dt = 0;
        if (dt > 48) dt = 48;
        elapsed += dt;
        var k = dur ? elapsed / dur : 1;
        if (k > 1) k = 1;
        var e = 1 - Math.pow(1 - k, 3);
        setText(el, fn, a + (b - a) * e);
        if (k >= 1) {
          el.__dxfxRaf = 0;
          setText(el, fn, b);
          return;
        }
        el.__dxfxRaf = raf(step);
      }
      el.__dxfxRaf = raf(step);
    } catch (e) { /* никогда не мешаем странице */ }
  }

  // 4. Салют: 20–40 частиц из центра, 900 мс, гравитация. Только по явному вызову.
  function confetti(n) {
    try {
      if (reduced()) return 0;
      var total = n;
      if (total === undefined || total === null) total = 30;
      total = Math.floor(Number(total));
      if (!isFinite(total)) total = 30;
      if (total < 20) total = 20;
      if (total > 40) total = 40;
      var room = MAX_NODES - liveNodes;
      if (room <= 0) return 0;
      if (total > room) total = room;

      var cx = (w.innerWidth || (d.documentElement && d.documentElement.clientWidth) || 0) / 2;
      var cy = (w.innerHeight || (d.documentElement && d.documentElement.clientHeight) || 0) / 2;
      var colors = ['#f7dca6', '#ffb347', '#ffd166', '#ffe9a8', '#6ee7b7', '#34d399'];
      ensureStyle();

      var made = 0;
      for (var i = 0; i < total; i++) {
        var size = 4 + Math.round(Math.random() * 3);
        var el = spawnNode('dxfx-spark', {
          width: size + 'px', height: size + 'px',
          borderRadius: Math.random() < 0.5 ? '50%' : '1px',
          background: colors[Math.floor(Math.random() * colors.length)]
        });
        if (!el) break;

        var ang = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.45;
        var speed = 190 + Math.random() * 430;
        var x0 = cx + (Math.random() * 20 - 10), y0 = cy + (Math.random() * 20 - 10);
        el.style.opacity = '1';
        el.style.transform = 'translate3d(' + (x0 - size / 2).toFixed(2) + 'px,' +
          (y0 - size / 2).toFixed(2) + 'px,0) rotate(0deg)';
        addItem({
          el: el, x0: x0, y0: y0, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
          rot: Math.random() * 360,
          spin: (Math.random() < 0.5 ? -1 : 1) * (90 + Math.random() * 360),
          size: size, dur: 900, delay: Math.round(Math.random() * 50), step: sparkStep
        });
        made += 1;
      }
      return made;
    } catch (e) { return 0; }
  }

  // 5. Волна цвета по нижней кромке: 300 мс и удаление.
  function flash(kind) {
    try {
      if (reduced()) return false;
      var k = kind === 'up' ? 'up' : (kind === 'down' ? 'down' : 'big');
      var grads = {
        up: 'linear-gradient(0deg,rgba(110,231,183,.52) 0%,rgba(110,231,183,.20) 38%,rgba(110,231,183,0) 100%)',
        down: 'linear-gradient(0deg,rgba(253,164,175,.52) 0%,rgba(253,164,175,.20) 38%,rgba(253,164,175,0) 100%)',
        big: 'linear-gradient(0deg,rgba(255,179,71,.62) 0%,rgba(247,220,166,.24) 42%,rgba(247,220,166,0) 100%)'
      };
      var el = spawnNode('dxfx-wave', { background: grads[k] });
      if (!el) return false;
      autoKill(el, 380);
      return true;
    } catch (e) { return false; }
  }

  function onVisibility() {
    syncPaused();
    if (!d.hidden && items.length && !tickId) {
      lastTs = nowMs();
      tickId = raf(tick);
    }
  }

  w.dxFx = { coins: coins, trade: trade, count: count, confetti: confetti, flash: flash };

  try {
    ensureStyle();
    syncPaused();
    if (d.addEventListener) d.addEventListener('visibilitychange', onVisibility, false);
    else if (d.attachEvent) d.attachEvent('onvisibilitychange', onVisibility);
  } catch (e) { /* ignore */ }
})(window, document);
