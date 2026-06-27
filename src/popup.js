(function () {
  'use strict';

  var pageTypeEl = document.getElementById('pageType');
  var btnAssets = document.getElementById('btnAssets');
  var tabsEl = document.getElementById('tabs');
  var statusEl = document.getElementById('status');
  var listEl = document.getElementById('list');

  var CATS = DreemPageConfig.CATEGORIES;
  var TYPE_LABEL = { character: '角色页', location: '场景页', unknown: '非目标页' };

  var currentTabId = null;
  var pageName = 'dreem';
  var activeCatKey = null;       // webpage's active category key (e.g. 'outfits')
  var groups = {};               // category.key -> { category, originals:[desc] }
  var tiles = [];                // current category's variant descriptors
  var allOriginals = [];         // flat list for the ZIP
  var selectedKey = null;        // selected popup tab (category key)

  // Injected into the PAGE main world: Clerk token + artifacts API → all originals.
  function fetchOriginalsInPage() {
    return (async function () {
      try {
        var m = location.pathname.match(/\/worlds\/([^/]+)\/characters\/([^/]+)/);
        if (!m) return { ok: false, error: 'not-character-page' };
        var wid = m[1], cid = m[2];
        if (!(window.Clerk && window.Clerk.session)) return { ok: false, error: 'clerk-unavailable' };
        var token = await window.Clerk.session.getToken();
        if (!token) return { ok: false, error: 'no-token' };
        var resp = await fetch('https://api.dreem-world.ai/api/worlds/' + wid + '/artifacts/query', {
          method: 'POST', credentials: 'include',
          headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + token },
          body: JSON.stringify({ scope: { kind: 'character', id: cid } })
        });
        if (!resp.ok) return { ok: false, error: 'http-' + resp.status };
        var j = await resp.json();
        var items = (j && j.data && j.data.items) || [];
        return {
          ok: true,
          items: items.filter(function (it) { return it && it.presignedUrl; }).map(function (it) {
            return { type: it.type, sortOrder: it.sortOrder || 0, url: it.presignedUrl };
          })
        };
      } catch (e) { return { ok: false, error: String(e).slice(0, 140) }; }
    })();
  }

  function setStatus(text, isError) {
    statusEl.textContent = text || '';
    statusEl.className = 'status' + (isError ? ' error' : '');
    statusEl.hidden = !text;
  }

  function sendToContent(message) {
    return new Promise(function (resolve) {
      if (currentTabId == null) { resolve(null); return; }
      chrome.tabs.sendMessage(currentTabId, message, function (resp) {
        resolve(chrome.runtime.lastError ? null : resp);
      });
    });
  }

  function fileName(suffix, url) {
    return DreemCore.buildFilename({ pageName: pageName, label: suffix, index: 0, ext: DreemCore.extFromUrl(url || '') });
  }

  // Group API originals into the 5 categories and build descriptors + filenames.
  function buildGroups(items) {
    groups = {};
    allOriginals = [];
    CATS.forEach(function (cat) { groups[cat.key] = { category: cat, originals: [] }; });
    var byCat = {};
    items.forEach(function (it) {
      var cat = DreemPageConfig.categoryForType(it.type);
      if (!cat) { try { console.warn('[Dreem下载] 跳过未归类 artifact 类型:', it.type); } catch (e) {} return; }
      (byCat[cat.key] = byCat[cat.key] || []).push(it);
    });
    CATS.forEach(function (cat) {
      var arr = (byCat[cat.key] || []).slice().sort(function (a, b) { return (a.sortOrder || 0) - (b.sortOrder || 0); });
      var multi = arr.length > 1;
      arr.forEach(function (it, i) {
        var suffix = multi ? (cat.key + '_' + (i + 1) + '_full') : (cat.key + '_full');
        var d = {
          url: it.url, kind: 'original', categoryKey: cat.key,
          label: multi ? ('主图 ' + (i + 1)) : '主图',
          filename: fileName(suffix, it.url)
        };
        groups[cat.key].originals.push(d);
        allOriginals.push(d);
      });
    });
  }

  // Build variant descriptors from the DOM tiles, grouped by outfit (tile grid).
  // multiOriginal → filenames/labels carry the outfit index (e.g. Faye_outfit_1_3).
  function buildTiles(scanTiles, categoryKey, multiOriginal) {
    var key = categoryKey || 'var';
    var perGroup = {};
    tiles = (scanTiles || []).map(function (t) {
      var v = (perGroup[t.group] = (perGroup[t.group] || 0) + 1); // 1-based within its group
      var suffix = multiOriginal ? (key + '_' + (t.group + 1) + '_' + v) : (key + '_' + v);
      return {
        url: t.url, kind: 'variant', categoryKey: key, group: t.group,
        label: multiOriginal ? ('变体 ' + (t.group + 1) + '.' + v) : ('变体 ' + v),
        width: t.width, height: t.height,
        filename: fileName(suffix, t.url)
      };
    });
  }

  // An image that downloads its descriptor when clicked (no buttons/labels).
  function clickableImg(descriptor, cls) {
    var im = document.createElement('img');
    im.className = cls;
    im.src = descriptor.url;
    im.alt = descriptor.label;
    im.title = descriptor.filename;
    im.onerror = function () { im.style.visibility = 'hidden'; };
    im.addEventListener('click', function () {
      im.style.opacity = '.45';
      sendToContent({ type: 'download', images: [descriptor] }).then(function () {
        im.style.opacity = '';
        im.style.outline = '2px solid #16a34a';
        setTimeout(function () { im.style.outline = ''; }, 1200);
      });
    });
    return im;
  }

  function appendOriginal(o) {
    var wrap = document.createElement('div');
    wrap.className = 'orig';
    wrap.appendChild(clickableImg(o, 'orig-img'));
    listEl.appendChild(wrap);
  }

  function appendVariantRow(vs) {
    var row = document.createElement('div');
    row.className = 'variant-row';
    vs.forEach(function (v) {
      // justified row: cell width ∝ image aspect → equal heights, fills the row, no crop
      var cell = document.createElement('div');
      cell.className = 'variant-cell';
      var aspect = (v.width && v.height) ? (v.width / v.height) : 1;
      cell.style.flexGrow = String(aspect);
      cell.appendChild(clickableImg(v, 'variant-img'));
      row.appendChild(cell);
    });
    listEl.appendChild(row);
  }

  // Others layout: 2 per row, but an odd count >= 3 puts 3 in the last row.
  function othersRowSizes(n) {
    if (n <= 0) return [];
    if (n % 2 === 1 && n >= 3) {
      var rows = [];
      for (var i = 0; i < (n - 3) / 2; i++) rows.push(2);
      rows.push(3);
      return rows;
    }
    var out = [], rem = n;
    while (rem > 0) { out.push(Math.min(2, rem)); rem -= 2; }
    return out;
  }

  function appendOthersGrid(origs) {
    var sizes = othersRowSizes(origs.length);
    var idx = 0;
    sizes.forEach(function (size) {
      var row = document.createElement('div');
      row.className = 'grid-row';
      for (var k = 0; k < size && idx < origs.length; k++) { row.appendChild(clickableImg(origs[idx++], 'grid-img')); }
      listEl.appendChild(row);
    });
  }

  function activeCategoryKeyMapped() {
    var cat = activeCatKey ? DreemPageConfig.categoryByTabKey(activeCatKey) : null;
    return cat ? cat.key : null;
  }

  function render() {
    // tabs
    tabsEl.innerHTML = '';
    var mappedActive = activeCategoryKeyMapped();
    CATS.forEach(function (cat) {
      var n = groups[cat.key] ? groups[cat.key].originals.length : 0;
      var isActiveCat = (cat.key === mappedActive);
      var btn = document.createElement('button');
      btn.className = 'tab' + (cat.key === selectedKey ? ' active' : '');
      var count = n + (isActiveCat && tiles.length ? ('+' + tiles.length) : '');
      btn.innerHTML = '';
      btn.appendChild(document.createTextNode(cat.label));
      var c = document.createElement('span'); c.className = 'count'; c.textContent = count; btn.appendChild(c);
      btn.addEventListener('click', function () { selectedKey = cat.key; render(); });
      tabsEl.appendChild(btn);
    });

    // content for selected tab
    listEl.innerHTML = '';
    var g = groups[selectedKey] || { originals: [] };
    var origs = g.originals;
    var isActive = (selectedKey === mappedActive);
    var hasAny = origs.length || (isActive && tiles.length);
    if (!hasAny) {
      var d = document.createElement('div'); d.className = 'status';
      d.textContent = isActive ? '该分类暂无图片' : '该分类暂无原图（切到此分类的网页标签可看变体）';
      listEl.appendChild(d);
      return;
    }
    if (selectedKey === 'others') {
      // Others: 2/3-per-row grid of originals
      appendOthersGrid(origs);
      if (isActive) {
        var byGroup = {};
        tiles.forEach(function (t) { (byGroup[t.group] = byGroup[t.group] || []).push(t); });
        Object.keys(byGroup).forEach(function (k) { appendVariantRow(byGroup[k]); });
      }
    } else {
      // each original (big, full-width), and for the active category its variants below (one row)
      origs.forEach(function (o, j) {
        appendOriginal(o);
        if (isActive) {
          var vs = tiles.filter(function (t) { return t.group === j; });
          if (vs.length) appendVariantRow(vs);
        }
      });
      if (isActive) {
        var leftover = tiles.filter(function (t) { return t.group >= origs.length; });
        if (leftover.length) appendVariantRow(leftover);
      }
    }
    var hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = '点击单张图片即可按需下载';
    listEl.appendChild(hint);
  }

  async function init() {
    var tabs = await new Promise(function (r) { chrome.tabs.query({ active: true, currentWindow: true }, r); });
    var tab = tabs && tabs[0];
    if (!tab) { setStatus('无法获取当前标签页', true); return; }
    currentTabId = tab.id;

    var scan = await sendToContent({ type: 'scan' });
    if (!scan) {
      pageTypeEl.textContent = '非目标页';
      setStatus('请在 dreem-world 的角色页打开本扩展（若刚装好扩展，请先刷新页面）。', true);
      return;
    }
    pageTypeEl.textContent = TYPE_LABEL[scan.pageType] || '非目标页';
    if (!scan.ok || scan.pageType !== 'character') {
      setStatus(scan.pageType === 'location' ? '场景页暂未支持。' : '请在角色页打开本扩展。', true);
      return;
    }
    pageName = scan.pageName || 'dreem';
    activeCatKey = scan.activeCategory || null;
    var scanTilesData = scan.tiles || [];

    setStatus('正在获取原图…', false);
    var originals = null;
    try {
      var injected = await chrome.scripting.executeScript({ target: { tabId: currentTabId }, world: 'MAIN', func: fetchOriginalsInPage });
      originals = injected && injected[0] && injected[0].result;
    } catch (e) { originals = { ok: false, error: String(e).slice(0, 140) }; }

    buildGroups(originals && originals.ok ? originals.items : []);

    // Variants belong to the page's active category; multi-original → outfit-indexed names.
    var mappedActiveKey = activeCategoryKeyMapped();
    var activeOriginalCount = (mappedActiveKey && groups[mappedActiveKey]) ? groups[mappedActiveKey].originals.length : 0;
    buildTiles(scanTilesData, mappedActiveKey || activeCatKey, activeOriginalCount > 1);

    if (!allOriginals.length && !tiles.length) {
      setStatus('未找到任何图片' + (originals && !originals.ok ? ('（原图获取失败：' + originals.error + '）') : '') + '。', true);
      return;
    }

    var note = '原图 ' + allOriginals.length + ' 张';
    var mapped = activeCategoryKeyMapped();
    if (mapped) note += ' · 当前分类(' + mapped + ')变体 ' + tiles.length + ' 张';
    if (originals && !originals.ok) note += '（原图获取失败：' + originals.error + '）';
    setStatus(note, !!(originals && !originals.ok));

    selectedKey = mapped || (allOriginals[0] ? allOriginals[0].categoryKey : CATS[0].key);
    btnAssets.hidden = !allOriginals.length;
    tabsEl.hidden = false;
    render();
  }

  btnAssets.addEventListener('click', function () {
    if (!allOriginals.length) return;
    btnAssets.disabled = true;
    var orig = btnAssets.textContent;
    btnAssets.textContent = '打包中…';
    sendToContent({ type: 'zip', images: allOriginals, zipName: pageName + '_assets' }).then(function (r) {
      btnAssets.textContent = (r && r.failures && r.failures.length) ? ('完成（' + r.failures.length + ' 失败）') : '已打包';
      btnAssets.disabled = false;
      setTimeout(function () { btnAssets.textContent = orig; }, 2500);
    });
  });

  init();
})();
