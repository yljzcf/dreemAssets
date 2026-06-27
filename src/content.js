(function () {
  'use strict';

  // --- scan: detect page type + current category's variant crops (tiles) ---
  // Originals are fetched separately by the popup via the artifacts API.
  function scan() {
    var type = DreemCore.detectPageType(location.href);
    if (type === 'unknown') {
      return { ok: false, reason: 'not-target-page', pageType: type };
    }
    var pageName = DreemPageConfig.getPageName(type, document);
    var tiles = DreemPageConfig.scanTiles(document);
    var activeCategory = DreemPageConfig.activeCategoryKey(document);
    return { ok: true, pageType: type, pageName: pageName, activeCategory: activeCategory, tiles: tiles };
  }

  // --- downloading happens in the page context so blob: and signed URLs resolve ---
  function fetchBytes(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.blob();
    });
  }

  // Save a Blob via a same-origin object URL so the download filename is honored.
  function saveBlob(blob, filename) {
    var u = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = u;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { a.remove(); URL.revokeObjectURL(u); }, 1500);
  }

  // Download images one at a time (covers single + "all separately").
  function downloadEach(images) {
    var failures = [];
    var i = 0;
    function next() {
      if (i >= images.length) return Promise.resolve({ ok: true, failures: failures });
      var img = images[i++];
      return fetchBytes(img.url)
        .then(function (b) { saveBlob(b, img.filename); return new Promise(function (r) { setTimeout(r, 400); }); })
        .catch(function (e) { failures.push({ filename: img.filename, error: String(e) }); })
        .then(next);
    }
    return next();
  }

  // Fetch all images, bundle into one ZIP, and save it.
  function downloadZip(images, zipName) {
    var zip = new JSZip();
    var failures = [];
    var i = 0;
    function next() {
      if (i >= images.length) {
        return zip.generateAsync({ type: 'blob' }).then(function (blob) {
          saveBlob(blob, DreemCore.sanitizeFilename(zipName || 'dreem-images') + '.zip');
          return { ok: true, failures: failures };
        });
      }
      var img = images[i++];
      return fetchBytes(img.url)
        .then(function (b) { zip.file(img.filename, b); })
        .catch(function (e) { failures.push({ filename: img.filename, error: String(e) }); })
        .then(next);
    }
    return next();
  }

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg) return false;
    if (msg.type === 'scan') {
      try { sendResponse(scan()); } catch (e) { sendResponse({ ok: false, reason: 'scan-error', error: String(e) }); }
      return false; // synchronous
    }
    if (msg.type === 'download') {
      downloadEach(msg.images || []).then(sendResponse);
      return true; // async
    }
    if (msg.type === 'zip') {
      downloadZip(msg.images || [], msg.zipName).then(sendResponse);
      return true; // async
    }
    return false;
  });
})();
