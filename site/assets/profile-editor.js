/* ============================================================================
   DE Exchange — «Редактор профиля» (витрина игрока)
   ----------------------------------------------------------------------------
   Один самодостаточный модуль без сборки и библиотек.
   Наружу отдаёт только window.dxProfileEditor = { open, close }.

   Что умеет:
     · выбрать одну квартиру/дом/виллу из купленных (cat === 'homes');
     · надеть до 5 украшений из купленных (cat === 'lux');
     · выставить до 6 блатных номеров из ext.numbers;
     · живой предпросмотр через window.dxScene (или текстовая заглушка);
     · сохранить всё на сервер POST /api/showcase.

   Данные только читаются. Чужие id в состояние не попадают: каждое значение
   проверяется по спискам ext.assets / ext.numbers.
   ============================================================================ */
(function () {
  'use strict';

  var OVERLAY_ID = 'dxPeOverlay';
  var STYLE_ID = 'dxPeStyles';
  var API_PATH = '/api/showcase';
  var MAX_WEAR = 5;    // цепь, часы, браслет, кольцо, серьги — пять слотов
  var MAX_STANDS = 6;  // столько номеров влезает на стенды

  // В категории lux лежат ещё и инвестиции (остров, картина, стадион).
  // Это не украшения: на себя их надеть нельзя, в слоты не пускаем.
  var NOT_WEARABLE_LUX = { island: 1, painting: 1, stadium: 1 };

  var current = null;  // открытая сессия редактора (или null)

  /* ==========================================================================
     Мелкие утилиты
     ========================================================================== */

  // Экранирование любого текста, который попадает в HTML или атрибут.
  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Массив из массива / JSON-строки / строки с разделителями. Всё остальное — [].
  function asArray(value) {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string' && value) {
      var s = value.trim();
      if (s.charAt(0) === '[') {
        try {
          var parsed = JSON.parse(s);
          if (Array.isArray(parsed)) return parsed;
        } catch (e) { /* не JSON — попробуем разделить ниже */ }
      }
      return s.split(/[\s,]+/);
    }
    return [];
  }

  // id может прийти строкой или объектом {id: ...} — приводим к строке.
  function normId(value) {
    if (value && typeof value === 'object') value = value.id;
    return String(value == null ? '' : value).trim();
  }

  // Ник без ведущих «@» — так его удобнее и показывать, и слать в API.
  function cleanNick(value) {
    return String(value == null ? '' : value).trim().replace(/^@+/, '');
  }

  // Русские склонения: 1 украшение / 2 украшения / 5 украшений.
  function plural(count, forms) {
    var n10 = count % 10;
    var n100 = count % 100;
    if (n10 === 1 && n100 !== 11) return forms[0];
    if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return forms[1];
    return forms[2];
  }

  // toast может отсутствовать (например, в тестовой странице) — не падаем.
  function notify(text, kind) {
    try {
      if (typeof window.toast === 'function') {
        window.toast(text, kind || 'info');
        return;
      }
    } catch (e) { /* показывать нечем — молча живём дальше */ }
    if (window.console && typeof window.console.warn === 'function') {
      window.console.warn('[dxProfileEditor] ' + text);
    }
  }

  // deApiReq тоже может не быть — считаем, что связи нет.
  function api(method, path, body, cb) {
    var fn = window.deApiReq;
    if (typeof fn !== 'function') {
      cb({ offline: true });
      return;
    }
    var done = false;
    function once(result) {
      if (done) return;
      done = true;
      cb(result);
    }
    try {
      fn(method, path, body, once);
    } catch (e) {
      once({ offline: true });
    }
  }

  // Аккаунт: ник без @ и захешированный пароль берём только из __DE_ACC.
  function accountNick(acc) {
    if (!acc) return '';
    try {
      if (typeof window.deBasis === 'function') {
        var basis = window.deBasis(acc);
        if (basis) return cleanNick(basis);
      }
    } catch (e) { /* fallback ниже */ }
    return cleanNick(acc.nick_lc || acc.nick || '');
  }

  function displayNick(acc, fallback) {
    return cleanNick((acc && (acc.nick || acc.nick_lc)) || fallback || '');
  }

  /* ==========================================================================
     Каталог: предметы, картинки, эмодзи
     ========================================================================== */

  function itemById(id) {
    id = normId(id);
    if (!id) return null;
    var by = window.ASSET_BY;
    if (by && by[id] && typeof by[id] === 'object') return by[id];
    var list = window.ASSET_ITEMS;
    if (Array.isArray(list)) {
      for (var i = 0; i < list.length; i++) {
        if (list[i] && normId(list[i].id) === id) return list[i];
      }
    }
    return null;
  }

  // Берём внешний фасад (exterior), иначе первую доступную картинку.
  function thumbFor(id) {
    var gallery = window.MARKET_GALLERY_DATA;
    var list = gallery && gallery[id];
    if (!Array.isArray(list) || !list.length) return '';
    var i, file = '';
    for (i = 0; i < list.length; i++) {
      if (list[i] && list[i].role === 'exterior' &&
          typeof list[i].f === 'string' && list[i].f) {
        file = list[i].f;
        break;
      }
    }
    if (!file) {
      for (i = 0; i < list.length; i++) {
        if (list[i] && typeof list[i].f === 'string' && list[i].f) {
          file = list[i].f;
          break;
        }
      }
    }
    return file;
  }

  var HOME_KIND = { flat: 'Квартира', house: 'Дом', villa: 'Вилла', penthouse: 'Пентхаус', castle: 'Замок' };
  var HOME_EMOJI = { flat: '🏙️', house: '🏡', villa: '🌴', penthouse: '🌆', castle: '🏰' };

  function homeEmoji(item) {
    return HOME_EMOJI[item && item.kind] || '🏠';
  }

  // У lux в данных нет поля «слот», поэтому эмодзи выбираем по id.
  function luxEmoji(item) {
    var id = String((item && item.id) || '');
    if (/chain|pendant|cross/.test(id)) return '📿';
    if (/bracelet/.test(id)) return '💫';
    if (/diamond|gold/.test(id)) return '💎';
    if (/rolex|watch|richard|nautilus|royaloak|rm_dia|daydate|hublot|daytona|iced|^ap$/.test(id)) return '⌚';
    return '💎';
  }

  // Собираем только своё и только известные предметы. Порядок — как в ext.
  function ownedLists() {
    var ext = window.ext || {};
    var assets = Array.isArray(ext.assets) ? ext.assets : [];
    var homes = [];
    var lux = [];
    var seen = {};

    assets.forEach(function (raw) {
      var id = normId(raw);
      if (!id || seen[id]) return;
      seen[id] = 1;
      var item = itemById(id);
      if (!item) return;
      var cat = String(item.cat || '').toLowerCase();
      if (cat === 'homes') homes.push(item);
      else if (cat === 'lux' && !Object.prototype.hasOwnProperty.call(NOT_WEARABLE_LUX, id)) {
        lux.push(item);
      }
    });

    var nums = [];
    var numSeen = {};
    asArray(ext.numbers).forEach(function (raw) {
      var num = String(raw == null ? '' : raw).trim();
      if (!/^\d{8}$/.test(num) || numSeen[num]) return;
      numSeen[num] = 1;
      nums.push(num);
    });

    return {
      homes: homes,
      lux: lux,
      nums: nums,
      homeIds: homes.map(function (a) { return normId(a.id); }),
      luxIds: lux.map(function (a) { return normId(a.id); }),
      numIds: nums
    };
  }

  /* ==========================================================================
     Разметка плиток
     ========================================================================== */

  function tickHTML() {
    return '<span class="dxpe-tick" aria-hidden="true">✓</span>';
  }

  function homeTileHTML(item) {
    var id = normId(item.id);
    var name = String(item.name || id);
    var img = thumbFor(id);
    var media = '<span class="dxpe-emoji" aria-hidden="true">' + homeEmoji(item) + '</span>';
    if (img) media += '<img src="' + esc(img) + '" alt="" loading="lazy" decoding="async">';
    return '<button type="button" class="dxpe-tile" data-id="' + esc(id) + '"' +
        ' aria-pressed="false" title="' + esc(name) + '">' +
        '<span class="dxpe-thumb">' + media + tickHTML() + '</span>' +
        '<span class="dxpe-tile-name">' + esc(name) + '</span>' +
        '<span class="dxpe-tile-meta">' + esc(HOME_KIND[item.kind] || 'Жильё') + '</span>' +
      '</button>';
  }

  function luxTileHTML(item) {
    var id = normId(item.id);
    var name = String(item.name || id);
    var img = thumbFor(id);
    var media = '<span class="dxpe-emoji" aria-hidden="true">' + luxEmoji(item) + '</span>';
    if (img) media += '<img src="' + esc(img) + '" alt="" loading="lazy" decoding="async">';
    return '<button type="button" class="dxpe-tile" data-id="' + esc(id) + '"' +
        ' aria-pressed="false" title="' + esc(name) + '">' +
        '<span class="dxpe-thumb">' + media + tickHTML() + '</span>' +
        '<span class="dxpe-tile-name">' + esc(name) + '</span>' +
      '</button>';
  }

  function numTileHTML(numRaw) {
    var num = String(numRaw);
    var pretty = num.replace(/(\d{2})(?=\d)/g, '$1 '); // 77777777 → 77 77 77 77
    return '<button type="button" class="dxpe-tile dxpe-tile-num" data-id="' + esc(num) + '"' +
        ' aria-pressed="false" aria-label="Номер ' + esc(num) + '" title="Номер ' + esc(num) + '">' +
        '<span class="dxpe-thumb">' +
          '<span class="dxpe-plate" aria-hidden="true">' +
            '<small>DE · EXCHANGE</small><b>' + esc(pretty) + '</b>' +
          '</span>' + tickHTML() +
        '</span>' +
        '<span class="dxpe-tile-name">' + esc(num) + '</span>' +
        '<span class="dxpe-tile-meta">8 цифр</span>' +
      '</button>';
  }

  function emptyHTML(kind) {
    if (kind === 'homes') {
      return '<div class="dxpe-empty">🏚️ Купленных домов и квартир пока нет.<br>' +
        '<b>Купи в маркете активов</b> — и жильё появится здесь.</div>';
    }
    if (kind === 'lux') {
      return '<div class="dxpe-empty">💎 Купленных украшений пока нет.<br>' +
        '<b>Купи в маркете активов</b> — и они появятся здесь.</div>';
    }
    return '<div class="dxpe-empty">🔢 Блатных номеров пока нет.<br>' +
      '<b>Купи в маркете активов</b> — и они появятся здесь.</div>';
  }

  // Заполняет сетку и возвращает [{id, el}] — по ним обновляем галочки.
  function fillGrid(host, kind, items) {
    if (!items.length) {
      host.innerHTML = emptyHTML(kind);
      return [];
    }
    var html = '';
    var i;
    for (i = 0; i < items.length; i++) {
      if (kind === 'homes') html += homeTileHTML(items[i]);
      else if (kind === 'lux') html += luxTileHTML(items[i]);
      else html += numTileHTML(items[i]);
    }
    host.innerHTML = html;

    // Битая/отсутствующая картинка — показываем эмодзи-заглушку под ней.
    var imgs = host.querySelectorAll('img');
    for (i = 0; i < imgs.length; i++) {
      imgs[i].addEventListener('error', function () { this.style.display = 'none'; });
    }

    var nodes = host.querySelectorAll('.dxpe-tile');
    var tiles = [];
    for (i = 0; i < nodes.length; i++) {
      tiles.push({ id: nodes[i].getAttribute('data-id'), el: nodes[i] });
    }
    return tiles;
  }

  /* ==========================================================================
     Стили (все внутри модуля, с префиксом dxpe-, ничего чужого не задеваем)
     ========================================================================== */

  var CSS = `
  .dxpe-overlay {
    position: fixed; inset: 0; z-index: 99999;
    display: flex; align-items: center; justify-content: center;
    padding: 12px;
    background: rgba(6, 9, 20, .72);
    -webkit-backdrop-filter: blur(9px) saturate(120%);
    backdrop-filter: blur(9px) saturate(120%);
    color: #e7edf8;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif;
    animation: dxpeFade .16s ease-out;
  }
  .dxpe-overlay *,
  .dxpe-overlay *::before,
  .dxpe-overlay *::after { box-sizing: border-box; }

  .dxpe-card {
    position: relative;
    display: flex; flex-direction: column;
    width: min(94vw, 920px);
    max-height: 90vh;
    background: #111827;
    border: 1px solid rgba(226, 110, 10, .45);
    border-radius: 20px;
    box-shadow: 0 30px 80px rgba(0, 0, 0, .60), inset 0 0 0 1px rgba(226, 110, 10, .06);
    overflow: hidden;
    animation: dxpePop .18s cubic-bezier(.2, .9, .3, 1);
  }

  .dxpe-head {
    display: flex; align-items: flex-start; gap: 14px;
    padding: 18px 20px 15px;
    border-bottom: 1px solid rgba(255, 255, 255, .08);
    background: linear-gradient(180deg, rgba(226, 110, 10, .08), rgba(226, 110, 10, 0));
  }
  .dxpe-head-text { flex: 1; min-width: 0; }
  .dxpe-title {
    margin: 0; color: #fff;
    font-size: 20px; font-weight: 900; line-height: 1.2; letter-spacing: .2px;
  }
  .dxpe-sub {
    margin: 5px 0 0;
    font-size: 12.5px; line-height: 1.4; color: #9fb0c9;
    overflow-wrap: anywhere;
  }
  .dxpe-x {
    flex: 0 0 auto;
    display: flex; align-items: center; justify-content: center;
    width: 36px; height: 36px;
    padding: 0;
    border: 1px solid rgba(148, 163, 184, .22);
    border-radius: 11px;
    background: rgba(148, 163, 184, .08);
    color: #dbe4f2;
    font: inherit; font-size: 16px; line-height: 1;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
    transition: background .14s, border-color .14s, color .14s;
  }
  .dxpe-x:hover { background: rgba(226, 110, 10, .16); border-color: rgba(226, 110, 10, .55); color: #fff; }
  .dxpe-x:focus-visible { outline: 2px solid #f5a256; outline-offset: 2px; }

  .dxpe-body {
    flex: 1 1 auto; min-height: 0;
    overflow-y: auto; overscroll-behavior: contain;
    padding: 18px 20px 20px;
    display: grid;
    grid-template-columns: minmax(0, 1.1fr) minmax(0, .9fr);
    gap: 20px;
    align-items: start;
    scrollbar-width: thin;
    scrollbar-color: #334155 transparent;
  }
  .dxpe-body::-webkit-scrollbar { width: 10px; }
  .dxpe-body::-webkit-scrollbar-track { background: transparent; }
  .dxpe-body::-webkit-scrollbar-thumb {
    background: rgba(148, 163, 184, .28);
    border-radius: 99px;
    border: 2px solid #111827;
  }

  .dxpe-preview {
    position: sticky; top: 0;
    min-width: 0;
    display: flex; flex-direction: column; gap: 9px;
  }
  .dxpe-preview-top {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    min-height: 22px;
  }
  .dxpe-eyebrow {
    font-size: 10.5px; font-weight: 900; letter-spacing: 1.4px;
    text-transform: uppercase; color: #f0a45a;
  }
  .dxpe-status {
    padding: 3px 8px;
    border: 1px solid rgba(148, 163, 184, .18);
    border-radius: 999px;
    background: rgba(148, 163, 184, .14);
    color: #c7d2e4;
    font-size: 10.5px; font-weight: 700; line-height: 1.3;
    white-space: nowrap;
  }
  .dxpe-status[hidden] { display: none; }

  .dxpe-scene {
    position: relative;
    width: 100%;
    aspect-ratio: 16 / 9;
    border: 1px solid rgba(255, 255, 255, .09);
    border-radius: 14px;
    overflow: hidden;
    background: radial-gradient(circle at 50% 15%, #1c2942, #0a1020 70%);
    box-shadow: inset 0 0 40px rgba(0, 0, 0, .35);
  }

  .dxpe-fb {
    position: absolute; inset: 0;
    display: flex; flex-direction: column; justify-content: center; gap: 4px;
    padding: 14px 16px;
    overflow: hidden;
    background: linear-gradient(160deg, rgba(24, 36, 58, .85), rgba(10, 16, 30, .95));
  }
  .dxpe-fb-icon { font-size: 22px; line-height: 1; margin-bottom: 2px; opacity: .95; }
  .dxpe-fb-title { color: #f3f6fb; font-size: 12.5px; font-weight: 900; line-height: 1.3; }
  .dxpe-fb-note { margin-bottom: 4px; color: #93a4bd; font-size: 10.5px; line-height: 1.35; }
  .dxpe-fb-row {
    display: flex; align-items: baseline; gap: 6px;
    min-width: 0;
    color: #c8d4e6; font-size: 11px; line-height: 1.35;
  }
  .dxpe-fb-row b {
    min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    color: #e8eef8; font-weight: 700;
  }

  .dxpe-preview-note {
    margin: 0;
    color: #8fa2bd; font-size: 11px; line-height: 1.4;
  }
  .dxpe-summary { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .dxpe-sum-row {
    display: flex; align-items: baseline; gap: 7px;
    min-width: 0;
    color: #c3d0e2; font-size: 11.5px; line-height: 1.4;
  }
  .dxpe-sum-ico { flex: 0 0 auto; width: 16px; text-align: center; }
  .dxpe-sum-row b {
    min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    color: #e8eef8; font-weight: 700;
  }

  .dxpe-sections { display: flex; flex-direction: column; gap: 18px; min-width: 0; }
  .dxpe-sec { min-width: 0; }
  .dxpe-sec-head {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    margin-bottom: 9px;
  }
  .dxpe-sec h3 {
    margin: 0;
    color: #f3f6fb; font-size: 13.5px; font-weight: 900; line-height: 1.3; letter-spacing: .2px;
  }
  .dxpe-sec-note {
    color: #8fa2bd; font-size: 9.5px; font-weight: 700;
    letter-spacing: .7px; text-transform: uppercase; white-space: nowrap;
  }
  .dxpe-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 10px;
  }
  .dxpe-sections.is-loading .dxpe-grid { opacity: .55; pointer-events: none; }
  .dxpe-card.is-saving .dxpe-grid { opacity: .7; pointer-events: none; }

  .dxpe-empty {
    grid-column: 1 / -1;
    padding: 14px;
    border: 1px dashed rgba(148, 163, 184, .30);
    border-radius: 12px;
    background: rgba(148, 163, 184, .05);
    color: #9fb0c9; font-size: 12.5px; line-height: 1.5;
  }
  .dxpe-empty b { color: #f0a45a; font-weight: 800; }

  .dxpe-tile {
    position: relative;
    display: flex; flex-direction: column; gap: 7px;
    width: 100%;
    padding: 7px;
    border: 1px solid rgba(148, 163, 184, .16);
    border-radius: 13px;
    background: #151e30;
    color: #e8eef8;
    font: inherit; text-align: left;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
    transition: border-color .14s, background .14s, transform .14s, box-shadow .14s;
  }
  .dxpe-tile:hover {
    border-color: rgba(226, 110, 10, .55);
    background: #1a2438;
    transform: translateY(-1px);
  }
  .dxpe-tile.is-on {
    border-color: #e26e0a;
    background: #1d273b;
    box-shadow: 0 0 0 1px rgba(226, 110, 10, .40), 0 8px 18px rgba(0, 0, 0, .22);
  }
  .dxpe-tile.is-on:hover { background: #202b41; }
  .dxpe-tile:focus-visible { outline: 2px solid #f5a256; outline-offset: 2px; }

  .dxpe-thumb {
    position: relative;
    display: flex; align-items: center; justify-content: center;
    width: 100%;
    aspect-ratio: 16 / 10;
    border-radius: 9px;
    overflow: hidden;
    background: linear-gradient(135deg, #1b2740, #0d1526);
  }
  .dxpe-thumb img {
    position: absolute; inset: 0;
    display: block;
    width: 100%; height: 100%;
    object-fit: cover;
  }
  .dxpe-emoji { font-size: 34px; line-height: 1; filter: saturate(1.1); }

  .dxpe-tick {
    position: absolute; top: 6px; right: 6px; z-index: 2;
    display: flex; align-items: center; justify-content: center;
    width: 20px; height: 20px;
    border-radius: 50%;
    background: #e26e0a;
    color: #1a0e04;
    font-size: 12px; font-weight: 900; line-height: 1;
    box-shadow: 0 2px 6px rgba(0, 0, 0, .35);
    opacity: 0; transform: scale(.7);
    transition: opacity .14s, transform .14s;
  }
  .dxpe-tile.is-on .dxpe-tick { opacity: 1; transform: none; }

  .dxpe-tile-name {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    min-height: 2.6em;
    color: #e8eef8;
    font-size: 12px; font-weight: 800; line-height: 1.3;
    overflow-wrap: anywhere;
  }
  .dxpe-tile-meta {
    margin-top: -2px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    color: #8fa2bd;
    font-size: 10px; font-weight: 700; letter-spacing: .3px;
  }

  .dxpe-plate {
    position: absolute; inset: 5px;
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px;
    border: 1px solid #f5d98f;
    border-radius: 7px;
    background: linear-gradient(145deg, #f9e7b4 0%, #e9c268 45%, #c9972f 100%);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, .7), 0 1px 4px rgba(0, 0, 0, .35);
    color: #2b1a05;
  }
  .dxpe-plate small {
    font-size: 6.5px; font-weight: 900; letter-spacing: 1px; line-height: 1; opacity: .7;
  }
  .dxpe-plate b {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
    font-size: 13px; font-weight: 900; letter-spacing: .2px; line-height: 1.05;
    white-space: nowrap;
  }

  .dxpe-foot {
    display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
    padding: 14px 20px;
    border-top: 1px solid rgba(255, 255, 255, .08);
    background: rgba(9, 14, 26, .92);
  }
  .dxpe-foot-right { display: flex; gap: 10px; margin-left: auto; }
  .dxpe-btn {
    appearance: none;
    padding: 10px 16px;
    border: 1px solid rgba(148, 163, 184, .28);
    border-radius: 11px;
    background: rgba(148, 163, 184, .08);
    color: #e8eef8;
    font: inherit; font-size: 13px; font-weight: 800; line-height: 1.2;
    white-space: nowrap;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
    transition: background .14s, border-color .14s, color .14s;
  }
  .dxpe-btn:hover { background: rgba(148, 163, 184, .16); border-color: rgba(148, 163, 184, .40); }
  .dxpe-btn:focus-visible { outline: 2px solid #f5a256; outline-offset: 2px; }
  .dxpe-btn:disabled { opacity: .55; cursor: not-allowed; }
  .dxpe-btn.primary {
    border-color: #e26e0a;
    background: #e26e0a;
    color: #1a0e04;
    box-shadow: 0 8px 20px rgba(226, 110, 10, .22);
  }
  .dxpe-btn.primary:hover { border-color: #f07d17; background: #f07d17; }
  .dxpe-btn.clear {
    border-color: rgba(248, 113, 113, .35);
    background: transparent;
    color: #fca5a5;
  }
  .dxpe-btn.clear:hover { border-color: rgba(248, 113, 113, .55); background: rgba(248, 113, 113, .10); }

  @media (max-width: 760px) {
    .dxpe-overlay { padding: 8px; }
    .dxpe-head { padding: 14px 15px 12px; }
    .dxpe-title { font-size: 17px; }
    .dxpe-body {
      grid-template-columns: 1fr;
      gap: 16px;
      padding: 14px 15px 16px;
    }
    .dxpe-preview { position: static; }
    .dxpe-foot { padding: 12px 15px; }
    .dxpe-btn { padding: 10px 13px; }
    .dxpe-fb { padding: 10px 12px; }
    .dxpe-fb-note { display: none; }
    .dxpe-fb-row { font-size: 10.5px; }
  }

  @media (max-width: 480px) {
    .dxpe-foot-right { width: 100%; margin-left: 0; }
    .dxpe-foot-right .dxpe-btn { flex: 1 1 0; }
    .dxpe-btn.clear { width: 100%; }
    .dxpe-tile-name { font-size: 11.5px; }
  }

  @media (prefers-reduced-motion: reduce) {
    .dxpe-overlay, .dxpe-card { animation: none; }
    .dxpe-tile, .dxpe-tick, .dxpe-btn, .dxpe-x { transition: none; }
  }

  @keyframes dxpeFade { from { opacity: 0; } to { opacity: 1; } }
  @keyframes dxpePop {
    from { opacity: 0; transform: translateY(8px) scale(.985); }
    to { opacity: 1; transform: none; }
  }
  `;

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  /* ==========================================================================
     Сессия редактора: построение оверлея
     ========================================================================== */

  function sectionHTML(title, note, gridId, titleId) {
    return '<section class="dxpe-sec">' +
        '<div class="dxpe-sec-head">' +
          '<h3 id="' + titleId + '">' + esc(title) + '</h3>' +
          '<span class="dxpe-sec-note">' + esc(note) + '</span>' +
        '</div>' +
        '<div class="dxpe-grid" id="' + gridId + '"></div>' +
      '</section>';
  }

  function overlayHTML(s) {
    var nick = displayNick(s.acc, s.nick);
    return '<div class="dxpe-card" role="dialog" aria-modal="true" aria-labelledby="dxPeTitle" tabindex="-1">' +
        '<header class="dxpe-head">' +
          '<div class="dxpe-head-text">' +
            '<h2 class="dxpe-title" id="dxPeTitle">Витрина профиля</h2>' +
            '<p class="dxpe-sub" id="dxPeSub">@' + esc(nick) + ' · выбери, что показывать другим игрокам</p>' +
          '</div>' +
          '<button class="dxpe-x" id="dxPeClose" type="button" aria-label="Закрыть">✕</button>' +
        '</header>' +
        '<div class="dxpe-body">' +
          '<aside class="dxpe-preview">' +
            '<div class="dxpe-preview-top">' +
              '<span class="dxpe-eyebrow">Предпросмотр</span>' +
              '<span class="dxpe-status" id="dxPeStatus">Загрузка витрины…</span>' +
            '</div>' +
            '<div class="dxpe-scene" id="dxPeScene" role="group" aria-label="Предпросмотр витрины профиля"></div>' +
            '<p class="dxpe-preview-note">Так витрину увидят другие игроки. Выбор обновляет картинку сразу.</p>' +
            '<div class="dxpe-summary" id="dxPeSummary"></div>' +
          '</aside>' +
          '<div class="dxpe-sections" id="dxPeSections">' +
            sectionHTML('Квартира на профиль', 'одна', 'dxPeHomes', 'dxPeHomesTitle') +
            sectionHTML('Ювелирка на себя (0/' + MAX_WEAR + ')', 'максимум ' + MAX_WEAR, 'dxPeLux', 'dxPeLuxTitle') +
            sectionHTML('Номера на выставку (0/' + MAX_STANDS + ')', 'по 8 цифр', 'dxPeNums', 'dxPeNumsTitle') +
          '</div>' +
        '</div>' +
        '<footer class="dxpe-foot">' +
          '<button class="dxpe-btn clear" id="dxPeClear" type="button">Убрать всё</button>' +
          '<div class="dxpe-foot-right">' +
            '<button class="dxpe-btn" id="dxPeCancel" type="button">Отмена</button>' +
            '<button class="dxpe-btn primary" id="dxPeSave" type="button">Сохранить</button>' +
          '</div>' +
        '</footer>' +
      '</div>';
  }

  function buildOverlay(s) {
    ensureStyles();

    var overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.className = 'dxpe-overlay';
    overlay.innerHTML = overlayHTML(s);
    document.body.appendChild(overlay);

    s.refs = {
      overlay: overlay,
      card: overlay.querySelector('.dxpe-card'),
      close: document.getElementById('dxPeClose'),
      cancel: document.getElementById('dxPeCancel'),
      save: document.getElementById('dxPeSave'),
      clear: document.getElementById('dxPeClear'),
      status: document.getElementById('dxPeStatus'),
      scene: document.getElementById('dxPeScene'),
      summary: document.getElementById('dxPeSummary'),
      sections: document.getElementById('dxPeSections'),
      homes: document.getElementById('dxPeHomes'),
      lux: document.getElementById('dxPeLux'),
      nums: document.getElementById('dxPeNums'),
      luxTitle: document.getElementById('dxPeLuxTitle'),
      numsTitle: document.getElementById('dxPeNumsTitle')
    };

    // Пока грузим витрину — плитки видны, но менять выбор нельзя.
    s.refs.sections.classList.add('is-loading');
    s.refs.sections.setAttribute('aria-busy', 'true');
    s.refs.save.disabled = true;
    s.refs.clear.disabled = true;

    s.refs.homeTiles = fillGrid(s.refs.homes, 'homes', s.owned.homes);
    s.refs.luxTiles = fillGrid(s.refs.lux, 'lux', s.owned.lux);
    s.refs.numTiles = fillGrid(s.refs.nums, 'nums', s.owned.nums);

    bindOverlay(s);
  }

  function closestTile(node) {
    while (node && node !== document) {
      if (node.nodeType === 1 && node.classList && node.classList.contains('dxpe-tile')) return node;
      node = node.parentNode;
    }
    return null;
  }

  function bindOverlay(s) {
    var r = s.refs;

    r.close.addEventListener('click', function () { close(); });
    r.cancel.addEventListener('click', function () { close(); });
    r.clear.addEventListener('click', function () { clearAll(s); });
    r.save.addEventListener('click', function () { save(s); });

    // Клик по тёмному фону закрывает, клик по карточке — нет.
    r.overlay.addEventListener('click', function (ev) {
      if (ev.target === r.overlay) close();
    });

    r.homes.addEventListener('click', function (ev) {
      var tile = closestTile(ev.target);
      if (tile) toggleHome(s, tile.getAttribute('data-id'));
    });
    r.lux.addEventListener('click', function (ev) {
      var tile = closestTile(ev.target);
      if (tile) toggleLux(s, tile.getAttribute('data-id'));
    });
    r.nums.addEventListener('click', function (ev) {
      var tile = closestTile(ev.target);
      if (tile) toggleNum(s, tile.getAttribute('data-id'));
    });
  }

  /* ==========================================================================
     Выбор
     ========================================================================== */

  function canEdit(s) {
    return !!s && !s.closed && !s.loading && !s.saving;
  }

  function toggleHome(s, id) {
    if (!canEdit(s) || s.owned.homeIds.indexOf(id) < 0) return;
    // Галочка одна: повторный клик по выбранной квартире снимает выбор.
    s.home = (s.home === id) ? null : id;
    sync(s);
  }

  function toggleLux(s, id) {
    if (!canEdit(s) || s.owned.luxIds.indexOf(id) < 0) return;
    var index = s.wear.indexOf(id);
    if (index >= 0) {
      s.wear.splice(index, 1);
    } else {
      if (s.wear.length >= MAX_WEAR) {
        notify('Максимум ' + MAX_WEAR + ' украшений', 'bad');
        return;
      }
      s.wear.push(id);
    }
    sync(s);
  }

  function toggleNum(s, num) {
    if (!canEdit(s) || s.owned.numIds.indexOf(num) < 0) return;
    var index = s.stands.indexOf(num);
    if (index >= 0) {
      s.stands.splice(index, 1);
    } else {
      if (s.stands.length >= MAX_STANDS) {
        notify('Максимум ' + MAX_STANDS + ' номеров', 'bad');
        return;
      }
      s.stands.push(num);
    }
    sync(s);
  }

  function clearAll(s) {
    if (!canEdit(s)) return;
    s.home = null;
    s.wear = [];
    s.stands = [];
    sync(s);
  }

  /* ==========================================================================
     Отрисовка состояния
     ========================================================================== */

  function setTileOn(tile, on) {
    if (!tile || !tile.el) return;
    if (on) tile.el.classList.add('is-on');
    else tile.el.classList.remove('is-on');
    tile.el.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function refreshTiles(s) {
    var i;
    for (i = 0; i < s.refs.homeTiles.length; i++) {
      setTileOn(s.refs.homeTiles[i], s.refs.homeTiles[i].id === s.home);
    }
    for (i = 0; i < s.refs.luxTiles.length; i++) {
      setTileOn(s.refs.luxTiles[i], s.wear.indexOf(s.refs.luxTiles[i].id) >= 0);
    }
    for (i = 0; i < s.refs.numTiles.length; i++) {
      setTileOn(s.refs.numTiles[i], s.stands.indexOf(s.refs.numTiles[i].id) >= 0);
    }
  }

  function setTitles(s) {
    if (s.refs.luxTitle) {
      s.refs.luxTitle.textContent = 'Ювелирка на себя (' + s.wear.length + '/' + MAX_WEAR + ')';
    }
    if (s.refs.numsTitle) {
      s.refs.numsTitle.textContent = 'Номера на выставку (' + s.stands.length + '/' + MAX_STANDS + ')';
    }
  }

  function summaryHTML(s) {
    var home = s.home ? itemById(s.home) : null;
    var wearText = s.wear.length
      ? s.wear.length + ' ' + plural(s.wear.length, ['украшение', 'украшения', 'украшений'])
      : 'Без украшений';
    var standText = s.stands.length
      ? s.stands.length + ' ' + plural(s.stands.length, ['номер', 'номера', 'номеров'])
      : 'Без номеров';
    var rows = [
      ['🏠', home ? String(home.name || s.home) : 'Квартира не выбрана'],
      ['💎', wearText],
      ['🔢', standText]
    ];
    var html = '';
    rows.forEach(function (row) {
      html += '<div class="dxpe-sum-row"><span class="dxpe-sum-ico" aria-hidden="true">' +
        row[0] + '</span><b>' + esc(row[1]) + '</b></div>';
    });
    return html;
  }

  function setSummary(s) {
    if (s.refs.summary) s.refs.summary.innerHTML = summaryHTML(s);
  }

  function setStatus(s, text) {
    var el = s.refs.status;
    if (!el) return;
    if (text) {
      el.textContent = text;
      el.hidden = false;
    } else {
      el.textContent = '';
      el.hidden = true;
    }
  }

  function sync(s, immediate) {
    if (!s || s.closed) return;
    refreshTiles(s);
    setTitles(s);
    setSummary(s);
    if (immediate) {
      // Первый кадр и ответ сервера рисуем сразу — без пустой рамки на 30 мс.
      if (s.sceneTimer) {
        clearTimeout(s.sceneTimer);
        s.sceneTimer = 0;
      }
      paintScene(s);
    } else {
      scheduleScene(s);
    }
  }

  /* ==========================================================================
     Живой предпросмотр через dxScene
     ========================================================================== */

  function sceneData(s) {
    return {
      nick: s.nick,
      home: s.home || null,
      wear: s.wear.slice(),
      stands: s.stands.slice(),
      avatar: (s.acc && s.acc.avatar) || ''
    };
  }

  function fallbackHTML(s, title, note) {
    var home = s.home ? itemById(s.home) : null;
    var wearNames = [];
    s.wear.forEach(function (id) {
      var item = itemById(id);
      if (item) wearNames.push(String(item.name || id));
    });
    return '<div class="dxpe-fb">' +
        '<div class="dxpe-fb-icon" aria-hidden="true">🖼️</div>' +
        '<div class="dxpe-fb-title">' + esc(title) + '</div>' +
        '<div class="dxpe-fb-note">' + esc(note) + '</div>' +
        '<div class="dxpe-fb-row"><span aria-hidden="true">🏠</span><b>' +
          esc(home ? String(home.name || s.home) : 'Квартира не выбрана') + '</b></div>' +
        '<div class="dxpe-fb-row"><span aria-hidden="true">💎</span><b>' +
          esc(wearNames.length ? wearNames.join(', ') : 'Без украшений') + '</b></div>' +
        '<div class="dxpe-fb-row"><span aria-hidden="true">🔢</span><b>' +
          esc(s.stands.length ? s.stands.join(' · ') : 'Без номеров') + '</b></div>' +
      '</div>';
  }

  function paintScene(s) {
    if (!s || s.closed || current !== s) return;
    var box = s.refs.scene;
    if (!box) return;

    // Если прошлая сцена вернула функцию очистки — позовём её.
    if (typeof s.sceneCleanup === 'function') {
      try { s.sceneCleanup(); } catch (e) { /* сцена сама разберётся */ }
      s.sceneCleanup = null;
    }

    // dxScene умеет убирать свои узлы и класс контейнера — пользуемся этим,
    // если метод есть, и всё равно чистим контейнер перед новой отрисовкой.
    var scene = window.dxScene;
    if (scene && typeof scene.clear === 'function') {
      try { scene.clear(box); } catch (e) { /* не критично */ }
    }
    box.innerHTML = '';

    if (!scene || typeof scene.render !== 'function') {
      box.innerHTML = fallbackHTML(
        s,
        'Сцена ещё не подключена',
        'Показываю текстовый предпросмотр — он обновится, когда загрузится dxScene.'
      );
      return;
    }

    try {
      var result = scene.render(box, sceneData(s));
      if (typeof result === 'function') s.sceneCleanup = result;
    } catch (e) {
      box.innerHTML = fallbackHTML(
        s,
        'Предпросмотр недоступен',
        'Сцена не смогла нарисоваться. Показываю витрину текстом.'
      );
      if (window.console && typeof window.console.warn === 'function') {
        window.console.warn('[dxProfileEditor] dxScene.render:', e);
      }
    }
  }

  // Не дёргаем сцену на каждый клик: склеиваем быстрые изменения в один кадр.
  function scheduleScene(s) {
    if (!s || s.closed) return;
    if (s.sceneTimer) return;
    s.sceneTimer = setTimeout(function () {
      s.sceneTimer = 0;
      paintScene(s);
    }, 30);
  }

  /* ==========================================================================
     Загрузка текущей витрины
     ========================================================================== */

  // Сервер может прислать {showcase:{...}}, {data:{...}} или сам объект.
  function showcaseBody(body) {
    if (!body) return null;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) { return null; }
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    var nested = body.showcase;
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) return nested;
    nested = body.data;
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) return nested;
    return body;
  }

  function applyServerShowcase(s, body) {
    var src = showcaseBody(body);
    if (!src) return;

    // Только своя квартира; чужое или проданное игнорируем.
    var home = normId(src.home);
    s.home = (home && s.owned.homeIds.indexOf(home) >= 0) ? home : null;

    var wear = [];
    asArray(src.wear).forEach(function (raw) {
      var id = normId(raw);
      if (!id || wear.length >= MAX_WEAR) return;
      if (s.owned.luxIds.indexOf(id) >= 0 && wear.indexOf(id) < 0) wear.push(id);
    });
    s.wear = wear;

    var stands = [];
    asArray(src.stands).forEach(function (raw) {
      var num = String(raw == null ? '' : raw).trim();
      if (!/^\d{8}$/.test(num) || stands.length >= MAX_STANDS) return;
      if (s.owned.numIds.indexOf(num) >= 0 && stands.indexOf(num) < 0) stands.push(num);
    });
    s.stands = stands;
  }

  function setReady(s) {
    if (!s.refs.sections) return;
    s.refs.sections.classList.remove('is-loading');
    s.refs.sections.removeAttribute('aria-busy');
    s.refs.save.disabled = false;
    s.refs.clear.disabled = false;
  }

  function loadShowcase(s) {
    api('GET', API_PATH + '?nick=' + encodeURIComponent(s.nick), null, function (result) {
      if (!s || s.closed || current !== s) return;
      s.loading = false;

      if (result && !result.offline && result.code === 200) {
        applyServerShowcase(s, result.body);
        setStatus(s, '');
      } else if (result && result.offline) {
        // Не блокируем редактирование: сохранить всё равно не даст, но выбор
        // можно спокойно сделать и увидеть в предпросмотре.
        setStatus(s, 'Нет связи — витрина не загружена');
      } else {
        // 404 и прочие ответы = пустая витрина.
        setStatus(s, '');
      }

      setReady(s);
      sync(s, true);
    });
  }

  /* ==========================================================================
     Сохранение
     ========================================================================== */

  function setSaving(s, on) {
    if (!s || s.closed) return;
    s.saving = !!on;
    if (s.refs.save) {
      s.refs.save.disabled = !!on || s.loading;
      s.refs.save.textContent = on ? 'Сохраняю…' : 'Сохранить';
    }
    if (s.refs.clear) s.refs.clear.disabled = !!on || s.loading;
    if (s.refs.card) s.refs.card.classList.toggle('is-saving', !!on);
  }

  // Ещё раз фильтруем перед отправкой — на случай, если состояние как-то
  // изменилось мимо интерфейса.
  function buildPayload(s) {
    var home = (s.home && s.owned.homeIds.indexOf(s.home) >= 0) ? s.home : null;
    var wear = [];
    var stands = [];

    s.wear.forEach(function (id) {
      if (wear.length >= MAX_WEAR) return;
      if (s.owned.luxIds.indexOf(id) >= 0 && wear.indexOf(id) < 0) wear.push(id);
    });
    s.stands.forEach(function (raw) {
      var num = String(raw == null ? '' : raw).trim();
      if (stands.length >= MAX_STANDS) return;
      if (/^\d{8}$/.test(num) && s.owned.numIds.indexOf(num) >= 0 && stands.indexOf(num) < 0) {
        stands.push(num);
      }
    });

    return {
      nick: accountNick(s.acc),
      pass: s.acc ? s.acc.pass : '',
      home: home,
      wear: wear,
      stands: stands
    };
  }

  function save(s) {
    if (!s || s.closed || s.loading || s.saving) return;

    var acc = s.acc;
    if (!acc || !acc.pass) {
      notify('Пароль не принят — войди заново', 'bad');
      return;
    }

    var payload = buildPayload(s);
    setSaving(s, true);

    api('POST', API_PATH, payload, function (result) {
      if (!result || result.offline) {
        if (!s.closed) {
          setSaving(s, false);
          notify('Нет связи с сервером', 'bad');
        }
        return;
      }

      if (result.code === 200) {
        notify('Витрина сохранена', 'info');
        var onSaved = s.onSaved;
        if (!s.closed) close();
        if (typeof onSaved === 'function') {
          try { onSaved(); } catch (e) {
            if (window.console && typeof window.console.error === 'function') {
              window.console.error('[dxProfileEditor] onSaved:', e);
            }
          }
        }
        return;
      }

      if (s.closed) return;
      setSaving(s, false);
      if (result.code === 403) {
        notify('Пароль не принят — войди заново', 'bad');
      } else {
        notify('Не удалось сохранить витрину', 'bad');
      }
    });
  }

  /* ==========================================================================
     Клавиатура и закрытие
     ========================================================================== */

  function trapFocus(ev, s) {
    var overlay = s.refs.overlay;
    if (!overlay) return;
    var nodes = overlay.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), ' +
      'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    var list = [];
    var i;
    for (i = 0; i < nodes.length; i++) {
      if (nodes[i].getClientRects().length) list.push(nodes[i]);
    }
    if (!list.length) return;

    var first = list[0];
    var last = list[list.length - 1];
    var active = document.activeElement;

    if (!overlay.contains(active)) {
      ev.preventDefault();
      first.focus();
      return;
    }
    if (ev.shiftKey && active === first) {
      ev.preventDefault();
      last.focus();
    } else if (!ev.shiftKey && active === last) {
      ev.preventDefault();
      first.focus();
    }
  }

  function bindKeys(s) {
    s.keyHandler = function (ev) {
      if (s.closed) return;
      var key = ev.key || '';
      if (key === 'Escape' || key === 'Esc' || ev.keyCode === 27) {
        ev.preventDefault();
        close();
        return;
      }
      if (key === 'Tab' || ev.keyCode === 9) trapFocus(ev, s);
    };
    // capture — чтобы Esc сработал раньше обработчиков сцены/страницы
    document.addEventListener('keydown', s.keyHandler, true);
  }

  /* ==========================================================================
     Публичное API
     ========================================================================== */

  function open(opts) {
    opts = opts || {};

    var acc = window.__DE_ACC;
    if (!acc || !(acc.nick || acc.nick_lc)) {
      notify('Войди в аккаунт', 'bad');
      return;
    }
    if (!document.body) {
      notify('Страница ещё не готова', 'bad');
      return;
    }

    if (current) close(); // повторное открытие не плодит оверлеи

    // Редактируем всегда свою витрину; opts.nick нужен, чтобы показать,
    // чью именно страницу сейчас настраивают.
    var own = accountNick(acc);
    var target = cleanNick(opts.nick || own || acc.nick || acc.nick_lc) || own;

    var s = {
      acc: acc,
      nick: target,
      onSaved: opts.onSaved,
      home: null,
      wear: [],
      stands: [],
      owned: ownedLists(),
      loading: true,
      saving: false,
      closed: false,
      sceneTimer: 0,
      sceneCleanup: null,
      keyHandler: null,
      prevFocus: document.activeElement,
      prevOverflow: document.body.style.overflow || ''
    };

    current = s;
    buildOverlay(s);
    document.body.style.overflow = 'hidden';
    bindKeys(s);

    sync(s, true); // сразу рисуем заглушку, не ждём сеть
    try { s.refs.close.focus(); } catch (e) { /* фокус не критичен */ }

    loadShowcase(s);
  }

  function close() {
    var s = current;
    if (!s) return;
    current = null;
    s.closed = true;

    if (s.sceneTimer) {
      clearTimeout(s.sceneTimer);
      s.sceneTimer = 0;
    }
    if (typeof s.sceneCleanup === 'function') {
      try { s.sceneCleanup(); } catch (e) { /* уже неважно */ }
      s.sceneCleanup = null;
    }
    if (s.keyHandler) {
      document.removeEventListener('keydown', s.keyHandler, true);
      s.keyHandler = null;
    }

    var overlay = document.getElementById(OVERLAY_ID);
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    if (document.body) document.body.style.overflow = s.prevOverflow || '';

    try {
      if (s.prevFocus && typeof s.prevFocus.focus === 'function') s.prevFocus.focus();
    } catch (e) { /* элемент мог исчезнуть со страницы */ }
  }

  window.dxProfileEditor = {
    open: open,
    close: close
  };
})();
