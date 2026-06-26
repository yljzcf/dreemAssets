(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DreemPageConfig = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function srcOf(el) { return el.currentSrc || el.src || ''; }

  // Selector for the large portrait in its 9:16 display section (used for both
  // image extraction and reading the character name from its alt).
  var PORTRAIT_SEL = 'section[class*="aspect-[9/16]"] img';

  // Each rule: { key, label, selector, getUrl(el)->url, upgrade?(url)->url, multiple? }
  // Filled during exploration; extend here to support new page types.
  var EXTRACTORS = {
    character: [
      { key: 'portrait', label: '主图', selector: PORTRAIT_SEL, getUrl: srcOf },
      { key: 'tile', label: '变体', selector: 'img[alt^="Tile"]', multiple: true, getUrl: srcOf }
    ],
    location: []
  };

  function getRules(pageType) {
    return EXTRACTORS[pageType] || [];
  }

  // Page name = filename prefix. Character pages: use the portrait's alt (the
  // character name); otherwise fall back to the document title.
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

  return { EXTRACTORS: EXTRACTORS, getRules: getRules, getPageName: getPageName };
}));
