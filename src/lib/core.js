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

  // The path part of a URL, ignoring host and query string. Two CloudFront presigned
  // URLs for the same object share a pathname (only their signature/expiry query differs),
  // so this is a stable key for de-duplicating originals that point to the same file.
  function urlPath(url) {
    if (!url) return '';
    try { return new URL(url, 'https://x.invalid').pathname; } catch (e) { return ''; }
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
        // Multi-image rules get a 1-based number in both the display label ("变体 1")
        // and the filename label ("变体_1"). width/height are display-only — an unloaded
        // image reports naturalWidth 0, which we coalesce to null so the UI shows nothing.
        var base = rule.label || rule.key;
        var fileLabel = rule.multiple ? (base + '_' + (i + 1)) : base;
        var displayLabel = rule.multiple ? (base + ' ' + (i + 1)) : base;
        out.push({
          key: rule.key,
          label: displayLabel,
          url: url,
          filename: buildFilename({ pageName: pageName, label: fileLabel, index: i, ext: extFromUrl(url) }),
          width: el.naturalWidth || null,
          height: el.naturalHeight || null
        });
      });
    });
    return out;
  }

  // Turn the structured page-info panel (see DreemPageConfig.scanInfoPanel) into a
  // Markdown document: H1 name, optional tagline blockquote, then one "## Title"
  // section per group — key/value fields as a bold-term bullet list, or a free-text
  // paragraph. Pure (no DOM), so it is unit-tested directly.
  function buildInfoMarkdown(info) {
    info = info || {};
    var lines = [];
    var name = String(info.name == null ? '' : info.name).trim() || 'dreem';
    lines.push('# ' + name, '');
    if (info.tagline) lines.push('> ' + String(info.tagline).trim(), '');
    (info.sections || []).forEach(function (sec) {
      if (!sec || !sec.title) return;
      lines.push('## ' + sec.title, '');
      if (sec.fields && sec.fields.length) {
        sec.fields.forEach(function (f) { lines.push('- **' + f.term + ':** ' + f.value); });
      } else if (sec.text) {
        lines.push(String(sec.text));
      }
      lines.push('');
    });
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  // Compare dotted numeric versions ("0.7.0"). Missing/non-numeric segments
  // count as 0. Returns 1 if a>b, -1 if a<b, 0 if equal.
  function compareVersions(a, b) {
    var pa = String(a == null ? '' : a).split('.');
    var pb = String(b == null ? '' : b).split('.');
    var n = Math.max(pa.length, pb.length);
    for (var i = 0; i < n; i++) {
      var na = parseInt(pa[i], 10) || 0;
      var nb = parseInt(pb[i], 10) || 0;
      if (na > nb) return 1;
      if (na < nb) return -1;
    }
    return 0;
  }

  return {
    detectPageType: detectPageType,
    sanitizeFilename: sanitizeFilename,
    extFromUrl: extFromUrl,
    urlPath: urlPath,
    buildFilename: buildFilename,
    pickFromSrcset: pickFromSrcset,
    extractImages: extractImages,
    buildInfoMarkdown: buildInfoMarkdown,
    compareVersions: compareVersions
  };
}));
