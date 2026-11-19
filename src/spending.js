(function (root) {
  'use strict';

  // Spending stats view: pulls the user's generation charges from the dreem API (via the
  // page's Clerk login), caches them in the extension's localStorage, attributes them to
  // workspaces (via the generation ids each workspace canvas lists), and renders filters
  // (date range / model / resolution / workspace) → totals, a trend chart and a breakdown.

  var S = DreemStats;
  var PAGE_SIZE = 50;                       // the API caps `limit` at 50
  var LS_USER = 'dreemSpending.lastUser';   // last seen Clerk user id → instant cached render
  var LS_FILTER = 'dreemSpending.filter';   // { preset, from, to, models[], resolutions[], workspaces[], group }
  var LS_DATA = 'dreemSpending.data.v2.';   // + userId → { records, complete, cursor, updatedAt }
  var LS_DATA_V1 = 'dreemSpending.data.';   // + userId: pre-0.10 cache without `ref`, dropped on load
  var LS_WS = 'dreemSpending.ws.';          // + userId → { spaces: { wsId: { name, lastGen, fetchedAt, ids[], deleted? } }, complete }
  var WS_POOL = 3;                          // canvases fetched in parallel
  var RECENT_MS = 3600 * 1000;              // a canvas fetched this soon after its last generation may lag behind

  var el = {
    presets: document.getElementById('spPresets'),
    from: document.getElementById('spFrom'),
    to: document.getElementById('spTo'),
    models: document.getElementById('spModels'),
    res: document.getElementById('spRes'),
    ws: document.getElementById('spWs'),
    group: document.getElementById('spGroup'),
    coins: document.getElementById('spCoins'),
    count: document.getElementById('spCount'),
    secs: document.getElementById('spSecs'),
    note: document.getElementById('spNote'),
    chart: document.getElementById('spChart'),
    table: document.getElementById('spTable'),
    status: document.getElementById('spStatus'),
    reload: document.getElementById('spReload'),
    csv: document.getElementById('spCsv')
  };

  var tabId = null;
  var started = false;
  var busy = false;
  var userId = '';
  var cache = emptyCache();
  var ws = emptyWs();
  var calib = S.calibrate([]);
  var filter = loadFilter();
  var shown = [];                           // records currently shown (for CSV)

  function emptyCache() { return { records: [], complete: false, cursor: null, updatedAt: 0 }; }
  function emptyWs() { return { spaces: {}, complete: false }; }

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* quota/private: keep in memory */ } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }

  function loadCache(uid) {
    lsDel(LS_DATA_V1 + uid);
    try {
      var c = JSON.parse(lsGet(LS_DATA + uid) || 'null');
      if (c && Array.isArray(c.records)) return c;
    } catch (e) { /* corrupt → refetch */ }
    return emptyCache();
  }
  function saveCache() { if (userId) lsSet(LS_DATA + userId, JSON.stringify(cache)); }

  function loadWs(uid) {
    try {
      var w = JSON.parse(lsGet(LS_WS + uid) || 'null');
      if (w && w.spaces && typeof w.spaces === 'object') return w;
    } catch (e) { /* corrupt → refetch */ }
    return emptyWs();
  }
  function saveWs() { if (userId) lsSet(LS_WS + userId, JSON.stringify(ws)); }

  function loadFilter() {
    var f = null;
    try { f = JSON.parse(lsGet(LS_FILTER) || 'null'); } catch (e) { /* ignore */ }
    f = f || {};
    return {
      preset: f.preset || '30d', from: f.from || '', to: f.to || '',
      models: f.models || [], resolutions: f.resolutions || [], workspaces: f.workspaces || [],
      group: f.group === 'workspace' ? 'workspace' : 'model'
    };
  }
  function saveFilter() { lsSet(LS_FILTER, JSON.stringify(filter)); }

  // Injected into the PAGE main world: Clerk token → one GET against the dreem API.
  function apiGetInPage(path, params) {
    return (async function () {
      try {
        if (!(window.Clerk && window.Clerk.session)) return { ok: false, error: 'clerk-unavailable' };
        var token = await window.Clerk.session.getToken();
        if (!token) return { ok: false, error: 'no-token' };
        var q = new URLSearchParams(params || {}).toString();
        var resp = await fetch('https://api.dreem-world.ai' + path + (q ? '?' + q : ''), {
          headers: { 'authorization': 'Bearer ' + token }
        });
        if (!resp.ok) return { ok: false, error: 'http-' + resp.status };
        var j = await resp.json();
        return { ok: true, userId: (window.Clerk.user && window.Clerk.user.id) || '', data: (j && j.data) || j };
      } catch (e) { return { ok: false, error: String(e).slice(0, 140) }; }
    })();
  }

  // Injected into the PAGE main world: the generation ids one workspace canvas holds.
  // Only the ids cross back; a canvas can be several MB.
  function canvasIdsInPage(workspaceId) {
    return (async function () {
      try {
        if (!(window.Clerk && window.Clerk.session)) return { ok: false, error: 'clerk-unavailable' };
        var token = await window.Clerk.session.getToken();
        if (!token) return { ok: false, error: 'no-token' };
        var resp = await fetch('https://api.dreem-world.ai/api/workspaces/' + encodeURIComponent(workspaceId) + '/canvas', {
          headers: { 'authorization': 'Bearer ' + token }
        });
        if (!resp.ok) return { ok: false, error: 'http-' + resp.status };
        var j = await resp.json();
        var canvas = (j && j.data) || j || {};
        var seen = {}, ids = [];
        var add = function (id) { if (id && typeof id === 'string' && !seen[id]) { seen[id] = true; ids.push(id); } };
        (Array.isArray(canvas.nodes) ? canvas.nodes : []).forEach(function (n) {
          var v = n && n.currentVersion;
          if (!v) return;
          (v.assetGenerationIds || []).forEach(add);
          add(v.mainAssetGenerationId);
          (v.assetGenerations || []).forEach(function (g) { add(g && g.id); });
        });
        return { ok: true, ids: ids };
      } catch (e) { return { ok: false, error: String(e).slice(0, 140) }; }
    })();
  }

  // Injected into the PAGE: save text as a file (same <a download> approach as content.js).
  function saveTextInPage(content, filename, mime) {
    try {
      var u = URL.createObjectURL(new Blob([content], { type: mime }));
      var a = document.createElement('a');
      a.href = u;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { a.remove(); URL.revokeObjectURL(u); }, 1500);
      return true;
    } catch (e) { return false; }
  }

  function inPage(func, args) {
    return chrome.scripting.executeScript({ target: { tabId: tabId }, world: 'MAIN', func: func, args: args })
      .then(function (r) { return r && r[0] ? r[0].result : null; })
      .catch(function (e) { return { ok: false, error: String(e).slice(0, 140) }; });
  }

  function fetchPage(cursor) {
    var params = { limit: String(PAGE_SIZE) };
    if (cursor) params.startingAfter = cursor;
    return inPage(apiGetInPage, ['/api/generation-charges/mine', params]).then(function (r) {
      if (!r || !r.ok) throw new Error((r && r.error) || 'no-result');
      return r;
    });
  }

  function setStatus(text, isError) {
    el.status.textContent = text || '';
    el.status.className = 'sp-status' + (isError ? ' error' : '');
  }

  function fmt(n) { return Number(n || 0).toLocaleString('zh-CN'); }

  function timeOf(ms) {
    var d = new Date(ms);
    return S.dayKey(d).slice(5) + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function idSet(records) {
    var s = {};
    records.forEach(function (r) { s[r.id] = true; });
    return s;
  }

  function changed() {
    calib = S.calibrate(cache.records);
    S.assignWorkspaces(cache.records, S.genToWorkspace(ws.spaces));
    render();
  }

  // Attribute charges to workspaces: every workspace canvas lists the generation ids it
  // holds, and a charge's `ref` is the generation it paid for. A canvas is (re)fetched
  // when never fetched, when the workspace has generated since, or when it was fetched
  // within RECENT_MS of its last generation while recent charges are still unattributed.
  async function syncWorkspaces() {
    var res = await inPage(apiGetInPage, ['/api/workspaces']);
    if (!res || !res.ok) throw new Error((res && res.error) || 'no-result');
    var list = Array.isArray(res.data) ? res.data : (res.data && res.data.items) || [];
    var live = {}, todo = [];
    var unattributed = cache.records.filter(function (r) { return r.ref && !r.ws; });
    var unattributedSince = function (ms) {
      return unattributed.some(function (r) { return Date.parse(r.createdAt) >= ms; });
    };
    list.forEach(function (w) {
      if (!w || !w.id) return;
      live[w.id] = true;
      var s = ws.spaces[w.id] = ws.spaces[w.id] || { name: '', lastGen: null, fetchedAt: 0, ids: [] };
      var lastGen = w.lastGenerationAt || null, lastMs = lastGen ? Date.parse(lastGen) : 0;
      s.name = w.name || '';
      delete s.deleted;
      if (!s.fetchedAt || s.lastGen !== lastGen ||
          (lastMs && s.fetchedAt < lastMs + RECENT_MS && unattributedSince(lastMs - RECENT_MS))) {
        todo.push({ id: w.id, lastGen: lastGen });
      }
    });
    // Deleted workspaces keep their ids so their history stays attributed.
    Object.keys(ws.spaces).forEach(function (id) { if (!live[id]) ws.spaces[id].deleted = true; });
    ws.complete = !todo.some(function (t) { return !ws.spaces[t.id].fetchedAt; });
    saveWs();
    changed();

    var next = 0, done = 0, failed = null;
    async function worker() {
      while (next < todo.length && !failed) {
        var t = todo[next++];
        var r = await inPage(canvasIdsInPage, [t.id]);
        if (failed) return;
        if (!r || !r.ok) {
          if (r && r.error === 'http-404') continue;      // deleted meanwhile: keep what we had
          failed = new Error((r && r.error) || 'no-result');
          return;
        }
        var s = ws.spaces[t.id];
        s.ids = r.ids;
        s.lastGen = t.lastGen;
        s.fetchedAt = Date.now();
        done++;
        saveWs();
        changed();
        setStatus('正在匹配工作区… ' + done + '/' + todo.length);
      }
    }
    if (todo.length) setStatus('正在匹配工作区… 0/' + todo.length);
    var workers = [];
    for (var i = 0; i < Math.min(WS_POOL, todo.length); i++) workers.push(worker());
    await Promise.all(workers);
    if (failed) throw failed;
    ws.complete = true;
    saveWs();
  }

  // Charges come newest first. Pull new ones until we meet a cached id; then, if the very
  // first load was interrupted (popup closed), keep walking older pages from `cursor`.
  // First-load pages are saved one by one so a closed popup resumes where it stopped.
  async function sync(full) {
    if (busy) return;
    busy = true;
    el.reload.disabled = true;
    try {
      if (full) { cache = emptyCache(); ws = emptyWs(); saveWs(); changed(); }
      setStatus('正在检查新记录…');
      var known = idSet(cache.records);
      var firstLoad = !cache.records.length;
      var fresh = [], cursor = null, more = true, reachedKnown = false, firstPage = true;

      while (more && !reachedKnown) {
        var res = await fetchPage(cursor);
        if (firstPage) {
          firstPage = false;
          if (res.userId && res.userId !== userId) {      // another account than last time
            userId = res.userId;
            lsSet(LS_USER, userId);
            cache = full ? emptyCache() : loadCache(userId);
            ws = full ? emptyWs() : loadWs(userId);
            known = idSet(cache.records);
            firstLoad = !cache.records.length;
          }
        }
        var items = (res.data && res.data.items) || [];
        for (var i = 0; i < items.length; i++) {
          if (known[items[i].id]) { reachedKnown = true; break; }
          fresh.push(S.normalize(items[i]));
        }
        more = !!(res.data && res.data.hasMore) && items.length > 0;
        if (items.length) cursor = items[items.length - 1].id;
        if (firstLoad) {
          cache.records = fresh.slice();
          cache.cursor = cursor;
          cache.complete = !more;
          saveCache();
          changed();
          setStatus('首次加载中… 已加载 ' + fmt(fresh.length) + ' 条（可关闭弹窗，下次接着加载）');
        }
      }
      if (!firstLoad) {
        if (reachedKnown) cache.records = fresh.concat(cache.records);
        else { cache.records = fresh; cache.cursor = cursor; cache.complete = true; } // walked the whole history
      }

      known = idSet(cache.records);
      while (!cache.complete) {
        var older = await fetchPage(cache.cursor);
        var its = (older.data && older.data.items) || [];
        its.forEach(function (it) {
          if (known[it.id]) return;
          known[it.id] = true;
          cache.records.push(S.normalize(it));
        });
        if (its.length) cache.cursor = its[its.length - 1].id;
        cache.complete = !(older.data && older.data.hasMore) || !its.length;
        saveCache();
        changed();
        setStatus('首次加载中… 已加载 ' + fmt(cache.records.length) + ' 条（可关闭弹窗，下次接着加载）');
      }

      cache.updatedAt = Date.now();
      saveCache();
      changed();
      try {
        await syncWorkspaces();
      } catch (e) {
        setStatus('工作区匹配失败（' + e.message + '）：下次打开会接着匹配', true);
        return;
      }
      setStatus('共 ' + fmt(cache.records.length) + ' 条 · 更新于 ' + timeOf(cache.updatedAt));
    } catch (e) {
      setStatus('获取失败（' + e.message + '）：请确认已登录 dreem，刷新页面后重试', true);
    } finally {
      busy = false;
      el.reload.disabled = false;
      changed();
    }
  }

  function currentRange() {
    if (filter.preset && filter.preset !== 'custom') return S.presetRange(filter.preset);
    return { from: filter.from || '', to: filter.to || '' };
  }

  // Options plus any still-selected value missing from them (count 0) so it can be unselected.
  function withSelected(options, selected) {
    var have = {};
    options.forEach(function (o) { have[o.value] = true; });
    return options.concat(selected.filter(function (v) { return !have[v]; }).map(function (v) { return { value: v, count: 0 }; }));
  }

  function chip(text, count, active, onClick, title) {
    var b = document.createElement('button');
    b.className = 'chip' + (active ? ' active' : '');
    if (title) b.title = title;
    b.appendChild(document.createTextNode(text));
    if (count != null) {
      var c = document.createElement('span');
      c.className = 'count';
      c.textContent = fmt(count);
      b.appendChild(c);
    }
    b.addEventListener('click', onClick);
    return b;
  }

  // A leading 全部 chip (= nothing selected) followed by multi-select value chips.
  function renderChips(container, options, key) {
    container.innerHTML = '';
    var selected = filter[key];
    container.appendChild(chip('全部', null, !selected.length, function () { setSelection(key, []); }));
    options.forEach(function (o) {
      var on = selected.indexOf(o.value) > -1;
      container.appendChild(chip(o.label != null ? o.label : (o.value || '未知'), o.count, on, function () {
        setSelection(key, on ? selected.filter(function (v) { return v !== o.value; }) : selected.concat([o.value]));
      }, o.coins != null ? '积分 ' + fmt(o.coins) : ''));
    });
  }

  // Records in the date range and the selected workspaces (what model/res options come from).
  function scopedRecords() {
    var r = currentRange();
    return S.applyFilter(cache.records, { from: r.from, to: r.to, workspaces: filter.workspaces });
  }

  function setSelection(key, values) {
    filter[key] = values;
    if (key === 'models') {
      // keep only resolutions that still exist under the new model selection
      var avail = S.optionsFor(scopedRecords(), values).resolutions.map(function (o) { return o.value; });
      filter.resolutions = filter.resolutions.filter(function (r) { return avail.indexOf(r) > -1; });
    }
    saveFilter();
    render();
  }

  function svgEl(name, attrs, text) {
    var n = document.createElementNS('http://www.w3.org/2000/svg', name);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (text != null) n.textContent = text;
    return n;
  }

  // Bars of coins per day (or month); hover shows coins · count · duration.
  function renderChart(rows, range) {
    el.chart.innerHTML = '';
    var days = rows.map(function (r) { return S.dayKey(r.createdAt); }).sort();
    var from = range.from || days[0];
    var to = range.to || S.dayKey(new Date());
    var t = S.bucketByTime(rows, from, to, calib);
    if (!rows.length || !t.buckets.length) return;

    var W = 376, H = 112, top = 14, bottom = 16, plotH = H - top - bottom;
    var n = t.buckets.length, slot = W / n, barW = Math.max(1, Math.min(slot * 0.72, 28));
    var max = Math.max.apply(null, t.buckets.map(function (b) { return b.coins; })) || 1;
    var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': '消耗趋势' });
    svg.appendChild(svgEl('text', { x: 0, y: 10 }, '峰值 ' + fmt(max) + (t.unit === 'month' ? ' / 月' : ' / 天')));
    svg.appendChild(svgEl('line', { x1: 0, x2: W, y1: top + plotH + 0.5, y2: top + plotH + 0.5, class: 'axis' }));
    t.buckets.forEach(function (b, i) {
      var g = svgEl('g');
      var h = b.coins ? Math.max(1, b.coins / max * plotH) : 0;
      g.appendChild(svgEl('title', null, b.key + '\n积分 ' + fmt(b.coins) + ' · ' + fmt(b.count) + ' 次 · 时长 ' + S.formatDuration(b.secs)));
      g.appendChild(svgEl('rect', { class: 'hit', x: i * slot, y: 0, width: slot, height: top + plotH }));
      if (h) g.appendChild(svgEl('rect', { class: 'bar', x: i * slot + (slot - barW) / 2, y: top + plotH - h, width: barW, height: h, rx: Math.min(2, barW / 2) }));
      svg.appendChild(g);
    });
    var label = function (k) { return t.unit === 'month' ? k : k.slice(5); };
    svg.appendChild(svgEl('text', { x: 0, y: H - 3 }, label(t.buckets[0].key)));
    if (n > 1) svg.appendChild(svgEl('text', { x: W, y: H - 3, 'text-anchor': 'end' }, label(t.buckets[n - 1].key)));
    el.chart.appendChild(svg);
  }

  function cell(tr, text, cls) {
    var td = document.createElement('td');
    if (cls) td.className = cls;
    if (text != null) td.textContent = text;
    tr.appendChild(td);
    return td;
  }

  function renderTable(rows) {
    el.table.innerHTML = '';
    var byWs = filter.group === 'workspace';
    var groups = S.breakdown(rows, calib, filter.group);
    if (!groups.length) return;
    var head = document.createElement('tr');
    [byWs ? '工作区' : '模型 · 分辨率', '次数', '时长', '积分'].forEach(function (h) {
      var th = document.createElement('th');
      th.textContent = h;
      head.appendChild(th);
    });
    var thead = document.createElement('thead');
    thead.appendChild(head);
    el.table.appendChild(thead);
    var tbody = document.createElement('tbody');
    groups.forEach(function (g) {
      var tr = document.createElement('tr');
      var name = cell(tr);
      var nm = document.createElement('div');
      nm.textContent = byWs ? S.wsLabel(g.ws, ws.spaces) : (g.model || '未知') + ' · ' + (g.res || '—');
      var bar = document.createElement('div');
      bar.className = 'sp-bar';
      var fill = document.createElement('i');
      fill.style.width = (g.pct * 100).toFixed(1) + '%';
      bar.appendChild(fill);
      name.appendChild(nm);
      name.appendChild(bar);
      cell(tr, fmt(g.count));
      var dur = cell(tr, g.video ? ((g.estimatedCount ? '≈' : '') + S.formatDuration(g.secs)) : '—');
      if (g.estimatedCount) dur.title = '含 ' + fmt(g.estimatedCount) + ' 条按 token 估算';
      var coins = cell(tr, fmt(g.coins));
      var pct = document.createElement('div');
      pct.className = 'sp-pct';
      pct.textContent = (g.pct * 100).toFixed(1) + '%';
      coins.appendChild(pct);
      tbody.appendChild(tr);
    });
    el.table.appendChild(tbody);
  }

  function render() {
    var range = currentRange();
    var oldest = cache.records.length ? S.dayKey(cache.records[cache.records.length - 1].createdAt) : '';
    el.from.value = range.from || oldest;     // unbounded ends show the actual data span
    el.to.value = range.to || S.dayKey(new Date());
    Array.prototype.forEach.call(el.presets.querySelectorAll('.chip'), function (b) {
      b.classList.toggle('active', b.getAttribute('data-preset') === filter.preset);
    });

    var inRange = S.applyFilter(cache.records, range);
    var scoped = filter.workspaces.length ? S.applyFilter(inRange, { workspaces: filter.workspaces }) : inRange;
    var opts = S.optionsFor(scoped, filter.models);
    renderChips(el.models, withSelected(opts.models, filter.models), 'models');
    renderChips(el.res, withSelected(opts.resolutions, filter.resolutions), 'resolutions');
    var wsOpts = withSelected(S.optionsFor(inRange).workspaces, filter.workspaces).map(function (o) {
      return { value: o.value, count: o.count, coins: o.coins, label: S.wsLabel(o.value, ws.spaces) };
    });
    renderChips(el.ws, wsOpts, 'workspaces');
    Array.prototype.forEach.call(el.group.querySelectorAll('.chip'), function (b) {
      b.classList.toggle('active', b.getAttribute('data-group') === filter.group);
    });

    shown = S.applyFilter(scoped, { models: filter.models, resolutions: filter.resolutions });
    var sum = S.summarize(shown, calib);
    el.coins.textContent = fmt(sum.coins);
    el.count.textContent = fmt(sum.count);
    el.secs.textContent = S.formatDuration(sum.secs);

    var notes = [];
    if (sum.estimatedCount) notes.push('时长中有 ' + fmt(sum.estimatedCount) + ' 条按 token 估算（2026-08-08 前的记录没有时长字段）');
    if (sum.missingCount) notes.push(fmt(sum.missingCount) + ' 条无法计算时长');
    if (cache.records.length && !cache.complete) notes.push('数据尚未加载完，统计暂不完整');
    else if (cache.records.length && !ws.complete) notes.push('工作区尚未匹配完，部分记录暂计入「' + S.NO_WORKSPACE + '」');
    el.note.textContent = notes.join('；');

    renderChart(shown, range);
    renderTable(shown);
    if (!shown.length && !busy) {
      var empty = document.createElement('div');
      empty.className = 'sp-empty';
      empty.textContent = cache.records.length ? '该筛选条件下没有消耗记录' : '暂无数据';
      el.chart.appendChild(empty);
    }
    el.csv.disabled = !shown.length;
  }

  el.presets.addEventListener('click', function (e) {
    var b = e.target.closest('[data-preset]');
    if (!b) return;
    filter.preset = b.getAttribute('data-preset');
    saveFilter();
    render();
  });

  function onDateChange() {
    filter.preset = 'custom';
    filter.from = el.from.value;
    filter.to = el.to.value;
    if (filter.from && filter.to && filter.from > filter.to) { var t = filter.from; filter.from = filter.to; filter.to = t; }
    saveFilter();
    render();
  }
  el.from.addEventListener('change', onDateChange);
  el.to.addEventListener('change', onDateChange);

  el.group.addEventListener('click', function (e) {
    var b = e.target.closest('[data-group]');
    if (!b) return;
    filter.group = b.getAttribute('data-group') === 'workspace' ? 'workspace' : 'model';
    saveFilter();
    render();
  });

  el.reload.addEventListener('click', function () { sync(true); });

  el.csv.addEventListener('click', function () {
    if (!shown.length) return;
    var range = currentRange();
    var name = DreemCore.sanitizeFilename('dreem_积分明细_' + (range.from || '最早') + '_' + (range.to || S.dayKey(new Date()))) + '.csv';
    var orig = el.csv.textContent;
    el.csv.disabled = true;
    inPage(saveTextInPage, [S.buildCsv(shown, calib, ws.spaces), name, 'text/csv;charset=utf-8']).then(function (ok) {
      el.csv.textContent = ok === true ? '已导出' : '导出失败';
      el.csv.disabled = false;
      setTimeout(function () { el.csv.textContent = orig; }, 2000);
    });
  });

  // Show the view for this tab: cached data first, then sync in the background.
  function open(tId) {
    if (started) return;
    started = true;
    tabId = tId;
    userId = lsGet(LS_USER) || '';
    if (userId) { cache = loadCache(userId); ws = loadWs(userId); }
    changed();
    if (cache.updatedAt) setStatus('共 ' + fmt(cache.records.length) + ' 条 · 更新于 ' + timeOf(cache.updatedAt));
    sync(false);
  }

  root.DreemSpending = { open: open };
})(typeof self !== 'undefined' ? self : this);
