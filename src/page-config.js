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

  // The 5 character categories. `key` is used in filenames (e.g. Faye_face_full),
  // `tabKey` matches the webpage tab id suffix, `types` are the artifact types
  // (from /artifacts/query) shown under that tab. Verified/adjusted during testing.
  var CATEGORIES = [
    { key: 'face',   label: 'Face',   tabKey: 'face',    types: ['head_turnaround'] },
    { key: 'body',   label: 'Body',   tabKey: 'body',    types: ['body_turnaround'] },
    { key: 'mood',   label: 'Mood',   tabKey: 'moods',   types: ['expressions'] },
    { key: 'outfit', label: 'Outfit', tabKey: 'outfits', types: ['wardrobe'] },
    { key: 'others', label: 'Others', tabKey: 'others',  types: ['character_reference', 'character_other'] }
  ];

  function categoryForType(type) {
    for (var i = 0; i < CATEGORIES.length; i++) {
      if (CATEGORIES[i].types.indexOf(type) > -1) return CATEGORIES[i];
    }
    return null;
  }

  function categoryByTabKey(tabKey) {
    for (var i = 0; i < CATEGORIES.length; i++) {
      if (CATEGORIES[i].tabKey === tabKey) return CATEGORIES[i];
    }
    return null;
  }

  // The webpage's currently-active category tab key (e.g. 'outfits'), or null.
  function activeCategoryKey(doc) {
    try {
      var t = doc.querySelector('[role="tab"][data-state="active"]');
      if (!t) return null;
      var m = (t.id || '').match(/trigger-([a-z]+)/i);
      return m ? m[1] : null;
    } catch (e) {
      return null;
    }
  }

  // Selector rules for the current category's variant crops (tiles).
  var EXTRACTORS = {
    character: [
      { key: 'tile', label: '变体', selector: TILE_SEL, multiple: true, getUrl: srcOf }
    ],
    location: []
  };

  function getRules(pageType) {
    return EXTRACTORS[pageType] || [];
  }

  // Collect the current category's variant crops, grouped by their tile grid.
  // Each grid is one source/outfit; `group` (0-based, DOM order) ties variants to
  // the matching original. Returns [{ url, group, width, height }] in DOM order.
  function scanTiles(doc) {
    var els = Array.prototype.slice.call(doc.querySelectorAll(TILE_SEL));
    var grids = [];
    function nearestGrid(t) {
      var e = t, d = 0;
      while (e && d < 10 && !/grid/.test(typeof e.className === 'string' ? e.className : '')) { e = e.parentElement; d++; }
      return e || t;
    }
    return els.map(function (t) {
      var g = nearestGrid(t);
      var gi = grids.indexOf(g);
      if (gi < 0) { gi = grids.length; grids.push(g); }
      return { url: t.currentSrc || t.src || '', group: gi, width: t.naturalWidth || null, height: t.naturalHeight || null };
    });
  }

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

  return {
    EXTRACTORS: EXTRACTORS,
    CATEGORIES: CATEGORIES,
    categoryForType: categoryForType,
    categoryByTabKey: categoryByTabKey,
    activeCategoryKey: activeCategoryKey,
    getRules: getRules,
    scanTiles: scanTiles,
    getPageName: getPageName
  };
}));
