(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./lib/core.js'));  // Node (tests)
  } else {
    root.DreemUpdateCheck = factory(root.DreemCore);     // popup page
  }
}(typeof self !== 'undefined' ? self : this, function (DreemCore) {
  'use strict';

  var REPO_URL = 'https://github.com/yljzcf/dreemAssets';
  var MANIFEST_URL = 'https://raw.githubusercontent.com/yljzcf/dreemAssets/main/manifest.json';
  var CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;   // throttle: at most once / 6h
  var LS_LAST = 'dreemUpdate.lastCheck';         // last network check timestamp (ms)
  var LS_LATEST = 'dreemUpdate.latest';          // last seen remote version string

  function repoUrl() { return REPO_URL; }

  function current() {
    try { return chrome.runtime.getManifest().version; } catch (e) { return '0.0.0'; }
  }

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }

  // Pure: local + cached remote → state.
  function deriveState(local, latest) {
    if (!latest) return 'checking';
    return DreemCore.compareVersions(latest, local) > 0 ? 'update' : 'current';
  }

  // Pure: status object → display fields for the header status area.
  function describe(info) {
    var local = (info && info.local) || '';
    var latest = (info && info.latest) || '';
    switch (info && info.state) {
      case 'update':  return { emoji: '⬆️', text: '新版本可用', title: 'v' + latest + ' / 当前 v' + local, blink: true };
      case 'current': return { emoji: '☑️', text: 'v' + local, title: '当前已是最新版本', blink: false };
      case 'error':   return { emoji: '⚠️', text: '无法检查更新', title: '请检查网络连接', blink: false };
      default:        return { emoji: '', text: '检查中…', title: '', blink: false };
    }
  }

  // Sync read of cache → renders instantly (no network).
  function getCached() {
    var local = current();
    var latest = lsGet(LS_LATEST);
    return { state: deriveState(local, latest), local: local, latest: latest };
  }

  // Throttled network refresh. Never rejects: failures resolve to state 'error'.
  function check() {
    var local = current();
    var latest = lsGet(LS_LATEST);
    var last = parseInt(lsGet(LS_LAST), 10) || 0;
    var now = Date.now();
    if (latest && (now - last) < CHECK_INTERVAL_MS) {
      return Promise.resolve({ state: deriveState(local, latest), local: local, latest: latest });
    }
    return fetch(MANIFEST_URL, { cache: 'no-store' })
      .then(function (resp) {
        if (!resp.ok) throw new Error('http-' + resp.status);
        return resp.json();
      })
      .then(function (json) {
        var remote = json && json.version;
        if (!remote) throw new Error('no-version');
        lsSet(LS_LATEST, remote);
        lsSet(LS_LAST, String(now));
        return { state: deriveState(local, remote), local: local, latest: remote };
      })
      .catch(function (e) {
        try { console.warn('[Dreem下载] 检查更新失败:', String(e)); } catch (x) { /* ignore */ }
        return { state: 'error', local: local, latest: latest };
      });
  }

  return {
    repoUrl: repoUrl,
    current: current,
    deriveState: deriveState,
    describe: describe,
    getCached: getCached,
    check: check
  };
}));
