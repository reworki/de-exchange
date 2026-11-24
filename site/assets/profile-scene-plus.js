/* DE Exchange 3.2 · аддон к сцене профиля.
   Делает сцену «живой»: свет по времени суток, вид из окна на город,
   монеты на полу, пыль в луче и дыхание персонажа.

   Ничего не меняет в profile-scene.js и index.html: перехватывает
   window.dxScene.render, добавляет внутрь .dxs только свои слои.
   ES5, без внешних запросов и без localStorage. */
(function () {
  'use strict';

  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  var STYLE_ID = 'dxsp-style';
  var FLAG = '__dxsPlusInstalled';
  var retryTimer = null;
  var retries = 0;
  var scanTimer = null;
  var observer = null;

  /* ---------- утилиты ---------- */

  function el(tag, cls) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    return node;
  }

  function addClass(node, name) {
    if (!node || !name) return;
    if (node.classList) {
      node.classList.add(name);
      return;
    }
    var current = ' ' + (node.className || '') + ' ';
    if (current.indexOf(' ' + name + ' ') < 0) node.className = (node.className ? node.className + ' ' : '') + name;
  }

  function deco(node) {
    if (!node) return node;
    node.setAttribute('aria-hidden', 'true');
    return node;
  }

  /* Наивный, но стабильный строковый хеш: одинаковый ник — одинаковая сцена. */
  function hashText(text) {
    var str = String(text == null ? '' : text);
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    return h >>> 0;
  }

  /* Park–Miller: детерминированный поток [0, 1) для «случайного, но стабильного» декора. */
  function rng(seed) {
    var s = (seed >>> 0) % 2147483647;
    if (s <= 0) s += 2147483646;
    return function () {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };
  }

  function round1(value) {
    return Math.round(value * 10) / 10;
  }

  function clamp(value, min, max) {
    if (!isFinite(value)) return min;
    return value < min ? min : value > max ? max : value;
  }

  /* ---------- капитал ---------- */

  function readCapital(data) {
    var capital = 0;
    try {
      if (data && typeof data.capital === 'number' && isFinite(data.capital)) {
        return Math.max(0, data.capital);
      }
    } catch (e) { /* данные могут быть какими угодно */ }

    try {
      if (window.state && typeof window.state.usdt === 'number' && isFinite(window.state.usdt)) {
        capital += window.state.usdt;
      }
    } catch (e2) { /* нет глобала — нет беды */ }

    try {
      var assets = window.ASSETS;
      if (assets && typeof assets.length === 'number') {
        for (var i = 0; i < assets.length; i++) {
          var item = assets[i];
          if (!item) continue;
          var amt = Number(item.amt);
          var price = Number(item.price);
          if (isFinite(amt) && isFinite(price)) capital += amt * price;
        }
      }
    } catch (e3) { /* то же самое */ }

    return capital > 0 && isFinite(capital) ? capital : 0;
  }

  function coinsFor(capital) {
    if (!(capital > 0)) return 3;
    var t = (Math.log(capital) / Math.LN10 - 3) / 12;
    t = clamp(t, 0, 1);
    return Math.max(3, Math.min(14, 3 + Math.round(t * 11)));
  }

  function cityFor(capital) {
    if (!(capital > 1e15)) {
      if (!(capital > 1e12)) return '';
      return 'day';
    }
    return 'night';
  }

  /* ---------- ник и геометрия ---------- */

  function nickOf(scene, data) {
    try {
      if (data && typeof data.nick === 'string' && data.nick) return data.nick;
      var nick = scene.querySelector('.dxs-nick');
      if (nick && nick.textContent) return nick.textContent.replace(/^@/, '');
      var label = scene.getAttribute('aria-label') || '';
      var match = /@([^\s.]+)/.exec(label);
      if (match) return match[1];
    } catch (e) { /* сцена могла быть без ника */ }
    return 'guest';
  }

  /* Доли сцены, занятые персонажем и плашкой: монеты туда не кладём. */
  function boxFor(scene, selector, padX, padY) {
    try {
      var target = scene.querySelector(selector);
      if (!target) return null;
      var sceneRect = scene.getBoundingClientRect();
      var rect = target.getBoundingClientRect();
      if (!sceneRect.width || !sceneRect.height || !rect.width || !rect.height) return null;
      return {
        l: (rect.left - sceneRect.left) / sceneRect.width - padX,
        r: (rect.right - sceneRect.left) / sceneRect.width + padX,
        t: (rect.top - sceneRect.top) / sceneRect.height - padY,
        b: (rect.bottom - sceneRect.top) / sceneRect.height + padY
      };
    } catch (e) {
      return null;
    }
  }

  function inside(box, x, y) {
    return !!box && x > box.l && x < box.r && y > box.t && y < box.b;
  }

  /* Доля ширины сцены, перекрытая плашкой и стендами на заданной высоте. */
  function coveredShare(boxes, y) {
    var spans = [];
    var i;
    for (i = 0; i < boxes.length; i++) {
      var box = boxes[i];
      if (!box || !(box.t <= y && box.b >= y)) continue;
      spans.push([Math.max(0, box.l), Math.min(1, box.r)]);
    }
    spans.sort(function (a, b) { return a[0] - b[0]; });
    var total = 0;
    var start = null;
    var end = 0;
    for (i = 0; i < spans.length; i++) {
      if (start === null) {
        start = spans[i][0];
        end = spans[i][1];
      } else if (spans[i][0] <= end) {
        if (spans[i][1] > end) end = spans[i][1];
      } else {
        total += end - start;
        start = spans[i][0];
        end = spans[i][1];
      }
    }
    if (start !== null) total += end - start;
    return total;
  }

  function coinSpots(scene, seed, count) {
    var rand = rng(seed ^ 0x2f6a3d1b);
    var person = boxFor(scene, '.dxs-character', 0.02, 0.01);
    var badge = boxFor(scene, '.dxs-badge', 0.015, 0.015);
    var stands = boxFor(scene, '.dxs-stands', 0.01, 0.01);
    var spots = [];
    var attempts = 0;

    /* Если плашка и стенды занимают почти весь низ (узкий экран),
       поднимаем «пол» монет над ними, иначе они уйдут в щель между блоками. */
    var uiTop = 1;
    if (badge && badge.t < uiTop) uiTop = badge.t;
    if (stands && stands.t < uiTop) uiTop = stands.t;
    var cramped = coveredShare([badge, stands], 0.9) > 0.55;
    var yMin = cramped ? Math.max(0.5, uiTop - 0.11) : 0.755;
    var yMax = cramped ? Math.max(yMin + 0.05, Math.min(0.95, uiTop - 0.012)) : 0.95;

    while (spots.length < count && attempts < count * 70) {
      attempts++;
      var x = 0.03 + rand() * 0.94;
      var y = yMin + rand() * (yMax - yMin);
      if (inside(person, x, y) || inside(badge, x, y) || inside(stands, x, y)) continue;
      spots.push({ x: x, y: y, rot: rand() * 44 - 22, scale: 0.82 + rand() * 0.26, size: rand() * 3.2 });
    }

    /* Страховка: раскладываем остаток детерминированно по свободным полосам. */
    while (spots.length < count) {
      var k = spots.length;
      var right = cramped ? (k % 2 === 0) : true;
      spots.push({
        x: (right ? 0.62 : 0.05) + ((k * 37) % 28) / 100,
        y: yMin + ((k * 19) % 33) / 100 * (yMax - yMin),
        rot: (k * 29) % 44 - 22,
        scale: 0.86 + ((k * 7) % 9) / 100,
        size: ((k * 13) % 32) / 10
      });
    }

    return spots;
  }

  /* ---------- город за окном ---------- */

  function buildingWindows(out, rand, x, top, bw, bh, night, budget) {
    var cols = Math.max(1, Math.floor((bw - 3.4) / 4.8));
    var rows = Math.max(1, Math.floor((bh - 5) / 5.6));
    var stepX = (bw - 3.4) / cols;
    var stepY = (bh - 5) / rows;
    var warm = night ? '#ffd48a' : '#ffbe7a';
    var flickChance = night ? 0.18 : 0.1;

    for (var row = 0; row < rows; row++) {
      for (var col = 0; col < cols; col++) {
        if (budget.left <= 0) return budget;
        if (rand() > (night ? 0.21 : 0.14)) continue;
        budget.left--;
        var lit = rand() < flickChance;
        out.push(
          '<rect class="dxsp-city-lit' + (lit ? ' dxsp-city-flicker' : '') + '"' +
          ' x="' + round1(x + 2.2 + col * stepX) + '"' +
          ' y="' + round1(top + 3 + row * stepY) + '"' +
          ' width="1.7" height="2.1" fill="' + warm + '"' +
          (lit
            ? ' style="animation-delay:-' + round1(rand() * 9) + 's;animation-duration:' + round1(4 + rand() * 5) + 's"'
            : '') +
          '/>'
        );
      }
    }
    return budget;
  }

  function citySvg(seed, night) {
    var rand = rng(seed);
    var out = [];
    var budget = { left: night ? 54 : 44 };
    var i;

    out.push('<svg viewBox="0 0 200 140" preserveAspectRatio="xMidYMax slice" focusable="false">');

    if (night) {
      for (i = 0; i < 16; i++) {
        out.push(
          '<circle cx="' + round1(rand() * 200) + '" cy="' + round1(rand() * 64) +
          '" r="' + round1(0.25 + rand() * 0.6) + '" fill="#e6edff" opacity="' +
          round1(0.18 + rand() * 0.42) + '"/>'
        );
      }
      out.push('<circle class="dxsp-moon" cx="146" cy="26" r="9.4" fill="#f7dca6" opacity=".92"/>');
      out.push('<circle cx="141.8" cy="22.8" r="8.6" fill="#0a1330" opacity=".62"/>');
    } else {
      out.push('<circle cx="148" cy="29" r="15" fill="#ffcf8a" opacity=".28"/>');
      out.push('<circle cx="148" cy="29" r="7" fill="#ffe3ab" opacity=".5"/>');
    }

    /* Дальний ряд — бледнее и ниже, ближний — плотный силуэт. */
    var far = night ? '#0a1631' : '#2c170b';
    var near = night ? '#040a16' : '#1a0d05';

    var x = -8;
    while (x < 202) {
      var bw = 15 + rand() * 17;
      var bh = 30 + rand() * 62;
      out.push('<rect x="' + round1(x) + '" y="' + round1(140 - bh) + '" width="' + round1(bw) +
        '" height="' + round1(bh) + '" fill="' + far + '" opacity=".78"/>');
      x += bw + 2 + rand() * 3;
    }

    x = -6;
    while (x < 202) {
      var wide = 16 + rand() * 20;
      var high = 42 + rand() * 80;
      var top = 140 - high;
      out.push('<rect x="' + round1(x) + '" y="' + round1(top) + '" width="' + round1(wide) +
        '" height="' + round1(high) + '" fill="' + near + '" opacity=".94"/>');
      if (rand() > 0.58) {
        out.push('<rect x="' + round1(x + wide * 0.38) + '" y="' + round1(top - 7) +
          '" width="1.1" height="7" fill="' + near + '"/>');
        out.push('<circle class="dxsp-beacon" cx="' + round1(x + wide * 0.38 + 0.6) + '" cy="' + round1(top - 7.6) +
          '" r="0.9" fill="#ff8c1a" opacity=".8"/>');
      }
      budget = buildingWindows(out, rand, x, top, wide, high, night, budget);
      x += wide + 2.6 + rand() * 3.4;
    }

    if (night) {
      out.push('<rect class="dxsp-neon dxsp-neon-pink" x="' + round1(18 + rand() * 54) + '" y="' +
        round1(96 + rand() * 16) + '" width="1.5" height="' + round1(9 + rand() * 10) + '" opacity=".85"/>');
      out.push('<rect class="dxsp-neon dxsp-neon-cyan" x="' + round1(118 + rand() * 48) + '" y="' +
        round1(88 + rand() * 16) + '" width="' + round1(7 + rand() * 8) + '" height="1.5" opacity=".8"/>');
      out.push('<rect class="dxsp-neon dxsp-neon-cyan" x="' + round1(132 + rand() * 34) + '" y="' +
        round1(104 + rand() * 12) + '" width="1.5" height="' + round1(6 + rand() * 6) + '" opacity=".7"/>');
    }

    out.push('</svg>');
    return out.join('');
  }

  function makeWindow(seed, level) {
    var win = el('div', 'dxsp-window dxsp-window--' + level);
    deco(win);
    win.innerHTML = citySvg(seed, level === 'night');
    return win;
  }

  /* ---------- слои ---------- */

  function timeOfDay() {
    var hour = new Date().getHours();
    if (hour >= 5 && hour < 11) return 'morning';
    if (hour >= 11 && hour < 17) return 'day';
    if (hour >= 17 && hour < 22) return 'evening';
    return 'night';
  }

  function stillPreferred() {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) {
      return false;
    }
  }

  function prune(scene) {
    var nodes = scene.querySelectorAll('.dxsp-light, .dxsp-window, .dxsp-coins, .dxsp-dust, .dxsp-shine');
    for (var i = nodes.length - 1; i >= 0; i--) {
      if (nodes[i].parentNode === scene) scene.removeChild(nodes[i]);
    }
  }

  function enhance(scene, data) {
    if (!scene || scene.nodeType !== 1 || typeof scene.appendChild !== 'function') return null;
    if (scene.getAttribute('data-dxsp')) return scene;

    scene.setAttribute('data-dxsp', '');
    ensureStyles();
    prune(scene);

    if (window.getComputedStyle) {
      var position = window.getComputedStyle(scene).position;
      if (!position || position === 'static') scene.style.position = 'relative';
    } else if (!scene.style.position) {
      scene.style.position = 'relative';
    }

    var still = stillPreferred();
    var capital = readCapital(data);
    var nick = nickOf(scene, data);
    var seed = hashText(nick.toLowerCase() || 'guest');
    var level = cityFor(capital);
    var sceneHeight = 260;
    var unit = 1;
    try {
      var rect = scene.getBoundingClientRect();
      if (rect && rect.height) sceneHeight = rect.height;
    } catch (e) { /* без размеров обойдёмся базовыми */ }
    unit = clamp(sceneHeight / 300, 0.9, 1.5);

    addClass(scene, 'dxsp-on');
    addClass(scene, 'dxsp-tod--' + timeOfDay());
    if (still) addClass(scene, 'dxsp-still');

    /* 1. Свет по времени суток: тёплый/нейтральный/холодный + винье́т. */
    var light = deco(el('div', 'dxsp-light'));
    scene.appendChild(light);

    /* 2. Вид из окна на город — только для крупного капитала. */
    if (level) scene.appendChild(makeWindow(seed, level));

    /* 3. Монеты на полу: перед персонажем в дереве, чтобы никогда не лечь ему на лицо. */
    var coins = deco(el('div', 'dxsp-coins'));
    var count = coinsFor(capital);
    var spots = coinSpots(scene, seed, count);
    for (var i = 0; i < spots.length; i++) {
      var spot = spots[i];
      var coin = el('span', 'dxsp-coin');
      coin.style.left = round1(spot.x * 100) + '%';
      coin.style.top = round1(spot.y * 100) + '%';
      coin.style.width = round1((7.2 + spot.size) * unit) + 'px';
      coin.style.transform = 'rotate(' + round1(spot.rot) + 'deg) scaleY(' + round1(spot.scale) + ')';
      coins.appendChild(coin);
    }
    var character = scene.querySelector('.dxs-character');
    if (character && character.parentNode === scene) scene.insertBefore(coins, character);
    else scene.appendChild(coins);

    /* 4. Пыль в луче: очень слабая, медленно плывёт. */
    var dust = deco(el('div', 'dxsp-dust'));
    var rand = rng(seed ^ 0x5b1d77);
    var motes = 10 + Math.floor(rand() * 9);
    for (var m = 0; m < motes; m++) {
      var mote = el('i', 'dxsp-dust-mote');
      mote.style.left = round1(3 + rand() * 90) + '%';
      mote.style.top = round1(6 + rand() * 68) + '%';
      mote.style.width = round1((1.15 + rand() * 1.7) * unit) + 'px';
      mote.style.animationDuration = round1(16 + rand() * 16) + 's';
      mote.style.animationDelay = '-' + round1(rand() * 26) + 's';
      dust.appendChild(mote);
    }
    scene.appendChild(dust);

    /* 5. Блик по золоту раз в 5–9 секунд. */
    if (!still) {
      var shine = deco(el('div', 'dxsp-shine'));
      shine.style.animationDuration = round1(5 + ((seed >>> 3) % 40) / 10) + 's';
      shine.style.animationDelay = '-' + round1(((seed >>> 5) % 90) / 10) + 's';
      scene.appendChild(shine);
    }

    /* 6. Дыхание персонажа — только если у него нет собственной анимации. */
    if (!still && character && window.getComputedStyle) {
      try {
        var current = window.getComputedStyle(character).animationName;
        if (!current || current === 'none') addClass(character, 'dxsp-breathe');
      } catch (e) { /* анимация не критична */ }
    }

    return scene;
  }

  /* ---------- стили ---------- */

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.appendChild(document.createTextNode(CSS));
    (document.head || document.documentElement).appendChild(style);
  }

  var CSS = [
    '.dxs .dxsp-light, .dxs .dxsp-window, .dxs .dxsp-coins, .dxs .dxsp-dust, .dxs .dxsp-shine { position: absolute; pointer-events: none; }',

    /* Свет по времени суток: soft-light, чтобы не закрашивать персонажа. */
    '.dxsp-light {',
    '  inset: 0; z-index: 2; mix-blend-mode: soft-light; opacity: .5;',
    '  background:',
    '    radial-gradient(120% 100% at 24% 8%, rgba(255,250,240,.55), rgba(255,250,240,0) 66%),',
    '    radial-gradient(150% 130% at 50% 42%, rgba(0,0,0,0) 46%, rgba(0,0,0,.5) 100%);',
    '}',
    '.dxs.dxsp-tod--morning .dxsp-light {',
    '  opacity: .6;',
    '  background:',
    '    radial-gradient(88% 72% at 16% 4%, rgba(255,206,182,.9), rgba(255,188,150,.26) 42%, rgba(255,188,150,0) 74%),',
    '    radial-gradient(62% 52% at 82% 18%, rgba(255,236,198,.5), rgba(255,236,198,0) 72%),',
    '    radial-gradient(140% 122% at 50% 40%, rgba(0,0,0,0) 44%, rgba(46,17,6,.5) 100%);',
    '}',
    '.dxs.dxsp-tod--day .dxsp-light {',
    '  opacity: .4;',
    '  background:',
    '    radial-gradient(120% 100% at 28% 2%, rgba(255,252,244,.75), rgba(255,250,240,0) 70%),',
    '    radial-gradient(142% 122% at 50% 44%, rgba(0,0,0,0) 48%, rgba(0,0,0,.42) 100%);',
    '}',
    '.dxs.dxsp-tod--evening .dxsp-light {',
    '  opacity: .68;',
    '  background:',
    '    radial-gradient(92% 76% at 84% 6%, rgba(255,150,58,.9), rgba(255,118,28,.3) 44%, rgba(255,118,28,0) 76%),',
    '    radial-gradient(58% 50% at 16% 32%, rgba(255,198,124,.42), rgba(255,198,124,0) 72%),',
    '    radial-gradient(140% 122% at 50% 40%, rgba(0,0,0,0) 40%, rgba(48,15,2,.54) 100%);',
    '}',
    '.dxs.dxsp-tod--night .dxsp-light {',
    '  opacity: .56;',
    '  background:',
    '    radial-gradient(100% 88% at 72% 2%, rgba(128,174,255,.44), rgba(62,92,190,.16) 46%, rgba(30,50,120,0) 76%),',
    '    radial-gradient(142% 132% at 50% 40%, rgba(0,0,0,0) 34%, rgba(3,6,17,.6) 100%);',
    '}',

    /* Вид из окна на город. */
    '.dxsp-window {',
    '  left: 3.2%; top: 6%; width: 27%; height: 37%;',
    '  z-index: 3; overflow: hidden; border-radius: 7px;',
    '  background: linear-gradient(180deg, #1d2a45 0%, #2a4162 46%, #4a5566 100%);',
    '  border: 1px solid rgba(247,220,166,.26);',
    '  box-shadow: 0 14px 30px rgba(0,0,0,.42), inset 0 0 0 1px rgba(0,0,0,.45), inset 0 0 26px rgba(0,0,0,.55);',
    '}',
    '.dxsp-window--day {',
    '  background: linear-gradient(180deg, #55260f 0%, #8a4416 38%, #dd8837 74%, #ffc477 100%);',
    '  border-color: rgba(255,196,120,.24);',
    '}',
    '.dxsp-window--night {',
    '  background: linear-gradient(180deg, #04091a 0%, #0a1738 54%, #13244d 100%);',
    '  border-color: rgba(130,180,255,.24);',
    '  box-shadow: 0 14px 30px rgba(0,0,0,.5), inset 0 0 0 1px rgba(0,0,0,.5), inset 0 0 30px rgba(0,16,50,.7);',
    '}',
    '.dxsp-window svg { position: absolute; inset: 0; display: block; width: 100%; height: 100%; }',
    '.dxsp-window::before {',
    '  content: ""; position: absolute; left: 64%; top: 0; bottom: 0; width: 1px; z-index: 2;',
    '  background: rgba(8,6,2,.5); box-shadow: 0 0 0 .5px rgba(255,255,255,.06);',
    '}',
    '.dxsp-window::after {',
    '  content: ""; position: absolute; inset: 0; z-index: 3;',
    '  background: linear-gradient(112deg, rgba(255,255,255,.13) 0%, rgba(255,255,255,.03) 24%, rgba(255,255,255,0) 46%, rgba(255,255,255,0) 72%, rgba(255,255,255,.06) 100%);',
    '  mix-blend-mode: screen;',
    '}',
    '.dxsp-city-lit { opacity: .72; }',
    '.dxsp-city-flicker { animation: dxsp-wink 5s ease-in-out infinite; }',
    '.dxsp-moon { filter: drop-shadow(0 0 6px rgba(247,220,166,.7)); }',
    '.dxsp-beacon { animation: dxsp-beacon 3.2s steps(2, end) infinite; }',
    '.dxsp-neon-pink { fill: #ff5cc8; filter: drop-shadow(0 0 3px rgba(255,92,200,.9)); }',
    '.dxsp-neon-cyan { fill: #57e0ff; filter: drop-shadow(0 0 3px rgba(87,224,255,.9)); }',

    /* Монеты на полу. */
    '.dxsp-coins { inset: 0; pointer-events: none; }',
    '.dxsp-coin {',
    '  position: absolute; display: block; border-radius: 50%; aspect-ratio: 1 / 1;',
    '  background: radial-gradient(circle at 34% 30%, #fff7dd 0%, #ffe6a0 24%, #f7dca6 46%, #d9a341 72%, #8a5c15 100%);',
    '  box-shadow: 0 1px 2px rgba(0,0,0,.55), 0 0 5px rgba(255,186,88,.28), inset 0 0 0 1px rgba(255,244,209,.4);',
    '  opacity: .96;',
    '}',
    '.dxsp-coin::after {',
    '  content: ""; position: absolute; left: 16%; top: 13%; width: 36%; height: 24%; border-radius: 50%;',
    '  background: radial-gradient(circle, rgba(255,255,255,.9), rgba(255,255,255,0) 72%);',
    '}',

    /* Пыль в луче. */
    '.dxsp-dust { inset: 0; z-index: 3; overflow: hidden; }',
    '.dxsp-dust-mote {',
    '  position: absolute; display: block; border-radius: 50%; aspect-ratio: 1 / 1;',
    '  background: radial-gradient(circle, #ffeccb 0%, rgba(255,226,180,.5) 55%, rgba(255,226,180,0) 100%);',
    '  animation-name: dxsp-drift; animation-timing-function: ease-in-out;',
    '  animation-iteration-count: infinite; animation-direction: alternate;',
    '  will-change: transform, opacity;',
    '}',

    /* Блик по золоту. */
    '.dxsp-shine {',
    '  top: -30%; left: -25%; width: 26%; height: 160%; z-index: 4;',
    '  background: linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,238,198,.18) 38%, rgba(255,255,255,.34) 50%, rgba(255,238,198,.18) 62%, rgba(255,255,255,0) 100%);',
    '  transform: rotate(16deg); mix-blend-mode: screen; opacity: 0;',
    '  animation-name: dxsp-sweep; animation-timing-function: ease-in-out; animation-iteration-count: infinite;',
    '}',

    /* Дыхание персонажа. */
    '.dxs-character.dxsp-breathe {',
    '  animation-name: dxsp-breathe; animation-duration: 7s; animation-timing-function: ease-in-out;',
    '  animation-iteration-count: infinite; transform-origin: 50% 100%; will-change: transform;',
    '}',

    '@keyframes dxsp-drift {',
    '  0% { transform: translate3d(0,0,0); opacity: .05; }',
    '  42% { opacity: .3; }',
    '  100% { transform: translate3d(6px,-24px,0); opacity: .06; }',
    '}',
    '@keyframes dxsp-sweep {',
    '  0% { transform: translate3d(0,0,0) rotate(16deg); opacity: 0; }',
    '  3% { opacity: .85; }',
    '  13% { opacity: 0; }',
    '  100% { transform: translate3d(520%,0,0) rotate(16deg); opacity: 0; }',
    '}',
    '@keyframes dxsp-breathe {',
    '  0%, 100% { transform: translate3d(0,0,0) scale(1); }',
    '  50% { transform: translate3d(0,-.5%,0) scale(1.004); }',
    '}',
    '@keyframes dxsp-wink {',
    '  0%, 100% { opacity: .78; }',
    '  46% { opacity: .22; }',
    '  54% { opacity: .9; }',
    '}',
    '@keyframes dxsp-beacon {',
    '  0%, 49% { opacity: .85; }',
    '  50%, 100% { opacity: .15; }',
    '}',

    /* prefers-reduced-motion: пыль, блик и дыхание выключаем, свет и монеты статичны. */
    '.dxs.dxsp-still .dxsp-dust-mote,',
    '.dxs.dxsp-still .dxsp-shine,',
    '.dxs.dxsp-still .dxs-character.dxsp-breathe,',
    '.dxs.dxsp-still .dxsp-city-flicker,',
    '.dxs.dxsp-still .dxsp-beacon {',
    '  animation: none !important;',
    '}',
    '.dxs.dxsp-still .dxsp-shine { display: none !important; }',
    '.dxs.dxsp-still .dxsp-dust-mote { opacity: .2 !important; }',
    '.dxs.dxsp-still .dxsp-city-lit { opacity: .72; }',

    '@media (prefers-reduced-motion: reduce) {',
    '  .dxs .dxsp-dust-mote,',
    '  .dxs .dxsp-shine,',
    '  .dxs .dxs-character.dxsp-breathe,',
    '  .dxs .dxsp-city-flicker,',
    '  .dxs .dxsp-beacon { animation: none !important; }',
    '  .dxs .dxsp-shine { display: none !important; }',
    '  .dxs .dxsp-dust-mote { opacity: .2 !important; }',
    '}'
  ].join('\n');

  /* ---------- наблюдение ---------- */

  function scanAll() {
    try {
      var scenes = document.querySelectorAll('.dxs');
      for (var i = 0; i < scenes.length; i++) {
        if (!scenes[i].getAttribute('data-dxsp')) enhance(scenes[i], null);
      }
    } catch (e) { /* разметка чужая — молчим */ }
  }

  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(function () {
      scanTimer = null;
      scanAll();
    }, 200);
  }

  /* Точный фильтр: реагируем только на добавление сцен, которым ещё нужен аддон. */
  function needsEnhance(node) {
    if (!node || node.nodeType !== 1) return false;
    try {
      if (node.classList && node.classList.contains('dxs') && !node.getAttribute('data-dxsp')) return true;
      if (node.querySelector) {
        var pending = node.querySelectorAll('.dxs:not([data-dxsp])');
        if (pending && pending.length) return true;
      }
    } catch (e) { /* не наш узел */ }
    return false;
  }

  function observe() {
    if (observer || !window.MutationObserver || !document.body) return;
    try {
      observer = new MutationObserver(function (records) {
        for (var i = 0; i < records.length; i++) {
          var added = records[i].addedNodes;
          for (var j = 0; j < added.length; j++) {
            if (needsEnhance(added[j])) {
              scheduleScan();
              return;
            }
          }
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    } catch (e) { /* старый браузер — обойдёмся таймером */ }
  }

  function watchMotion() {
    try {
      if (!window.matchMedia) return;
      var mql = window.matchMedia('(prefers-reduced-motion: reduce)');
      var onChange = function () {
        var still = !!(mql.matches);
        var scenes = document.querySelectorAll('.dxs');
        for (var i = 0; i < scenes.length; i++) {
          if (still) addClass(scenes[i], 'dxsp-still');
          else if (scenes[i].classList) scenes[i].classList.remove('dxsp-still');
        }
      };
      if (mql.addEventListener) mql.addEventListener('change', onChange);
      else if (mql.addListener) mql.addListener(onChange);
    } catch (e) { /* не критично */ }
  }

  /* ---------- установка ---------- */

  function install() {
    retryTimer = null;
    if (window[FLAG]) return;

    var scene = window.dxScene;
    if (!scene || typeof scene.render !== 'function') {
      retries++;
      if (retries < 40) retryTimer = setTimeout(install, 250);
      return;
    }

    window[FLAG] = true;

    var original = scene.render;
    scene.render = function (container, data) {
      var result = original.apply(this || scene, arguments);
      if (result && result.nodeType === 1) {
        try {
          enhance(result, data);
        } catch (e) { /* сцена важнее декора */ }
      }
      return result;
    };

    ensureStyles();
    if (document.body) {
      observe();
    } else if (document.addEventListener) {
      document.addEventListener('DOMContentLoaded', observe, false);
    }
    watchMotion();

    /* Если render уже вызывали до аддона — догоняем существующие сцены. */
    setTimeout(function () {
      scanAll();
      observe();
    }, 0);
  }

  install();
})();
