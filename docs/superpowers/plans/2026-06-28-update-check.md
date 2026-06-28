# 启动时检查远端更新 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 打开扩展 popup 时检查 GitHub 远端仓库版本，在首行左侧以「GitHub 图标 + emoji + 文字」紧凑显示有更新/无更新/无法连接，有更新时图标脉冲闪烁、点击跳转仓库。

**Architecture:** 一个无依赖的纯逻辑 UMD 模块 `src/update-check.js`（`DreemUpdateCheck`）负责取本地/远端版本、6 小时节流、localStorage 缓存，并暴露两个纯函数 `deriveState`（版本 → 状态）和 `describe`（状态 → 显示字段）供单测；版本比较函数 `compareVersions` 下沉到 `src/lib/core.js`。`popup.js` 在 `init()` 起始处先用缓存即时渲染、再后台刷新；header 改为 CSS Grid `1fr auto 1fr` 三栏（左:更新状态 / 中:标题 / 右:下载按钮）。

**Tech Stack:** 原生 ES5 JavaScript（无构建）、Chrome MV3、`node --test` 单元测试、`fetch` + `localStorage`。

参考设计：[`docs/superpowers/specs/2026-06-28-update-check-design.md`](../specs/2026-06-28-update-check-design.md)

---

## File Structure

| 文件 | 改动 | 职责 |
|---|---|---|
| `src/lib/core.js` | 修改 | 新增并导出纯函数 `compareVersions(a,b)` |
| `test/core.test.js` | 修改 | `compareVersions` 单测 |
| `src/update-check.js` | **新建** | `DreemUpdateCheck`：`repoUrl/current/getCached/check`（副作用）+ `deriveState/describe`（纯函数） |
| `test/update-check.test.js` | **新建** | `deriveState` + `describe` 单测 |
| `manifest.json` | 修改 | `host_permissions` 增加 `https://raw.githubusercontent.com/*` |
| `src/popup.html` | 修改 | header 三栏 + 左侧更新状态区 + 引入 `update-check.js` |
| `src/popup.css` | 修改 | header 改 grid、`.update-status` 系列样式、`@keyframes ghpulse` |
| `src/popup.js` | 修改 | `renderUpdate` + `init()` 接入 + 图标点击打开仓库 |
| `README.md` | 修改 | 文档化功能与新增 host 权限 |

---

## Task 1: `compareVersions` 纯函数（core.js）

**Files:**
- Modify: `src/lib/core.js`（在 `extractImages` 之后、`return {…}` 之前新增函数；并加入导出对象）
- Test: `test/core.test.js`（文件末尾追加）

- [ ] **Step 1: 追加失败测试**

在 `test/core.test.js` 文件末尾追加：

```js
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
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `node --test test/core.test.js`
Expected: FAIL —— `core.compareVersions is not a function`（TypeError）。

- [ ] **Step 3: 实现 `compareVersions`**

在 `src/lib/core.js` 中，`extractImages` 函数定义结束（第 111 行 `}` 之后）、`return {` 之前，插入：

```js
  // Compare dotted numeric versions ("0.7.0"). Missing/non-numeric segments
  // count as 0. Returns 1 if a>b, -1 if a<b, 0 if equal.
  function compareVersions(a, b) {
    var pa = String(a == null ? '' : a).split('.');
    var pb = String(b == null ? '' : b).split('.');
    var n = Math.max(pa.length, pb.length);
    for (var i = 0; i < n; i++) {
      var na = parseInt(pa[i], 10) || 0;
      var nb = parseInt(pb[i], 10) || 0;
      if (na > nb) return 1;
      if (na < nb) return -1;
    }
    return 0;
  }
```

并在 `return { … }` 导出对象中加入一行（放在 `extractImages: extractImages` 之后）：

```js
    extractImages: extractImages,
    compareVersions: compareVersions
```

（即把原本 `extractImages: extractImages` 行尾补上逗号，并新增 `compareVersions` 行。）

- [ ] **Step 4: 运行测试，确认通过**

Run: `node --test test/core.test.js`
Expected: PASS —— 原有用例 + 5 个新 `compareVersions` 用例全部通过。

- [ ] **Step 5: 提交**

```bash
git add src/lib/core.js test/core.test.js
git commit -m "feat(core): add compareVersions util with tests" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `update-check.js` 模块 + 纯逻辑测试 + host 权限

**Files:**
- Create: `src/update-check.js`
- Create: `test/update-check.test.js`
- Modify: `manifest.json:7`（`host_permissions` 数组）

- [ ] **Step 1: 新建失败测试 `test/update-check.test.js`**

```js
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
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `node --test test/update-check.test.js`
Expected: FAIL —— `Cannot find module '../src/update-check.js'`。

- [ ] **Step 3: 新建 `src/update-check.js`**

```js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./lib/core.js'));  // Node (tests)
  } else {
    root.DreemUpdateCheck = factory(root.DreemCore);     // popup page
  }
}(typeof self !== 'undefined' ? self : this, function (DreemCore) {
  'use strict';

  var REPO_URL = 'https://github.com/yljzcf/dreemAssets';
  var MANIFEST_URL = 'https://raw.githubusercontent.com/yljzcf/dreemAssets/main/manifest.json';
  var CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;   // throttle: at most once / 6h
  var LS_LAST = 'dreemUpdate.lastCheck';         // last network check timestamp (ms)
  var LS_LATEST = 'dreemUpdate.latest';          // last seen remote version string

  function repoUrl() { return REPO_URL; }

  function current() {
    try { return chrome.runtime.getManifest().version; } catch (e) { return '0.0.0'; }
  }

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }

  // Pure: local + cached remote → state.
  function deriveState(local, latest) {
    if (!latest) return 'checking';
    return DreemCore.compareVersions(latest, local) > 0 ? 'update' : 'current';
  }

  // Pure: status object → display fields for the header status area.
  function describe(info) {
    var local = (info && info.local) || '';
    var latest = (info && info.latest) || '';
    switch (info && info.state) {
      case 'update':  return { emoji: '⬆️', text: '新版本可用', title: 'v' + latest + ' / 当前 v' + local, blink: true };
      case 'current': return { emoji: '☑️', text: 'v' + local, title: '当前已是最新版本', blink: false };
      case 'error':   return { emoji: '⚠️', text: '无法检查更新', title: '请检查网络连接', blink: false };
      default:        return { emoji: '', text: '检查中…', title: '', blink: false };
    }
  }

  // Sync read of cache → renders instantly (no network).
  function getCached() {
    var local = current();
    var latest = lsGet(LS_LATEST);
    return { state: deriveState(local, latest), local: local, latest: latest };
  }

  // Throttled network refresh. Never rejects: failures resolve to state 'error'.
  function check() {
    var local = current();
    var latest = lsGet(LS_LATEST);
    var last = parseInt(lsGet(LS_LAST), 10) || 0;
    var now = Date.now();
    if (latest && (now - last) < CHECK_INTERVAL_MS) {
      return Promise.resolve({ state: deriveState(local, latest), local: local, latest: latest });
    }
    return fetch(MANIFEST_URL, { cache: 'no-store' })
      .then(function (resp) {
        if (!resp.ok) throw new Error('http-' + resp.status);
        return resp.json();
      })
      .then(function (json) {
        var remote = json && json.version;
        if (!remote) throw new Error('no-version');
        lsSet(LS_LATEST, remote);
        lsSet(LS_LAST, String(now));
        return { state: deriveState(local, remote), local: local, latest: remote };
      })
      .catch(function (e) {
        try { console.warn('[Dreem下载] 检查更新失败:', String(e)); } catch (x) { /* ignore */ }
        return { state: 'error', local: local, latest: latest };
      });
  }

  return {
    repoUrl: repoUrl,
    current: current,
    deriveState: deriveState,
    describe: describe,
    getCached: getCached,
    check: check
  };
}));
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `node --test test/update-check.test.js`
Expected: PASS —— 7 个用例全部通过（`deriveState` 与 `describe` 为纯函数，不触碰 `chrome`/`localStorage`/`fetch`）。

- [ ] **Step 5: 修改 `manifest.json` 增加 host 权限**

将 `manifest.json` 第 7 行：

```json
  "host_permissions": ["https://studio.dreem-world.ai/*", "https://*.cloudfront.net/*"],
```

改为：

```json
  "host_permissions": ["https://studio.dreem-world.ai/*", "https://*.cloudfront.net/*", "https://raw.githubusercontent.com/*"],
```

- [ ] **Step 6: 运行全部测试，确认无回归**

Run: `node --test`
Expected: PASS —— core + update-check 全部用例通过（原 37 + 新 5 + 新 7 = 49）。

- [ ] **Step 7: 提交**

```bash
git add src/update-check.js test/update-check.test.js manifest.json
git commit -m "feat: add DreemUpdateCheck module + raw.githubusercontent host permission" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: 把更新状态接入 popup UI

无 Node 单测（与现有 `popup.js`/`content.js` 一致，靠浏览器手动验证）。先改 HTML 结构，再改样式，再接 JS，最后加载验证。

**Files:**
- Modify: `src/popup.html`（header 结构 + 脚本引入）
- Modify: `src/popup.css`（header grid + 状态区样式）
- Modify: `src/popup.js`（元素引用 + `renderUpdate` + `init()` 接入 + 图标点击）

- [ ] **Step 1: 改 `src/popup.html` 的 header**

把第 8–11 行：

```html
  <header class="hdr">
    <span id="pageType" class="status-label">检测中…</span>
    <button id="btnAssets" class="btn primary" hidden>下载资产包</button>
  </header>
```

替换为：

```html
  <header class="hdr">
    <div id="updateStatus" class="update-status">
      <span id="ghLink" class="gh-link" role="button" tabindex="0" title="打开 GitHub 仓库" aria-label="打开 GitHub 仓库">
        <svg class="gh-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path fill-rule="evenodd" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
        </svg>
      </span>
      <span id="updateEmoji" class="update-emoji" aria-hidden="true"></span>
      <span id="updateText" class="update-text"></span>
    </div>
    <span id="pageType" class="status-label">检测中…</span>
    <button id="btnAssets" class="btn primary" hidden>下载资产包</button>
  </header>
```

并在脚本区把：

```html
  <script src="lib/core.js"></script>
  <script src="page-config.js"></script>
  <script src="popup.js"></script>
```

改为（在 core.js 之后引入 update-check.js，因其依赖 `DreemCore`）：

```html
  <script src="lib/core.js"></script>
  <script src="update-check.js"></script>
  <script src="page-config.js"></script>
  <script src="popup.js"></script>
```

- [ ] **Step 2: 改 `src/popup.css` 的 header 与状态区**

把第 4–5 行：

```css
.hdr { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 12px; border-bottom: 1px solid rgba(128,128,128,.3); }
.status-label { font-weight: 600; }
```

替换为：

```css
.hdr { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid rgba(128,128,128,.3); }
.status-label { justify-self: center; font-weight: 600; }
#btnAssets { justify-self: end; }

/* left zone: GitHub update status (icon + emoji + text) */
.update-status { justify-self: start; display: flex; align-items: center; gap: 5px; font-size: 12px; white-space: nowrap; color: #888; }
.gh-link { display: inline-flex; cursor: pointer; color: inherit; }
.gh-icon { width: 16px; height: 16px; fill: currentColor; display: block; }
.update-emoji { line-height: 1; }
.update-text { color: #888; }

@keyframes ghpulse { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
.update-status.has-update .gh-icon { animation: ghpulse 1.1s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .update-status.has-update .gh-icon { animation: none; } }
```

- [ ] **Step 3: 在 `src/popup.js` 增加元素引用**

在第 4–8 行的 `getElementById` 块（`var listEl = …;` 之后）追加：

```js
  var updateStatusEl = document.getElementById('updateStatus');
  var updateEmojiEl = document.getElementById('updateEmoji');
  var updateTextEl = document.getElementById('updateText');
  var ghLinkEl = document.getElementById('ghLink');
```

- [ ] **Step 4: 在 `src/popup.js` 增加 `renderUpdate`**

在 `setStatus` 函数定义（约第 52–56 行）之后插入：

```js
  function renderUpdate(info) {
    var d = DreemUpdateCheck.describe(info);
    updateEmojiEl.textContent = d.emoji;
    updateTextEl.textContent = d.text;
    if (d.title) updateStatusEl.setAttribute('title', d.title);
    else updateStatusEl.removeAttribute('title');
    updateStatusEl.classList.toggle('has-update', d.blink);
  }
```

- [ ] **Step 5: 在 `init()` 起始处接入检查**

把 `async function init() {` 之后的第一行（原本是 `var tabs = await new Promise(...)`）前面插入两行，使开头变为：

```js
  async function init() {
    renderUpdate(DreemUpdateCheck.getCached());
    DreemUpdateCheck.check().then(renderUpdate);

    var tabs = await new Promise(function (r) { chrome.tabs.query({ active: true, currentWindow: true }, r); });
```

（放在所有提前 `return` 之前，保证非目标页也显示更新状态。）

- [ ] **Step 6: 绑定 GitHub 图标点击打开仓库**

在底部 `btnAssets.addEventListener(...)` 块之后、`init();` 调用之前插入：

```js
  function openRepo() { chrome.tabs.create({ url: DreemUpdateCheck.repoUrl() }); }
  ghLinkEl.addEventListener('click', openRepo);
  ghLinkEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openRepo(); }
  });
```

- [ ] **Step 7: 测试无回归 + 浏览器冒烟验证**

Run: `node --test`
Expected: PASS（49 用例，UI 改动不影响 Node 测试）。

浏览器冒烟：`chrome://extensions` → 重新加载本扩展 → 打开任意页面的 popup：
- 首行左侧出现 GitHub 图标 + emoji + 文字；中间标题居中；右侧（目标页时）`下载资产包` 按钮。
- 控制台无报错。

- [ ] **Step 8: 提交**

```bash
git add src/popup.html src/popup.css src/popup.js
git commit -m "feat(popup): show GitHub update status in header (icon + emoji + text, pulse on update)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: README 文档化

**Files:**
- Modify: `README.md`（功能亮点、架构表、权限说明）

- [ ] **Step 1: 在「✨ 功能亮点」列表新增一项**

在 `README.md` 第 18 行 `- **零构建、零追踪**：…` 之后追加：

```markdown
- **更新提示**：打开扩展时自动检查 GitHub 是否有新版本（节流，最多每 6 小时一次），在首行左侧以「GitHub 图标 + 状态」显示（有更新时图标闪烁），点击图标跳转仓库。
```

- [ ] **Step 2: 在「架构」文件表新增一行**

在 `README.md` 架构表中 `src/page-config.js` 那一行之后追加：

```markdown
| `src/update-check.js` | 更新检查（UMD）：取本地/远端 `manifest.json` 版本、6h 节流、`localStorage` 缓存；纯函数 `deriveState`/`describe`/`compareVersions` 可在 Node 测试。 |
```

- [ ] **Step 3: 更新「权限」说明**

把 `README.md` 中：

```markdown
**权限**：`scripting`（取 token）；`host_permissions`：`studio.dreem-world.ai`、`*.cloudfront.net`。
```

改为：

```markdown
**权限**：`scripting`（取 token）；`host_permissions`：`studio.dreem-world.ai`、`*.cloudfront.net`、`raw.githubusercontent.com`（读取远端 `manifest.json` 版本以检查更新）。
```

- [ ] **Step 4: 提交**

```bash
git add README.md
git commit -m "docs: document startup update-check feature and new host permission" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: 完整手动验证（四种状态 + 闪烁 + 点击）

无代码改动、无提交。临时改动用于测试，验证后必须还原。

- [ ] **Step 1: 无更新（基线）**

`chrome://extensions` 重新加载扩展 → 打开 popup（任意页面）。
Expected: 左侧 `[GH] ☑️ v0.7.0`，hover `#updateStatus` 显示「当前已是最新版本」，图标不闪。
（首次打开若无缓存会先闪过「检查中…」，联网后变为 ☑️。）

- [ ] **Step 2: 有更新（临时调低本地版本）**

临时把 `manifest.json` 的 `"version": "0.7.0"` 改为 `"0.6.0"` → `chrome://extensions` 重新加载 → 打开 popup。
Expected: 左侧 `[GH] ⬆️ 新版本可用`，GitHub 图标**脉冲闪烁**，hover 显示 `v0.7.0 / 当前 v0.6.0`。
验证后**把版本改回 `0.7.0`** 并重新加载（必须还原，勿提交此改动）。

> 提示：若上一步刚联网过、6h 内不会再请求；调低版本后状态由 `deriveState(local, 缓存latest)` 重新派生，仍会立即显示「有更新」，无需等待联网。

- [ ] **Step 3: 无法连接**

断开网络（或 DevTools Network 选 Offline）→ 清掉缓存以强制联网：在 popup 的 DevTools Console 执行
`localStorage.removeItem('dreemUpdate.lastCheck'); localStorage.removeItem('dreemUpdate.latest');`
→ 重新打开 popup。
Expected: 左侧 `[GH] ⚠️ 无法检查更新`，hover「请检查网络连接」，图标不闪。恢复网络后重开恢复正常。

- [ ] **Step 4: 点击图标跳转**

点击 GitHub 图标。
Expected: 新标签打开 `https://github.com/yljzcf/dreemAssets`。

- [ ] **Step 5: 减少动态效果**

系统开启「减少动态效果」（Windows：设置 → 辅助功能 → 视觉效果 → 动画效果关闭）→ 在「有更新」状态下打开 popup。
Expected: 图标**不闪**（`prefers-reduced-motion` 生效），其余显示不变。

- [ ] **Step 6: 确认工作区干净**

Run: `git status`
Expected: working tree clean（Task 2 步骤里临时调低的版本号已还原；无未提交改动）。

---

## Self-Review（plan 对照 spec）

- **Spec 覆盖**：触发时机/信号/节流（Task 2 `check`）、四状态文案与 hover（Task 2 `describe` + 单测）、三栏 header（Task 3 CSS/HTML）、图标点击（Task 3 Step 6）、闪烁 + reduced-motion（Task 3 CSS）、host 权限（Task 2 Step 5）、错误静默（Task 2 `check.catch`）、测试（Task 1/2 单测 + Task 5 手动）、README（Task 4）—— 均有对应任务。
- **占位符**：无 TODO/TBD；所有代码块为完整可粘贴内容。
- **类型/命名一致**：`compareVersions`（core）、`deriveState`/`describe`/`getCached`/`check`/`repoUrl`/`current`（DreemUpdateCheck）、`renderUpdate`（popup）；元素 id `updateStatus/ghLink/updateEmoji/updateText/pageType/btnAssets`；class `update-status/gh-link/gh-icon/update-emoji/update-text/has-update`；localStorage 键 `dreemUpdate.lastCheck`/`dreemUpdate.latest` —— 全文一致。
- **依赖**：`DreemUpdateCheck.deriveState` 依赖 `DreemCore.compareVersions`（Task 1 先于 Task 2）；popup.html 在 `lib/core.js` 后引入 `update-check.js`（Task 3）；`describe`/`deriveState` 不触碰 `chrome`/`fetch`/`localStorage`，故 Node 可测。
