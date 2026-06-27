(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DreemPageConfig = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function srcOf(el) { return el.currentSrc || el.src || ''; }

  var PORTRAIT_SEL = 'section[class*="aspect-[9/16]"] img'; // preview only; used to read the character name
  var TILE_SEL = 'img[alt^="Tile"]';

  // Selector-based rules per page type. Extend here to support new page types.
  var EXTRACTORS = {
    character: [
      { key: 'tile', label: '变体', selector: TILE_SEL, multiple: true, getUrl: srcOf }
    ],
    location: []
  };

  function getRules(pageType) {
    return EXTRACTORS[pageType] || [];
  }

  // Page name = filename prefix. Character pages: the preview image's alt is the
  // character name; otherwise fall back to the document title.
  function getPageName(pageType, doc) {
    try {
      if (pageType === 'character') {
        var p = doc.querySelector(PORTRAIT_SEL);
        if (p && p.alt) return p.alt;
      }
      var title = (doc && doc.title) ? String(doc.title).split('—')[0].split('|')[0].trim() : '';
      return title || 'dreem';
    } catch (e) {
      return 'dreem';
    }
  }

  // Tile metrics drive both the derived source-sheet descriptor and its resolution.
  function tileMetrics(doc) {
    var tiles = Array.prototype.slice.call(doc.querySelectorAll(TILE_SEL));
    if (!tiles.length) return null;
    var h = tiles[0].naturalHeight || 0;
    var w = 0;
    for (var i = 0; i < tiles.length; i++) w += (tiles[i].naturalWidth || 0);
    if (!h || !w) return null;
    return { height: h, width: w, count: tiles.length };
  }

  // Derived (non-DOM-element) descriptors. The character "主图" is the original
  // source sheet the tiles are cropped from. It only lives inside a dialog, but
  // it is fetched on page load and is identifiable among loaded resources as the
  // adhoc-asset whose height == tile height and width == sum of tile widths.
  // Exposed synchronously here (from tile dimensions); bytes resolved lazily at
  // download time (see resolveSpecial).
  function getDerived(pageType, doc, pageName) {
    if (pageType !== 'character') return [];
    var m = tileMetrics(doc);
    if (!m) return [];
    var fn = (typeof DreemCore !== 'undefined')
      ? DreemCore.buildFilename({ pageName: pageName, label: '主图', index: 0, ext: 'png' })
      : (pageName + '_主图.png');
    return [{ key: 'source', label: '主图', kind: 'sourcesheet', width: m.width, height: m.height, filename: fn }];
  }

  // Async: return a Blob for descriptors needing special resolution (browser only).
  // Source sheet: find the loaded adhoc-asset matching the tile metrics.
  function resolveSpecial(descriptor, doc) {
    if (!descriptor || descriptor.kind !== 'sourcesheet') return Promise.resolve(null);
    var m = tileMetrics(doc);
    if (!m) return Promise.reject(new Error('找不到变体，无法定位源图'));
    var tol = m.count * 4;
    var urls = performance.getEntriesByType('resource')
      .map(function (e) { return e.name; })
      .filter(function (n) { return n.indexOf('/adhoc-assets/') > -1; });
    var seen = {};
    urls = urls.filter(function (u) { if (seen[u]) return false; seen[u] = true; return true; });

    function tryAt(idx) {
      if (idx >= urls.length) return Promise.reject(new Error('在已加载资源中未找到源图'));
      return fetch(urls[idx])
        .then(function (r) { return r.blob(); })
        .then(function (b) {
          return createImageBitmap(b).then(function (bm) {
            var ok = (bm.height === m.height) && (Math.abs(bm.width - m.width) <= tol);
            if (bm.close) { try { bm.close(); } catch (e) {} }
            return ok ? b : null;
          });
        })
        .catch(function () { return null; }) // this url failed/no-match -> try next
        .then(function (b) { return b ? b : tryAt(idx + 1); });
    }
    return tryAt(0);
  }

  return {
    EXTRACTORS: EXTRACTORS,
    getRules: getRules,
    getPageName: getPageName,
    getDerived: getDerived,
    resolveSpecial: resolveSpecial
  };
}));
