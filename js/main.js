// ============================================================
// js/main.js — 编排层（REFACTOR §4.2）
// ============================================================
// 本文件是**页面加载的最后一环**，取代了原来的单体 app.js。
//
// 现状（步骤 5 完成后）：
//   各特性域已按 REFACTOR §4.2 全部落位到 js/ 下：
//     core/     dom.js        —— $ / $$ / DOM 引用 / isTouchDevice
//               state.js      —— 常量 / state / viewerCtx / 主题同步
//               serialize.js  —— 图纸序列化/版本化地基（PLAN 第三批 6a；纯函数，不写 state）
//     input/    upload.js     —— handleFile / showError / showToast / 上传区监听
//               camera.js     —— openCamera / capturePhoto / closeCamera
//     viewer/   viewer.js     —— computeImageRect / renderViewer / resizeViewerCanvas …
//               selection.js  —— updateSelectionBox / 选框拖拽
//               panzoom.js    —— 右键平移 / 滚轮 / 双指 / 窗口尺寸
//     pipeline/ render.js     —— drawGrid / drawRuler / pickTextColor / FONT_STACK
//               simplify.js   —— applySimplify / getStaticMergeMap …
//               grid.js       —— generateGrid / generateGridCore
//     output/   preview.js    —— fitPreviewGrid / renderPreview
//               stats.js      —— renderStats
//               export.js     —— computeDownloadSize / renderDownloadCanvas / downloadPNG …
//     ui/       a11y.js       —— announce / markActiveGridBtn / 键盘通路 / clamp
//               grid-select.js—— 网格预设 / 自定义 / 简化滑块 / 标尺开关
//               loading.js    —— showLoading / hideLoading
//               install.js    —— PWA 安装提示
//
// ⚠️ **本文件当前不承载逻辑**，这是**有意为之**，不是遗漏：
//    §4.2 把「showViewer / reset / 事件装配」这类跨领域编排归到 main.js，
//    但它们在步骤 5 中已随各自领域落位（如 showViewer 归 viewer.js）。
//    真正需要收拢的跨领域耦合（pointerup 反向驱动 generateGrid、
//    #resetBtn 横跨 5 个领域、pointermove 三合一回调）是 **REFACTOR §7.1 步骤 6**
//    的范围，尚未执行 —— 见 §4.2 与 §3.3。
//
// ⚠️ 因此**不要**往本文件里堆新功能（防复发规则 1）：按特性域归位到 js/ 下。
//    本文件存在的意义是：步骤 6 收拢跨领域调用时有一个明确的落点，
//    以及步骤 0（ESM）后成为模块图的入口。
//
// ⚠️⚠️ **下面这组 import 是页面能否工作的关键，不是装饰**。
//
//   ESM 的模块图是**从入口的 import 语句出发**解析的 —— 没有被 import 到的
//   文件**根本不会被浏览器请求**。本文件原先只有注释、一条 import 都没有，
//   于是 index.html 虽然写着 `<script type="module" src="js/main.js">`，
//   浏览器却只取到 main.js 一个文件，**其余 18 个模块全都没加载** ——
//   页面表现为"完全没反应"（而 jsdom 脚手架用的是真实 `import()` 整图，
//   所以**测试全绿也发现不了**，必须靠真实浏览器验证）。
//
//   实测证据：改成单入口后，Chrome 网络层只看到
//   `index.html / style.css / js/main.js / manifest.json / icon-*.png`，
//   一个 js/ 模块都没有。
//
//   **新增模块时必须在这里补一条 import**（若它不被其它模块引用），
//   否则那个文件永远不会被加载。`probe-verify-entry-chain.js` 守护这条。
//
// 顺序说明：ESM 由解析器做拓扑排序，**这里的书写顺序不影响正确性**；
// 下面按 REFACTOR §4.2 的领域层次排列，纯粹为了可读性。
// ============================================================

// 入口的副作用就是"把整张模块图拉起来"。
// 每个模块在被求值时都会完成自己的装配（DOM 引用、事件监听、状态初始化），
// 所以这里**不需要**再写任何编排代码 —— 见上方「本文件当前不承载逻辑」。
import './core/dom.js';
import './core/state.js';
// 序列化地基（PLAN 第三批 6a）：目前**没有模块引用它**（6b 的保存/加载 UI 才会接上），
// 因此这一条 import 是它唯一的可达路径 —— 漏了它，该文件永远不会被浏览器请求。
// 这也是 `probe-verify-entry-chain.js` 守护的那条规则。
import './core/serialize.js';
import './input/camera.js';
import './input/upload.js';
import './pipeline/render.js';
import './pipeline/simplify.js';
import './pipeline/grid.js';
import './viewer/viewer.js';
import './viewer/selection.js';
import './viewer/panzoom.js';
import './output/preview.js';
import './output/stats.js';
import './output/export.js';
import './output/print.js';
import './ui/a11y.js';
import './ui/grid-select.js';
import './ui/loading.js';
import './ui/install.js';

