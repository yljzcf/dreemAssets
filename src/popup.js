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
      var key = cat ? cat.key : 'others';
      (byCat[key] = byCat[key] || []).push(it);
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

  function renderItem(img) {
    var li = document.createElement('li');
    li.className = 'item';
    var thumb = document.createElement('img');
    thumb.className = 'thumb';
    thumb.src = img.url;
    thumb.alt = img.label;
    thumb.onerror = function () { thumb.style.visibility = 'hidden'; };
    var meta = document.createElement('div');
    meta.className = 'meta';
    meta.innerHTML = '<div class="label"></div><div class="sub"></div>';
    meta.querySelector('.label').textContent = img.label;
    meta.querySelector('.sub').textContent = img.filename;
    var btn = document.createElement('button');
    btn.className = 'btn';
    btn.textContent = '下载';
    btn.addEventListener('click', function () {
      btn.disabled = true;
      sendToContent({ type: 'download', images: [img] }).then(function () { btn.textContent = '已下载'; });
    });
    li.appendChild(thumb); li.appendChild(meta); li.appendChild(btn);
    return li;
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
    var items = [];
    if (selectedKey === mappedActive) {
      // active category: interleave each original with its variant group (主图 j → 变体 j.x)
      origs.forEach(function (o, j) {
        items.push(o);
        tiles.forEach(function (t) { if (t.group === j) items.push(t); });
      });
      tiles.forEach(function (t) { if (t.group >= origs.length) items.push(t); });
    } else {
      items = origs.slice();
    }
    if (!items.length) {
      var d = document.createElement('div'); d.className = 'status';
      d.textContent = (selectedKey === mappedActive) ? '该分类暂无图片' : '该分类暂无原图（切到此分类的网页标签可看变体）';
      listEl.appendChild(d);
      return;
    }
    items.forEach(function (img) { listEl.appendChild(renderItem(img)); });
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
