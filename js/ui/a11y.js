import { $, $$, controlsSection, downloadBtn, fileInput, previewSection, printBtn, saveArchiveBtn, selectionBox, statsSection, uploadSection, viewerCanvas, viewerSection, viewerWrapper } from '../core/dom.js';
import { state, viewerCtx } from '../core/state.js';
import { generateGrid } from '../pipeline/grid.js';
import { resetEditState } from '../pipeline/edit.js';
import { exitArchiveMode } from './library.js';
import { resetSimplify } from './grid-select.js';
import { updateSelectionBox } from '../viewer/selection.js';
import { renderViewer, resizeViewerCanvas } from '../viewer/viewer.js';

// ============================================================
// js/ui/a11y.js — 无障碍播报与键盘通路
// ============================================================
// 自 app.js 的「工具函数」段搬迁而来（REFACTOR §7.1 步骤 5）。
// 含：announce（aria-live 播报）/ markActiveGridBtn / 键盘操作选框 / clamp。
//
// ⚠️ `announce()` 必须**先清空再写入**：相同的字符串连续写入不会触发 aria-live 播报。
// ⚠️ 键盘通路是 WCAG 2.1.1（A 级）要求，C3 补的；不要删。
//    viewer 区域可聚焦（tabindex 由 HTML 提供），聚焦后才响应，避免抢占页面滚动。
//
// 本文件是原生 ES module（步骤 0 已完成）：依赖由上方 import 显式声明，
// 不再靠"共享全局词法环境"。
// ============================================================
// ============================================================
// 工具函数
// ============================================================

/**
 * 向 #liveStatus 写入一条播报。读屏会念出来，视觉上不可见。
 * 用于生成完成、尺寸变化等「用户看不见但需要知道」的状态（见 REVIEW.md M5）。
 */
let liveTimer = null;
export function announce(msg) {
  const el = document.getElementById('liveStatus');
  if (!el) return;
  // 先清空再写入：相同的字符串连续写入不会触发 aria-live 播报
  el.textContent = '';
  if (liveTimer) clearTimeout(liveTimer);
  liveTimer = setTimeout(() => { el.textContent = msg; }, 60);
}

/** 网格尺寸按钮的 aria-pressed 与 active class 必须同步（见 CLAUDE.md 双保险思路） */
export function markActiveGridBtn(w) {
  $$('.grid-btn').forEach((b) => {
    const on = b.dataset.w === String(w);
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

// 重置选框（恢复默认位置和大小）
$('#resetSelectionBtn').addEventListener('click', () => {
  state.selection = { x: 0.15, y: 0.15, w: 0.7, h: 0.7 };
  state.zoom = 1;
  state.panX = 0;
  state.panY = 0;
  // 先确保 canvas 尺寸正确（iOS Safari 可能因布局变化导致尺寸不符）
  resizeViewerCanvas();
  renderViewer();
  updateSelectionBox();
  generateGrid();
});

// ============================================================
// 键盘操作选框（见 REVIEW.md C3）
// 此前选框的全部操作只由指针事件驱动，键盘用户**无法完成"框选区域"**
// 这一核心用例（WCAG 2.1.1 A 级失败）。这里补一条键盘通路：
//   方向键        移动选框
//   Shift+方向键  调整选框大小
// viewer 区域可聚焦（tabindex 由 HTML 提供），聚焦后才响应，避免抢占页面滚动。
// ============================================================
const KEYBOARD_STEP = 0.02;      // 每次按键移动/缩放的归一化步长
const KEYBOARD_MIN_SIZE = 0.05;  // 选框最小尺寸，避免缩到 0 后无法再操作

viewerWrapper.addEventListener('keydown', (e) => {
  if (!state.image) return;

  const deltas = {
    ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
  };
  const d = deltas[e.key];
  if (!d) return;

  e.preventDefault();
  const sel = state.selection;
  const step = KEYBOARD_STEP;

  if (e.shiftKey) {
    // 调整大小：以选框右边/下边为基准（保持左上角不动，行为可预期）
    let w = sel.w + d[0] * step;
    let h = sel.h + d[1] * step;
    w = clamp(w, KEYBOARD_MIN_SIZE, 1 - sel.x);
    h = clamp(h, KEYBOARD_MIN_SIZE, 1 - sel.y);
    state.selection = { x: sel.x, y: sel.y, w, h };
    announce(`选框大小 ${Math.round(w * 100)}% × ${Math.round(h * 100)}%`);
  } else {
    // 移动选框：夹取到图片范围内
    const x = clamp(sel.x + d[0] * step, 0, 1 - sel.w);
    const y = clamp(sel.y + d[1] * step, 0, 1 - sel.h);
    state.selection = { x, y, w: sel.w, h: sel.h };
    announce(`选框位置 ${Math.round(x * 100)}%, ${Math.round(y * 100)}%`);
  }

  updateSelectionBox();
  renderViewer();
  generateGrid();
});

// 重新上传
$('#resetBtn').addEventListener('click', () => {
  state.image = null;
  state.gridData = null;
  state.colorCounts = null;
  state.rawGridData = null;
  state.rawColorCounts = null;
  state.mergedColors = [];
  state.aspectWarning = null;
  // 换文档（回到最初）：编辑态复位 —— 撤销栈、工具、画笔色都不该跨图纸保留
  // （见 js/pipeline/edit.js 硬约束 4；这里用 resetEditState 而非 clearEditHistory）
  resetEditState();
  // 简化强度与网格尺寸回到默认，避免影响下一张图（C1 / m12）
  resetSimplify();
  state.gridW = 29;
  state.gridH = 29;
  markActiveGridBtn(29);
  // 清空画布，避免残留旧图片
  viewerCtx.clearRect(0, 0, viewerCanvas.width, viewerCanvas.height);
  selectionBox.classList.remove('visible');
  uploadSection.hidden = false;
  viewerSection.hidden = true;
  controlsSection.hidden = true;
  previewSection.hidden = true;
  statsSection.hidden = true;
  downloadBtn.disabled = true;
  // 打印出口同上：重置后必须回到禁用态，否则用户能对**已清空的图纸**唤起打印
  printBtn.disabled = true;
  // 保存图纸（6b）同理：没有图纸就没有可保存的东西
  saveArchiveBtn.disabled = true;
  // 存档模式也要退出（6b）：重置是"回到最初"，此时既无原图也无图纸，
  // 留着"已载入存档…"的横幅与置灰控件会与界面对不上
  exitArchiveMode();
  fileInput.value = '';
});

export function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}
