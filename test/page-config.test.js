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

test('getDerived: character derives a source-sheet descriptor from tile metrics', () => {
  var fakeDoc = {
    querySelectorAll: function (sel) {
      if (sel.indexOf('Tile') > -1) return [
        { naturalWidth: 949, naturalHeight: 1280 },
        { naturalWidth: 971, naturalHeight: 1280 },
        { naturalWidth: 968, naturalHeight: 1280 },
        { naturalWidth: 952, naturalHeight: 1280 }
      ];
      return [];
    }
  };
  var d = cfg.getDerived('character', fakeDoc, 'Leon');
  assert.strictEqual(d.length, 1);
  assert.strictEqual(d[0].kind, 'sourcesheet');
  assert.strictEqual(d[0].width, 3840);
  assert.strictEqual(d[0].height, 1280);
  assert.strictEqual(d[0].filename, 'Leon_主图.png');
});

test('getDerived: no tiles means no source sheet', () => {
  var fakeDoc = { querySelectorAll: function () { return []; } };
  assert.deepStrictEqual(cfg.getDerived('character', fakeDoc, 'x'), []);
});

test('getPageName: character uses the portrait alt as the name', () => {
  var fakeDoc = {
    title: 'Dreem Creator Studio',
    querySelector: function (sel) { return sel.indexOf('img') > -1 ? { alt: 'Leon' } : null; }
  };
  assert.strictEqual(cfg.getPageName('character', fakeDoc), 'Leon');
});
