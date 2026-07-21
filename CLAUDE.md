# 拼豆图纸生成器 (Perler Bead Blueprint Generator)

纯前端单页工具：上传图片 → 框选区域 → 映射色板 → 生成拼豆图纸并导出 PNG。

## 技术栈

- 原生 HTML / CSS / JS，零依赖
- Canvas API 完成所有图像处理与渲染
- MARD 221 色标准色板（来源：peiseka.com）

## 文件结构

```
index.html          — 页面结构（上传区 / 查看器 / 控制栏 / 预览 / 统计）
style.css           — 样式，CSS 变量主题，响应式适配
app.js              — 核心逻辑（上传、选框、缩放平移、网格生成、预览、下载）
color-palette.js    — PERLER_PALETTE 221 色 + findNearestColor()
CLAUDE.md           — 项目文档
```

## 核心数据流

1. `handleFile()` → 读取图片，设置 `state.image`
2. `showViewer()` → 渲染图片到 viewerCanvas，显示选框
3. 用户拖拽选框 / 选网格尺寸
4. `generateGrid()` → 逐格采样平均色 → `findNearestColor()` 映射 → `state.gridData`
5. `renderPreview()` → previewCanvas 绘制像素网格 + 色号
6. `renderStats()` → 颜色用量统计表
7. `downloadPNG()` → 2x 高清合成（网格 + 色号 + 图例）→ PNG 下载

## 关键状态 (app.js state)

| 字段 | 说明 |
|------|------|
| `image` | 原始 HTMLImageElement |
| `imageW/H` | 原始图片尺寸 |
| `zoom` | 缩放倍率 (0.2~5) |
| `panX/Y` | 平移偏移 |
| `selection` | 选框归一化坐标 `{x, y, w, h}` (0~1) |
| `gridW/H` | 目标网格尺寸 (15~104) |
| `gridData` | 二维数组，每个元素为 `{name, hex, r, g, b}` |
| `colorCounts` | 按数量降序的颜色统计数组 |

## 色板 (color-palette.js)

- 221 色，MARD 品牌标准色
- 分组：A(黄橙), B(绿), C(蓝青), D(紫), E(粉), F(红), G(棕), H(灰白黑), M(混色)
- 匹配算法：RGB 欧氏距离最近邻

## 交互操作

- **框选区域**：在图片上拖拽（空白处开始新选框，选框内拖拽移动）
- **8 个手柄**：调整选框大小
- **滚轮**：缩放 (0.2x ~ 5x)
- **右键拖拽**：平移图片
- **网格预设**：29×29 / 52×52 / 78×78 / 104×104
- **自定义网格**：15~104 任意尺寸

## 预览参数

- cellSize = max(10, floor(720 / max(rows, cols)))，范围 10~24px
- 文字阈值 minCellForText = 10px（所有预设尺寸均显示色号）
- 色号字体 = max(5, cellSize * 0.35)px，深色格白字、浅色格黑字

## 未来可扩展方向

- 多品牌色板支持（HAMA、Artkal 等）
- 减色/抖动算法提升色彩还原度
- 图纸编号标记叠加
- PDF 打印模板导出
- 网格保存/加载
- 色板自定义编辑

## 运行方式

直接用浏览器打开 `index.html`，无需构建或服务端。
