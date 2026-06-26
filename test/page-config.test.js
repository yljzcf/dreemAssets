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
