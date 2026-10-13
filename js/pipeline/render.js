import { $ } from '../core/dom.js';

// ============================================================
// js/pipeline/render.js — 网格绘制（预览与导出共用）
// ============================================================
// 自 app.js 的「5.9 网格绘制」整段搬迁而来（REFACTOR §7.1 步骤 5），
// 偿还 REFACTOR §4.4 记录的**第 2 笔技术债**：
//   rulerMetrics / drawRuler / RULER_* / fitPreviewGrid 此前未按规则 1 落位。
//
// ⚠️ 本模块同时复用 `js/pipeline/render.js` 的既定约定：
//   · drawGrid 的 4 个出口差异（hatchEmptyCells / gridLineColor / textMinCell / roundFontSize）
//     是**刻意保留**的，不要统一（见 drawGrid 的 JSDoc 差异表）；
//   · drawRuler 只画**边距区域**，网格本体仍归 drawGrid —— 不要把两者合并；
//   · rulerMetrics 是纯函数，与 drawRuler 必须同模块（拆开会重现"边距算错→溢出容器"）。
//
// 本文件是原生 ES module（步骤 0 已完成）：依赖由上方 import 显式声明，
// 不再靠"共享全局词法环境"。
// ============================================================
// ============================================================
// 5.9 网格绘制 —— 预览与导出共用
// ============================================================
// 此前「填色 / 网格线 / 色号」三遍循环在 renderPreview 与 renderDownloadCanvas
// 里**各写了一份**（REFACTOR §3.1 重复项 #2、#3）。抽到这里后两处共用同一实现，
// 将来 PLAN 的行列标尺 / A4 打印也复用同一套绘制。

/** 供网格与图例共用的字体栈。原本是 5 处字面量，改字体极易漏改（REFACTOR §3.1 重复项 #5） */
export const FONT_STACK = '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';

/**
 * 行列标尺的**密度阈值**：格子短边 ≥ 此值时每格都标号，否则每 `RULER_STEP` 格标一次。
 *
 * 依据（本机实测）：预览最长边 720px，故短边随网格尺寸衰减 ——
 * 29×29 约 24.8px、52×52 约 13.8px、78×78 约 9.2px、104×104 约 6.9px。
 * 脚注字号取 `max(7, minCell * 0.5)`，13.8px 格下约 6.9px 已是可读下限。
 *
 * `14` 这个取值使 **29×29 走逐格、52×52 及以上走每 5 格**
 * （可用 `.pindou-devtools/probe-ruler.js` 复现该分档表）。
 */
export const RULER_DENSE_MIN_CELL = 14;
/** 稀疏模式下的标注间隔（格）。每 5 格标一次，配合每 10 格的加粗参考线即可数清任何位置 */
export const RULER_STEP = 5;
/** 加粗参考线的间隔（格）。十进制，与人类数数习惯一致 */
export const RULER_MAJOR_STEP = 10;

/**
 * 依格子尺寸决定标尺的绘制参数。**纯函数**，便于测试直接复用（不重算一遍规则）。
 *
 * @param {number} cellW 单元格宽（CSS px）
 * @param {number} cellH 单元格高（CSS px）
 * @returns {{step:number, majorStep:number, dense:boolean, fontSize:number, margin:number}}
 *          `step` 为标注间隔（1 = 逐格）；`margin` 为边距外扩宽度（含线与文字）
 */
export function rulerMetrics(cellW, cellH) {
  const minCell = Math.min(cellW, cellH);
  const dense = minCell >= RULER_DENSE_MIN_CELL;
  const step = dense ? 1 : RULER_STEP;
  // 脚注字号：与 drawGrid 的色号字号同源（0.35 比例），但下限定得更低（7px）——
  // 标尺只是"数格子的辅助"，比色号（信息主体）容许更小。
  const fontSize = Math.max(7, Math.round(minCell * 0.5));
  // 边距 = 文字行高 + 少量留白。取整避免半像素导致的模糊
  const margin = Math.ceil(fontSize * 1.6) + 2;
  return { step, majorStep: RULER_MAJOR_STEP, dense, fontSize, margin };
}

/**
 * 在网格**外侧**绘制行列号与十进制参考线（PLAN §五 第一批第 3 项「行列标尺」）。
 *
 * ⚠️ 本函数**只画边距区域**，网格本体仍由 `drawGrid()` 绘制 —— 调用方需先把网格
 * 整体下移/右移 `margin`，并把 `margin` 传给本函数作为边距宽度。这样
 * **预览与导出共用同一实现**，不出现"预览有、导出没有"的漂移。
 *
 * 坐标约定：`x`/`y` 是**网格本体**的左上角；标尺画在 `[x - margin, x)` 与
 * `[y - margin, y)` 这条 L 形区域内。
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} opts
 * @param {number} opts.x 网格本体左上角 x
 * @param {number} opts.y 网格本体左上角 y
 * @param {number} opts.cellW 单元格宽
 * @param {number} opts.cellH 单元格高
 * @param {number} opts.rows 行数
 * @param {number} opts.cols 列数
 * @param {number} opts.margin 边距宽度（来自 `rulerMetrics()`）
 * @param {number} opts.step 标注间隔（1 = 逐格）
 * @param {number} opts.majorStep 加粗参考线间隔
 * @param {number} opts.fontSize 脚注字号
 * @param {string} opts.lineColor 参考线颜色
 * @param {string} opts.textColor 脚注文字颜色
 */
export function drawRuler(ctx, opts) {
  const {
    x, y, cellW, cellH, rows, cols, margin, step, majorStep, fontSize,
    lineColor, textColor,
  } = opts;
  const gridW = cols * cellW;
  const gridH = rows * cellH;

  ctx.save();

  // ---- ① 十进制参考线：横贯整个网格，跨页拼接时靠它对齐 ----
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 1;
  for (let col = majorStep; col < cols; col += majorStep) {
    const lx = Math.round(x + col * cellW) + 0.5;   // +0.5 让 1px 线落在像素中心，不发虚
    ctx.beginPath();
    ctx.moveTo(lx, y);
    ctx.lineTo(lx, y + gridH);
    ctx.stroke();
  }
  for (let row = majorStep; row < rows; row += majorStep) {
    const ly = Math.round(y + row * cellH) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, ly);
    ctx.lineTo(x + gridW, ly);
    ctx.stroke();
  }

  // ---- ② 脚注文字：列号在网格上方、行号在网格左侧 ----
  ctx.fillStyle = textColor;
  ctx.font = `${fontSize}px ${FONT_STACK}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const labelY = y - margin / 2;          // 上方边距的垂直中心
  const labelX = x - margin / 2;          // 左侧边距的水平中心

  for (let col = step; col <= cols; col += step) {
    // 标注的是"第几列"，取该列中心；末列标在网格右边缘内收半个格
    const lx = x + (col - 1) * cellW + cellW / 2;
    ctx.fillText(String(col), lx, labelY);
  }
  for (let row = step; row <= rows; row += step) {
    const ly = y + (row - 1) * cellH + cellH / 2;
    ctx.fillText(String(row), labelX, ly);
  }

  ctx.restore();
}

/**
 * 依格子颜色的**相对亮度**选择色号文字颜色，保证对比度。
 * 深色格配白字、浅色格配黑字（原在预览与导出各写一份，数学完全相同）。
 *
 * @param {{r:number,g:number,b:number}} cell 已映射的色板颜色
 * @returns {string} `'#000000'` 或 `'#FFFFFF'`
 */
export function pickTextColor(cell) {
  // Rec.601 亮度权重
  const lum = (cell.r * 0.299 + cell.g * 0.587 + cell.b * 0.114) / 255;
  return lum > 0.5 ? '#000000' : '#FFFFFF';
}

/**
 * 绘制整个网格：① 填色 ② 网格线 ③ 色号。**预览与导出共用**。
 *
 * ⚠️ **两个出口存在 4 处真实差异，必须由 `opts` 参数化保留**
 * （REFACTOR §7.4 步 4、§3.2 #3；"顺手统一"会改变用户可见产出）：
 *
 * | 差异 | 预览 (renderPreview) | 导出 (renderDownloadCanvas) |
 * |---|---|---|
 * | 空格标记 | 画斜线 | **不画** |
 * | 网格线色 | `rgba(0,0,0,0.15)` | `rgba(0,0,0,0.25)`（更清楚，供打印） |
 * | 色号阈值 | 仅当 `minCell ≥ 10` 才画 | **总是画** |
 * | 字号取整 | 保留小数 | `Math.round`（导出倍率下更稳） |
 *
 * 调用方须保证 `ctx` 的变换（如 `ctx.scale(dpr, dpr)`）**已经设置好** ——
 * 本函数所有坐标都是 CSS 像素。
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<Array<{name:string,hex:string,r:number,g:number,b:number}|null>>} grid
 * @param {object} opts
 * @param {number} opts.x 网格左上角 x（CSS px）
 * @param {number} opts.y 网格左上角 y（CSS px）
 * @param {number} opts.cellW 单元格宽
 * @param {number} opts.cellH 单元格高
 * @param {string} opts.gridLineColor 网格线颜色
 * @param {boolean} opts.hatchEmptyCells 是否给空格画斜线（预览 true / 导出 false）
 * @param {number|null} opts.textMinCell 画色号所需的最小格边；`null` = 总是画
 * @param {boolean} opts.roundFontSize 字号是否取整
 */
export function drawGrid(ctx, grid, opts) {
  const { x, y, cellW, cellH, gridLineColor, hatchEmptyCells, textMinCell, roundFontSize } = opts;
  const rows = grid.length;
  const cols = grid[0].length;
  const gridW = cols * cellW;
  const gridH = rows * cellH;

  // ---- 第一遍：填充所有格子（空格子留白）----
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cell = grid[row][col];
      ctx.fillStyle = cell ? cell.hex : '#FFFFFF';
      ctx.fillRect(x + col * cellW, y + row * cellH, cellW, cellH);
    }
  }

  // ---- 空格标记：仅预览画斜线（导出刻意不画，见上方差异表）----
  if (hatchEmptyCells) {
    ctx.strokeStyle = 'rgba(0,0,0,0.1)';
    ctx.lineWidth = 0.5;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (grid[row][col]) continue;
        const hx = x + col * cellW;
        const hy = y + row * cellH;
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.lineTo(hx + cellW, hy + cellH);
        ctx.moveTo(hx + cellW, hy);
        ctx.lineTo(hx, hy + cellH);
        ctx.stroke();
      }
    }
  }

  // ---- 第二遍：统一绘制网格线（后画，避免同色格子盖住边框）----
  ctx.strokeStyle = gridLineColor;
  ctx.lineWidth = 0.5;
  for (let row = 0; row <= rows; row++) {
    ctx.beginPath();
    ctx.moveTo(x, y + row * cellH);
    ctx.lineTo(x + gridW, y + row * cellH);
    ctx.stroke();
  }
  for (let col = 0; col <= cols; col++) {
    ctx.beginPath();
    ctx.moveTo(x + col * cellW, y);
    ctx.lineTo(x + col * cellW, y + gridH);
    ctx.stroke();
  }

  // ---- 第三遍：绘制色号文字（空格子跳过）----
  const minCell = Math.min(cellW, cellH);
  // 阈值只对预览生效（textMinCell=null 时导出总是画色号）
  if (textMinCell !== null && minCell < textMinCell) return;

  const rawFontSize = minCell * 0.35;
  const fontSize = Math.max(5, roundFontSize ? Math.round(rawFontSize) : rawFontSize);
  ctx.font = `${fontSize}px ${FONT_STACK}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const c = grid[row][col];
      if (!c) continue;
      const cx = x + col * cellW + cellW / 2;
      const cy = y + row * cellH + cellH / 2;
      ctx.fillStyle = pickTextColor(c);
      ctx.fillText(c.name, cx, cy);
    }
  }
}
