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
// 当前阶段仍用裸 <script> src 加载（步骤 0 未做），故本文件不使用 import/export。
// ============================================================
// ----- DOM 引用 -----
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const uploadSection = $('#uploadSection');
const uploadZone = $('#uploadZone');
const fileInput = $('#fileInput');
const uploadError = $('#uploadError');
const viewerSection = $('#viewerSection');
const viewerWrapper = $('#viewerWrapper');
const viewerCanvas = $('#viewerCanvas');
// 注：#selectionOverlay 是纯布局容器（无 JS 逻辑），不在此取引用 ——
// 原先的 selectionOverlay 变量是死引用（全项目 0 处使用，见 REFACTOR.md §3.4）
const selectionBox = $('#selectionBox');
const viewerHint = $('#viewerHint');
const viewerHint2 = $('#viewerHint2');
const viewerHint4 = $('#viewerHint4');
const controlsSection = $('#controlsSection');
const downloadBtn = $('#downloadBtn');
const previewSection = $('#previewSection');
const previewCanvas = $('#previewCanvas');
const previewInfo = $('#previewInfo');
const statsSection = $('#statsSection');
const statsBody = $('#statsBody');
const statsFoot = $('#statsFoot');
const offscreenCanvas = $('#offscreenCanvas');
const downloadCanvas = $('#downloadCanvas');
const customW = $('#customW');
const customH = $('#customH');
const applyCustom = $('#applyCustom');
const simplifySlider = $('#simplifySlider');
const simplifyValue = $('#simplifyValue');
const rulerToggle = $('#rulerToggle');
const cameraInput = $('#cameraInput');
const cameraBtn = $('#cameraBtn');
const shareBtn = $('#shareBtn');
const loadingOverlay = $('#loadingOverlay');
const loadingText = $('#loadingText');
const installBanner = $('#installBanner');
const installBtn = $('#installBtn');
const installClose = $('#installClose');
const viewerHint3 = $('#viewerHint3');

// 触摸设备检测。
// ⚠️ 判据必须与 style.css 的 `@media (pointer: coarse)` **完全一致**（见 REVIEW.md M8）：
// 此前 JS 用 `navigator.maxTouchPoints > 0`（存在任意触摸点），
// CSS 用 `pointer: coarse`（**主**指针为粗指针）。二者不等价 ——
// 触摸屏笔记本上 JS 判定"是触摸设备"（显示「双指缩放/平移」提示），
// 而 CSS 判定"是桌面"（显示桌面拖拽上传区），界面提示与实际 UI 错配。
// 统一走 CSS 同一判据，二者永远同向。
const isTouchDevice = (() => {
  if (typeof window.matchMedia === 'function') {
    return window.matchMedia('(pointer: coarse)').matches;
  }
  // 极老浏览器无 matchMedia：退回触摸点判据（有偏差但聊胜于无）
  return navigator.maxTouchPoints > 0;
})();
