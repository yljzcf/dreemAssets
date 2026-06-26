const { test } = require('node:test');
const assert = require('node:assert');
const core = require('../src/lib/core.js');

test('detectPageType: character url', () => {
  assert.strictEqual(
    core.detectPageType('https://studio.dreem-world.ai/worlds/w1/characters/c1'),
    'character'
  );
});

test('detectPageType: location url', () => {
  assert.strictEqual(
    core.detectPageType('https://studio.dreem-world.ai/worlds/w1/locations/l1'),
    'location'
  );
});

test('detectPageType: ignores query and hash', () => {
  assert.strictEqual(
    core.detectPageType('https://studio.dreem-world.ai/worlds/w1/characters/c1?tab=art#top'),
    'character'
  );
});

test('detectPageType: worlds list is unknown', () => {
  assert.strictEqual(
    core.detectPageType('https://studio.dreem-world.ai/worlds/w1'),
    'unknown'
  );
});

test('detectPageType: garbage is unknown', () => {
  assert.strictEqual(core.detectPageType('not a url'), 'unknown');
});

test('sanitizeFilename: keeps CJK', () => {
  assert.strictEqual(core.sanitizeFilename('立绘'), '立绘');
});

test('sanitizeFilename: replaces illegal chars with underscore', () => {
  assert.strictEqual(core.sanitizeFilename('a/b:c*?'), 'a_b_c__');
});

test('sanitizeFilename: trims and collapses whitespace', () => {
  assert.strictEqual(core.sanitizeFilename('  hi   there  '), 'hi there');
});

test('sanitizeFilename: strips leading/trailing dots', () => {
  assert.strictEqual(core.sanitizeFilename('...x...'), 'x');
});

test('sanitizeFilename: empty falls back to image', () => {
  assert.strictEqual(core.sanitizeFilename(''), 'image');
  assert.strictEqual(core.sanitizeFilename(null), 'image');
});

test('extFromUrl: extracts extension', () => {
  assert.strictEqual(core.extFromUrl('https://cdn.x/a/b.PNG?w=200'), 'png');
  assert.strictEqual(core.extFromUrl('https://cdn.x/a/b.jpg'), 'jpg');
});

test('extFromUrl: defaults to png', () => {
  assert.strictEqual(core.extFromUrl('https://cdn.x/a/b'), 'png');
  assert.strictEqual(core.extFromUrl('garbage'), 'png');
});

test('buildFilename: combines pageName + label + ext', () => {
  assert.strictEqual(
    core.buildFilename({ pageName: '小明', label: '立绘', index: 0, ext: 'png' }),
    '小明_立绘.png'
  );
});

test('buildFilename: falls back for empty parts', () => {
  assert.strictEqual(
    core.buildFilename({ pageName: '', label: '', index: 2, ext: '' }),
    'dreem_img3.png'
  );
});

test('buildFilename: strips dot from ext', () => {
  assert.strictEqual(
    core.buildFilename({ pageName: 'a', label: 'b', index: 0, ext: '.jpg' }),
    'a_b.jpg'
  );
});

test('pickFromSrcset: picks highest w descriptor', () => {
  assert.strictEqual(core.pickFromSrcset('a.jpg 320w, b.jpg 640w'), 'b.jpg');
});

test('pickFromSrcset: picks highest x descriptor', () => {
  assert.strictEqual(core.pickFromSrcset('a.jpg 1x, b.jpg 2x'), 'b.jpg');
});

test('pickFromSrcset: single url no descriptor', () => {
  assert.strictEqual(core.pickFromSrcset('a.jpg'), 'a.jpg');
});

test('pickFromSrcset: empty returns empty string', () => {
  assert.strictEqual(core.pickFromSrcset(''), '');
  assert.strictEqual(core.pickFromSrcset(null), '');
});

test('pickFromSrcset: tolerates extra whitespace', () => {
  assert.strictEqual(core.pickFromSrcset('  a.jpg   100w ,  b.jpg   200w '), 'b.jpg');
});
