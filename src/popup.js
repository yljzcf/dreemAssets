(function () {
  'use strict';

  var statusEl = document.getElementById('status');
  var listEl = document.getElementById('list');
  var topActions = document.getElementById('topActions');
  var pageTypeEl = document.getElementById('pageType');
  var btnZip = document.getElementById('btnZip'); // 下载原图 ZIP
  var btnAll = document.getElementById('btnAll'); // 原图+裁切 ZIP

  var currentTabId = null;
  var currentPageName = 'dreem';
  var originalDescriptors = []; // from artifacts API
  var tileDescriptors = [];     // from DOM (current category)

  var TYPE_LABEL = { character: '角色页', location: '场景页', unknown: '非目标页' };

  // Injected into the PAGE main world: read the Clerk token and query the
  // artifacts API for every original image of the current character.
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
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + token },
          body: JSON.stringify({ scope: { kind: 'character', id: cid } })
        });
        if (!resp.ok) return { ok: false, error: 'http-' + resp.status };
        var j = await resp.json();
        var items = (j && j.data && j.data.items) || [];
        return {
          ok: true,
          items: items.filter(function (it) { return it && it.presignedUrl; }).map(function (it) {
            return {
              type: it.type,
              isPrimary: !!it.isPrimary,
              sortOrder: it.sortOrder || 0,
              variantName: (it.data && typeof it.data === 'object' && it.data.variantName) || null,
              url: it.presignedUrl
            };
          })
        };
      } catch (e) {
        return { ok: false, error: String(e).slice(0, 140) };
      }
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

  // Build original-image descriptors, labeling + numbering duplicates per category.
  function buildOriginalDescriptors(items, pageName) {
    var counts = {};
    items.forEach(function (it) { counts[it.type] = (counts[it.type] || 0) + 1; });
    var sorted = items.slice().sort(function (a, b) {
      if (a.type < b.type) return -1;
      if (a.type > b.type) return 1;
      return (a.sortOrder || 0) - (b.sortOrder || 0);
    });
    var seen = {};
    return sorted.map(function (it) {
      var base = DreemPageConfig.artifactLabel(it.type);
      var multi = counts[it.type] > 1;
      var n = (seen[it.type] = (seen[it.type] || 0) + 1);
      var disp = multi ? (base + ' ' + n) : base;
      var fileLabel = multi ? (base + '_' + n) : base;
      return {
        url: it.url,
        label: disp,
        filename: DreemCore.buildFilename({ pageName: pageName, label: fileLabel, index: n - 1, ext: DreemCore.extFromUrl(it.url) }),
        kind: 'original'
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
    meta.innerHTML = '<div class="label"></div><div class="dim"></div>';
    meta.querySelector('.label').textContent = img.label;
    meta.querySelector('.dim').textContent = (img.kind === 'original')
      ? '原图'
      : ((img.width && img.height) ? (img.width + '×' + img.height) : '变体');

    var btn = document.createElement('button');
    btn.className = 'btn';
    btn.textContent = '下载';
    btn.addEventListener('click', function () {
      btn.disabled = true;
      sendToContent({ type: 'download', images: [img] }).then(function () { btn.textContent = '已下载'; });
    });

    li.appendChild(thumb);
    li.appendChild(meta);
    li.appendChild(btn);
    return li;
  }

  function renderList() {
    listEl.innerHTML = '';
    originalDescriptors.forEach(function (img) { listEl.appendChild(renderItem(img)); });
    tileDescriptors.forEach(function (img) { listEl.appendChild(renderItem(img)); });
  }

  function zipDownload(images, btn) {
    if (!images.length) return;
    btn.disabled = true;
    var orig = btn.textContent;
    btn.textContent = '打包中…';
    sendToContent({ type: 'zip', images: images, zipName: currentPageName }).then(function (r) {
      btn.textContent = (r && r.failures && r.failures.length) ? ('完成（' + r.failures.length + ' 失败）') : '已打包';
      btn.disabled = false;
      setTimeout(function () { btn.textContent = orig; }, 2500);
    });
  }

  async function init() {
    var tabs = await new Promise(function (r) { chrome.tabs.query({ active: true, currentWindow: true }, r); });
    var tab = tabs && tabs[0];
    if (!tab) { setStatus('无法获取当前标签页', true); return; }
    currentTabId = tab.id;

    // 1) current category's variant crops + page info (content script)
    var scanResp = await sendToContent({ type: 'scan' });
    if (!scanResp) {
      pageTypeEl.textContent = '非目标页';
      setStatus('请在 dreem-world 的角色页打开本扩展（若刚装好扩展，请先刷新页面）。', true);
      return;
    }
    pageTypeEl.textContent = TYPE_LABEL[scanResp.pageType] || '非目标页';
    if (!scanResp.ok) { setStatus('请在角色页打开本扩展。', true); return; }
    currentPageName = scanResp.pageName || 'dreem';
    tileDescriptors = scanResp.tiles || [];

    // 2) all originals via the artifacts API (run in the page's main world)
    setStatus('正在获取原图…', false);
    var originals = null;
    try {
      var injected = await chrome.scripting.executeScript({ target: { tabId: currentTabId }, world: 'MAIN', func: fetchOriginalsInPage });
      originals = injected && injected[0] && injected[0].result;
    } catch (e) {
      originals = { ok: false, error: String(e).slice(0, 140) };
    }
    if (originals && originals.ok) {
      originalDescriptors = buildOriginalDescriptors(originals.items || [], currentPageName);
    } else {
      originalDescriptors = [];
      try { console.warn('[Dreem下载] 获取原图失败:', originals && originals.error); } catch (e) {}
    }

    if (!originalDescriptors.length && !tileDescriptors.length) {
      setStatus('未找到任何图片' + (originals && !originals.ok ? ('（原图获取失败：' + originals.error + '）') : '') + '。', true);
      return;
    }

    var note = '原图 ' + originalDescriptors.length + ' 张 · 当前分类变体 ' + tileDescriptors.length + ' 张';
    if (originals && !originals.ok) note += '（原图获取失败：' + originals.error + '）';
    setStatus(note, !!(originals && !originals.ok));
    topActions.hidden = false;
    renderList();
  }

  btnZip.addEventListener('click', function () { zipDownload(originalDescriptors, btnZip); });
  btnAll.addEventListener('click', function () { zipDownload(originalDescriptors.concat(tileDescriptors), btnAll); });

  init();
})();
