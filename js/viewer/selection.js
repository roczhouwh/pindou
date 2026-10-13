import { selectionBox, viewerHint, viewerHint2, viewerHint4, viewerWrapper } from '../core/dom.js';
import { state } from '../core/state.js';
import { generateGrid } from '../pipeline/grid.js';
import { clamp } from '../ui/a11y.js';
import { computeImageRect, getImageCoords, scheduleViewerRedraw } from './viewer.js';

// ============================================================
// js/viewer/selection.js — 矩形选框（拖拽 / 手柄 / 键盘联动）
// ============================================================
// 自 app.js 的「3. 矩形选框」上半段搬迁而来（REFACTOR §7.1 步骤 5）。
//
// ⚠️ 三个坐标语义字段**不要合并**（REFACTOR §2.2，test-dragstart-semantics.js 守护）：
//    · `dragStartImage`  —— **归一化图片坐标** {ix, iy}，选框拖拽用
//    · `dragStartClient` —— **client 像素坐标** {x, y}，平移用（在 panzoom.js）
//    · `panStartPan`     —— pan 偏移量起点（在 panzoom.js）
//    同名字段两种形状正是步骤 3b 拆掉的历史债。
//
// ⚠️ `pointerup` 末尾会调 `generateGrid()` —— 选框领域**反向驱动** generation。
//    这是既有的跨领域耦合（REFACTOR §3.3），搬迁时原样保留，
//    待编排层（main.js）建立后再考虑收拢，**不要在这里顺手改**。
//
// 本文件是原生 ES module（步骤 0 已完成）：依赖由上方 import 显式声明，
// 不再靠"共享全局词法环境"。
// ============================================================
// ============================================================
// 3. 矩形选框
// ============================================================

export function updateSelectionBox() {
  // 确保选框可见（iOS Safari 可能因渲染延迟导致 class 不生效）
  selectionBox.classList.add('visible');

  const sel = state.selection;
  // ⚠️ 与 renderViewer 一致地使用 getBoundingClientRect 的宽高（差异刻意保留）
  const rect = viewerWrapper.getBoundingClientRect();
  const { imgX, imgY, scaledW, scaledH } = computeImageRect(rect.width, rect.height);

  selectionBox.style.left = (imgX + sel.x * scaledW) + 'px';
  selectionBox.style.top = (imgY + sel.y * scaledH) + 'px';
  selectionBox.style.width = (sel.w * scaledW) + 'px';
  selectionBox.style.height = (sel.h * scaledH) + 'px';
}

// 选框绘制（在 viewer 上开始拖拽）
viewerWrapper.addEventListener('pointerdown', (e) => {
  if (e.button === 2) return; // 右键留给平移
  if (e.target.classList.contains('handle')) return; // 手柄拖拽
  e.preventDefault(); // 阻止浏览器默认触摸行为（滚动/下拉刷新）

  const coords = getImageCoords(e.clientX, e.clientY);
  if (!coords.inImage) return;

  // 检查是否点击在选框内（用于移动选框）
  const sel = state.selection;
  const { ix, iy } = coords;
  const inside = ix >= sel.x && ix <= sel.x + sel.w && iy >= sel.y && iy <= sel.y + sel.h;

  if (inside) {
    // 移动选框
    state.isDragging = true;
    state.dragStartImage = { ix, iy };
    state.dragSelection = { ...sel };
    viewerWrapper.setPointerCapture(e.pointerId);
  } else {
    // 开始新的框选
    state.isDragging = true;
    state.dragStartImage = { ix, iy };
    state.dragSelection = { x: ix, y: iy, w: 0, h: 0 };
    viewerWrapper.setPointerCapture(e.pointerId);
  }
});

// 手柄拖拽
document.addEventListener('pointerdown', (e) => {
  if (e.target.classList.contains('handle')) {
    state.isResizing = true;
    state.dragHandle = e.target.dataset.handle;
    state.dragSelection = { ...state.selection };
    e.target.setPointerCapture(e.pointerId);
    e.preventDefault();
  }
});

document.addEventListener('pointermove', (e) => {
  if (state.isDragging) {
    const coords = getImageCoords(e.clientX, e.clientY);
    const { ix, iy } = coords;
    const ds = state.dragStartImage;   // 归一化图片坐标

    if (state.dragSelection.w === 0 && state.dragSelection.h === 0) {
      // 正在框选
      const x = Math.min(ds.ix, ix);
      const y = Math.min(ds.iy, iy);
      const w = Math.abs(ix - ds.ix);
      const h = Math.abs(iy - ds.iy);
      state.selection = { x, y, w, h };
    } else {
      // 移动选框
      const dx = ix - ds.ix;
      const dy = iy - ds.iy;
      const old = state.dragSelection;
      state.selection = {
        x: Math.max(0, Math.min(1 - old.w, old.x + dx)),
        y: Math.max(0, Math.min(1 - old.h, old.y + dy)),
        w: old.w,
        h: old.h,
      };
    }
    scheduleViewerRedraw(); // 更新选框 DOM 与 canvas 上的选框轮廓（每帧合并）
  }

  if (state.isResizing) {
    const coords = getImageCoords(e.clientX, e.clientY);
    const { ix, iy } = coords;
    const old = state.dragSelection;
    let { x, y, w, h } = old;

    switch (state.dragHandle) {
      case 'nw': x = clamp(ix, 0, old.x + old.w - 0.01); y = clamp(iy, 0, old.y + old.h - 0.01); w = old.x + old.w - x; h = old.y + old.h - y; break;
      case 'n':  y = clamp(iy, 0, old.y + old.h - 0.01); h = old.y + old.h - y; break;
      case 'ne': w = clamp(ix - old.x, 0.01, 1 - old.x); y = clamp(iy, 0, old.y + old.h - 0.01); h = old.y + old.h - y; break;
      case 'w':  x = clamp(ix, 0, old.x + old.w - 0.01); w = old.x + old.w - x; break;
      case 'e':  w = clamp(ix - old.x, 0.01, 1 - old.x); break;
      case 'sw': x = clamp(ix, 0, old.x + old.w - 0.01); w = old.x + old.w - x; h = clamp(iy - old.y, 0.01, 1 - old.y); break;
      case 's':  h = clamp(iy - old.y, 0.01, 1 - old.y); break;
      case 'se': w = clamp(ix - old.x, 0.01, 1 - old.x); h = clamp(iy - old.y, 0.01, 1 - old.y); break;
    }

    state.selection = { x, y, w, h };
    scheduleViewerRedraw(); // 更新选框 DOM 与 canvas 上的选框轮廓（每帧合并）
  }

  if (state.isPanning) {
    // 两者都是 client 像素坐标，量纲一致（见 state.dragStartClient 的说明）
    state.panX = state.panStartPan.x + (e.clientX - state.dragStartClient.x);
    state.panY = state.panStartPan.y + (e.clientY - state.dragStartClient.y);
    scheduleViewerRedraw();
  }
});

document.addEventListener('pointerup', (e) => {
  if (state.isDragging || state.isResizing) {
    state.isDragging = false;
    state.isResizing = false;
    state.dragHandle = null;
    viewerHint.hidden = true;
    viewerHint2.hidden = true;
    // 键盘提示与其余提示同规则：用户已经开始操作，说明找到了交互方式。
    // 注意键盘路径不经过本分支（不设 isDragging），
    // 因此键盘用户仍能一直看到这条提示。
    viewerHint4.hidden = true;
    generateGrid();
  }
  if (state.isPanning) {
    state.isPanning = false;
    viewerWrapper.classList.remove('panning');
  }
});

