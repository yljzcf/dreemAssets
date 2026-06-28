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

// --- scanInfoPanel: fake-DOM builders mirroring the live info panel ---
function el(tag, text, props) {
  return Object.assign({ tagName: tag, textContent: text == null ? '' : text, nextElementSibling: null }, props || {});
}
function dtNode(term, value) {
  return el('DT', term, { nextElementSibling: el('DD', value) });
}
function dlNode(dts) {
  return { querySelectorAll: function (sel) { return sel === 'dt' ? dts : []; } };
}
function sectionNode(h3text, opts) {
  opts = opts || {};
  var h3 = h3text == null ? null : el('H3', h3text);
  return { querySelector: function (sel) {
    if (sel === 'h3') return h3;
    if (sel === 'dl') return opts.dl || null;
    if (sel === 'p') return opts.p != null ? el('P', opts.p) : null;
    if (sel === 'section') return opts.nested || null;
    return null;
  } };
}
function infoDoc(h2node, sections, taglineEl) {
  return {
    querySelector: function (sel) {
      if (sel === 'h2') return h2node || null;
      if (sel.indexOf('tagline') > -1) return taglineEl || null;
      return null;
    },
    querySelectorAll: function (sel) { return sel === 'section' ? sections : []; }
  };
}

test('scanInfoPanel: extracts dl field sections and pairs dt/dd', () => {
  var doc = infoDoc(el('H2', 'Janet Belle'), [
    sectionNode('Identity', { dl: dlNode([ dtNode('Age', '26'), dtNode('Gender', 'Female') ]) })
  ]);
  var info = cfg.scanInfoPanel(doc);
  assert.strictEqual(info.name, 'Janet Belle');
  assert.deepStrictEqual(info.sections, [
    { title: 'Identity', fields: [ { term: 'Age', value: '26' }, { term: 'Gender', value: 'Female' } ] }
  ]);
});

test('scanInfoPanel: skips empty (—) values and sections left with no fields', () => {
  var doc = infoDoc(el('H2', 'X'), [
    sectionNode('Identity', { dl: dlNode([ dtNode('Age', '26'), dtNode('Form', '—') ]) }),
    sectionNode('Empty', { dl: dlNode([ dtNode('Body Mark', '—') ]) })
  ]);
  var info = cfg.scanInfoPanel(doc);
  assert.deepStrictEqual(info.sections, [
    { title: 'Identity', fields: [ { term: 'Age', value: '26' } ] }
  ]);
});

test('scanInfoPanel: captures free-text sections but skips the Others placeholder', () => {
  var doc = infoDoc(el('H2', 'X'), [
    sectionNode('Others', { p: 'Add free-form notes the AI should reference when generating.' }),
    sectionNode('Notes', { p: 'Real note here.' })
  ]);
  var info = cfg.scanInfoPanel(doc);
  assert.deepStrictEqual(info.sections, [ { title: 'Notes', text: 'Real note here.' } ]);
});

test('scanInfoPanel: ignores sections without an h3 title (e.g. portrait)', () => {
  var doc = infoDoc(el('H2', 'X'), [
    sectionNode(null, { dl: dlNode([ dtNode('Age', '26') ]) }),
    sectionNode('Identity', { dl: dlNode([ dtNode('Gender', 'Female') ]) })
  ]);
  var info = cfg.scanInfoPanel(doc);
  assert.deepStrictEqual(info.sections, [ { title: 'Identity', fields: [ { term: 'Gender', value: 'Female' } ] } ]);
});

test('scanInfoPanel: reads the tagline element (class*="tagline")', () => {
  var doc = infoDoc(el('H2', 'Janet Belle'), [], el('DIV', 'The architect of every arrangement.'));
  assert.strictEqual(cfg.scanInfoPanel(doc).tagline, 'The architect of every arrangement.');
});

test('scanInfoPanel: no tagline element yields empty tagline; no h2 yields empty name', () => {
  assert.strictEqual(cfg.scanInfoPanel(infoDoc(el('H2', 'Art Academy'), [])).tagline, '');
  var info = cfg.scanInfoPanel(infoDoc(null, []));
  assert.strictEqual(info.name, '');
  assert.deepStrictEqual(info.sections, []);
});

test('scanInfoPanel: ignores the wrapper section that nests the group sections', () => {
  // The live panel wraps all groups in an outer <section>; querySelector on it resolves
  // to the FIRST h3/dl, which would phantom-duplicate the first group if not excluded.
  var idDl = dlNode([ dtNode('Age', '26') ]);
  var inner = sectionNode('Identity', { dl: idDl });
  var wrapper = sectionNode('Identity', { dl: idDl, nested: inner });
  var doc = infoDoc(el('H2', 'X'), [ wrapper, inner, sectionNode('Setting', { dl: dlNode([ dtNode('Era', 'future') ]) }) ]);
  var info = cfg.scanInfoPanel(doc);
  assert.deepStrictEqual(info.sections.map(function (s) { return s.title; }), ['Identity', 'Setting']);
});
