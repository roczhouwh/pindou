// ============================================================
// js/output/preview.js — 图纸预览渲染
// ============================================================
// 自 app.js 的「6. 图纸预览」整段搬迁而来（REFACTOR §7.1 步骤 5）。
//
// ⚠️ `fitPreviewGrid()` 的**迭代收敛**不要"优化"成一次估算：
//    标尺边距是格子尺寸的函数，用"缩放前的边距"估算会溢出容器（实测 1~7px）。
//    MIN_SCALE=0.35 是既有产品决策（极窄屏宁可横向滚动），不是缺陷。
//
// 当前阶段仍用裸 <script> src 加载（步骤 0 未做），故本文件不使用 import/export。
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
function fitPreviewGrid(baseW, baseH, cols, rows, maxW, padding, useRuler) {
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

function renderPreview() {
  if (!state.gridData) return;
  previewSection.hidden = false;

  const grid = state.gridData;
  const rows = grid.length;
  const cols = grid[0].length;

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
  const previewContainer = previewCanvas.parentElement;
  const maxContainerW = previewContainer.clientWidth - 16; // 减去 padding 8px×2
  const padding = 4;
  const { drawW, drawH } = fitPreviewGrid(
    baseW, baseH, cols, rows, maxContainerW, padding, state.rulerEnabled,
  );

  // 单元格尺寸（长方形，保持网格真实比例）
  const cellW = drawW / cols;
  const cellH = drawH / rows;

  const dpr = window.devicePixelRatio || 1;

  // 标尺边距（最终值，按适配后的格子尺寸）
  const ruler = state.rulerEnabled ? rulerMetrics(cellW, cellH) : null;
  const gutter = ruler ? ruler.margin : 0;

  const canvasW = drawW + gutter + padding * 2;
  const canvasH = drawH + gutter + padding * 2;

  previewCanvas.width = canvasW * dpr;
  previewCanvas.height = canvasH * dpr;
  previewCanvas.style.width = canvasW + 'px';
  previewCanvas.style.height = canvasH + 'px';

  const ctx = previewCanvas.getContext('2d');
  ctx.scale(dpr, dpr);

  // 背景
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvasW, canvasH);

  // 网格本体位置：右下方各留出 gutter 给行列号（gutter=0 时与改动前完全一致）
  const gridX = padding + gutter;
  const gridY = padding + gutter;

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
