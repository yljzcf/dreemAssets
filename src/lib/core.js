(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();        // Node (tests, CommonJS)
  } else {
    root.DreemCore = factory();        // browser page / content script / service worker
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function detectPageType(url) {
    let pathname;
    try {
      pathname = new URL(url).pathname;
    } catch (e) {
      return 'unknown';
    }
    if (/\/worlds\/[^/]+\/characters\/[^/]+/.test(pathname)) return 'character';
    if (/\/worlds\/[^/]+\/locations\/[^/]+/.test(pathname)) return 'location';
    return 'unknown';
  }

  function sanitizeFilename(name) {
    var cleaned = String(name == null ? '' : name)
      .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^[.\s]+|[.\s]+$/g, '');
    return cleaned || 'image';
  }

  function extFromUrl(url) {
    try {
      var path = new URL(url, 'https://x.invalid').pathname;
      var m = path.match(/\.([a-zA-Z0-9]{1,5})$/);
      return m ? m[1].toLowerCase() : 'png';
    } catch (e) {
      return 'png';
    }
  }

  function buildFilename(ctx) {
    ctx = ctx || {};
    var base = sanitizeFilename(ctx.pageName || 'dreem');
    var label = sanitizeFilename(ctx.label || ('img' + (((ctx.index || 0)) + 1)));
    var ext = sanitizeFilename(String(ctx.ext || 'png')).replace(/^\.+/, '') || 'png';
    return base + '_' + label + '.' + ext;
  }

  function pickFromSrcset(srcset) {
    if (!srcset || typeof srcset !== 'string') return '';
    var candidates = srcset.split(',').map(function (s) { return s.trim(); })
      .filter(Boolean)
      .map(function (part) {
        var bits = part.split(/\s+/);
        var url = bits[0];
        var desc = bits[1];
        var weight = 1;
        if (desc) {
          var m = desc.match(/^([\d.]+)([wx])$/);
          if (m) weight = parseFloat(m[1]);
        }
        return { url: url, weight: weight };
      });
    if (!candidates.length) return '';
    return candidates.reduce(function (a, b) { return b.weight > a.weight ? b : a; }).url;
  }

  return {
    detectPageType: detectPageType,
    sanitizeFilename: sanitizeFilename,
    extFromUrl: extFromUrl,
    buildFilename: buildFilename,
    pickFromSrcset: pickFromSrcset
  };
}));
