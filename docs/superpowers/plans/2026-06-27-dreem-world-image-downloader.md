# Dreem-World 图片下载扩展 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个 Manifest V3 Chrome 扩展，在用户已登录 dreem-world studio 的情况下，下载当前角色/场景页面上固定位置的图片，支持打包 ZIP、全部单独下载、单张下载。

**Architecture:** 无构建工具的原生 JS 扩展。共享纯逻辑放在 `src/lib/core.js`，用 UMD 包装，使同一文件可在 Node 测试中 `require`、在 popup 里用 `<script>`、作为内容脚本注入、在 service worker 里 `importScripts`。内容脚本通过声明式 `content_scripts` 注入并用消息通信返回图片描述符；下载与 ZIP 打包在 background service worker 中完成（popup 关闭也不中断）。

**Tech Stack:** Chrome MV3、原生 JS、JSZip（本地打包）、Node 内置 `node --test`（零依赖单元测试）。

---

## 测试说明

- **可单元测试（TDD）**：`src/lib/core.js` 中的纯函数 —— `detectPageType`、`sanitizeFilename`、`buildFilename`、`extFromUrl`、`pickFromSrcset`、`extractImages`（用手写的假 document/element 测试，无需 jsdom）。
- **手动验证**：manifest 装载、popup 渲染、content/background 消息、`chrome.downloads`、JSZip 打包、以及真实选择器 —— 通过 `chrome://extensions` 加载未打包扩展，在真实页面验证（探查阶段进行）。
- 运行单元测试：项目根目录执行 `node --test`（需要 Node 18+）。

## 文件结构

```
downloadMo/
  manifest.json              # MV3 配置：权限、content_scripts、background、action
  package.json               # {"scripts":{"test":"node --test"}}
  .gitignore
  src/
    popup.html               # popup 标记，按顺序加载 core.js → page-config.js → popup.js
    popup.css                # popup 样式
    popup.js                 # 经典脚本：扫描当前页 → 渲染列表 → 绑定按钮 → 给 background 发消息
    content.js               # 注入页面：监听 'scan'，用 core+config 提取图片，回传描述符
    background.js            # 经典 SW：importScripts jszip+core；处理 download / zip 消息
    page-config.js           # 【可扩展核心】EXTRACTORS（每类页面规则）+ getRules + getPageName；规则在探查阶段填充
    lib/
      core.js                # UMD：detectPageType / sanitizeFilename / buildFilename / extFromUrl / pickFromSrcset / extractImages
      jszip.min.js           # 本地打包的 JSZip（UMD）
  test/
    core.test.js             # core.js 的 node:test 单元测试
  docs/superpowers/...
```

> 图标：MV3 中 `icons` 与 `action.default_icon` 均可省略（Chrome 用默认图标），本期不引用图标文件以保证可装载；如需自定义图标列为后续可选项。

---

### Task 1: 项目脚手架

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `src/lib/jszip.min.js`（下载获取）
- Create: `test/.gitkeep`（占位，确保 `node --test` 有目录）

- [ ] **Step 1: 创建 `package.json`**

```json
{
  "name": "dreem-world-image-downloader",
  "version": "0.1.0",
  "private": true,
  "description": "下载 dreem-world studio 角色/场景页面的指定图片的 Chrome 扩展",
  "scripts": {
    "test": "node --test"
  }
}
```

- [ ] **Step 2: 创建 `.gitignore`**

```gitignore
node_modules/
*.log
.DS_Store
*.zip
```

- [ ] **Step 3: 下载 JSZip 到本地**

Run:
```bash
curl -L -o src/lib/jszip.min.js https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js
```
Expected: 文件存在且非空。验证：
```bash
head -c 200 src/lib/jszip.min.js
```
Expected: 看到 JSZip 版权/UMD 头部文本（包含 "JSZip"）。

- [ ] **Step 4: 创建测试目录占位**

```bash
mkdir -p test && touch test/.gitkeep
```

- [ ] **Step 5: 初始化 git 并提交**

```bash
cd E:/claudeCowork/downloadMo && git init && git add -A && git commit -m "chore: scaffold project (package.json, gitignore, vendored JSZip)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 6: 提交设计与计划文档**

```bash
git add docs && git commit -m "docs: add design spec and implementation plan

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: core.js — `detectPageType`（TDD）

**Files:**
- Create: `src/lib/core.js`
- Test: `test/core.test.js`

- [ ] **Step 1: 写失败的测试**（创建 `test/core.test.js`）

```js
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test`
Expected: FAIL —— 报错 `Cannot find module '../src/lib/core.js'`（文件尚不存在）。

- [ ] **Step 3: 写最小实现**（创建 `src/lib/core.js`，含 UMD 包装）

```js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();        // Node（测试，CommonJS）
  } else {
    root.DreemCore = factory();        // 浏览器页面 / 内容脚本 / service worker
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function detectPageType(url) {
    let pathname;
    try {
      pathname = new URL(url).pathname;
    } catch (e) {
      return 'unknown';
    }
    if (/\/worlds\/[^/]+\/characters\/[^/]+/.test(pathname)) return 'character';
    if (/\/worlds\/[^/]+\/locations\/[^/]+/.test(pathname)) return 'location';
    return 'unknown';
  }

  return { detectPageType: detectPageType };
}));
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test`
Expected: PASS —— detectPageType 的 5 个测试全部通过。

- [ ] **Step 5: 提交**

```bash
git add src/lib/core.js test/core.test.js && git commit -m "feat(core): add detectPageType

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: core.js — 文件名工具 `sanitizeFilename` / `extFromUrl` / `buildFilename`（TDD）

**Files:**
- Modify: `src/lib/core.js`
- Test: `test/core.test.js`（追加）

- [ ] **Step 1: 追加失败的测试**（在 `test/core.test.js` 末尾追加）

```js
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test`
Expected: FAIL —— `core.sanitizeFilename is not a function` 等。

- [ ] **Step 3: 写实现**（修改 `src/lib/core.js`，在 `detectPageType` 之后、`return` 之前加入这三个函数，并加入 return 导出）

```js
  function sanitizeFilename(name) {
    var cleaned = String(name == null ? '' : name)
      .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')   // 非法字符 → _
      .replace(/\s+/g, ' ')                       // 折叠空白
      .trim()
      .replace(/^[.\s]+|[.\s]+$/g, '');           // 去掉首尾的点/空格（Windows）
    return cleaned || 'image';
  }

  function extFromUrl(url) {
    try {
      var path = new URL(url, 'https://x.invalid').pathname;
      var m = path.match(/\.([a-zA-Z0-9]{1,5})$/);
      return m ? m[1].toLowerCase() : 'png';
    } catch (e) {
      return 'png';
    }
  }

  function buildFilename(ctx) {
    ctx = ctx || {};
    var base = sanitizeFilename(ctx.pageName || 'dreem');
    var label = sanitizeFilename(ctx.label || ('img' + (((ctx.index || 0)) + 1)));
    var ext = sanitizeFilename(String(ctx.ext || 'png')).replace(/^\.+/, '') || 'png';
    return base + '_' + label + '.' + ext;
  }
```

并把 return 改为：

```js
  return {
    detectPageType: detectPageType,
    sanitizeFilename: sanitizeFilename,
    extFromUrl: extFromUrl,
    buildFilename: buildFilename
  };
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test`
Expected: PASS —— 全部通过（含之前 detectPageType 的测试）。

- [ ] **Step 5: 提交**

```bash
git add src/lib/core.js test/core.test.js && git commit -m "feat(core): add filename utilities

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: core.js — `pickFromSrcset`（TDD）

**Files:**
- Modify: `src/lib/core.js`
- Test: `test/core.test.js`（追加）

- [ ] **Step 1: 追加失败的测试**

```js
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test`
Expected: FAIL —— `core.pickFromSrcset is not a function`。

- [ ] **Step 3: 写实现**（加入函数并导出）

```js
  function pickFromSrcset(srcset) {
    if (!srcset || typeof srcset !== 'string') return '';
    var candidates = srcset.split(',').map(function (s) { return s.trim(); })
      .filter(Boolean)
      .map(function (part) {
        var bits = part.split(/\s+/);
        var url = bits[0];
        var desc = bits[1];
        var weight = 1;
        if (desc) {
          var m = desc.match(/^([\d.]+)([wx])$/);
          if (m) weight = parseFloat(m[1]);
        }
        return { url: url, weight: weight };
      });
    if (!candidates.length) return '';
    return candidates.reduce(function (a, b) { return b.weight > a.weight ? b : a; }).url;
  }
```

在 return 对象中加入 `pickFromSrcset: pickFromSrcset`。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/lib/core.js test/core.test.js && git commit -m "feat(core): add pickFromSrcset

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: core.js — `extractImages` 提取引擎（TDD）

**Files:**
- Modify: `src/lib/core.js`
- Test: `test/core.test.js`（追加）

引擎契约：`extractImages(doc, rules, ctx)` —— `doc` 是带 `querySelector/querySelectorAll` 的对象；`rules` 是规则数组，每条 `{ key, label, selector, getUrl, upgrade?, multiple? }`；`ctx = { pageName }`。返回去重后的描述符数组 `{ key, label, url, filename, width, height }`。规则元素缺失时跳过（不报错）。

- [ ] **Step 1: 追加失败的测试**

```js
// 构造假 document / element 的小工具
function fakeEl(props) {
  return Object.assign({ src: '', srcset: '', naturalWidth: null, naturalHeight: null,
    getAttribute: function (n) { return this['attr_' + n] || null; } }, props);
}
function fakeDoc(map) {
  // map: { selector: element | [elements] }
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
  assert.strictEqual(out[0].filename, 'x_画廊_1.png');
  assert.strictEqual(out[1].filename, 'x_画廊_2.png');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test`
Expected: FAIL —— `core.extractImages is not a function`。

- [ ] **Step 3: 写实现**（加入函数并导出）

```js
  function extractImages(doc, rules, ctx) {
    var out = [];
    var seen = {};
    var pageName = (ctx && ctx.pageName) || 'dreem';
    (rules || []).forEach(function (rule) {
      var els = [];
      try {
        if (rule.multiple) {
          var nodeList = doc.querySelectorAll(rule.selector);
          els = nodeList ? Array.prototype.slice.call(nodeList) : [];
        } else {
          var el = doc.querySelector(rule.selector);
          if (el) els = [el];
        }
      } catch (e) { els = []; }

      els.forEach(function (el, i) {
        var url = '';
        try { url = rule.getUrl ? rule.getUrl(el) : (el.src || ''); } catch (e) { url = ''; }
        if (rule.upgrade && url) {
          try { url = rule.upgrade(url) || url; } catch (e) { /* keep url */ }
        }
        if (!url || seen[url]) return;
        seen[url] = true;
        var label = rule.multiple ? ((rule.label || rule.key) + '_' + (i + 1)) : (rule.label || rule.key);
        out.push({
          key: rule.key,
          label: rule.label || rule.key,
          url: url,
          filename: buildFilename({ pageName: pageName, label: label, index: i, ext: extFromUrl(url) }),
          width: el.naturalWidth || null,
          height: el.naturalHeight || null
        });
      });
    });
    return out;
  }
```

在 return 对象中加入 `extractImages: extractImages`。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test`
Expected: PASS —— 全部通过。

- [ ] **Step 5: 提交**

```bash
git add src/lib/core.js test/core.test.js && git commit -m "feat(core): add extractImages engine

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: page-config.js — 可扩展规则表（探查前的空骨架）

**Files:**
- Create: `src/page-config.js`
- Test: `test/page-config.test.js`

此文件持有每类页面的提取规则。探查阶段会向 `EXTRACTORS.character` / `EXTRACTORS.location` 追加规则对象。现在先建立结构与访问函数，规则数组为空（此时扩展可装载、popup 会显示"未找到图片"，属正常）。

- [ ] **Step 1: 写失败的测试**（创建 `test/page-config.test.js`）

```js
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test`
Expected: FAIL —— `Cannot find module '../src/page-config.js'`。

- [ ] **Step 3: 写实现**（创建 `src/page-config.js`，UMD 包装）

```js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DreemPageConfig = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 每条规则形如：
  // { key, label, selector, getUrl(el)->url, upgrade?(url)->url, multiple? }
  // 探查阶段向下面两个数组追加规则。
  var EXTRACTORS = {
    character: [],
    location: []
  };

  function getRules(pageType) {
    return EXTRACTORS[pageType] || [];
  }

  // 页面名（用于文件名前缀）。探查阶段可为每类页面提供更精确的选择器。
  function getPageName(pageType, doc) {
    try {
      var title = (doc && doc.title) ? String(doc.title).split('—')[0].split('|')[0].trim() : '';
      return title || 'dreem';
    } catch (e) {
      return 'dreem';
    }
  }

  return { EXTRACTORS: EXTRACTORS, getRules: getRules, getPageName: getPageName };
}));
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/page-config.js test/page-config.test.js && git commit -m "feat(config): add page-config skeleton with empty extractor rules

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: manifest.json

**Files:**
- Create: `manifest.json`

- [ ] **Step 1: 写 manifest**

```json
{
  "manifest_version": 3,
  "name": "Dreem 图片下载",
  "version": "0.1.0",
  "description": "下载 dreem-world studio 角色/场景页面上的指定图片，支持打包或分张下载。",
  "permissions": ["downloads"],
  "host_permissions": ["https://studio.dreem-world.ai/*"],
  "action": {
    "default_popup": "src/popup.html",
    "default_title": "Dreem 图片下载"
  },
  "background": {
    "service_worker": "src/background.js"
  },
  "content_scripts": [
    {
      "matches": ["https://studio.dreem-world.ai/worlds/*"],
      "js": ["src/lib/core.js", "src/page-config.js", "src/content.js"],
      "run_at": "document_idle"
    }
  ]
}
```

> 说明：`background` 不设 `"type":"module"`，使其为经典 SW，可用 `importScripts`。探查阶段若发现图片在不同 CDN 域，再向 `host_permissions` 追加该域（ZIP 打包的 fetch 需要它；单张下载走 `chrome.downloads` 不受影响）。

- [ ] **Step 2: 校验 JSON 合法**

Run: `node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('manifest OK')"`
Expected: 输出 `manifest OK`。

- [ ] **Step 3: 提交**

```bash
git add manifest.json && git commit -m "feat: add MV3 manifest

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: content.js — 扫描并回传描述符

**Files:**
- Create: `src/content.js`

content.js 与 `core.js`、`page-config.js` 在同一内容脚本世界中按顺序加载，可直接用 `DreemCore` / `DreemPageConfig` 全局。监听来自 popup 的 `{type:'scan'}`，自检页面类型并回传描述符。手动验证（Task 11 装载后）。

- [ ] **Step 1: 写实现**

```js
(function () {
  'use strict';

  function scan() {
    var type = DreemCore.detectPageType(location.href);
    if (type === 'unknown') {
      return { ok: false, reason: 'not-target-page', pageType: type };
    }
    var rules = DreemPageConfig.getRules(type);
    var pageName = DreemPageConfig.getPageName(type, document);
    var images = DreemCore.extractImages(document, rules, { pageName: pageName });
    // dry-run 调试：把结果打到 console，便于探查阶段核对选择器
    try { console.log('[Dreem下载] 页面类型=' + type + ' 提取到 ' + images.length + ' 张:', images); } catch (e) {}
    return { ok: true, pageType: type, pageName: pageName, images: images };
  }

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (msg && msg.type === 'scan') {
      try {
        sendResponse(scan());
      } catch (e) {
        sendResponse({ ok: false, reason: 'scan-error', error: String(e) });
      }
    }
    return false; // 同步响应
  });
})();
```

- [ ] **Step 2: 提交**

```bash
git add src/content.js && git commit -m "feat(content): scan page and return image descriptors on message

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: background.js — 下载与 ZIP 打包

**Files:**
- Create: `src/background.js`

经典 SW，`importScripts` 加载 JSZip 与 core。处理两类消息：`{type:'download', images}`（逐张走 `chrome.downloads`，覆盖"单张"与"全部单独"）、`{type:'zip', images, zipName}`（fetch 字节 → JSZip → base64 data URL → `chrome.downloads`）。手动验证。

- [ ] **Step 1: 写实现**

```js
/* global importScripts, JSZip, DreemCore */
importScripts('lib/jszip.min.js', 'lib/core.js');

function downloadOne(image) {
  return new Promise(function (resolve) {
    chrome.downloads.download({ url: image.url, filename: image.filename }, function (id) {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, filename: image.filename, error: chrome.runtime.lastError.message });
      } else {
        resolve({ ok: true, filename: image.filename, id: id });
      }
    });
  });
}

function arrayBufferToBase64(buf) {
  var bytes = new Uint8Array(buf);
  var binary = '';
  var chunk = 0x8000;
  for (var i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function makeZip(images, zipName) {
  var zip = new JSZip();
  var failures = [];
  for (var i = 0; i < images.length; i++) {
    var img = images[i];
    try {
      var resp = await fetch(img.url, { credentials: 'include' });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      var buf = await resp.arrayBuffer();
      zip.file(img.filename, buf);
    } catch (e) {
      failures.push({ filename: img.filename, error: String(e) });
    }
  }
  var base64 = await zip.generateAsync({ type: 'base64' });
  var dataUrl = 'data:application/zip;base64,' + base64;
  var name = DreemCore.sanitizeFilename(zipName || 'dreem-images') + '.zip';
  await new Promise(function (resolve) {
    chrome.downloads.download({ url: dataUrl, filename: name }, function () { resolve(); });
  });
  return { ok: true, failures: failures };
}

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg) return false;

  if (msg.type === 'download') {
    Promise.all((msg.images || []).map(downloadOne)).then(function (results) {
      sendResponse({ ok: true, results: results });
    });
    return true; // 异步响应
  }

  if (msg.type === 'zip') {
    makeZip(msg.images || [], msg.zipName).then(function (r) {
      sendResponse(r);
    }).catch(function (e) {
      sendResponse({ ok: false, error: String(e) });
    });
    return true; // 异步响应
  }

  return false;
});
```

- [ ] **Step 2: 提交**

```bash
git add src/background.js && git commit -m "feat(background): single/all downloads and ZIP packaging

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 10: popup（HTML/CSS/JS）

**Files:**
- Create: `src/popup.html`
- Create: `src/popup.css`
- Create: `src/popup.js`

popup 打开即扫描当前标签页，渲染图片列表与顶部两个按钮。手动验证。

- [ ] **Step 1: 写 `src/popup.html`**（按顺序加载脚本，经典 script）

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="popup.css">
</head>
<body>
  <header class="hdr">
    <span class="title">Dreem 图片下载</span>
    <span id="pageType" class="badge">检测中…</span>
  </header>

  <div id="topActions" class="top-actions" hidden>
    <button id="btnZip" class="btn primary">打包下载 ZIP</button>
    <button id="btnAll" class="btn">全部单独下载</button>
  </div>

  <div id="status" class="status">正在扫描页面…</div>
  <ul id="list" class="list"></ul>

  <script src="popup.js"></script>
</body>
</html>
```

> popup.js 自身不做页面检测/提取（那是内容脚本的职责），因此 popup.html 无需加载 core.js / page-config.js。

- [ ] **Step 2: 写 `src/popup.css`**

```css
:root { color-scheme: light dark; }
body { width: 340px; margin: 0; font: 13px/1.4 system-ui, "Microsoft YaHei", sans-serif; }
.hdr { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; border-bottom: 1px solid rgba(128,128,128,.3); }
.title { font-weight: 600; }
.badge { font-size: 12px; padding: 2px 8px; border-radius: 10px; background: rgba(128,128,128,.2); }
.top-actions { display: flex; gap: 8px; padding: 10px 12px; }
.btn { flex: 1; padding: 8px 10px; border: 1px solid rgba(128,128,128,.4); border-radius: 6px; background: transparent; cursor: pointer; font-size: 13px; }
.btn:hover { background: rgba(128,128,128,.12); }
.btn.primary { background: #2563eb; color: #fff; border-color: #2563eb; }
.btn.primary:hover { background: #1d4ed8; }
.status { padding: 10px 12px; color: #888; }
.status.error { color: #c0392b; }
.list { list-style: none; margin: 0; padding: 0 6px 10px; max-height: 420px; overflow-y: auto; }
.item { display: flex; align-items: center; gap: 10px; padding: 8px 6px; border-bottom: 1px solid rgba(128,128,128,.15); }
.thumb { width: 56px; height: 56px; object-fit: cover; border-radius: 4px; background: rgba(128,128,128,.15); flex: none; }
.meta { flex: 1; min-width: 0; }
.meta .label { font-weight: 600; }
.meta .dim { color: #888; font-size: 12px; }
.item .btn { flex: none; width: auto; padding: 6px 10px; }
```

- [ ] **Step 3: 写 `src/popup.js`**

```js
(function () {
  'use strict';

  var statusEl = document.getElementById('status');
  var listEl = document.getElementById('list');
  var topActions = document.getElementById('topActions');
  var pageTypeEl = document.getElementById('pageType');
  var btnZip = document.getElementById('btnZip');
  var btnAll = document.getElementById('btnAll');

  var currentImages = [];
  var currentPageName = 'dreem';

  var TYPE_LABEL = { character: '角色页', location: '场景页', unknown: '非目标页' };

  function setStatus(text, isError) {
    statusEl.textContent = text;
    statusEl.className = 'status' + (isError ? ' error' : '');
    statusEl.hidden = !text;
  }

  function sendToBackground(message) {
    return new Promise(function (resolve) {
      chrome.runtime.sendMessage(message, function (resp) { resolve(resp); });
    });
  }

  function renderList(images) {
    listEl.innerHTML = '';
    images.forEach(function (img, idx) {
      var li = document.createElement('li');
      li.className = 'item';

      var thumb = document.createElement('img');
      thumb.className = 'thumb';
      thumb.src = img.url;
      thumb.alt = img.label;
      thumb.onerror = function () { thumb.style.visibility = 'hidden'; };

      var meta = document.createElement('div');
      meta.className = 'meta';
      var dim = (img.width && img.height) ? (img.width + '×' + img.height) : '';
      meta.innerHTML = '<div class="label"></div><div class="dim"></div>';
      meta.querySelector('.label').textContent = img.label;
      meta.querySelector('.dim').textContent = dim;

      var btn = document.createElement('button');
      btn.className = 'btn';
      btn.textContent = '下载';
      btn.addEventListener('click', function () {
        btn.disabled = true;
        sendToBackground({ type: 'download', images: [img] }).then(function () {
          btn.textContent = '已下载';
        });
      });

      li.appendChild(thumb);
      li.appendChild(meta);
      li.appendChild(btn);
      listEl.appendChild(li);
    });
  }

  function init() {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var tab = tabs && tabs[0];
      if (!tab) { setStatus('无法获取当前标签页', true); return; }

      chrome.tabs.sendMessage(tab.id, { type: 'scan' }, function (resp) {
        if (chrome.runtime.lastError || !resp) {
          pageTypeEl.textContent = '非目标页';
          setStatus('请在 dreem-world 的角色或场景页面打开本扩展。', true);
          return;
        }
        pageTypeEl.textContent = TYPE_LABEL[resp.pageType] || '非目标页';

        if (!resp.ok) {
          setStatus('请在角色或场景页面打开本扩展。', true);
          return;
        }

        currentImages = resp.images || [];
        currentPageName = resp.pageName || 'dreem';

        if (currentImages.length === 0) {
          setStatus('未找到图片，页面结构可能已变更（可打开控制台查看 [Dreem下载] 日志）。', true);
          return;
        }

        setStatus('', false);
        topActions.hidden = false;
        renderList(currentImages);
      });
    });
  }

  btnAll.addEventListener('click', function () {
    if (!currentImages.length) return;
    btnAll.disabled = true;
    sendToBackground({ type: 'download', images: currentImages }).then(function () {
      btnAll.textContent = '已全部下载';
      btnAll.disabled = false;
    });
  });

  btnZip.addEventListener('click', function () {
    if (!currentImages.length) return;
    btnZip.disabled = true;
    var orig = btnZip.textContent;
    btnZip.textContent = '打包中…';
    sendToBackground({ type: 'zip', images: currentImages, zipName: currentPageName }).then(function (r) {
      btnZip.textContent = (r && r.failures && r.failures.length) ? ('完成（' + r.failures.length + ' 张失败）') : '已打包';
      btnZip.disabled = false;
      setTimeout(function () { btnZip.textContent = orig; }, 2500);
    });
  });

  init();
})();
```

- [ ] **Step 4: 提交**

```bash
git add src/popup.html src/popup.css src/popup.js && git commit -m "feat(popup): scan, list images, wire download/zip buttons

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 11: 装载与冒烟测试（手动）

**Files:** 无（验证步骤）

- [ ] **Step 1: 运行全部单元测试**

Run: `node --test`
Expected: PASS —— core 与 page-config 测试全部通过。

- [ ] **Step 2: 加载未打包扩展**

在 Chrome 打开 `chrome://extensions` → 打开右上角"开发者模式" → "加载已解压的扩展程序" → 选择 `E:\claudeCowork\downloadMo`。
Expected: 扩展出现且无报错（点"错误"应为空）。

- [ ] **Step 3: 在目标页打开 popup**

确保已登录，打开任一 `https://studio.dreem-world.ai/worlds/*/characters/*` 页面。**注意：加载未打包扩展后，需刷新该页面一次**，否则内容脚本尚未注入，popup 会误报"非目标页"。刷新后点击扩展图标。
Expected（探查前的正常状态）：页面类型徽章显示"角色页"；因 `EXTRACTORS.character` 仍为空，状态显示"未找到图片…"。这证明管线打通、只差规则。

- [ ] **Step 4: 在非目标页验证**

打开 `https://example.com` → 点击扩展图标。
Expected：徽章显示"非目标页"，提示在角色/场景页打开。

- [ ] **Step 5: 提交（如有微调）**

```bash
git add -A && git commit -m "chore: smoke-test fixes after load-unpacked

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```
（若无改动可跳过。）

---

### Task 12: 探查阶段 —— 填充角色页规则（交互式，由 Claude 驱动 Chrome）

**Files:**
- Modify: `src/page-config.js`（向 `EXTRACTORS.character` 追加规则）

此阶段用浏览器控制工具在用户已登录的 Chrome 中实地探查。**每发现一个固定图片槽位即追加一条规则并回归测试。**

- [ ] **Step 1: 验证 Chrome 连接**

用浏览器工具列出/连接到用户的 Chrome，确认能读取已登录的 dreem-world 标签页（导航 + 读取 DOM）。
Expected: 能拿到目标页的 DOM/网络信息。

- [ ] **Step 2: 实地探查角色页结构**

在样本角色页上：
- 用 DOM 检查定位固定位置图片元素（记录稳定的 CSS 选择器）。
- 确认取值方式：`el.src` / `el.srcset`（用 `DreemCore.pickFromSrcset`）/ 背景图 / `data-*` 属性。
- 查网络请求，确认是否存在更高清/原图 URL（如去掉 `?w=NNN` 参数、改路径段），据此写 `upgrade`。
- 确认页面名来源（角色名标题选择器），必要时在 `getPageName` 为 character 分支增加更精确选择器。

- [ ] **Step 3: 向 `EXTRACTORS.character` 追加规则**

按真实选择器写入规则对象（示例形态，探查后以实际值替换）：

```js
character: [
  {
    key: 'portrait',
    label: '立绘',
    selector: '/* 探查得到的真实选择器 */',
    getUrl: function (el) { return el.currentSrc || el.src; },
    upgrade: function (u) { return u.replace(/[?&]w=\d+/g, ''); }
  }
  // …按需追加更多固定槽位
]
```

- [ ] **Step 4: 回归验证（≥2 个角色页）**

重新加载扩展 → 在两个不同角色页打开 popup。
Expected: 列表展示预期的固定位置图片，缩略图可见（若因鉴权 cookie 不随扩展 `<img>` 发送导致缩略图裂图，记录此现象，下载仍应可用，因为 `chrome.downloads` 与 background fetch 走 cookie 罐）。逐一测试：单张「下载」、「全部单独下载」、「打包下载 ZIP」，打开 ZIP 核对文件名与内容。
Expected: 三种下载均成功；ZIP 内文件名形如 `角色名_立绘.png`。

- [ ] **Step 5: 如需，追加图片 CDN 域到 host_permissions**

若图片域不同于 `studio.dreem-world.ai` 且 ZIP fetch 失败（CORS/凭证），在 `manifest.json` 的 `host_permissions` 追加该域并重载扩展，重测 ZIP。

- [ ] **Step 6: 提交**

```bash
git add src/page-config.js manifest.json && git commit -m "feat(config): add character page extraction rules

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 13: 探查阶段 —— 填充场景页规则（交互式）

**Files:**
- Modify: `src/page-config.js`（向 `EXTRACTORS.location` 追加规则）

- [ ] **Step 1: 实地探查场景页结构**

在样本 `https://studio.dreem-world.ai/worlds/*/locations/*` 页重复 Task 12 的探查方法：定位固定图片槽位、取值方式、原图升级、页面名来源。

- [ ] **Step 2: 向 `EXTRACTORS.location` 追加规则**

按真实选择器写入（形态同 Task 12 Step 3，键值依场景页实际内容命名，如 `key:'scene', label:'场景图'`）。

- [ ] **Step 3: 回归验证（≥2 个场景页）**

重新加载扩展 → 在两个场景页打开 popup → 测试单张/全部/ZIP 三种下载。
Expected: 列表与下载均正确；文件名形如 `场景名_场景图.png`。

- [ ] **Step 4: 提交**

```bash
git add src/page-config.js && git commit -m "feat(config): add location page extraction rules

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## 完成标准（Definition of Done）

- `node --test` 全绿。
- 扩展可在 `chrome://extensions` 无错装载。
- 在真实角色页与场景页：popup 正确列出固定位置图片；单张下载、全部单独下载、打包 ZIP 均工作；ZIP 内文件名规范（`页面名_标签.ext`）。
- 非目标页给出清晰提示。
- 所有规则集中在 `src/page-config.js`，新增页面类型只需追加一条 `EXTRACTORS` 规则（架构预留批量模式扩展点）。
