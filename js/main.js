// ============================================================
// js/main.js — 编排层（REFACTOR §4.2）
// ============================================================
// 本文件是**页面加载的最后一环**，取代了原来的单体 app.js。
//
// 现状（步骤 5 完成后）：
//   各特性域已按 REFACTOR §4.2 全部落位到 js/ 下：
//     core/     dom.js        —— $ / $$ / DOM 引用 / isTouchDevice
//               state.js      —— 常量 / state / viewerCtx / 主题同步
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
//    以及步骤 0（ESM）后成为模块图的入口（`import './core/dom.js'` 等）。
//
// 加载顺序见 index.html（**顺序即依赖**，错了会抛 TDZ）。
// ============================================================
