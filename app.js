// ============================================================
// 拼豆图纸生成器 — 主逻辑
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
const selectionOverlay = $('#selectionOverlay');
const selectionBox = $('#selectionBox');
const viewerHint = $('#viewerHint');
const viewerHint2 = $('#viewerHint2');
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

// ----- 状态 -----
const state = {
  image: null,
  imageW: 0,
  imageH: 0,
  zoom: 1,
  panX: 0,
  panY: 0,
  // 选框 (百分比, 0-1)
  selection: { x: 0.15, y: 0.15, w: 0.7, h: 0.7 },
  // 网格尺寸
  gridW: 29,
  gridH: 29,
  // 生成的网格数据
  gridData: null,
  colorCounts: null,
  // 拖拽状态
  isDragging: false,
  isResizing: false,
  isPanning: false,
  dragStart: { x: 0, y: 0 },
  dragHandle: null,
  dragSelection: null,
  panStart: { x: 0, y: 0 },
};

// ----- 初始化 -----
const viewerCtx = viewerCanvas.getContext('2d');

// ============================================================
// 1. 图片上传
// ============================================================

uploadZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => {
  if (e.target.files.length > 0) handleFile(e.target.files[0]);
});

uploadZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadZone.classList.add('dragover');
});
uploadZone.addEventListener('dragleave', () => {
  uploadZone.classList.remove('dragover');
});
uploadZone.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadZone.classList.remove('dragover');
  if (e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]);
});

function handleFile(file) {
  uploadError.hidden = true;

  // 格式验证
  const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!validTypes.includes(file.type)) {
    showError('不支持的文件格式，请上传 JPG / PNG / WebP 图片');
    return;
  }

  // 大小验证 (20MB)
  if (file.size > 20 * 1024 * 1024) {
    showError('文件过大，请选择小于 20MB 的图片');
    return;
  }

  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = () => {
      state.image = img;
      state.imageW = img.naturalWidth;
      state.imageH = img.naturalHeight;
      // 默认选框覆盖 70% 区域
      state.selection = { x: 0.15, y: 0.15, w: 0.7, h: 0.7 };
      state.zoom = 1;
      state.panX = 0;
      state.panY = 0;
      state.gridData = null;
      state.colorCounts = null;
      showViewer();
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

function showError(msg) {
  uploadError.textContent = msg;
  uploadError.hidden = false;
}

// ============================================================
// 2. 图片查看器
// ============================================================

function showViewer() {
  uploadSection.hidden = true;
  viewerSection.hidden = false;
  controlsSection.hidden = false;
  previewSection.hidden = true;
  statsSection.hidden = true;
  downloadBtn.disabled = true;
  viewerHint.hidden = false;
  viewerHint2.hidden = false;
  selectionBox.hidden = false;
  resizeViewerCanvas();
  renderViewer();
  updateSelectionBox();
  generateGrid();
}

function resizeViewerCanvas() {
  const rect = viewerWrapper.getBoundingClientRect();
  viewerCanvas.width = rect.width;
  viewerCanvas.height = rect.height;
  viewerCanvas.style.width = rect.width + 'px';
  viewerCanvas.style.height = rect.height + 'px';
}

function renderViewer() {
  if (!state.image) return;
  const w = viewerCanvas.width;
  const h = viewerCanvas.height;
  const ctx = viewerCtx;
  ctx.clearRect(0, 0, w, h);

  // 计算图片缩放以填充画布
  const imgAspect = state.imageW / state.imageH;
  const canvasAspect = w / h;
  let drawW, drawH;
  if (imgAspect > canvasAspect) {
    drawW = w;
    drawH = w / imgAspect;
  } else {
    drawH = h;
    drawW = h * imgAspect;
  }

  // 应用 zoom 和 pan
  const cx = w / 2 + state.panX;
  const cy = h / 2 + state.panY;
  const scaledW = drawW * state.zoom;
  const scaledH = drawH * state.zoom;
  const x = cx - scaledW / 2;
  const y = cy - scaledH / 2;

  ctx.drawImage(state.image, x, y, scaledW, scaledH);
}

function getImageCoords(clientX, clientY) {
  const rect = viewerWrapper.getBoundingClientRect();
  const mx = clientX - rect.left;
  const my = clientY - rect.top;

  const w = rect.width;
  const h = rect.height;
  const imgAspect = state.imageW / state.imageH;
  const canvasAspect = w / h;
  let drawW, drawH;
  if (imgAspect > canvasAspect) {
    drawW = w;
    drawH = w / imgAspect;
  } else {
    drawH = h;
    drawW = h * imgAspect;
  }

  const cx = w / 2 + state.panX;
  const cy = h / 2 + state.panY;
  const scaledW = drawW * state.zoom;
  const scaledH = drawH * state.zoom;
  const imgX = cx - scaledW / 2;
  const imgY = cy - scaledH / 2;

  // 图片坐标 (0-1 归一化)
  const ix = (mx - imgX) / scaledW;
  const iy = (my - imgY) / scaledH;
  return { ix, iy, inImage: ix >= 0 && ix <= 1 && iy >= 0 && iy <= 1 };
}

// ============================================================
// 3. 矩形选框
// ============================================================

function updateSelectionBox() {
  const sel = state.selection;
  const rect = viewerWrapper.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;
  const imgAspect = state.imageW / state.imageH;
  const canvasAspect = w / h;
  let drawW, drawH;
  if (imgAspect > canvasAspect) {
    drawW = w;
    drawH = w / imgAspect;
  } else {
    drawH = h;
    drawW = h * imgAspect;
  }

  const cx = w / 2 + state.panX;
  const cy = h / 2 + state.panY;
  const scaledW = drawW * state.zoom;
  const scaledH = drawH * state.zoom;
  const imgX = cx - scaledW / 2;
  const imgY = cy - scaledH / 2;

  selectionBox.style.left = (imgX + sel.x * scaledW) + 'px';
  selectionBox.style.top = (imgY + sel.y * scaledH) + 'px';
  selectionBox.style.width = (sel.w * scaledW) + 'px';
  selectionBox.style.height = (sel.h * scaledH) + 'px';
}

// 选框绘制（在 viewer 上开始拖拽）
viewerWrapper.addEventListener('pointerdown', (e) => {
  if (e.button === 2) return; // 右键留给平移
  if (e.target.classList.contains('handle')) return; // 手柄拖拽

  const coords = getImageCoords(e.clientX, e.clientY);
  if (!coords.inImage) return;

  // 检查是否点击在选框内（用于移动选框）
  const sel = state.selection;
  const { ix, iy } = coords;
  const inside = ix >= sel.x && ix <= sel.x + sel.w && iy >= sel.y && iy <= sel.y + sel.h;

  if (inside) {
    // 移动选框
    state.isDragging = true;
    state.dragStart = { ix, iy };
    state.dragSelection = { ...sel };
    viewerWrapper.setPointerCapture(e.pointerId);
  } else {
    // 开始新的框选
    state.isDragging = true;
    state.dragStart = { ix, iy };
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
    const ds = state.dragStart;

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
    updateSelectionBox();
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
    updateSelectionBox();
  }

  if (state.isPanning) {
    state.panX = state.panStart.x + (e.clientX - state.dragStart.x);
    state.panY = state.panStart.y + (e.clientY - state.dragStart.y);
    renderViewer();
    updateSelectionBox();
  }
});

document.addEventListener('pointerup', (e) => {
  if (state.isDragging || state.isResizing) {
    state.isDragging = false;
    state.isResizing = false;
    state.dragHandle = null;
    viewerHint.hidden = true;
    viewerHint2.hidden = true;
    generateGrid();
  }
  if (state.isPanning) {
    state.isPanning = false;
    viewerWrapper.classList.remove('panning');
  }
});

// 右键拖拽平移
viewerWrapper.addEventListener('contextmenu', (e) => e.preventDefault());
viewerWrapper.addEventListener('pointerdown', (e) => {
  if (e.button === 2) {
    state.isPanning = true;
    state.panStart = { x: state.panX, y: state.panY };
    state.dragStart = { x: e.clientX, y: e.clientY };
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

// 窗口大小调整
window.addEventListener('resize', () => {
  if (state.image) {
    resizeViewerCanvas();
    renderViewer();
    updateSelectionBox();
  }
});

// ============================================================
// 4. 网格尺寸选择
// ============================================================

$$('.grid-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    $$('.grid-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.gridW = parseInt(btn.dataset.w);
    state.gridH = parseInt(btn.dataset.h);
    customW.value = '';
    customH.value = '';
    generateGrid();
  });
});

applyCustom.addEventListener('click', () => {
  const w = parseInt(customW.value);
  const h = parseInt(customH.value);
  if (w >= 15 && w <= 104 && h >= 15 && h <= 104) {
    state.gridW = w;
    state.gridH = h;
    $$('.grid-btn').forEach((b) => b.classList.remove('active'));
    generateGrid();
  }
});

// ============================================================
// 5. 网格生成 + 色板映射
// ============================================================

function generateGrid() {
  if (!state.image) return;

  const { x, y, w, h } = state.selection;
  const gw = state.gridW;
  const gh = state.gridH;

  // 创建离屏 canvas 用于采样
  const offCtx = offscreenCanvas.getContext('2d');
  offscreenCanvas.width = state.imageW;
  offscreenCanvas.height = state.imageH;
  offCtx.drawImage(state.image, 0, 0);

  // 采样像素
  const selX = Math.floor(x * state.imageW);
  const selY = Math.floor(y * state.imageH);
  const selW = Math.floor(w * state.imageW);
  const selH = Math.floor(h * state.imageH);

  const cellW = selW / gw;
  const cellH = selH / gh;

  const grid = [];
  const colorMap = new Map();

  for (let row = 0; row < gh; row++) {
    grid[row] = [];
    for (let col = 0; col < gw; col++) {
      // 采样单元格中心区域
      const cx = selX + (col + 0.5) * cellW;
      const cy = selY + (row + 0.5) * cellH;
      const sampleW = Math.max(2, Math.floor(cellW * 0.5));
      const sampleH = Math.max(2, Math.floor(cellH * 0.5));

      const imageData = offCtx.getImageData(
        Math.max(0, Math.floor(cx - sampleW / 2)),
        Math.max(0, Math.floor(cy - sampleH / 2)),
        Math.min(sampleW, state.imageW - Math.floor(cx - sampleW / 2)),
        Math.min(sampleH, state.imageH - Math.floor(cy - sampleH / 2))
      );

      // 平均色
      let r = 0, g = 0, b = 0, count = 0;
      for (let i = 0; i < imageData.data.length; i += 4) {
        r += imageData.data[i];
        g += imageData.data[i + 1];
        b += imageData.data[i + 2];
        count++;
      }

      const avg = { r: Math.round(r / count), g: Math.round(g / count), b: Math.round(b / count) };
      const nearest = findNearestColor(avg);
      grid[row][col] = nearest;

      // 统计
      const key = nearest.hex;
      if (!colorMap.has(key)) {
        colorMap.set(key, { ...nearest, count: 0 });
      }
      colorMap.get(key).count++;
    }
  }

  state.gridData = grid;
  state.colorCounts = Array.from(colorMap.values()).sort((a, b) => b.count - a.count);

  renderPreview();
  renderStats();
  downloadBtn.disabled = false;
}

// ============================================================
// 6. 图纸预览
// ============================================================

function renderPreview() {
  if (!state.gridData) return;
  previewSection.hidden = false;

  const grid = state.gridData;
  const rows = grid.length;
  const cols = grid[0].length;
  const cellSize = Math.max(10, Math.floor(720 / Math.max(rows, cols)));
  const dpr = window.devicePixelRatio || 1;
  const padding = 4;

  const canvasW = cols * cellSize + padding * 2;
  const canvasH = rows * cellSize + padding * 2;

  previewCanvas.width = canvasW * dpr;
  previewCanvas.height = canvasH * dpr;
  previewCanvas.style.width = canvasW + 'px';
  previewCanvas.style.height = canvasH + 'px';

  const ctx = previewCanvas.getContext('2d');
  ctx.scale(dpr, dpr);

  // 背景
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvasW, canvasH);

  // 第一遍：填充所有格子
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      ctx.fillStyle = grid[row][col].hex;
      ctx.fillRect(padding + col * cellSize, padding + row * cellSize, cellSize, cellSize);
    }
  }
  // 第二遍：统一绘制网格线（避免同色格子覆盖边框）
  ctx.strokeStyle = 'rgba(0,0,0,0.15)';
  ctx.lineWidth = 0.5;
  for (let row = 0; row <= rows; row++) {
    ctx.beginPath();
    ctx.moveTo(padding, padding + row * cellSize);
    ctx.lineTo(padding + cols * cellSize, padding + row * cellSize);
    ctx.stroke();
  }
  for (let col = 0; col <= cols; col++) {
    ctx.beginPath();
    ctx.moveTo(padding + col * cellSize, padding);
    ctx.lineTo(padding + col * cellSize, padding + rows * cellSize);
    ctx.stroke();
  }

  // 第三遍：绘制色号文字（深色格子白字，浅色格子黑字）
  const minCellForText = 10;
  if (cellSize >= minCellForText) {
    const fontSize = Math.max(5, cellSize * 0.35);
    ctx.font = `${fontSize}px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const c = grid[row][col];
        const cx = padding + col * cellSize + cellSize / 2;
        const cy = padding + row * cellSize + cellSize / 2;
        const lum = (c.r * 0.299 + c.g * 0.587 + c.b * 0.114) / 255;
        ctx.fillStyle = lum > 0.5 ? '#000000' : '#FFFFFF';
        ctx.fillText(c.name, cx, cy);
      }
    }
  }

  previewInfo.textContent = `${cols}×${rows} 网格 · ${cellSize}px/格`;
}

// ============================================================
// 7. 颜色统计
// ============================================================

function renderStats() {
  if (!state.colorCounts) return;
  statsSection.hidden = false;

  let html = '';
  let total = 0;
  for (const c of state.colorCounts) {
    html += `
      <tr>
        <td><span class="color-swatch" style="background:${c.hex};"></span></td>
        <td><span class="color-name">${c.name}</span></td>
        <td><span class="color-hex">${c.hex}</span></td>
        <td><span class="color-count">${c.count}</span></td>
      </tr>`;
    total += c.count;
  }

  statsBody.innerHTML = html;
  statsFoot.innerHTML = `
    <tr>
      <td colspan="3">总计</td>
      <td><span class="color-count">${total} 颗</span></td>
    </tr>`;
}

// ============================================================
// 8. PNG 下载
// ============================================================

downloadBtn.addEventListener('click', () => {
  if (!state.gridData) return;
  downloadPNG();
});

function downloadPNG() {
  const grid = state.gridData;
  const rows = grid.length;
  const cols = grid[0].length;
  const cellSize = 28; // 下载时每个格子 28px（足够显示色号）
  const dpr = 2; // 2x 高清
  const padding = 16;
  const titleHeight = 40;
  const legendItemHeight = 28;
  const legendPadding = 16;
  const legendTop = rows * cellSize + padding * 2 + titleHeight;

  const legendCols = 5;
  const legendRows = Math.ceil(state.colorCounts.length / legendCols);
  const legendW = padding * 2 + legendCols * 180;

  const canvasW = Math.max(cols * cellSize + padding * 2, legendW);
  const canvasH = legendTop + legendPadding + legendRows * legendItemHeight + padding;

  downloadCanvas.width = canvasW * dpr;
  downloadCanvas.height = canvasH * dpr;

  const ctx = downloadCanvas.getContext('2d');
  ctx.scale(dpr, dpr);

  // 白色背景
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvasW, canvasH);

  // 图纸标题
  ctx.fillStyle = '#1A1A1A';
  ctx.font = 'bold 20px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`拼豆图纸 ${cols}×${rows}`, canvasW / 2, padding + 28);

  // 绘制网格
  const gridX = (canvasW - cols * cellSize) / 2;
  const gridY = padding + titleHeight;

  // 第一遍：填充所有格子
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      ctx.fillStyle = grid[row][col].hex;
      ctx.fillRect(gridX + col * cellSize, gridY + row * cellSize, cellSize, cellSize);
    }
  }
  // 第二遍：统一绘制网格线
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 0.5;
  for (let row = 0; row <= rows; row++) {
    ctx.beginPath();
    ctx.moveTo(gridX, gridY + row * cellSize);
    ctx.lineTo(gridX + cols * cellSize, gridY + row * cellSize);
    ctx.stroke();
  }
  for (let col = 0; col <= cols; col++) {
    ctx.beginPath();
    ctx.moveTo(gridX + col * cellSize, gridY);
    ctx.lineTo(gridX + col * cellSize, gridY + rows * cellSize);
    ctx.stroke();
  }

  // 第三遍：绘制色号文字
  const fontSize = 7;
  ctx.font = `${fontSize}px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const c = grid[row][col];
      const cx = gridX + col * cellSize + cellSize / 2;
      const cy = gridY + row * cellSize + cellSize / 2;
      const lum = (c.r * 0.299 + c.g * 0.587 + c.b * 0.114) / 255;
      ctx.fillStyle = lum > 0.5 ? '#000000' : '#FFFFFF';
      ctx.fillText(c.name, cx, cy);
    }
  }

  // 图例
  const legendStartY = legendTop;
  ctx.fillStyle = '#1A1A1A';
  ctx.font = 'bold 16px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
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
    ctx.font = '12px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${c.name} ×${c.count}`, lx + 28, ly + 15);
  }

  // 触发下载
  downloadCanvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `拼豆图纸_${cols}x${rows}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 'image/png');
}

// ============================================================
// 工具函数
// ============================================================

// 重新上传
$('#resetBtn').addEventListener('click', () => {
  state.image = null;
  state.gridData = null;
  state.colorCounts = null;
  uploadSection.hidden = false;
  viewerSection.hidden = true;
  controlsSection.hidden = true;
  previewSection.hidden = true;
  statsSection.hidden = true;
  downloadBtn.disabled = true;
  fileInput.value = '';
});

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}