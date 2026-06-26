(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();        // Node (tests, CommonJS)
  } else {
    root.DreemCore = factory();        // browser page / content script / service worker
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function detectPageType(url) {
    var pathname;
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
    var label = sanitizeFilename(ctx.label || ('img' + ((ctx.index || 0) + 1)));
    // ext is a short token, not a filename: strip anything non-alphanumeric directly
    var ext = String(ctx.ext || 'png').replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'png';
    return base + '_' + label + '.' + ext;
  }

  function pickFromSrcset(srcset) {
    // Note: splits on ',' — does not handle commas inside data: URIs (rare in srcset).
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

  function extractImages(doc, rules, ctx) {
    var out = [];
    var seen = {};
    var pageName = (ctx && ctx.pageName) || 'dreem';
    (rules || []).forEach(function (rule) {
      var els = [];
      try {
        if (rule.multiple) {
          var nodeList = doc.querySelectorAll(rule.selector);
          els = nodeList ? Array.prototype.slice.call(nodeList) : [];
        } else {
          var el = doc.querySelector(rule.selector);
          if (el) els = [el];
        }
      } catch (e) { els = []; }

      els.forEach(function (el, i) {
        var url = '';
        try { url = rule.getUrl ? rule.getUrl(el) : (el.src || ''); } catch (e) { url = ''; }
        if (rule.upgrade && url) {
          try { url = rule.upgrade(url) || url; } catch (e) { /* keep url */ }
        }
        if (!url || seen[url]) return;
        seen[url] = true;
        // fileLabel adds an index suffix for multi-image rules; the descriptor's display
        // `label` stays clean. width/height are display-only — an unloaded image reports
        // naturalWidth 0, which we coalesce to null so the UI shows no dimensions.
        var fileLabel = rule.multiple ? ((rule.label || rule.key) + '_' + (i + 1)) : (rule.label || rule.key);
        out.push({
          key: rule.key,
          label: rule.label || rule.key,
          url: url,
          filename: buildFilename({ pageName: pageName, label: fileLabel, index: i, ext: extFromUrl(url) }),
          width: el.naturalWidth || null,
          height: el.naturalHeight || null
        });
      });
    });
    return out;
  }

  return {
    detectPageType: detectPageType,
    sanitizeFilename: sanitizeFilename,
    extFromUrl: extFromUrl,
    buildFilename: buildFilename,
    pickFromSrcset: pickFromSrcset,
    extractImages: extractImages
  };
}));
