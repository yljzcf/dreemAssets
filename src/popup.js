(function () {
  'use strict';

  var btnInfo = document.getElementById('btnInfo');
  var btnAssets = document.getElementById('btnAssets');
  var tabsEl = document.getElementById('tabs');
  var statusEl = document.getElementById('status');
  var listEl = document.getElementById('list');

  var updateStatusEl = document.getElementById('updateStatus');
  var updateEmojiEl = document.getElementById('updateEmoji');
  var updateTextEl = document.getElementById('updateText');
  var ghLinkEl = document.getElementById('ghLink');

  var CATS = DreemPageConfig.CATEGORIES;

  var currentTabId = null;
  var pageName = 'dreem';
  var activeCatKey = null;       // webpage's active category key (e.g. 'outfits')
  var groups = {};               // category.key -> { category, originals:[desc] }
  var tiles = [];                // current category's variant descriptors
  var allOriginals = [];         // flat list for the ZIP
  var selectedKey = null;        // selected popup tab (category key)
  var pageInfo = null;           // scanned text panel { name, tagline, sections } (character/location)

  // Injected into the PAGE main world: Clerk token + artifacts API → all originals.
  function fetchOriginalsInPage() {
    return (async function () {
      try {
        var mc = location.pathname.match(/\/worlds\/([^/]+)\/characters\/([^/]+)/);
        var ml = location.pathname.match(/\/worlds\/([^/]+)\/locations\/([^/]+)/);
        var wid, scope;
        if (mc) { wid = mc[1]; scope = { kind: 'character', id: mc[2] }; }
        else if (ml) { wid = ml[1]; scope = { kind: 'location', id: ml[2] }; }
        else return { ok: false, error: 'unsupported-page' };
        if (!(window.Clerk && window.Clerk.session)) return { ok: false, error: 'clerk-unavailable' };
        var token = await window.Clerk.session.getToken();
        if (!token) return { ok: false, error: 'no-token' };
        var resp = await fetch('https://api.dreem-world.ai/api/worlds/' + wid + '/artifacts/query', {
          method: 'POST', credentials: 'include',
          headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + token },
          body: JSON.stringify({ scope: scope })
        });
        if (!resp.ok) return { ok: false, error: 'http-' + resp.status };
        var j = await resp.json();
        var items = (j && j.data && j.data.items) || [];
        return {
          ok: true,
          items: items.filter(function (it) { return it && it.presignedUrl; }).map(function (it) {
            return { type: it.type, sortOrder: it.sortOrder || 0, createdAt: it.createdAt || '', id: it.id || '', url: it.presignedUrl };
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

  function renderUpdate(info) {
    var d = DreemUpdateCheck.describe(info);
    updateEmojiEl.textContent = d.emoji;
    updateTextEl.textContent = d.text;
    if (d.title) updateStatusEl.setAttribute('title', d.title);
    else updateStatusEl.removeAttribute('title');
    updateStatusEl.classList.toggle('has-update', d.blink);
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

  // The scanned text panel, ready for export as "{pageName}_info.md".
  function infoHasContent() { return !!(pageInfo && pageInfo.sections && pageInfo.sections.length); }
  function infoFilename() { return DreemCore.buildFilename({ pageName: pageName, label: 'info', ext: 'md' }); }

  // Creation order: sortOrder, then createdAt, then id (ascending).
  function byCreated(a, b) {
    if ((a.sortOrder || 0) !== (b.sortOrder || 0)) return (a.sortOrder || 0) - (b.sortOrder || 0);
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
  }

  // Collapse originals that resolve to the same underlying file (same path, different signed
  // query): dreem can return duplicate artifact records pointing to one image (e.g. a
  // regenerated face turnaround), which would otherwise show as identical 主图 1 / 主图 2.
  function dedupeByFile(items) {
    var seen = {}, out = [];
    (items || []).forEach(function (it) {
      var key = DreemCore.urlPath(it.url);
      if (key) { if (seen[key]) return; seen[key] = true; }
      out.push(it);
    });
    return out;
  }

  // Location pages are flat: group originals by type (fullshot, angles, …), number duplicates.
  function buildLocationList(items) {
    var byType = {};
    items.forEach(function (it) { (byType[it.type] = byType[it.type] || []).push(it); });
    var order = ['location_fullshot', 'location_angles'];
    var types = Object.keys(byType).sort(function (a, b) {
      var ia = order.indexOf(a), ib = order.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    allOriginals = [];
    types.forEach(function (type) {
      var arr = dedupeByFile(byType[type].slice().sort(byCreated));
      var key = DreemPageConfig.locationKey(type);
      var label = DreemPageConfig.locationLabel(type);
      var multi = arr.length > 1;
      var bucket = (type === 'location_fullshot') ? 'full' : 'grid'; // full shot full-width; angles in a 2/3 grid
      arr.forEach(function (it, i) {
        allOriginals.push({
          url: it.url, kind: 'original', bucket: bucket,
          label: multi ? (label + ' ' + (i + 1)) : label,
          filename: fileName(multi ? (key + '_' + (i + 1)) : key, it.url)
        });
      });
    });
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
      var arr = dedupeByFile((byCat[cat.key] || []).slice().sort(byCreated)); // creation order → matches "Outfit 1,2,..."
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
      sendToContent({ type: 'download', images: [descriptor] }).then(function (resp) {
        im.style.opacity = '';
        var failed = !resp || (resp.failures && resp.failures.length);
        im.style.outline = '2px solid ' + (failed ? '#c0392b' : '#16a34a');
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

  // A justified row: all images share one computed height so their natural widths
  // (width:auto) sum to the row width. Works for any orientation; never letterboxes.
  function appendJustifiedRow(items, rowClass, imgClass) {
    var row = document.createElement('div');
    row.className = rowClass;
    var imgs = items.map(function (v) {
      var im = clickableImg(v, imgClass);
      im.style.width = 'auto';
      im.style.height = '130px'; // provisional until laid out
      im._knownAspect = (v.width && v.height) ? (v.width / v.height) : 0; // variants know dims; location images don't
      row.appendChild(im);
      return im;
    });
    listEl.appendChild(row);

    // Compute one row height so the images' natural widths fill the row exactly.
    // Prefer each image's real naturalWidth/Height; fall back to known dims, then square.
    function layout() {
      var gap = 8;
      var contentW = (listEl.clientWidth || 400) - 22;
      var sum = 0;
      imgs.forEach(function (im) {
        sum += (im.naturalWidth && im.naturalHeight) ? (im.naturalWidth / im.naturalHeight) : (im._knownAspect || 1);
      });
      var H = sum > 0 ? ((contentW - (imgs.length - 1) * gap) / sum) : 150;
      if (imgs.length === 1) H = Math.min(H, 240);
      H = Math.min(H, 360);
      imgs.forEach(function (im) { im.style.height = Math.round(H) + 'px'; });
    }

    layout();
    imgs.forEach(function (im) { if (!im.complete) im.addEventListener('load', layout); });
  }

  // Split a variant group into balanced rows (max 8 per row) so large groups (e.g. 12) wrap.
  function appendVariantRow(vs) {
    var maxPer = 8;
    if (vs.length <= maxPer) { appendJustifiedRow(vs, 'variant-row', 'variant-img'); return; }
    var nRows = Math.ceil(vs.length / maxPer);
    var per = Math.ceil(vs.length / nRows);
    for (var i = 0; i < vs.length; i += per) appendJustifiedRow(vs.slice(i, i + per), 'variant-row', 'variant-img');
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
      appendJustifiedRow(origs.slice(idx, idx + size), 'grid-row', 'grid-img');
      idx += size;
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
    renderUpdate(DreemUpdateCheck.getCached());
    DreemUpdateCheck.check().then(renderUpdate);

    var tabs = await new Promise(function (r) { chrome.tabs.query({ active: true, currentWindow: true }, r); });
    var tab = tabs && tabs[0];
    if (!tab) { setStatus('无法获取当前标签页', true); return; }
    currentTabId = tab.id;

    var scan = await sendToContent({ type: 'scan' });
    if (!scan) {
      setStatus('请在 dreem-world 打开本扩展', true);
      return;
    }
    if (!scan.ok || (scan.pageType !== 'character' && scan.pageType !== 'location')) {
      setStatus('请在角色页或场景页打开本扩展。', true);
      return;
    }
    pageName = scan.pageName || 'dreem';
    pageInfo = scan.info || null;
    if (pageInfo) pageInfo.name = pageInfo.name || pageName;
    // The info .md is independent of images, so reveal its button as soon as we have text.
    btnInfo.hidden = !infoHasContent();

    // Location pages: flat list of originals (full shot + angles), no tabs/variants.
    if (scan.pageType === 'location') {
      setStatus('正在获取场景图…', false);
      var locRes = null;
      try {
        var injL = await chrome.scripting.executeScript({ target: { tabId: currentTabId }, world: 'MAIN', func: fetchOriginalsInPage });
        locRes = injL && injL[0] && injL[0].result;
      } catch (e) { locRes = { ok: false, error: String(e).slice(0, 140) }; }
      buildLocationList(locRes && locRes.ok ? locRes.items : []);
      if (!allOriginals.length) {
        setStatus('未找到场景图' + (locRes && !locRes.ok ? ('（获取失败：' + locRes.error + '）') : '') + '。', true);
        return;
      }
      setStatus('场景图 ' + allOriginals.length + ' 张' + (locRes && !locRes.ok ? ('（部分失败：' + locRes.error + '）') : ''), !!(locRes && !locRes.ok));
      btnAssets.hidden = false;
      tabsEl.hidden = true;
      listEl.innerHTML = '';
      allOriginals.filter(function (o) { return o.bucket === 'full'; }).forEach(appendOriginal);
      var locGrid = allOriginals.filter(function (o) { return o.bucket !== 'full'; });
      if (locGrid.length) appendOthersGrid(locGrid);
      var lhint = document.createElement('div'); lhint.className = 'hint'; lhint.textContent = '点击单张图片即可按需下载';
      listEl.appendChild(lhint);
      return;
    }

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
    var texts = infoHasContent() ? [{ filename: infoFilename(), content: DreemCore.buildInfoMarkdown(pageInfo) }] : [];
    sendToContent({ type: 'zip', images: allOriginals, zipName: pageName + '_assets', texts: texts }).then(function (r) {
      btnAssets.textContent = (r && r.failures && r.failures.length) ? ('完成（' + r.failures.length + ' 失败）') : '已打包';
      btnAssets.disabled = false;
      setTimeout(function () { btnAssets.textContent = orig; }, 2500);
    });
  });

  btnInfo.addEventListener('click', function () {
    if (!infoHasContent()) return;
    btnInfo.disabled = true;
    var orig = btnInfo.textContent;
    btnInfo.textContent = '生成中…';
    sendToContent({ type: 'saveText', filename: infoFilename(), content: DreemCore.buildInfoMarkdown(pageInfo) }).then(function (r) {
      btnInfo.textContent = (r && r.ok) ? '已保存' : '失败';
      btnInfo.disabled = false;
      setTimeout(function () { btnInfo.textContent = orig; }, 2000);
    });
  });

  function openRepo() { chrome.tabs.create({ url: DreemUpdateCheck.repoUrl() }); }
  ghLinkEl.addEventListener('click', openRepo);
  ghLinkEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openRepo(); }
  });

  init();
})();
