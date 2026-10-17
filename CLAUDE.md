# 拼豆图纸生成器 (Perler Bead Blueprint Generator)

纯前端单页工具：上传图片 → 框选区域 → 映射色板 → 生成拼豆图纸并导出 PNG。

> ## 📍 本文档的定位
>
> **本文档 = 面向 AI 的项目技术说明。** 回答「**代码是怎么写的、改它要注意什么**」。
> **不记录进度、不记录历史决策过程** —— 那些属于其它文档。
>
> | 想看什么 | 去哪里 |
> |---|---|
> | **要做什么功能 / 排期 / 进度 / 下一步** | [docs/PLAN.md](docs/PLAN.md) ← 唯一真源 |
> | **结构边界 / 防复发规则 / 结构性踩坑** | [docs/REFACTOR.md](docs/REFACTOR.md) |
> | 代码审查结论（37 项，已处理）+ 「本来正确」清单 | [docs/REVIEW.md](docs/REVIEW.md) |
> | 用户怎么用、怎么跑起来 | [README.md](README.md) |
>
> ⚠️ **本文档只写"长期有效的技术事实"**。凡是"某轮做了什么、还剩什么"这类内容，
> 一律不在本文档 —— **避免多处各自维护同一份进度而漂移。**

---

## 技术栈

- 原生 HTML / CSS / JS，零依赖
- **原生 ESM**（`<script type="module">` 单入口）—— **无构建工具、无 `package.json`**
- Canvas API 完成所有图像处理与渲染
- MARD 221 色标准色板（来源：peiseka.com）
- PWA：manifest.json + Service Worker + 离线缓存

## 文件结构

```
index.html          — 页面结构（上传区 / 查看器 / 控制栏 / 预览 / 统计 / 拍照入口 / 加载动画 / 安装提示）
                       ⚠️ 只有一个 <script type="module" src="js/main.js">（ESM 单入口）
style.css           — 样式，CSS 变量主题，响应式适配（640px/400px 断点），触摸设备适配
color-palette.js    — PERLER_PALETTE 221 色 + findNearestColor() + colorDistance()（ESM 模块）
manifest.json       — PWA 清单（名称、图标、standalone 模式）
sw.js               — Service Worker（cache-first 离线缓存策略）
icon.svg            — 应用图标源文件（8×8 彩色拼豆网格）
icon-192.png        — 192×192 图标（purpose: any）
icon-512.png        — 512×512 图标（purpose: any）
icon-192-maskable.png — 192×192 maskable 图标（内容限制在中心 56%）
icon-512-maskable.png — 512×512 maskable 图标
README.md           — 使用说明（面向用户）
CLAUDE.md           — 项目技术说明（本文件）
docs/PLAN.md        — 开发计划与执行进度（**进度唯一真源**）
docs/REFACTOR.md    — 代码结构对策（模块划分、防复发规则、结构性踩坑）
docs/REVIEW.md      — 代码审查报告（37 项，已全部处理）+ 「已核实无问题」清单

js/core/            dom.js      — $ / $$ / DOM 引用 / isTouchDevice
                    state.js    — 常量 / state / viewerCtx / 主题同步 / **字段三类划分**（序列化边界）
                    serialize.js— **图纸序列化/版本化地基**（纯函数；PLAN §3.6 / 第三批 6a）
                    storage.js  — **存档存储层**（localStorage 多份管理；PLAN §3.7 / 第三批 6b）
js/input/           upload.js   — handleFile / showError / showToast / 上传区监听
                    camera.js   — openCamera / capturePhoto / closeCamera
js/viewer/          viewer.js   — computeImageRect / renderViewer / resizeViewerCanvas / scheduleViewerRedraw
                    selection.js— updateSelectionBox / 选框拖拽
                    panzoom.js  — 右键平移 / 滚轮 / 双指 / 窗口尺寸
js/pipeline/        render.js   — drawGrid / drawRuler / rulerMetrics / pickTextColor / FONT_STACK
                    simplify.js — applySimplify / getStaticMergeMap / cloneGrid / rebuildColorCounts
                    grid.js     — generateGrid / generateGridCore / **adoptGrid**（接管外部图纸）
                    edit.js     — **单元格编辑模型**（纯数据 + **独立撤销栈**；PLAN §3.8 / 第三批 6c/6d）
js/output/          preview.js  — fitPreviewGrid / **computePreviewLayout** / **hitTestCell** / **cellsBetween** / renderPreview
                    stats.js    — renderStats（含「选为画笔色」按钮）
                    export.js   — computeDownloadSize / renderDownloadCanvas / downloadPNG / sharePNG
                    print.js    — encodeCellName / computePrintPaging / renderPrintLayout / printGrid（A4 打印出口）
js/ui/              a11y.js     — announce / markActiveGridBtn / 键盘通路 / clamp
                    grid-select.js — 网格预设 / 自定义 / 简化滑块 / 标尺开关
                                     + **setSamplingControlsEnabled**（无原图时置灰）
                                     + **refreshSamplingControls**（6c：编辑锁 + 就近说明）
                    library.js  — **存档 UI**（保存/载入/删除 + **无原图展示路径**；PLAN §3.7）
                    edit-ui.js  — **单元格编辑界面**（指针命中 / 工具栏 / 统计表选色 / 撤销重做快捷键；PLAN §3.8）
                    loading.js  — showLoading / hideLoading
                    install.js  — PWA 安装提示
js/main.js          — **模块入口**（ESM 单入口）
                       ⚠️ **它的 import 列表 = "页面会加载哪些文件"** ——
                       ESM 从入口的 import 出发解析模块图，**没被 import 到的文件
                       浏览器根本不会请求**。新增模块必须在这里补一条 import
                       （若它不被其它模块引用），否则页面会静默少功能。
                       守护套件：`probe-verify-entry-chain.js`
```

> ⚠️⚠️ **加/改模块前必读** → [docs/REFACTOR.md](docs/REFACTOR.md) **§8.7「单入口 ESM 的两个静默假绿陷阱」**。
> 两个**测试全绿、页面却完全不能跑**的缺陷：
> ① **入口没有 import** ⇒ 整张模块图一个都没被浏览器加载
>    （`run-all.js` 的脚手架按模块清单**逐个 import**，**绕过了入口**，所以看不见）；
> ② **`check()` 不 `await` 而断言体是 async** ⇒ 报告全绿但断言根本没跑完。
> 两者分别靠**突变测试**与**真实浏览器**抓出 —— **都不能省**。

> **改代码前先读 [docs/REVIEW.md](docs/REVIEW.md)** —— 特别是 §五「明确核实"没问题"的项」，
> 避免为"修问题"而改坏**本来正确**的代码。

## ⚠️ 代码结构约定（改代码前必读）

**新增功能必须按特性域落位到 `js/` 下的模块**，不要再出现"跨领域大文件"。
**完整规范、边界理由与落地顺序见 [docs/REFACTOR.md](docs/REFACTOR.md) §4.2 / §4.4**；
此处只列**强约束**：

1. **新功能按特性域归位**（`js/` 下的 `input/` `viewer/` `pipeline/` `output/` `ui/`）；
   无归属时先讨论，不要默认写进主文件。
2. **模块间不得直接互相调用**，跨领域一律经编排层（`main.js`）。
   > ⚠️ **现状**：`main.js` 目前**刻意不承载逻辑**，跨领域收拢尚未执行
   > （**排期见 [docs/PLAN.md](docs/PLAN.md) §5.1 最后一步**）。
   > **因此现在的跨领域 import 仍然存在**（依赖图里有 38 个环），
   > 这是**已记录的待办**，不是可以继续扩散的先例。
3. **禁止对函数做猴补丁**。
   > ⚠️ **改 `generateGrid` 前必读**：它是**唯一入口**（显式驱动加载遮罩 + rAF + 错误兜底），
   > 真实逻辑在 `generateGridCore()`。
   > 直接调 `generateGridCore()` 会绕过加载遮罩，用户观感就是"点了没反应"。
   > 另有一条**时序契约**：`generateGrid()` 返回时 `state.gridData` **仍是上一轮**的数据
   > （真实生成被推迟到 `rAF`）—— 需要新数据请在下一帧之后再读。
   > 两条都由 `test-patch-removal.js` 实测守护，**不要改回去**。
   > ⚠️ **不得重新赋值导入的绑定**：把 `generateGrid` 改成 `const`、或经模块 `import`
   > 后仍想重新赋值，都会抛 `TypeError`（[docs/REFACTOR.md](docs/REFACTOR.md) §7.2 实测）。
4. **`state` 字段必须先声明再使用** —— 新增字段请一律写进 `js/core/state.js` 的
   `state` 字面量并加注释说明语义（哪些是归一化坐标、哪些是 client 像素）。

## ⚠️ 错误提示：按阶段选对函数（踩过坑）

系统里有**两套**提示，用错会导致「提示写了但用户看不见」：

| 函数 | 承载元素 | 何时用 |
|---|---|---|
| `showError(msg)` | `#uploadError`（在 `#uploadSection` **内部**） | **仅上传阶段** |
| `showToast(msg)` | `#toast`（`position:fixed`，**独立于所有分区**） | **上传之后的任何阶段** |

**原因**：`showViewer()` 会设 `uploadSection.hidden = true`。
上传完成后 `#uploadError` 就不可见了 —— 写进去的消息**静默丢失**。

> 这个坑真实发生过：导出超限提示曾用 `showError`，
> 结果「点了没反应」的问题修完仍然「没反应」。详见 [docs/REVIEW.md](docs/REVIEW.md) §八 第 8 条。

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

> **导出倍率是自适应的**：期望 2x，若超出设备上限
> （总像素 > 16.78MP 或单边 > 4096px）则自动降到 1x。
> 实测：29/52 → 2x；**78/104 → 1x（此前完全导不出）**。
> 降档会如实写在 `#previewInfo` 上，不静默。

## 关键状态 (`js/core/state.js` 的 state)

| 字段 | 说明 |
|------|------|
| `image` | 原始 HTMLImageElement |
| `imageW/H` | 原始图片尺寸 |
| `zoom` | 缩放倍率 (0.2~5) |
| `panX/Y` | 平移偏移 |
| `selection` | 选框归一化坐标 `{x, y, w, h}` (0~1) |
| `gridW/H` | 目标网格尺寸 (15~104)。**重新上传/重置时回到 29** |
| `gridData` | 二维数组，每个元素为 `{name, hex, r, g, b}` 或 `null`（空格）。**与 `rawGridData` 不共享引用** |
| `colorCounts` | 按数量降序的颜色统计数组 |
| `rawGridData/rawColorCounts` | 颜色简化前的原始数据（供 slider 回溯）。**深拷贝，与 `gridData` 及全局色板都隔离** |
| `simplify` | 颜色简化强度 0-100，0=关闭。**重新上传/重置时由 `resetSimplify()` 清零** |
| `lastTouchDist` / `lastTouchCenter` | 双指缩放比 / 上一帧中心点（算缩放比用） |
| `touchStartCenter` | 双指手势**起点**中心点。平移位移相对它累计（**不要改回单帧增量**） |
| `isPinching` | 是否正在进行双指操作 |
| `aspectWarning` | 极端宽高比的量化偏差提示文本（无则 `null`），由 `generateGrid` 写入、`renderPreview` 展示 |
| `mergedColors` | 本轮被**近似色合并**掉的色号，形如 `[{from:"H12", to:"E16"}]`（无则空数组）。由 `applySimplify()` 写入、`renderPreview()` 展示到 `#previewInfo`。**每轮重算的展示用字段，不参与持久化** |
| `rulerEnabled` | 是否显示**行列标尺**，默认 `true`。**显示偏好，不是图像参数** —— `handleFile()` 刻意**不重置**它（与 `simplify` 相反）。只影响绘制，切换时**不重新生成网格** |
| `printColorBlocks` | 打印时**是否输出色块底色**，默认 `true`。**输出偏好，不是图像参数** —— `handleFile()` 同样刻意**不重置**（与 `rulerEnabled` 同例、与 `simplify` 相反）。关掉即 §4.5 的**省墨模式**（只印网格线与色号）。见下方「A4 打印出口」 |
| `dragStartImage` / `dragStartClient` / `panStartPan` | ✅ **语义已拆开**：分别为**归一化图片坐标** / **client 像素坐标** / **pan 偏移量起点**。此前挤在一个 `dragStart`/`panStart` 里（同名不同形状）。**不要合并回去，也不要跨语义混用**（`test-dragstart-semantics.js` 守护） |
| `editTool` | 当前编辑工具：`'none'`（**未进入编辑**）/ `'brush'` / `'erase'` / `'pick'`。⚠️ `'none'` 时预览画布**不接管指针** —— 否则移动端在预览上滑动会静默改掉图纸 |
| `editColor` | 画笔颜色（色板对象形状，无则 `null`）。来源：统计表点选 / 吸管取色。**必须是副本**，不能是 `PERLER_PALETTE` 的对象引用 |
| `editHistory` / `editIndex` | **撤销栈**（一笔 = 一次按下到抬起）与游标（= **已应用**笔数）。⚠️ **绝不能用 `rawGridData` 当撤销栈**（载入存档后它是 `null`）；`editIndex > 0` 同时是"图纸被手工编辑过"的判据（简化滑块据此禁用）。**不入档** —— 结果入档、过程不入档 |

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
- **键盘操作**：`方向键` 移动选框（步长 2%）、`Shift+方向键` 调整大小（最小 5%）。
  先 Tab 聚焦到查看器；每次操作有 `aria-live` 播报。
- **颜色简化**：滑块 0-100%，合并网格中相近的颜色，减少颜色种类。
  ⚠️ **滑块归零（"关闭"）不等于没有合并** —— 系统另有一层**常开的近似色合并**
  （针对色板自身的近同色对，见下方「近似色合并」小节）。滑块关的是**用户主动的强度压缩**，
  关不掉那层数据修正
- **近似色合并告知**：发生合并时 `#previewInfo` 显示「已合并近似色：H12→E16」，**不静默替换**
- **行列标尺**：开关默认开启，在网格外侧标注行列号；格子够大时逐格标，否则每 5 格标一次
  并每 10 格画一条加粗参考线。**52×52 以上靠肉眼数格子必错，这是"照着拼"的前提**（见下「行列标尺」小节）
- **透明像素**：采样时跳过 alpha<128 像素，全透格子留白标记
- **自定义网格**：15~104 任意 W×H，支持非正方形豆板。**输入非法值会给出提示**
- **极端比例提示**：内容短边格数过少时（量化偏差 > 8%）在预览信息处如实警告
- **拍照上传**：移动端显示拍照按钮，调用原生相机
- **分享**：支持 Web Share API 的设备可分享 PNG 文件
- **图纸存档**：把图纸以**名字**存进本机浏览器（`localStorage`），可多份、可载入、可删除。
  存档**只含图纸本身**（色号 + 空格），**不含原图 / 选框 / 简化强度**。
  ⚠️ 载入存档后进入「**无原图模式**」：原图被清空，网格尺寸与颜色简化**禁用**并给出说明
  （横幅 `#archiveBanner`）—— 详见下方「存档存储层与无原图模式」。
  **删除必须先确认**（不可撤销）；配额不足 / 存储不可用分别给出**不同**的可操作提示
- **A4 打印**：「🖨 打印 A4」按钮走**独立 DOM 布局 + `window.print()`**（与 PNG 导出并存）。
  每页 52 列、每格 3.846mm、色号 6.2pt；52×52 ⇒ **1 页**，104×104 ⇒ **4 页**（2×2 拼接，
  页眉标注"第 N/4 页 · 第 X 行第 Y 块 · 列 a-b / 行 c-d"）。点之前屏幕上先给出页数与每格尺寸。
  **「打印色块」**复选框控制是否输出色块底色 —— 关掉即**省墨模式**（只印网格线与色号，
  灰度下色号是唯一信息源）。见下方「A4 打印出口」小节
- **单元格编辑**（画笔 / 擦除 / 吸管 + 撤销/重做）：在预览区上方的工具栏点「🖌 画笔」等
  **显式进入**编辑模式，然后在**预览图**上点格子改色、**按住拖动连续涂**。
  选色有两种：在「颜色统计」表里点某行的「🖌 选为画笔色」，或用「💧 吸管」从图上取色。
  撤销/重做用工具栏按钮或 `Ctrl+Z` / `Ctrl+Shift+Z`（`Ctrl+Y` 亦可）。
  **退出编辑**走工具栏里那个「✕ 退出编辑」按钮。
  ⚠️ **点当前已选中的工具不会退出编辑**（只是保持选中）—— 与所有绘图软件一致。
  特意如此的理由：选完色会**自动进入画笔态**，用户接着去点「🖌 画笔」是极自然的动作；
  若那一下等于"退出"，他会发现"怎么点都不改图"且毫无提示（**实测踩到过**，
  见 PLAN §3.8）。所以那组工具按钮是 `role="radiogroup"` + `aria-checked` 的**单选组**，
  **不是** `aria-pressed` 切换钮（后者的语义是"可再按一次弹起来"，与实际行为不符）。
  ⚠️ **未选中任何工具时预览画布不接管指针** —— 移动端在预览上滑动不会改图。
  ⚠️ **编辑过之后「颜色简化」滑块会被禁用**（见下方「单元格编辑」小节的硬约束 3）。

## 预览参数

- 画布最大边 720px，另一条边按网格宽高比 `cols/rows` 计算，单元格保持真实比例（非正方形）
- 小屏自动缩放：画布宽于容器时按比例缩小（最小 35%）。
  **公式在 `fitPreviewGrid()` 里，且必须把标尺边距算进去** ——
  标尺边距是格子尺寸的函数，用"缩放前的边距"估算会溢出容器（实测溢出 1~7px）。
  该函数用**迭代收敛**（3 次）+ `floor` 取整解决，见其 JSDoc
- 预览 canvas 显式设置 `style.width` 和 `style.height`，避免 iOS 14.4 用 `height` 属性值算错比例
- cellW/cellH = drawW/cols, drawH/rows，范围 8~25px
- 文字阈值 minCellForText = 10px（以较短边 `min(cellW, cellH)` 判断）
- 色号字体 = max(5, minCell * 0.35)px，深色格白字、浅色格黑字
- `#previewInfo` 同时展示**导出倍率与像素尺寸**（降档时注明原因）、**近似色合并告知**与**极端比例警告**
  - 合并告知形如「已合并近似色：H12→E16」，**必须带替代色号**（只说"H12 没了"等于没说）
- 下载 PNG：较短边 28px，较长边按网格比例缩放，倍率自适应（见上）

## 📏 行列标尺（改标尺相关代码前必读）

> 三个开关常量 + 三个函数，**全部复用 `drawGrid`**，没有另写绘制循环。
> 守护套件 `test-ruler.js`（18 条）+ `probe-ruler-mutation.js`（8 种突变）。

| 名字 | 职责 |
|---|---|
| `RULER_DENSE_MIN_CELL = 14` | 格子短边 ≥ 14px 时**逐格**标注，否则转稀疏 |
| `RULER_STEP = 5` | 稀疏模式的标注间隔（格） |
| `RULER_MAJOR_STEP = 10` | 加粗参考线间隔（十进制，与数数习惯一致） |
| `rulerMetrics(cellW, cellH)` | **纯函数**：依格子尺寸给出 `{step, majorStep, dense, fontSize, margin}` |
| `drawRuler(ctx, opts)` | 只画**边距区域**（行列号 + 参考线），网格本体仍由 `drawGrid` 画 |
| `fitPreviewGrid(...)` | 预览小屏适配（含标尺边距，迭代收敛） |

**四条硬约束**：

1. **边距必须同时进入 `computeDownloadSize()` 的 `canvasW/canvasH` 与 `gridY`** ——
   只进其一就会出现"标尺画不下"或"与预检漂移"。实测四档（29/52/78/104）加边距后
   **dpr 均未降档**，仍满足 16.78MP 与单边 4096（这是本功能最大的风险点）。
2. **关闭开关必须等于"零影响"** —— `gutter=0`、`drawRuler` 根本不被调用，
   四档画布尺寸**逐像素回到基线**（932×972 / 1488×1616 / 2216×2344 / 2944×3072）。
   **不要**实现成"gutter=0 也走一遍空标尺"。
3. **`state.rulerEnabled` 是显示偏好，`handleFile()` 刻意不重置它** ——
   与 `simplify`（图像变换参数，必须归零）性质不同。切换它**不重新生成网格**
   （只重绘预览），重新生成会白跑一次逐格采样。
4. **断言不要与被测实现共享数据来源** —— 突变测试实测发现：读
   `computeDownloadSize().gridY` 去断言"色号在网格内"，会在 `gridY` 漏加 `gutter` 时
   **跟着一起偏移而照样通过**。必须另有一条从外部不变量出发的判据
   （现有：`gridY === padding + titleHeight + gutter`）。

## 🧩 共用绘制/几何函数（新功能应复用，不要另写一份）

> 改动它们前先看对应的守护套件。

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

## 🖨 A4 打印出口（改 `js/output/print.js` 前必读）

> 与 PNG 导出**并存**，不互相替代（PLAN §4.2）。守护套件 `test-print.js`（31 条）
> + `probe-print-mutation.js`（25 种突变）+ `verify-print-browser.js`（真实 Chrome 18 条）
> + `verify-print-e2e.js`（真实 Chrome 12 条，完整用户流程）。

**为什么不用"导出图片再打印"**：`canvas.toBlob` 固定写 **96dpi** 元数据，
PNG 里**没有物理尺寸**。52×52 走"100% 原始大小"是 78.7cm 宽、
"适应页面"每格只有 3.846mm —— 两个极端都不可用（PLAN §4.1）。
打印出口走**独立 DOM 布局 + `@page`**：CSS 的 `mm` 是真实物理单位。

| 常量 / 函数 | 职责 |
|---|---|
| `PRINT_PRINTABLE_W_MM = 200` | A4 可打印宽（210 − 5mm×2）。分页与每格尺寸的基准 |
| `PRINT_COLS_PER_PAGE = 52` | 每页列数。52×52 主路径 ⇒ **1 页** |
| `PRINT_CELL_MM` | **= 200/52 ≈ 3.846mm**（不是 3.85） |
| `PRINT_FONT_PT = 6.2` | 色号字号（实测定案） |
| `encodeCellName(name)` | 色号 → 2 字符编码（`A10` → `Aa`） |
| `computePrintPaging(cols, rows)` | 分页（每边 `ceil(n/52)`）+ 每格 mm |
| `forEachPrintPage(paging, fn)` | 遍历每页块范围（行优先） |
| `renderPrintLayout(grid, opts)` | 构建打印 DOM（一页一个 `.print-page`） |
| `printGrid()` | 构建版面 + `window.print()` |

**五条硬约束**：

1. **每格必须用精确除法 `200/52`，不要写成 3.85** —— `3.85 × 52 = 200.2mm`
   **超出可打印宽 0.2mm**，表现为"多出空白页/整体被缩小"，
   会被误判成"`@page` 不支持"（PLAN §4.6 项 3 的判据专门提醒过）。
   ⚠️ **每格尺寸只有一个真源**：`computePrintPaging().cellMm` 必须**引用**
   `PRINT_CELL_MM`，不要再写一遍 `200/pageCols`（实测踩过：两处各算一次时，
   改常量对分页毫无影响，常量成了**死代码** —— 突变测试才发现）。
2. **⚠️⚠️ 绝不能加 `print-color-adjust: exact`** —— 该属性的用途正是"强制打印背景"，
   加了它，「背景图形」复选框**彻底失效**（实测：不勾也是全彩，
   两份 PDF 的彩色填充种数**完全相同**）。它与"让用户能选省墨模式"**互斥**，
   故改由显式开关 `#printColorToggle` 承担。**这是本功能最大的红线。**
3. **网格线必须用 `border`，不能用 `background`** —— 实测不勾「背景图形」时
   `background` 会随色块**一起消失**，而 `border` 仍以 `#ababab` 印出。
   用 background 的后果是省墨模式下只剩色号、没有格子边界，没法照着拼。
4. **色号必须是真实文本节点**（不画在 canvas 上）—— DOM 文字由打印机按自身分辨率渲染，
   这才是"色号必须看得清"被**根本性满足**的方式（§4.2 优势②）。
   黑白字判定**复用 `pickTextColor()`**，不要抄第二份。
5. **`.print-page` 宽度 = 200mm，不是 210mm**（`@page` 的 5mm 边距已占掉两侧）；
   **末页必须 `break-after: auto`**（多余分页符会印出空白页）。
6. **界面文案的每格尺寸用 `toFixed(3)`（显示 3.846），不用 `toFixed(2)`** ——
   2 位会显示成 **3.85**，而那正是 §4.3 初版**会超宽 0.2mm** 的错误值。
   界面上写 3.85 会让人以为代码用的就是这个数，**照着界面改代码就会真的引入该缺陷**。

**为什么不复用 `drawGrid()`**（PLAN 原写"复用 render.js、不新写绘制循环"，
实测后**改为**只复用 `pickTextColor()`）——三条理由，均可复核：

| # | 原因 |
|---|---|
| 1 | `drawGrid` 的单位是 **px**，而打印版面的约束是 **mm**。`@page` 一生效，浏览器按纸面 mm 重排，**px↔mm 折算不再由我们控制** —— 折算错就静默改变物理尺寸，正是本方案要根治的问题 |
| 2 | `drawGrid` 按 `minCell * 0.35` **自算**字号，而 §4.6 项 1 已**实测定案 6.2pt**（独立常量，非派生） |
| 3 | 打印要求"色号是**矢量文字**"与"关掉复选框 = **省墨模式**" —— 这两条只能由 DOM 文字 + CSS 提供，canvas 给不了 |

> **"不新写绘制循环"这条要求本身与打印路线的物理尺寸约束互斥** ——
> 打印的"绘制"就是 DOM，不存在第二套 canvas 绘制循环可写。

> ⚠️ **`state.printColorBlocks` 是输出偏好，`handleFile()` 刻意不重置** ——
> 与 `rulerEnabled` 同例，与 `simplify`（图像参数，必须归零）相反。

> ⚠️ **jsdom 验不了打印版面**：它不解析 `@media print` / `@page`
> （实测 `getComputedStyle(.print-cell).borderTopWidth` 恒为 0px、`fontSize` 恒为空）。
> 所以"纸上是什么样"**只能**由真实浏览器回答 —— 改打印相关代码后必须手动跑
> `verify-print-browser.js`（自动起服务与 Chrome）。
> 而"字号是否看得清"**没有自动化判据**，仍须人眼看纸（`docs/print-proof-a4.html`）。

## ⚠️ 近似色合并（改 `applySimplify` 前必读）

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
> **不参与持久化** —— 序列化地基不需要带上它。
>
> **不要动 `findNearestColor()` 本身**：它是纯查询函数，在其中做阈值合并会让
> "某个颜色永远选不到"，正确位置是 `applySimplify()` 的合并层。

## 💾 序列化地基（改 `js/core/serialize.js` 前必读）

`js/core/serialize.js` 是**纯函数层**：`buildDoc` / `serializeDoc` / `parseDoc` /
`runMigrations` / `docToGrid` / `deserializeDoc`。**不写 `state`、不碰 DOM、不碰
`localStorage`** —— 存储层与 UI 是下一层（`js/core/storage.js` + `js/ui/library.js`），
故它与存储选型解耦。

> **进度与方案见 [PLAN §3.6](docs/PLAN.md)。** 此处只列**长期有效的技术约束**。

**四条硬约束**（`test-serialize.js` 18 条 + `probe-serialize-mutation.js` 11 种突变守护）：

1. **格子身份用色号名（`"A10"`），不用色板下标。** 实测 104×104 序列化体积：
   完整对象 584KB / 下标 32KB / **色号名约 65KB**。下标最省，但把存档**绑死到
   `PERLER_PALETTE` 的排列顺序**上 —— 色板一增删重排，老存档就**静默变色且无法察觉**。
   **不要为省 33KB 改回下标。**
2. **`deserializeDoc()` 必须产出色板对象的副本**（逐个 `{ ...pal }`）。这是
   「三重别名」缺陷（见下「近似色合并」末段与 [REVIEW.md](docs/REVIEW.md) n7）
   的**第二次入口**：直接赋值会让存档格子与**全局色板**共享引用，
   单元格编辑一上线就会改坏色板、污染后续所有生成的图。
   > 📌 这里**刻意不复用** `simplify.js` 的 `cloneGrid()`：本模块已直接产出副本，
   > 再套一层是多余遍历；且 `js/core/` → `js/pipeline/` 会**新增跨领域 import 边**，
   > 而规则 2（模块间不得直接互相调用）是**已记录的待办，不是可扩散的先例**。
3. **版本校验四层缺一不可**：语法 → 身份（`format` **与** `version`）→ 迁移 → 结构。
   只查 `version` 挡不住"别的应用的 JSON 恰好有 `version: 1`"；
   **版本过新必须拒绝**（强行读入会**静默丢字段**，明确拒绝优于静默损坏）。
   迁移**逐级升级**（v1→v2→v3），不写跳级函数（数量随版本数平方增长）。
4. **未知色号 → 该格留空 + `warnings` 如实告知，不猜近似色。** 猜色会让用户按图买的
   色号与实际不符，比留空更难发现（同「近似色合并」必须播报替代色号的一贯要求）。

**`state` 字段三类划分**（写在 `js/core/state.js` 注释里，**新增字段必须归类**）。
判据只有一句：**"换一台设备打开，这个值还应不应该一样？"**

| 类 | 成员 | 入档 | `handleFile()` |
|---|---|---|---|
| ① **图纸文档** | **只有 `gridData`**（行列数由它的维度导出，不另存） | ✅ | 归零 |
| ② **显示/输出偏好** | `rulerEnabled`、`printColorBlocks` | ❌ | **刻意不重置** |
| ③ **临时视图/交互态** | `simplify`（图像参数，**必须归零**）+ 其余全部 | ❌ | 见左 |

> ⚠️ **②与③的区别是历史缺陷的来源**（`simplify` 曾不归零 → REVIEW.md C1）。
> 判据：是"**对图片的变换**"（须归零）还是"**用户怎么看**"（不重置）。

> ⚠️ **两个已确认接受的后果**：`simplify` 不入档 ⇒
> 加载后**无法复现当初的简化强度**；`rawGridData` 不入档 ⇒ 它是"**采样**原始值"的语义，
> **不是**"加载出来的图纸的原始值"。
> **已决（6b 的产品决策）**：加载存档后简化滑块**禁用**，并在界面上说明原因 ——
> 见下「存档存储层与无原图模式」。

## 💾 存档存储层与无原图模式（改 `js/core/storage.js` / `js/ui/library.js` 前必读）

三层分工，**不要互相越界**：

| 模块 | 职责 | 边界 |
|---|---|---|
| `js/core/serialize.js` | 存**什么**、怎么版本化 | 纯函数，**不写 `state`、不碰 DOM、不碰 `localStorage`** |
| `js/core/storage.js` | 存到**哪**、多份怎么管理 | **不碰 DOM、不写 `state`**（用 `storage.js` 里叫 `state` 的局部变量也不行 —— 见下） |
| `js/ui/library.js` | 按钮/列表/提示 + **载入后的界面切换** | 不自己拼格式、不自己拼网格 |

**四条硬约束**（`test-library.js` 24 条 + `probe-library-mutation.js` 17 种突变守护）：

1. **整份存档集写在**一个键里（`pindou-library`），不是"一份图纸一个键 + 索引键"。
   后者**没有原子性**：写内容成功、写索引失败就留下"索引指向不存在的图纸"，
   且**只有用户下次打开才暴露**。单键方案下一次 `setItem` 就是一次原子提交，
   配额不足时旧存档**逐字节保持原样**。
2. **`available`（能读）与 `writable`（能写）是两个独立的量**，不要合并 ——
   ⚠️ 实测踩到：合并后空间一满就报"本浏览器不允许使用本地存储"（该换浏览器？）
   而且**用户看不到也删不掉自己的存档**，唯一能腾空间的动作被自己封死了。
   正确行为：写满时**列表与删除照常可用**，提示明确指向"删掉几份再存"
   （删除写回的数据一定更小，配额模型下必然成功）。
3. **损坏时不许覆盖**：键里内容读不懂时如实报告并**暂停保存**，坏内容原样留着。
   "清空重来"会把用户唯一的副本抹掉且不可恢复。代价（已接受）：损坏后用户需自行
   清理站点数据才能继续存。
4. **载入路径不重建 `rawGridData`**，且**必须清空**它 ——
   它的语义是"**采样**原始值"，存档里没有；留着上一张图的值，用户一动简化滑块
   （键盘/脚本仍可触发）就会把当前图纸换成旧图的采样结果。
   `adoptGrid()` 里因此**不调用 `applySimplify()`**，统计由
   `rebuildColorCounts(gridData)` 按网格本身重建。

**无原图模式**（6b 的产品决策，**改控件显隐逻辑前必读**）：

- 载入存档 ⇒ **清空原图**（存档不含选框，保留会让"选框框住的区域"与图纸内容矛盾）；
- 依赖**原图重新采样**的控件**逐个** `disabled`（`setSamplingControlsEnabled(false)`）：
  网格预设、自定义宽高、`#applyCustom`、简化滑块。
  ⚠️ **必须真设 `disabled`**，只加样式挡不住键盘与脚本触发。
- 与图纸无关的偏好（`rulerEnabled` / `printColorBlocks`）**刻意不禁用**；
- **必须显示 `#archiveBanner` 说明原因**（只置灰 = 用户以为工具坏了）；
- 恢复的唯一入口是 **`showViewer()`**（任何载入原图的路径都必经此处）——
  在那里调 `exitArchiveMode()`，不要在各条分支上分别复位（会漏）。

> ⚠️ **打印时必须隐藏 `.archive-section`**：`@media print` 的隐藏清单里**每新增
> 一个屏幕分区都要补一条**，否则存档的输入框/下拉框会被印到纸上
> （实测踩到，靠截图发现；`test-library.js` 有断言逐个核对）。

> ⚠️ **jsdom 的 `localStorage` 是 Proxy**：`localStorage.setItem = fn` **不生效**
> （实例属性赋值被吞掉），用它模拟"配额不足"会让保存照样成功、测试**假红**。
> 必须把 `globalThis.localStorage` **整个换掉**（见 `test-library.js` 的两个桩）。

## ✏️ 单元格编辑（改 `js/pipeline/edit.js` / `js/ui/edit-ui.js` 前必读）

> 三层分工（与 6b 的存档三层同构，**不要互相越界**）：
>
> | 模块 | 职责 | 边界 |
> |---|---|---|
> | `js/pipeline/edit.js` | 改**哪一格**、怎么改、撤销栈怎么记 | **不碰 DOM、不 import UI** |
> | `js/output/preview.js` | 预览版面几何 + `hitTestCell()` + `cellsBetween()` | **纯函数，命中几何的唯一真源** |
> | `js/ui/edit-ui.js` | 指针事件 / 工具栏 / 选色 / 快捷键 | **不自己改 `gridData`** |
>
> 守护套件 `test-edit.js`（**51 条**）+ `probe-edit-mutation.js`（**22 种突变**）
> + `verify-edit-browser.js`（真实 Chrome **17 条**）+ `shot-edit.js`（截图，非回归）。

| 函数 | 职责 |
|---|---|
| `computePreviewLayout(cols, rows, maxW, ruler, padding)` | **纯函数**：画布尺寸 / 格子尺寸 / 标尺边距 / 网格原点 |
| `previewLayoutFor(grid, rulerEnabled)` | 按当前 `state` 与真实容器宽度取版面 |
| `hitTestCell(localX, localY, layout)` | 画布局部坐标 → 行列号（越界返回 `null`） |
| `cellsBetween(from, to)` | 两格之间**经过**的全部格子（拖拽路径补全） |
| `paintCell(row, col)` / `pickColorAt()` | 施加当前工具 / 吸管取色 |
| `beginStroke()` / `endStroke()` / `isStrokeOpen()` | 一笔的生命周期。⚠️ **没有"显式/隐式"参数**：自动收尾靠**对象身份**判断该收哪一笔（见 `autoCloseStroke`） |
| `undoEdit()` / `redoEdit()` / `canUndo()` / `canRedo()` | 撤销/重做 |
| `clearEditHistory()` / `resetEditState()` | 清栈（保留工具 / 连工具一起复位） |
| `setEditStateListener(fn)` | UI 监听编辑态变化（**方向是 UI 监听模型**） |

**六条硬约束**：

1. **写入的格子必须是副本**（`copyCell()`）。这是 PLAN §3.4「三重别名」缺陷的
   **第四个入口**（前三次：采样路径 / 反序列化 / `adoptGrid`）。一旦某个格子指向
   全局色板，下一次编辑就会就地改坏**所有后续生成的图**。
2. **撤销栈独立，绝不能用 `rawGridData`**：它的语义是"**采样**原始值"，
   而载入存档后它**是 `null`** —— 拿它当栈会在无原图模式下当场拿到 `null`。
3. **命中几何只有一个真源**：不要在编辑侧另写"canvas 宽减 padding 除以列数"。
   漂移的症状是**点这一格、改旁边那一格**（用户会照着改错号的图纸去买豆）。
   ⚠️ **坐标必须用 `getBoundingClientRect()`，不能用 `canvas.width`** ——
   后者已乘 `dpr`，2x 屏上会把所有点击映射到左上 1/4 区域。
4. **未选中工具时预览画布绝不接管指针**（`state.editTool === 'none'` 直接返回）。
   否则移动端在预览上滑动（很常见的动作）会**静默改掉图纸**。
   触屏的 `touch-action: none` 也只在该模式下加（`.editing` 类）。
5. **拖拽路径必须补全**（`cellsBetween()`）：`pointermove` 是**按帧离散采样**的，
   只处理"事件落在哪一格"会在快速拖动时留下**断点**（用户画实线、图纸上是虚线）。
6. **换文档清栈、重新生成也清栈**，但语义不同：`resetEditState()`（重新上传 / 重置 /
   载入存档）连工具一起复位；`clearEditHistory()`（重新生成）**只清历史、保留工具**，
   且**必须提示**"之前的 N 步手工修改已随之作废"。

> ⚠️ **编辑与简化滑块的冲突（产品决策，不要"顺手解开"）**：
> `applySimplify()` 是"拿 `rawGridData` **整份重算**"，会把用户的逐格修正**全部抹掉**，
> 而滑块本身看不出这件事。故 `editIndex > 0` 时简化滑块**禁用**，
> 并在滑块**就近**显示原因与恢复办法（`#simplifyLockHint`）。
> **撤销掉全部编辑后锁自动解除**（判据是 `editIndex`，不是 `editHistory.length > 0`）。
> 滑块 `input` 里另有一道兜底 —— `disabled` 挡得住指针，挡不住脚本派发。

> ⚠️ **编辑工具栏挂在 `#previewSection` 内部**（不是控制栏）：编辑的对象就是
> `#previewCanvas`，两者同屏用户才不必来回找。

> ⚠️ **统计表的「选为画笔色」按钮用事件委托**：`renderStats()` 是整表 `innerHTML`
> 重建，逐个绑定在每次重绘后都要重来一遍，漏一次的表现就是"按钮点了没反应"。
> 重建后**必须还原键盘焦点**（见 `refreshStatsKeepingFocus()`），否则键盘用户失去落点。

> ⚠️ **三个工具按钮是 `role="radiogroup"` 单选组，不是 `aria-pressed` 切换钮** ——
> 因为它们**再按一次不取消**（退出编辑走显式的「✕ 退出编辑」）。
> **不要"顺手"把 `aria-checked` 改回 `aria-pressed`**：那会让读屏用户以为再按一次能取消，
> 而实际行为是保持选中，属于语义与行为不符。
>
> ⚠️ **`paintCell()` 会自动补开一笔**（无进行中的一笔时），并在**微任务**里收尾。
> 收尾必须比对**对象身份**（`autoCloseStroke(target)`），不能只看 `stroke !== null` ——
> 微任务是延迟执行的，在那之前调用方完全可能已经开了新的一笔，
> 只看"当前有没有一笔"会把**新那一笔**提前结掉（症状：偶发"一次拖拽被切成两笔，
> 撤销要按两下"，且只在特定时序下复现）。

## PWA 相关

- `manifest.json`：standalone 模式，indigo 主题色
  - **图标分两组声明**：`icon-192/512.png` 为 `purpose: "any"`；
    `icon-192/512-maskable.png` 为 `purpose: "maskable"`（内容限制在中心 56%）
  - ⚠️ **不要把 `maskable` 混进 `"any maskable"`** —— 满幅图标在圆形遮罩下会被切掉边缘
- `sw.js`：cache-first 策略，预缓存核心资源（**逐个 `cache.add()` + `allSettled`**，
  单个失败不拖垮整体）；离线可用
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

> ⚠️ **重构时最容易被静默改坏的就是这几条** —— 它们都有对应的守护套件，
> 改动相关代码前先看 [docs/REVIEW.md](docs/REVIEW.md) §五「本来正确」清单。

## 🧪 回归测试

脚手架在仓库**之外**：`F:\claudeapp\demo\.pindou-devtools\`，刻意不污染零依赖交付物。

```powershell
cd F:\claudeapp\demo\.pindou-devtools
node run-all.js      # 一键跑全部，退出码 0 = 全绿
```

它**加载真实的 index.html + js/ 模块**（不复制逻辑），断言落在**用户可感知的输出**上。
**架构：每个用例一个 runner 子进程 + 真实 `import()`** ——
见 [docs/REFACTOR.md](docs/REFACTOR.md) §8.4。
改完代码请跑一遍 —— 这套脚手架正是为了拦住"改了 A 弄坏 B"而建的。

> ⚠️ **写测试时两条硬约束**（真实踩到，详见 [docs/REFACTOR.md](docs/REFACTOR.md) §8.4）：
> 1. **`app.inner.*` 是异步的，必须 `await`** —— 漏了会**偶发红**（实测约 40% 概率），
>    极难排查。模板字面量里不能直接 await。
> 2. **不能"先取函数再调用"**（`const f = app.inner.x; f()`）—— 拿到的是 Promise。
>
> 📌 **套件数量与清单会随功能开发增长** —— 现状以 [docs/PLAN.md](docs/PLAN.md) §6.6 为准。
> **突变测试**（`probe-*-mutation.js`）是验证"断言不是空的"的唯一手段，**不要省**。

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

> **⚠️ 本项目用原生 ESM（`<script type="module">` 单入口）** —— 见 [docs/REFACTOR.md](docs/REFACTOR.md) §4.1。
> ESM 受 CORS 限制，`file://` 协议下无法加载模块，
> **因此「双击 index.html」不可用** —— 这是**已接受的代价**。
> 双击只会看到**没有样式的空壳页面**（模块被 CORS 拦下，页面功能全无）。
>
> 仍不引入任何构建工具：原生 `import`/`export` 即可，无需 `package.json` 或打包步骤。
>
> **依赖顺序由各模块的 `import` 语句表达**（**不再是** `<script>` 标签顺序），
> 因此原来「标签顺序错了会抛 TDZ」的风险**已消失**。

## 未来可扩展方向

> **完整清单、优先级排序、执行进度与实施方案见 [docs/PLAN.md](docs/PLAN.md)**。
> 本节**仅保留索引**，避免两份清单各自漂移。

**进行中**：无。
> ✅ **6a 序列化地基已完成**（`js/core/serialize.js`，见上「序列化地基」小节与 PLAN §3.6）。
> ✅ **6b 网格保存/加载已完成**（`js/core/storage.js` + `js/ui/library.js`，
> 见上「存档存储层与无原图模式」小节与 PLAN §3.7）。
> ✅ **6c 单元格编辑 + 6d 撤销/重做已完成**（`js/pipeline/edit.js` + `js/ui/edit-ui.js`，
> 见上「单元格编辑」小节与 PLAN §3.8）。**第三批到此收尾。**

**尚未开工**：抖动算法、分块渲染。
**待确认**：简化滑块高端行为（PLAN §3.3，需产品决策）。
**下一步（非功能项）**：结构收尾 —— 拆 `pointermove` 三合一回调 +
把跨领域调用收拢到 `js/main.js`（PLAN §5.1 最后一步）。

**已搁置**：多品牌色板支持（依赖色板抽象，成本主要在数据可靠性）、
色板自定义编辑（依赖最多、风险最高，需版本化）、
将图片像素化再生成图纸（与现有逐格采样高度重叠）。
