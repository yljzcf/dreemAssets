/* global importScripts, JSZip, DreemCore */
importScripts('lib/jszip.min.js', 'lib/core.js');

function downloadOne(image) {
  return new Promise(function (resolve) {
    chrome.downloads.download({ url: image.url, filename: image.filename }, function (id) {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, filename: image.filename, error: chrome.runtime.lastError.message });
      } else {
        resolve({ ok: true, filename: image.filename, id: id });
      }
    });
  });
}

function arrayBufferToBase64(buf) {
  var bytes = new Uint8Array(buf);
  var binary = '';
  var chunk = 0x8000;
  for (var i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function makeZip(images, zipName) {
  var zip = new JSZip();
  var failures = [];
  for (var i = 0; i < images.length; i++) {
    var img = images[i];
    try {
      var resp = await fetch(img.url, { credentials: 'include' });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      var buf = await resp.arrayBuffer();
      zip.file(img.filename, buf);
    } catch (e) {
      failures.push({ filename: img.filename, error: String(e) });
    }
  }
  var base64 = await zip.generateAsync({ type: 'base64' });
  var dataUrl = 'data:application/zip;base64,' + base64;
  var name = DreemCore.sanitizeFilename(zipName || 'dreem-images') + '.zip';
  await new Promise(function (resolve) {
    chrome.downloads.download({ url: dataUrl, filename: name }, function () { resolve(); });
  });
  return { ok: true, failures: failures };
}

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg) return false;

  if (msg.type === 'download') {
    Promise.all((msg.images || []).map(downloadOne)).then(function (results) {
      sendResponse({ ok: true, results: results });
    });
    return true; // async response
  }

  if (msg.type === 'zip') {
    makeZip(msg.images || [], msg.zipName).then(function (r) {
      sendResponse(r);
    }).catch(function (e) {
      sendResponse({ ok: false, error: String(e) });
    });
    return true; // async response
  }

  return false;
});
