const { test } = require('node:test');
const assert = require('node:assert');
const uc = require('../src/update-check.js');

test('deriveState: no cached latest → checking', () => {
  assert.strictEqual(uc.deriveState('0.7.0', null), 'checking');
  assert.strictEqual(uc.deriveState('0.7.0', ''), 'checking');
});

test('deriveState: remote higher → update', () => {
  assert.strictEqual(uc.deriveState('0.7.0', '0.8.0'), 'update');
});

test('deriveState: equal or lower → current', () => {
  assert.strictEqual(uc.deriveState('0.7.0', '0.7.0'), 'current');
  assert.strictEqual(uc.deriveState('0.7.0', '0.6.9'), 'current');
});

test('describe: update state', () => {
  assert.deepStrictEqual(
    uc.describe({ state: 'update', local: '0.7.0', latest: '0.8.0' }),
    { emoji: '⬆️', text: '新版本可用', title: 'v0.8.0 / 当前 v0.7.0', blink: true }
  );
});

test('describe: current state shows local version', () => {
  assert.deepStrictEqual(
    uc.describe({ state: 'current', local: '0.7.0', latest: '0.7.0' }),
    { emoji: '☑️', text: 'v0.7.0', title: '当前已是最新版本', blink: false }
  );
});

test('describe: error state', () => {
  assert.deepStrictEqual(
    uc.describe({ state: 'error', local: '0.7.0', latest: null }),
    { emoji: '⚠️', text: '无法检查更新', title: '请检查网络连接', blink: false }
  );
});

test('describe: checking state has no emoji/title', () => {
  assert.deepStrictEqual(
    uc.describe({ state: 'checking', local: '0.7.0', latest: null }),
    { emoji: '', text: '检查中…', title: '', blink: false }
  );
});
