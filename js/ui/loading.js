import { loadingOverlay, loadingText } from '../core/dom.js';

// ============================================================
// js/ui/loading.js — 加载遮罩
// ============================================================
// 自 app.js 的「9. 加载状态」段搬迁而来（REFACTOR §7.1 步骤 5）。
//
// ⚠️ 这两个函数由 `js/pipeline/grid.js` 的 `generateGrid()` 入口**显式**驱动。
//    历史上它们是靠文件末尾的猴补丁接入的（已按 REFACTOR §2.1 拆除）。
//    **不要再对任何函数做猴补丁。**
// ============================================================
// ============================================================
// 9. 加载状态
// ============================================================
// 说明：加载遮罩原先靠文件末尾的「猴补丁整体覆盖 generateGrid」接入，
// 已按 REFACTOR.md §2.1 拆除 —— 现在由 generateGrid() 入口**显式**驱动，
// showLoading / hideLoading 就在这里定义，被入口直接调用。

export function showLoading(msg) {
  loadingText.textContent = msg || '正在处理…';
  loadingOverlay.hidden = false;
}

export function hideLoading() {
  loadingOverlay.hidden = true;
}
