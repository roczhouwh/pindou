import { $, previewCanvas, previewInfo, previewSection } from '../core/dom.js';
import { state } from '../core/state.js';
import { exportScaleNote } from './export.js';
import { drawGrid, drawRuler, rulerMetrics } from '../pipeline/render.js';

// ============================================================
// js/output/preview.js — 图纸预览渲染
// ============================================================
// 自 app.js 的「6. 图纸预览」整段搬迁而来（REFACTOR §7.1 步骤 5）。
//
// ⚠️ `fitPreviewGrid()` 的**迭代收敛**不要"优化"成一次估算：
//    标尺边距是格子尺寸的函数，用"缩放前的边距"估算会溢出容器（实测 1~7px）。
//    MIN_SCALE=0.35 是既有产品决策（极窄屏宁可横向滚动），不是缺陷。
//
// 本文件是原生 ES module（步骤 0 已完成）：依赖由上方 import 显式声明，
// 不再靠"共享全局词法环境"。
// 它调用的 drawGrid / drawRuler / rulerMetrics 来自 js/pipeline/render.js。
// ============================================================
// ============================================================
// 6. 图纸预览
// ============================================================

/**
 * 预览网格的**小屏适配**尺寸计算（含标尺边距）。
 *
 * ⚠️ 为什么要迭代收敛（实测数据见 `.pindou-devtools/probe-ruler-scale.js`）：
 * 标尺边距 `margin` 是**格子尺寸的函数** —— 缩放后格子变小，边距也跟着变小。
 * 若只用"缩放前"的边距去算缩放比，最终的 `gutter` 会小于估算值，
 * 于是画布比容器**窄**（无害但浪费空间）；反过来若先算出的比例再取整，
 * 就会**超出**容器导致横向滚动条（实测 vw=390 时超出 7px）。
 * 迭代到不动点即可稳定，3 次足够（边距单调不增，收敛很快）。
 *
 * 保留原实现的 **35% 下限**：极窄屏上宁可让容器横向滚动，也不把图纸缩到看不清
 * （这是既有产品决策，不是缺陷 —— `style.css` 的 `.preview-container{overflow-x:auto}` 正为此存在）。
 *
 * @param {number} baseW 未缩放时的网格宽
 * @param {number} baseH 未缩放时的网格高
 * @param {number} cols 列数
 * @param {number} rows 行数
 * @param {number} maxW 容器可用宽度
 * @param {number} padding 画布内边距
 * @param {boolean} useRuler 是否开标尺
 * @returns {{drawW:number, drawH:number}} 适配后的网格绘制尺寸
 */
export function fitPreviewGrid(baseW, baseH, cols, rows, maxW, padding, useRuler) {
  const MIN_SCALE = 0.35;
  const gutterOf = (w, h) => (useRuler ? rulerMetrics(w / cols, h / rows).margin : 0);
  const totalW = (w, h) => w + gutterOf(w, h) + padding * 2;

  if (totalW(baseW, baseH) <= maxW) return { drawW: baseW, drawH: baseH };

  const aspect = baseH / baseW;
  const minW = Math.max(1, Math.floor(baseW * MIN_SCALE));

  let scale = Math.max(MIN_SCALE, maxW / totalW(baseW, baseH));
  let drawW = baseW;
  for (let i = 0; i < 3; i++) {
    // 用 floor 保证不因取整而超出（原实现用 round，实测会超出 1~5px）
    drawW = Math.max(minW, Math.floor(baseW * scale));
    const drawH = Math.max(1, Math.round(drawW * aspect));
    const t = totalW(drawW, drawH);
    if (t <= maxW) break;
    scale *= maxW / t;    // 边距变化后重算比例，逐步收敛
  }

  // 兜底：仍超出则直接扣掉超出部分（仅在未触及 35% 下限时可能发生）
  let drawW2 = Math.max(minW, drawW);
  let drawH2 = Math.max(1, Math.round(drawW2 * aspect));
  const over = totalW(drawW2, drawH2) - maxW;
  if (over > 0 && drawW2 > minW) {
    drawW2 = Math.max(minW, drawW2 - over);
    drawH2 = Math.max(1, Math.round(drawW2 * aspect));
  }
  return { drawW: drawW2, drawH: drawH2 };
}

/** 预览画布的内边距（CSS px）。`canvasW = drawW + gutter + padding*2` */
export const PREVIEW_PADDING = 4;

/**
 * 预览版面的**纯计算**：给定网格尺寸与可用宽度，算出画布尺寸、格子尺寸、
 * 标尺边距与**网格本体左上角**。
 *
 * ⚠️ **为什么要抽出来**（PLAN 第三批 6c 单元格编辑）：
 *    命中测试（点在哪一格）必须与绘制用**同一份几何**。若在编辑侧另写一遍
 *    "canvas 减去 padding 再除以列数"，两处就会各自漂移 —— 而漂移的表现是
 *    **点这一格、改的是旁边那一格**，属于最难察觉、后果最严重的一类缺陷
 *    （用户会照着改了号的图纸去买豆）。故几何只有一个真源。
 *
 * ⚠️ 本函数**不读 `state`、不碰 DOM、不绘制** —— 可用宽度由调用方给出
 *    （`previewLayoutFor()` 负责从容器量取）。这样它才能被测试直接驱动。
 *
 * ⚠️ 数学与抽出前**逐像素一致**：`test-ruler.js` 有像素级断言守着
 *    （画布尺寸、gutter、标尺位置），"顺手优化"会改动用户可见产出。
 *
 * @param {number} cols 列数
 * @param {number} rows 行数
 * @param {number} maxW 容器可用宽度（已减去容器自身 padding）
 * @param {boolean} rulerEnabled 是否开标尺
 * @param {number} [padding] 画布内边距
 * @returns {{cols:number,rows:number,drawW:number,drawH:number,cellW:number,cellH:number,
 *            dpr:number,ruler:object|null,gutter:number,padding:number,
 *            canvasW:number,canvasH:number,gridX:number,gridY:number}}
 */
export function computePreviewLayout(cols, rows, maxW, rulerEnabled, padding = PREVIEW_PADDING) {
  // 网格宽高比 = cols/rows。预览按网格真实比例绘制（非强制正方形格子），
  // 选框内容完整放入网格（contain），留白居中，与选框形状一致。
  // （此前用正方形 cellSize 会把长方形网格拉伸，导致图纸与选框不一致）。
  const gridAspect = cols / rows;
  let baseW, baseH;
  if (gridAspect >= 1) {
    baseW = 720;
    baseH = Math.round(720 / gridAspect);
  } else {
    baseH = 720;
    baseW = Math.round(720 * gridAspect);
  }

  // 小屏适配（含标尺边距），见 fitPreviewGrid 的说明
  const { drawW, drawH } = fitPreviewGrid(
    baseW, baseH, cols, rows, maxW, padding, rulerEnabled,
  );

  // 单元格尺寸（长方形，保持网格真实比例）
  const cellW = drawW / cols;
  const cellH = drawH / rows;

  const dpr = window.devicePixelRatio || 1;

  // 标尺边距（最终值，按适配后的格子尺寸）
  const ruler = rulerEnabled ? rulerMetrics(cellW, cellH) : null;
  const gutter = ruler ? ruler.margin : 0;

  const canvasW = drawW + gutter + padding * 2;
  const canvasH = drawH + gutter + padding * 2;

  // 网格本体位置：右下方各留出 gutter 给行列号（gutter=0 时与改动前完全一致）
  const gridX = padding + gutter;
  const gridY = padding + gutter;

  return {
    cols, rows, drawW, drawH, cellW, cellH, dpr, ruler, gutter, padding,
    canvasW, canvasH, gridX, gridY,
  };
}

/**
 * 按**当前 state 与真实容器宽度**算一次预览版面。
 * 供 `renderPreview()` 与命中测试共用（两者必须拿到同一份几何）。
 */
export function previewLayoutFor(grid, rulerEnabled) {
  const rows = grid.length;
  const cols = grid[0].length;
  const previewContainer = previewCanvas.parentElement;
  // 减去 padding 8px×2；容器缺失时退回画布基准宽（与 jsdom 等无布局环境同构）
  const maxContainerW = (previewContainer ? previewContainer.clientWidth : 720) - 16;
  return computePreviewLayout(cols, rows, maxContainerW, rulerEnabled);
}

/**
 * **预览命中测试**：把预览画布内的局部坐标（CSS px）换算成格子的行列号。
 *
 * 纯几何，不读 DOM —— 调用方负责把 `clientX/Y` 减去
 * `previewCanvas.getBoundingClientRect()` 得到局部坐标（见 `js/ui/edit-ui.js`）。
 *
 * ⚠️ 与 `computePreviewLayout()` 是**同一份几何**：格子尺寸是浮点数，
 *    用 `floor` 定位；网格之外的点击返回 `null`（不夹取到边缘 ——
 *    夹取会让"点在图纸外"变成"改掉最边上一格"，那是最不该发生的误改）。
 *
 * @param {number} localX 画布内局部 x（CSS px）
 * @param {number} localY 画布内局部 y（CSS px）
 * @param {object} layout `computePreviewLayout()` 的结果
 * @returns {{row:number, col:number}|null} 命中则给出行列号，否则 null
 */
export function hitTestCell(localX, localY, layout) {
  if (!Number.isFinite(localX) || !Number.isFinite(localY)) return null;
  const col = Math.floor((localX - layout.gridX) / layout.cellW);
  const row = Math.floor((localY - layout.gridY) / layout.cellH);
  if (col < 0 || col >= layout.cols) return null;
  if (row < 0 || row >= layout.rows) return null;
  return { row, col };
}

/**
 * 两格之间**经过的全部格子**（含 `to`，不含 `from`）。
 *
 * ⚠️ **为什么必须有它**（PLAN 第三批 6c 实测踩到）：
 *    指针事件是**离散采样**的 —— 浏览器按帧派发 `pointermove`，快速拖动时两次事件
 *    之间可能跨过好几格。只处理"事件落在哪一格"会在拖拽路径上留下**断点**：
 *    用户画了一条线，图纸上却是虚线。104×104 在小屏上格子只有几像素，尤其明显。
 *    故在两个采样点之间**补全**路径。
 *
 * 实现用"沿线段按**半格**步进 + 去重"，而不是 Bresenham 直线算法：
 *   ① 半格步进保证不会跳过任何被线段穿过的格子（Bresenham 在斜率较大时
 *      会不会漏格取决于变体，容易写出"看起来对、偶尔漏一格"的实现）；
 *   ② 结果与"手指实际划过的格子"一致，而不是数学上的理想直线 ——
 *      涂色要的是前者。
 *
 * 本函数是**纯几何**（不碰 DOM、不读 state），故与 `hitTestCell` 同处一个模块，
 * 由 `js/ui/edit-ui.js` 调用。参数与返回都用行列号，不涉及 canvas 坐标。
 *
 * @param {{row:number,col:number}} from 起点格（不含）
 * @param {{row:number,col:number}} to 终点格（含）
 * @returns {Array<{row:number,col:number}>} 顺序为从起点到终点，已去重
 */
export function cellsBetween(from, to) {
  if (!from || !to) return [];
  const dr = to.row - from.row;
  const dc = to.col - from.col;
  const steps = Math.max(Math.abs(dr), Math.abs(dc));
  if (steps === 0) return [];
  // 每格至少采 2 个点（半格步进），保证穿过的格子都会被点到
  const n = steps * 2;
  const out = [];
  const seen = new Set();
  // ⚠️ 起点必须先排除：半格步进在"相邻两格"（steps=1）时，中点 `t=0.5` 会
  //    `round` **回到起点那一格**，于是返回里混进了 from。
  //    实测踩到（`test-edit.js` 有断言）。它当场无害（调用方已经涂过 from、
  //    `stroke.seen` 也会去重），但会让"不含起点"这条契约变成假的 ——
  //    而契约一旦可以失真，将来就有人据此写出错的假设。
  const fromKey = `${from.row},${from.col}`;
  seen.add(fromKey);
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const row = Math.round(from.row + dr * t);
    const col = Math.round(from.col + dc * t);
    const key = `${row},${col}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ row, col });
  }
  // 最后一点必须正好是终点（`round` 在 t=1 处必然命中，这里只做显式兜底）
  const last = out[out.length - 1];
  if (!last || last.row !== to.row || last.col !== to.col) out.push({ row: to.row, col: to.col });
  return out;
}

export function renderPreview() {
  if (!state.gridData) return;
  previewSection.hidden = false;

  const grid = state.gridData;

  // 版面（画布尺寸 / 格子尺寸 / 标尺边距 / 网格原点）走**纯函数**，
  // 与命中测试共用同一份几何（见 computePreviewLayout 的说明）
  const layout = previewLayoutFor(grid, state.rulerEnabled);
  const { cols, rows, cellW, cellH, dpr, ruler, gutter, padding, canvasW, canvasH, gridX, gridY } = layout;

  previewCanvas.width = canvasW * dpr;
  previewCanvas.height = canvasH * dpr;
  previewCanvas.style.width = canvasW + 'px';
  previewCanvas.style.height = canvasH + 'px';

  const ctx = previewCanvas.getContext('2d');
  ctx.scale(dpr, dpr);

  // 背景
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvasW, canvasH);

  // 网格绘制（填色 + 网格线 + 色号）走共用实现。
  // 预览的差异项：画空格斜线、网格线 0.15、色号需 minCell≥10、字号不取整
  drawGrid(ctx, grid, {
    x: gridX,
    y: gridY,
    cellW,
    cellH,
    gridLineColor: 'rgba(0,0,0,0.15)',
    hatchEmptyCells: true,      // ⚠️ 导出刻意不画（§3.2 #3），详见 drawGrid 的差异表
    textMinCell: 10,
    roundFontSize: false,
  });

  // 行列标尺与网格共用同一实现（预览/导出不会漂移）
  if (ruler) {
    drawRuler(ctx, {
      x: gridX, y: gridY, cellW, cellH, rows, cols,
      margin: gutter, step: ruler.step, majorStep: ruler.majorStep,
      fontSize: ruler.fontSize,
      lineColor: 'rgba(0,0,0,0.45)',
      textColor: '#333333',
    });
  }

  previewInfo.textContent = `${cols}×${rows} 网格 · ${Math.round(cellW)}×${Math.round(cellH)}px/格${exportScaleNote()}`;
  // 近似色合并是**静默改变用户产出**的行为：用户会发现自己按图买的色号
  // （如 H12）在图纸上根本不存在。必须如实告知**并给出替代色号** ——
  // 只说"H12 没了"而不说"改用 E16"等于没说
  // （CLAUDE.md：用户可感知的输出必须落在用户看得见的地方）。
  if (state.mergedColors && state.mergedColors.length) {
    const list = state.mergedColors.map((m) => `${m.from}→${m.to}`).join('、');
    previewInfo.textContent += ` · 已合并近似色：${list}`;
  }
  // 极端比例提示：与预览信息同处，用户一眼能看到（见 REVIEW.md M9）
  previewInfo.classList.toggle('preview-warning', !!state.aspectWarning);
  if (state.aspectWarning) {
    previewInfo.textContent += ` ⚠️ ${state.aspectWarning}`;
  }
}
