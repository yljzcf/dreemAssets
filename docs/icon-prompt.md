# 扩展图标 · AI 生图提示词

项目的扩展图标位于 `src/icons/icon-{16,32,48,128}.png`。下面的提示词用于（重新）生成正式图标，生成后按 [README「替换图标」](../README.md) 替换同名文件即可。

设计要点：主题=「图片下载」；品牌蓝 `#2563eb`；圆角方形（squircle）应用图标；无文字；16×16 小尺寸下仍清晰。

---

## 主提示词（中文）

> 现代扁平风格的浏览器扩展应用图标，圆角方形（squircle）造型。主题：图片下载。画面中心是一张简洁的图片/照片符号——白色圆角画框，框内有极简的小山峰与一个圆形太阳；下方叠加一个醒目的白色向下箭头，箭头指向底部的托盘横线，传达"把图片下载下来"的含义。背景为科技感蓝色渐变（从 `#2563eb` 到 `#1d4ed8`，左上到右下），干净、留白充足、对比强烈，在 16×16 像素小尺寸下依然清晰可辨。整体极简、专业、现代，类似一流的 macOS / Material Design 应用图标。居中构图，1024×1024，纯色或透明背景。

**负向提示（Negative）：** 不要文字、不要字母、不要水印、不要照片写实风格、不要过多细节、不要杂乱背景、不要噪点与多余描边、不要渐变光晕过曝。

---

## Main Prompt (English)

> A modern flat-design browser-extension app icon, rounded-square (squircle) shape. Theme: downloading images. The center shows a clean photo/image glyph — a white rounded picture frame containing a minimal mountain and a small circular sun — with a bold white downward arrow below it pointing into a tray baseline, conveying "download the images." Background is a tech-blue gradient (from `#2563eb` to `#1d4ed8`, top-left to bottom-right), clean, with generous whitespace and high contrast, remaining legible even at 16×16 px. Minimal, professional, modern — like a top-tier macOS / Material Design app icon. Centered composition, 1024×1024, solid or transparent background.
>
> **Negative:** no text, no letters, no watermark, no photorealism, no clutter, no noise, no excessive detail.

---

## 风格变体

**变体 A · 线性极简（line / lucide 风）**
> 同上主题，但用**白色细线描边**风格绘制图片框与下载箭头（线宽统一、圆角端点），背景为纯色或微渐变品牌蓝，整体类似 Lucide / Feather 图标的极简线条风，克制、几何、现代。

**变体 B · 玻璃拟物 3D（iOS / visionOS 风）**
> 同上主题，但采用**半透明玻璃质感**：图片框与箭头有柔和高光、细腻投影与轻微景深，蓝色渐变背景带玻璃反光，立体、精致、有质感，类似 iOS / visionOS 的 3D 应用图标。

---

## 生成后如何使用

1. 生成 1024×1024 的图，按需裁剪为正方形。
2. 缩放导出为 `16 / 32 / 48 / 128` 四个尺寸的 PNG（建议保留透明背景）。
3. 覆盖 `src/icons/icon-16.png`、`icon-32.png`、`icon-48.png`、`icon-128.png`（**文件名与尺寸保持不变**，无需改 `manifest.json`）。
4. 在 `chrome://extensions` 点扩展卡片的「刷新」重新加载，即可看到新图标。
