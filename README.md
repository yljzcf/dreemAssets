# Dreem 图片下载（Chrome 扩展）

下载 [dreem-world studio](https://studio.dreem-world.ai) 角色页与场景页的资产图片（原图 + 角色的变体裁剪图），支持单张下载或打包成 ZIP。

## 安装（加载未打包扩展）

1. Chrome 打开 `chrome://extensions`
2. 右上角开启 **开发者模式**
3. 点 **加载已解压的扩展程序**，选择本项目根目录 `E:\claudeCowork\downloadMo`
4. 在 dreem-world 页面打开后**刷新一次**该页面（让内容脚本注入）

> 需要已登录 dreem-world（扩展复用页面的登录态调用其 API）。

## 使用

在以下页面点击扩展图标：

- **角色页** `…/worlds/<id>/characters/<id>`
  - 顶部：状态（角色页）+ **下载资产包**（把整张角色所有分类的原图打包成一个 ZIP）
  - 标签行：`Face / Body / Mood / Outfit / Others`（平分宽度）
  - 每个标签显示该分类**原图**；当弹窗标签与**网页当前所在分类**一致时，额外显示该分类的**变体裁剪图**（按 主图 → 其变体 排列）
  - **点任意图片即可下载该张**
- **场景页** `…/worlds/<id>/locations/<id>`
  - 扁平列表：全景图 + 各角度图（无标签/无变体）
  - 同样支持点图下载 + 下载资产包（ZIP）

### 文件名规范

- 角色单原图分类：`<角色>_<类别>_full`、变体 `<角色>_<类别>_<n>`（如 `Faye_face_full`、`Faye_face_1`）
- 角色多套（Outfit）：`<角色>_outfit_<i>_full`、变体 `<角色>_outfit_<i>_<n>`
- 场景：`<场景>_fullshot`、`<场景>_angle_<n>`

## 架构

无构建工具的原生 JS（Manifest V3）。

| 文件 | 职责 |
|---|---|
| `src/lib/core.js` | 纯工具（UMD）：`detectPageType`、文件名 `sanitize/buildFilename/extFromUrl`、`pickFromSrcset`、`extractImages`。可在 Node 测试中 `require`。 |
| `src/page-config.js` | 页面配置（UMD）：5 个角色分类↔artifact 类型映射、当前激活标签检测、变体网格抓取 `scanTiles`、页面名、场景类型标签。 |
| `src/content.js` | 内容脚本：响应 popup 的 `scan`（返回页面类型、名称、当前分类、变体）与 `download`/`zip`（在页面内 fetch 字节 + 保存/打包，支持 blob: 与签名 URL）。 |
| `src/popup.{html,css,js}` | 弹窗 UI：编排 scan + 取原图 + 渲染（角色分标签 / 场景扁平）+ 下载。 |

**原图来源（关键）**：原图不在 DOM 里。popup 通过 `chrome.scripting.executeScript({world:'MAIN'})` 在页面主世界用 `window.Clerk.session.getToken()` 取 Clerk token，POST `api.dreem-world.ai/api/worlds/<id>/artifacts/query`，body `{scope:{kind:'character'|'location', id}}`，返回每个 artifact 的 `presignedUrl`，按 `type` 归类。

**变体来源**：变体是页面客户端裁切的 `blob:` 图（不在 API），仅当前分类/穿搭在 DOM 中渲染；内容脚本按 tile 网格分组抓取。

**下载**：内容脚本在页面内 `fetch` 字节后用 `<a download>` 保存（blob: 与签名 cloudfront URL 均可）；ZIP 用页面内 JSZip 打包。无需 `downloads` 权限。

**权限**：`scripting`（取 token）；`host_permissions`：`studio.dreem-world.ai`、`*.cloudfront.net`。

## 测试

```bash
node --test   # core.js 与 page-config.js 的单元测试
```

## 设计文档

- 设计：`docs/superpowers/specs/2026-06-27-dreem-world-image-downloader-design.md`
- 实现计划：`docs/superpowers/plans/2026-06-27-dreem-world-image-downloader.md`
- 注：探查阶段架构演进较大（从"DOM 抓取"演进为"API 取原图 + DOM 取变体 + 分标签"），以本 README 为准。
