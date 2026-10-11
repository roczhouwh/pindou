// ============================================================
// js/output/export.js — PNG 导出与分享
// ============================================================
// 自 app.js 的「8. PNG 下载」函数群搬迁而来（REFACTOR §7.1 步骤 5）。
//
// ⚠️ **自适应倍率**是 C2 的根治手段，不要改回固定 2x：
//    期望 MAX_EXPORT_DPR=2，若超出设备上限（>16.78MP 或单边 >4096）自动降到 1x。
//    实测 29/52 → 2x，78/104 → 1x（此前 78/104 完全导不出）。
//    降档会如实写在 #previewInfo 上，**不静默**。
//
// ⚠️ `computeDownloadSize()` 里标尺边距必须**同时**进入 canvasW/canvasH 与 gridY ——
//    只进其一会出现"标尺画不下"或"与预检漂移"（REFACTOR §4.2 硬约束 1）。
//
// ⚠️ 失败提示必须用 `showToast`（全局 toast），**不能用 `showError`** ——
//    后者写进 #uploadError，而 showViewer() 已把 #uploadSection 隐藏，消息会静默丢失。
//
// 当前阶段仍用裸 <script> src 加载（步骤 0 未做），故本文件不使用 import/export。
// ============================================================

// ---- 按钮装配（随函数群一起搬迁；**不要漏**）----
// ⚠️ 这两行曾在搬迁中被漏掉：它们原本夹在「8. PNG 下载」段的函数之间，
//    只搬"函数群"而把这段装配代码留在原地，就表现为"点下载没反应"
//    （toBlob 从不回调、toast 也不出现）。见 test-export.js 的 4 档下载断言。
downloadBtn.addEventListener('click', () => {
  if (!state.gridData) return;
  downloadPNG();
});

// 分享按钮
shareBtn.addEventListener('click', () => {
  if (!state.gridData) return;
  sharePNG();
});

function sharePNG() {
  if (!state.gridData) return;
  const grid = state.gridData;
  const rows = grid.length;
  const cols = grid[0].length;

  // 预检放在渲染之前；与 downloadPNG 走同一套尺寸判定（见 REVIEW.md C2）
  if (!checkExportSize(cols, rows)) return;
  // 再渲染下载画布，供分享使用
  renderDownloadCanvas();

  downloadCanvas.toBlob((blob) => {
    if (!blob) {
      showToast('导出画布过大，无法生成 PNG，请改用较小的网格尺寸');
      return;
    }
    const file = new File([blob], `拼豆图纸_${cols}x${rows}.png`, { type: 'image/png' });

    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({
        title: '拼豆图纸生成器',
        text: `拼豆图纸 ${cols}×${rows}`,
        files: [file],
      }).catch(() => {});
    } else if (navigator.share) {
      // 不支持文件分享，备选下载
      downloadPNG();
      navigator.share({
        title: '拼豆图纸生成器',
        text: `拼豆图纸 ${cols}×${rows} — 用拼豆图纸生成器制作`,
      }).catch(() => {});
    }
  }, 'image/png');
}

/**
 * 计算下载画布的实际像素尺寸。
 * 抽出来供 renderDownloadCanvas 与 checkExportSize 共用，
 * 避免预检用的尺寸与真实渲染尺寸各自演算而漂移（见 REVIEW.md C2）。
 *
 * 倍率自适应：先按期望倍率算，若超出设备上限（面积 or 单边）则逐级下调。
 * 这是 C2 的根治手段 —— 此前 78/104 只能"拦截 + 提示"，
 * 现在改为降到设备能承受的倍率后**照样导出**，用户不再被拒绝服务。
 */
function computeDownloadSize() {
  const rows = state.gridData.length;
  const cols = state.gridData[0].length;

  // 按网格宽高比计算单元格尺寸，避免图纸被拉伸（1x 基准）
  const gridAspect = cols / rows;
  const baseCell = 28; // 较短边 28px
  let cellW, cellH;
  if (gridAspect >= 1) {
    cellH = baseCell;
    cellW = Math.round(baseCell * gridAspect);
  } else {
    cellW = baseCell;
    cellH = Math.round(baseCell / gridAspect);
  }

  const padding = 16;
  const titleHeight = 40;
  const legendItemHeight = 28;
  const legendPadding = 16;

  // 行列标尺边距（关闭时为 0 → 与改动前逐像素一致）。
  // ⚠️ 它同时进入 canvasW/canvasH，因此 **dpr 判定与预检都自动跟着走**，
  // 不需要在 checkExportSize 里再补一次（那会造成"预检与实际渲染漂移"，见 REVIEW.md C2）。
  // 实测四档：29/52 仍 2x，78/104 仍 1x —— 边距没有把任何一档挤下 4096 单边或 16.78MP。
  const ruler = state.rulerEnabled ? rulerMetrics(cellW, cellH) : null;
  const gutter = ruler ? ruler.margin : 0;

  // 标题占位 + 边距：网格本体下移 gutter 给列号让位
  const gridY = padding + titleHeight + gutter;
  const legendTop = gridY + rows * cellH + padding;

  const legendCols = 5;
  const legendRows = Math.ceil((state.colorCounts ? state.colorCounts.length : 0) / legendCols);
  const legendW = padding * 2 + legendCols * 180;

  // 网格居中（与原实现一致）：故左右各得 (canvasW - cols*cellW)/2，
  // 该值 ≥ gutter/2 + padding > gutter，标尺画得下且左右对称。
  const canvasW = Math.max(cols * cellW + padding * 2 + gutter, legendW);
  const canvasH = legendTop + legendPadding + legendRows * legendItemHeight + padding;

  const dpr = pickExportDpr(canvasW, canvasH);

  return { canvasW, canvasH, cellW, cellH, dpr, padding, titleHeight, legendItemHeight, legendPadding, legendTop, legendRows, legendW, legendCols, rows, cols, gutter, ruler, gridY };
}

/**
 * 挑选本设备能承受的最大导出倍率。
 * 同时受两个约束（见 PLAN §3.2）：**总像素 ≤ 16.78MP** 与 **单边 ≤ 4096**。
 * 取 1/2 的整数档（2 → 1），保证 PNG 尺寸是整数、不会出现半像素模糊。
 * 返回 1 是下限：1x 下最大网格（104×104）约 9.6MP，仍在预算内，
 * 因此**不存在"只能拒绝导出"的档位**。
 */
function pickExportDpr(canvasW, canvasH) {
  for (let dpr = MAX_EXPORT_DPR; dpr > 1; dpr /= 2) {
    const w = canvasW * dpr;
    const h = canvasH * dpr;
    const mp = (w * h) / 1e6;
    if (mp <= MAX_EXPORT_MP && w <= MAX_EXPORT_SIDE && h <= MAX_EXPORT_SIDE) {
      return dpr;
    }
  }
  return 1;
}

/**
 * 导出前的尺寸预检。
 *
 * **行为变更（C2 根治）**：此前这里在超限时**拦截导出**并提示"改用更小尺寸"，
 * 用户被拒绝服务。现在倍率由 `pickExportDpr()` 自动下调到设备能承受的档位，
 * 所以此处**只在极端情况下兜底**：若连 1x 都超限（当前网格上限 104×104 下不可达，
 * 属纯防御），才拒绝并给出可操作提示。
 *
 * 返回 true 表示可以继续导出。
 */
function checkExportSize(cols, rows) {
  const { canvasW, canvasH, dpr } = computeDownloadSize();
  const w = canvasW * dpr;
  const h = canvasH * dpr;
  const mp = (w * h) / 1e6;

  if (mp > MAX_EXPORT_MP || w > MAX_EXPORT_SIDE || h > MAX_EXPORT_SIDE) {
    showToast(
      `${cols}×${rows} 的图纸需要 ${Math.round(w)}×${Math.round(h)} 像素（约 ${mp.toFixed(1)}MP），` +
      `超出本设备浏览器上限（约 ${MAX_EXPORT_MP}MP / 单边 ${MAX_EXPORT_SIDE}px），无法导出。` +
      `请改用更小的网格尺寸。`
    );
    return false;
  }
  return true;
}

/**
 * 导出倍率的用户可读描述。
 * 降过倍率时**必须在界面上如实说明**（而不是静默降清晰度），
 * 所以渲染在常驻的 #previewInfo 里，不占用 toast。
 */
function exportScaleNote() {
  if (!state.gridData) return '';
  const { canvasW, canvasH, dpr } = computeDownloadSize();
  const mp = (canvasW * dpr * canvasH * dpr) / 1e6;
  const px = `${Math.round(canvasW * dpr)}×${Math.round(canvasH * dpr)}`;
  if (dpr < MAX_EXPORT_DPR) {
    return ` · 导出 ${dpr}x（${px}，约 ${mp.toFixed(1)}MP，已为保证导出成功降档）`;
  }
  return ` · 导出 ${dpr}x（${px}）`;
}

/** 渲染下载用画布（网格 + 标题 + 图例），downloadPNG 和 sharePNG 共用 */
function renderDownloadCanvas() {
  const grid = state.gridData;
  const {
    canvasW, canvasH, cellW, cellH, dpr, padding, titleHeight,
    legendItemHeight, legendPadding, legendTop, legendCols, rows, cols,
    gutter, ruler, gridY,
  } = computeDownloadSize();

  downloadCanvas.width = canvasW * dpr;
  downloadCanvas.height = canvasH * dpr;

  const ctx = downloadCanvas.getContext('2d');
  ctx.scale(dpr, dpr);

  // 白色背景
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvasW, canvasH);

  // 图纸标题
  ctx.fillStyle = '#1A1A1A';
  ctx.font = `bold 20px ${FONT_STACK}`;
  ctx.textAlign = 'center';
  ctx.fillText(`拼豆图纸 ${cols}×${rows}`, canvasW / 2, padding + 28);

  // 绘制网格。gridY 由 computeDownloadSize 给出（已含标尺边距），
  // 与预检/尺寸计算**共用同一个来源**，不会漂移。
  const gridX = (canvasW - cols * cellW) / 2;

  // 网格绘制（填色 + 网格线 + 色号）走共用实现。
  // 导出的差异项：**不画**空格斜线、网格线 0.25、色号总是画、字号取整
  drawGrid(ctx, grid, {
    x: gridX,
    y: gridY,
    cellW,
    cellH,
    gridLineColor: 'rgba(0,0,0,0.25)',
    hatchEmptyCells: false,     // ⚠️ 预览画斜线、导出不画（§3.2 #3 定调：保持差异）
    textMinCell: null,          // null = 不受阈值限制，总是画色号
    roundFontSize: true,
  });

  // 行列标尺（与预览共用 drawRuler，不另写一份绘制循环）
  if (ruler) {
    drawRuler(ctx, {
      x: gridX, y: gridY, cellW, cellH, rows, cols,
      margin: gutter, step: ruler.step, majorStep: ruler.majorStep,
      fontSize: ruler.fontSize,
      lineColor: 'rgba(0,0,0,0.45)',
      textColor: '#333333',
    });
  }

  // 图例
  const legendStartY = legendTop;
  ctx.fillStyle = '#1A1A1A';
  ctx.font = `bold 16px ${FONT_STACK}`;
  ctx.textAlign = 'left';
  ctx.fillText('颜色对照表', padding, legendStartY - 8);

  const legendItems = state.colorCounts;
  const itemW = (canvasW - padding * 2) / legendCols;

  for (let i = 0; i < legendItems.length; i++) {
    const c = legendItems[i];
    const col = i % legendCols;
    const lrow = Math.floor(i / legendCols);
    const lx = padding + col * itemW;
    const ly = legendStartY + legendPadding + lrow * legendItemHeight;

    // 色块
    ctx.fillStyle = c.hex;
    ctx.fillRect(lx, ly, 20, 20);
    ctx.strokeStyle = 'rgba(0,0,0,0.2)';
    ctx.lineWidth = 1;
    ctx.strokeRect(lx, ly, 20, 20);

    // 文字
    ctx.fillStyle = '#1A1A1A';
    ctx.font = `12px ${FONT_STACK}`;
    ctx.textAlign = 'left';
    ctx.fillText(`${c.name} ×${c.count}`, lx + 28, ly + 15);
  }
}

function downloadPNG() {
  if (!state.gridData) return;
  const cols = state.gridData[0].length;
  const rows = state.gridData.length;

  // 预检放在渲染之前：超限时不必先分配一块用不了的画布（见 REVIEW.md C2）
  if (!checkExportSize(cols, rows)) return;
  renderDownloadCanvas();

  // iOS Safari 不支持 blob URL 的 <a download>，改为新窗口打开让用户长按保存。
  // 必须在用户手势的调用栈内同步开窗 —— toBlob 回调是异步的，
  // 在那里 window.open 会被弹窗拦截（见 REVIEW.md C2）。
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const iosWindow = isIOS ? window.open('', '_blank') : null;
  if (isIOS && !iosWindow) {
    showToast('浏览器拦截了新窗口，请允许弹窗后重试下载');
    return;
  }

  // 触发下载
  downloadCanvas.toBlob((blob) => {
    if (!blob) {
      if (iosWindow) iosWindow.close();
      // 走到这里说明即使降档后设备仍拒绝出图（内存紧张等）。
      // 提示要给出**下一步动作**，不能只说"失败了"（见 REVIEW.md C2）
      showToast(
        '设备未能生成 PNG（可能是内存不足）。请关闭其它标签页后重试，' +
        '或改用更小的网格尺寸。'
      );
      return;
    }
    const url = URL.createObjectURL(blob);
    if (isIOS) {
      // 占位窗口已同步打开，这里只需把地址指过去
      iosWindow.location.href = url;
      // URL 稍后释放，给浏览器加载的时间
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      return;
    }
    const a = document.createElement('a');
    a.href = url;
    a.download = `拼豆图纸_${cols}x${rows}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 'image/png');
}
