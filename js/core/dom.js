// ============================================================
// js/core/dom.js — DOM 引用与基础助手
// ============================================================
// 自 app.js 顶部「DOM 引用」段搬迁而来（REFACTOR §7.1 步骤 5）。
//
// ⚠️ **本文件必须最先加载**（index.html 里排在所有 js/ 模块之前）：
//    它定义 `$` / `$$` 以及全部 DOM 引用 —— 其它模块的顶层代码
//    （尤其是注册事件监听时）会立刻用到它们。
//    顺序错了会抛 `ReferenceError: Cannot access '$' before initialization`
//    （TDZ —— 本轮搬迁时**真实踩过**，见 js/ui/a11y.js 的注释）。
//
// ⚠️ `isTouchDevice` 的判据必须与 style.css 的 `@media (pointer: coarse)` 一致
//    （REVIEW.md M8）：JS 曾用 maxTouchPoints，会导致触摸屏笔记本上
//    JS 判定与 CSS 判定相反、界面提示与实际 UI 错配。
//
// 本文件是原生 ES module（步骤 0 已完成）：依赖由上方 import 显式声明，
// 不再靠"共享全局词法环境"。
// ============================================================
// ----- DOM 引用 -----
export const $ = (sel) => document.querySelector(sel);
export const $$ = (sel) => document.querySelectorAll(sel);

export const uploadSection = $('#uploadSection');
export const uploadZone = $('#uploadZone');
export const fileInput = $('#fileInput');
export const uploadError = $('#uploadError');
export const viewerSection = $('#viewerSection');
export const viewerWrapper = $('#viewerWrapper');
export const viewerCanvas = $('#viewerCanvas');
// 注：#selectionOverlay 是纯布局容器（无 JS 逻辑），不在此取引用 ——
// 原先的 selectionOverlay 变量是死引用（全项目 0 处使用，见 REFACTOR.md §3.4）
export const selectionBox = $('#selectionBox');
export const viewerHint = $('#viewerHint');
export const viewerHint2 = $('#viewerHint2');
export const viewerHint4 = $('#viewerHint4');
export const controlsSection = $('#controlsSection');
export const downloadBtn = $('#downloadBtn');
export const previewSection = $('#previewSection');
export const previewCanvas = $('#previewCanvas');
export const previewInfo = $('#previewInfo');
export const statsSection = $('#statsSection');
export const statsBody = $('#statsBody');
export const statsFoot = $('#statsFoot');
export const offscreenCanvas = $('#offscreenCanvas');
export const downloadCanvas = $('#downloadCanvas');
export const customW = $('#customW');
export const customH = $('#customH');
export const applyCustom = $('#applyCustom');
export const simplifySlider = $('#simplifySlider');
export const simplifyValue = $('#simplifyValue');
export const rulerToggle = $('#rulerToggle');
export const cameraInput = $('#cameraInput');
export const cameraBtn = $('#cameraBtn');
export const shareBtn = $('#shareBtn');
export const loadingOverlay = $('#loadingOverlay');
export const loadingText = $('#loadingText');
export const installBanner = $('#installBanner');
export const installBtn = $('#installBtn');
export const installClose = $('#installClose');
export const viewerHint3 = $('#viewerHint3');

// 触摸设备检测。
// ⚠️ 判据必须与 style.css 的 `@media (pointer: coarse)` **完全一致**（见 REVIEW.md M8）：
// 此前 JS 用 `navigator.maxTouchPoints > 0`（存在任意触摸点），
// CSS 用 `pointer: coarse`（**主**指针为粗指针）。二者不等价 ——
// 触摸屏笔记本上 JS 判定"是触摸设备"（显示「双指缩放/平移」提示），
// 而 CSS 判定"是桌面"（显示桌面拖拽上传区），界面提示与实际 UI 错配。
// 统一走 CSS 同一判据，二者永远同向。
export const isTouchDevice = (() => {
  if (typeof window.matchMedia === 'function') {
    return window.matchMedia('(pointer: coarse)').matches;
  }
  // 极老浏览器无 matchMedia：退回触摸点判据（有偏差但聊胜于无）
  return navigator.maxTouchPoints > 0;
})();
