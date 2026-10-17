import { viewerCanvas } from './dom.js';

// ============================================================
// js/core/state.js — 导出上限常量、全局 state、初始化
// ============================================================
// 自 app.js 顶部常量区 + state 字面量搬迁而来（REFACTOR §7.1 步骤 5）。
//
// ⚠️ **所有 state 字段必须在此处声明后再使用**（REFACTOR §2.3 的教训）：
//    此前 dragSelection / rawGridData / rawColorCounts 是运行时动态挂上去的
//    "影子字段"，读代码的人看不到它们，改 state 时必然漏改。
//
// ⚠️ 三个坐标语义字段**不要合并**（REFACTOR §2.2 / test-dragstart-semantics.js 守护）：
//    dragStartImage（归一化）/ dragStartClient（client 像素）/ panStartPan（pan 起点）。
//
// ⚠️ `AUTO_MERGE_DIST_SQ` 是常开近似色合并的阈值，
//    其消费方在 js/pipeline/simplify.js —— 改这里要同步那边。
//
// 本文件依赖 js/core/dom.js（用到了 viewerCanvas 等引用），故必须排在其后。
// 本文件是原生 ES module（步骤 0 已完成）：依赖由上方 import 显式声明，
// 不再靠"共享全局词法环境"。
// ============================================================
// 导出画布像素上限。iOS Safari 内核（所有 WKWebView）约 16.78MP（4096²），
// 且**单边也不得超过 4096**。超过时 toBlob 会静默回 null（见 REVIEW.md C2）。
export const MAX_EXPORT_MP = 16.78;
export const MAX_EXPORT_SIDE = 4096;
// 期望的导出倍率（2x 高清）。设备允许时会用满，否则自动下调。
export const MAX_EXPORT_DPR = 2;

/**
 * **常开**近似色合并的阈值（**平方**距离 —— `colorDistance()` 返回的就是平方值）。
 *
 * `16` ⟺ 欧氏距离 `dist = 4`。依据是本仓库实测的色板分布（见 PLAN §3.1，
 * 可用 `.pindou-devtools/probe-nearcolor.js` 复现）：
 * 全色板 24,310 个色对中，`dist < 4` 的**只有 3 对**（2.83 / 2.83 / 3.74），
 * 而 `dist < 6` 有 10 对、`dist < 8` 有 16 对。
 *
 * 故取**下限 4** —— 只并掉"肉眼无法分辨"的那几对，是风险最小的起点；
 * 是否放宽到 6 待观察真实图纸后再定（PLAN §3.1 明确要求"先窄后宽"）。
 *
 * ⚠️ 这一层**独立于「简化滑块」常开**：滑块是用户主动的强度选择，
 * 而近似色合并是针对"色板自身存在的近同色对"的修正，默认状态就必须生效。
 */
export const AUTO_MERGE_DIST_SQ = 16;

// ----- 状态 -----
// ⚠️ 所有字段必须在**此处**声明后再使用（REFACTOR.md §2.3 的教训：
// 此前 dragSelection / rawGridData / rawColorCounts 是运行时动态挂上去的"影子字段"，
// 读代码的人看不到它们，改 state 时必然漏改）。
//
// ============================================================
// ⚖️ 字段三类划分（PLAN 第三批第 6 项 6a 定，**新增字段必须归入其中一类**）
// ============================================================
// 这个划分是序列化/版本化地基的边界依据（见 js/core/serialize.js 的文件头）。
// 判据只有一个问题：**"换一台设备打开，这个值还应不应该一样？"**
//
// ┌ ① **图纸文档**（blueprint）—— 序列化进存档，加载时恢复。
// │    当前**只有 `gridData` 一项**（行列数由它的维度导出，不另存）。
// │    ⚠️ 边界是**刻意划窄**的：存档 = "这张图纸长什么样"，
// │       **不含**它是怎么生成的、也不含用户怎么看它。
// │
// ├ ② **显示/输出偏好**（preference）—— `handleFile()` **刻意不重置**，
// │    也不进存档。理由：它们是"用户怎么看"，与图纸内容无关，
// │    用户关掉标尺后不该每次上传/加载都被强行打开。
// │    成员：`rulerEnabled`（标尺）、`printColorBlocks`（打印色块/省墨模式）。
// │
// └ ③ **临时视图/交互态**（transient）—— 既不入档、又必须在重置时归零。
//     成员分两种：
//       · **图像参数**：`simplify` —— 它是对图片的变换，重新上传**必须归零**
//         （`resetSimplify()`），与 ② 的性质正好相反。这是历史上 C1 缺陷的来源。
//       · **一次性状态**：`image` / `imageW` / `imageH` / `zoom` / `panX` / `panY` /
//         `selection` / `gridW` / `gridH` / `mergedColors` / `aspectWarning` /
//         `colorCounts` / `rawGridData` / `rawColorCounts` / `editTool` / `editColor` /
//         `editHistory` / `editIndex` 以及全部拖拽与触摸字段。
//
// ⚠️ **编辑态（6c/6d）为什么归 ③ 而不是 ①**：撤销栈记的是"这一轮会话里我改过哪几格"，
//    换一台设备打开时**不应该**携带（用户要的是那张图纸，不是别人改图的过程）。
//    图纸本身（`gridData`）已经带着编辑结果入档 —— 结果入档、过程不入档。
//
// ⚠️ **两个已明确排除在存档之外、但将来会回来找麻烦的字段**：
//   · `rawGridData` —— 语义是"**采样**的原始映射值"（供简化滑块回溯），
//     **不是**"加载出来的图纸的原始值"。故 6a 的存档不带它。
//     连带后果：**加载一份存档后，简化滑块该可用还是该禁用，是 6b 的产品决策**，
//     本批**不做**该决定（不要在 deserialize 里偷偷补一个 rawGridData 充数）。
//   · `simplify` —— 见上，它是图像参数；存档按"仅图纸本身"的定案**不含参数**，
//     所以加载后无法复现当初的简化强度。这是已确认接受的取舍。
// ============================================================
export const state = {
  image: null,
  imageW: 0,
  imageH: 0,
  /** 视图缩放倍率，夹取在 0.2 ~ 5 */
  zoom: 1,
  panX: 0,
  panY: 0,
  // 选框 (百分比, 0-1)
  selection: { x: 0.15, y: 0.15, w: 0.7, h: 0.7 },
  // 网格尺寸 (15~104)
  gridW: 29,
  gridH: 29,
  // 颜色简化 0-100, 0=关闭
  simplify: 0,
  // 生成的网格数据（每个元素为 {name,hex,r,g,b} 或 null=空格）
  gridData: null,
  colorCounts: null,
  /** 简化前的原始映射数据，供滑块回溯。**与 gridData 不共享引用**（见 REVIEW.md n7） */
  rawGridData: null,
  /** 与 rawGridData 对应的、按数量降序的颜色统计 */
  rawColorCounts: null,
  /** 极端宽高比导致的量化偏差提示（无则 null），由 generateGrid 写入、renderPreview 展示 */
  aspectWarning: null,
  /**
   * 本轮因**近似色合并**而消失的色号，每项形如 `{ from: "H12", to: "E16" }`
   * （无合并时为空数组）。
   *
   * 由 `applySimplify()` 写入、`renderPreview()` 展示。
   * 存在的理由：合并是**静默改变用户产出**的行为 —— 用户会发现自己按图买的
   * H12 在图纸上根本不存在。必须如实告知，且要给出**替代色号**
   * （只说"H12 没了"而不说"改用 E16"等于没说），不能悄悄替换。
   */
  mergedColors: [],
  /**
   * 是否显示**行列标尺**（PLAN §五 第一批第 3 项）：网格外侧的行列号
   * + 每 10 格一条加粗参考线。默认开启。
   *
   * ⚠️ 与 `simplify` 的性质**不同**：simplify 是对图片的变换（因此重新上传要归零），
   * 而标尺是**显示偏好** —— 用户关掉后不该每次上传都被强行打开，
   * 所以 `handleFile()` **刻意不重置**它（这是有意为之，不是漏写）。
   *
   * 它只影响**绘制**，不参与采样与色号映射 —— 切换时无需重新生成网格。
   */
  rulerEnabled: true,
  /**
   * 打印时**是否输出色块底色**（PLAN §4.6「项 4 的真相」）。默认 `true`。
   *
   * ⚠️ 这是一个**刻意的显式开关**，不是可有可无的修饰：它对应那个
   * "反直觉取舍"—— 要让用户能选**省墨模式**（只印网格线与色号、不印色块），
   * 打印样式里就**不能**写死 `print-color-adjust: exact`；
   * 而**不加**该属性时，彩色打印的色块保真度就依赖用户手动勾选「背景图形」。
   * 两者**互斥**，故做成开关：勾上 ⇒ 输出色块并可打印；不勾 ⇒ 省墨模式。
   *
   * ⚠️ 与 `rulerEnabled` 同性质（**输出偏好**，`handleFile()` 刻意不重置），
   * 与 `simplify` **相反**（后者是图像变换参数，重新上传必须归零）。
   */
  printColorBlocks: true,
  // ---- 单元格编辑（PLAN 第三批 6c / 6d，见 js/pipeline/edit.js）----
  /**
   * 当前编辑工具：`'none'`（未进入编辑模式）/ `'brush'` / `'erase'` / `'pick'`。
   *
   * ⚠️ `'none'` 时预览画布**不接管指针** —— 否则用户在预览上滑动（移动端很常见）
   *    会静默改掉图纸。编辑必须由用户显式进入，这是本功能的安全前提。
   */
  editTool: 'none',
  /**
   * 画笔颜色（色板对象形状 `{name,hex,r,g,b}`，无则 `null`）。
   * 来源有两个：颜色统计表点选、或吸管从某一格取色（见 `js/ui/edit-ui.js`）。
   *
   * ⚠️ 它必须是**副本**，不能是 `PERLER_PALETTE` 里的对象引用 ——
   *    否则一次编辑就会就地改坏全局色板（PLAN §3.4 三重别名缺陷，
   *    `js/pipeline/edit.js` 的硬约束 1 有说明与守护）。
   */
  editColor: null,
  /**
   * **撤销栈**（6d）：`[{ changes: [{row, col, before, after}] }]`，
   * 一笔 = 一次按下到抬起之间的全部改动。
   *
   * ⚠️ **绝不能用 `rawGridData` 当撤销栈**（PLAN §5.1 明确要求）：
   *    它的语义是"**采样**原始值"，而载入存档后它**是 `null`**（§3.7 的载入路径
   *    刻意不重建它）。在无原图模式下用它当撤销栈会当场拿到 null。
   *
   * ⚠️ **不入档**（属 ③）：图纸结果（`gridData`）已入档，编辑**过程**不入档。
   */
  editHistory: [],
  /**
   * 撤销栈的游标：**已应用**的笔数。`0` = 无编辑；
   * `editIndex < editHistory.length` 表示还有可重做的笔。
   *
   * ⚠️ 它同时是"图纸是否被手工编辑过"的判据（`hasAppliedEdits()`）——
   *    简化滑块要靠它决定是否禁用（编辑会被整份重算抹掉，见 `js/ui/grid-select.js`）。
   */
  editIndex: 0,
  // 拖拽状态
  isDragging: false,
  isResizing: false,
  isPanning: false,
  /**
   * 选框拖拽**起点**，**归一化图片坐标** `{ix, iy}`（0~1）。
   * 与 client 像素坐标无关 —— 换算靠 `getImageCoords()`。
   */
  dragStartImage: { ix: 0, iy: 0 },
  /**
   * 右键平移**起点**，**client 像素坐标** `{x, y}`（e.clientX 同量纲）。
   *
   * ⚠️ 与 `dragStartImage` 是**两种完全不同的坐标语义**，此前两者共用同一个
   * `state.dragStart` 字段（同名不同形状），已按 REFACTOR.md §2.2 拆开。
   * **不要**再把它们合并回一个字段，也不要拿其中一个去另一个的公式里用。
   */
  dragStartClient: { x: 0, y: 0 },
  dragHandle: null,
  /** 拖拽开始时的选框快照（归一化） */
  dragSelection: null,
  /**
   * 平移（右键拖拽 / 双指）**起点**的 pan 偏移量 `{x: panX, y: panY}`。
   * 位移必须相对它累计：`panX = panStartPan.x + 总位移`
   * （双指见 REVIEW.md M2，右键见 isPanning 分支）。
   */
  panStartPan: { x: 0, y: 0 },
  // 触摸状态
  lastTouchDist: 0,
  /** 上一帧的双指中心点（用于算缩放比与单帧增量） */
  lastTouchCenter: { x: 0, y: 0 },
  /** 双指手势起点的中心点。平移位移必须相对它累计（见 REVIEW.md M2） */
  touchStartCenter: { x: 0, y: 0 },
  isPinching: false,
};

// ----- 初始化 -----
export const viewerCtx = viewerCanvas.getContext('2d');

/**
 * 把 CSS 变量里的主题色同步到 <meta name="theme-color">。
 * 主题色原本硬编码在 4 处（CSS / meta / manifest / icon.svg），改主题极易漏改
 * （见 REVIEW.md n1）。meta 这一处可以在运行时从唯一真源（`--primary`）推导，
 * 从此改主题色只需改 style.css 一处，页面主题色不会漂移。
 * manifest / 图标是构建期资源，仍须手工同步（已在 style.css 注明）。
 */
(function syncThemeColorMeta() {
  try {
    const primary = getComputedStyle(document.documentElement)
      .getPropertyValue('--primary').trim();
    if (!primary) return;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta && meta.content !== primary) meta.setAttribute('content', primary);
  } catch (err) {
    // 取不到就沿用 HTML 里写死的值，不影响功能
  }
})();
