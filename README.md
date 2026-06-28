# Dreem 图片下载（Chrome 扩展）

![version](https://img.shields.io/badge/version-0.7.0-2563eb)
![license](https://img.shields.io/badge/license-MIT-green)
![manifest](https://img.shields.io/badge/Manifest-V3-2563eb)
![browser](https://img.shields.io/badge/Chrome%20%2F%20Edge-88%2B-lightgrey)

一键下载 [dreem-world studio](https://studio.dreem-world.ai) **角色页**与**场景页**的资产图片——既包括各分类的**原图**（经官方 API 取签名链接），也包括当前分类的**变体裁剪图**（网页客户端临时生成、平时难以另存）。支持单张点选下载或一键打包成 ZIP，文件名自动标准化，便于素材归档。

## ✨ 功能亮点

- **整角色一键打包**：把一个角色 5 个分类的全部原图打包成一个 ZIP。
- **连变体一起拿**：自动抓取当前分类的变体裁剪图（网页临时 `blob:` 图，常规右键无法保存）。
- **文件名标准化**：按 `角色 / 分类 / 穿搭` 自动命名，开箱即归档。
- **两种下载方式**：单张点选下载，或一键 ZIP 打包。
- **免登录配置**：复用网页已登录态调用 API，无需重新登录或手填 token。
- **角色页 + 场景页**：场景页支持全景图 + 各角度图。
- **零构建、零追踪**：纯原生 JS，无构建步骤，无第三方统计。
- **更新提示**：打开扩展时自动检查 GitHub 是否有新版本（节流，最多每 6 小时一次），在首行左侧以「GitHub 图标 + 状态」显示（有更新时图标闪烁），点击图标跳转仓库。

## 安装（加载未打包扩展）

1. 将本仓库 clone 或下载到本地任意目录。
2. Chrome 打开 `chrome://extensions`。
3. 右上角开启 **开发者模式**。
4. 点 **加载已解压的扩展程序**，选择**本仓库根目录**（含 `manifest.json` 的那一层）。
5. 打开 dreem-world 目标页后**刷新一次**该页面（让内容脚本注入）。

> **前置条件**：需已登录 dreem-world（扩展复用页面登录态调用其 API）；仅支持 Chrome / Edge 等 Chromium 浏览器（见[注意事项](#-注意事项--限制)）。

## 使用

在以下页面点击工具栏的扩展图标：

- **角色页** `…/worlds/<id>/characters/<id>`
  - 顶部：状态（角色页）+ **下载资产包**（把整角色所有分类的原图打包成一个 ZIP）。
  - 标签行：`Face / Body / Mood / Outfit / Others`（平分宽度）。
  - 每个标签显示该分类**原图**；当弹窗标签与**网页当前所在分类**一致时，额外显示该分类的**变体裁剪图**（按「主图 → 其变体」排列）。
  - **点任意图片即可下载该张**（成功绿色描边、失败红色描边）。
- **场景页** `…/worlds/<id>/locations/<id>`
  - 扁平列表：全景图（整幅）+ 各角度图（2~3 张一行的网格），无标签/无变体。
  - 同样支持点图下载 + 下载资产包（ZIP）。

### 文件名规范

| 场景 | 原图 | 变体 |
|---|---|---|
| 角色 · 单原图分类 | `<角色>_<类别>_full` | `<角色>_<类别>_<n>` |
| 角色 · 多套穿搭（Outfit） | `<角色>_outfit_<i>_full` | `<角色>_outfit_<i>_<n>` |
| 场景 | `<场景>_fullshot`、`<场景>_angle_<n>` | — |

示例：`Faye_face_full.png`、`Faye_face_1.png`、`Faye_outfit_2_full.png`、`Faye_outfit_2_3.png`、`Forest_angle_1.png`。ZIP 命名为 `<角色或场景>_assets.zip`。文件名中的非法字符会被替换为 `_`，中文等字符保留。

## ⚠️ 注意事项 / 限制

- **必须已登录 dreem-world**：扩展复用网页的登录态（Clerk token）调用 API；未登录或登录失效会提示「未找到图片」。
- **装好/重载后需刷新页面**：内容脚本在页面加载时注入，刚加载扩展时需手动刷新一次目标页。
- **仅 Chromium 浏览器**：Manifest V3，需 Chrome / Edge **88+**；不支持 Firefox / Safari。
- **依赖对方接口与页面结构**：原图取自 `api.dreem-world.ai` 的 artifacts 接口，变体靠页面 DOM 选择器抓取；dreem-world 改版（API 字段、DOM 类名、标签结构变化）可能导致失效，需相应更新。
- **签名链接有时效**：原图为 CloudFront 预签名 URL，存在有效期；一次性打包大量图片耗时过久时，个别链接可能过期而失败。
- **变体仅限当前分类**：变体是网页临时生成的 `blob:` 图，只对「你当前所在的分类/穿搭」可见；要拿其它分类的变体，需先在网页切到对应分类再开扩展。
- **失败不自动重试**：单张失败会红框提示；ZIP 会跳过失败项并在按钮上显示失败数量，可重试。
- **版权与服务条款**：下载内容版权归 dreem-world 及相应创作者所有。请遵守其服务条款，仅将本工具用于个人备份或你已获授权的素材，使用风险自负。

## 常见问题 / 故障排查

- **弹窗显示「非目标页 / 请在角色页或场景页打开」** → 确认地址是 `…/worlds/<id>/characters/<id>` 或 `…/locations/<id>`；刚装好扩展先刷新页面。
- **显示「未找到任何图片（原图获取失败：…）」** → 多为未登录或登录态失效（如 `clerk-unavailable`、`no-token`、`http-401`）；在网页正常登录并刷新后重试。
- **某分类只有原图、没有变体** → 变体只在「网页当前所在分类」显示；先在网页点到该分类标签，再打开扩展。
- **个别图下载失败（红框 / ZIP 提示失败）** → 多为签名链接过期或网络波动，重试即可。

## 架构

无构建工具的原生 JS（Manifest V3）。

| 文件 | 职责 |
|---|---|
| `src/lib/core.js` | 纯工具（UMD）：`detectPageType`、文件名 `sanitize/buildFilename/extFromUrl`、`pickFromSrcset`、`extractImages`。可在 Node 测试中 `require`。 |
| `src/page-config.js` | 页面配置（UMD）：5 个角色分类 ↔ artifact 类型映射、当前激活标签检测、变体网格抓取 `scanTiles`、页面名、场景类型标签。 |
| `src/update-check.js` | 更新检查（UMD）：取本地/远端 `manifest.json` 版本、6h 节流、`localStorage` 缓存；纯函数 `deriveState`/`describe`/`compareVersions` 可在 Node 测试。 |
| `src/content.js` | 内容脚本：响应 popup 的 `scan`（返回页面类型、名称、当前分类、变体）与 `download`/`zip`（在页面内 fetch 字节 + 保存/打包，支持 `blob:` 与签名 URL）。 |
| `src/popup.{html,css,js}` | 弹窗 UI：编排 scan + 取原图 + 渲染（角色分标签 / 场景扁平）+ 下载。 |
| `src/lib/jszip.min.js` | 第三方库（[JSZip](https://stuk.github.io/jszip/)，MIT），用于在页面内打包 ZIP。 |
| `src/icons/icon-*.png` | 扩展图标（如需更换见[替换图标](#替换图标)）。 |

**原图来源（关键）**：原图不在 DOM 里。popup 通过 `chrome.scripting.executeScript({world:'MAIN'})` 在页面主世界用 `window.Clerk.session.getToken()` 取 Clerk token，POST `api.dreem-world.ai/api/worlds/<id>/artifacts/query`（body `{scope:{kind:'character'|'location', id}}`），返回每个 artifact 的 `presignedUrl`，按 `type` 归类。

**变体来源**：变体是页面客户端裁切的 `blob:` 图（不在 API），仅当前分类/穿搭在 DOM 中渲染；内容脚本按 tile 网格分组抓取。

**下载**：内容脚本在页面内 `fetch` 字节后用 `<a download>` 保存（`blob:` 与签名 CloudFront URL 均可）；ZIP 用页面内 JSZip 打包。**无需 `downloads` 权限**。

**权限**：`scripting`（取 token）；`host_permissions`：`studio.dreem-world.ai`、`*.cloudfront.net`、`raw.githubusercontent.com`（读取远端 `manifest.json` 版本以检查更新）。

## 测试

```bash
node --test   # core.js 与 page-config.js 的单元测试
```

## 替换图标

如需更换扩展图标 `src/icons/icon-{16,32,48,128}.png`：

1. 参考 [`docs/icon-prompt.md`](docs/icon-prompt.md) 里的提示词用 AI 生成 1024×1024 图标。
2. 导出为 `16 / 32 / 48 / 128` 四个尺寸的 PNG（建议保留透明背景）。
3. 覆盖 `src/icons/` 下的同名文件（**文件名与尺寸不变，无需改 `manifest.json`**）。
4. 到 `chrome://extensions` 点扩展卡片「刷新」重新加载即可。

## 许可证

[MIT](LICENSE) © 2026 mozero。第三方库 JSZip 亦为 MIT。下载内容的版权归原作者/平台所有，详见[注意事项](#-注意事项--限制)。

## 设计文档

- 设计：[`docs/superpowers/specs/2026-06-27-dreem-world-image-downloader-design.md`](docs/superpowers/specs/2026-06-27-dreem-world-image-downloader-design.md)
- 实现计划：[`docs/superpowers/plans/2026-06-27-dreem-world-image-downloader.md`](docs/superpowers/plans/2026-06-27-dreem-world-image-downloader.md)
- 注：探查阶段架构演进较大（从「DOM 抓取」演进为「API 取原图 + DOM 取变体 + 分标签」），以本 README 为准。
