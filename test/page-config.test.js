const { test } = require('node:test');
const assert = require('node:assert');
const cfg = require('../src/page-config.js');

test('getRules: returns array for known types', () => {
  assert.ok(Array.isArray(cfg.getRules('character')));
  assert.ok(Array.isArray(cfg.getRules('location')));
});

test('getRules: unknown type returns empty array', () => {
  assert.deepStrictEqual(cfg.getRules('nope'), []);
});

test('getPageName: falls back to a non-empty string', () => {
  var fakeDoc = { title: 'My Character — Dreem', querySelector: function () { return null; } };
  var name = cfg.getPageName('character', fakeDoc);
  assert.strictEqual(typeof name, 'string');
  assert.ok(name.length > 0);
});

test('getRules: character has the tile rule', () => {
  var keys = cfg.getRules('character').map(function (r) { return r.key; });
  assert.deepStrictEqual(keys, ['tile']);
});

test('CATEGORIES: 5 categories with the expected keys', () => {
  assert.deepStrictEqual(cfg.CATEGORIES.map(function (c) { return c.key; }), ['face', 'body', 'mood', 'outfit', 'others']);
});

test('categoryForType: maps artifact types to categories', () => {
  assert.strictEqual(cfg.categoryForType('head_turnaround').key, 'face');
  assert.strictEqual(cfg.categoryForType('body_turnaround').key, 'body');
  assert.strictEqual(cfg.categoryForType('expressions').key, 'mood');
  assert.strictEqual(cfg.categoryForType('wardrobe').key, 'outfit');
  assert.strictEqual(cfg.categoryForType('character_other').key, 'others');
  assert.strictEqual(cfg.categoryForType('character_reference'), null); // uploaded base ref, not a tab asset
  assert.strictEqual(cfg.categoryForType('unknown_type'), null);
});

test('categoryByTabKey: maps webpage tab keys to categories', () => {
  assert.strictEqual(cfg.categoryByTabKey('moods').key, 'mood');
  assert.strictEqual(cfg.categoryByTabKey('outfits').key, 'outfit');
  assert.strictEqual(cfg.categoryByTabKey('nope'), null);
});

test('activeCategoryKey: reads the active tab id suffix', () => {
  var fakeDoc = { querySelector: function (sel) {
    return sel.indexOf('active') > -1 ? { id: 'radix-_r_k_-trigger-outfits' } : null;
  } };
  assert.strictEqual(cfg.activeCategoryKey(fakeDoc), 'outfits');
});

test('scanTiles: groups tiles by their nearest grid container', () => {
  var gridA = { className: 'flex grid gap-2', parentElement: null };
  var gridB = { className: 'flex grid gap-2', parentElement: null };
  function tile(grid, src) {
    return { currentSrc: src, src: src, naturalWidth: 100, naturalHeight: 200, parentElement: { className: 'cell', parentElement: grid } };
  }
  var els = [tile(gridA, 'blob:a1'), tile(gridA, 'blob:a2'), tile(gridB, 'blob:b1')];
  var fakeDoc = { querySelectorAll: function () { return els; } };
  var out = cfg.scanTiles(fakeDoc);
  assert.deepStrictEqual(out.map(function (t) { return t.group; }), [0, 0, 1]);
  assert.strictEqual(out[0].url, 'blob:a1');
  assert.strictEqual(out[0].width, 100);
});

test('getPageName: character uses the portrait alt as the name', () => {
  var fakeDoc = {
    title: 'Dreem Creator Studio',
    querySelector: function (sel) { return sel.indexOf('img') > -1 ? { alt: 'Leon' } : null; }
  };
  assert.strictEqual(cfg.getPageName('character', fakeDoc), 'Leon');
});
