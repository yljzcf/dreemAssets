(function () {
  'use strict';

  // --- scan: detect page type and extract fixed-position image descriptors ---
  function scan() {
    var type = DreemCore.detectPageType(location.href);
    if (type === 'unknown') {
      return { ok: false, reason: 'not-target-page', pageType: type };
    }
    var rules = DreemPageConfig.getRules(type);
    var pageName = DreemPageConfig.getPageName(type, document);
    var images = DreemCore.extractImages(document, rules, { pageName: pageName });
    var derived = DreemPageConfig.getDerived ? DreemPageConfig.getDerived(type, document, pageName) : [];
    images = derived.concat(images); // derived items (e.g. source sheet) come first
    try { console.log('[Dreem下载] 页面类型=' + type + ' 提取到 ' + images.length + ' 张:', images); } catch (e) {}
    return { ok: true, pageType: type, pageName: pageName, images: images };
  }

  // --- downloading happens in the page context so blob: URLs resolve ---
  function fetchBytes(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.blob();
    });
  }

  // Resolve a descriptor to a Blob: special kinds via config, otherwise fetch its url.
  function getBlob(img) {
    if (img.kind && DreemPageConfig.resolveSpecial) {
      return DreemPageConfig.resolveSpecial(img, document).then(function (b) {
        if (!b) throw new Error('无法解析 ' + (img.label || img.key));
        return b;
      });
    }
    return fetchBytes(img.url);
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
      return getBlob(img)
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
      return getBlob(img)
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
