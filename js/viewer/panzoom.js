import { viewerWrapper } from '../core/dom.js';
import { state } from '../core/state.js';
import { clamp } from '../ui/a11y.js';
import { updateSelectionBox } from './selection.js';
import { renderViewer, resizeViewerCanvas } from './viewer.js';

// ============================================================
// js/viewer/panzoom.js — 缩放与平移（右键拖拽 / 滚轮 / 双指 / 窗口尺寸）
// ============================================================
// 自 app.js 的「3. 矩形选框」下半段搬迁而来（REFACTOR §7.1 步骤 5）。
//
// ⚠️ **双指平移必须相对 `touchStartCenter` 累计**（REVIEW.md M2）：
//    原先用"单帧增量"，导致位移只生效一帧、几乎不动。不要改回单帧增量。
//
// ⚠️ 双指缩放的夹取范围是 0.2~5，与滚轮一致。
//
// 本文件是原生 ES module（步骤 0 已完成）：依赖由上方 import 显式声明，
// 不再靠"共享全局词法环境"。
// ============================================================
// 右键拖拽平移
viewerWrapper.addEventListener('contextmenu', (e) => e.preventDefault());
viewerWrapper.addEventListener('pointerdown', (e) => {
  if (e.button === 2) {
    state.isPanning = true;
    state.panStartPan = { x: state.panX, y: state.panY };
    // client 像素坐标 —— 与 dragStartImage 的归一化坐标是两套语义，勿混用
    state.dragStartClient = { x: e.clientX, y: e.clientY };
    viewerWrapper.classList.add('panning');
    viewerWrapper.setPointerCapture(e.pointerId);
  }
});

// 滚轮缩放
viewerWrapper.addEventListener('wheel', (e) => {
  e.preventDefault();
  const delta = e.deltaY > 0 ? -0.1 : 0.1;
  state.zoom = Math.max(0.2, Math.min(5, state.zoom + delta));
  renderViewer();
  updateSelectionBox();
}, { passive: false });

// 触摸事件：双指缩放 + 双指平移
viewerWrapper.addEventListener('touchstart', (e) => {
  if (e.touches.length === 2) {
    e.preventDefault();
    const t1 = e.touches[0];
    const t2 = e.touches[1];
    state.lastTouchDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
    state.lastTouchCenter = {
      x: (t1.clientX + t2.clientX) / 2,
      y: (t1.clientY + t2.clientY) / 2,
    };
    // 记录手势**起点**：位移必须相对起点累计，不能逐帧取增量后叠加到起点
    // （那样 panX 恒等于"起点 + 最后一帧的微小位移"，位移不累积，见 REVIEW.md M2）
    state.touchStartCenter = { ...state.lastTouchCenter };
    state.isPinching = true;
    state.panStartPan = { x: state.panX, y: state.panY };
  }
}, { passive: false });

viewerWrapper.addEventListener('touchmove', (e) => {
  if (e.touches.length === 2 && state.isPinching) {
    e.preventDefault();
    const t1 = e.touches[0];
    const t2 = e.touches[1];
    const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
    const center = {
      x: (t1.clientX + t2.clientX) / 2,
      y: (t1.clientY + t2.clientY) / 2,
    };

    // 缩放
    const scale = dist / state.lastTouchDist;
    state.zoom = clamp(state.zoom * scale, 0.2, 5);
    state.lastTouchDist = dist;

    // 双指平移：用「起点 + 累计位移」，与鼠标平移（见 isPanning 分支）语义一致。
    // 旧实现取单帧增量 dx 却叠到 panStart 上，导致位移不累积 ——
    // 实测 10 帧每帧 +10px 只产生 10px 位移，且位移量与帧数无关（见 REVIEW.md M2）
    const dx = center.x - state.touchStartCenter.x;
    const dy = center.y - state.touchStartCenter.y;
    state.panX = state.panStartPan.x + dx;
    state.panY = state.panStartPan.y + dy;
    state.lastTouchCenter = center;

    renderViewer();
    updateSelectionBox();
  }
}, { passive: false });

viewerWrapper.addEventListener('touchend', (e) => {
  if (e.touches.length < 2) {
    state.isPinching = false;
  }
});

// 窗口大小调整
window.addEventListener('resize', () => {
  if (state.image) {
    resizeViewerCanvas();
    renderViewer();
    updateSelectionBox();
  }
});
