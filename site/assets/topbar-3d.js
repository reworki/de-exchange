/* ============================================================
   DE Exchange · 3D-плашка верхней панели
   IIFE, ES5, без зависимостей. Ждёт DOMContentLoaded.
   Разметка меняется минимально: плашка и монета получают
   декоративные 3D-обёртки; исходные элементы остаются на месте.
   ============================================================ */
(function () {
  'use strict';

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  ready(function () {
    var topbar = document.querySelector('.wrap > .topbar') || document.querySelector('.topbar');
    if (!topbar || topbar.getAttribute('data-tb3d') === '1') return;

    /* ---------- режимы ---------- */
    var mqReduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    var mqStatic = window.matchMedia ? window.matchMedia('(max-width: 899px), (pointer: coarse)') : null;
    function isStatic() {
      return !!(mqReduce && mqReduce.matches) || !!(mqStatic && mqStatic.matches);
    }

    /* ---------- обёртки: сцена -> дыхание -> плашка ---------- */
    topbar.setAttribute('data-tb3d', '1');
    var stage = document.createElement('div');
    stage.className = 'tb3d-stage';
    var breathe = document.createElement('div');
    breathe.className = 'tb3d-breathe';
    topbar.parentNode.insertBefore(stage, topbar);
    stage.appendChild(breathe);
    breathe.appendChild(topbar);

    var shadow = document.createElement('div');
    shadow.className = 'tb3d-shadow';
    shadow.setAttribute('aria-hidden', 'true');
    breathe.insertBefore(shadow, topbar);

    var edge = document.createElement('div');
    edge.className = 'tb3d-edge';
    edge.setAttribute('aria-hidden', 'true');
    breathe.insertBefore(edge, topbar);

    var backdrop = document.createElement('div');
    backdrop.className = 'tb3d-backdrop';
    backdrop.setAttribute('aria-hidden', 'true');
    breathe.insertBefore(backdrop, topbar);

    /* ---------- блики (под контентом) ---------- */
    var glass = document.createElement('div');
    glass.className = 'tb3d-glass';
    glass.setAttribute('aria-hidden', 'true');
    var specular = document.createElement('div');
    specular.className = 'tb3d-specular';
    var sheen = document.createElement('div');
    sheen.className = 'tb3d-sheen';
    glass.appendChild(specular);
    glass.appendChild(sheen);
    topbar.insertBefore(glass, topbar.firstChild);

    /* ---------- настоящая 3D-монета из существующего SVG ---------- */
    var svg = topbar.querySelector('.mini-coin');
    if (svg && svg.parentNode) {
      var coinWrap = document.createElement('div');
      coinWrap.className = 'tb3d-coin-parallax';
      var coin = document.createElement('div');
      coin.className = 'tb3d-coin';
      coin.setAttribute('aria-hidden', 'true');
      svg.parentNode.insertBefore(coinWrap, svg);
      coinWrap.appendChild(coin);
      coin.appendChild(svg);
      svg.classList.add('tb3d-coin-face', 'tb3d-coin-front');

      /* задняя грань — отражённый и притемнённый клон */
      var back = svg.cloneNode(true);
      back.setAttribute('class', 'tb3d-coin-face tb3d-coin-back');
      back.setAttribute('aria-hidden', 'true');
      coin.appendChild(back);

      /* торец: 14 тонких копий между гранями */
      var COPIES = 14, SPAN = 16, i, z, face;
      for (i = 0; i < COPIES; i++) {
        z = -SPAN / 2 + (SPAN * i) / (COPIES - 1);
        face = svg.cloneNode(true);
        face.setAttribute('class', 'tb3d-coin-face tb3d-coin-edge');
        face.setAttribute('aria-hidden', 'true');
        face.style.transform = 'translateZ(' + z.toFixed(2) + 'px)';
        coin.appendChild(face);
      }

      /* блик, проезжающий по лицевой грани */
      var glint = document.createElement('div');
      glint.className = 'tb3d-coin-glint';
      glint.setAttribute('aria-hidden', 'true');
      coin.appendChild(glint);
    }

    /* ---------- наклон, параллакс, спекуляр ---------- */
    var raf = 0;
    var active = false;
    var lastMove = 0;
    var curRX = 0, curRY = 0, tarRX = 0, tarRY = 0, velRX = 0, velRY = 0;
    var curMX = 42, curMY = 28, tarMX = 42, tarMY = 28;
    var hidden = false;

    function writeTilt() {
      stage.style.setProperty('--tb3d-rx', curRX.toFixed(3) + 'deg');
      stage.style.setProperty('--tb3d-ry', curRY.toFixed(3) + 'deg');
      stage.style.setProperty('--tb3d-mx', curMX.toFixed(2) + '%');
      stage.style.setProperty('--tb3d-my', curMY.toFixed(2) + '%');
      var tilt = Math.min(7, (Math.abs(curRX) + Math.abs(curRY)) / 2);
      stage.style.setProperty('--tb3d-sh-x', (-curRY * 1.15).toFixed(2) + 'px');
      stage.style.setProperty('--tb3d-sh-y', (22 + curRX * 0.9 + tilt * 0.6).toFixed(2) + 'px');
      stage.style.setProperty('--tb3d-sh-s', (1 + tilt * 0.008).toFixed(4));
    }

    function settled() {
      return !active &&
        Math.abs(curRX) < 0.02 && Math.abs(curRY) < 0.02 &&
        Math.abs(velRX) < 0.02 && Math.abs(velRY) < 0.02 &&
        Math.abs(curMX - tarMX) < 0.05 && Math.abs(curMY - tarMY) < 0.05;
    }

    function frame() {
      raf = 0;
      if (document.hidden || hidden) return;

      var now = Date.now();
      var moving = active && (now - lastMove < 180);
      if (active && !moving) active = false;

      if (moving) {
        curRX += (tarRX - curRX) * 0.10;
        curRY += (tarRY - curRY) * 0.10;
        velRX = 0;
        velRY = 0;
      } else {
        /* пружинка при возврате в ноль */
        velRX += (0 - curRX) * 0.16;
        velRX *= 0.74;
        curRX += velRX;
        velRY += (0 - curRY) * 0.16;
        velRY *= 0.74;
        curRY += velRY;
        if (Math.abs(curRX) < 0.005) { curRX = 0; velRX = 0; }
        if (Math.abs(curRY) < 0.005) { curRY = 0; velRY = 0; }
      }

      curMX += (tarMX - curMX) * 0.12;
      curMY += (tarMY - curMY) * 0.12;
      writeTilt();

      if (!settled()) raf = requestAnimationFrame(frame);
    }

    function start() {
      if (!raf && !document.hidden && !hidden) raf = requestAnimationFrame(frame);
    }

    function resetTilt() {
      active = false;
      tarRX = 0; tarRY = 0; velRX = 0; velRY = 0;
      curRX = 0; curRY = 0;
      writeTilt();
    }

    function onMove(e) {
      if (isStatic() || document.hidden) return;
      var r = stage.getBoundingClientRect();
      if (!r.width || !r.height) return;
      var nx = (e.clientX - r.left) / r.width;
      var ny = (e.clientY - r.top) / r.height;
      nx = Math.max(0, Math.min(1, nx));
      ny = Math.max(0, Math.min(1, ny));
      tarRY = (nx - 0.5) * 14;      /* ±7° */
      tarRX = (0.5 - ny) * 14;      /* ±7° */
      tarMX = nx * 100;
      tarMY = ny * 100;
      lastMove = Date.now();
      active = true;
      start();
    }

    function onLeave() {
      active = false;
      tarRX = 0;
      tarRY = 0;
      start();
    }

    if (window.PointerEvent) {
      stage.addEventListener('pointermove', onMove, false);
      stage.addEventListener('pointerleave', onLeave, false);
    } else {
      stage.addEventListener('mousemove', onMove, false);
      stage.addEventListener('mouseleave', onLeave, false);
    }

    /* ---------- пауза во скрытой вкладке ---------- */
    function onVisibility() {
      hidden = document.hidden;
      if (hidden) {
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
        document.body.classList.add('tb3d-page-hidden');
      } else {
        document.body.classList.remove('tb3d-page-hidden');
        if (!settled()) start();
      }
    }
    document.addEventListener('visibilitychange', onVisibility, false);

    /* ---------- смена узкого/тач-режима ---------- */
    function onModeChange() {
      if (isStatic()) {
        resetTilt();
      } else if (!raf) {
        start();
      }
    }
    if (mqStatic) {
      if (mqStatic.addEventListener) mqStatic.addEventListener('change', onModeChange);
      else if (mqStatic.addListener) mqStatic.addListener(onModeChange);
    }
    if (mqReduce) {
      if (mqReduce.addEventListener) mqReduce.addEventListener('change', onModeChange);
      else if (mqReduce.addListener) mqReduce.addListener(onModeChange);
    }

    writeTilt();
  });
})();
