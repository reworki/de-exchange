/* ============================================================================
   DE · ПАНЕЛЬ ЦЕНЫ (только владелец)

   Кнопка «⚙ Цена» в верхней панели открывает панель: выбор монеты, текущая
   цена, кнопки −100…−1 / +1…+100 процентов и галочка «закрепить».
   Без галочки цена только толкается (потом сама тянется к базе), с галочкой
   база переезжает на новый уровень и цена там остаётся.

   Права проверяет сервер (ключ BOTS_KEY или аккаунт владельца). Панель видит
   только владелец. ES5, без внешних файлов.
   ========================================================================== */
(function () {
  var OWNER = 'knote6037';
  var STEPS = [1, 5, 10, 20, 50, 100];
  var box = null, gear = null, sel = null, priceEl = null, lockEl = null, statusEl = null, busy = false;
  var closed = false, lastKey = '';

  function acc() {
    var a = window.__DE_ACC;
    return (a && a.pass) ? a : null;
  }

  function basis() {
    var a = acc();
    if (!a) return '';
    try { return (typeof deBasis === 'function') ? deBasis(a) : ''; } catch (e) { return ''; }
  }

  function isOwner() {
    var a = acc();
    if (!a) return false;
    if (a.admin === true) return true;
    return basis() === OWNER;
  }

  function assets() {
    return (typeof ASSETS !== 'undefined' && ASSETS && ASSETS.length) ? ASSETS : [];
  }

  var touched = false;

  function byKey(key) {
    var arr = assets();
    for (var i = 0; i < arr.length; i++) if (arr[i].key === key) return arr[i];
    return null;
  }

  function pick() {
    /* пока пользователь не выбрал монету руками — показываем ту, чей график
       открыт: так «открыл ZEC → нажал +5%» двигает именно ZEC */
    if (!touched) {
      var c = window.current;
      if (c && c.key) {
        var hit = byKey(c.key);
        if (hit) return hit;
      }
    }
    var key = sel ? sel.value : '';
    var found = key ? byKey(key) : null;
    if (found) return found;
    var arr = assets();
    return arr.length ? arr[0] : null;
  }

  function fmtP(v) {
    var n = Number(v);
    if (!isFinite(n) || n <= 0) return '—';
    if (n >= 1000) return n.toFixed(0);
    if (n >= 1) return n.toFixed(2);
    return n.toPrecision(6);
  }

  function css() {
    if (document.getElementById('dxAdminCss')) return;
    var st = document.createElement('style');
    st.id = 'dxAdminCss';
    st.textContent =
      '#dxAdmin{position:fixed;right:16px;bottom:16px;z-index:100002;display:none;width:280px;' +
      'padding:12px 13px 12px;border-radius:18px;' +
      'background:linear-gradient(180deg,rgba(16,24,38,.96),rgba(8,12,20,.97));' +
      'border:1px solid rgba(247,220,166,.36);box-shadow:0 20px 52px rgba(0,0,0,.65);' +
      'backdrop-filter:blur(14px);font:600 12px/1.25 Manrope,Segoe UI,Arial,sans-serif;color:#f6f2ea}' +
      '#dxAdmin .dxa-hd{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}' +
      '#dxAdmin .dxa-hd b{font-size:11px;letter-spacing:.14em;color:#f7dca6;text-transform:uppercase}' +
      '#dxAdmin .dxa-hd span{cursor:pointer;color:#a89c8a;font-size:15px;line-height:1;padding:0 2px}' +
      '#dxAdmin select{width:100%;padding:7px 8px;border-radius:10px;margin-bottom:7px;' +
      'background:rgba(255,255,255,.07);color:#f6f2ea;border:1px solid rgba(255,255,255,.16);' +
      'font:700 12px Manrope,Segoe UI,Arial,sans-serif}' +
      '#dxAdmin .dxa-cur{font-size:16px;font-weight:900;letter-spacing:.03em;margin-bottom:2px}' +
      '#dxAdmin .dxa-row{display:flex;gap:4px;margin-top:5px}' +
      '#dxAdmin button.pct{flex:1 1 0;min-width:0;padding:7px 0;border-radius:10px;cursor:pointer;' +
      'border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:#f6f2ea;' +
      'font:700 11px Manrope,Segoe UI,Arial,sans-serif}' +
      '#dxAdmin button.pct.up{border-color:rgba(110,231,183,.45);color:#b8f5d8}' +
      '#dxAdmin button.pct.down{border-color:rgba(253,164,175,.42);color:#ffc9d0}' +
      '#dxAdmin button.pct:hover{background:rgba(255,255,255,.14)}' +
      '#dxAdmin button.pct:active{transform:translateY(1px)}' +
      '#dxAdmin .dxa-lock{display:flex;align-items:center;gap:7px;margin-top:9px;cursor:pointer;color:#f7dca6;font-size:11px}' +
      '#dxAdmin .dxa-lock input{accent-color:#ffb347;width:13px;height:13px}' +
      '#dxAdmin .dxa-st{margin-top:7px;font-size:10px;color:#a89c8a;letter-spacing:.04em;min-height:12px}';
    document.head.appendChild(st);
  }

  function mkBtn(pct) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'pct ' + (pct > 0 ? 'up' : 'down');
    b.setAttribute('data-pct', String(pct));
    b.textContent = (pct > 0 ? '+' : '−') + Math.abs(pct) + '%';
    b.addEventListener('click', function (ev) { ev.stopPropagation(); apply(pct); });
    return b;
  }

  function build() {
    if (box || !document.body) return;
    css();

    box = document.createElement('div');
    box.id = 'dxAdmin';

    var hd = document.createElement('div');
    hd.className = 'dxa-hd';
    var t = document.createElement('b');
    t.textContent = 'Цена вручную';
    var x = document.createElement('span');
    x.textContent = '✕';
    x.title = 'закрыть';
    x.addEventListener('click', function () { box.style.display = 'none'; closed = true; });
    hd.appendChild(t); hd.appendChild(x);
    box.appendChild(hd);

    sel = document.createElement('select');
    assets().forEach(function (a) {
      var o = document.createElement('option');
      o.value = a.key;
      o.textContent = a.sym + ' — ' + a.name;
      sel.appendChild(o);
    });
    sel.addEventListener('change', function () { touched = true; paint(); });
    box.appendChild(sel);

    var cur = document.createElement('div');
    cur.className = 'dxa-cur';
    priceEl = cur;
    box.appendChild(cur);

    var rowDown = document.createElement('div');
    rowDown.className = 'dxa-row';
    for (var i = STEPS.length - 1; i >= 0; i--) rowDown.appendChild(mkBtn(-STEPS[i]));
    box.appendChild(rowDown);

    var rowUp = document.createElement('div');
    rowUp.className = 'dxa-row';
    for (var j = 0; j < STEPS.length; j++) rowUp.appendChild(mkBtn(STEPS[j]));
    box.appendChild(rowUp);

    var lock = document.createElement('label');
    lock.className = 'dxa-lock';
    lockEl = document.createElement('input');
    lockEl.type = 'checkbox';
    lockEl.checked = true;
    var lockText = document.createElement('span');
    lockText.textContent = 'закрепить (цена не откатится)';
    lock.appendChild(lockEl);
    lock.appendChild(lockText);
    box.appendChild(lock);

    statusEl = document.createElement('div');
    statusEl.className = 'dxa-st';
    box.appendChild(statusEl);

    document.body.appendChild(box);
  }

  function gearBtn() {
    if (gear || !isOwner()) return;
    var host = document.querySelector('.top-actions') || document.querySelector('.topbar');
    if (!host) return;
    gear = document.createElement('div');
    gear.id = 'dxAdminBtn';
    gear.className = 'btn ghost small';
    gear.title = 'Править цену (владелец)';
    gear.textContent = '⚙ Цена';
    gear.style.cssText = 'cursor:pointer';
    gear.addEventListener('click', function (ev) {
      ev.stopPropagation();
      build();
      var on = box.style.display === 'block';
      box.style.display = on ? 'none' : 'block';
      paint();
    });
    host.appendChild(gear);
  }

  /* ---- восстановление пароля старого аккаунта (только владелец) ----
     Сервер отдаёт хеш, дальше подбор идёт здесь, в браузере: перебираем
     частые пароли и числа. Хеш слабый (djb2 + длина), поэтому это быстро. */
  function hashOf(s) {
    var h = 5381, str = 'de|' + String(s), i;
    for (i = 0; i < str.length; i++) h = (((h << 5) + h) ^ str.charCodeAt(i)) >>> 0;
    return 'h' + h.toString(36) + '.' + (str.length * 2654435761 % 4294967296).toString(36);
  }

  var DICT = ['123456', '1234567', '12345678', '123456789', '12345', '1234', 'qwerty',
    'password', 'pass', 'admin', 'knot', 'knote', 'knote6037', 'vasya', 'kent',
    '111111', '000000', '555555', '55555555', '666666', '777777', '888888', '999999',
    'qwerty123', 'abc123', 'iloveyou', 'letmein', 'secret', 'hello', 'test', 'test123'];

  function crack(hash, limit) {
    var i, s;
    for (i = 0; i < DICT.length; i++) if (hashOf(DICT[i]) === hash) return DICT[i];
    /* числа: 0…limit */
    for (i = 0; i <= limit; i++) {
      s = String(i);
      if (hashOf(s) === hash) return s;
    }
    return null;
  }

  function recover(nick) {
    var a = acc();
    if (!a || !nick) return;
    if (statusEl) statusEl.textContent = 'спрашиваю сервер…';
    deApiReq('POST', '/api/peek', { nick: basis(), pass: a.pass, target: nick }, function (r) {
      var b = r && r.body;
      if (!b || !b.ok) {
        if (statusEl) statusEl.textContent = (r && r.code === 403) ? 'сервер не пустил (нет прав)' : 'аккаунт не найден';
        return;
      }
      var hash = String(b.pass || '');
      var found = crack(hash, 3000000);
      if (statusEl) {
        statusEl.textContent = found
          ? '@' + b.nick + ' пароль: ' + found
          : '@' + b.nick + ' не подобрался (хеш ' + hash.slice(0, 10) + '…)';
      }
      try { alert(found ? 'Пароль @' + b.nick + ': ' + found : 'Не подобрал. Хеш: ' + hash); } catch (e) {}
    });
  }

  function passBtn() {
    if (!isOwner()) return;
    if (document.getElementById('dxPassBtn')) return;
    var b = document.createElement('div');
    b.id = 'dxPassBtn';
    b.className = 'btn ghost small';
    b.title = 'Восстановить пароль старого аккаунта';
    b.textContent = '🔑 Пароль';
    b.style.cssText = 'cursor:pointer';
    b.addEventListener('click', function (ev) {
      ev.stopPropagation();
      var nick = window.prompt('Ник аккаунта, чей пароль нужен (например 5):', '5');
      if (nick) recover(nick.trim());
    });
    var host = document.querySelector('.top-actions');
    if (host) host.appendChild(b);
  }

  function apply(pct) {
    var a = acc(), c = pick();
    if (busy || !a || !c) return;
    var cur = Number(c.price);
    if (!(cur > 0)) return;
    var next = cur * (1 + pct / 100);
    if (!(next > 0)) return;
    var payload = {};
    payload[c.key] = next;

    busy = true;
    if (statusEl) statusEl.textContent = 'отправляю…';

    var done = function (r) {
      busy = false;
      var body = r && r.body;
      if (r && r.code === 200 && body && body.ok) {
        var v = Number(body.set && body.set[c.key]);
        if (Number.isFinite(v) && v > 0) {
          c.price = v;
          if (typeof DX_LIVE !== 'undefined' && DX_LIVE.target) delete DX_LIVE.target[c.key];
          try { if (typeof renderAll === 'function') renderAll(); } catch (e) {}
          try { if (typeof renderModal === 'function') renderModal(); } catch (e) {}
          if (statusEl) statusEl.textContent = 'готово: ' + c.sym + ' → ' + fmtP(v);
        }
      } else if (r && r.code === 403) {
        if (statusEl) statusEl.textContent = 'сервер не пустил (нет прав владельца)';
      } else if (r && r.offline) {
        if (statusEl) statusEl.textContent = 'нет связи с сервером';
      } else {
        if (statusEl) statusEl.textContent = 'не вышло, попробуй ещё раз';
      }
      paint();
    };

    try {
      deApiReq('POST', '/api/market/set',
        { nick: basis(), pass: a.pass, prices: payload, anchor: !!(lockEl && lockEl.checked) }, done);
    } catch (e) { busy = false; if (statusEl) statusEl.textContent = 'ошибка запроса'; }
  }

  function paint() {
    gearBtn();
    passBtn();
    if (!isOwner()) return;

    var cur = window.current;
    /* открыли другой актив — панель снова показываем, даже если её закрыли */
    var key = (cur && cur.key) ? cur.key : '';
    if (key && key !== lastKey) { lastKey = key; closed = false; }

    /* панель появляется сама, как только открыт график: кнопка в шапке
       бесполезна, потому что модалка её перекрывает */
    if (cur && !closed) {
      if (!box) build();
      if (box && box.style.display !== 'block') box.style.display = 'block';
    }

    if (!box) return;
    var c = pick();
    if (!c) return;
    if (sel && !touched && sel.value !== c.key) sel.value = c.key;
    priceEl.textContent = c.sym + ' · ' + fmtP(c.price);
  }

  function boot() {
    build();
    gearBtn();
    setInterval(paint, 700);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
