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

  // Selector-based rules per page type. Used for the current category's variant
  // crops (tiles), which are only rendered for the active tab.
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

  // Maps an artifact `type` (from /artifacts/query) to a human label for filenames
  // and the popup. Unknown types fall back to the raw type string.
  var TYPE_LABELS = {
    wardrobe: '穿搭',
    head_turnaround: '头部转身',
    body_turnaround: '身体转身',
    expressions: '表情',
    character_reference: '参考图',
    character_other: '其它素材',
    character_spec: '设定'
  };

  function artifactLabel(type) {
    return TYPE_LABELS[type] || String(type || 'image');
  }

  return {
    EXTRACTORS: EXTRACTORS,
    getRules: getRules,
    getPageName: getPageName,
    artifactLabel: artifactLabel
  };
}));
