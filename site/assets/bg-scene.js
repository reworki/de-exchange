/* DE Exchange 3.2 — живой фон биржи (assets/bg-scene.js).
   Самодостаточный ES5 без сборки, зависимостей, внешних запросов и localStorage.
   Ничего не бросает наружу.

   Создаёт canvas#dx-bg-canvas первым элементом body (fixed, inset:0,
   pointer-events:none, z-index:0), style#dx-bg-style и html.dx-bg-on; рисует
   янтарный градиент, тёплое свечение и угольки, реагирует на рынок.

   API (window.dxBg):
     setMarket({ up, vol, pulse }) — up: true|false (рост/падение), vol: 0..1
       (яркость и скорость), pulse: 'up'|'down' (всплеск 0.6 с по краю);
     flash(kind) — 'up' | 'down' | 'big', вспышка 180 мс у нижней кромки;
     setEnabled(bool), isEnabled(), setQuality(0 авто | 1 полное | 2 облегчённое).

   Качество: DPR ≤ 1.5 (облегчённый — ≤ 1), resize debounce 150 мс, пауза при
   document.hidden, статичный кадр при prefers-reduced-motion: reduce,
   на ширине < 720 px частиц 40 %, автотормоз по среднему кадру. */

(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.dxBg && window.dxBg.__dx) return;
  var STYLE_ID = 'dx-bg-style', CANVAS_ID = 'dx-bg-canvas', ROOT_CLASS = 'dx-bg-on';
  var C_WARM = [255, 158, 64], C_UP = [110, 231, 183], C_DOWN = [253, 164, 175]; var C_GOLD = [247, 220, 166];
  var MAX_DPR = 1.5, RESIZE_DEBOUNCE = 150, COUNT_MIN = 30, COUNT_MAX = 90;
  var PULSE_TIME = 0.6, FLASH_TIME = 0.18;
  var state = {
    enabled: true, ready: false, quality: 0, effQ: 1, reduced: false, w: 0, h: 0,
    canvas: null, ctx: null, particles: [], targetCount: 0, sprites: null,
    bg: null, glow: null, glow2: null, edgeUp: null, edgeDown: null,
    flashUp: null, flashDown: null, flashBig: null,
    e: 0, eTarget: 0, vol: 0.45, volTarget: 0.45, pulse: 0, pulseKind: 1,
    flash: 0, flashKind: 'up', time: 0, rafId: 0, running: false, lastTs: 0,
    resizeTimer: 0, avgMs: 16, warmup: 0, slowFor: 0, verySlowFor: 0,
    cutStep: 0, perfOff: false, flashTimer: 0
  };
  /* ---------- утилиты ---------- */
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function clamp01(v) { return clamp(v, 0, 1); }
  function smooth(t) { t = clamp01(t); return t * t * (3 - 2 * t); }
  function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
  function nowMs() {
    try { if (window.performance && window.performance.now) return window.performance.now(); } catch (e) {}
    return Date.now();
  }
  function mix(a, b, t) {
    return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t),
      Math.round(a[2] + (b[2] - a[2]) * t)];
  }
  function reqFrame(cb) {
    try { if (window.requestAnimationFrame) return window.requestAnimationFrame(cb); } catch (e) {}
    return window.setTimeout(function () { cb(nowMs()); }, 16);
  }
  function cancelFrame(id) {
    if (!id) return;
    try { if (window.cancelAnimationFrame) { window.cancelAnimationFrame(id); return; } } catch (e) {}
    try { window.clearTimeout(id); } catch (e2) {}
  }
  function rootAdd() {
    try {
      var de = document.documentElement;
      if (!de) return;
      if (de.classList && de.classList.add) de.classList.add(ROOT_CLASS);
      else if ((' ' + de.className + ' ').indexOf(' ' + ROOT_CLASS + ' ') < 0)
        de.className = (de.className ? de.className + ' ' : '') + ROOT_CLASS;
    } catch (e) {}
  }
  function rootRemove() {
    try {
      var de = document.documentElement;
      if (!de) return;
      if (de.classList && de.classList.remove) de.classList.remove(ROOT_CLASS);
      else de.className = (' ' + de.className + ' ').split(' ' + ROOT_CLASS + ' ').join(' ');
    } catch (e) {}
  }
  /* ---------- DOM: стиль и canvas ---------- */
  function injectStyle() {
    try {
      if (document.getElementById(STYLE_ID)) return;
      /* Только собственный канвас. Правила на body и body > * ломали
         position:fixed у экрана входа (он съезжал в обычный блок). */
      var css = '#' + CANVAS_ID + '{position:absolute;left:0;top:0;width:100%;height:100%;display:block;pointer-events:none;z-index:0}';
      var el = document.createElement('style'); el.id = STYLE_ID; el.type = 'text/css';
      if (el.styleSheet) el.styleSheet.cssText = css;
      else el.appendChild(document.createTextNode(css));
      var head = document.head || document.getElementsByTagName('head')[0] || document.documentElement;
      if (head) head.appendChild(el);
    } catch (e) {}
  }
  function createCanvas() {
    try {
      var body = document.body;
      if (!body) return false; var cv = document.getElementById(CANVAS_ID);
      if (!cv) {
        cv = document.createElement('canvas'); cv.id = CANVAS_ID;
        cv.setAttribute('aria-hidden', 'true');
        /* у страницы уже есть слой фона: #stars — fixed inset 0, z-index 0 */
        var host = document.getElementById('stars') || body;
        if (host.firstChild) host.insertBefore(cv, host.firstChild); else host.appendChild(cv);
      }
      cv.style.position = 'absolute'; cv.style.left = cv.style.top = cv.style.right = cv.style.bottom = '0';
      cv.style.width = cv.style.height = '100%'; cv.style.pointerEvents = 'none';
      cv.style.zIndex = '0'; cv.style.display = 'block'; state.canvas = cv; var ctx = null;
      try { ctx = cv.getContext('2d', { alpha: true }); } catch (e1) { ctx = null; }
      if (!ctx) { try { ctx = cv.getContext('2d'); } catch (e2) { ctx = null; } }
      state.ctx = ctx || null;
      if (!ctx) { cv.hidden = true; cv.style.display = 'none'; }
      else state.sprites = { warm: sprite(C_WARM), up: sprite(C_UP), down: sprite(C_DOWN) }; return true;
    } catch (e) { return false; }
  }
  function sprite(c) {
    try {
      var cv = document.createElement('canvas'); cv.width = 64; cv.height = 64; var g = cv.getContext('2d');
      if (!g) return null; var grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grd.addColorStop(0, rgba(c, 0.9));
      grd.addColorStop(0.32, rgba(c, 0.28));
      grd.addColorStop(1, rgba(c, 0)); g.fillStyle = grd; g.fillRect(0, 0, 64, 64); return cv;
    } catch (e) { return null; }
  }
  /* ---------- размеры и градиенты ---------- */
  function measure() {
    try {
      if (!state.canvas || !state.ctx) return;
      var w = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
      var h = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
      var dpr = window.devicePixelRatio || 1;
      if (!(dpr > 0)) dpr = 1; state.effQ = resolveQuality();
      if (state.effQ === 2) dpr = Math.min(dpr, 1);
      dpr = Math.min(dpr, MAX_DPR); var oldW = state.w || w, oldH = state.h || h, first = !state.w;
      state.w = w; state.h = h; state.canvas.width = Math.max(1, Math.round(w * dpr));
      state.canvas.height = Math.max(1, Math.round(h * dpr)); state.canvas.style.width = w + 'px';
      state.canvas.style.height = h + 'px';
      try { state.ctx.setTransform(dpr, 0, 0, dpr, 0, 0); } catch (e1) {}
      buildGradients(); var rx = w / oldW, ry = h / oldH;
      for (var i = 0; i < state.particles.length; i++) {
        var p = state.particles[i];
        if (!first) { p.x *= rx; p.y *= ry; }
        p.x = clamp(p.x, -40, w + 40); p.y = clamp(p.y, -40, h + 40);
      }
      computeCount(); syncParticles();
    } catch (e) {}
  }
  function resolveQuality() {
    if (state.quality === 1 || state.quality === 2) return state.quality;
    var w = window.innerWidth || 1, dpr = window.devicePixelRatio || 1, cores = 0;
    try { cores = (window.navigator && window.navigator.hardwareConcurrency) || 0; } catch (e) {}
    return (w < 720 || dpr > 2 || (cores && cores <= 4)) ? 2 : 1;
  }
  function computeCount() {
    var n = clamp(Math.round((state.w * state.h) / 21000), COUNT_MIN, COUNT_MAX);
    if (state.w < 720) n = Math.round(n * 0.4);
    else if (state.effQ === 2) n = Math.round(n * 0.55);
    if (state.cutStep >= 1) n = Math.round(n * 0.5); state.targetCount = Math.max(8, n);
  }
  function buildGradients() {
    var ctx = state.ctx, w = state.w, h = state.h;
    if (!ctx || !w || !h) return; var g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#2b1a0c'); g.addColorStop(0.48, '#1a0f06'); g.addColorStop(1, '#060403'); state.bg = g;
    var gr = ctx.createRadialGradient(w * 0.5, h * 0.12, 0, w * 0.5, h * 0.12, Math.max(w, h) * 0.82);
    gr.addColorStop(0, 'rgba(255,145,44,0.20)');
    gr.addColorStop(0.42, 'rgba(255,120,24,0.075)');
    gr.addColorStop(1, 'rgba(255,120,24,0)'); state.glow = gr;
    var gr2 = ctx.createRadialGradient(w * 0.84, h * 0.9, 0, w * 0.84, h * 0.9, Math.max(w, h) * 0.55);
    gr2.addColorStop(0, 'rgba(247,220,166,0.075)');
    gr2.addColorStop(1, 'rgba(247,220,166,0)'); state.glow2 = gr2;
    state.edgeUp = edgeSet(C_UP); state.edgeDown = edgeSet(C_DOWN);
    state.flashUp = bottomGradient(C_UP); state.flashDown = bottomGradient(C_DOWN);
    state.flashBig = bottomGradient(C_GOLD);
  }
  function edgeSet(c) {
    try {
      var ctx = state.ctx, w = state.w, h = state.h, out = [];
      var coords = [[0, 0, 0, h * 0.2], [0, h, 0, h * 0.8], [0, 0, w * 0.18, 0], [w, 0, w * 0.82, 0]];
      for (var i = 0; i < 4; i++) {
        var g = ctx.createLinearGradient(coords[i][0], coords[i][1], coords[i][2], coords[i][3]);
        g.addColorStop(0, rgba(c, 0.5)); g.addColorStop(1, rgba(c, 0));
        out.push(g);
      }
      return out;
    } catch (e) { return null; }
  }
  function bottomGradient(c) {
    try {
      var g = state.ctx.createLinearGradient(0, state.h, 0, state.h * 0.66);
      g.addColorStop(0, rgba(c, 0.6)); g.addColorStop(1, rgba(c, 0)); return g;
    } catch (e) { return null; }
  }
  /* ---------- частицы ---------- */
  function newParticle(anywhere) {
    return {
      x: Math.random() * (state.w || 1),
      y: anywhere ? Math.random() * (state.h || 1) : state.h + Math.random() * 50,
      r: 0.7 + Math.random() * 1.9, vy: 9 + Math.random() * 21, vx: (Math.random() - 0.5) * 7,
      phase: Math.random() * Math.PI * 2, tw: 0.5 + Math.random() * 1.7,
      wob: 0.25 + Math.random() * 0.9, a: 0.32 + Math.random() * 0.62
    };
  }
  function syncParticles() {
    var arr = state.particles;
    while (arr.length < state.targetCount) arr.push(newParticle(state.ready));
    if (arr.length > state.targetCount) arr.length = state.targetCount;
  }
  function wrapParticle(p) {
    var w = state.w, h = state.h, m = 50;
    if (p.y < -m) { p.y = h + m * 0.5; p.x = Math.random() * w; }
    else if (p.y > h + m) { p.y = -m * 0.5; p.x = Math.random() * w; }
    if (p.x < -m) p.x = w + m * 0.5;
    else if (p.x > w + m) p.x = -m * 0.5;
  }
  function trendColor() {
    var e = state.e, t = smooth(e >= 0 ? e : -e); return e >= 0 ? mix(C_WARM, C_UP, t) : mix(C_WARM, C_DOWN, t);
  }
  /* ---------- отрисовка ---------- */
  function draw() {
    var ctx = state.ctx;
    if (!ctx) return;
    try {
      var w = state.w, h = state.h;
      if (!w || !h) return; ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      /* фон не заливаем: под канвасом уже градиент страницы */
      ctx.clearRect(0, 0, w, h);
      if (state.glow) { ctx.fillStyle = state.glow; ctx.fillRect(0, 0, w, h); }
      if (state.glow2) { ctx.fillStyle = state.glow2; ctx.fillRect(0, 0, w, h); }
      drawParticles(ctx); ctx.globalCompositeOperation = 'lighter';
      if (state.pulse > 0) {
        var pg = state.pulseKind >= 0 ? state.edgeUp : state.edgeDown;
        if (pg && pg.length === 4) {
          ctx.globalAlpha = smooth(state.pulse / PULSE_TIME) * 0.8;
          ctx.fillStyle = pg[0]; ctx.fillRect(0, 0, w, h * 0.2);
          ctx.fillStyle = pg[1]; ctx.fillRect(0, h * 0.8, w, h * 0.2);
          ctx.fillStyle = pg[2]; ctx.fillRect(0, 0, w * 0.18, h);
          ctx.fillStyle = pg[3]; ctx.fillRect(w * 0.82, 0, w * 0.18, h);
        }
      }
      if (state.flash > 0) {
        var fg = state.flashKind === 'big' ? state.flashBig :
          (state.flashKind === 'up' ? state.flashUp : state.flashDown);
        if (fg) {
          ctx.globalAlpha = smooth(state.flash / FLASH_TIME); ctx.fillStyle = fg;
          ctx.fillRect(0, h * 0.64, w, h * 0.36);
        }
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    } catch (e) {}
  }
  function drawParticles(ctx) {
    var sp = state.sprites, col = trendColor(); var wmix = smooth(Math.abs(state.e));
    var bright = 0.55 + state.vol * 1.15; var q = state.effQ, arr = state.particles, t = state.time;
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgb(' + col[0] + ',' + col[1] + ',' + col[2] + ')';
    for (var i = 0; i < arr.length; i++) {
      var p = arr[i]; var a = p.a * (0.55 + 0.45 * Math.sin(t * p.tw + p.phase)) * bright;
      if (a <= 0.015) continue; var s = p.r * (5.2 + state.vol * 3.0);
      if (sp && (q !== 2 || i % 2 === 0)) {
        if (sp.warm) {
          ctx.globalAlpha = clamp01(a * (1 - wmix) * 0.7);
          ctx.drawImage(sp.warm, p.x - s, p.y - s, s * 2, s * 2);
        }
        if (wmix > 0.02) {
          var tr = state.e >= 0 ? sp.up : sp.down;
          if (tr) {
            ctx.globalAlpha = clamp01(a * wmix * 0.85); ctx.drawImage(tr, p.x - s, p.y - s, s * 2, s * 2);
          }
        }
      }
      ctx.globalAlpha = clamp01(a * 1.5); ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(0.45, p.r * 0.62), 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }
  /* ---------- анимация ---------- */
  function update(dt) {
    state.e += (state.eTarget - state.e) * (1 - Math.exp(-3.2 * dt));
    state.vol += (state.volTarget - state.vol) * (1 - Math.exp(-2.4 * dt));
    if (state.pulse > 0) { state.pulse -= dt; if (state.pulse < 0) state.pulse = 0; }
    if (state.flash > 0) { state.flash -= dt; if (state.flash < 0) state.flash = 0; }
    var t = state.time, e = state.e, vol = state.vol;
    var speed = (0.6 + vol * 1.3) * (1 + e * 0.85); var driftDown = e < 0 ? (-e * 16) : 0;
    var sway = 4 + vol * 6, arr = state.particles;
    for (var i = 0; i < arr.length; i++) {
      var p = arr[i]; var wobble = 0.85 + 0.3 * Math.sin(t * 0.6 + p.phase);
      var vy = -(p.vy * Math.max(0.08, speed * wobble)) + driftDown;
      p.x += (p.vx + Math.sin(t * p.wob + p.phase) * sway) * dt; p.y += vy * dt;
      wrapParticle(p);
    }
  }
  function loop(ts) {
    state.rafId = 0;
    if (!state.enabled) { state.running = false; return; }
    try {
      var tsNow = (typeof ts === 'number' && isFinite(ts)) ? ts : nowMs(); var raw = tsNow - state.lastTs;
      if (!isFinite(raw) || raw < 0) raw = 16; state.lastTs = tsNow;
      var dt = clamp(raw / 1000, 0, 0.05); state.time += dt;
      update(dt); draw();
      trackPerf(raw);
      if (!state.enabled) { state.running = false; return; }
      state.rafId = reqFrame(loop);
    } catch (e) {
      state.running = false; state.rafId = 0;
    }
  }
  function trackPerf(raw) {
    if (raw <= 0 || raw > 250) return;
    if (state.warmup < 900) { state.warmup += raw; return; }
    state.avgMs = state.avgMs * 0.9 + raw * 0.1;
    if (state.avgMs > 33) state.slowFor += raw;
    else state.slowFor = Math.max(0, state.slowFor - raw * 0.6);
    if (state.avgMs > 50) state.verySlowFor += raw;
    else state.verySlowFor = Math.max(0, state.verySlowFor - raw * 0.6);
    if (state.slowFor > 2000 && state.cutStep < 1) {
      state.cutStep = 1; computeCount(); syncParticles();
      state.slowFor = 0; state.verySlowFor = 0; state.avgMs = 16; state.warmup = 0;
    }
    if (state.verySlowFor > 2000 && !state.perfOff) {
      state.perfOff = true;
      setEnabled(false);
    }
  }
  function start() {
    if (!state.ready || !state.enabled || !state.ctx) return;
    if (state.reduced) { renderStatic(); return; }
    if (document.hidden) { renderStatic(); return; }
    if (state.running) return; state.running = true; state.lastTs = nowMs(); state.warmup = 0;
    state.rafId = reqFrame(loop);
  }
  function stop() {
    state.running = false;
    if (state.rafId) cancelFrame(state.rafId); state.rafId = 0;
  }
  function renderStatic() {
    try { state.e = state.eTarget; state.vol = state.volTarget; draw(); } catch (e) {}
  }
  /* ---------- resize / visibility / motion ---------- */
  function onResize() {
    try {
      if (state.resizeTimer) window.clearTimeout(state.resizeTimer);
      state.resizeTimer = window.setTimeout(function () {
        state.resizeTimer = 0;
        try {
          if (!state.ready) return; measure();
          if (state.reduced || !state.running) renderStatic();
        } catch (e) {}
      }, RESIZE_DEBOUNCE);
    } catch (e) {}
  }
  function onVisibility() {
    try {
      if (document.hidden || document.visibilityState === 'hidden') stop();
      else if (state.enabled && state.ready) {
        state.slowFor = state.verySlowFor = state.warmup = 0; state.lastTs = nowMs(); start();
      }
    } catch (e) {}
  }
  function prefersReduced() {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) { return false; }
  }
  function watchMotion() {
    try {
      if (!window.matchMedia) return; var q = window.matchMedia('(prefers-reduced-motion: reduce)');
      var onChange = function () {
        try {
          state.reduced = !!q.matches;
          if (state.reduced) { state.pulse = 0; state.flash = 0; stop(); renderStatic(); }
          else if (state.enabled && state.ready) start();
        } catch (e) {}
      };
      if (q.addEventListener) q.addEventListener('change', onChange);
      else if (q.addListener) q.addListener(onChange);
    } catch (e) {}
  }
  /* ---------- публичный API ---------- */
  function setMarket(m) {
    try {
      if (!m || typeof m !== 'object') return;
      if (m.up === true) state.eTarget = 1;
      else if (m.up === false) state.eTarget = -1;
      if (typeof m.vol === 'number' && isFinite(m.vol)) state.volTarget = clamp01(m.vol);
      if (!state.reduced && (m.pulse === 'up' || m.pulse === 'down')) {
        state.pulseKind = m.pulse === 'up' ? 1 : -1; state.pulse = PULSE_TIME;
      }
      if (state.ready && state.reduced) renderStatic();
    } catch (e) {}
  }
  function flash(kind) {
    try {
      if (kind !== 'up' && kind !== 'down' && kind !== 'big') return; state.flashKind = kind;
      state.flash = FLASH_TIME;
      if (!state.ready) return;
      if (state.reduced) {
        renderStatic();
        if (state.flashTimer) window.clearTimeout(state.flashTimer);
        state.flashTimer = window.setTimeout(function () {
          state.flashTimer = 0; state.flash = 0;
          renderStatic();
        }, FLASH_TIME * 1000);
      }
    } catch (e) {}
  }
  function setEnabled(on) {
    var want = on !== false;
    try {
      if (want === state.enabled && state.ready) {
        if (want && !state.running && !state.reduced && !document.hidden) start(); return;
      }
      state.enabled = want;
      if (!state.ready) { if (want) boot(); return; }
      if (!want) {
        stop(); rootRemove();
        if (state.canvas) { state.canvas.hidden = true; state.canvas.style.display = 'none'; }
        if (state.flashTimer) { window.clearTimeout(state.flashTimer); state.flashTimer = 0; }
        return;
      }
      state.perfOff = false; state.cutStep = 0;
      state.slowFor = state.verySlowFor = state.warmup = 0; state.avgMs = 16; rootAdd();
      if (state.canvas) { state.canvas.hidden = false; state.canvas.style.display = 'block'; }
      measure(); state.lastTs = nowMs(); start();
    } catch (e) {}
  }
  function isEnabled() { return !!state.enabled; }
  function setQuality(n) {
    try {
      var q = parseInt(n, 10);
      if (!isFinite(q) || (q !== 0 && q !== 1 && q !== 2) || state.quality === q) return; state.quality = q;
      if (!state.ready || !state.ctx || !state.enabled) return; measure();
      if (state.reduced || !state.running) renderStatic();
    } catch (e) {}
  }
  /* ---------- загрузка ---------- */
  function boot() {
    try {
      if (state.ready) return;
      if (!document.body) return;
      injectStyle();
      if (!createCanvas()) return; state.ready = true; state.reduced = prefersReduced();
      state.time = Math.random() * 6;
      if (!state.ctx) return;
      watchMotion();
      try {
        window.addEventListener('resize', onResize, false);
        window.addEventListener('orientationchange', onResize, false);
        document.addEventListener('visibilitychange', onVisibility, false);
      } catch (e1) {}
      if (!state.enabled) {
        rootRemove();
        if (state.canvas) { state.canvas.hidden = true; state.canvas.style.display = 'none'; }
        return;
      }
      rootAdd(); measure();
      if (state.reduced) renderStatic();
      else start();
    } catch (e) {}
  }
  window.dxBg = {
    __dx: true,
    setMarket: setMarket,
    flash: flash,
    setEnabled: setEnabled,
    isEnabled: isEnabled,
    setQuality: setQuality
  };
  if (document.body) boot();
  else {
    try {
      document.addEventListener('DOMContentLoaded', function () {
        try { boot(); } catch (e) {}
      }, false);
    } catch (e) {}
    try {
      window.addEventListener('load', function () {
        try { boot(); } catch (e2) {}
      }, false);
    } catch (e2) {}
  }
})();
