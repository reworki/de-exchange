/* Local illustrative media. Catalogue IDs are also used by existing ownership records. */
var MarketGallery = (function () {
  var records = typeof MARKET_GALLERY_DATA === 'object' && MARKET_GALLERY_DATA || {};
  var activeId = '';
  var previousFocus;
  var missing = new Set();
  var roles = { exterior: 'Экстерьер', interior: 'Интерьер', detail: 'Деталь' };

  function usable(id) {
    if (!Array.isArray(records[id])) return [];
    return records[id].filter(function (photo) {
      return photo && /^assets\/[\w./-]+\.(?:jpe?g|webp|png|avif)$/i.test(photo.f)
        && !photo.f.includes('..');
    });
  }

  function showMissing(image) {
    missing.add(image.getAttribute('src'));
    image.hidden = true;
  }

  function cover(id) {
    var first = usable(id)[0];
    var fallback = '<span class="acover-empty">Изображение недоступно</span>';
    if (!first || missing.has(first.f)) return fallback;
    var label = first.role === 'exterior' || first.illustration ? '<span class="acover-note">Иллюстрация</span>' : '';
    return fallback + '<img alt="" src="' + first.f + '" loading="lazy" onerror="MarketGallery.showMissing(this)">' + label;
  }

  function link(container, label, url) {
    if (url && /^https?:\/\//i.test(url)) {
      var a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = label;
      container.appendChild(a);
    } else {
      container.appendChild(document.createTextNode(label));
    }
  }

  function select(index) {
    var photos = usable(activeId);
    var photo = photos[index];
    var image = document.getElementById('amImg');
    var empty = document.getElementById('amEmpty');
    var credits = document.getElementById('amCredits');
    var thumbs = document.getElementById('amThumbs');
    Array.from(thumbs.children).forEach(function (button, i) {
      button.setAttribute('aria-pressed', String(i === index));
    });
    image.onerror = null;
    image.hidden = true;
    empty.hidden = false;
    credits.replaceChildren();
    if (!photo || missing.has(photo.f)) {
      image.removeAttribute('src');
      return;
    }
    image.onerror = function () {
      showMissing(image);
      empty.hidden = false;
      credits.replaceChildren();
    };
    image.alt = photo.t || ASSET_BY[activeId].name;
    image.hidden = false;
    empty.hidden = true;
    image.src = photo.f;
    var role = roles[photo.role];
    credits.appendChild(document.createTextNode(role ? role + ' · Иллюстрация. ' : 'Иллюстрация. '));
    link(credits, photo.t || 'Источник', photo.p);
    if (photo.a) credits.appendChild(document.createTextNode(' · ' + photo.a));
    if (photo.l) {
      credits.appendChild(document.createTextNode(' · '));
      link(credits, photo.l, photo.licenseUrl);
    }
  }

  function display(id) {
    activeId = id;
    var photos = usable(id);
    var thumbs = document.getElementById('amThumbs');
    thumbs.replaceChildren();
    if (photos.length > 1) photos.forEach(function (photo, index) {
      var button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-label', (roles[photo.role] || 'Фото') + ', ' + (index + 1) + ' из ' + photos.length);
      var image = document.createElement('img');
      image.alt = '';
      image.onerror = function () {
        missing.add(photo.f);
        button.textContent = roles[photo.role] || 'Нет изображения';
        button.classList.add('amthumb-empty');
      };
      image.src = photo.f;
      button.appendChild(image);
      button.addEventListener('click', function () { select(index); });
      thumbs.appendChild(button);
    });
    select(0);
  }

  return {
    cover: cover,
    showMissing: showMissing,
    open: function (id) {
      previousFocus = document.activeElement;
      display(id);
      requestAnimationFrame(function () { if (activeId === id) document.querySelector('#assetModal .amclose').focus(); });
    },
    close: function () {
      var trigger = previousFocus;
      if (!trigger || trigger === document.body || !trigger.isConnected) {
        trigger = Array.from(document.querySelectorAll('button[data-asset-picture]')).find(function (button) {
          return button.dataset.assetPicture === activeId && button.getClientRects().length;
        });
      }
      activeId = '';
      previousFocus = null;
      if (trigger) trigger.focus({ preventScroll: true });
    }
  };
})();
