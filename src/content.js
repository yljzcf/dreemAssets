(function () {
  'use strict';

  function scan() {
    var type = DreemCore.detectPageType(location.href);
    if (type === 'unknown') {
      return { ok: false, reason: 'not-target-page', pageType: type };
    }
    var rules = DreemPageConfig.getRules(type);
    var pageName = DreemPageConfig.getPageName(type, document);
    var images = DreemCore.extractImages(document, rules, { pageName: pageName });
    // dry-run debug: log results so selectors can be verified during exploration
    try { console.log('[Dreem下载] 页面类型=' + type + ' 提取到 ' + images.length + ' 张:', images); } catch (e) {}
    return { ok: true, pageType: type, pageName: pageName, images: images };
  }

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (msg && msg.type === 'scan') {
      try {
        sendResponse(scan());
      } catch (e) {
        sendResponse({ ok: false, reason: 'scan-error', error: String(e) });
      }
    }
    return false; // synchronous response
  });
})();
