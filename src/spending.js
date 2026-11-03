(function (root) {
  'use strict';

  // Spending stats view: pulls the user's generation charges from the dreem API (via the
  // page's Clerk login), caches them in the extension's localStorage, and renders
  // filters (date range / model / resolution) → totals, a trend chart and a breakdown.

  var S = DreemStats;
  var PAGE_SIZE = 50;                       // the API caps `limit` at 50
  var LS_USER = 'dreemSpending.lastUser';   // last seen Clerk user id → instant cached render
  var LS_FILTER = 'dreemSpending.filter';   // { preset, from, to, models[], resolutions[] }
  var LS_DATA = 'dreemSpending.data.';      // + userId → { records, complete, cursor, updatedAt }

  var el = {
    presets: document.getElementById('spPresets'),
    from: document.getElementById('spFrom'),
    to: document.getElementById('spTo'),
    models: document.getElementById('spModels'),
    res: document.getElementById('spRes'),
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
  var calib = S.calibrate([]);
  var filter = loadFilter();
  var shown = [];                           // records currently shown (for CSV)

  function emptyCache() { return { records: [], complete: false, cursor: null, updatedAt: 0 }; }

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* quota/private: keep in memory */ } }

  function loadCache(uid) {
    try {
      var c = JSON.parse(lsGet(LS_DATA + uid) || 'null');
      if (c && Array.isArray(c.records)) return c;
    } catch (e) { /* corrupt → refetch */ }
    return emptyCache();
  }
  function saveCache() { if (userId) lsSet(LS_DATA + userId, JSON.stringify(cache)); }

  function loadFilter() {
    var f = null;
    try { f = JSON.parse(lsGet(LS_FILTER) || 'null'); } catch (e) { /* ignore */ }
    f = f || {};
    return { preset: f.preset || '30d', from: f.from || '', to: f.to || '', models: f.models || [], resolutions: f.resolutions || [] };
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

  function changed() { calib = S.calibrate(cache.records); render(); }

  // Charges come newest first. Pull new ones until we meet a cached id; then, if the very
  // first load was interrupted (popup closed), keep walking older pages from `cursor`.
  // First-load pages are saved one by one so a closed popup resumes where it stopped.
  async function sync(full) {
    if (busy) return;
    busy = true;
    el.reload.disabled = true;
    try {
      if (full) { cache = emptyCache(); changed(); }
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

  function chip(text, count, active, onClick) {
    var b = document.createElement('button');
    b.className = 'chip' + (active ? ' active' : '');
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
      container.appendChild(chip(o.value || '未知', o.count, on, function () {
        setSelection(key, on ? selected.filter(function (v) { return v !== o.value; }) : selected.concat([o.value]));
      }));
    });
  }

  function setSelection(key, values) {
    filter[key] = values;
    if (key === 'models') {
      // keep only resolutions that still exist under the new model selection
      var avail = S.optionsFor(S.applyFilter(cache.records, currentRange()), values).resolutions.map(function (o) { return o.value; });
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
    var groups = S.breakdown(rows, calib);
    if (!groups.length) return;
    var head = document.createElement('tr');
    ['模型 · 分辨率', '次数', '时长', '积分'].forEach(function (h) {
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
      nm.textContent = (g.model || '未知') + ' · ' + (g.res || '—');
      var bar = document.createElement('div');
      bar.className = 'sp-bar';
      var fill = document.createElement('i');
      fill.style.width = (g.pct * 100).toFixed(1) + '%';
      bar.appendChild(fill);
      name.appendChild(nm);
      name.appendChild(bar);
      cell(tr, fmt(g.count));
      var dur = cell(tr, g.type === 'video' ? ((g.estimatedCount ? '≈' : '') + S.formatDuration(g.secs)) : '—');
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
    var opts = S.optionsFor(inRange, filter.models);
    renderChips(el.models, withSelected(opts.models, filter.models), 'models');
    renderChips(el.res, withSelected(opts.resolutions, filter.resolutions), 'resolutions');

    shown = S.applyFilter(inRange, { models: filter.models, resolutions: filter.resolutions });
    var sum = S.summarize(shown, calib);
    el.coins.textContent = fmt(sum.coins);
    el.count.textContent = fmt(sum.count);
    el.secs.textContent = S.formatDuration(sum.secs);

    var notes = [];
    if (sum.estimatedCount) notes.push('时长中有 ' + fmt(sum.estimatedCount) + ' 条按 token 估算（2026-08-08 前的记录没有时长字段）');
    if (sum.missingCount) notes.push(fmt(sum.missingCount) + ' 条无法计算时长');
    if (cache.records.length && !cache.complete) notes.push('数据尚未加载完，统计暂不完整');
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

  el.reload.addEventListener('click', function () { sync(true); });

  el.csv.addEventListener('click', function () {
    if (!shown.length) return;
    var range = currentRange();
    var name = DreemCore.sanitizeFilename('dreem_积分明细_' + (range.from || '最早') + '_' + (range.to || S.dayKey(new Date()))) + '.csv';
    var orig = el.csv.textContent;
    el.csv.disabled = true;
    inPage(saveTextInPage, [S.buildCsv(shown, calib), name, 'text/csv;charset=utf-8']).then(function (ok) {
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
    if (userId) cache = loadCache(userId);
    changed();
    if (cache.updatedAt) setStatus('共 ' + fmt(cache.records.length) + ' 条 · 更新于 ' + timeOf(cache.updatedAt));
    sync(false);
  }

  root.DreemSpending = { open: open };
})(typeof self !== 'undefined' ? self : this);
