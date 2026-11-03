(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();        // Node (tests, CommonJS)
  } else {
    root.DreemStats = factory();       // popup page
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Fallback Seedance tokens-per-second by resolution, measured on real charges (2026-11):
  // completionTokens / durationSeconds is ~21,660 at 720p and ~9,640 at 480p. A reference
  // video input (usage.videoInput) adds its own tokens: ~1.7× as many per output second.
  var TOKENS_PER_SEC = { '720p': 21660, '480p': 9640 };
  var VIDEO_INPUT_FACTOR = 1.7;
  var MIN_SAMPLES = 3;          // fewer samples than this → fall back to a coarser rate
  var MONTH_AFTER_DAYS = 60;    // longer spans are bucketed by month instead of day

  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  // Local-time day key "YYYY-MM-DD" (Date, ISO string or ms).
  function dayKey(d) {
    var t = (d instanceof Date) ? d : new Date(d);
    if (isNaN(t.getTime())) return '';
    return t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate());
  }

  // "YYYY-MM-DD" → local Date at midnight.
  function parseDay(s) {
    var m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }

  function addDays(s, n) {
    var d = parseDay(s);
    d.setDate(d.getDate() + n);
    return dayKey(d);
  }

  // Local "YYYY-MM-DD HH:mm:ss" for CSV.
  function localDateTime(iso) {
    var t = new Date(iso);
    if (isNaN(t.getTime())) return '';
    return dayKey(t) + ' ' + pad(t.getHours()) + ':' + pad(t.getMinutes()) + ':' + pad(t.getSeconds());
  }

  // One API charge → the compact record we keep (and cache). `res` is the video
  // resolution, or the image size for image charges.
  function normalize(it) {
    it = it || {};
    var u = it.usage || {};
    var type = u.type || it.outputType || '';
    return {
      id: String(it.id || ''),
      createdAt: it.createdAt || '',
      coins: num(it.coinsCharged),
      type: type,
      model: u.model || '',
      res: (type === 'image' ? (u.size || u.resolution) : (u.resolution || u.size)) || '',
      quality: u.quality || '',
      secs: num(u.durationSeconds),
      tokens: num(u.completionTokens),
      videoInput: !!u.videoInput,
      worldId: it.worldId || ''
    };
  }

  function median(arr) {
    var s = arr.slice().sort(function (a, b) { return a - b; });
    var m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  function rateKeys(r) {
    var vi = r.videoInput ? '|vi' : '';
    return { key: r.model + '|' + r.res + vi, res: r.res + vi };
  }

  // Tokens-per-second medians from videos that report both duration and tokens, per
  // model+resolution and per resolution (with/without a reference video kept apart).
  // Used to estimate older charges that predate durationSeconds (before 2026-08-08).
  function calibrate(records) {
    var byKey = {}, byRes = {};
    (records || []).forEach(function (r) {
      if (r.type !== 'video' || !(r.secs > 0) || !(r.tokens > 0)) return;
      var rate = r.tokens / r.secs, k = rateKeys(r);
      (byKey[k.key] = byKey[k.key] || []).push(rate);
      (byRes[k.res] = byRes[k.res] || []).push(rate);
    });
    var out = { byKey: {}, byRes: {} };
    Object.keys(byKey).forEach(function (k) { if (byKey[k].length >= MIN_SAMPLES) out.byKey[k] = median(byKey[k]); });
    Object.keys(byRes).forEach(function (k) { if (byRes[k].length >= MIN_SAMPLES) out.byRes[k] = median(byRes[k]); });
    return out;
  }

  function tokensPerSec(rec, calib) {
    calib = calib || { byKey: {}, byRes: {} };
    var k = rateKeys(rec);
    var fallback = (TOKENS_PER_SEC[rec.res] || 0) * (rec.videoInput ? VIDEO_INPUT_FACTOR : 1);
    return calib.byKey[k.key] || calib.byRes[k.res] || fallback;
  }

  // Video length of one record → { secs, source }, source being
  // 'actual' | 'estimated' (from tokens) | 'missing' (video, no way to tell) | 'none' (not a video).
  function effectiveSecs(rec, calib) {
    if (rec.secs > 0) return { secs: rec.secs, source: 'actual' };
    if (rec.type !== 'video') return { secs: 0, source: 'none' };
    var rate = rec.tokens > 0 ? tokensPerSec(rec, calib) : 0;
    if (rate > 0) return { secs: Math.max(1, Math.round(rec.tokens / rate)), source: 'estimated' };
    return { secs: 0, source: 'missing' };
  }

  // Preset → inclusive { from, to } day keys ('' = unbounded).
  function presetRange(preset, now) {
    var today = dayKey(now || new Date());
    switch (preset) {
      case 'today': return { from: today, to: today };
      case '7d':    return { from: addDays(today, -6), to: today };
      case '30d':   return { from: addDays(today, -29), to: today };
      case 'month': return { from: today.slice(0, 8) + '01', to: today };
      default:      return { from: '', to: '' };
    }
  }

  // Filter by inclusive local-day range and model/resolution multi-selects
  // (an empty or missing list means "all").
  function applyFilter(records, f) {
    f = f || {};
    var models = f.models || [], resolutions = f.resolutions || [];
    return (records || []).filter(function (r) {
      var d = dayKey(r.createdAt);
      if (f.from && d < f.from) return false;
      if (f.to && d > f.to) return false;
      if (models.length && models.indexOf(r.model) < 0) return false;
      if (resolutions.length && resolutions.indexOf(r.res) < 0) return false;
      return true;
    });
  }

  function summarize(records, calib) {
    var s = { coins: 0, count: 0, secs: 0, estimatedSecs: 0, estimatedCount: 0, missingCount: 0 };
    (records || []).forEach(function (r) {
      var e = effectiveSecs(r, calib);
      s.coins += r.coins;
      s.count++;
      s.secs += e.secs;
      if (e.source === 'estimated') { s.estimatedSecs += e.secs; s.estimatedCount++; }
      if (e.source === 'missing') s.missingCount++;
    });
    return s;
  }

  // Group by model × resolution, most coins first; pct is the share of coins.
  function breakdown(records, calib) {
    var groups = {}, total = 0;
    (records || []).forEach(function (r) {
      var k = r.model + '|' + r.res;
      var g = groups[k] = groups[k] || { model: r.model, res: r.res, type: r.type, count: 0, coins: 0, secs: 0, estimatedCount: 0 };
      var e = effectiveSecs(r, calib);
      g.count++;
      g.coins += r.coins;
      g.secs += e.secs;
      if (e.source === 'estimated') g.estimatedCount++;
      total += r.coins;
    });
    return Object.keys(groups).map(function (k) {
      var g = groups[k];
      g.pct = total ? g.coins / total : 0;
      return g;
    }).sort(function (a, b) { return b.coins - a.coins || b.count - a.count; });
  }

  // Continuous buckets (zeros included) from `from` to `to` (day keys): by day, or by
  // month when the span exceeds MONTH_AFTER_DAYS. → { unit, buckets:[{key,coins,count,secs}] }
  function bucketByTime(records, from, to, calib) {
    if (!from || !to || from > to) return { unit: 'day', buckets: [] };
    var span = Math.round((parseDay(to) - parseDay(from)) / 86400000) + 1;
    var unit = span > MONTH_AFTER_DAYS ? 'month' : 'day';
    var keyOf = unit === 'month' ? function (d) { return d.slice(0, 7); } : function (d) { return d; };
    var buckets = [], index = {};
    for (var d = from; d <= to; d = addDays(d, 1)) {
      var k = keyOf(d);
      if (index[k] == null) { index[k] = buckets.length; buckets.push({ key: k, coins: 0, count: 0, secs: 0 }); }
    }
    (records || []).forEach(function (r) {
      var day = dayKey(r.createdAt);
      if (day < from || day > to) return;
      var b = buckets[index[keyOf(day)]];
      b.coins += r.coins;
      b.count++;
      b.secs += effectiveSecs(r, calib).secs;
    });
    return { unit: unit, buckets: buckets };
  }

  // "480p" < "720p" < "1080p" < "1024x1024": by leading number, then text.
  function compareRes(a, b) {
    var na = parseInt(a, 10) || 0, nb = parseInt(b, 10) || 0;
    return (na - nb) || (a < b ? -1 : a > b ? 1 : 0);
  }

  // Selectable values with counts: every model in `records` (most used first), and the
  // resolutions available under the selected models (all models when none selected).
  function optionsFor(records, models) {
    models = models || [];
    var mc = {}, rc = {};
    (records || []).forEach(function (r) {
      mc[r.model] = (mc[r.model] || 0) + 1;
      if (!models.length || models.indexOf(r.model) > -1) rc[r.res] = (rc[r.res] || 0) + 1;
    });
    return {
      models: Object.keys(mc).map(function (k) { return { value: k, count: mc[k] }; })
        .sort(function (a, b) { return b.count - a.count || (a.value < b.value ? -1 : 1); }),
      resolutions: Object.keys(rc).map(function (k) { return { value: k, count: rc[k] }; })
        .sort(function (a, b) { return compareRes(a.value, b.value); })
    };
  }

  // 16946 → "4:42:26"; under an hour → "12:05".
  function formatDuration(secs) {
    secs = Math.max(0, Math.round(num(secs)));
    var h = Math.floor(secs / 3600), m = Math.floor(secs % 3600 / 60), s = secs % 60;
    return h ? (h + ':' + pad(m) + ':' + pad(s)) : (m + ':' + pad(s));
  }

  function csvCell(v) {
    var s = String(v == null ? '' : v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  var SOURCE_LABELS = { actual: '记录', estimated: '估算', missing: '无', none: '' };
  var TYPE_LABELS = { video: '视频', image: '图片' };

  // CSV with a UTF-8 BOM and CRLF rows so Excel opens the Chinese headers correctly.
  function buildCsv(records, calib) {
    var rows = [['时间', '类型', '模型', '分辨率/尺寸', '时长(秒)', '时长来源', '消耗积分', 'worldId', 'id']];
    (records || []).forEach(function (r) {
      var e = effectiveSecs(r, calib);
      rows.push([
        localDateTime(r.createdAt), TYPE_LABELS[r.type] || r.type, r.model, r.res,
        e.source === 'none' || e.source === 'missing' ? '' : e.secs, SOURCE_LABELS[e.source],
        r.coins, r.worldId, r.id
      ]);
    });
    return '﻿' + rows.map(function (row) { return row.map(csvCell).join(','); }).join('\r\n') + '\r\n';
  }

  return {
    TOKENS_PER_SEC: TOKENS_PER_SEC,
    dayKey: dayKey,
    addDays: addDays,
    normalize: normalize,
    calibrate: calibrate,
    effectiveSecs: effectiveSecs,
    presetRange: presetRange,
    applyFilter: applyFilter,
    summarize: summarize,
    breakdown: breakdown,
    bucketByTime: bucketByTime,
    optionsFor: optionsFor,
    formatDuration: formatDuration,
    buildCsv: buildCsv
  };
}));
