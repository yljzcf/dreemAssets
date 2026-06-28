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

test('urlPath: ignores query so the same file behind different signed URLs matches', () => {
  var a = core.urlPath('https://d1.cloudfront.net/assets/uuid-abc.png?Expires=1&Signature=x');
  var b = core.urlPath('https://d1.cloudfront.net/assets/uuid-abc.png?Expires=2&Signature=y');
  assert.strictEqual(a, b);
  assert.strictEqual(a, '/assets/uuid-abc.png');
});

test('urlPath: different files yield different paths', () => {
  assert.notStrictEqual(core.urlPath('https://x/y/a.png?s=1'), core.urlPath('https://x/y/b.png?s=1'));
});

test('urlPath: garbage yields empty string', () => {
  assert.strictEqual(core.urlPath(''), '');
  assert.strictEqual(core.urlPath(null), '');
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

// helpers to build fake document / element
function fakeEl(props) {
  return Object.assign({ src: '', srcset: '', naturalWidth: null, naturalHeight: null,
    getAttribute: function (n) { return this['attr_' + n] || null; } }, props);
}
function fakeDoc(map) {
  return {
    querySelector: function (sel) {
      var v = map[sel];
      if (v == null) return null;
      return Array.isArray(v) ? (v[0] || null) : v;
    },
    querySelectorAll: function (sel) {
      var v = map[sel];
      if (v == null) return [];
      return Array.isArray(v) ? v : [v];
    }
  };
}

test('extractImages: single rule produces one descriptor', () => {
  var doc = fakeDoc({ 'img.portrait': fakeEl({ src: 'https://cdn.x/p.png', naturalWidth: 1024, naturalHeight: 1024 }) });
  var rules = [{ key: 'portrait', label: '立绘', selector: 'img.portrait', getUrl: function (el) { return el.src; } }];
  var out = core.extractImages(doc, rules, { pageName: '小明' });
  assert.strictEqual(out.length, 1);
  assert.deepStrictEqual(
    { key: out[0].key, label: out[0].label, url: out[0].url, filename: out[0].filename, width: out[0].width, height: out[0].height },
    { key: 'portrait', label: '立绘', url: 'https://cdn.x/p.png', filename: '小明_立绘.png', width: 1024, height: 1024 }
  );
});

test('extractImages: missing element is skipped', () => {
  var doc = fakeDoc({});
  var rules = [{ key: 'portrait', label: '立绘', selector: 'img.portrait', getUrl: function (el) { return el.src; } }];
  assert.deepStrictEqual(core.extractImages(doc, rules, { pageName: 'x' }), []);
});

test('extractImages: upgrade transforms url', () => {
  var doc = fakeDoc({ 'img.a': fakeEl({ src: 'https://cdn.x/a.png?w=200' }) });
  var rules = [{ key: 'a', label: 'A', selector: 'img.a',
    getUrl: function (el) { return el.src; },
    upgrade: function (u) { return u.replace(/\?w=\d+/, ''); } }];
  var out = core.extractImages(doc, rules, { pageName: 'x' });
  assert.strictEqual(out[0].url, 'https://cdn.x/a.png');
});

test('extractImages: dedupes same url across rules', () => {
  var el = fakeEl({ src: 'https://cdn.x/same.png' });
  var doc = fakeDoc({ 'img.a': el, 'img.b': el });
  var rules = [
    { key: 'a', label: 'A', selector: 'img.a', getUrl: function (el) { return el.src; } },
    { key: 'b', label: 'B', selector: 'img.b', getUrl: function (el) { return el.src; } }
  ];
  var out = core.extractImages(doc, rules, { pageName: 'x' });
  assert.strictEqual(out.length, 1);
});

test('extractImages: multiple:true yields indexed labels', () => {
  var doc = fakeDoc({ 'img.gallery': [ fakeEl({ src: 'https://cdn.x/1.png' }), fakeEl({ src: 'https://cdn.x/2.png' }) ] });
  var rules = [{ key: 'gallery', label: '画廊', selector: 'img.gallery', multiple: true, getUrl: function (el) { return el.src; } }];
  var out = core.extractImages(doc, rules, { pageName: 'x' });
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[0].label, '画廊 1');
  assert.strictEqual(out[1].label, '画廊 2');
  assert.strictEqual(out[0].filename, 'x_画廊_1.png');
  assert.strictEqual(out[1].filename, 'x_画廊_2.png');
});

test('extractImages: unloaded image (naturalWidth 0) yields null dimensions', () => {
  var doc = fakeDoc({ 'img.a': fakeEl({ src: 'https://cdn.x/a.png', naturalWidth: 0, naturalHeight: 0 }) });
  var rules = [{ key: 'a', label: 'A', selector: 'img.a', getUrl: function (el) { return el.src; } }];
  var out = core.extractImages(doc, rules, { pageName: 'x' });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].width, null);
  assert.strictEqual(out[0].height, null);
});

test('extractImages: getUrl returning empty string skips the element', () => {
  var doc = fakeDoc({ 'img.a': fakeEl({ src: '' }) });
  var rules = [{ key: 'a', label: 'A', selector: 'img.a', getUrl: function (el) { return el.src; } }];
  assert.deepStrictEqual(core.extractImages(doc, rules, { pageName: 'x' }), []);
});

test('compareVersions: equal versions', () => {
  assert.strictEqual(core.compareVersions('0.7.0', '0.7.0'), 0);
});

test('compareVersions: patch difference', () => {
  assert.strictEqual(core.compareVersions('0.7.1', '0.7.0'), 1);
  assert.strictEqual(core.compareVersions('0.7.0', '0.7.1'), -1);
});

test('compareVersions: minor and major difference', () => {
  assert.strictEqual(core.compareVersions('0.8.0', '0.7.9'), 1);
  assert.strictEqual(core.compareVersions('1.0.0', '0.9.9'), 1);
});

test('compareVersions: different segment counts', () => {
  assert.strictEqual(core.compareVersions('0.7', '0.7.0'), 0);
  assert.strictEqual(core.compareVersions('0.7.1', '0.7'), 1);
});

test('compareVersions: null/garbage treated as 0', () => {
  assert.strictEqual(core.compareVersions(null, '0.0.0'), 0);
  assert.strictEqual(core.compareVersions('1.0.0', null), 1);
  assert.strictEqual(core.compareVersions('x.y', '0.0'), 0);
});

test('buildInfoMarkdown: renders name, tagline, field sections and free-text sections', () => {
  var md = core.buildInfoMarkdown({
    name: 'Janet Belle',
    tagline: 'The architect of every arrangement.',
    sections: [
      { title: 'Identity', fields: [ { term: 'Age', value: '26' }, { term: 'Gender', value: 'Female' } ] },
      { title: 'Others', text: 'Some free notes.' }
    ]
  });
  assert.strictEqual(md,
    '# Janet Belle\n\n' +
    '> The architect of every arrangement.\n\n' +
    '## Identity\n\n' +
    '- **Age:** 26\n' +
    '- **Gender:** Female\n\n' +
    '## Others\n\n' +
    'Some free notes.\n'
  );
});

test('buildInfoMarkdown: omits tagline blockquote when absent', () => {
  var md = core.buildInfoMarkdown({ name: 'Art Academy', sections: [ { title: 'Identity', fields: [ { term: 'Type', value: 'academic institution' } ] } ] });
  assert.ok(md.indexOf('\n>') === -1, 'no blockquote line');
  assert.ok(md.indexOf('# Art Academy\n\n## Identity') === 0, 'name directly followed by first section');
});

test('buildInfoMarkdown: empty/missing info falls back to a dreem heading', () => {
  assert.strictEqual(core.buildInfoMarkdown({}), '# dreem\n');
  assert.strictEqual(core.buildInfoMarkdown(), '# dreem\n');
});

test('buildInfoMarkdown: ends with exactly one trailing newline', () => {
  var md = core.buildInfoMarkdown({ name: 'X', sections: [ { title: 'A', fields: [ { term: 't', value: 'v' } ] } ] });
  assert.ok(/[^\n]\n$/.test(md), 'single trailing newline');
  assert.ok(!/\n\n$/.test(md), 'not a blank line at the end');
});
