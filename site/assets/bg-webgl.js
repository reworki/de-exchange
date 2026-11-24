/* DE Exchange 3.2 — объёмный фон биржи на чистом WebGL 1 (assets/bg-webgl.js).
   Без библиотек, сборки, CDN, внешних запросов, шрифтов и localStorage.

   Что внутри: один <canvas> и один контекст. Проход 1 — полноэкранный квад
   с fbm-«атмосферой», тёмно-синей базой, тёплым свечением снизу, винье́ткой и
   мелким зерном. Проход 2 — 6000 (2500 на мобиле) GPU-частиц-угольков: они
   живут в перспективе (ближние крупнее/быстрее/ярче), поднимаются вверх,
   турбулируются value-noise'ом, заворачиваются по краям, светятся аддитивно.

   Публичный API (window.dxBg, вызовы безопасны до инициализации):
     setMarket({ up, vol, pulse }) — up: true|false|0..1 (рост/падение),
       vol: 0..1 (интенсивность и скорость), pulse: 'up'|'down'|null
       (короткая волна яркости от нижней кромки, 0.6 с);
     flash(kind) — 'up'|'down'|'big', общая вспышка цвета на 0.3 с;
     setEnabled(bool), isEnabled();
     setQuality(n) — 0 авто, 1 полное, 2 облегчённое (DPR 1, половина частиц).

   Жизненный цикл: DPR ≤ 1.5 (качество 2 — 1), пауза при document.hidden,
   resize с debounce 150 мс и пересозданием буферов, prefers-reduced-motion
   рисует один статичный кадр, автодеградация по среднему кадру (30 мс → вдвое,
   затем отключение). При недоступном WebGL или потере контекста canvas
   скрывается, страница остаётся нетронутой. Наружу ничего не бросаем. */

(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.dxBg && window.dxBg.__dx3d) return;

  var MAX_DPR = 1.5, RESIZE_MS = 150, PULSE_TIME = 0.6, FLASH_TIME = 0.5;
  var COUNT_DESKTOP = 6000, COUNT_MOBILE = 2500, COUNT_FLOOR = 1500;
  var state = {
    enabled: true, booted: false, ready: false, dead: false, reduced: false,
    quality: 0, effQ: 1, cut: 0,
    canvas: null, host: null, gl: null,
    bgProg: null, pProg: null, bgBuf: null, pBuf: null,
    bgClip: -1, pPos: -1, pSize: -1, pPhase: -1,
    bgU: null, pU: null,
    count: 0, width: 1, height: 1, bw: 1, bh: 1, dpr: 1,
    up: 0.5, upT: 0.5, vol: 0.35, volT: 0.35,
    pulse: 0, flash: 0, flashColor: [1.0, 0.83, 0.55],
    time: 8.0, last: 0, running: false, rafId: 0,
    resizeTimer: 0, warm: 0, avgMs: 16, slowFor: 0, perfOff: false
  };

  /* ---------- мелочи ---------- */
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function clamp01(v) { return clamp(v, 0, 1); }
  function now() {
    try { if (window.performance && window.performance.now) return window.performance.now(); } catch (e) {}
    return Date.now();
  }
  function raf(fn) {
    try { if (window.requestAnimationFrame) return window.requestAnimationFrame(fn); } catch (e) {}
    return window.setTimeout(function () { fn(now()); }, 16);
  }
  function caf(id) {
    if (!id) return;
    try { if (window.cancelAnimationFrame) { window.cancelAnimationFrame(id); return; } } catch (e) {}
    try { window.clearTimeout(id); } catch (e2) {}
  }
  function prefersReduced() {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) { return false; }
  }
  function hideCanvas() {
    try { if (state.canvas) { state.canvas.style.display = 'none'; state.canvas.hidden = true; } } catch (e) {}
  }
  function showCanvas() {
    try { if (state.canvas) { state.canvas.hidden = false; state.canvas.style.display = 'block'; } } catch (e) {}
  }

  /* ---------- GLSL ---------- */
  var BG_VS = [
    'attribute vec2 aClip;',
    'varying vec2 vUv;',
    'void main(){ vUv = aClip; gl_Position = vec4(aClip, 0.0, 1.0); }'
  ].join('\n');

  var BG_FS = [
    '#ifdef GL_FRAGMENT_PRECISION_HIGH',
    'precision highp float;',
    '#else',
    'precision mediump float;',
    '#endif',
    'varying vec2 vUv;',
    'uniform float uTime, uUp, uVol, uPulse, uFlash;',
    'uniform vec3 uFlashColor;',
    'float hash21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }',
    'float vnoise(vec2 p){',
    '  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);',
    '  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),',
    '             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);',
    '}',
    'float fbm(vec2 p){',
    '  float v = 0.0, a = 0.5;',
    '  for (int i = 0; i < 4; i++) { v += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.3); a *= 0.5; }',
    '  return v;',
    '}',
    'void main(){',
    '  vec2 uv = vUv;',
    '  float t = uTime;',
    '  vec2 p = uv * vec2(1.30, 0.95) + vec2(t * 0.009, -t * 0.0065);',
    '  float n = fbm(p * 1.6 + vec2(2.7, 1.3));',
    '  float n2 = vnoise(uv * 2.2 + vec2(-t * 0.02, t * 0.01));',
    '  float atm = smoothstep(0.30, 0.78, n);',
    '  vec3 top = vec3(0.032, 0.058, 0.098), mid = vec3(0.098, 0.165, 0.240);',
    '  vec3 col = mix(top, mid, atm * 0.90 + 0.10);',
    '  col += vec3(0.030, 0.060, 0.090) * smoothstep(0.55, 0.90, n) * 0.55;',
    '  col += vec3(0.010, 0.024, 0.036) * n2;',
    '  float bottom = 1.0 - smoothstep(-1.00, 0.55, uv.y), b2 = pow(bottom, 2.0);',
    '  float horiz = 0.55 + 0.45 * vnoise(vec2(uv.x * 1.8 + 5.0, t * 0.06));',
    '  vec3 warm = vec3(1.0, 0.50, 0.13);',
    '  vec3 market = mix(vec3(0.992, 0.643, 0.686), vec3(0.431, 0.906, 0.702), uUp);',
    /* цвет вспышки — насыщенный, не пастельный: рост зелёный, падение красное */
    '  vec3 pulseCol = mix(vec3(1.0, 0.20, 0.26), vec3(0.34, 1.0, 0.62), uUp);',
    '  vec3 glowCol = mix(warm, market, 0.25);',
    '  float glow = b2 * (0.20 + 0.34 * atm) * horiz;',
    '  col += glowCol * glow * (0.85 + 0.35 * uVol);',
    '  float d = length((uv - vec2(0.0, -1.08)) * vec2(0.85, 1.55));',
    '  col += vec3(1.0, 0.52, 0.16) * exp(-d * 2.2) * 0.160 * (0.70 + 0.30 * uVol);',
    '  col += glowCol * uPulse * b2 * (0.35 + 0.40 * horiz) * 0.35;',
    /* вспышка рынка — чистый цвет направления: зелёный на росте, красный
       на падении. Градиент фона не трогаем, он как был. */
    '  col += pulseCol * uPulse * b2 * (0.55 + 0.45 * horiz) * 1.20;',
    '  col += uFlashColor * uFlash * (0.10 + 0.30 * bottom);',
    /* очень медленная тёплая дымка у нижней кромки */
    '  float fogN = vnoise(vec2(uv.x * 0.8 + 3.0 + t * 0.010, uv.y * 1.3 - t * 0.014));',
    '  col += vec3(1.0, 0.46, 0.16) * smoothstep(0.40, 0.95, fogN) * bottom * 0.060;',
    '  float r = length(uv * vec2(0.92, 1.08));',
    '  col *= 1.0 - 0.30 * smoothstep(0.45, 1.35, r);',
    '  float grain = hash21(gl_FragCoord.xy + vec2(floor(t * 20.0) * 1.7, floor(t * 13.0) * 2.3)) - 0.5;',
    '  gl_FragColor = vec4(max(col + grain * 0.014, vec3(0.0)), 1.0);',
    '}'
  ].join('\n');

  var P_VS = [
    'attribute vec3 aPos;',
    'attribute float aSize;',
    'attribute float aPhase;',
    'uniform float uTime, uUp, uVol, uPulse, uFlash, uDpr;',
    'uniform vec3 uFlashColor;',
    'varying vec3 vColor;',
    'varying float vBright;',
    'varying float vSoft;',
    'float hash21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }',
    'float vnoise(vec2 p){',
    '  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);',
    '  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),',
    '             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);',
    '}',
    'void main(){',
    '  float phase = aPhase;',
    /* ~14 % частиц — яркие быстрые искры, остальные — тлеющая пыль */
    '  float spark = step(0.86, fract(phase * 3.14159265));',
    /* ~6 % — редкие крупные, но сильно прозрачные боке */
    '  float bokeh = step(0.94, fract(phase * 7.77));',
    /* глубина гуляет, поэтому перспектива «дышит» */
    '  float z = clamp(aPos.z + (vnoise(vec2(phase * 19.0, uTime * 0.06 + phase * 5.0)) - 0.5) * 0.22, -1.0, 1.0);',
    '  float nearZ = (z + 1.0) * 0.5;',
    '  float depth = mix(2.35, 0.55, nearZ), focal = 0.95;',
    /* при падении часть пыли начинает опускаться */
    '  float reverse = (1.0 - uUp) * step(0.55, fract(phase * 12.9898));',
    '  float spd = 0.085 * mix(0.45, 2.25, pow(nearZ, 1.25)) * mix(0.85, 1.90, spark);',
    '  spd *= (0.35 + 1.05 * uVol) * mix(1.0, -0.55, reverse);',
    '  float yy = aPos.y + uTime * spd;',
    '  yy = mod(yy + 1.30, 2.60) - 1.30;',
    /* турбулентность в мировых координатах: ближние качаются заметнее */
    '  float t1 = vnoise(vec2(phase * 37.0 + 1.5, uTime * 0.12 + phase * 11.0)) - 0.5;',
    '  float t2 = vnoise(vec2(phase * 21.0 + 7.5, uTime * 0.09 + phase * 3.0)) - 0.5;',
    '  float amp = mix(0.030, 0.140, nearZ) * (0.60 + 0.60 * uVol);',
    '  float xw = aPos.x * (depth / focal) + t1 * amp + sin(uTime * 0.25 + phase * 6.2831853) * 0.04;',
    '  float yw = yy * (depth / focal) + t2 * amp * 0.45;',
    '  gl_Position = vec4(xw * focal / depth, yw * focal / depth, 0.0, 1.0);',
    '  float size = aSize * mix(2.2, 8.0, pow(nearZ, 1.35)) * mix(1.0, 1.08, spark) * (0.90 + 0.10 * uVol);',
    '  size *= mix(1.0, 1.25, bokeh);',
    '  gl_PointSize = clamp(size * uDpr, 2.0 * uDpr, 10.0 * uDpr);',
    '  float flick = 0.72 + 0.28 * sin(uTime * (1.3 + 2.7 * fract(phase * 7.31)) + phase * 21.0);',
    '  float edge = 1.0 - smoothstep(-1.0, 0.40, yy);',
    '  float bright = mix(0.36, 1.00, nearZ) * (0.42 + 0.58 * uVol) * flick * mix(0.80, 1.65, spark);',
    '  bright *= (0.80 + 0.30 * uUp) * (1.0 + uPulse * 1.60 * edge) * mix(1.0, 0.12, bokeh);',
    '  vec3 down = vec3(0.992, 0.643, 0.686), upc = vec3(0.431, 0.906, 0.702), warm = vec3(1.0, 0.42, 0.10);',
    '  vColor = mix(warm, mix(down, upc, uUp), 0.80);',
    '  vColor = mix(vColor, vec3(1.0, 0.82, 0.46), spark * 0.28);',
    '  vColor += uFlashColor * uFlash * 0.85;',
    '  vBright = bright;',
    '  vSoft = clamp((1.0 - nearZ) + bokeh * 0.9, 0.0, 1.0);',
    '}'
  ].join('\n');

  var P_FS = [
    '#ifdef GL_FRAGMENT_PRECISION_HIGH',
    'precision highp float;',
    '#else',
    'precision mediump float;',
    '#endif',
    'varying vec3 vColor;',
    'varying float vBright;',
    'varying float vSoft;',
    'uniform float uFlash;',
    'uniform vec3 uFlashColor;',
    'void main(){',
    '  vec2 pc = gl_PointCoord * 2.0 - 1.0;',
    '  float d = length(pc);',
    '  if (d > 1.0) discard;',
    '  float fall = 1.0 - d;',
    '  float a = pow(fall, mix(2.6, 1.5, vSoft));',
    '  float core = pow(fall, mix(9.0, 5.0, vSoft));',
    '  vec3 col = mix(vColor, vec3(1.0, 0.94, 0.80), core * 0.62);',
    '  col += uFlashColor * uFlash * 0.90;',
    '  float alpha = a * vBright;',
    '  gl_FragColor = vec4(col * alpha, alpha);',
    '}'
  ].join('\n');

  /* ---------- canvas и GL ---------- */
  function createCanvas() {
    try {
      var body = document.body;
      if (!body) return false;
      var host = document.getElementById('stars') || body;
      var cv = document.createElement('canvas');
      cv.id = 'dx-bg-webgl';
      cv.setAttribute('aria-hidden', 'true');
      cv.style.cssText = 'position:absolute;left:0;top:0;right:0;bottom:0;width:100%;height:100%;' +
        'display:block;pointer-events:none;z-index:0;';
      if (host.firstChild) host.insertBefore(cv, host.firstChild); else host.appendChild(cv);
      state.canvas = cv;
      state.host = host;
      return true;
    } catch (e) { return false; }
  }

  function compileShader(type, src) {
    var sh = state.gl.createShader(type);
    if (!sh) return null;
    state.gl.shaderSource(sh, src);
    state.gl.compileShader(sh);
    if (!state.gl.getShaderParameter(sh, state.gl.COMPILE_STATUS)) {
      try { state.gl.deleteShader(sh); } catch (e) {}
      return null;
    }
    return sh;
  }

  function buildProgram(vsSrc, fsSrc) {
    var gl = state.gl;
    var vs = compileShader(gl.VERTEX_SHADER, vsSrc);
    var fs = compileShader(gl.FRAGMENT_SHADER, fsSrc);
    if (!vs || !fs) return null;
    var pr = gl.createProgram();
    if (!pr) return null;
    gl.attachShader(pr, vs);
    gl.attachShader(pr, fs);
    gl.linkProgram(pr);
    try { gl.deleteShader(vs); gl.deleteShader(fs); } catch (e) {}
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) {
      try { gl.deleteProgram(pr); } catch (e2) {}
      return null;
    }
    return pr;
  }

  function getUniforms(pr, names) {
    var out = {};
    for (var i = 0; i < names.length; i++) out[names[i]] = state.gl.getUniformLocation(pr, names[i]);
    return out;
  }

  function initGL() {
    try {
      var attrs = {
        alpha: false, antialias: false, depth: false, stencil: false,
        premultipliedAlpha: false, preserveDrawingBuffer: false,
        powerPreference: 'low-power', failIfMajorPerformanceCaveat: false
      };
      var gl = null;
      try { gl = state.canvas.getContext('webgl', attrs); } catch (e1) { gl = null; }
      if (!gl) { try { gl = state.canvas.getContext('experimental-webgl', attrs); } catch (e2) { gl = null; } }
      if (!gl) return false;
      state.gl = gl;
      try {
        state.canvas.addEventListener('webglcontextlost', onLost, false);
        state.canvas.addEventListener('webglcontextrestored', function () { hideCanvas(); }, false);
      } catch (e3) {}

      state.bgProg = buildProgram(BG_VS, BG_FS);
      state.pProg = buildProgram(P_VS, P_FS);
      if (!state.bgProg || !state.pProg) return false;

      state.bgClip = gl.getAttribLocation(state.bgProg, 'aClip');
      state.pPos = gl.getAttribLocation(state.pProg, 'aPos');
      state.pSize = gl.getAttribLocation(state.pProg, 'aSize');
      state.pPhase = gl.getAttribLocation(state.pProg, 'aPhase');
      if (state.bgClip < 0 || state.pPos < 0 || state.pSize < 0 || state.pPhase < 0) return false;

      state.bgU = getUniforms(state.bgProg, ['uTime', 'uUp', 'uVol', 'uPulse', 'uFlash', 'uFlashColor']);
      state.pU = getUniforms(state.pProg, ['uTime', 'uUp', 'uVol', 'uPulse', 'uFlash', 'uFlashColor', 'uDpr']);

      state.bgBuf = gl.createBuffer();
      if (!state.bgBuf) return false;
      gl.bindBuffer(gl.ARRAY_BUFFER, state.bgBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1, -1, 1, -1, -1, 1,
        -1, 1, 1, -1, 1, 1
      ]), gl.STATIC_DRAW);

      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.STENCIL_TEST);
      gl.disable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.clearColor(0.02, 0.045, 0.07, 1.0);
      return true;
    } catch (e) { return false; }
  }

  /* ---------- частицы ---------- */
  function buildParticles(count) {
    try {
      var gl = state.gl;
      if (!gl || !state.pProg) return;
      count = Math.max(1, count | 0);
      var data = new Float32Array(count * 5);
      for (var i = 0; i < count; i++) {
        var o = i * 5;
        data[o] = (Math.random() * 2 - 1) * 1.12;
        data[o + 1] = (Math.random() * 2 - 1) * 1.16;
        /* больше частиц в глубине: объём читается плотностью, а не размером */
        data[o + 2] = -1 + 2 * Math.pow(Math.random(), 1.35);
        var sz = 0.55 + Math.pow(Math.random(), 2.0) * 0.65;
        data[o + 3] = sz;
        data[o + 4] = Math.random();
      }
      if (state.pBuf) { try { gl.deleteBuffer(state.pBuf); } catch (e1) {} state.pBuf = null; }
      state.pBuf = gl.createBuffer();
      if (!state.pBuf) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, state.pBuf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      state.count = count;
    } catch (e2) {}
  }

  function rebuildParticles() {
    if (!state.gl) return;
    var base = state.width < 720 ? COUNT_MOBILE : COUNT_DESKTOP;
    if (state.effQ === 2) base = Math.floor(base * 0.5);
    var target = Math.floor(base / Math.pow(2, state.cut));
    if (target < COUNT_FLOOR) target = Math.min(base, COUNT_FLOOR);
    buildParticles(target);
  }

  /* ---------- размеры ---------- */
  function measure() {
    try {
      var cv = state.canvas, gl = state.gl;
      if (!cv || !gl) return;
      var cw = cv.clientWidth || window.innerWidth || 1;
      var ch = cv.clientHeight || window.innerHeight || 1;
      if (cw < 2) cw = window.innerWidth || 2;
      if (ch < 2) ch = window.innerHeight || 2;
      var dpr = state.effQ === 2 ? 1 : (window.devicePixelRatio || 1);
      if (dpr > MAX_DPR) dpr = MAX_DPR;
      if (dpr < 1) dpr = 1;
      var bw = Math.max(1, Math.round(cw * dpr));
      var bh = Math.max(1, Math.round(ch * dpr));
      var maxPix = 4200000;                       /* предохранитель от гигантских буферов */
      if (bw * bh > maxPix) {
        var k = Math.sqrt(maxPix / (bw * bh));
        bw = Math.max(1, Math.round(bw * k));
        bh = Math.max(1, Math.round(bh * k));
      }
      state.width = cw; state.height = ch;
      state.bw = bw; state.bh = bh; state.dpr = bw / cw;
      if (cv.width !== bw) cv.width = bw;
      if (cv.height !== bh) cv.height = bh;
      gl.viewport(0, 0, bw, bh);
      rebuildParticles();
    } catch (e) {}
  }

  /* ---------- отрисовка ---------- */
  function render() {
    try {
      var gl = state.gl;
      if (!gl || state.dead || !state.bgProg || !state.pProg) return;
      gl.viewport(0, 0, state.bw, state.bh);
      gl.disable(gl.BLEND);
      gl.disable(gl.DEPTH_TEST);
      gl.clearColor(0.02, 0.045, 0.07, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      /* фон */
      gl.useProgram(state.bgProg);
      gl.bindBuffer(gl.ARRAY_BUFFER, state.bgBuf);
      gl.enableVertexAttribArray(state.bgClip);
      gl.vertexAttribPointer(state.bgClip, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1f(state.bgU.uTime, state.time);
      gl.uniform1f(state.bgU.uUp, state.up);
      gl.uniform1f(state.bgU.uVol, state.vol);
      gl.uniform1f(state.bgU.uPulse, state.pulse);
      gl.uniform1f(state.bgU.uFlash, state.flash);
      gl.uniform3f(state.bgU.uFlashColor, state.flashColor[0], state.flashColor[1], state.flashColor[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      /* угольки */
      if (state.count > 0 && state.pBuf) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.useProgram(state.pProg);
        gl.bindBuffer(gl.ARRAY_BUFFER, state.pBuf);
        var stride = 5 * 4;
        gl.enableVertexAttribArray(state.pPos);
        gl.vertexAttribPointer(state.pPos, 3, gl.FLOAT, false, stride, 0);
        gl.enableVertexAttribArray(state.pSize);
        gl.vertexAttribPointer(state.pSize, 1, gl.FLOAT, false, stride, 12);
        gl.enableVertexAttribArray(state.pPhase);
        gl.vertexAttribPointer(state.pPhase, 1, gl.FLOAT, false, stride, 16);
        gl.uniform1f(state.pU.uTime, state.time);
        gl.uniform1f(state.pU.uUp, state.up);
        gl.uniform1f(state.pU.uVol, state.vol);
        gl.uniform1f(state.pU.uPulse, state.pulse);
        gl.uniform1f(state.pU.uFlash, state.flash);
        gl.uniform1f(state.pU.uDpr, state.dpr);
        gl.uniform3f(state.pU.uFlashColor, state.flashColor[0], state.flashColor[1], state.flashColor[2]);
        gl.drawArrays(gl.POINTS, 0, state.count);
      }
    } catch (e) {}
  }

  function renderStatic() {
    try {
      if (!state.ready || state.dead || !state.gl || !state.enabled) return;
      state.up = state.upT;
      state.vol = state.volT;
      state.time = 8.0;
      state.pulse = 0;
      state.flash = 0;
      render();
    } catch (e) {}
  }

  /* ---------- кадр ---------- */
  function update(dt) {
    /* на медленных кадрах шаг не больше 50 мс: иначе короткие эффекты
       (вспышка 0.3 с) успевали погаснуть за один кадр и их не было видно */
    if (!(dt > 0)) dt = 0.016;
    if (dt > 0.05) dt = 0.05;
    var k = 1 - Math.exp(-dt * 2.5);
    state.up += (state.upT - state.up) * k;
    state.vol += (state.volT - state.vol) * k;
    if (state.pulse > 0) { state.pulse -= dt / PULSE_TIME; if (state.pulse < 0) state.pulse = 0; }
    if (state.flash > 0) { state.flash -= dt / FLASH_TIME; if (state.flash < 0) state.flash = 0; }
    state.time += dt;
    if (state.time > 3600) state.time -= 3600;
  }

  function degradeOff() {
    state.perfOff = true;
    state.enabled = false;
    stop();
    hideCanvas();
  }

  function perf(raw) {
    try {
      if (state.reduced || state.perfOff) return;
      if (state.warm < 2.0) { state.warm += raw / 1000; return; }
      state.avgMs = state.avgMs * 0.9 + raw * 0.1;
      if (state.avgMs > 30) state.slowFor += raw / 1000; else state.slowFor = 0;
      if (state.slowFor < 2.0) return;
      state.slowFor = 0;
      state.warm = 0;
      if (state.cut < 2) {
        state.cut++;
        rebuildParticles();
      } else {
        degradeOff();
      }
    } catch (e) {}
  }

  function frame(ts) {
    if (!state.running) return;
    state.rafId = raf(frame);
    try {
      if (document.hidden) { stop(); return; }
      var raw = state.last ? ts - state.last : 16;
      if (!isFinite(raw) || raw <= 0) raw = 16;
      if (raw > 250) raw = 16;
      state.last = ts;
      var dt = raw / 1000;
      if (dt > 0.05) dt = 0.05;
      update(dt);
      render();
      perf(raw);
    } catch (e) {
      state.dead = true;
      stop();
      hideCanvas();
    }
  }

  function start() {
    try {
      if (state.running || !state.enabled || state.dead || state.reduced) return;
      if (document.hidden || !state.gl) return;
      state.running = true;
      state.last = 0;
      state.rafId = raf(frame);
    } catch (e) {}
  }

  function stop() {
    state.running = false;
    if (state.rafId) { caf(state.rafId); state.rafId = 0; }
    state.last = 0;
  }

  /* ---------- события ---------- */
  function onLost(ev) {
    try { if (ev && ev.preventDefault) ev.preventDefault(); } catch (e) {}
    state.dead = true;
    stop();
    hideCanvas();
  }

  function onVisibility() {
    try {
      if (document.hidden) stop();
      else if (state.enabled && !state.dead && !state.reduced) { state.last = 0; start(); }
    } catch (e) {}
  }

  function onResize() {
    try {
      if (state.resizeTimer) { window.clearTimeout(state.resizeTimer); state.resizeTimer = 0; }
      state.resizeTimer = window.setTimeout(function () {
        state.resizeTimer = 0;
        try {
          measure();
          if (state.reduced) renderStatic();
          else if (!state.running && state.enabled && !state.dead) start();
        } catch (e) {}
      }, RESIZE_MS);
    } catch (e) {}
  }

  function onMotionChange() {
    try {
      var r = prefersReduced();
      if (r === state.reduced) return;
      state.reduced = r;
      if (r) { stop(); renderStatic(); }
      else if (state.enabled && !state.dead) { state.warm = 0; state.slowFor = 0; start(); }
    } catch (e) {}
  }

  /* ---------- boot ---------- */
  function boot() {
    try {
      if (state.booted || state.dead) return;
      if (!document.body) return;
      state.booted = true;
      if (!createCanvas()) { state.ready = true; return; }
      if (!initGL()) {
        state.dead = true;
        state.enabled = false;
        hideCanvas();
        state.ready = true;
        return;
      }
      state.ready = true;
      state.reduced = prefersReduced();
      state.effQ = state.quality === 2 ? 2 : 1;
      state.up = state.upT;
      state.vol = state.volT;

      try {
        window.addEventListener('resize', onResize, false);
        window.addEventListener('orientationchange', onResize, false);
        document.addEventListener('visibilitychange', onVisibility, false);
      } catch (e1) {}
      try {
        if (window.matchMedia) {
          var mq = window.matchMedia('(prefers-reduced-motion: reduce)');
          if (mq && mq.addEventListener) mq.addEventListener('change', onMotionChange);
          else if (mq && mq.addListener) mq.addListener(onMotionChange);
        }
      } catch (e2) {}

      measure();
      if (!state.enabled) { hideCanvas(); return; }
      if (state.reduced) renderStatic();
      else if (!document.hidden) start();
    } catch (e3) {}
  }

  function onReady() { try { boot(); } catch (e) {} }

  /* ---------- публичный API ---------- */
  window.dxBg = {
    __dx: true,
    __dx3d: true,
    setMarket: function (o) {
      try {
        if (!o) return;
        if (o.up === true) state.upT = 1.0;
        else if (o.up === false) state.upT = 0.0;
        else if (typeof o.up === 'number' && isFinite(o.up)) state.upT = clamp01(o.up);
        if (typeof o.vol === 'number' && isFinite(o.vol)) state.volT = clamp01(o.vol);
        if (o.pulse === 'up' || o.pulse === 'down') state.pulse = 1.0;
        if (state.reduced) renderStatic();
      } catch (e) {}
    },
    flash: function (kind) {
      try {
        if (kind === 'up') state.flashColor = [0.45, 0.95, 0.72];
        else if (kind === 'down') state.flashColor = [1.0, 0.62, 0.66];
        else state.flashColor = [1.0, 0.83, 0.55];
        state.flash = 1.0;
        if (state.reduced) renderStatic();
      } catch (e) {}
    },
    setEnabled: function (on) {
      try {
        var want = on !== false;
        if (!want) {
          state.enabled = false;
          stop();
          hideCanvas();
          return;
        }
        state.enabled = true;
        if (!state.booted) { boot(); return; }
        if (state.dead) return;
        state.perfOff = false;
        state.cut = 0;
        state.warm = 0;
        state.slowFor = 0;
        state.avgMs = 16;
        showCanvas();
        measure();
        if (state.reduced) renderStatic();
        else if (!state.running) { state.last = 0; start(); }
      } catch (e) {}
    },
    isEnabled: function () { return !!state.enabled; },
    setQuality: function (n) {
      try {
        var q = parseInt(n, 10);
        if (!isFinite(q) || q < 0 || q > 2 || q === state.quality) return;
        state.quality = q;
        state.effQ = q === 2 ? 2 : 1;
        if (!state.booted || state.dead) return;
        if (!state.enabled) return;
        measure();
        if (state.reduced) renderStatic();
        else if (!state.running) { state.last = 0; start(); }
      } catch (e) {}
    }
  };

  if (document.body) boot();
  else {
    try { document.addEventListener('DOMContentLoaded', onReady, false); } catch (e) {}
    try { window.addEventListener('load', onReady, false); } catch (e2) {}
  }
  /* Светлая тема рассчитана на светлый фон (тёмные заголовки на молочном
     стекле). Тёмное небо с искрами там убивает контраст, поэтому фон живёт
     только в тёмной теме, а в светлой отдаём прежний градиент страницы. */
  function syncTheme() {
    try {
      var dark = !!(document.body && document.body.classList.contains('dark'));
      if (window.dxBg.isEnabled() === dark) return;
      window.dxBg.setEnabled(dark);
    } catch (e) {}
  }

  if (typeof document !== 'undefined') {
    var armTheme = function () {
      syncTheme();
      try {
        if (window.MutationObserver && document.body) {
          new MutationObserver(syncTheme).observe(document.body, { attributes: true, attributeFilter: ['class'] });
        }
      } catch (e) {}
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', armTheme);
    else armTheme();
  }
})();
