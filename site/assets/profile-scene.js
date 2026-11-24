/* DE Exchange 2.6 · визуальная сцена профиля.
   Один файл, без сборки и внешних запросов. Наружу отдаём только window.dxScene. */
(function () {
  'use strict';

  var HOST_CLASS = 'dxs-host';
  var STYLE_ID = 'dxs-profile-scene-style';
  var MAX_WEAR = 5;
  var MAX_STANDS = 6;
  var sceneSeq = 0;

  var WATCH_IDS = [
    'rolex', 'ap', 'watch', 'richard', 'daytona_rainbow', 'nautilus_dia',
    'royaloak_iced', 'rm_dia', 'daydate_dia', 'hublot_dia', 'ap_offshore_dia',
    'iced_square_rose', 'iced_set_blue', 'iced_set_emerald'
  ];

  function isWatchId(id) {
    return WATCH_IDS.indexOf(id) >= 0 || /^iced_/.test(id);
  }

  /* Базовый casual-образ: белая футболка, серые брюки, тёмные туфли.
     Пиджак можно будет добавить отдельной опцией позже. */
  var CASUAL = {
    tee: '#f5f3ee',
    teeShade: '#dedbd3',
    teeEdge: '#c8c4ba',
    pants: '#5b616b',
    pantsShade: '#4b5059',
    crease: '#393d44',
    skin: '#d6a17c',
    skinShade: '#b97f5f',
    shoe: '#171310',
    sole: '#0b0908'
  };

  var HAIRS = [
    { color: '#2b211d', light: '#3d2e27' },
    { color: '#191b20', light: '#262a31' },
    { color: '#3a261b', light: '#5a3a27' }
  ];

  var CSS = `
    .dxs-host {
      position: relative;
      aspect-ratio: 16 / 9;
      border-radius: 18px;
      overflow: hidden;
      background: #0d1220;
    }

    .dxs,
    .dxs * { box-sizing: border-box; }

    .dxs {
      position: absolute;
      inset: 0;
      overflow: hidden;
      border-radius: inherit;
      isolation: isolate;
      background: #0d1220;
      color: #f7f1e6;
      font-family: "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif;
      line-height: 1.2;
      -webkit-user-select: none;
      user-select: none;
    }

    .dxs img { display: block; }
    .dxs [hidden] { display: none; }

    /* Подложка на случай отсутствия интерьера. */
    .dxs-fallback {
      position: absolute;
      inset: 0;
      overflow: hidden;
      background:
        radial-gradient(80% 60% at 54% 32%, rgba(186, 156, 102, .15), transparent 70%),
        linear-gradient(145deg, #1b2534 0%, #111827 50%, #090e18 100%);
    }

    .dxs-room {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      opacity: .78;
    }

    .dxs-fallback-label {
      position: absolute;
      left: 50%;
      top: 17%;
      transform: translateX(-50%);
      padding: 6px 14px;
      border: 1px solid rgba(221, 192, 134, .28);
      border-radius: 999px;
      background: rgba(8, 13, 22, .6);
      box-shadow: 0 8px 20px rgba(0, 0, 0, .2);
      color: rgba(244, 232, 208, .88);
      font-size: clamp(9px, .95vw, 13px);
      letter-spacing: .06em;
      white-space: nowrap;
      -webkit-backdrop-filter: blur(6px);
      backdrop-filter: blur(6px);
    }

    .dxs-bg {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: center;
    }

    /* Затемнение сверху и снизу: ник и стенды должны читаться на любом интерьере. */
    .dxs-shade {
      position: absolute;
      inset: 0;
      background:
        linear-gradient(180deg, rgba(4, 8, 15, .62) 0%, rgba(4, 8, 15, .12) 24%, rgba(4, 8, 15, 0) 48%, rgba(4, 7, 13, .24) 70%, rgba(4, 7, 13, .9) 100%),
        linear-gradient(90deg, rgba(4, 8, 15, .36) 0%, transparent 34%, transparent 70%, rgba(4, 8, 15, .28) 100%);
      pointer-events: none;
    }

    /* Персонаж. Низ посажен на пол, рост — около 58% от высоты сцены
       (62% с учётом прозрачных полей viewBox). */
    .dxs-character {
      position: absolute;
      right: 44.5%;
      bottom: 4.5%;
      height: 62%;
      aspect-ratio: 260 / 540;
      pointer-events: none;
    }

    .dxs--no-stands .dxs-character { right: 42.15%; }

    /* Мягкая эллиптическая тень под туфлями. */
    .dxs-character::before {
      content: "";
      position: absolute;
      left: -7%;
      right: -7%;
      bottom: 1.2%;
      height: 6%;
      border-radius: 50%;
      background: radial-gradient(ellipse at center, rgba(0, 0, 0, .62) 0%, rgba(0, 0, 0, .28) 42%, rgba(0, 0, 0, 0) 72%);
    }

    .dxs-person {
      position: relative;
      display: block;
      width: 100%;
      height: 100%;
      overflow: visible;
    }

    /* Украшения рисуются векторными глифами внутри SVG персонажа,
       поэтому отдельных CSS-слоёв и растровых наложений здесь нет. */

    /* Стенды с номерами: 2 колонки × 3 строки на широкой сцене. */
    .dxs-stands {
      position: absolute;
      top: 10.5%;
      right: 3.2%;
      z-index: 5;
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: clamp(7px, .9vw, 12px);
      width: 33%;
    }

    .dxs-stand {
      position: relative;
      min-width: 0;
      padding: clamp(6px, .8vw, 10px);
      border: 1px solid rgba(214, 182, 119, .3);
      border-radius: 12px;
      background: linear-gradient(155deg, rgba(32, 40, 55, .94), rgba(13, 18, 28, .96));
      box-shadow: 0 12px 26px rgba(0, 0, 0, .32), inset 0 1px 0 rgba(255, 255, 255, .06);
    }

    .dxs-stand::after {
      content: "";
      position: absolute;
      left: 15%;
      right: 15%;
      bottom: -4px;
      height: 4px;
      border: 1px solid rgba(214, 182, 119, .2);
      border-top: 0;
      border-radius: 0 0 4px 4px;
      background: #0a1019;
    }

    .dxs-plate {
      display: block;
      padding: clamp(4px, .55vw, 7px) 3px;
      border-radius: 5px;
      background: linear-gradient(180deg, #eed9a2 0%, #cfad70 52%, #9d783f 100%);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, .42), inset 0 -1px 0 rgba(79, 57, 22, .32);
      color: #21180a;
      font-size: clamp(11px, 1.35vw, 18px);
      font-weight: 800;
      line-height: 1.05;
      letter-spacing: .035em;
      text-align: center;
      text-shadow: 0 1px 0 rgba(255, 255, 255, .32);
      font-variant-numeric: tabular-nums;
      font-feature-settings: "tnum" 1;
      white-space: nowrap;
    }

    .dxs-stand-label {
      display: block;
      margin-top: 4px;
      color: rgba(231, 216, 185, .58);
      font-size: clamp(7px, .62vw, 9px);
      letter-spacing: .18em;
      line-height: 1.1;
      text-align: center;
    }

    /* Плашка игрока. */
    .dxs-badge {
      position: absolute;
      left: 3.2%;
      bottom: 3.6%;
      z-index: 6;
      display: flex;
      align-items: center;
      gap: clamp(6px, .75vw, 10px);
      max-width: 34%;
      padding: clamp(5px, .6vw, 8px) clamp(10px, 1.2vw, 16px) clamp(5px, .6vw, 8px) clamp(5px, .6vw, 8px);
      border: 1px solid rgba(221, 196, 145, .22);
      border-radius: 16px;
      background: linear-gradient(120deg, rgba(8, 13, 22, .84), rgba(12, 18, 29, .62));
      box-shadow: 0 12px 30px rgba(0, 0, 0, .3);
      -webkit-backdrop-filter: blur(10px) saturate(1.1);
      backdrop-filter: blur(10px) saturate(1.1);
    }

    .dxs-avatar {
      display: grid;
      place-items: center;
      flex: 0 0 auto;
      width: clamp(34px, 3.8vw, 48px);
      height: clamp(34px, 3.8vw, 48px);
      border-radius: 50%;
      box-shadow: inset 0 0 0 2px rgba(255, 255, 255, .24), 0 4px 12px rgba(0, 0, 0, .24);
      font-size: clamp(18px, 2.1vw, 25px);
      line-height: 1;
    }

    .dxs-badge-text {
      display: flex;
      flex-direction: column;
      min-width: 0;
      gap: 2px;
    }

    .dxs-nick {
      overflow: hidden;
      color: #fff6e3;
      font-size: clamp(12px, 1.4vw, 18px);
      font-weight: 700;
      line-height: 1.15;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .dxs-home {
      overflow: hidden;
      color: rgba(226, 214, 191, .7);
      font-size: clamp(8px, .85vw, 11px);
      line-height: 1.2;
      letter-spacing: .015em;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    @media (max-width: 559px) {
      .dxs-character {
        right: 43%;
        bottom: 68px;
        height: 48%;
      }

      .dxs--no-stands .dxs-character { right: 43%; }

      .dxs-stands {
        top: auto;
        left: 48%;
        right: 8px;
        bottom: 10px;
        display: flex;
        gap: 7px;
        width: auto;
        overflow-x: auto;
        overflow-y: hidden;
        padding: 1px 1px 7px;
        scrollbar-width: none;
        -webkit-overflow-scrolling: touch;
        scroll-snap-type: x proximity;
      }

      .dxs-stands::-webkit-scrollbar { display: none; }

      .dxs-stand {
        flex: 0 0 78px;
        padding: 5px;
        border-radius: 9px;
        scroll-snap-align: start;
      }

      .dxs-plate {
        padding: 4px 2px;
        font-size: 12px;
        letter-spacing: 0;
      }

      .dxs-stand-label {
        margin-top: 2px;
        font-size: 7px;
        letter-spacing: .13em;
      }

      .dxs-badge {
        left: 8px;
        bottom: 10px;
        gap: 6px;
        max-width: calc(47% - 12px);
        padding: 4px 8px 4px 4px;
        border-radius: 12px;
      }

      .dxs-avatar {
        width: 30px;
        height: 30px;
        font-size: 16px;
      }

      .dxs-nick { font-size: 12px; }
      .dxs-home { font-size: 8px; }
      .dxs-fallback-label { top: 10%; }
    }
  `;

  /* ---------- утилиты ---------- */

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function cleanText(value, maxLength) {
    var text = String(value == null ? '' : value)
      .replace(/[\u0000-\u001f\u007f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (maxLength && Array.from(text).length > maxLength) {
      text = Array.from(text).slice(0, maxLength).join('');
    }
    return text;
  }

  function hashText(value) {
    var text = String(value == null ? '' : value);
    var hash = 2166136261;
    for (var i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function validPath(path) {
    return typeof path === 'string' &&
      path.length < 256 &&
      path.indexOf('..') === -1 &&
      /^assets\/(?:[\w.-]+\/)*[\w.-]+\.(?:webp|jpe?g|png|avif)$/i.test(path);
  }

  function galleryTable() {
    var table = window.MARKET_GALLERY_DATA;
    return table && typeof table === 'object' && !Array.isArray(table) ? table : null;
  }

  function own(table, key) {
    return !!table && Object.prototype.hasOwnProperty.call(table, key);
  }

  function galleryRecords(id) {
    var table = galleryTable();
    if (!table || !own(table, id)) return null;
    var records = table[id];
    return Array.isArray(records) ? records : null;
  }

  function lookupAsset(id) {
    if (!id) return null;
    var by = window.ASSET_BY;
    if (by && typeof by === 'object' && own(by, id)) return by[id] || null;
    var items = window.ASSET_ITEMS;
    if (Array.isArray(items)) {
      for (var i = 0; i < items.length; i++) {
        if (items[i] && items[i].id === id) return items[i];
      }
    }
    return null;
  }

  function itemName(id) {
    var item = lookupAsset(id);
    return item && item.name ? cleanText(item.name, 90) : '';
  }

  /* Путь к интерьеру берём только из MARKET_GALLERY_DATA. Никаких склеек путей. */
  function homeImage(homeId) {
    var id = cleanText(homeId, 80);
    if (!id) return null;
    var records = galleryRecords(id);
    if (!records) return null;
    var first = null;
    for (var i = 0; i < records.length; i++) {
      var record = records[i];
      if (!record || !validPath(record.f)) continue;
      if (!first) first = record.f;
      if (String(record.role || '').toLowerCase() === 'interior') return record.f;
    }
    return first;
  }

  /* Путь к картинке предмета — тоже только из галереи. */
  function imageFor(itemId) {
    var id = cleanText(itemId, 80);
    if (!id) return null;
    var records = galleryRecords(id);
    if (!records) return null;
    for (var i = 0; i < records.length; i++) {
      var record = records[i];
      if (record && validPath(record.f)) return record.f;
    }
    return null;
  }

  function ensureStyles() {
    if (typeof document === 'undefined') return;
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    var head = document.head || document.documentElement;
    if (head) head.appendChild(style);
  }

  function normalizeColor(value) {
    var color = String(value == null ? '' : value).trim();
    return /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color)
      ? color
      : '#c0561b';
  }

  function normalizeAvatar(value) {
    var avatar = value && typeof value === 'object' ? value : {};
    var emoji = cleanText(avatar.emoji, 8);
    return {
      emoji: emoji || '🐺',
      color: normalizeColor(avatar.color)
    };
  }

  function normalizeNick(data) {
    var raw = data && data.nick != null ? data.nick : '';
    if (!raw) {
      var account = window.__DE_ACC;
      if (account && typeof account === 'object') {
        raw = account.nick || account.nick_lc || '';
      }
    }
    var nick = cleanText(raw, 32).replace(/^@+/, '').trim();
    return nick || 'игрок';
  }

  function normalizeStands(value) {
    var result = [];
    var seen = {};
    if (!Array.isArray(value)) return result;
    for (var i = 0; i < value.length && result.length < MAX_STANDS; i++) {
      var raw = cleanText(value[i], 16);
      var digits = raw.replace(/\s+/g, '');
      if (!/^\d{8}$/.test(digits) || seen[digits]) continue;
      seen[digits] = true;
      result.push(digits);
    }
    return result;
  }

  function wearKind(rawId) {
    var id = String(rawId == null ? '' : rawId).toLowerCase();
    if (/^chain_/.test(id) || id === 'cross_dia' || id === 'pendant_skull') return 'chain';
    if (isWatchId(id)) return 'watch';
    if (id === 'bracelet_tennis_white') return 'bracelet';
    if (id === 'diamondstone' || id === 'gold') return 'ring';
    return '';
  }

  /* До пяти предметов, строгий приоритет: цепь → часы → браслет → кольцо.
     Нераспознанные предметы не рисуем; отдельного слота серёг больше нет. */
  function layoutWear(value) {
    var ids = [];
    var seenIds = Object.create(null);
    var input = Array.isArray(value) ? value : [];
    for (var i = 0; i < input.length; i++) {
      var id = cleanText(input[i], 80).toLowerCase();
      if (!id || seenIds[id]) continue;
      seenIds[id] = true;
      ids.push(id);
    }

    var primary = { chain: null, watch: null, bracelet: null, ring: null };
    for (var j = 0; j < ids.length; j++) {
      var itemId = ids[j];
      var kind = wearKind(itemId);
      if (!kind || primary[kind]) continue;
      primary[kind] = {
        id: itemId,
        name: itemName(itemId),
        slot: kind
      };
    }

    var result = [];
    ['chain', 'watch', 'bracelet', 'ring'].forEach(function (kind) {
      if (primary[kind]) result.push(primary[kind]);
    });
    return result.slice(0, MAX_WEAR);
  }

  /* ---------- разметка ---------- */

  function roomSvg() {
    return '' +
      '<svg class="dxs-room" viewBox="0 0 800 450" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">' +
        '<path d="M0 345 H800" stroke="#9d8760" stroke-opacity=".26" stroke-width="2"/>' +
        '<g fill="none" stroke="#c7ae7c" stroke-opacity=".24" stroke-width="1.6">' +
          '<rect x="478" y="54" width="234" height="236" rx="6"/>' +
          '<path d="M595 54 V290 M478 166 H712"/>' +
        '</g>' +
        '<g fill="#09101a" opacity=".68">' +
          '<path d="M493 290 V243 H512 V219 H530 V255 H548 V193 H567 V245 H586 V226 H605 V259 H624 V210 H643 V244 H663 V230 H680 V290 Z"/>' +
        '</g>' +
        '<g opacity=".9">' +
          '<rect x="72" y="102" width="148" height="104" rx="4" fill="#0d1420" stroke="#9d8760" stroke-opacity=".25"/>' +
          '<path d="M84 184 L112 149 L131 168 L150 143 L208 184 Z" fill="#182235"/>' +
          '<circle cx="183" cy="130" r="9" fill="#bca36f" opacity=".4"/>' +
          '<path d="M305 0 V54" stroke="#8d7b5b" stroke-opacity=".35" stroke-width="2"/>' +
          '<path d="M278 62 H332 L340 84 H270 Z" fill="#111927" stroke="#9d8760" stroke-opacity=".22"/>' +
          '<circle cx="305" cy="61" r="15" fill="#182235" stroke="#9d8760" stroke-opacity=".25"/>' +
          '<path d="M95 314 C95 299 104 293 120 293 H246 C262 293 272 299 272 314 V344 H95 Z" fill="#0b111b" stroke="#9d8760" stroke-opacity=".2"/>' +
          '<path d="M83 316 C83 307 89 302 97 302 C105 302 111 307 111 316 V347 H83 Z" fill="#101722" stroke="#9d8760" stroke-opacity=".16"/>' +
          '<path d="M257 316 C257 307 263 302 271 302 C279 302 285 307 285 316 V347 H257 Z" fill="#101722" stroke="#9d8760" stroke-opacity=".16"/>' +
          '<path d="M112 306 H256 M119 320 C145 315 170 315 192 320" stroke="#a78e62" stroke-opacity=".16" stroke-width="2"/>' +
          '<ellipse cx="202" cy="393" rx="104" ry="25" fill="#070c14" opacity=".55"/>' +
          '<rect x="148" y="350" width="112" height="9" rx="4" fill="#0d1420" stroke="#9d8760" stroke-opacity=".2"/>' +
          '<path d="M160 359 L154 391 M250 359 L258 389" stroke="#9d8760" stroke-opacity=".16" stroke-width="4"/>' +
          '<path d="M699 333 C690 302 686 270 696 238" stroke="#6c8064" stroke-opacity=".35" stroke-width="4" fill="none"/>' +
          '<path d="M697 281 C676 267 668 244 672 224 C692 232 704 254 702 275 Z" fill="#556b55" opacity=".36"/>' +
          '<path d="M699 301 C717 286 736 275 745 250 C721 249 704 264 696 286 Z" fill="#4b604c" opacity=".3"/>' +
          '<path d="M680 336 H724 L716 389 H688 Z" fill="#0c121c" stroke="#9d8760" stroke-opacity=".19"/>' +
        '</g>' +
        '<path d="M0 344 H800 V450 H0 Z" fill="#080d15" opacity=".24"/>' +
      '</svg>';
  }

  function hairSvg(index, hair) {
    if (index === 1) {
      return '' +
        '<path d="M87 88 C86 51 102 29 132 29 C160 29 176 47 174 82 C168 67 158 58 147 54 C131 64 114 70 98 86 C95 92 93 100 93 107 L86 102 C85 97 85 93 87 88 Z" fill="' + hair.color + '"/>' +
        '<path d="M96 53 C113 34 140 29 156 41 C136 39 115 48 99 63 Z" fill="' + hair.light + '" opacity=".4"/>' +
        '<path d="M108 46 C124 35 143 32 157 38" stroke="' + hair.light + '" stroke-width="2" fill="none" opacity=".28"/>' +
        '<path d="M88 88 C89 97 90 104 92 108 L86 103 C85 97 86 92 88 88 Z" fill="' + hair.color + '"/>';
    }
    if (index === 2) {
      return '' +
        '<path d="M88 92 C86 58 101 34 130 33 C159 34 174 56 173 91 C167 74 157 65 146 61 C130 70 112 69 98 76 C93 82 90 87 88 92 Z" fill="' + hair.color + '"/>' +
        '<g fill="' + hair.color + '">' +
          '<circle cx="98" cy="55" r="14"/><circle cx="115" cy="41" r="16"/>' +
          '<circle cx="137" cy="38" r="17"/><circle cx="157" cy="49" r="15"/>' +
          '<circle cx="170" cy="66" r="11"/><circle cx="91" cy="73" r="11"/>' +
          '<circle cx="127" cy="27" r="10"/>' +
        '</g>' +
        '<g fill="' + hair.light + '" opacity=".55">' +
          '<circle cx="111" cy="37" r="5"/><circle cx="133" cy="31" r="4"/>' +
          '<circle cx="149" cy="44" r="5"/><circle cx="99" cy="52" r="4"/>' +
        '</g>' +
        '<path d="M94 74 C104 66 116 62 129 62" stroke="' + hair.light + '" stroke-width="3" fill="none" opacity=".45"/>';
    }
    return '' +
      '<path d="M88 91 C85 55 100 31 130 30 C158 31 175 51 173 89 C167 71 157 62 146 58 C130 67 111 66 97 73 C93 79 90 85 88 91 Z" fill="' + hair.color + '"/>' +
      '<path d="M96 65 C109 54 126 50 143 56 C129 56 112 62 100 73 Z" fill="' + hair.light + '" opacity=".68"/>' +
      '<path d="M88 86 C88 77 91 70 95 65 C93 79 95 94 98 103 L90 101 Z" fill="' + hair.color + '"/>' +
      '<path d="M172 85 C172 76 169 70 165 65 C168 79 166 94 163 102 L171 100 Z" fill="' + hair.color + '"/>';
  }

  /* ---------- ювелирные глифы ---------- */

  var JEWEL_OUTLINE = '#4b3410';

  function jewelryDefs(key) {
    return '<defs>' +
      '<linearGradient id="' + key + '-gold" x1="0" y1="0" x2="1" y2="1">' +
        '<stop offset="0" stop-color="#f7d67a"/>' +
        '<stop offset=".5" stop-color="#d99a2b"/>' +
        '<stop offset="1" stop-color="#8a5a12"/>' +
      '</linearGradient>' +
      '<filter id="' + key + '-shadow" x="-60%" y="-60%" width="220%" height="220%" color-interpolation-filters="sRGB">' +
        '<feDropShadow dx="0" dy="1.4" stdDeviation=".9" flood-color="#000000" flood-opacity=".35"/>' +
      '</filter>' +
    '</defs>';
  }

  function chainGlyphSvg(id, key) {
    var gold = 'url(#' + key + '-gold)';
    var shadow = 'filter="url(#' + key + '-shadow)"';
    var chain = 'M104 157 C109 183 118 198 130 206 C142 198 151 183 156 157';
    var pendant;

    if (id === 'chain_snake') {
      pendant = '<g transform="translate(130 220)">' +
        '<path d="M0 -10 C7.5 -2 7 5 0 9 C-7 5 -7.5 -2 0 -10 Z" fill="' + gold + '" stroke="' + JEWEL_OUTLINE + '" stroke-width=".8"/>' +
        '<path d="M-3.2 -2 C-5 3 -1.5 6 0 5" fill="none" stroke="#fff2be" stroke-width=".9" opacity=".65"/>' +
      '</g>';
    } else if (id === 'chain_tennis') {
      pendant = '<g transform="translate(130 219)">' +
        '<circle r="8.5" fill="' + gold + '" stroke="' + JEWEL_OUTLINE + '" stroke-width=".8"/>' +
        '<circle r="5.7" fill="#f7fbff" stroke="#9ca9b6" stroke-width=".35"/>' +
        '<path d="M-2.8 -2.5 L0 -5 L2.8 -2.5 L0 0 Z" fill="#ffffff" opacity=".9"/>' +
        '<circle r="8.5" fill="none" stroke="#fff0bb" stroke-width=".45" opacity=".5"/>' +
      '</g>';
    } else {
      // chain_cuban и прочие chain_* — кубическая подвеска.
      pendant = '<g transform="translate(130 220)">' +
        '<path d="M0 -9 L7.5 -4.5 L7.5 4 L0 9 L-7.5 4 L-7.5 -4.5 Z" fill="' + gold + '" stroke="' + JEWEL_OUTLINE + '" stroke-width=".8"/>' +
        '<path d="M0 -9 L0 0 L7.5 4 M0 0 L-7.5 4 M0 0 L-7.5 -4.5 M0 0 L7.5 -4.5" fill="none" stroke="#6b450e" stroke-width=".65" opacity=".8"/>' +
        '<path d="M-4.8 -3.4 L0 -6.2 L4.8 -3.4 L0 -.5 Z" fill="#fff4c8" opacity=".52"/>' +
      '</g>';
    }

    return '<g class="dxs-jewelry__chain" ' + shadow + '>' +
      '<path d="' + chain + '" fill="none" stroke="' + JEWEL_OUTLINE + '" stroke-opacity=".9" stroke-width="4"/>' +
      '<path d="' + chain + '" fill="none" stroke="' + gold + '" stroke-width="2.6"/>' +
      '<circle cx="130" cy="208" r="1.9" fill="none" stroke="' + JEWEL_OUTLINE + '" stroke-width="1.8"/>' +
      '<circle cx="130" cy="208" r="1.9" fill="none" stroke="' + gold + '" stroke-width=".9"/>' +
      '<path d="M130 209 V212" stroke="' + gold + '" stroke-width="1"/>' +
      '<circle cx="104" cy="157" r="1.5" fill="' + gold + '" stroke="' + JEWEL_OUTLINE + '" stroke-width=".6"/>' +
      '<circle cx="156" cy="157" r="1.5" fill="' + gold + '" stroke="' + JEWEL_OUTLINE + '" stroke-width=".6"/>' +
      pendant +
    '</g>';
  }

  function crossGlyphSvg(key) {
    var gold = 'url(#' + key + '-gold)';
    var shadow = 'filter="url(#' + key + '-shadow)"';
    var chain = 'M106 157 C110 177 120 190 130 196 C140 190 150 177 154 157';
    var dots = [[0, -7], [-5, -3.5], [5, -3.5], [0, 3], [0, 8]];
    var stones = '';
    for (var i = 0; i < dots.length; i++) {
      stones += '<circle cx="' + dots[i][0] + '" cy="' + dots[i][1] + '" r="1"/>';
    }

    return '<g class="dxs-jewelry__cross" ' + shadow + '>' +
      '<path d="' + chain + '" fill="none" stroke="' + JEWEL_OUTLINE + '" stroke-opacity=".9" stroke-width="4"/>' +
      '<path d="' + chain + '" fill="none" stroke="' + gold + '" stroke-width="2.6"/>' +
      '<circle cx="130" cy="198" r="2" fill="none" stroke="' + JEWEL_OUTLINE + '" stroke-width="1.8"/>' +
      '<circle cx="130" cy="198" r="2" fill="none" stroke="' + gold + '" stroke-width=".9"/>' +
      '<g transform="translate(130 211)">' +
        '<path d="M-2.8 -11 H2.8 V-5 H8 V-2 H2.8 V11 H-2.8 V-2 H-8 V-5 H-2.8 Z" fill="' + gold + '" stroke="' + JEWEL_OUTLINE + '" stroke-width=".8"/>' +
        '<g fill="#f9fdff" stroke="#9aa6b1" stroke-width=".25">' + stones + '</g>' +
      '</g>' +
    '</g>';
  }

  function skullGlyphSvg(key) {
    var gold = 'url(#' + key + '-gold)';
    var shadow = 'filter="url(#' + key + '-shadow)"';
    var chain = 'M104 157 C109 183 118 198 130 206 C142 198 151 183 156 157';

    return '<g class="dxs-jewelry__skull" ' + shadow + '>' +
      '<path d="' + chain + '" fill="none" stroke="' + JEWEL_OUTLINE + '" stroke-opacity=".9" stroke-width="4"/>' +
      '<path d="' + chain + '" fill="none" stroke="' + gold + '" stroke-width="2.6"/>' +
      '<circle cx="130" cy="207.5" r="1.9" fill="none" stroke="' + JEWEL_OUTLINE + '" stroke-width="1.8"/>' +
      '<circle cx="130" cy="207.5" r="1.9" fill="none" stroke="' + gold + '" stroke-width=".9"/>' +
      '<g transform="translate(130 220)">' +
        '<circle r="9.5" fill="' + gold + '" stroke="' + JEWEL_OUTLINE + '" stroke-width=".8"/>' +
        '<circle r="7.3" fill="#f0c768" stroke="#7a4f0f" stroke-width=".5"/>' +
        '<path d="M0 -5.3 C-4 -5.3 -5.7 -2.7 -5.7 -.1 C-5.7 1.8 -4.8 3.1 -3.5 3.9 L-3.5 5.8 H3.5 V3.9 C4.8 3.1 5.7 1.8 5.7 -.1 C5.7 -2.7 4 -5.3 0 -5.3 Z" fill="#231b12"/>' +
        '<circle cx="-2.2" cy="-.6" r="1.2" fill="#f0c768"/>' +
        '<circle cx="2.2" cy="-.6" r="1.2" fill="#f0c768"/>' +
        '<path d="M0 1.2 L-.8 2.4 H.8 Z" fill="#f0c768"/>' +
        '<path d="M-2.2 4.2 V5.3 M0 4.2 V5.3 M2.2 4.2 V5.3" stroke="#f0c768" stroke-width=".35"/>' +
      '</g>' +
    '</g>';
  }

  function watchGlyphSvg(id, key) {
    var square = /^(?:ap|ap_offshore_dia|richard|rm_dia|royaloak_iced|iced_square_rose)$/.test(id);
    var iced = /(?:dia|iced|rainbow)/.test(id);
    var gold = 'url(#' + key + '-gold)';
    var shadow = 'filter="url(#' + key + '-shadow)"';
    var markup = '<g class="dxs-jewelry__watch" ' + shadow + ' transform="rotate(-9 183 347)">';

    // Ремешок вокруг левого запястья.
    markup += '<path d="M164 339 C172 334 194 334 201 340 L199 356 C192 361 172 361 165 356 Z" fill="#2e2117" stroke="#1a120a" stroke-width=".8"/>';
    markup += '<path d="M167 343 C174 339 193 339 199 344" fill="none" stroke="' + gold + '" stroke-width="1.1" opacity=".72"/>';
    markup += '<rect x="164.4" y="342" width="4.2" height="9" rx="1.1" fill="' + gold + '" stroke="' + JEWEL_OUTLINE + '" stroke-width=".5"/>';

    // Круглый или квадратный корпус 23 единицы viewBox (≈18–20 px при сцене 1200–1440).
    if (square) {
      markup += '<rect x="171.5" y="335.5" width="23" height="23" rx="5.5" fill="' + gold + '" stroke="' + JEWEL_OUTLINE + '" stroke-width=".8"/>';
      markup += '<rect x="175" y="339" width="16" height="16" rx="3.2" fill="#151c24" stroke="#6b4b17" stroke-width=".5"/>';
    } else {
      markup += '<circle cx="183" cy="347" r="11.5" fill="' + gold + '" stroke="' + JEWEL_OUTLINE + '" stroke-width=".8"/>';
      markup += '<circle cx="183" cy="347" r="8.7" fill="#151c24" stroke="#6b4b17" stroke-width=".5"/>';
    }

    markup += '<path d="M183 340.2 V342.2 M183 351.8 V353.8 M176.2 347 H178.2 M187.8 347 H189.8" stroke="#f6e7c0" stroke-width="1.1" stroke-linecap="round"/>';
    markup += '<path d="M183 347 V342.4 M183 347 L187.2 349.4" stroke="#f8ebc9" stroke-width="1.2" stroke-linecap="round"/>';
    markup += '<circle cx="183" cy="347" r="1" fill="#f9edca"/>';
    markup += '<rect x="194.4" y="344" width="3.2" height="6" rx="1" fill="' + gold + '" stroke="' + JEWEL_OUTLINE + '" stroke-width=".5"/>';

    if (iced) {
      var stones = square
        ? [[176.5, 340.5], [183, 337.2], [189.5, 340.5], [192.8, 347], [189.5, 353.5], [183, 356.8], [176.5, 353.5], [173.2, 347]]
        : [[183, 336.8], [190.2, 339.8], [193.2, 347], [190.2, 354.2], [183, 357.2], [175.8, 354.2], [172.8, 347], [175.8, 339.8]];
      markup += '<g fill="#f9fdff" stroke="#9ba8b4" stroke-width=".22">';
      for (var i = 0; i < stones.length; i++) {
        markup += '<circle cx="' + stones[i][0] + '" cy="' + stones[i][1] + '" r=".9"/>';
      }
      markup += '</g>';
    }

    markup += '<path d="M174.8 341 A10 10 0 0 1 184 336.8" fill="none" stroke="#fff6cf" stroke-width=".8" opacity=".55"/>';
    markup += '</g>';
    return markup;
  }

  function braceletGlyphSvg(key) {
    var gold = 'url(#' + key + '-gold)';
    var shadow = 'filter="url(#' + key + '-shadow)"';
    var stones = [
      [65, 344, 1.25], [70.5, 342.2, 1.3], [76, 341.5, 1.3],
      [81.5, 342.2, 1.3], [87, 344, 1.25], [72, 351.5, 1.2], [82, 352, 1.25]
    ];
    var dots = '';
    for (var i = 0; i < stones.length; i++) {
      dots += '<circle cx="' + stones[i][0] + '" cy="' + stones[i][1] + '" r="' + stones[i][2] + '"/>';
    }

    return '<g class="dxs-jewelry__bracelet" ' + shadow + ' transform="rotate(10 75 349)">' +
      '<path d="M61 343 C69 337 83 337 91 343 L89 355 C81 362 68 361 61 354 Z" fill="' + gold + '" stroke="' + JEWEL_OUTLINE + '" stroke-width=".8"/>' +
      '<path d="M62 346 C70 340 82 340 89 345" fill="none" stroke="#f8e3aa" stroke-width=".8" opacity=".6"/>' +
      '<g fill="#f8fcff" stroke="#a6b2be" stroke-width=".22">' + dots + '</g>' +
    '</g>';
  }

  function ringGlyphSvg(id, key) {
    var wide = id === 'gold';
    var gold = 'url(#' + key + '-gold)';
    var shadow = 'filter="url(#' + key + '-shadow)"';
    var outlineWidth = wide ? 6.8 : 5;
    var bandWidth = wide ? 5.2 : 3.4;
    var markup = '<g class="dxs-jewelry__ring" ' + shadow + ' transform="rotate(-12 78 377)">';

    markup += '<ellipse cx="78" cy="377.5" rx="7.4" ry="4.2" fill="none" stroke="' + JEWEL_OUTLINE + '" stroke-width="' + outlineWidth + '"/>';
    markup += '<ellipse cx="78" cy="377.5" rx="7.4" ry="4.2" fill="none" stroke="' + gold + '" stroke-width="' + bandWidth + '"/>';
    markup += '<path d="M71.5 376 C72.8 372.5 75.5 370.5 78.8 370.8" fill="none" stroke="#fff0b5" stroke-width=".7" opacity=".7"/>';

    if (!wide) {
      markup += '<path d="M78 364.5 L83 371 L78 375 L73 371 Z" fill="#f8fdff" stroke="#8b6c35" stroke-width=".7"/>';
      markup += '<path d="M73 371 H83 M78 364.5 L75.7 371 L78 375 L80.3 371" fill="none" stroke="#b8c7d4" stroke-width=".35" opacity=".9"/>';
      markup += '<circle cx="76" cy="368" r=".7" fill="#ffffff"/>';
    } else {
      markup += '<ellipse cx="78" cy="376.5" rx="7.4" ry="4.2" fill="none" stroke="#fff0b5" stroke-width=".45" opacity=".45"/>';
    }

    markup += '</g>';
    return markup;
  }

  function jewelrySvg(wear, key) {
    if (!wear || !wear.length) return '';
    var slots = Object.create(null);
    for (var i = 0; i < wear.length; i++) slots[wear[i].slot] = wear[i];

    var markup = '';
    if (slots.chain) {
      if (slots.chain.id === 'cross_dia') markup += crossGlyphSvg(key);
      else if (slots.chain.id === 'pendant_skull') markup += skullGlyphSvg(key);
      else markup += chainGlyphSvg(slots.chain.id, key);
    }
    if (slots.watch) markup += watchGlyphSvg(slots.watch.id, key);
    if (slots.bracelet) markup += braceletGlyphSvg(key);
    if (slots.ring) markup += ringGlyphSvg(slots.ring.id, key);

    return markup ? '<g class="dxs-jewelry">' + markup + '</g>' : '';
  }

  function personSvg(hairIndex, wear, jewelryKey) {
    var c = CASUAL;
    var hair = HAIRS[hairIndex % HAIRS.length];
    var crease = 'stroke="' + c.crease + '" stroke-width="2" fill="none" opacity=".75"';

    return '' +
      '<svg class="dxs-person" viewBox="0 0 260 540" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">' +
        jewelryDefs(jewelryKey) +
        '<g stroke-linejoin="round" stroke-linecap="round">' +

          /* Серые брюки и тёмные туфли. */
          '<path d="M96 323 C92 351 93 411 100 488 C101 499 104 506 111 509 L119 507 C122 498 121 483 120 465 C118 421 123 366 130 330 L109 319 Z" fill="' + c.pants + '"/>' +
          '<path d="M164 323 C168 351 167 411 160 488 C159 499 156 506 149 509 L141 507 C138 498 139 483 140 465 C142 421 137 366 130 330 L151 319 Z" fill="' + c.pants + '"/>' +
          '<path d="M99 329 C96 367 97 425 102 482 L108 482 C102 424 101 369 105 331 Z" fill="' + c.pantsShade + '" opacity=".7"/>' +
          '<path d="M161 329 C164 367 163 425 158 482 L152 482 C158 424 159 369 155 331 Z" fill="' + c.pantsShade + '" opacity=".55"/>' +
          '<path d="M111 348 C110 405 111 463 115 499" ' + crease + '/>' +
          '<path d="M149 348 C150 405 149 463 145 499" ' + crease + '/>' +
          '<path d="M101 488 C97 496 94 505 91 512 C86 519 82 523 82 528 C82 533 88 536 97 536 L121 533 C125 532 127 529 126 524 L125 490 L119 487 Z" fill="' + c.shoe + '"/>' +
          '<path d="M159 488 C163 496 166 505 169 512 C174 519 178 523 178 528 C178 533 172 536 163 536 L139 533 C135 532 133 529 134 524 L135 490 L141 487 Z" fill="' + c.shoe + '"/>' +
          '<path d="M84 527 C92 535 108 537 122 535 L126 533" stroke="' + c.sole + '" stroke-width="3" fill="none"/>' +
          '<path d="M176 527 C168 535 152 537 138 535 L134 533" stroke="' + c.sole + '" stroke-width="3" fill="none"/>' +
          '<path d="M94 512 C102 517 113 518 124 516" stroke="#3a332d" stroke-width="2" fill="none" opacity=".7"/>' +
          '<path d="M166 512 C158 517 147 518 136 516" stroke="#3a332d" stroke-width="2" fill="none" opacity=".7"/>' +

          /* Шея. */
          '<path d="M114 126 L146 126 L146 151 C146 160 139 166 130 166 C121 166 114 160 114 151 Z" fill="' + c.skinShade + '"/>' +
          '<path d="M116 131 L144 131 L144 150 C144 158 138 162 130 162 C122 162 116 158 116 150 Z" fill="' + c.skin + '"/>' +

          /* Открытые руки: короткий рукав футболки заканчивается выше локтя. */
          '<path d="M92 176 C78 188 69 211 65 242 C61 273 62 307 68 334 L73 350 L94 345 L88 326 C84 301 84 276 87 253 C90 228 98 205 111 187 Z" fill="' + c.skin + '"/>' +
          '<path d="M168 176 C182 188 191 211 195 242 C199 273 198 307 192 334 L187 350 L166 345 L172 326 C176 301 176 276 173 253 C170 228 162 205 149 187 Z" fill="' + c.skin + '"/>' +
          '<path d="M71 242 C67 272 68 306 74 331" stroke="' + c.skinShade + '" stroke-width="1.4" fill="none" opacity=".34"/>' +
          '<path d="M189 242 C193 272 192 306 186 331" stroke="' + c.skinShade + '" stroke-width="1.4" fill="none" opacity=".3"/>' +
          '<path d="M74 351 C66 353 61 359 61 368 C61 378 68 386 78 386 C87 386 94 381 95 372 C96 365 93 360 91 355 L90 347 Z" fill="' + c.skin + '"/>' +
          '<path d="M186 351 C194 353 199 359 199 368 C199 378 192 386 182 386 C173 386 166 381 165 372 C164 365 167 360 169 355 L170 347 Z" fill="' + c.skin + '"/>' +
          '<path d="M69 357 C75 360 79 363 82 369" stroke="' + c.skinShade + '" stroke-width="2" fill="none" opacity=".8"/>' +
          '<path d="M191 357 C185 360 181 363 178 369" stroke="' + c.skinShade + '" stroke-width="2" fill="none" opacity=".8"/>' +

          /* Белая футболка прямого кроя. */
          '<path d="M96 171 C108 158 118 153 130 153 C142 153 152 158 164 171 C171 191 174 227 174 268 C174 301 171 324 169 341 C160 346 150 347 141 344 L130 337 L119 344 C110 347 100 346 91 341 C89 324 86 301 86 268 C86 227 89 191 96 171 Z" fill="' + c.tee + '"/>' +
          '<path d="M96 171 C89 203 86 252 90 307 C92 324 95 335 100 341 C96 332 94 323 92 310 C87 254 90 203 96 171 Z" fill="' + c.teeShade + '" opacity=".5"/>' +
          '<path d="M164 171 C171 203 174 252 170 307 C168 324 165 335 160 341 C164 332 166 323 168 310 C173 254 170 203 164 171 Z" fill="' + c.teeShade + '" opacity=".38"/>' +
          '<path d="M104 217 C100 250 100 288 105 318" stroke="' + c.teeShade + '" stroke-width="1.5" fill="none" opacity=".45"/>' +
          '<path d="M156 217 C160 250 160 288 155 318" stroke="' + c.teeShade + '" stroke-width="1.3" fill="none" opacity=".35"/>' +
          '<path d="M111 224 C120 229 140 229 149 224" stroke="' + c.teeShade + '" stroke-width="1.3" fill="none" opacity=".4"/>' +
          '<path d="M92 341 C104 346 116 347 123 344 L130 338 L137 344 C147 347 158 346 168 341" stroke="' + c.teeShade + '" stroke-width="1.2" fill="none" opacity=".75"/>' +

          /* Вырез футболки и короткие рукава. */
          '<path d="M113 153 C116 164 122 169 130 169 C138 169 144 164 147 153 Z" fill="' + c.skin + '"/>' +
          '<path d="M113 153 C116 164 122 169 130 169 C138 169 144 164 147 153" fill="none" stroke="' + c.teeEdge + '" stroke-width="1.7" opacity=".9"/>' +
          '<path d="M92 176 C80 188 71 210 67 235 C74 240 83 242 88 241 C91 223 98 202 111 186 Z" fill="' + c.tee + '"/>' +
          '<path d="M168 176 C180 188 189 210 193 235 C186 240 177 242 172 241 C169 223 162 202 149 186 Z" fill="' + c.tee + '"/>' +
          '<path d="M67 235 C74 240 83 242 88 241" fill="none" stroke="' + c.teeEdge + '" stroke-width="1.2" opacity=".9"/>' +
          '<path d="M193 235 C186 240 177 242 172 241" fill="none" stroke="' + c.teeEdge + '" stroke-width="1.2" opacity=".9"/>' +
          '<path d="M91 178 C83 187 77 198 73 211" fill="none" stroke="' + c.teeEdge + '" stroke-width="1" opacity=".4"/>' +
          '<path d="M169 178 C177 187 183 198 187 211" fill="none" stroke="' + c.teeEdge + '" stroke-width="1" opacity=".4"/>' +

          /* Голова, уши, лицо. */
          '<ellipse cx="88" cy="101" rx="9" ry="14" fill="' + c.skin + '"/>' +
          '<ellipse cx="172" cy="101" rx="9" ry="14" fill="' + c.skin + '"/>' +
          '<path d="M87 97 C85 100 86 105 89 108" stroke="' + c.skinShade + '" stroke-width="1.7" fill="none" opacity=".65"/>' +
          '<path d="M173 97 C175 100 174 105 171 108" stroke="' + c.skinShade + '" stroke-width="1.7" fill="none" opacity=".65"/>' +
          '<path d="M89 91 C88 56 103 33 130 33 C157 33 172 56 171 91 L170 104 C169 133 154 156 130 157 C106 156 91 133 90 104 Z" fill="' + c.skin + '"/>' +
          '<path d="M104 140 C115 149 145 149 156 140 C149 154 140 159 130 159 C120 159 111 154 104 140 Z" fill="' + c.skinShade + '" opacity=".28"/>' +
          '<circle cx="105" cy="122" r="9" fill="#d98366" opacity=".12"/>' +
          '<circle cx="155" cy="122" r="9" fill="#d98366" opacity=".12"/>' +

          hairSvg(hairIndex, hair) +

          '<path d="M101 89 C107 85 115 85 121 88" stroke="#4b3528" stroke-width="3" fill="none"/>' +
          '<path d="M139 88 C145 85 153 85 159 89" stroke="#4b3528" stroke-width="3" fill="none"/>' +
          '<path d="M102 101 C107 97 115 97 120 101 C115 106 107 106 102 101 Z" fill="#fffaf2"/>' +
          '<path d="M140 101 C145 97 153 97 158 101 C153 106 145 106 140 101 Z" fill="#fffaf2"/>' +
          '<circle cx="111.5" cy="100.5" r="3.4" fill="#2b211c"/>' +
          '<circle cx="148.5" cy="100.5" r="3.4" fill="#2b211c"/>' +
          '<circle cx="112.7" cy="99.3" r="1" fill="#fff"/>' +
          '<circle cx="149.7" cy="99.3" r="1" fill="#fff"/>' +
          '<path d="M129 102 C128 110 126 115 130 118 C132 119 134 118 135 117" stroke="' + c.skinShade + '" stroke-width="2.2" fill="none" opacity=".82"/>' +
          '<path d="M117 132 C124 139 136 139 143 131" stroke="#8c5541" stroke-width="3" fill="none"/>' +
          '<path d="M122 136 C127 139 133 139 138 136" stroke="#f7d8ca" stroke-width="1.2" fill="none" opacity=".42"/>' +
          '<path d="M110 150 C120 159 140 159 150 150 C147 155 140 158 130 158 C120 158 113 155 110 150 Z" fill="' + c.skinShade + '" opacity=".45"/>' +

          jewelrySvg(wear, jewelryKey) +
        '</g>' +
      '</svg>';
  }

  function standsHtml(stands) {
    if (!stands.length) return '';
    var cards = '';
    for (var i = 0; i < stands.length; i++) {
      cards += '<div class="dxs-stand" role="listitem">' +
        '<span class="dxs-plate">' + esc(stands[i]) + '</span>' +
        '<span class="dxs-stand-label">номер</span>' +
      '</div>';
    }
    return '<div class="dxs-stands" role="list" aria-label="Номера на стендах">' + cards + '</div>';
  }

  function badgeHtml(nick, homeLabel, avatar) {
    return '<div class="dxs-badge">' +
      '<span class="dxs-avatar" style="background:' + esc(avatar.color) + '" aria-hidden="true">' + esc(avatar.emoji) + '</span>' +
      '<span class="dxs-badge-text">' +
        '<span class="dxs-nick" title="@' + esc(nick) + '">@' + esc(nick) + '</span>' +
        '<span class="dxs-home" title="' + esc(homeLabel) + '">' + esc(homeLabel) + '</span>' +
      '</span>' +
    '</div>';
  }

  function sceneHtml(model, jewelryKey) {
    var background = homeImage(model.home);
    var classNames = 'dxs';
    if (!model.stands.length) classNames += ' dxs--no-stands';

    return '<div class="' + classNames + '">' +
      '<div class="dxs-fallback" aria-hidden="true">' +
        roomSvg() +
        '<span class="dxs-fallback-label">Квартира не выбрана</span>' +
      '</div>' +
      (background
        ? '<img class="dxs-bg" src="' + esc(background) + '" alt="" draggable="false" decoding="async">'
        : '') +
      '<div class="dxs-shade" aria-hidden="true"></div>' +
      '<div class="dxs-character">' +
        personSvg(model.hair, model.wear, jewelryKey) +
      '</div>' +
      standsHtml(model.stands) +
      badgeHtml(model.nick, model.homeLabel, model.avatar) +
    '</div>';
  }

  /* ---------- монтирование ---------- */

  function removeScenes(container) {
    var nodes = container.querySelectorAll('[data-dx-scene]');
    for (var i = nodes.length - 1; i >= 0; i--) {
      if (nodes[i].parentNode) nodes[i].parentNode.removeChild(nodes[i]);
    }
  }

  function guardImage(image, onFail) {
    if (!image) return;
    image.addEventListener('error', onFail, { once: true });
    if (image.complete && image.naturalWidth === 0) onFail();
  }

  function wireImages(scene) {
    var background = scene.querySelector('.dxs-bg');
    guardImage(background, function () {
      if (background) background.hidden = true;
      scene.classList.add('dxs--bg-failed');
    });
  }

  function normalizeModel(data) {
    var source = data && typeof data === 'object' ? data : {};
    var home = cleanText(source.home, 80);
    var homeItem = home ? lookupAsset(home) : null;

    // Не даём подставить машину или яхту в качестве интерьера.
    if (home && homeItem && homeItem.cat && homeItem.cat !== 'homes') home = '';

    var homeName = homeItem && homeItem.cat !== 'cars' && homeItem.cat !== 'air' && homeItem.name
      ? cleanText(homeItem.name, 90)
      : '';
    var homeLabel = home ? (homeName || 'Квартира') : 'Квартира не выбрана';
    var nick = normalizeNick(source);
    var seed = hashText(nick.toLowerCase());

    return {
      nick: nick,
      home: home,
      homeLabel: homeLabel,
      hair: seed % HAIRS.length,
      wear: layoutWear(source.wear),
      stands: normalizeStands(source.stands),
      avatar: normalizeAvatar(source.avatar)
    };
  }

  function render(container, data) {
    if (!container || container.nodeType !== 1 || typeof container.appendChild !== 'function') return null;
    if (typeof document === 'undefined' || typeof window === 'undefined') return null;

    ensureStyles();
    removeScenes(container);

    var model = normalizeModel(data);
    var jewelryKey = 'dxs-jewel-' + (++sceneSeq);
    var holder = document.createElement('div');
    holder.setAttribute('data-dx-scene', '');
    holder.innerHTML = sceneHtml(model, jewelryKey);

    var scene = holder.firstElementChild;
    if (!scene) return null;
    scene.setAttribute('role', 'group');
    var label = 'Сцена профиля @' + model.nick + '. ' + model.homeLabel;
    if (model.stands.length) label += '. Номеров на стендах: ' + model.stands.length;
    scene.setAttribute('aria-label', label);

    container.appendChild(holder);
    if (container.classList) container.classList.add(HOST_CLASS);

    wireImages(scene);
    return scene;
  }

  function clear(container) {
    if (!container || container.nodeType !== 1 || typeof container.querySelectorAll !== 'function') return;
    removeScenes(container);
    if (container.classList) container.classList.remove(HOST_CLASS);
  }

  if (typeof window !== 'undefined') {
    window.dxScene = {
      render: render,
      homeImage: homeImage,
      imageFor: imageFor,
      clear: clear
    };
  }
})();
