# 拼豆图纸生成器 🧩 `v0.5.1`

上传图片，自动生成拼豆（Perler Bead / MARD）图纸 —— 带色号标注、颜色统计、高清导出。

## 功能

- **📷 拍照上传** — 移动端直接用原生相机拍照取图，无需先存相册
- **🖼️ 图片上传** — 拖拽或点击，支持 JPG / PNG / WebP，最大 20MB
- **✂️ 自由框选** — 拖拽选区 + 8 个手柄精确调整，滚轮缩放，右键平移
- **👆 双指操作** — 移动端双指缩放/平移，选框外单指平移图片
- **🎨 色板映射** — MARD 221 色标准色板，RGB 欧氏距离最近邻自动匹配
- **📐 多尺寸网格** — 预设 29×29 / 52×52 / 78×78 / 104×104，支持自定义 15~104，选框内容完整放入网格（contain 居中）
- **🏷️ 色号标注** — 每个格子上标注对应色号，深色格白字、浅色格黑字
- **📏 行列标尺** — 图纸外侧标注行号列号，每 10 格一条加粗参考线，照着拼不会数错。
  格子够大时逐格标，格子小（52×52 以上）自动改为每 5 格标一次；可开关，默认开启
- **📊 颜色统计** — 按用量排序的颜色表，一目了然需要多少颗豆
- **🎯 颜色简化** — 滑块 0-100%，合并相近色，减少颜色种类
- **📥 PNG 导出** — 2x 高清下载，含网格图 + 色号 + 颜色对照图例
- **📤 分享** — 支持一键分享图纸到其他应用
- **📌 离线可用** — PWA 支持，添加到主屏幕后离线也能使用
- **🔄 重置选框** — 一键恢复选区到默认位置
- **📱 iOS 兼容** — 支持 iOS 14.4+，选框 canvas 双保险绘制，预览自动适配小屏

## 使用方式

> ⚠️ **必须先起一个本地 HTTP 服务，不能再直接双击 `index.html`。**
>
> 本项目用的是浏览器**原生 ES module**（`<script type="module">`）。
> 按浏览器安全策略，`file://` 协议下**模块脚本会被 CORS 拦下、根本不执行** ——
> 双击打开只会看到一个**没有样式的空壳页面**，功能全无。
>
> 这是改用原生 ESM 换来的代价（收益：不再需要靠 `<script>` 标签顺序维护依赖、
> 模块边界清晰），**仍然是零依赖、无需安装、无需构建**。

### 方式一：HTTP 服务（推荐）

任选一种起服务的方式，**在项目目录下**执行：

```bash
python3 -m http.server 8080
# 或
python -m http.server 8080
# 或（装了 Node 的话）
npx serve .
```

然后访问 <http://localhost:8080>。

> 只需一条命令，不需要 `npm install`，也不需要打包。

### 方式二：PWA 安装（离线可用）

1. 先用上面的方式一在 Chrome 或 Edge 中打开
2. 地址栏出现安装图标（或底部横幅提示）
3. 点击"添加到主屏幕"
4. 之后可离线使用，享受全屏 APP 体验

> Service Worker 只在 `http://localhost` 或 HTTPS 下生效 —— 这也是必须起服务的原因之一。

## 技术栈

原生 HTML / CSS / JavaScript，**零依赖、零构建**，Canvas API 完成所有图像处理。
模块化使用浏览器**原生 ES module**（`import` / `export`），无需打包工具。
PWA 标准：manifest.json + Service Worker。

## 文件结构

```
index.html          — 页面结构（上传区 / 查看器 / 控制栏 / 预览 / 拍照 / 加载动画 / 安装提示）
                       ⚠️ 只有一个 <script type="module" src="js/main.js">（ESM 单入口）
style.css           — 样式（响应式布局，触摸设备适配，安全区域）
color-palette.js    — MARD 221 色板 + 颜色匹配（ESM 模块）

js/core/            dom.js       — DOM 引用与基础助手
                    state.js     — 全局状态与常量
js/input/           upload.js    — 图片上传与提示
                    camera.js    — 拍照录入
js/viewer/          viewer.js    — 查看器渲染与几何计算
                    selection.js — 选框拖拽
                    panzoom.js   — 缩放 / 平移 / 双指手势
js/pipeline/        grid.js      — 逐格采样与色板映射
                    simplify.js  — 近似色合并
                    render.js    — 网格绘制与行列标尺
js/output/          preview.js   — 预览渲染
                    stats.js     — 颜色用量统计
                    export.js    — PNG 合成与下载 / 分享
js/ui/              a11y.js      — 无障碍播报与键盘操作
                    grid-select.js — 网格尺寸与简化滑块
                    loading.js   — 加载遮罩
                    install.js   — PWA 安装提示
js/main.js          — **模块入口**（导入上面全部模块，把整张模块图拉起来）

manifest.json       — PWA 清单
sw.js               — Service Worker
icon.svg            — 应用图标源文件
icon-192.png        — 192×192 PWA 图标
icon-512.png        — 512×512 PWA 图标
CLAUDE.md           — 开发文档
```

> **改完代码记得递增 `sw.js` 里的 `CACHE_NAME`** —— 它是 cache-first，
> 不换版本号老用户会一直拿到缓存里的旧文件。

> ⚠️ **新增模块时必须在 `js/main.js` 里补一条 `import`**（若它不被其它模块引用）。
> 浏览器是**从入口的 import 出发**加载模块的 —— 没被 import 到的文件
> **根本不会被请求**，页面会静默少功能，而且**跑测试也发现不了**。
> 细节见 [REFACTOR.md](REFACTOR.md) §8.7。

## 色板说明

使用 MARD 品牌 221 色标准色板，数据来源于 [peiseka.com](https://www.peiseka.com/pindouseka.html)。

分组：A(黄橙) · B(绿) · C(蓝青) · D(紫) · E(粉) · F(红) · G(棕) · H(灰白黑) · M(混色)

## License

MIT
