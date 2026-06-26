(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DreemPageConfig = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Each rule: { key, label, selector, getUrl(el)->url, upgrade?(url)->url, multiple? }
  // The exploration phase appends rules to these arrays.
  var EXTRACTORS = {
    character: [],
    location: []
  };

  function getRules(pageType) {
    return EXTRACTORS[pageType] || [];
  }

  // Page name (used as filename prefix). Exploration may add more precise selectors per type.
  function getPageName(pageType, doc) {
    try {
      var title = (doc && doc.title) ? String(doc.title).split('—')[0].split('|')[0].trim() : '';
      return title || 'dreem';
    } catch (e) {
      return 'dreem';
    }
  }

  return { EXTRACTORS: EXTRACTORS, getRules: getRules, getPageName: getPageName };
}));
