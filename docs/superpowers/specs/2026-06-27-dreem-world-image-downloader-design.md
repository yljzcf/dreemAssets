# Dreem-World 图片下载 Chrome 扩展 — 设计文档

- **日期**: 2026-06-27
- **状态**: 待用户评审
- **目标网站**: `https://studio.dreem-world.ai/worlds/*/characters/*` 与 `https://studio.dreem-world.ai/worlds/*/locations/*`

## 1. 目标与范围

做一个 Chrome 扩展（Manifest V3），在用户已登录 dreem-world studio 的情况下，下载**当前打开页面**上**指定位置**的图片。支持打包下载（ZIP）和分张下载（单个文件）。

**范围内（本期）**
- 仅处理**当前激活标签页**（单页面），不做跨页批量。
- 支持两类页面：`characters` 与 `locations`（架构允许后续追加新页面类型）。
- 每类页面的图片位置是**固定的、已知的**，通过探查阶段确定并写入配置。

**范围外（明确不做，YAGNI）**
- 跨多个页面/整个 world 的批量收集（架构预留，本期不实现）。
- 任意页面通用图片抓取（只抓配置中声明的固定位置）。
- 云端同步、历史记录、设置面板等。

## 2. 用户交互（Popup UI）

点击扩展图标弹出 popup：

```
┌─────────────────────────────────────┐
│  Dreem 图片下载                        │
│  [当前页面类型: 角色 / 场景]            │
├─────────────────────────────────────┤
│  [ 打包下载 ZIP ]  [ 全部单独下载 ]     │   ← 顶部两个按钮
├─────────────────────────────────────┤
│  ┌──────┐                            │
│  │缩略图 │  立绘 (1024×1024)   [下载]  │   ← 每张图：预览 + 标签 + 单独下载
│  └──────┘                            │
│  ┌──────┐                            │
│  │缩略图 │  头像 (512×512)     [下载]  │
│  └──────┘                            │
│  ...                                 │
└─────────────────────────────────────┘
```

- **顶部两个按钮**：
  - **「打包下载 ZIP」** → 把当前页所有固定位置图片打包成一个 ZIP 下载（满足"打包"需求）。
  - **「全部单独下载」** → 依次把所有图片作为独立文件下载（满足"分张"需求）。
- **图片列表**：展示当前页探测到的每张固定位置图片，含缩略图预览、标签（如"立绘""头像"）、分辨率，以及一个**单独「下载」按钮**。
- **状态**：
  - 扫描中 → 显示 loading。
  - 未找到图片 → 提示"未找到图片，页面结构可能已变更"，并给出诊断提示（打开 console 可见详情）。
  - 下载失败 → 在对应条目/顶部提示具体错误。

## 3. 架构

Manifest V3 扩展，原生 JS，本地打包 [JSZip](https://stuk.github.io/jszip/) 用于 ZIP 生成。

### 文件结构
```
downloadMo/
  manifest.json
  src/
    popup.html
    popup.css
    popup.js          # UI 逻辑：渲染列表、绑定按钮、调度下载
    content.js        # 注入页面：按 page-config 提取固定位置图片
    background.js      # service worker：鉴权 fetch + JSZip 打包 + chrome.downloads
    page-config.js    # 【可扩展核心】URL→页面类型；页面类型→提取规则
    lib/
      jszip.min.js    # 本地打包，避免远程依赖
  icons/
    icon16.png icon48.png icon128.png
  docs/superpowers/specs/...
```

### 组件职责

- **`manifest.json`** — MV3。权限：`downloads`、`activeTab`、`scripting`；`host_permissions` 含 `https://studio.dreem-world.ai/*` 以及图片 CDN 域名（探查阶段确认；若同域则无需额外项）。声明 popup（`action.default_popup`）。

- **`page-config.js`** — **可扩展核心**。两张表：
  1. `detectPageType(url)`：用 URL 正则判断当前是 `character` / `location` / `unknown`。
  2. `EXTRACTORS[pageType]`：每类页面的提取规则 —— 一组"图片槽位"定义，每个槽位包含：选择器、取值方式（`src` / `srcset` / `background-image` / 自定义函数）、升到最高分辨率/原图的方法、标签、文件名生成规则。
  - **探查阶段就是往这里填规则**，框架其余部分无需改动。

- **`content.js`** — 注入当前页。读取 `page-config` 的提取规则，定位固定位置图片，返回描述符数组：`[{ url, label, filename, width, height }]`。同时支持"dry-run"：把结果打到 console 便于调试。

- **`popup.js`** — popup 打开时：读取当前 tab URL → `detectPageType` → 用 `chrome.scripting` 注入/调用 content.js 扫描 → 拿到描述符列表 → 渲染缩略图列表与按钮 → 按钮事件交给 background 处理下载。

- **`background.js`** — service worker。三件事：
  1. 单张下载：`chrome.downloads.download({ url, filename })`。
  2. 全部单独下载：对列表逐项调用单张下载。
  3. 打包 ZIP：对每个 url 做鉴权 `fetch`（带页面会话 cookie）→ 收集 blob → JSZip 生成 → 通过 blob URL 触发 `chrome.downloads.download`。

### 数据流

```
popup 打开
  → 读取 tab.url
  → detectPageType(url)  ──unknown──> 提示"非目标页面"
  → chrome.scripting 注入 content.js 执行扫描
  → content.js 按 EXTRACTORS[type] 提取 → 返回 [{url,label,filename,w,h}]
  → popup 渲染列表 + 顶部两按钮
  → 用户点击：
      · 单张「下载」      → background 单张 chrome.downloads
      · 「全部单独下载」   → background 逐张 chrome.downloads
      · 「打包下载 ZIP」   → background fetch×N → JSZip → 下载 .zip
```

## 4. 鉴权处理

目标站点需要登录。处理方式：

- 扩展通过 `host_permissions` 获得对站点/CDN 的跨域请求能力，`fetch` 会携带用户已登录的会话 cookie，因此鉴权图片 URL 可正常取到字节。
- 若图片在 DOM 中已是签名 CDN URL（如带 token 的 S3/CDN 链接），更简单，直接用即可。
- **具体走哪条路，探查阶段在真实页面上确认。**

## 5. 错误处理

- **页面类型不匹配**：popup 提示"请在角色或场景页面打开"。
- **未找到图片**（选择器失效）：popup 显示"未找到图片，页面结构可能已变更"，console 打印实际尝试的选择器，便于我快速修配置。
- **单张 fetch 失败**：ZIP 流程中跳过该张并在结果里标注失败项；单独下载则透传 `chrome.downloads` 错误。
- **CORS 被 CDN 拦截**：单独下载走 `chrome.downloads.download`（直接下载不受 CORS 限制）；ZIP 模式把 fetch 放在 background service worker（具备 host 权限）执行。

## 6. 探查工作流（"依次探索"部分）

框架搭好后，对每类页面依次探查并填充 `page-config.js`：

1. **验证 Chrome 连接**（探查第一步）：确认能驱动你已登录的 Chrome。
2. **角色页 `characters`**：
   - 我在你的 Chrome 打开一个样本页（你给一个示例 URL，或我从 world 里找一个）。
   - 检查 DOM + 网络请求，定位固定位置图片：选择器、取值属性、是否存在更高清/原图 URL（如去掉 `?w=200` 参数、`data-full` 属性、或网络里原图请求）、标签来源（角色名等）。
   - 把规则写进 `EXTRACTORS.character`。
   - 在该页 + 另一个角色页测试，确认稳健。
3. **场景页 `locations`**：同上，填 `EXTRACTORS.location`。
4. 若还有其它页面类型，重复。

## 7. 测试策略

- **手动验证**：`chrome://extensions` 加载未打包扩展 → 在真实角色/场景页打开 popup → 核对缩略图与固定位置一致 → 分别测试单张、全部单独、打包 ZIP → 打开 ZIP 确认内容与文件名。
- **dry-run 自检**：content.js 提供把描述符打到 console 的模式，不触发下载即可验证选择器。
- 探查阶段每填一条规则即在 ≥2 个同类页面上回归。

## 8. 后续可扩展点（本期不做，仅记录）

- 跨页批量：`page-config` 已按"页面类型→规则"解耦，未来可加一个"world 索引页扫描 → 收集所有角色/场景 URL → 逐页提取"的批量层。
- 新页面类型：只需在 `page-config.js` 增加一条 `EXTRACTORS` 规则。
- 若个别图片是 canvas/blob/临时 URL：在该槽位的提取规则里换用"网络拦截"策略（contingency，按需）。
