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
  var VIEW_ORIGINAL_SEL = 'button[aria-label="View original"]'; // opens the source-sheet dialog

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

  // Fallback dimensions for the source sheet (it equals the tiles laid side by side).
  function tileMetrics(doc) {
    var tiles = Array.prototype.slice.call(doc.querySelectorAll(TILE_SEL));
    if (!tiles.length) return null;
    var h = tiles[0].naturalHeight || 0;
    var w = 0;
    for (var i = 0; i < tiles.length; i++) w += (tiles[i].naturalWidth || 0);
    if (!h || !w) return null;
    return { height: h, width: w, count: tiles.length };
  }

  // --- main image(s): the original "source sheet". It only exists inside the
  // "View original" dialog, so we briefly open each such dialog, read the real
  // image URL, and close it. (browser-only; not exercised by Node tests.)
  function closeOpenDialog() {
    var dlg = document.querySelector('[role="dialog"][data-state="open"]');
    if (!dlg) return;
    var x = dlg.querySelector('button[aria-label*="Close" i]');
    if (x) x.click();
    else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, keyCode: 27 }));
  }

  function openReadClose(button) {
    return new Promise(function (resolve) {
      try { button.click(); } catch (e) { resolve(null); return; }
      var tries = 0;
      var iv = setInterval(function () {
        tries++;
        var dlg = document.querySelector('[role="dialog"][data-state="open"]');
        var img = dlg && dlg.querySelector('img');
        var src = img && (img.currentSrc || img.src);
        if (src) {
          clearInterval(iv);
          var info = { url: src, width: img.naturalWidth || null, height: img.naturalHeight || null };
          closeOpenDialog();
          setTimeout(function () { resolve(info); }, 250);
        } else if (tries > 30) { // ~2.4s timeout
          clearInterval(iv);
          closeOpenDialog();
          setTimeout(function () { resolve(null); }, 250);
        }
      }, 80);
    });
  }

  function getMainImages(pageType, doc, pageName) {
    if (pageType !== 'character') return Promise.resolve([]);
    var buttons = Array.prototype.slice.call(doc.querySelectorAll(VIEW_ORIGINAL_SEL));
    if (!buttons.length) return Promise.resolve([]);
    var m = tileMetrics(doc);
    var seen = {};
    var found = [];
    function pathKey(u) { try { return new URL(u, location.href).pathname; } catch (e) { return u; } }
    var i = 0;
    function step() {
      if (i >= buttons.length) return Promise.resolve(found);
      return openReadClose(buttons[i++]).then(function (info) {
        if (info && info.url) {
          var k = pathKey(info.url);
          if (!seen[k]) { seen[k] = true; found.push(info); }
        }
        return new Promise(function (r) { setTimeout(r, 200); }).then(step);
      });
    }
    return step().then(function (list) {
      return list.map(function (info, idx) {
        var multi = list.length > 1;
        var dispLabel = multi ? ('主图 ' + (idx + 1)) : '主图';
        var fileLabel = multi ? ('主图_' + (idx + 1)) : '主图';
        var ext = (typeof DreemCore !== 'undefined') ? DreemCore.extFromUrl(info.url) : 'png';
        var fn = (typeof DreemCore !== 'undefined')
          ? DreemCore.buildFilename({ pageName: pageName, label: fileLabel, index: idx, ext: ext })
          : (pageName + '_' + fileLabel + '.png');
        return {
          key: 'source' + (idx + 1),
          label: dispLabel,
          url: info.url,
          width: info.width || (m ? m.width : null),
          height: info.height || (m ? m.height : null),
          filename: fn
        };
      });
    });
  }

  return {
    EXTRACTORS: EXTRACTORS,
    getRules: getRules,
    getPageName: getPageName,
    getMainImages: getMainImages
  };
}));
