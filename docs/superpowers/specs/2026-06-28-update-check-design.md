# 启动时检查远端更新 — 设计文档

- 日期：2026-06-28
- 状态：待评审
- 关联：[[downloadMo-extension]]、`README.md`

## 背景与目标

本扩展以**未打包扩展**形式分发（从 GitHub clone/下载后在 `chrome://extensions` 加载），因此**没有 Chrome 应用商店的自动更新**。用户无从得知仓库已发布新版本，只能手动定期去看。

**目标**：打开扩展 popup 时自动检查 GitHub 远端仓库是否有更新，并在 popup 首行以紧凑的状态区提示用户（有更新 / 无更新 / 无法连接），有更新时图标闪烁引起注意，点击图标跳转仓库。

仓库：`https://github.com/yljzcf/dreemAssets`（owner `yljzcf`，分支 `main`）。

## 非目标（YAGNI）

- 不引入后台 service worker、`chrome.alarms`、`chrome.notifications`（不做浏览器启动时的系统桌面通知）。检查只在 popup 打开时进行。
- 不做应用内自动更新 / 自动 `git pull`（未打包扩展无法安全自更新）。只做"提示"，更新动作由用户在 GitHub/本地完成。
- 不比较 commit、不轮询 releases API。以远端 `main` 分支的 `manifest.json` 版本号为唯一更新信号。
- 不做"忽略此版本 / 关闭横幅"的记忆——状态区是常驻紧凑区域，不是会打扰人的横幅，无需手动关闭。

## 触发时机与更新信号

- **触发**：用户点扩展图标打开 popup 时（`popup.js` 加载即执行），与页面类型无关——非目标页也会显示更新状态。
- **信号**：本地版本 `chrome.runtime.getManifest().version` 与远端 `main` 的 `manifest.json` 中 `version` 比较。远端 `version` 更高 → 有更新。
  - 选择 `manifest.json` 而非 releases/tags：项目每次发布都会 bump `manifest.json`/`package.json` 的版本号，raw 文件即时反映 `main` 现状，无需维护 release 流程；只有版本号真正变化时才提示（doc-only 提交不会误报）。
- **节流**：默认每 **6 小时**最多联网检查一次（`CHECK_INTERVAL_MS`）。结果缓存在 `localStorage`；popup 打开时先用缓存即时渲染，再视节流决定是否后台刷新。避免频繁打开 popup 时反复请求 GitHub、并让 UI 即时显示、无闪烁。

## 用户可见行为

### 首行（header）三栏布局

header 改为 CSS Grid `grid-template-columns: 1fr auto 1fr`，保证中间标题**始终相对 popup 居中**，不受左右宽度影响：

```
┌────────────────────────────────────────────────┐
│  左:更新状态        中:标题        右:操作按钮      │
│  [GH]⬆️ 新版本可用    角色页        [下载资产包]     │
└────────────────────────────────────────────────┘
```

- **右**（`justify-self:end`）：`下载资产包` 按钮，沿用现有 `#btnAssets`，非目标页仍 `hidden`（`display:none`，不占格）。
- **中**（`justify-self:center`）：`非目标页 / 角色页 / 场景页` 标题，沿用现有 `#pageType`。
- **左**（`justify-self:start`，新增）：更新状态区 = GitHub 图标 + 状态 emoji + 状态文字。

Grid 自动放置：左→col1、标题→col2（始终居中）、按钮→col3；按钮隐藏时 col3 空置，标题仍居中。

### 更新状态区：四种状态

| 状态 | 显示（GitHub 图标 + emoji + 文字） | hover 提示（`title`） | 图标闪烁 |
|---|---|---|---|
| 有更新 | `[GH] ⬆️ 新版本可用` | `v{remote} / 当前 v{local}` | 是（脉冲） |
| 无更新 | `[GH] ☑️ v{local}` | `当前已是最新版本` | 否 |
| 无法连接 | `[GH] ⚠️ 无法检查更新` | `请检查网络连接` | 否 |
| 检查中 | `[GH] 检查中…`（无 emoji） | —（无 title） | 否 |

- `{local}` = `chrome.runtime.getManifest().version`；`{remote}` = 远端 manifest 版本。显示时统一加 `v` 前缀。
- "检查中"仅在首次/缓存过期需联网期间短暂出现；有新鲜缓存时直接渲染结果，不经过"检查中"，无闪烁。
- **GitHub 图标**：内联官方 GitHub mark SVG（16×16，`fill:currentColor` 自适应明暗主题）。四种状态下都可点击 → `chrome.tabs.create({ url: REPO_URL })` 打开仓库首页。
- 文字字号 12px（与现有 `.tab`/`.status` 小字一致）。最坏情况（有更新 + 角色/场景页按钮可见）左栏约 102px，可用约 159px，单行容纳无压力。

### 闪烁（仅"有更新"）

纯 CSS 脉冲动画，由 `.has-update` 类开关，并适配"减少动态效果"：

```css
@keyframes ghpulse { 0%,100% { opacity: 1 } 50% { opacity: .35 } }
.update-status.has-update .gh-icon { animation: ghpulse 1.1s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .update-status.has-update .gh-icon { animation: none; }
}
```

popup 是临时窗口（点开才在、失焦即关），"有更新就持续脉冲"不会持续打扰用户。

## 架构与数据流

新增一个无依赖的 UMD 纯逻辑模块 `src/update-check.js`（`DreemUpdateCheck`），与现有 `core.js` / `page-config.js` 同风格（可被其它脚本 require/全局引用）。版本比较函数下沉到 `core.js` 以便 Node 单测。

```
popup.js (init)
  ├─ DreemUpdateCheck.getCached()      // 同步读 localStorage → 即时渲染
  │     → renderUpdate(info)
  └─ DreemUpdateCheck.check()          // 节流 + 联网刷新（永不 reject）
        → renderUpdate(info)           // 刷新后再渲染（缓存命中时与上一次相同，无变化）

DreemUpdateCheck.check()
  ├─ 读 localStorage: lastCheck, latest
  ├─ 未过节流且有 latest → 直接返回缓存派生状态（不联网）
  └─ 过期/无缓存 → fetch(MANIFEST_URL)
        ├─ 成功 → 解析 version；写入 latest/lastCheck；返回 update|current
        └─ 失败 → 返回 error（不更新 lastCheck，下次打开会重试）

派生状态: DreemCore.compareVersions(latest, local) > 0 ? 'update' : 'current'
```

## 组件详细设计

### `src/lib/core.js`：新增 `compareVersions(a, b)`

- 纯函数。将 `"0.7.0"` 按 `.` 拆为整数数组，逐位数值比较，缺位按 0 补齐，非数字按 0 处理。返回 `-1 | 0 | 1`。
- 加入 UMD 导出（与现有 `detectPageType`/`buildFilename` 等并列）。

### `src/update-check.js`（新建，UMD `DreemUpdateCheck`）

常量：

```js
var REPO_URL     = 'https://github.com/yljzcf/dreemAssets';
var MANIFEST_URL = 'https://raw.githubusercontent.com/yljzcf/dreemAssets/main/manifest.json';
var CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;   // 6h
var LS_LAST   = 'dreemUpdate.lastCheck';      // 时间戳(ms)
var LS_LATEST = 'dreemUpdate.latest';         // 远端版本字符串
```

API：

- `repoUrl()` → `REPO_URL`（供 popup 绑定图标点击）。
- `current()` → `chrome.runtime.getManifest().version`。
- `getCached()` → 同步读 `localStorage`，返回 `{ state, local, latest }`：
  - 无 `latest` 缓存 → `state:'checking'`；
  - 有 `latest` → `compareVersions(latest, local) > 0 ? 'update' : 'current'`。
- `check()` → `Promise<{ state, local, latest }>`，**永不 reject**：
  1. 读 `lastCheck`/`latest`；若 `now - lastCheck < CHECK_INTERVAL_MS` 且有 `latest` → 返回缓存派生状态（不联网）。
  2. 否则 `fetch(MANIFEST_URL, { cache:'no-store' })`：
     - 非 2xx / 网络异常 / JSON 解析失败 / 无 `version` 字段 → `{ state:'error', local, latest: 缓存值或 null }`，**不**更新 `lastCheck`。
     - 成功 → 取 `json.version`，写 `LS_LATEST`、`LS_LAST=now`，返回 `update|current` 派生状态。
- `state` 取值：`'checking' | 'update' | 'current' | 'error'`。
- 时间用 `Date.now()`（扩展运行于浏览器，可用）。

### `src/popup.html`

- header 改为三栏结构，新增左侧更新状态区：

```html
<header class="hdr">
  <div id="updateStatus" class="update-status">
    <span id="ghLink" class="gh-link" role="button" tabindex="0"
          title="打开 GitHub 仓库" aria-label="打开 GitHub 仓库">
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

- 在脚本区加入 `<script src="update-check.js"></script>`（在 `core.js` 之后、`popup.js` 之前）。

### `src/popup.css`

- `.hdr` 改为 `display:grid; grid-template-columns:1fr auto 1fr; align-items:center;`。
- `.update-status { justify-self:start; display:flex; align-items:center; gap:5px; font-size:12px; white-space:nowrap; }`
- `.status-label { justify-self:center; }`（保留 `font-weight:600`）。
- `#btnAssets { justify-self:end; }`
- `.gh-link { display:inline-flex; cursor:pointer; }` `.gh-icon { fill:currentColor; display:block; }`
- `.update-emoji`、`.update-text { color:#888; }`（与小字风格一致）。
- 上述 `@keyframes ghpulse` / `.has-update` / `prefers-reduced-motion`。

### `src/popup.js`

- 新增 `renderUpdate(info)`：依据 `info.state` 设置 `#updateEmoji`、`#updateText`、`#updateStatus` 的 `.has-update` 类与 `title`：
  - `update`：emoji ⬆️、文字 `新版本可用`、`title = 'v'+latest+' / 当前 v'+local`、加 `has-update`。
  - `current`：emoji ☑️、文字 `v'+local`、`title = '当前已是最新版本'`、去 `has-update`。
  - `error`：emoji ⚠️、文字 `无法检查更新`、`title = '请检查网络连接'`、去 `has-update`。
  - `checking`：emoji 空、文字 `检查中…`、无 `title`、去 `has-update`。
- 在 `init()` 起始处（与页面 scan 并行、不阻塞下载主流程）：
  ```js
  renderUpdate(DreemUpdateCheck.getCached());
  DreemUpdateCheck.check().then(renderUpdate);
  ```
- `#ghLink` 绑定 click（及 Enter/Space 键盘触发）→ `chrome.tabs.create({ url: DreemUpdateCheck.repoUrl() })`。

## 权限

- `manifest.json` 的 `host_permissions` 增加 `https://raw.githubusercontent.com/*`（popup 从该域 `fetch` manifest）。
- 不新增 `alarms`/`notifications`/`tabs` 等权限（`chrome.tabs.create` 打开 URL 无需 `tabs` 权限）。
- `content_scripts` 不变（更新检查只在 popup 运行）。

## 错误处理

- 离线 / 超时 / GitHub 限流 / 非 2xx / JSON 异常：`check()` 返回 `error` 状态 → UI 显示 ⚠️「无法检查更新」，**不报错弹窗、不打断下载功能**。控制台可 `console.warn` 留痕。
- 失败不写 `lastCheck`，下次打开 popup 会重试。

## 测试

- **单元测试**（`test/core.test.js`，Node `node --test`）：`compareVersions` —— 相等、各位高低（major/minor/patch）、不同位数（`"0.7"` vs `"0.7.0"`）、前导/边界。
- `update-check.js` 依赖 `chrome.*` / `fetch` / `localStorage`，与现有 `content.js`/`popup.js` 一样不做 Node 单测，靠**手动验证**：
  1. 加载扩展，打开任意页面 popup → 左侧出现 GitHub 图标 + 状态。
  2. 本地 manifest 版本临时调低（如 `0.6.0`）重载 → 显示 ⬆️「新版本可用」且图标脉冲，hover 显示 `v{remote} / 当前 v0.6.0`。
  3. 版本与远端一致 → ☑️「v{local}」，hover「当前已是最新版本」。
  4. 断网 → ⚠️「无法检查更新」，hover「请检查网络连接」。
  5. 点击图标 → 新标签打开仓库页。
  6. 系统开启"减少动态效果" → 图标不闪。

## 涉及文件

| 文件 | 改动 |
|---|---|
| `src/lib/core.js` | 新增并导出 `compareVersions` |
| `src/update-check.js` | **新建**：`DreemUpdateCheck`（getCached/check/current/repoUrl + 节流 + localStorage 缓存） |
| `src/popup.html` | header 三栏化 + 左侧更新状态区 + 引入 `update-check.js` |
| `src/popup.css` | header 改 grid、`.update-status`/`.gh-icon`、`@keyframes ghpulse` + `prefers-reduced-motion` |
| `src/popup.js` | `renderUpdate` + `init()` 接入 getCached/check + 图标点击打开仓库 |
| `manifest.json` | `host_permissions` 增加 `https://raw.githubusercontent.com/*` |
| `test/core.test.js` | `compareVersions` 单测 |
| `README.md` | 文档化"启动检查更新"功能与新增 host 权限 |

## 已决事项（取代过程中的备选）

- 触发与提示：**popup 打开时检查 + 首行左侧常驻状态区**（已选，排除后台 SW + 桌面通知）。
- 更新信号：**远端 `main` 的 `manifest.json` 版本号**（排除 commit/releases）。
- 提示形态：**常驻紧凑状态区 + 有更新时图标脉冲**（取代独立横幅 + 手动关闭）。
- 节流：**6 小时**（常量，可调）。
