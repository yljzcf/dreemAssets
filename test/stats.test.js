const { test } = require('node:test');
const assert = require('node:assert');
const stats = require('../src/lib/stats.js');

// ISO timestamp for a local date/time, so tests pass in any TZ.
function at(y, mo, d, h) { return new Date(y, mo - 1, d, h || 12).toISOString(); }

function rec(o) {
  return Object.assign({ id: 'x', createdAt: at(2026, 11, 3), coins: 10, type: 'video', model: 'seedance-2-5', res: '720p', quality: '', secs: 0, tokens: 0, videoInput: false, worldId: '' }, o);
}

test('normalize: video charge', () => {
  const r = stats.normalize({
    id: 'c1', createdAt: '2026-11-02T12:11:12.801Z', coinsCharged: 75, outputType: 'video', worldId: null,
    usage: { type: 'video', model: 'seedance-2-5', resolution: '480p', durationSeconds: 4, completionTokens: '38520', videoInput: true }
  });
  assert.deepStrictEqual(r, {
    id: 'c1', createdAt: '2026-11-02T12:11:12.801Z', coins: 75, type: 'video', model: 'seedance-2-5',
    res: '480p', quality: '', secs: 4, tokens: 38520, videoInput: true, worldId: ''
  });
});

test('normalize: image charge uses size as res', () => {
  const r = stats.normalize({ id: 'c2', coinsCharged: 15, outputType: 'image', usage: { type: 'image', model: 'gpt-image', size: '1024x1024', quality: 'high' } });
  assert.strictEqual(r.res, '1024x1024');
  assert.strictEqual(r.quality, 'high');
  assert.strictEqual(r.secs, 0);
});

test('normalize: falls back to outputType when usage.type is absent', () => {
  assert.strictEqual(stats.normalize({ outputType: 'video', usage: {} }).type, 'video');
});

test('effectiveSecs: actual duration wins', () => {
  assert.deepStrictEqual(stats.effectiveSecs(rec({ secs: 8, tokens: 999999 })), { secs: 8, source: 'actual' });
});

test('effectiveSecs: estimates from tokens with the fallback rate', () => {
  assert.deepStrictEqual(stats.effectiveSecs(rec({ tokens: 21660 * 5 })), { secs: 5, source: 'estimated' });
  assert.deepStrictEqual(stats.effectiveSecs(rec({ res: '480p', tokens: 9640 * 10 })), { secs: 10, source: 'estimated' });
});

test('effectiveSecs: -1 duration is treated as missing and estimated', () => {
  assert.deepStrictEqual(stats.effectiveSecs(rec({ secs: -1, tokens: 21660 * 4 })), { secs: 4, source: 'estimated' });
});

test('effectiveSecs: video with no tokens is missing, image is none', () => {
  assert.deepStrictEqual(stats.effectiveSecs(rec({})), { secs: 0, source: 'missing' });
  assert.deepStrictEqual(stats.effectiveSecs(rec({ res: '1080p', tokens: 5000 })), { secs: 0, source: 'missing' });
  assert.deepStrictEqual(stats.effectiveSecs(rec({ type: 'image', res: '1024x1024' })), { secs: 0, source: 'none' });
});

test('calibrate: per model+res median, needs enough samples', () => {
  const rs = [
    rec({ model: 'm', res: '720p', secs: 10, tokens: 200000 }),
    rec({ model: 'm', res: '720p', secs: 10, tokens: 210000 }),
    rec({ model: 'm', res: '720p', secs: 5, tokens: 500000 }),   // outlier, median ignores it
    rec({ model: 'n', res: '480p', secs: 4, tokens: 40000 })     // only one sample
  ];
  const c = stats.calibrate(rs);
  assert.strictEqual(c.byKey['m|720p'], 21000);
  assert.strictEqual(c.byKey['n|480p'], undefined);
  assert.strictEqual(c.byRes['720p'], 21000);
  // m|720p uses its calibrated rate; n|480p falls back to the built-in constant
  assert.strictEqual(stats.effectiveSecs(rec({ model: 'm', tokens: 21000 * 6 }), c).secs, 6);
  assert.strictEqual(stats.effectiveSecs(rec({ model: 'n', res: '480p', tokens: 9640 * 7 }), c).secs, 7);
});

test('calibrate: reference-video charges get their own rate', () => {
  const rs = [];
  for (let i = 0; i < 3; i++) rs.push(rec({ secs: 10, tokens: 216600 }));
  for (let i = 0; i < 3; i++) rs.push(rec({ secs: 10, tokens: 368220, videoInput: true }));
  const c = stats.calibrate(rs);
  assert.strictEqual(c.byKey['seedance-2-5|720p'], 21660);
  assert.strictEqual(c.byKey['seedance-2-5|720p|vi'], 36822);
  assert.strictEqual(stats.effectiveSecs(rec({ tokens: 36822 * 8, videoInput: true }), c).secs, 8);
  assert.strictEqual(stats.effectiveSecs(rec({ tokens: 21660 * 8 }), c).secs, 8);
});

test('effectiveSecs: reference-video fallback scales the built-in rate', () => {
  assert.strictEqual(stats.effectiveSecs(rec({ tokens: 21660 * 1.7 * 6, videoInput: true })).secs, 6);
});

test('presetRange: today, 7d, 30d, month, all', () => {
  const now = new Date(2026, 10, 3, 9);
  assert.deepStrictEqual(stats.presetRange('today', now), { from: '2026-11-03', to: '2026-11-03' });
  assert.deepStrictEqual(stats.presetRange('7d', now), { from: '2026-10-28', to: '2026-11-03' });
  assert.deepStrictEqual(stats.presetRange('30d', now), { from: '2026-10-05', to: '2026-11-03' });
  assert.deepStrictEqual(stats.presetRange('month', now), { from: '2026-11-01', to: '2026-11-03' });
  assert.deepStrictEqual(stats.presetRange('all', now), { from: '', to: '' });
});

test('applyFilter: inclusive local-day range', () => {
  const rs = [
    rec({ id: 'a', createdAt: at(2026, 10, 31, 23) }),
    rec({ id: 'b', createdAt: at(2026, 11, 1, 0) }),
    rec({ id: 'c', createdAt: at(2026, 11, 3, 23) }),
    rec({ id: 'd', createdAt: at(2026, 11, 4, 0) })
  ];
  const ids = stats.applyFilter(rs, { from: '2026-11-01', to: '2026-11-03' }).map(r => r.id);
  assert.deepStrictEqual(ids, ['b', 'c']);
  assert.strictEqual(stats.applyFilter(rs, {}).length, 4);
});

test('applyFilter: model and resolution multi-select', () => {
  const rs = [
    rec({ id: 'a', model: 'm1', res: '480p' }),
    rec({ id: 'b', model: 'm1', res: '720p' }),
    rec({ id: 'c', model: 'm2', res: '720p' }),
    rec({ id: 'd', model: 'm3', res: '720p' })
  ];
  assert.deepStrictEqual(stats.applyFilter(rs, { models: ['m1', 'm2'] }).map(r => r.id), ['a', 'b', 'c']);
  assert.deepStrictEqual(stats.applyFilter(rs, { models: ['m1'], resolutions: ['720p'] }).map(r => r.id), ['b']);
  assert.deepStrictEqual(stats.applyFilter(rs, { models: [], resolutions: ['720p'] }).map(r => r.id), ['b', 'c', 'd']);
});

test('summarize: totals, estimated and missing counts', () => {
  const s = stats.summarize([
    rec({ coins: 40, secs: 10 }),
    rec({ coins: 20, tokens: 21660 * 5 }),
    rec({ coins: 9 }),
    rec({ coins: 15, type: 'image', res: '1024x1024' })
  ]);
  assert.deepStrictEqual(s, { coins: 84, count: 4, secs: 15, estimatedSecs: 5, estimatedCount: 1, missingCount: 1 });
});

test('summarize: empty', () => {
  assert.deepStrictEqual(stats.summarize([]), { coins: 0, count: 0, secs: 0, estimatedSecs: 0, estimatedCount: 0, missingCount: 0 });
});

test('breakdown: groups by model × res, sorted by coins, with share', () => {
  const g = stats.breakdown([
    rec({ model: 'a', res: '480p', coins: 10, secs: 4 }),
    rec({ model: 'a', res: '480p', coins: 10, secs: 6 }),
    rec({ model: 'b', res: '720p', coins: 60, tokens: 21660 * 3 }),
    rec({ model: 'a', res: '720p', coins: 20, secs: 2 })
  ]);
  assert.deepStrictEqual(g.map(x => [x.model, x.res, x.count, x.coins, x.secs, x.estimatedCount]), [
    ['b', '720p', 1, 60, 3, 1],
    ['a', '480p', 2, 20, 10, 0],
    ['a', '720p', 1, 20, 2, 0]
  ]);
  assert.strictEqual(g[0].pct, 0.6);
  assert.strictEqual(stats.breakdown([]).length, 0);
});

test('bucketByTime: daily buckets include empty days', () => {
  const r = stats.bucketByTime([
    rec({ createdAt: at(2026, 11, 1), coins: 5, secs: 4 }),
    rec({ createdAt: at(2026, 11, 3), coins: 7, secs: 6 }),
    rec({ createdAt: at(2026, 11, 3), coins: 1, secs: 1 }),
    rec({ createdAt: at(2026, 11, 9), coins: 100 })   // outside range
  ], '2026-11-01', '2026-11-03');
  assert.strictEqual(r.unit, 'day');
  assert.deepStrictEqual(r.buckets, [
    { key: '2026-11-01', coins: 5, count: 1, secs: 4 },
    { key: '2026-11-02', coins: 0, count: 0, secs: 0 },
    { key: '2026-11-03', coins: 8, count: 2, secs: 7 }
  ]);
});

test('bucketByTime: switches to months for long spans', () => {
  const r = stats.bucketByTime([
    rec({ createdAt: at(2026, 6, 14), coins: 3 }),
    rec({ createdAt: at(2026, 8, 31), coins: 4 }),
    rec({ createdAt: at(2026, 8, 1), coins: 5 })
  ], '2026-06-14', '2026-11-03');
  assert.strictEqual(r.unit, 'month');
  assert.deepStrictEqual(r.buckets.map(b => [b.key, b.coins]), [
    ['2026-06', 3], ['2026-07', 0], ['2026-08', 9], ['2026-09', 0], ['2026-10', 0], ['2026-11', 0]
  ]);
});

test('bucketByTime: 60 days stays daily, empty range is empty', () => {
  assert.strictEqual(stats.bucketByTime([], '2026-09-05', '2026-11-03').unit, 'day');
  assert.strictEqual(stats.bucketByTime([], '2026-09-05', '2026-11-03').buckets.length, 60);
  assert.deepStrictEqual(stats.bucketByTime([], '', ''), { unit: 'day', buckets: [] });
});

test('optionsFor: resolutions follow the selected models', () => {
  const rs = [
    rec({ model: 'seedance-2', res: '720p' }),
    rec({ model: 'seedance-2', res: '720p' }),
    rec({ model: 'seedance-2-5', res: '480p' }),
    rec({ model: 'seedance-2-5', res: '720p' }),
    rec({ model: 'gpt-image', res: '1024x1024', type: 'image' })
  ];
  const all = stats.optionsFor(rs, []);
  assert.deepStrictEqual(all.models.map(o => [o.value, o.count]), [['seedance-2', 2], ['seedance-2-5', 2], ['gpt-image', 1]]);
  assert.deepStrictEqual(all.resolutions.map(o => o.value), ['480p', '720p', '1024x1024']);
  assert.deepStrictEqual(stats.optionsFor(rs, ['seedance-2']).resolutions.map(o => [o.value, o.count]), [['720p', 2]]);
});

test('formatDuration', () => {
  assert.strictEqual(stats.formatDuration(0), '0:00');
  assert.strictEqual(stats.formatDuration(65), '1:05');
  assert.strictEqual(stats.formatDuration(16906), '4:41:46');
});

test('buildCsv: BOM, header, escaping and duration source', () => {
  const csv = stats.buildCsv([
    rec({ id: 'a', createdAt: at(2026, 11, 3, 10), model: 'm,1', coins: 20, secs: 8 }),
    rec({ id: 'b', createdAt: at(2026, 11, 2, 9), model: 'say "hi"', coins: 9, tokens: 21660 * 4 }),
    rec({ id: 'c', type: 'image', res: '1024x1024', coins: 15 })
  ]);
  assert.ok(csv.startsWith('﻿时间,类型,模型,分辨率/尺寸,时长(秒),时长来源,消耗积分,worldId,id\r\n'));
  const lines = csv.slice(1).trim().split('\r\n');
  assert.strictEqual(lines.length, 4);
  assert.strictEqual(lines[1], '2026-11-03 10:00:00,视频,"m,1",720p,8,记录,20,,a');
  assert.strictEqual(lines[2], '2026-11-02 09:00:00,视频,"say ""hi""",720p,4,估算,9,,b');
  assert.ok(lines[3].endsWith(',图片,seedance-2-5,1024x1024,,,15,,c'));
});
