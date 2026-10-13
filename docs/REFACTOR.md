# 拼豆图纸生成器 — 代码结构对策

> ## 📍 本文档的职责边界
>
> **本文档只讲「代码放在哪里、边界怎么划、踩过哪些结构性地雷」。**
>
> | 想看什么 | 去哪里 |
> |---|---|
> | **要做什么功能 / 排期 / 执行进度 / 下一步** | **[PLAN.md](PLAN.md)** ← 唯一真源 |
> | 用户怎么用、怎么跑起来 | [../README.md](../README.md) |
> | 面向 AI 的技术说明（模块、数据流、约束） | [../CLAUDE.md](../CLAUDE.md) |
> | 代码审查结论（37 项，已全部处理） | [REVIEW.md](REVIEW.md) |
>
> ⚠️ **本文档不再记录功能排期与进度** —— 那属于 PLAN。
> 这里只保留**结构侧**的结论、规则与教训。
>
> ### 状态图例（全文统一）
>
> | 符号 | 含义 |
> |---|---|
> | ✅ | 已完成并有测试守护 |
> | 🔜 | 待办（现存唯一项已移交 PLAN，见 §7.1） |
> | 📜 | 历史记录 —— 描述的是**当时**的情况，不是现状 |
> | ⚖️ | **现行规范** —— 改代码时要遵守 |
> | ⚠️ | 风险 / 易踩的坑 |
>
> ⚠️ **凡带 📜 的章节，其中的行数、断言数、文件状态都是"写作时"的数值**，
> 不代表现状。**要现状请看 §一 与本导读。**

---

> ### 📜 写作背景
>
> 本文档针对一个具体风险：**后续改动会全部塞进 `app.js`**。
> 结论基于对 `app.js`（**写作时 1326 行 → 复核时 1735 行 → §7.1 前四步完成后 1813 行
> → PLAN §3.1 完成后 1901 行 → PLAN §3.5 完成后 2137 行** → **步骤 5 后已删除**）、
> `color-palette.js`、`index.html`、`sw.js` 的逐行通读与全量 `state.*` 读写枚举。
> **标注「已实测」者为实际读取/运行确认；标注「静态推断」者未运行验证。**
>
> ⚠️ **行号锚点须知**：文中所有 `app.js:NNN` 行号**已整体失效**（`app.js` 现已删除）。
> 请**按符号名定位**，行号仅作"当时在哪"的历史记录。详见 §7.7。

---

## 一、结论先行

**这个风险是真实的，曾经进入临界区；现已通过「步骤 5 拆文件 + 步骤 0 改 ESM」清偿。**

| 指标 | 写作时 | 改造前峰值 | **当前** |
|---|---|---|---|
| `app.js` 行数 | 1326 | 2137 | **已删除**（内容全部迁至 `js/` 下 19 个模块） |
| 承载的特性域 | 12 个 | 12 个 | 分散在 `js/{core,input,viewer,pipeline,output,ui}/` |
| 顶层函数 | 21 个 | 29+ 个 | 按特性域归属各模块，跨模块引用显式 `import` |
| 顶层事件监听 | 26 处 | 28 处 | 随所属领域落位 |
| `state` 字段 | 21 个（3 个未声明） | 30 个（均已声明） | 30 个，定义在 `js/core/state.js` |
| 脚本加载方式 | `<script src>` 裸标签，**非 ESM** | 同左 | **原生 ESM**（`<script type="module">` 单入口） |

> **⚠️ 模块边界已建立。** §7.1 的「前四步」与「步骤 0（改 ESM）」「步骤 5（模块搬迁）」
> **均已全部完成**：三个硬阻塞解除、重复逻辑 4 项收敛为单一实现、
> 19 个模块各有明确归属、跨模块依赖由 `import` 语句显式表达。
>
> **未完成的结构收尾项（拆 `pointermove` 三合一回调 + 跨领域调用收拢到 `main.js`）
> 已作为最后一步记入 [PLAN.md](PLAN.md)** —— 见 §7.1 与 §3.3。

**不做对策会怎样**（这条判断已被验证）：PLAN 的第一批预计新增 300–500 行、
第三批预计新增 600+ 行。**在单文件形态下 `app.js` 会突破 2000 行** ——
实测确实到了 2137 行才开工，代价是那期间有 **2 个功能未按规则 1 落位**（见 §4.4）。

**但必须说明**：本项目**始终没有**为了"架构美观"而大重构。实际路线一直是
**「先拆地雷 → 再定边界 → 后续新代码按边界落位」**，即"随功能演进逐步分家"。
且**至今未引入任何构建工具** —— 纯前端零依赖这条底线没有被 ESM 化破坏
（原生 `import`/`export` 即可，无需 `package.json` 或打包步骤），见 §4.1。

---

## 二、三个真实的阻塞点（✅ 均已解决）

这三项不是风格问题，是**会让后续重构直接失败**的硬阻塞。**保留为历史记录**，
用来解释"为什么当初必须先做这几步"。

### 2.1 ⚠️ `generateGrid` 被猴补丁覆盖 —— ✅ **已拆除（步骤 1 完成）**

> **现状**：`generateGrid()` 是**唯一入口**（显式驱动加载遮罩 + rAF 调度 + 错误兜底），
> 真实实现迁为独立的 `generateGridCore()`；文件末尾的补丁块已整体删除。
> 由 `test-patch-removal.js`（7 条断言）与 `probe-esm-cost.js`（"不得复活"断言）共同守护。

原文所述的补丁形态（行号为当时值）：

```js
const _origGenerateGrid = generateGrid;   // 1277
generateGrid = function() { ... };        // 1278 ← 对函数声明重新赋值
```

> **⚠️ 归因更正（本轮实测，详见 §7.2）**：本节原文断言"一旦改为 ESM 就会抛 `TypeError`"，
> **该归因不成立**。用真实 `.mjs` 模块实测：函数声明在 ESM 顶层仍是**可变绑定**，
> 单独加 `type="module"` **不会**让这段失败。
>
> 真正会失败的是另外两种情形：**① 把 `generateGrid` 改成 `const`**；
> **② 它成为跨模块 `import` 的绑定**（§4.2 的模块划分恰恰会这样做：
> 归入 `pipeline/grid.js` 并 `export`）。
>
> **结论（必须先拆）不变，但理由须按修正后的表述理解。**

**为什么这仍然是地雷**：一旦 `generateGrid` 被改为 `const`，或经模块划分成为
**跨模块导入的绑定**，重新赋值就会抛 `TypeError: Assignment to constant variable`。
而 §4.2 的模块划分**必然**把它归入 `pipeline/grid.js` 并导出 ——
**即"模块化尝试会在这里失败"。**

**附带发现**：`_origGenerateGrid.call(this)` 中 `this` 为 `undefined`
（顶层函数调用，非严格模式下降级为 `globalThis`），`call` 在此**无实际意义** ——
说明这段是模仿方法包装写的，但对普通函数并不正确。（此项**经复核确认正确**。）

**对既有行为的隐藏影响**：包装后调用链变为
`showLoading → rAF → 真正生成 → setTimeout(≥300ms) → hideLoading`。
由于生成被推迟到 `rAF`，**任何在调用 `generateGrid()` 后立即读 `state.gridData` 的代码，
读到的都是上一轮数据**。当时 4 处调用点都未这样读，所以尚未暴露，
但这是一条**隐式时序契约**，重构时必须显式化。

> ✅ **已处理**：该契约已**显式写进** `generateGrid()` 的注释，
> 并由 `test-patch-removal.js` **实测守住**（断言"返回瞬间仍是上一轮行数、泵完 rAF 后才刷新"）。
> 现位于 `js/pipeline/grid.js`。

**对策**：把加载状态移入 `generateGrid` 内部（或在真实生成完成处回调），
**删掉整个补丁块**。这是重构的**第一个动作** —— ✅ 已完成（步骤 1）。

> **✅ 落地结果**：
> - 加载状态已移入 `generateGrid()` 入口，补丁块整体删除，**未新增回调参数**
>   （保持调用点零改动，符合"行为等价"要求）。
> - **时序契约已显式化**：由 `test-patch-removal.js` 用**实测**守住。
> - `finally` 兜底语义**原样保留**：专门注入一个抛错的 `getContext`，断言
>   "遮罩仍然消失 + 出现 toast"，防止界面永久卡死回归。

### 2.2 ⚠️ `dragStart` / `panStart` 混用两套坐标系 —— ✅ **已拆分（步骤 3b 完成）**

> **现状**：`dragStartImage`（归一化）/ `dragStartClient`（client 像素）/ `panStartPan`（pan 偏移量），
> 三者均带类型注释。**行为零变化** —— 只改名与拆字段（§2.2 澄清过它不是 bug）。
> 由 `test-dragstart-semantics.js`（9 条断言，含 2 组负向对照）守护：
> 既防止字段被再次合并，也验证"拿归一化值当 client 用"会被立刻抓到。

原文所述的混用形态（行号为当时值）：

| 字段 | 写入点 | 存储内容 |
|---|---|---|
| `state.dragStart` | 414、420 | **归一化图片坐标** `{ix, iy}` |
| `state.dragStart` | 517 | **client 像素坐标** `{x: e.clientX, y: e.clientY}` |
| `state.panStart` | 516、544 | **pan 偏移量** `{x: panX, y: panY}` |

**为什么必须先拆**：拆模块时若把这个字段一起搬过去，**会把语义混乱一起搬走**，
之后每加一个交互（如标尺拖拽、单元格画笔）都会踩一次。

**对策**：拆为 `dragStartImage` / `dragStartClient` / `panStartPan`，**并在 `state` 声明处补齐类型注释**。

> **澄清（避免误判为缺陷）**：我曾怀疑读 `ds.ix/ds.iy` 是取错字段。
> **经核对，此处不是 bug** —— 写入的正是 `{ix, iy}`，形状匹配。
> **真正的问题是"同名字段存在两种形状"**，属**命名/语义不一致风险**，而非当前的功能错误。
> **不要在重构中把它当 bug "修"。**
> → ✅ 严格按此执行：**只拆字段与改名，未改任何行为**。

### 2.3 ✅ `state` 曾有 3 个字段"影子存在" —— **已修复（步骤 3a）**

> ✅ **已解决**：3 个影子字段（`dragSelection` / `rawGridData` / `rawColorCounts`）
> 均已**补齐声明**，另外还补了 `touchStartCenter` / `aspectWarning`。
> 现定义在 `js/core/state.js`。
>
> 📜 问题当时：`state` 字面量声明了 21 个字段，但实际还在运行时动态添加了 3 个。
> **后果**：`state` 的**声明与使用已经漂移**。任何后续改 `state` 的人（尤其序列化/撤销）
> 会**看不到这些字段**，从而漏改、漏持久化。
>
> **对策**：补齐声明并加"来源/消费方"注释。**成本几分钟，收益是后续所有改动都能看到全貌。**
> → ✅ 已按此执行。

---

## 三、结构问题清单（按处理价值排序）

### 3.1 重复逻辑 —— ✅ **7 项中 6 项已清偿**（步骤 2/4）

> **唯一未做的是 #6**（选框默认值抽常量）——
> 低优先级、当前不算缺陷，但**改默认选框时要记得改 3 处**。

| # | 重复内容 | 抽成 | 现状 |
|---|---|---|---|
| 1 | **viewport 变换数学**（contain 适配 + zoom/pan → 图片矩形） | `computeImageRect(w, h)` | ✅ **已完成**（步骤 2，3 份 → 1 份） |
| 2 | **网格绘制三遍循环**（填色 / 网格线 / 色号） | `drawGrid(ctx, grid, opts)` | ✅ **已完成**（步骤 4，2 份 → 1 份） |
| 3 | **亮度 → 黑白字判定** | `pickTextColor(cell)` | ✅ **已完成**（步骤 4） |
| 4 | **缩放夹取 0.2~5** | 复用已有 `clamp()` | ✅ **已完成** —— `clamp` 现被 5 个模块共用。定义在 `js/ui/a11y.js` |
| 5 | **字体栈**（5 处字面量） | `FONT_STACK` | ✅ **已完成**（步骤 4，5 处 → 1 处） |
| 6 | **选框默认值** `{x:.15,y:.15,w:.7,h:.7}` | `DEFAULT_SELECTION` 常量 | ⚠️ **未做（低优先级）** —— 字面量仍在 3 处（`state.js` 初值 / `upload.js` 重新上传 / `a11y.js` 重置）。**当前不算缺陷**：三处值一致且有测试守护；但若将来要改默认选框，**必须同时改 3 处** |
| 7 | **颜色频次统计** | 统一走 `rebuildColorCounts()` | ✅ **已统一行为**（REVIEW M1）—— 两路径现都按数量降序 |

> **⚠️ 第 1 项抽取有个必须保留的差异**：`renderViewer` 用 `viewerCanvas.width`，
> 另两处用 `getBoundingClientRect().width`。二者在 `resizeViewerCanvas` 后应相等，
> **但在 iOS 的 0 尺寸时序窗口内不等**（零尺寸重试逻辑正为此存在）。
> **抽取时须保留这个差异，否则会把已修复的 iOS 缺陷改回来。**
> → ✅ **已按此要求落地**：`computeImageRect(w, h)` 接收尺寸参数、不自己取。

### 3.2 ✅ 三项行为不一致 —— **已全部处理**（先定调、后重构）

| # | 现象 | 状态 |
|---|---|---|
| 1 | **双指平移只生效一帧** | ✅ **已修复**（REVIEW M2）—— 改为相对 `touchStartCenter`（手势**起点**）累计。有算术复现证据。**真机观感仍待验证** |
| 2 | **统计表排序随滑块变化** | ✅ **已统一**（REVIEW M1）—— 两路径都按数量降序 |
| 3 | **预览与导出的空格标记不同** | ✅ **已定调「保持差异」**（步骤 4：做成 `hatchEmptyCells` 参数，`test-draw-grid.js` 守护） |

> ✅ **三项已全部处理**。**"先定调再重构"的做法是有效的** —— 正因为提前定调，
> 抽取 `drawGrid` 时差异被**参数化保留**而不是"顺手统一"，用户可见产出零变化。
>
> **原始提示（保留）**：这三项若在重构前不明确，会被"顺手统一"成某一个方向，
> 而用户可能依赖现状。

### 3.3 跨领域耦合 —— ⚠️ **部分已缓解；收拢是结构侧最后一项（已移交 PLAN）**

| 现象 | 现状 |
|---|---|
| `showViewer()` 是"无家可归的编排器" | ⚠️ **仍存在**（现位于 `js/viewer/viewer.js`）—— 归位到 viewer 领域后，"无家可归"的问题已缓解，但跨领域调用本身未收拢 |
| `pointerup` 反向驱动 generation | ⚠️ **仍存在**（`selection.js` → `grid.js`）—— 每次拖拽结束全量重算 |
| `#resetBtn` 横跨 5 个领域 | ⚠️ **仍存在**（现位于 `js/ui/a11y.js`）—— 直接写 5 个 state 字段 + 4 个区块显隐 + 清 canvas |
| `pointermove` 一个回调并联 3 套逻辑 | ⚠️ **仍存在**（`selection.js`）—— `isDragging`/`isResizing`/`isPanning` 三个独立 `if` |
| 36 个 DOM 引用平铺 | ⚠️ **仅部分改善** —— 引用仍集中在 `js/core/dom.js`，但**只在需要处 import**（ESM 后不再"全项目共享"）。各模块也改为谁用谁取。**这不算已解决** —— `dom.js` 仍是"所有 DOM 引用的集散地" |

> **📌 收拢工作已移交 [PLAN.md](PLAN.md)**（作为执行顺序的最后一步）——
> 本文档只记录"耦合在哪里"。**在此之前它不会自行消失，也不会阻塞功能开发。**

**性能耦合**：原 `pointermove` 挂在 `document` 上、**无节流、无 rAF 合并**，
每次同步调 `renderViewer()` + `updateSelectionBox()`（移动端每帧可能 2 次全画布重绘）。
→ ✅ **已缓解**：加了 `scheduleViewerRedraw()` 每帧合并，实测 `pointermove` 内
**直接 `renderViewer()` 次数 = 0**（`probe-esm-cost.js` 断言⑤ 守护）。
**性能问题本身已不再是问题** —— 剩下的拆分只关乎可读性。

### 3.4 死代码与失效引用 —— ✅ **四项已全部处理**

| 项 | 说明 | 现状 |
|---|---|---|
| `selectionOverlay` | **死引用** —— 全项目无任何逻辑使用（HTML/CSS 有定义） | ✅ **引用已删除**（作为纯布局容器保留在 HTML/CSS，`js/core/dom.js` 里留了说明注释） |
| `viewerHint` / `viewerHint2` | 仅在拖拽开始时被隐藏，显隐逻辑分散在两处 | ✅ **已按领域归位**：显示归 `viewer.js`（`renderViewer` 内），隐藏归 `selection.js`（拖拽开始时）—— 这正是"各归其位"的结果，**不是**残留的分散 |
| `isTouchDevice` | 顶层求值，无法测试/覆盖 | ✅ **已评估为可接受**：现位于 `js/core/dom.js` 顶层 IIFE。判据与 `style.css` 的 `@media (pointer: coarse)` 保持一致（REVIEW M8），由 `test-section5-guard.js` 静态守护 |
| 重复注释块 | "5. 网格生成 + 色板映射"标题写了两遍 | ✅ **已消除**：现 `js/pipeline/grid.js` 中只保留一处段标题 |

> **附注**：`lint-noundef.js` 的「死 DOM 引用」检查现在**每次跑都会扫这一类问题**，
> 且带**假绿哨兵**（解析到 0 个声明但源码里有 `$('#…')` 时报错，见 §8.8 第 17 条）——
> 所以这类问题不会静默回归。

---

## 四、对策：分家路线 ⚖️ **现行规范**

### 4.1 关键技术决策：**不引入构建工具**

| 方案 | 取舍 | 结论 |
|---|---|---|
| 保持 `<script src>` 裸标签 | 零成本，但靠全局变量共享，无边界 | 已弃用 |
| **原生 ESM（`<script type="module">`）** | **零依赖、无需构建**，浏览器原生支持 `import`/`export`；已有 `python -m http.server` 即可 | ✅ **采用** |
| 引入 Vite/webpack | 需要 `package.json`、构建步骤、产物目录，**会破坏"双击 index.html 即可运行"** | ❌ 过度 |

**采用原生 ESM 的理由**：它能在**不引入任何依赖、不改变运行方式**的前提下给出真实模块边界。
代价仅是 `index.html` 的 script 标签加 `type="module"`，以及 SW 缓存清单同步。
**注意**：ESM 有 CORS 限制，`file://` 直接打开会失败 —— 用户已确认接受（见 §六 决策点 1）。

### 4.2 目标模块划分 ⚖️

按**特性域**而非技术分层切分。✅ 表示该模块已落位（步骤 5 完成）。

```
js/
├── core/
│   ├── state.js          # state 声明 + 类型注释
│   ├── dom.js            # DOM 引用，按领域分组导出
│   └── helpers 类        # $ / $$ / clamp / isTouchDevice（现分散在 dom.js / a11y.js）
├── input/
│   ├── upload.js         # handleFile / showError / showToast / 拖拽
│   └── camera.js         # openCamera / capturePhoto / closeCamera
├── viewer/
│   ├── viewer.js         # computeImageRect / resizeViewerCanvas / renderViewer / scheduleViewerRedraw
│   ├── selection.js      # updateSelectionBox + 选框拖拽
│   └── panzoom.js        # 滚轮缩放 + 右键平移 + 触摸 + 窗口尺寸
├── pipeline/
│   ├── grid.js           # generateGrid() 入口 + generateGridCore() 实现
│   ├── simplify.js       # applySimplify / rebuildColorCounts / getStaticMergeMap
│   └── render.js         # drawGrid + pickTextColor + drawRuler / rulerMetrics / RULER_* / FONT_STACK
├── output/
│   ├── preview.js        # fitPreviewGrid / renderPreview
│   ├── stats.js          # renderStats
│   ├── export.js         # computeDownloadSize / renderDownloadCanvas / downloadPNG / sharePNG
│   └── print.js          # 【PLAN A4 打印预留】独立于此，可直接复用 drawGrid
├── ui/
│   ├── a11y.js           # announce / markActiveGridBtn / 键盘通路 / clamp
│   ├── grid-select.js    # 网格预设 / 自定义 / 简化滑块 / 标尺开关
│   ├── loading.js        # showLoading / hideLoading
│   └── install.js        # PWA 安装提示
└── main.js               # 编排层入口（⚠️ 现状：只拉起模块图，尚未承载逻辑）
```

> **⚠️ 搬迁时已确认的关键约束**：
> - `generateGrid()` 与 `generateGridCore()` **必须同模块** —— 前者是入口（驱动遮罩 + rAF），
>   后者是纯实现。跨模块导入后**不可再重新赋值**（§7.2 情形 C）。
> - `computeImageRect(w, h)` **必须保留 `w/h` 参数**，不可在模块内自取尺寸。
> - `drawGrid()` 的 **4 个差异开关必须原样传递**，`render.js` 不预设默认值。
> - **`drawRuler()` 只画边距区域**，网格本体仍归 `drawGrid()` ——
>   **不要把两者合并成一个"大绘制函数"**，也不要让 `drawRuler` 自己填色（标尺脚注在网格外，
>   与格子的黑白字规则无关：它固定用 `#333333`，画在白底边距上）。
> - **`rulerMetrics()` 是纯函数、`fitPreviewGrid()` 依赖它**，两者与 `drawRuler()` **同属
>   `render.js`**：拆到不同模块会重新引入"边距算错 → 溢出容器"的耦合缺陷。
> - **`state.rulerEnabled` 是显示偏好**，`handleFile()` **不重置**它。
> - 三个坐标语义字段（`dragStartImage` / `dragStartClient` / `panStartPan`）**分别属于
>   `selection.js` 与 `panzoom.js`** —— 拆开后正好各归其位，这正是步骤 3b 的价值。

**编排层（`main.js`）**：把当前隐式跨领域调用（`showViewer`、`#resetBtn`、
`pointerup → generateGrid`）显式收拢到一处，**其余模块之间不允许互相直接调用**。
**⚠️ 该收拢尚未执行，已作为最后一步记入 [PLAN.md](PLAN.md)。**

### 4.3 落地顺序（📜 已执行完毕）

> **核心策略（已被验证有效）**：把「拆猴补丁」提到最前，「改 ESM」推到公共函数抽取**之后** ——
> 因为前几步不碰模块系统，能在测试安全网保护下完成；而「改 ESM」会先破坏安全网。
> **先做有保护的，再做破坏保护的。**

| 步 | 动作 | 状态 |
|---|---|---|
| **0** | 建 `js/` 骨架 + `index.html` 改 ESM + **SW 清单同步** | ✅ 已完成 |
| **1** | **拆猴补丁** | ✅ 已完成 |
| **2** | **抽 `computeImageRect()`** | ✅ 已完成 |
| **3** | **补齐 state 声明** + **拆 `dragStart` 语义** | ✅ 已完成 |
| **4** | **抽 `drawGrid()` / `pickTextColor()`** | ✅ 已完成 |
| **5** | 按 §4.2 逐模块搬迁 | ✅ 已完成 |
| **6** | 拆 `pointermove` 三合一回调 + 跨领域调用收拢 | 🔜 **已移交 PLAN（最后一步）** |

> **⚠️ 第 0 步原有两个容易漏的地方（历史提示，均已处理）**：
> ① `sw.js` 用**硬编码资源清单**做离线缓存，拆出 `js/` 后必须**逐个加入清单并提升
>    `CACHE_NAME`**，否则新模块 404 导致离线白屏、或老 SW 按旧清单返回旧代码。
>    ✅ **已加固**：迁移工具每次核对"清单 ↔ 磁盘"双向一致；`probe-esm-cost.js` 断言④ 独立核对。
> ② **测试脚手架会失效**（它靠 `window.eval` 拼接两文件，与 ESM 不兼容）。
>    ✅ **已处理**：脚手架改为"runner 子进程 + 真实 `import()`"，见 §8.4。

**每步之后必须验证的**：跑 `node run-all.js`
（**套件与断言数会随开发增长 —— 现状见 [PLAN.md](PLAN.md) §6.6**），
以及 上传 → 框选 → 生成 → 预览 → 统计 → 下载。**桌面与 iOS 都要过**，
因为项目历史上有多个 iOS 专属缺陷（见 CLAUDE.md「iOS 兼容性备忘」），重构极易把它们改回来。

### 4.4 防复发的规则（写进 CLAUDE.md）⚖️

1. **新功能不许写进 `main.js`** —— 按 §4.2 归位；若无归属，先讨论再加目录。
2. **模块间不得直接互相调用**，跨领域一律经编排层。
3. **`state` 字段必须先声明再使用**（§2.3 的教训）。
4. **不许再对函数做猴补丁**（§2.1 的教训）——需要横切逻辑就用显式包装函数或回调参数。

> ### ⚠️ 规则 1 的**两次已记录偏离** —— ✅ **均已偿还**
>
> **第 1 次：PLAN §3.1 近似色合并** —— `applySimplify()` 的重写与新增的
> `getStaticMergeMap()` / `staticMergeCache` / `AUTO_MERGE_DIST_SQ` **写进了 `app.js`**
> （1813 → **1901 行**），**未**按规则 1 落位到 `js/pipeline/simplify.js`。
>
> **第 2 次：PLAN §3.5 行列标尺**（1901 → **2137 行**）—— `rulerMetrics()` / `drawRuler()` /
> `RULER_*` 常量 / `fitPreviewGrid()` 同样**写进了 `app.js`**。
>
> **两次都是用户的明确选择**，不是遗忘：开工前都把选项摆明（新建模块 vs 写进 `app.js` vs
> 先做 ESM），**理由一致** —— §4.2 的目录结构依赖 ESM，而 ESM **尚未决策**
> 且会**先让安全网失效**；在"结构正确"与"保住当时已有的断言"之间选了后者。
>
> **偿还**：**✅ 已于步骤 5 还清** —— 两组符号现分别位于
> `js/pipeline/simplify.js` 与 `js/pipeline/render.js`，**都是 §4.2 原本预留的位置，未新增目录**。
>
> **⚠️ 这不构成放宽规则 1 的先例**：两次偏离的根因都是"ESM 未决"，
> **而 ESM 现已落地（§八），该根因已消失，这一借口不再成立。**
> 后续新功能仍应按 §4.2 归位，或先讨论。

---

## 五、为什么不"停工大重构" 📜 **决策记录**

如实说明反方理由，避免把重构本身变成风险：

- **项目是零依赖 demo**，2137 行仍在**单人可通读**的范围内（但已明显偏大）。重构的收益是"未来改动的可维护性"，
  不是"现在跑不动"。
- **无测试覆盖曾是最大风险** → ✅ 已补救：建立了回归脚手架。**但它有边界**：它**无法替代真机**。
  项目已积累多个 iOS 时序相关修复，**这些正是重构最容易静默改坏的**。
- **功能价值仍然高于重构** —— 用户能感知的是功能，不是目录结构。

**因此实际节奏是**：先做低风险、**全程有安全网**的公共函数抽取，
**然后回到功能开发**，此后新代码按新边界落位。
「改 ESM」与「模块搬迁」**往后放**（它们会先破坏安全网）。

> **✅ 该节奏已按计划执行**，并被验证有效：前几步全程在脚手架保护下完成，未出现回归；
> 其中**步骤 4 抽出的 `drawGrid()` 被 PLAN §3.5 行列标尺实际复用** ——
> **"先抽公共函数、再做功能"的顺序判断得到验证**，A4 打印同样可直接复用。

---

## 六、需要你决策的点 📜 **决策记录**

| # | 决策点 | 选项 | 结论 |
|---|---|---|---|
| 1 | **是否接受 ESM** | (a) 接受 —— 用 `type="module"`，**双击 index.html 将无法直接运行**，须经 HTTP 服务<br>(b) 不接受 —— 保留裸标签，只能靠"约定 + 注释"划边界 | ✅ **已选 (a)** —— 用户已确认接受"必须经 HTTP 服务打开"这一代价 |
| 2 | **重构范围** | (a) 只做推荐的前几步（拆地雷 + 抽公共函数）<br>(b) 一次做完全部分家 | ✅ **已按 (a) 执行完毕**，后续逐步推进到步骤 5 |
| 3 | **§3.2 三项行为不一致** | ~~各自确认~~ | ✅ **已全部消解**：①双指平移已修（累积式）、②统计排序已统一、③预览画斜线/导出不画**已定调「保持差异」并参数化落地** |

---

## 七、落地可行性复核要点

### 7.1 逐条状态 ⚖️ **步骤 6 的移交说明在此**

| 步骤 | 原定动作 | 当前状态 |
|---|---|---|
| **0** | 建 `js/` + 改 ESM + SW 清单同步 | ✅ **已完成** —— 19 个模块改原生 ESM，`index.html` 收敛为单入口，`sw.js` 清单与 `CACHE_NAME` 已同步。守护：`probe-verify-entry-chain.js`、`probe-esm-cost.js` |
| **1** | 拆猴补丁 | ✅ **已完成** —— 守护：`test-patch-removal.js` |
| **2** | 抽 `computeImageRect()` | ✅ **已完成** —— 重复 **3 份 → 1 份**。守护：`test-compute-image-rect.js` |
| **3a** | 补齐 `state` 声明 | ✅ **已完成** |
| **3b** | 拆 `dragStart` 语义 | ✅ **已完成** —— 守护：`test-dragstart-semantics.js` |
| **4** | 抽 `drawGrid()` / `pickTextColor()` | ✅ **已完成** —— **4 处出口差异已参数化保留**。守护：`test-draw-grid.js` |
| **5** | 逐模块搬迁 | ✅ **已完成** —— `app.js` 已删除。两笔技术债（§4.4 的两次偏离）已偿还 |
| **6** | 拆 `pointermove` 三合一 + 跨领域收拢 | 🔜 **已移交 [PLAN.md](PLAN.md) 作为最后一步** —— 它属**收尾**性质、不阻塞任何功能；**具体排期与触发条件以 PLAN 为准，本文档不重复记载** |

**推荐顺序（原计划，已执行完毕）**：`1 → 2 → 3b → 4 →（改造脚手架）→ 0 → 5 → 6`

### 7.2 ⚠️ §2.1 的归因错误（已实测更正）

原文断言「一旦改为 ESM，会抛 `TypeError`，**任何模块化尝试都会在这一行失败**」。
**实测结论：ESM 化本身不会让它失败。** 用真实 `.mjs` 模块分四种情形验证：

| 情形 | 代码形态 | 实测 |
|---|---|---|
| **A** | 函数声明 + 顶层重新赋值 | ✅ **成功** |
| **B** | 改成 `const` 后重新赋值 | ❌ `TypeError: Assignment to constant variable` |
| **C** | 从另一模块 `import` 后重新赋值 | ❌ 同上 |
| **D** | 重新赋值后同模块其它函数的可见性 | ✅ 可见（补丁语义在 ESM 下依然生效） |

**即**：函数声明在 ESM 顶层仍是**可变绑定**（与 `<script>` 中一致）。
原文把**「ESM 化」与「改用 `const`」混为一谈**了。

> **修正后的表述**：不是"ESM 化会炸"，而是**"模块划分会炸"**。
> 结论「必须先拆」不变，但归因必须改正 ——
> 否则会误导出"不改 ESM 就没事"的错误判断。

### 7.3 ⚠️ 「改 ESM」的真实代价：会先摧毁测试安全网

> ✅ **此处描述的问题已在步骤 0 中解决** —— 脚手架现已改为"runner 子进程 + 真实 `import()`"。
> 下面保留的是**当时**的实测推导，用于说明"为什么必须与脚手架改造同批做"。

脚手架原先依赖与 ESM 不兼容的加载方式（`window.eval` 拼接源码）：

| 实测 | 结果 |
|---|---|
| 给模块加 `export` 后放进 eval | ❌ `SyntaxError: Unexpected token 'export'` |
| **jsdom 直接跑 `<script type="module">`** | ❌ **不执行**（实测 `module-not-executed`） |

**即改 ESM 会让全部断言失效，而 jsdom 不能替代。**

**✅ 可保住安全网（已实测可行路线）**：预装 jsdom 后
`await import('./js/main.js')` 真实加载模块图，能驱动 DOM、**读到模块内部 `state`**。
代价是各模块需 `export` 出测试要读的符号 —— 属可接受成本。
> **因此**：脚手架改造必须在「改 ESM」**之前或同时**完成。

### 7.4 各步骤须保留的差异 ⚖️ **改这些代码前必读**

- **步 1 时序契约**：`generateGrid()` 返回时数据仍是上一轮的（真实生成被推迟到 `rAF`）。
  当前调用点未依赖此点，但**搬迁时极易踩**，故这条断言必须跟着模块一起走。
  → ✅ 已由 `test-patch-removal.js` **实测守住**（断言"返回瞬间仍是上一轮行数、泵完 rAF 后才刷新"）。
- **步 2 宽度来源**：`renderViewer` 用 `viewerCanvas.width`，另两处用 `getBoundingClientRect().width`；
  二者在 iOS 的 0 尺寸时序窗口内**不相等**。实现上采取"**函数接收 `w, h` 参数、
  由各调用方传入自己的来源**"，而非让函数内部自取。
  `test-compute-image-rect.js` 用静态断言 + 负向对照守住（已实测：注入"统一来源"后测试确实转红）。
- **步 3b 只拆不改**：严格按 §2.2 的澄清执行 —— **只拆字段与改名，未改任何行为**。
  ⚠️ 该步的守护测试踩到两个坑，已记入 `test-dragstart-semantics.js` 注释：
  ① 说明性注释里刻意保留了历史字段名，**全文正则会误报** —— 必须先 `stripCommentsAndStrings()`；
  ② `viewerWrapper.addEventListener('pointerdown'` 在文件里**出现两次**，
  `indexOf` 会命中前面那个，切片必须用**注释标记**定位。
- **步 4 四处出口差异**：实际抽取时发现差异**不止一处，而是 4 处**，全部原样保留
  （"顺手统一"任何一个都会改变用户可见产出）：

  | 差异 | 预览 | 导出 | 为什么保留 |
  |---|---|---|---|
  | 空格标记 | 画斜线 | 不画 | §3.2 #3，用户已定调 |
  | 网格线颜色 | `0.15` | `0.25` | 导出供打印，需更清楚 |
  | 色号阈值 | `minCell ≥ 10` 才画 | **总是画** | 预览小格时文字糊成一团，导出则宁可小也要有 |
  | 字号取整 | 不取整 | `Math.round` | 导出在不同倍率下更稳 |

  `test-draw-grid.js` 用静态断言 + 行为断言 + 3 组负向对照共同守护。

### 7.5 §3.2 三项行为不一致的现状（§六 决策点 3）

| # | 现象 | 现状 |
|---|---|---|
| 1 | 双指平移只生效一帧 | ✅ **已修为累积式**（REVIEW M2） |
| 2 | 统计表排序随滑块变化 | ✅ **已统一**（REVIEW M1） |
| 3 | 预览画斜线 / 导出不画 | ✅ **已定调并落地**：保持差异，做成 `drawGrid` 的 `hatchEmptyCells` 参数 |

### 7.6 风险提示（不改会踩）

| 风险 | 后果 | 加固情况 |
|---|---|---|
| 先改 ESM 再做重构 | **失去安全网**做重构 —— 最坏情形 | ✅ **已规避**：实际按 `1→2→3b→4` 顺序执行 |
| 抽 `computeImageRect` 时统一宽度来源 | **改回已修的 iOS 缺陷** | ✅ 已加固：接收尺寸参数；静态断言 + 负向对照 |
| 抽 `drawGrid` 时"顺手统一"出口差异 | 两个出口行为变化，可能违反用户预期 | ✅ 已加固：**4 处差异**全部参数化，3 组负向对照守护 |
| 拆猴补丁时忽略 `rAF` 时序契约 | 出现"读到上一轮数据"的偶发 bug | ✅ 已加固：契约写进注释 + 实测守护 |
| 拆 `dragStart` 时"顺手"改行为 | 它是结构债非缺陷 | ✅ 已规避：只拆字段与改名 |
| 搬迁时未同步 `sw.js` 清单 + `CACHE_NAME` | 新模块 404 或**改了看不到变化**（历史踩过） | ✅ 已加固：清单与磁盘一致性每次核对；`probe-esm-cost.js` 断言④ 守护 |

### 7.7 行号锚点已漂移（同 REVIEW.md 的问题）

本文档写作时 `app.js` 为 1326 行，历经多次增长后已删除 ——
文中所有 `app.js:NNN` 锚点**已整体失效**。
**建议与 REVIEW.md 采用同一规则：改用符号名引用，行号仅作参考。**

> ⚠️ **本文档的章节号（如 §7.1、§4.2）被产品代码注释大量引用（约 200 处）**，
> **属锚点契约，不得重排**；调整内容时须保持编号稳定。

### 7.8 本次复核的实测方法（可复现）

| 脚本（位于 `.pindou-devtools/`） | 验证内容 |
|---|---|
| `probe-esm-exact.js` | 用**真实 `.mjs` 模块**测 4 种情形 → §7.2 的归因更正 |
| `probe-harness-esm.js` | 验证"Node ESM + 预装 jsdom"路线可行 → §7.3 安全网可保住 |
| `probe-esm-cost.js` | 统计 ESM 化的三处同步代价（sw 清单 / script 标签 / 脚手架） |

> **可信度**：以上均为**实测**，非静态推断。

---

## 附录 A：`state` 字段读写矩阵（模块边界的依据）

> ⚠️ **本附录的行号已失效**，且 `state` 字段数已从 **21 → 29 → 30**。
> **本表仅作"哪些字段跨了多少个领域"的定性参考**，做模块边界决策前**须重算**。

| 字段 | 跨域数 | 备注 |
|---|---|---|
| `image` / `imageW` / `imageH` | 3 | |
| `zoom` | **4+** | |
| `panX` / `panY` | **4+** | |
| `selection` | **4+** | |
| `gridW` / `gridH` | 2 | |
| `simplify` | 2 | |
| `gridData` | **5** | |
| `colorCounts` | **5** | |
| `rawGridData` / `rawColorCounts` | 2 | |
| `isDragging` / `isResizing` / `isPanning` | 2 | |
| `dragHandle` | 2 | |
| `dragSelection` | 2 | |
| `dragStartImage` / `dragStartClient` | — | ✅ **已拆（步骤 3b）**，各归其位 |
| `panStartPan` | — | ✅ **已拆（步骤 3b）**，语义单一 |

**模块级可变变量**：

| 变量 | 备注 |
|---|---|
| `cameraStream` | 仅 camera 内部，**可私有化**（现已私有） |
| `deferredPrompt` | 仅 PWA 内部，**可私有化**（现已私有） |
| `viewerCtx` | ⚠️ 从 viewer 泄漏到重置逻辑（现定义在 `js/core/state.js`） |
| `_origGenerateGrid` | ✅ **已删除**（步骤 1 完成） |

> **唯一的"零跨域"状态族**：`lastTouchDist` / `lastTouchCenter` / `isPinching` 只被触摸监听读写，
> 可**整体内聚**（现均落在 `panzoom.js` 的读写路径上）。
>
> **`gridData` / `colorCounts` 建议改为单向**：由 generation 写一次，其余四个领域只读。
> 这能让"简化 → 预览 → 统计 → 导出"这条链不再互相影响，也是 PLAN 单元格编辑的前置。

---

## 附录 B：本次分析的方法与可信度声明

- **已实测**（逐行读取 + `state.*` 全量枚举确认）：行数、函数清单、事件监听、
  完整 state 读写矩阵、影子字段、猴补丁、重复逻辑的位置与份数、
  死引用、统计排序不一致、预览/导出空格标记不一致、`dragStart` 双语义。
- **自我更正**：分析过程中一度怀疑读取 `ds.ix/ds.iy` 是取错字段，
  **复核后确认不是 bug**（见 §2.2 澄清）。此处如实记录，避免把误判带入重构。
- **§2.1 的归因有误**（见 §7.2）：原称"ESM 化会让猴补丁失败"，
  实测为"**模块划分/改用 `const`** 才会"。**结论不变，理由已更正。**
- **行号锚点全部失效**（见 §7.7）。
- **分工**：**PLAN 讲"做什么功能"，本文档讲"代码放哪里"**。冲突时以 PLAN 的功能优先级为准。

---

## 八、执行记录（每轮结果 + 下一轮指引）

> 本节按**轮次**记录结构改造的执行结果，供回溯与交接。
> **功能侧的进度不在此处** —— 见 [PLAN.md](PLAN.md)。

### 8.1 步骤 0（改 ESM）执行结果 ✅

| 项 | 结果 |
|---|---|
| 回归测试 | ✅ **全绿**（退出码 0；连跑多次稳定），另有真实 Chrome 端到端全通过<br>📌 **当时的套件/断言数为 21 / 193；现状见 [PLAN.md](PLAN.md) §6.6** |
| 模块数 | 19 个（`color-palette.js` + `js/` 下 18 个） |
| import / export | **61 条 import、90 个 export 符号** |
| 依赖环 | **38 个**（ESM 允许 —— 环内引用都在函数体内，延迟求值） |
| `index.html` | 19 个裸 `<script src>` → **1 个** `<script type="module" src="js/main.js">` |
| `sw.js` | `CACHE_NAME` 已递增（清单与磁盘核对一致） |
| 构建工具 | **仍然零依赖** —— 无 `package.json`、无打包步骤 |

**断言数 188 → 189**：新增「src-manifest 判据已切换为 import 图」一条。

### 8.2 📜 与原计划的差异（教训）

原定五步顺序是：
```
① 改造 harness（新增 ESM 加载路径，但先不切换）
② 让 harness 两种模式都能跑（旧路径继续用，确认断言仍绿）
③ 改产品代码为 ESM
④ 切换 harness 到 ESM 路径
⑤ 删除旧的 eval 加载路径
```

**实际执行时 ① 与 ⑤ 合并了**：`harness.js` 是**直接重写**成 ESM 路径的，
没有保留可切换的 `window.eval` 分支 —— 因为两条路径**无法共存**
（同一个 `state` 只能有一种加载方式，双路径意味着两套语义）。

> **教训**：计划里"新增一条路径但先不切换"这类安排，要先问**两条路径能否共存**。
> 若新路径要求改变数据的存在形式（这里是 `state` 从全局词法环境搬到模块作用域），
> 那么"并存"就是不可能的，应改为"一次性切换 + 切换前先验证等价性"。
> 本轮的等价性验证由 `probe-esm-real.js`（4/4）在切换**之前**完成。

### 8.3 📜 实际改动清单

| 文件 | 改动 |
|---|---|
| 19 个产品模块 | 加 `import` / `export` |
| `color-palette.js` | 加 `export` |
| `index.html` | 换成单入口 `type="module"` |
| `sw.js` | 递增 `CACHE_NAME` + 核对资源清单 |
| `.gitignore` | 新增 `.esm-backup/`（迁移脚本的本地备份，**不应提交**） |
| `.pindou-devtools/harness.js` | **重写**：拼接源码 + `window.eval` → runner 子进程 + 真实 `import()` |
| `.pindou-devtools/runner-esm.mjs` | **新增**：ESM 子进程（jsdom 预装 + 双通道协议） |
| `.pindou-devtools/jsdom-env.js` | **新增**：桩代码与项目目录的唯一装配点 |
| `.pindou-devtools/migrate-to-esm.js` | **新增**：一次性迁移工具（`--dry` / `--apply`，自动备份） |
| `.pindou-devtools/lint-noundef.js` | **重写**：双通道 + 坏 import 检查 + 假绿哨兵 |
| `.pindou-devtools/verify-review-claims.js` | `vm` 拼接 → 真实模块装载 |
| `.pindou-devtools/probe-esm-cost.js` | 断言②④ 判据按新现实**翻转** |

### 8.4 脚手架的新架构 ⚖️ **改测试前必读**

**一个子进程 = 一个用例**：ESM 模块实例在一个进程内只有一份，
而每个用例的 jsdom / viewport / UA 都不同，不能复用模块。

**双通道协议**：
- **异步通道**（stdin base64 请求 / stdout `<id>\t<json>` 应答）：
  用于触发产品 `setTimeout` 的操作（`upload` / `regenerate` / `pressKey`）。
  用 `execFile`（异步）而非 `execFileSync`，**使各用例的等待并行**流逝
  （实测：同步会 1s → 8s）。
- **同步通道**（临时目录 `<id>.req` / `<id>.res` + `Atomics.wait` 阻塞）：
  用于 `flushRAF` / `toClient` / DOM 读取这类"下一行就要结果"的调用。
  保留它是为了让旧断言的**同步写法**一字不改。

**⚠️ 两条必须知道的写法约束**（真实踩到）：
1. **`app.inner.*` 是异步的，调用必须 `await`。**
   漏 `await` 会造成**偶发红**（不是必红）。**模板字面量里不能直接 await**，必须先取出来再插值。
2. **不能"先取函数再调用"**（`const f = app.inner.x; f()`）—— 拿到的是 pending Promise。

### 8.5 `state` 的引用稳定性 vs 就地写穿透

两个测试对 `app.state.gridData` 有**互相冲突**的需求：

| 测试 | 需求 |
|---|---|
| `test-ruler.js` | `gridData` 的**引用**在"没重新生成"时应不变（`strictEqual` 断言） |
| `test-n7.js` | 测试端对 `gridData[i][j]` 的**就地写**必须穿透到子进程 |

第一版实现为满足前者而按编码串缓存并**复用同一份可变数组** ——
结果测试端的就地写**落在了那份缓存上**。**实测两者此消彼长**。

**正解**（`harness.js`）：
- 解码缓存**按 app 实例隔离**（`api.__decodeCtx`），不再模块级共享；
- 给网格套 `wrapGridForWriteThrough` 代理：**只加 `set` 陷阱**，
  把就地写下发子进程，且**绝不修改骨架本身**；
- 代理按骨架 WeakMap 缓存 ⇒ 同一编码串拿到**同一个代理身份** ⇒ 引用断言仍成立。

→ 两个需求**同时满足**，不是二选一。

### 8.6 下一轮指引 🔜

**结构侧只剩一项**：拆 `pointermove` 三合一回调 + 把跨领域调用收拢到 `js/main.js`（§3.3）。

**它已移交 [PLAN.md](PLAN.md) 作为执行顺序的最后一步** ——
排期、触发条件与开工前的调查结论**以 PLAN 为准，本节不重复记载**。

> ⚠️ **在它完成之前**：`js/main.js` 保持"只拉起模块图、不承载逻辑"。
> **不要往 `main.js` 里堆新功能**（§4.4 规则 1）。
> 功能开发可直接按 §4.2 的边界开工，不受此项阻塞。

### 8.7 ⚠️⚠️ 单入口 ESM 的两个「静默假绿」陷阱 【必读】

实际踩到两个 **测试全绿、页面却完全不能跑** 的缺陷。
它们的共同点是：**现有安全网在结构上看不见这类问题**。
**加模块 / 改入口之前**务必先读这一节。

#### 陷阱 1：入口没有 `import` ⇒ 整张模块图不会被浏览器加载

**事实**：`index.html` 改成单入口 `<script type="module" src="js/main.js">` 后，
`js/main.js` **只有注释、一条 `import` 都没有**（它原先被设计成"占位编排层"，
依赖的是"标签顺序即依赖"的旧模型）。

**后果**：ESM 的模块图是**从入口的 import 出发**解析的 ——
没被 import 到的文件**浏览器根本不会请求**。实测 Chrome 网络层只看到
`index.html / style.css / js/main.js / manifest.json / icon-*.png`，
**18 个 js/ 模块一个都没加载**，页面完全没反应。

**为什么 `run-all.js` 全绿也没发现它**：

| 检查 | 为什么结构性地看不见 |
|---|---|
| `run-all.js` 脚手架 | `await import(js/main.js)` 之后**又按 `MODULES` 数组逐个 import** 了全部模块 —— **绕过了入口** |
| `lint-noundef.js` | 只看"每个文件自己有没有坏引用"，不关心"有没有人引用它" |
| `probe-esm-real.js` 等 | import 的是**指定的模块清单**，同样不经过入口 |

**修法**：`js/main.js` 补齐静态 `import './xxx.js'`（覆盖全部模块）。
**新增模块时必须同步在入口补一条 import**（若它不被其它模块引用）。

**守护**：`probe-verify-entry-chain.js`（**已接入 `run-all.js`，放在最前**），
4 条断言：① 唯一 module 入口；② **沿 import 图可达每一个** `js/` 模块；
③ 入口的 import 是**静态**的；④ 真实 `import()` 入口后符号可用。
**已用突变测试自证**：把 `main.js` 的 import 全删掉 → 探针转红。

#### 陷阱 2：`check()` 不 `await` ⇒ 整份报告是假绿

**事实**：`verify-browser-split.js` 的 `check` 原本是同步的，
而 **7 条断言里有 6 条是 `async`**。`fn()` 只返回一个 Promise，
**同步的 `try/catch` 抓不到它内部的失败** —— 断言体还没跑完就被记为 ✅，
内部抛错变成 unhandled rejection、消失在噪音里。

**后果**：它曾报出「✅ 真实浏览器验证通过 **(7/7)**」，
**而同一次运行里页面明明有上面那个模块加载问题**。这是一次彻底的假绿。

**修法**：`await fn()` + 给全部调用点补 `await`
+ 注册 `process.on('unhandledRejection')`，让未捕获的 Promise 失败**硬失败**
（Node 默认只打印警告、**退出码仍是 0** —— 对脚本来说等于"通过"）。

> #### 两条陷阱共同的教训
>
> **「测试全绿」既不等于「断言真的跑了」，也不等于「用户能用」。**
> 前者要靠**突变测试**验证，后者要靠**真实浏览器**验证。**都不能省。**

### 8.8 踩坑清单（教训集）

> 全部为**真实踩到**的缺陷。按教训类型归并，供后续参考。

#### 结构与顺序类

1. **`typeof x` 对未声明标识符返回 `"undefined"` 而不抛错** —— 拿它当"顺序敏感"的判据会**假绿**。
   要测 TDZ 必须**直接访问**。
2. **测试里的文本计数必须先剥注释** —— 头注释里会有"看起来像代码"的文本。
3. **搬迁"函数群"时容易漏掉夹在中间的装配代码** —— 曾漏掉 `downloadBtn`/`shareBtn`
   的 click 注册，表现为"点下载没反应"。这类缺陷**测试网能抓到，肉眼看不出来**。
4. **`<script>` 顺序不对会抛 TDZ**（报错信息不会指出是哪两个文件）。
   —— ⚠️ **ESM 后此风险已消失**（顺序由 import 图决定）。
5. **中断会留下"突变残留"，必须三层防护**（在突变探针上实测踩到）。

   突变探针会**真的改动产品文件**。跑到一半被 Ctrl+C / 超时杀掉，
   文件就**停在突变状态**。实测确认：**`SIGKILL` 拦不住**。曾真的留下两处残留。

   | 层 | 作用 |
   |---|---|
   | ① **启动自检** `assertClean()` | 开跑前确认产品文件**不是**突变态。**这是 `SIGKILL` 唯一能靠的一层** |
   | ② **退出即还原** `restoreAll()` | 覆盖正常结束、异常、`SIGINT`/`SIGTERM` |
   | ③ 每条突变后**立刻还原** | 不让下一条建立在脏状态上 |

   > ⚠️ 还原用**启动时读到的原文**，**不用 `git checkout`** —— 那样会误伤工作区里其它未提交的改动。
   > ⚠️ `assertClean()` 必须在"确认原始状态是绿的"**之前**跑。

#### 脚手架与进程边界类

6. **⚠️ 被 `require` 的文件里不能有"提前退出"的副作用**（**最危险**的一处，靠突变测试才发现）。
   某个探针既是**可运行原型**，又被 `src-index.js` `require` 复用其词法器。
   给它加了一句「前提消失就 `process.exit(0)` 跳过」，后果是：
   > **每一个引用 `src-index` 的套件都在加载期直接退出、退出码 0** ——
   > 表现为"套件全绿"，而实际上**一条断言都没跑**。

   **正解**：任何"跳过/提前退出"都必须包在 `require.main === module` 判断里。
   > **推论**：`run-all.js` 全绿 ≠ 断言真的跑了。**突变测试是这种假绿的唯一解药。**
7. **`execFile` 返回后必须立刻 `child.stdout.pause()`**，中间不许插别的语句。
   返回时 stdout 已是 flowing 模式，没有监听器时到达的数据会被**直接丢弃**。
   表现为 `client.ready` 永远 pending。挂好监听再 `resume()`。
8. **`await client.ready` 立即 resolve ⇒ 十有八九是缺 getter**。
   `await undefined` 不报错、立刻返回。
9. **`BRIDGE` 白名单里不能有定时器** —— 会与 jsdom 自递归，报 `RangeError: Maximum call stack size exceeded`。
10. **`installGlobals` 要在 `buildEnv` 之后**再调一次：`buildEnv` 会替换 window 上的桩，
    导致 `FileReader is not defined` / `Image is not defined`。
11. **剥注释时不能把字符串/模板字面量一起抹掉**：某符号出现在**模板字面量**里，
    用"剥注释+字符串"的版本扫描会导致**漏 export**。要的是 `stripCommentsOnly()`。
12. **`EXTRA_EXPORTS` 不能漏**：不被别的模块引用的符号不会自动 export，
    但脚手架要读它们。
13. **stdout 会被大数组打爆**：几 MB 的 `Uint8ClampedArray` 会让子进程被杀（`code=null`，**看不出原因**）。
    要显式拒绝超大值并给可操作提示。
14. **`setInterval(...).unref()` 会让子进程提前退出** —— **不要加 `.unref()`。**
15. **`app.inner.*` 是异步的，漏 `await` 会造成偶发红**（**最隐蔽**的一类）。
    实测：某套件约 **40% 概率红**。**模板字面量里不能直接 await。**
16. **同一个"引用稳定性"需求会与"就地写穿透"冲突** —— 详见 §8.5。
17. **静态检查必须防"假绿退化"**：ESM 化后 DOM 声明都带 `export ` 前缀，
    只匹配 `^const` 会让「死 DOM 引用」检查**静默退化为 0 个引用**并永远报通过。
    已加哨兵：解析到 0 个声明但源码里有 `$('#…')` 时报错。
18. **判"是否仍用旧路径"之前必须剥注释**：头注释里写到了旧写法（有价值的说明），
    直接扫原文会误判为"仍在使用"。
19. **迁移工具的文档承诺要与实现一致**：头部写了某步骤，但**代码里从没实现**。
20. **步骤 0/5 会让"读单个源码文件"的探针全部失效，且失效形态不止一种**：
    共三种失效形态与三种对策：

    | 失效形态 | 表现 | 对策 |
    |---|---|---|
    | 读 `app.js`（已删除） | `ENOENT` | 改读新模块 / 标为历史并加 `require.main` 守卫 |
    | `new Function(源码)` 求值 ESM | `SyntaxError: Unexpected token 'export'` | 改用真实模块装载器 |
    | 把大数组搬过进程边界 | 「runner 应答过大」 | **在子进程里算成标量再传回** |

    > 第三种为此给 harness 补了两个方法：`ctx.countCalls()` 与 `ctx.distinctNumbers()` ——
    > 判据只需"数一数/去重后有哪些"，根本不必把几 MB 的调用记录搬过来。
    > ⚠️ 谓词**在子进程里跑**，所以不能引用本进程的自由变量。
21. **⚠️ 入口没有 `import` ⇒ 整张模块图不会被浏览器加载** —— 详见 §8.7 陷阱 1。
22. **`check()` 不 `await` 而断言体是 `async` ⇒ 整份报告是假绿** —— 详见 §8.7 陷阱 2。
23. **写"是否已迁移/已处理"这类幂等守卫时，判据要覆盖全部迁移特征**
    （某入口文件有 `import` 却**一条 `export` 都没有**，
    只判 `export` ⇒ 被当成"未迁移" ⇒ 重复前置 import 头 ⇒ `SyntaxError`）。
    正解：判据用 `/(?:export|import)\s/m` —— **两者任一出现**即视为已是 ESM。

### 8.9 脚手架工具与命令速查

> 脚手架在仓库**之外**（`F:\claudeapp\demo\.pindou-devtools\`，刻意不污染零依赖交付物）。

#### 模块清单（步骤 5 的产出，步骤 0 后未变）

```
js/core/     dom.js      state.js
js/input/    camera.js   upload.js
js/viewer/   viewer.js   selection.js   panzoom.js
js/pipeline/ render.js   simplify.js   grid.js
js/output/   preview.js  stats.js      export.js
js/ui/       a11y.js     grid-select.js  loading.js  install.js
js/main.js   ← 模块入口（静态 import 拉起整张图）
```

> ⚠️ **ESM 后「加载顺序不能颠倒」这条约束已消失** ——
> 依赖顺序由各模块的 `import` 语句表达，ESM 解析器负责拓扑排序。

#### 命令速查

```powershell
# 回归测试（退出码 0 = 全绿）
# 📌 套件/断言数现状见 ../PLAN.md §6.6（会随开发增长，本文档不重复维护）
cd F:\claudeapp\demo\.pindou-devtools
node run-all.js

# 真实浏览器端到端（脚本自己起 http.server，无需手工准备）—— 7/7
# ⚠️ 若报「模块未被真实加载」，先删掉 %TEMP%\pindou-split-chrome
#    （残留的 Service Worker 缓存会让模块不走网络，是**环境**造成的假红）
node verify-browser-split.js

# 加/改模块后必跑：入口有没有把整张模块图拉起来
node probe-verify-entry-chain.js

# 突变测试（证明断言真的有约束力；会真实改动产品文件，跑完自动还原）
node probe-simplify-mutation.js
node probe-ruler-mutation.js

# 手工查看页面（⚠️ 必须经 HTTP，不能双击 —— ESM 受 CORS 限制）
cd F:\claudeapp\demo\pindou
python -m http.server 8080     # 访问 http://localhost:8080
```

#### 工具一览

| 文件 | 用途 |
|---|---|
| `src-manifest.js` | **源码清单唯一真源**：ESM 下从 `js/main.js` 的 import 图递归解析 |
| `src-index.js` | **符号源码索引**：`srcIndexOf('drawGrid').text` 取代 `app.js.indexOf(...)` |
| `runner-esm.mjs` | ESM 子进程：真实 `import()` 加载模块图 + 双通道协议 |
| `jsdom-env.js` | jsdom 环境与桩的唯一装配点 |
| `migrate-to-esm.js` | 一次性迁移工具（`--dry` / `--apply`，含 `sw.js` 清单核对） |
| `harness.js` | 测试端驱动（`createApp` → runner 子进程） |
| `probe-verify-entry-chain.js` | **入口链路守护**：main.js 是否拉起整张模块图（**已接入 run-all 最前**） |
| `probe-esm-real.js` | 步骤 0 的可行性证据 |
| `probe-simplify-mutation.js` | **突变测试**：4 种"改回旧行为"必须让 `test-simplify.js` 转红 |
| `probe-ruler-mutation.js` | **突变测试**：8 种"标尺改坏"必须让 `test-ruler.js` 转红 |
| `verify-browser-split.js` | 真实 Chrome 端到端：页面仍完整可用 |

> **⚠️ 已标为"历史原型"、不要再运行的**（前提已消失，运行会明确跳过）：
> `probe-src-index.js`、`probe-move-dryrun.js`。
> 两者都加了 `require.main === module` 守卫 —— **不要去掉**，
> 因为 `src-index.js` 会 `require` 前者来复用词法器（见 §8.8 第 6 条）。
