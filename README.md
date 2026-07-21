# 拼豆图纸生成器 🧩

上传图片，自动生成拼豆（Perler Bead / MARD）图纸 —— 带色号标注、颜色统计、高清导出。

## 功能

- **图片上传** — 拖拽或点击，支持 JPG / PNG / WebP，最大 20MB
- **自由框选** — 拖拽选区 + 8 个手柄精确调整，滚轮缩放，右键平移
- **色板映射** — MARD 221 色标准色板，RGB 欧氏距离最近邻自动匹配
- **多尺寸网格** — 预设 29×29 / 52×52 / 78×78 / 104×104，支持自定义 15~104
- **色号标注** — 每个格子上标注对应色号，深色格白字、浅色格黑字
- **颜色统计** — 按用量排序的颜色表，一目了然需要多少颗豆
- **PNG 导出** — 2x 高清下载，含网格图 + 色号 + 颜色对照图例

## 截图

![界面截图](test-screenshot.png)

## 使用方式

直接用浏览器打开 `index.html` 即可，无需安装或构建。

```bash
# 或者用任意 HTTP 服务
python3 -m http.server 8080
# 然后访问 http://localhost:8080
```

## 技术栈

原生 HTML / CSS / JavaScript，零依赖，Canvas API 完成所有图像处理。

## 文件结构

```
index.html          — 页面结构
style.css           — 样式
app.js              — 核心逻辑
color-palette.js    — MARD 221 色板 + 颜色匹配
CLAUDE.md           — 开发文档
```

## 色板说明

使用 MARD 品牌 221 色标准色板，数据来源于 [peiseka.com](https://www.peiseka.com/pindouseka.html)。

分组：A(黄橙) · B(绿) · C(蓝青) · D(紫) · E(粉) · F(红) · G(棕) · H(灰白黑) · M(混色)

## License

MIT
