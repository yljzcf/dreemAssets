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

test('artifactLabel: maps known artifact types to labels', () => {
  assert.strictEqual(cfg.artifactLabel('wardrobe'), '穿搭');
  assert.strictEqual(cfg.artifactLabel('head_turnaround'), '头部转身');
  assert.strictEqual(cfg.artifactLabel('expressions'), '表情');
});

test('artifactLabel: unknown type falls back to the raw type string', () => {
  assert.strictEqual(cfg.artifactLabel('something_new'), 'something_new');
});

test('getPageName: character uses the portrait alt as the name', () => {
  var fakeDoc = {
    title: 'Dreem Creator Studio',
    querySelector: function (sel) { return sel.indexOf('img') > -1 ? { alt: 'Leon' } : null; }
  };
  assert.strictEqual(cfg.getPageName('character', fakeDoc), 'Leon');
});
