# 拼豆图纸生成器 (Perler Bead Blueprint Generator)

纯前端单页工具：上传图片 → 框选区域 → 映射色板 → 生成拼豆图纸并导出 PNG。

## 技术栈

- 原生 HTML / CSS / JS，零依赖
- Canvas API 完成所有图像处理与渲染
- MARD 221 色标准色板（来源：peiseka.com）
- PWA：manifest.json + Service Worker + 离线缓存

## 文件结构

```
index.html          — 页面结构（上传区 / 查看器 / 控制栏 / 预览 / 统计 / 拍照入口 / 加载动画 / 安装提示）
style.css           — 样式，CSS 变量主题，响应式适配（640px/400px 断点），触摸设备适配
app.js              — 核心逻辑（上传、选框、缩放平移、网格生成、预览、下载、触摸交互、分享、安装提示）
color-palette.js    — PERLER_PALETTE 221 色 + findNearestColor()
manifest.json       — PWA 清单（名称、图标、standalone 模式）
sw.js               — Service Worker（cache-first 离线缓存策略）
icon.svg            — 应用图标源文件（8×8 彩色拼豆网格）
icon-192.png        — 192×192 图标（purpose: any）
icon-512.png        — 512×512 图标（purpose: any）
icon-192-maskable.png — 192×192 maskable 图标（内容限制在中心 56%）
icon-512-maskable.png — 512×512 maskable 图标
README.md           — 使用说明（面向用户）
PLAN.md             — 开发计划：待做项优先级 + A4 打印方案
REVIEW.md           — 代码审查报告：37 项问题（**已全部处理**）+ 「已核实无问题」清单 + 测试脚手架说明
REFACTOR.md         — 代码结构对策：模块划分、阻塞点、防复发规则
CLAUDE.md           — 项目文档（本文件）
```

> **改代码前先读 [REVIEW.md](REVIEW.md)** —— 特别是 §五「明确核实"没问题"的项」，
> 避免为"修问题"而改坏**本来正确**的代码。
> **§九 说明了怎么跑回归测试**（19 个套件 / 170 条断言）。

> **🧪 回归测试**（脚手架在仓库**之外**：`F:\claudeapp\demo\.pindou-devtools\`，刻意不污染零依赖交付物）：
> ```powershell
> cd F:\claudeapp\demo\.pindou-devtools
> node run-all.js      # 一键跑全部，退出码 0 = 全绿
> ```
> 它**加载真实的 index.html + app.js**（不复制逻辑），断言落在**用户可感知的输出**上。
> 改完代码请跑一遍 —— 这套脚手架正是为了拦住"改了 A 弄坏 B"而建的。

## ⚠️ 代码结构约定（改代码前必读）

`app.js` 当前 **1901 行、承载 12 个特性域、26+ 个函数、27 处顶层监听**，已进入临界区。
**新增功能不得再堆入单文件。**

> ⚠️ **本轮已发生一次显式偏离**：PLAN §3.1 近似色合并的代码**写进了 `app.js`**
> （约 +90 行净增），未按规则 1 落位到 `js/pipeline/simplify.js`。
> **这是用户的明确选择**（在「新建 `js/` 用裸 `<script src>` 加载」「写进 `app.js`」
> 「先做 ESM 改造」三者中选了后者），理由是步骤 0（ESM）尚未决策、且会先让 156 条断言的
> 脚手架失效。**该偏离是有意的、已记录的技术债** —— 待步骤 5 模块搬迁时随
> `applySimplify` 一并移入 `js/pipeline/simplify.js`（REFACTOR §4.2 已预留该位置）。
> **这不构成放宽规则 1 的先例**：后续新功能仍应按 §4.2 归位，或先讨论。

**详见 [REFACTOR.md](REFACTOR.md)**（**§七 是本轮对落地顺序的实测复核**），其中三条为强约束：

1. **新功能按特性域归位**（`js/` 下的 `input/` `viewer/` `pipeline/` `output/` `ui/`）；
   无归属时先讨论，不要默认写进主文件。
2. **模块间不得直接互相调用**，跨领域一律经编排层（`main.js`）。
3. **禁止对函数做猴补丁** —— 现存的 `generateGrid` 覆盖（文件末尾的「加载状态」段）
   **✅ 已按 REFACTOR §7.1 步骤 1 拆除**：加载状态改由 `generateGrid()` 入口**显式**驱动，
   真实实现迁为独立的 `generateGridCore()`。**今后不得再引入任何形式的猴补丁。**
   > ⚠️ **改 `generateGrid` 前必读**：它是**唯一入口**，真实逻辑在 `generateGridCore()`。
   > 直接调 `generateGridCore()` 会绕过加载遮罩，用户观感就是"点了没反应"。
   > 另有一条**时序契约**：`generateGrid()` 返回时 `state.gridData` **仍是上一轮**的数据
   > （真实生成被推迟到 `rAF`）—— 需要新数据请在下一帧之后再读。
   > 两条都由 `test-patch-removal.js` 实测守护，**不要改回去**。
   > ⚠️ **归因已更正**（REFACTOR §7.2 实测）：不是"改 ESM 会炸"，
   > 而是"**把它改成 `const`，或经模块 `import` 后仍想重新赋值**"才会炸。
   > 结论（必须先拆）不变 —— 且该步**已完成**。

> **🛠 结构改造的推荐顺序**（REFACTOR §7.1，已实测复核）：
> `1 拆猴补丁 → 2 抽 computeImageRect → 3b 拆 dragStart → 4 抽 drawGrid`
> `→（改造测试脚手架）→ 0 改 ESM → 5 模块搬迁 → 6 拆 pointermove`
>
> **进度**：**✅ §7.1 的「前四步」已全部完成**（1 拆猴补丁 / 2 抽 `computeImageRect` /
> 3b 拆 `dragStart` / 4 抽 `drawGrid`）。**按 §五 的建议，接下来回到 PLAN 的功能开发**；
> 步骤 0（改 ESM）与步骤 5（模块搬迁）**建议再往后放**（会先破坏安全网）。
> **关键点**：前四步**不碰模块系统**，全程在 `run-all.js` 保护下完成
> （现 **19 套件 / 170 断言**，退出码 0 = 全绿）；
> **步骤 0 会先让脚手架失效**（它靠 `window.eval` 拼接两文件，与 ESM 不兼容），
> 所以必须与脚手架改造同批做。**先做有保护的，再做破坏保护的。**
> **📌 PLAN §3.1（近似色合并）已按"新代码不阻塞于 ESM 决策"的方式落地** ——
> 全程使用现有安全网，未触碰模块系统。这也再次说明：
> **功能开发可以继续，ESM 决策不阻塞它。**

> **`state` 字段必须先声明再使用** —— 3 个影子字段（`dragSelection` / `rawGridData` /
> `rawColorCounts`）**已补齐声明**，并补充了 `touchStartCenter` / `aspectWarning`。
> 新增字段请一律写进 `state` 字面量并加注释说明语义（哪些是归一化坐标、哪些是 client 像素）。


## ⚠️ 错误提示：按阶段选对函数（踩过坑）

系统里有**两套**提示，用错会导致「提示写了但用户看不见」：

| 函数 | 承载元素 | 何时用 |
|---|---|---|
| `showError(msg)` | `#uploadError`（在 `#uploadSection` **内部**） | **仅上传阶段** |
| `showToast(msg)` | `#toast`（`position:fixed`，**独立于所有分区**） | **上传之后的任何阶段** |

**原因**：`showViewer()` 会设 `uploadSection.hidden = true`。
上传完成后 `#uploadError` 就不可见了 —— 写进去的消息**静默丢失**。

> 这个坑真实发生过：C2 的导出超限提示曾用 `showError`，
> 结果「点了没反应」的问题修完仍然「没反应」。详见 REVIEW.md §八 第 8 条。

**验证要求**：新增或修改任何用户可感知的输出，测试断言必须落在
**「用户能看见/听见的结果」**上，不能只断言「状态被赋值」或「函数被调用」。

## 核心数据流

1. `handleFile()` → 读取图片，设置 `state.image`
2. `showViewer()` → 渲染图片到 viewerCanvas，显示选框
3. 用户拖拽选框 / 选网格尺寸
4. `generateGrid()` → 逐格采样平均色 → `findNearestColor()` 映射 → `state.gridData`
5. `renderPreview()` → previewCanvas 绘制像素网格 + 色号
6. `renderStats()` → 颜色用量统计表
7. `downloadPNG()` → **自适应倍率**高清合成（网格 + 色号 + 图例）→ PNG 下载

> **导出倍率是自适应的**（REVIEW.md C2 已根治）：期望 2x，若超出设备上限
> （总像素 > 16.78MP 或单边 > 4096px）则自动降到 1x。
> 实测：29/52 → 2x；**78/104 → 1x（此前完全导不出）**。
> 降档会如实写在 `#previewInfo` 上，不静默。

## 关键状态 (app.js state)

| 字段 | 说明 |
|------|------|
| `image` | 原始 HTMLImageElement |
| `imageW/H` | 原始图片尺寸 |
| `zoom` | 缩放倍率 (0.2~5) |
| `panX/Y` | 平移偏移 |
| `selection` | 选框归一化坐标 `{x, y, w, h}` (0~1) |
| `gridW/H` | 目标网格尺寸 (15~104)。**重新上传/重置时回到 29**（m12 已修） |
| `gridData` | 二维数组，每个元素为 `{name, hex, r, g, b}` 或 `null`（空格）。**与 `rawGridData` 不共享引用**（n7 已修） |
| `colorCounts` | 按数量降序的颜色统计数组 |
| `rawGridData/rawColorCounts` | 颜色简化前的原始数据（供 slider 回溯）。**深拷贝，与 `gridData` 及全局色板都隔离** |
| `simplify` | 颜色简化强度 0-100，0=关闭。**重新上传/重置时由 `resetSimplify()` 清零**（REVIEW.md C1 已修） |
| `lastTouchDist` / `lastTouchCenter` | 双指缩放比 / 上一帧中心点（算缩放比用） |
| `touchStartCenter` | 双指手势**起点**中心点。平移位移相对它累计（M2 已修，不要改回单帧增量） |
| `isPinching` | 是否正在进行双指操作 |
| `aspectWarning` | 极端宽高比的量化偏差提示文本（无则 `null`），由 `generateGrid` 写入、`renderPreview` 展示（M9） |
| `mergedColors` | 本轮被**近似色合并**掉的色号，形如 `[{from:"H12", to:"E16"}]`（无则空数组）。由 `applySimplify()` 写入、`renderPreview()` 展示到 `#previewInfo`。**每轮重算的展示用字段，不参与持久化** |
| `dragStartImage` / `dragStartClient` / `panStartPan` | ✅ **语义已拆开**（REFACTOR §2.2 步骤 3b）：分别为**归一化图片坐标** / **client 像素坐标** / **pan 偏移量起点**。此前挤在一个 `dragStart`/`panStart` 里（同名不同形状）。**不要合并回去，也不要跨语义混用**（`test-dragstart-semantics.js` 守护） |

## 色板 (color-palette.js)

- 221 色，MARD 品牌标准色
- 分组：A(黄橙), B(绿), C(蓝青), D(紫), E(粉), F(红), G(棕), H(灰白黑), M(混色)
- 匹配算法：RGB 欧氏距离最近邻

## 交互操作

### 桌面端
- **框选区域**：在图片上拖拽（空白处开始新选框，选框内拖拽移动）
- **8 个手柄**：调整选框大小
- **滚轮**：缩放 (0.2x ~ 5x)
- **右键拖拽**：平移图片

### 移动端（触摸设备）
- **选框内拖拽**：移动选框
- **选框外拖拽**：平移图片
- **双指捏合**：缩放
- **双指平移**：移动图片
- **8 个手柄**：22px 大圆点（桌面端 12px），调整选框

### 通用
- **网格预设**：29 / 52 / 78 / 104（固定尺寸，不支持比例调整）
- **选框内容完整放入豆板（contain）**：选框内容按原比例完整放入豆板，居中显示。选框宽于豆板时内容填满宽度、上下留空；高于豆板时填满高度、左右留空。不裁剪内容。
- **键盘操作**（C3 已修）：`方向键` 移动选框（步长 2%）、`Shift+方向键` 调整大小（最小 5%）。
  先 Tab 聚焦到查看器；每次操作有 `aria-live` 播报。
- **颜色简化**：滑块 0-100%，合并网格中相近的颜色，减少颜色种类。
  ⚠️ **滑块归零（"关闭"）不等于没有合并** —— 系统另有一层**常开的近似色合并**
  （针对色板自身的近同色对，见下方「近似色合并」小节）。滑块关的是**用户主动的强度压缩**，
  关不掉那层数据修正
- **近似色合并告知**：发生合并时 `#previewInfo` 显示「已合并近似色：H12→E16」，**不静默替换**
- **透明像素**：采样时跳过 alpha<128 的像素，全透格子留白标记
- **自定义网格**：15~104 任意 W×H，支持非正方形豆板。**输入非法值会给出提示**（m10 已修）
- **极端比例提示**：内容短边格数过少时（量化偏差 > 8%）在预览信息处如实警告（M9）
- **拍照上传**：移动端显示拍照按钮，调用原生相机
- **分享**：支持 Web Share API 的设备可分享 PNG 文件

## 预览参数

- 画布最大边 720px，另一条边按网格宽高比 `cols/rows` 计算，单元格保持真实比例（非正方形）
- 小屏自动缩放：画布宽于容器时按比例缩小（最小 35%）
- 预览 canvas 显式设置 `style.width` 和 `style.height`，避免 iOS 14.4 用 `height` 属性值算错比例
- cellW/cellH = drawW/cols, drawH/rows，范围 8~25px
- 文字阈值 minCellForText = 10px（以较短边 `min(cellW, cellH)` 判断）
- 色号字体 = max(5, minCell * 0.35)px，深色格白字、浅色格黑字
- `#previewInfo` 同时展示**导出倍率与像素尺寸**（降档时注明原因）、**近似色合并告知**与**极端比例警告**
  - 合并告知形如「已合并近似色：H12→E16」，**必须带替代色号**（只说"H12 没了"等于没说）
- 下载 PNG：较短边 28px，较长边按网格比例缩放，倍率自适应（见上）

## 🧩 共用绘制/几何函数（新功能应复用，不要另写一份）

> 这些是 REFACTOR §7.1 前四步抽出的公共实现。**PLAN 的行列标尺、A4 打印应直接复用
> `drawGrid`**，不要新写绘制循环。改动它们前先看对应的守护套件。

| 函数 | 职责 | 守护套件 |
|---|---|---|
| `computeImageRect(w, h)` | 图片在画布中的绘制矩形（contain + zoom/pan） | `test-compute-image-rect.js` |
| `drawGrid(ctx, grid, opts)` | 网格三遍绘制：填色 / 网格线 / 色号 | `test-draw-grid.js` |
| `pickTextColor(cell)` | 依 Rec.601 亮度选黑字或白字 | `test-draw-grid.js` |
| `FONT_STACK` | 字体栈常量（**不要再硬编码字体串**） | `test-draw-grid.js` |

> ⚠️ **`drawGrid` 的 4 个开关是"刻意保留的出口差异"，不要统一**
> （详见 `drawGrid` 的 JSDoc 差异表）：
>
> | 开关 | 预览 | 导出 | 原因 |
> |---|---|---|---|
> | `hatchEmptyCells` | `true` | `false` | 预览画空格斜线，导出不画（用户定调） |
> | `gridLineColor` | `0.15` | `0.25` | 导出供打印，需更清楚 |
> | `textMinCell` | `10` | `null` | 预览小格不画字，导出总是画 |
> | `roundFontSize` | `false` | `true` | 导出字号取整更稳 |
>
> ⚠️ **`computeImageRect` 必须保留 `w/h` 参数**：三个调用方的宽度来源**本就不同**
> （`viewerCanvas.width` vs `getBoundingClientRect().width`），
> 在 iOS 的 0 尺寸时序窗口内不相等。**让它自己取尺寸会改回已修的 iOS 缺陷。**

## PWA 相关

- `manifest.json`：standalone 模式，indigo 主题色
  - **图标分两组声明**：`icon-192/512.png` 为 `purpose: "any"`；
    `icon-192/512-maskable.png` 为 `purpose: "maskable"`（内容限制在中心 56%，见 REVIEW.md n2）
  - ⚠️ **不要把 `maskable` 混进 `"any maskable"`** —— 满幅图标在圆形遮罩下会被切掉边缘
- `sw.js`：cache-first 策略，预缓存核心资源（**逐个 `cache.add()` + `allSettled`**，
  单个失败不拖垮整体，见 REVIEW.md M7）；离线可用
- **改任何核心文件（html/css/js/manifest/图标）都必须递增 `CACHE_NAME`**，
  否则 cache-first 会让老用户一直拿到旧文件
- `beforeinstallprompt`：监听安装事件，显示底部横幅
- `appinstalled`：安装后隐藏横幅
- 安全区域：`env(safe-area-inset-bottom)` 适配 iPhone notch
- Standalone 模式：`env(safe-area-inset-top)` 适配状态栏

## iOS 兼容性备忘

### iOS 14.4 已修复
- **选框不可见**：旧 iOS 对 `hidden` 属性切换后渲染可能不生效。改用 CSS class `.visible` 控制显隐 + 在 `renderViewer()` canvas 上直接绘制选框轮廓作为双保险
- **图纸预览拉伸**：`previewCanvas` 缺少 `style.height` 导致 iOS 14.4 用 `height` 属性值（×dpr）算错 CSS 高度，格子被拉伸。显式设置 `style.height = canvasH + 'px'`
- **布局时序**：iOS 14 的 `hidden→visible` 切换后 `getBoundingClientRect` 可能返回 0。通过 `void viewerWrapper.offsetHeight` 强制 reflow + `requestAnimationFrame` 确保布局完成后再读取尺寸
- **`resizeViewerCanvas()` 零尺寸重试**：调用 `getBoundingClientRect` 返回 0 时自动 rAF 重试，避免无声设成 0 尺寸

## 未来可扩展方向

> **完整清单、优先级排序与实施方案见 [PLAN.md](PLAN.md)**（含实测数据与待验证项）。
> 本节仅保留索引，避免两份清单各自漂移。

### 计划中（按优先级）

> **✅ 已完成项已移出本清单**（原第 3 项「大图导出失效修复」已由自适应倍率根治，见 REVIEW.md C2）。
> 完整论证与实测数据仍在 PLAN.md，本清单只保留**尚未开工**的。

1. 行列标尺（图纸编号标记叠加）— 打印方案的前置 ← **下一项**
   - ✅ **直接起点**：复用已抽出的 `drawGrid(ctx, grid, opts)`，给它加一个"在边距外画行列号"的选项即可，
     **不要另写绘制循环**
2. ~~近似色自动合并~~ ✅ **已完成** —— 见下方「近似色合并」小节（改 `applySimplify` 前必读）
3. 单元格编辑（画笔/擦除/吸管）+ 撤销/重做
   - ✅ **强制前置已解除**：`gridData`/`rawGridData`/色板的**三重引用已拆开**（REVIEW.md n7），
     现在可以安全地就地编辑格子
4. A4 打印导出 — 见 PLAN.md §四
5. 网格保存/加载

### ⚠️ 近似色合并（已实现，改 `applySimplify` 前必读）

`applySimplify()` 现在是**双层**结构，**不要再合并回单层**：

| 层 | 阈值 | 何时生效 | 目的 |
|---|---|---|---|
| ① **常开近似色合并** | `AUTO_MERGE_DIST_SQ = 16`（dist ≤ 4） | **总是**（滑块归零也生效） | 修**色板自身**的近同色对缺陷 |
| ② 滑块合并 | `(simplify/100)*5000` | 仅 `simplify > 0` | 用户主动压缩色数 |

**两条硬约束**（由 `test-simplify.js` 的 14 条断言 + `probe-simplify-mutation.js` 突变测试守护）：

1. **决胜规则是「色板序号较小者优先」，不是频率。**
   旧实现按频率决胜，后果是**同一张图换网格尺寸后色号会漂移** ——
   实测同一张近白图 `simplify=30%` 时 **29×29 得 `E16`、52×52 得 `H12`**。
   用户按一份图纸买了豆，换个尺寸色号就变了。**不要改回频率决胜。**
2. **合并表必须是「静态色板级」**（`getStaticMergeMap()`：只看色板，与图上出现了哪些色无关）。
   若改成"只在图上出现过的色里选目标"，漂移会**重新出现**（某尺寸下目标色可能压根没出现）。
   ⚠️ 这两种规则**只在"图上没有出现目标色"时才有区别**，所以判据必须是
   **纯 H12 图**（E16 完全不出现）；用"图上同时有两种色"的用例**区分不出来**（已实测踩过）。

> **代价（已确认接受）**：阈值 4 时 4 个色号**永久不可达**（`G18`/`H12`/`H17`/`H21`）。
> 这是任何固定决胜规则的必然代价，且被并两色实测距离 ≤ 4、肉眼无法分辨。
> 若收到"我常用的色号消失了"反馈，优先考虑**放宽阈值或加图例说明**，
> **不要**回退到频率决胜（会重新引入漂移）。
>
> **`state.mergedColors`** 是每轮重算的**展示用**字段（`[{from, to}]`），
> **不参与持久化** —— 第三批的序列化地基不需要带上它。

> **复现与验证脚本**（均在本仓库 `.pindou-devtools/`，本机实测跑过）：
> | 脚本 | 用途 |
> |---|---|
> | `probe-nearcolor.js` | 复算色板色对分布、各阈值下的合并结果（PLAN 全部数值可由此复现） |
> | `test-simplify.js` | 14 条回归断言（**已接入 `run-all.js`**） |
> | `probe-simplify-mutation.js` | **突变测试**：4 种"改回旧行为"的突变均须让测试转红，跑完自动逐字还原 |
> | `verify-browser.js` | **真实 Chrome** 端到端 10 项（需先起 http.server，**未接入 `run-all.js`**） |

### 其他

- 抖动算法 — 提升照片转化质量，**默认关闭**的可选项
- 简化滑块高端行为核对（见 PLAN.md §3.3）
- **分块渲染**（C2 的进一步根治）— 当前已用自适应倍率保证"能出图"，
  分块渲染的收益转为"降低桌面端峰值内存与卡顿"，属产品决策项

### 已搁置

- 多品牌色板支持（HAMA、Artkal 等）— 依赖色板抽象，成本主要在数据可靠性
- 色板自定义编辑 — 依赖最多、风险最高，需版本化
- 将图片像素化再生成图纸 — 与现有逐格采样高度重叠

## 运行方式

**必须经 HTTP 服务打开**，不能直接双击 `index.html`：

```bash
python3 -m http.server 8080
# 然后访问 http://localhost:8080
```

> **本机 Python 环境（已实测）**：`python` / `python3` 均可用，实际指向
> `%LOCALAPPDATA%\Programs\Python\Python314\python.exe`（**Python 3.14.8**），
> `python -m http.server` 已验证可正常提供本项目的全部资源。
>
> ```powershell
> python -m http.server 8080   # 或 python3，两者等价
> ```
>
> ⚠️ **不要**直接按完整路径调用 `%LOCALAPPDATA%\Microsoft\WindowsApps\python.exe` ——
> 那是 0 字节的 Store 别名占位符，会以 **exit 9009** 失败。
> 按名字调用 `python` 时 PATH 解析到真实安装，不受影响。
> （教训：判断命令是否可用要用与真实用法一致的调用方式，别用 `Get-Command` 取路径再执行。）

> **⚠️ 已决定改用原生 ESM（`<script type="module">`）** —— 见 [REFACTOR.md](REFACTOR.md) §4.1。
> ESM 受 CORS 限制，`file://` 协议下无法加载模块，**因此"双击打开"不再可用**，这是已接受的代价。
> 若只做静态预览而不涉及模块加载，可直接打开查看，但**功能不完整**。
>
> 仍不引入任何构建工具：原生 `import`/`export` 即可，无需 `package.json` 或打包步骤。
>
> **📌 现状（REFACTOR §7.1 前四步完成后）**：**ESM 尚未启用**，`index.html` 仍是裸 `<script src>`，
> 代码仍全在 `app.js`（单文件共享作用域）。
> 但**三个硬阻塞已全部解除**（猴补丁 / 坐标语义 / 重复逻辑），
> 所以**现在未启用 ESM 是"选择"而非"受阻"** —— 启用前须先改造测试脚手架（§7.3），
> 两者必须**同批**做。详见 [REFACTOR.md](REFACTOR.md) §7.1 与 §六 决策点 1。
