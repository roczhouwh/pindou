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
const simplifySlider = $('#simplifySlider');
const simplifyValue = $('#simplifyValue');
const cameraInput = $('#cameraInput');
const cameraBtn = $('#cameraBtn');
const shareBtn = $('#shareBtn');
const loadingOverlay = $('#loadingOverlay');
const loadingText = $('#loadingText');
const installBanner = $('#installBanner');
const installBtn = $('#installBtn');
const installClose = $('#installClose');
const viewerHint3 = $('#viewerHint3');

// 触摸设备检测
const isTouchDevice = navigator.maxTouchPoints > 0;

// 导出画布像素上限（MP）。iOS Safari 约 16.78MP（4096²），
// 超过时 toBlob 会静默回 null 导致「点了没反应」（见 REVIEW.md C2）
const MAX_EXPORT_MP = 16.78;

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
  // 颜色简化 0-100, 0=关闭
  simplify: 0,
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
  // 触摸状态
  lastTouchDist: 0,
  lastTouchCenter: { x: 0, y: 0 },
  isPinching: false,
};

// ----- 初始化 -----
const viewerCtx = viewerCanvas.getContext('2d');

// ============================================================
// 1. 图片上传
// ============================================================

uploadZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => {
  if (e.target.files.length > 0) handleFile(e.target.files[0]);
  fileInput.value = ''; // 允许重复选择同一文件
});

$('#galleryBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  fileInput.click();
});

cameraBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  openCamera();
});

// getUserMedia 回退方案：系统相机拍照后的文件处理
cameraInput.addEventListener('change', (e) => {
  if (e.target.files.length > 0) handleFile(e.target.files[0]);
  cameraInput.value = ''; // 允许重复选择同一文件
});

// 通过 getUserMedia 直接调用相机
let cameraStream = null;

function openCamera() {
  // 创建相机覆盖层
  let overlay = document.getElementById('cameraOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'cameraOverlay';
    overlay.className = 'camera-overlay';
    overlay.innerHTML = `
      <div class="camera-viewport">
        <video id="cameraVideo" autoplay playsinline muted></video>
        <div class="camera-toolbar">
          <button class="btn btn-capture" id="cameraCaptureBtn">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <circle cx="12" cy="12" r="7" fill="currentColor"/>
            </svg>
          </button>
          <button class="btn btn-close-camera" id="cameraCloseBtn">✕</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('#cameraCaptureBtn').addEventListener('click', capturePhoto);
    overlay.querySelector('#cameraCloseBtn').addEventListener('click', closeCamera);
  }

  // 启动相机
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
    }).then((stream) => {
      cameraStream = stream;
      const video = document.getElementById('cameraVideo');
      video.srcObject = stream;
      overlay.hidden = false;
    }).catch(() => {
      // getUserMedia 失败，回退到文件输入
      cameraInput.click();
    });
  } else {
    cameraInput.click();
  }
}

function capturePhoto() {
  const video = document.getElementById('cameraVideo');
  if (!video || !video.videoWidth) return;

  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0);

  canvas.toBlob((blob) => {
    if (blob) {
      const file = new File([blob], 'photo.jpg', { type: 'image/jpeg' });
      closeCamera();
      handleFile(file);
    }
  }, 'image/jpeg', 0.92);
}

function closeCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
  }
  const overlay = document.getElementById('cameraOverlay');
  if (overlay) overlay.hidden = true;
}

// 页面被隐藏 / 关闭时必须释放摄像头，否则相机指示灯常亮、
// 且在 iOS 上会一直占用设备（见 REVIEW.md M3）
window.addEventListener('pagehide', closeCamera);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') closeCamera();
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
      state.rawGridData = null;
      state.rawColorCounts = null;
      // 简化强度与网格尺寸必须回到默认，否则新图会沿用上一张图的设置（C1 / m12）
      resetSimplify();
      state.gridW = 29;
      state.gridH = 29;
      $$('.grid-btn').forEach((b) => b.classList.toggle('active', b.dataset.w === '29'));
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
  viewerHint2.hidden = isTouchDevice;
  viewerHint3.hidden = !isTouchDevice;
  selectionBox.classList.add('visible');

  // iOS Safari: hidden→visible 切换后强制同步布局计算
  // 1. 先强制 reflow 确保 getBoundingClientRect 返回有效值
  // 2. 再用 rAF 调度到下一帧，确保渲染管线已提交
  void viewerWrapper.offsetHeight;
  requestAnimationFrame(() => {
    // 再次强制 reflow，防止 iOS Safari 在 rAF 回调中仍未完成布局
    void viewerWrapper.offsetHeight;
    resizeViewerCanvas();
    renderViewer();
    updateSelectionBox();
    generateGrid();
  });
}

function resizeViewerCanvas() {
  const rect = viewerWrapper.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    // iOS Safari 布局未就绪，重试
    requestAnimationFrame(resizeViewerCanvas);
    return;
  }
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
  const imgX = cx - scaledW / 2;
  const imgY = cy - scaledH / 2;

  ctx.drawImage(state.image, imgX, imgY, scaledW, scaledH);

  // 在 canvas 上绘制选框轮廓（双保险，兼容 iOS 14.4 等旧设备 DOM 渲染问题）
  const sel = state.selection;
  if (sel && sel.w > 0 && sel.h > 0) {
    const sx = imgX + sel.x * scaledW;
    const sy = imgY + sel.y * scaledH;
    const sw = sel.w * scaledW;
    const sh = sel.h * scaledH;
    ctx.strokeStyle = '#6366F1';
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(sx, sy, sw, sh);
    ctx.setLineDash([]);
    // 半透明填充
    ctx.fillStyle = 'rgba(99, 102, 241, 0.08)';
    ctx.fillRect(sx, sy, sw, sh);
  }
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
  // 确保选框可见（iOS Safari 可能因渲染延迟导致 class 不生效）
  selectionBox.classList.add('visible');

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
    renderViewer(); // 更新 canvas 上绘制的选框轮廓
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
    renderViewer(); // 更新 canvas 上绘制的选框轮廓
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
    state.isPinching = true;
    state.panStart = { x: state.panX, y: state.panY };
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
    state.zoom = Math.max(0.2, Math.min(5, state.zoom * scale));
    state.lastTouchDist = dist;

    // 双指平移
    const dx = center.x - state.lastTouchCenter.x;
    const dy = center.y - state.lastTouchCenter.y;
    state.panX = state.panStart.x + dx;
    state.panY = state.panStart.y + dy;
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
  const hasW = !isNaN(w) && w >= 15 && w <= 104;
  const hasH = !isNaN(h) && h >= 15 && h <= 104;

  if (!hasW && !hasH) return;
  // 固定网格尺寸：选框内容按比例 fit 进网格，不再调整网格尺寸
  state.gridW = hasW ? w : state.gridW;
  state.gridH = hasH ? h : state.gridH;
  $$('.grid-btn').forEach((b) => b.classList.remove('active'));
  generateGrid();
});

// 颜色简化滑块
simplifySlider.addEventListener('input', () => {
  const val = parseInt(simplifySlider.value);
  state.simplify = val;
  simplifyValue.textContent = val === 0 ? '关闭' : `${val}%`;
  if (state.rawGridData) {
    applySimplify();
    renderPreview();
    renderStats();
  }
});

/**
 * 把简化强度清零，并同步滑块 DOM。
 * 重新上传 / 重置时必须调用：否则新图会被上一张图的强度静默简化，
 * 而滑块 UI 仍显示旧值，用户会误以为是新图本身的色彩问题（见 REVIEW.md C1）。
 */
function resetSimplify() {
  state.simplify = 0;
  simplifySlider.value = 0;
  simplifyValue.textContent = '关闭';
}

// ============================================================
// 5. 网格生成 + 色板映射
// ============================================================
function generateGrid() {
  if (!state.image) return;

  const { x, y, w, h } = state.selection;
  const gw = state.gridW;
  const gh = state.gridH;

  // 创建离屏 canvas 用于采样
  // iOS Safari 对大 canvas 有硬限制（~4096px 或总像素上限），
  // 大图先降采样到最长边 2048 再采样，颜色精度不受影响
  const MAX_OFFSCREEN = 2048;
  let sampleW = state.imageW;
  let sampleH = state.imageH;
  if (Math.max(sampleW, sampleH) > MAX_OFFSCREEN) {
    const scale = MAX_OFFSCREEN / Math.max(sampleW, sampleH);
    sampleW = Math.round(sampleW * scale);
    sampleH = Math.round(sampleH * scale);
  }

  const offCtx = offscreenCanvas.getContext('2d');
  offscreenCanvas.width = sampleW;
  offscreenCanvas.height = sampleH;
  offCtx.drawImage(state.image, 0, 0, sampleW, sampleH);

  // 选框像素坐标
  // 夹取到图片范围内：选框由 UI 拖拽产生，x+w 可能 > 1（拖到右/下缘外），
  // 不夹取会让后面的裁剪宽高算出负数（见 REVIEW.md M10）
  const selX = clamp(Math.floor(x * sampleW), 0, sampleW - 1);
  const selY = clamp(Math.floor(y * sampleH), 0, sampleH - 1);
  const selW = Math.max(1, Math.min(Math.floor(w * sampleW), sampleW - selX));
  const selH = Math.max(1, Math.min(Math.floor(h * sampleH), sampleH - selY));

  // ---- 选框内容完整放入网格（contain），居中，不裁剪 ----
  // 选框宽高比 vs 网格宽高比，计算内容在网格中占据的格数
  // 选框宽于网格时，内容填满宽度，上下留空；高于网格时，填满高度，左右留空
  const selAspect = selW / selH;
  const gridAspect = gw / gh;

  let contentW, contentH, offsetCol, offsetRow;
  if (selAspect >= gridAspect) {
    // 内容填满宽度，上下留空
    contentW = gw;
    contentH = Math.round(gw / selAspect);
    contentH = Math.max(1, Math.min(gh, contentH));
    offsetCol = 0;
    offsetRow = Math.floor((gh - contentH) / 2);
  } else {
    // 内容填满高度，左右留空
    contentH = gh;
    contentW = Math.round(gh * selAspect);
    contentW = Math.max(1, Math.min(gw, contentW));
    offsetCol = Math.floor((gw - contentW) / 2);
    offsetRow = 0;
  }

  // 每个内容格对应选框的像素尺寸（contentW/gw = contentH/gh = selAspect，格子为正方形）
  const cellSampW = selW / contentW;
  const cellSampH = selH / contentH;

  const grid = [];
  const colorMap = new Map();

  for (let row = 0; row < gh; row++) {
    grid[row] = [];
    for (let col = 0; col < gw; col++) {
      // 判断是否在内容区域内，不在则留空
      if (row < offsetRow || row >= offsetRow + contentH ||
          col < offsetCol || col >= offsetCol + contentW) {
        grid[row][col] = null;
        continue;
      }

      // 映射到选框内的像素坐标
      const contentRow = row - offsetRow;
      const contentCol = col - offsetCol;

      // 每格采样区 = 该格在选框内占据的完整矩形，相邻格首尾相接。
      // 旧实现用「中心点 ± 半格窗口」，窗口边长只有 cellSamp*0.5，
      // 导致相邻窗口之间空出半格宽的缝（见 REVIEW.md M11）：
      // 实测 512→29 时整行 54.7% 的像素从未被采样，且缝隙随列号周期漂移，
      // 等效固定相位梳状降采样，细纹理图会产生规律性串色。
      // 改为按格边界取整，并保证 [x0, x1) 至少 1px、不超出画布。
      let x0 = selX + Math.floor(contentCol * cellSampW);
      let x1 = selX + Math.floor((contentCol + 1) * cellSampW);
      let y0 = selY + Math.floor(contentRow * cellSampH);
      let y1 = selY + Math.floor((contentRow + 1) * cellSampH);

      x0 = clamp(x0, 0, sampleW - 1);
      x1 = clamp(x1, x0 + 1, sampleW);
      y0 = clamp(y0, 0, sampleH - 1);
      y1 = clamp(y1, y0 + 1, sampleH);

      const imageData = offCtx.getImageData(x0, y0, x1 - x0, y1 - y0);

      // 平均色
      let r = 0, g = 0, b = 0, count = 0;
      for (let i = 0; i < imageData.data.length; i += 4) {
        const alpha = imageData.data[i + 3];
        if (alpha < 128) continue; // 透明/半透明像素跳过
        r += imageData.data[i];
        g += imageData.data[i + 1];
        b += imageData.data[i + 2];
        count++;
      }

      if (count === 0) {
        // 整格全透明，标记为空
        grid[row][col] = null;
      } else {
        const avg = { r: Math.round(r / count), g: Math.round(g / count), b: Math.round(b / count) };
        const nearest = findNearestColor(avg);
        grid[row][col] = nearest;

        // 统计（空格不计入）
        const key = nearest.hex;
        if (!colorMap.has(key)) {
          colorMap.set(key, { ...nearest, count: 0 });
        }
        colorMap.get(key).count++;
      }
    }
  }

  // 保存原始映射数据（颜色简化用）
  state.rawGridData = grid.map(r => r.map(c => c ? { ...c } : null));
  // 与 rebuildColorCounts 一致地按数量降序：否则 simplify=0 与 simplify>0
  // 两条路径给出的统计表顺序不同，拖动滑块会看到表格重排（见 REVIEW.md M1）
  state.rawColorCounts = Array.from(colorMap.values())
    .map(c => ({ ...c }))
    .sort((a, b) => b.count - a.count);

  // 应用颜色简化
  if (state.simplify > 0) {
    applySimplify();
  } else {
    state.gridData = state.rawGridData;
    state.colorCounts = state.rawColorCounts;
  }

  renderPreview();
  renderStats();
  downloadBtn.disabled = false;
}

// ============================================================
// 5.5 颜色简化 — 合并映射后的相近颜色
// ============================================================

/** 从 gridData 重建 colorCounts */
function rebuildColorCounts(grid) {
  const map = new Map();
  for (const row of grid) {
    for (const cell of row) {
      if (!cell) continue;
      const key = cell.hex;
      if (!map.has(key)) map.set(key, { ...cell, count: 0 });
      map.get(key).count++;
    }
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

/** 基于 rawGridData 重新计算简化后的 gridData 和 colorCounts */
function applySimplify() {
  const threshold = state.simplify;
  const raw = state.rawGridData;
  if (!raw) return;

  if (threshold <= 0) {
    state.gridData = state.rawGridData;
    state.colorCounts = state.rawColorCounts;
    return;
  }

  // 将简化值 0-100 映射到平方距离阈值
  // 100 → 5000（≈ RGB 每通道差 ~40，相当激进）
  const maxDistSq = (threshold / 100) * 5000;
  if (maxDistSq <= 0) return;

  const rows = raw.length;
  const cols = raw[0].length;

  // 深拷贝一份原始网格
  const grid = raw.map(r => r.map(c => c ? { ...c } : null));

  // 统计颜色频率（从原始数据）
  const freq = new Map();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = raw[r][c];
      if (!cell) continue;
      const key = cell.hex;
      freq.set(key, (freq.get(key) || 0) + 1);
    }
  }

  // 按频率降序排列颜色
  const sorted = [...freq.entries()]
    .map(([hex, count]) => ({ hex, count, color: PERLER_PALETTE.find(p => p.hex === hex) }))
    .filter(x => x.color)
    .sort((a, b) => b.count - a.count);

  // 从低频到高频，为每个颜色找更常见的相近色进行合并
  const mergeMap = new Map(); // source hex → target hex
  for (let i = sorted.length - 1; i >= 0; i--) {
    const src = sorted[i];
    let bestDist = Infinity;
    let bestTarget = null;

    for (let j = 0; j < i; j++) {
      const tgt = sorted[j];
      const d = colorDistance(src.color, tgt.color);
      if (d < bestDist) {
        bestDist = d;
        bestTarget = tgt;
      }
    }

    if (bestTarget && bestDist <= maxDistSq) {
      mergeMap.set(src.hex, bestTarget.hex);
    }
  }

  // 解析合并链：A→B, B→C => A→C
  for (const [src, tgt] of mergeMap) {
    let resolved = tgt;
    const seen = new Set([src]);
    while (mergeMap.has(resolved) && !seen.has(resolved)) {
      seen.add(resolved);
      resolved = mergeMap.get(resolved);
    }
    mergeMap.set(src, resolved);
  }

  // 执行合并
  const paletteMap = new Map(PERLER_PALETTE.map(p => [p.hex, p]));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = grid[r][c];
      if (cell && mergeMap.has(cell.hex)) {
        const tgt = paletteMap.get(mergeMap.get(cell.hex));
        if (tgt) grid[r][c] = tgt;
      }
    }
  }

  state.gridData = grid;
  state.colorCounts = rebuildColorCounts(grid);
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

  // 网格宽高比 = cols/rows。预览按网格真实比例绘制（非强制正方形格子），
  // 选框内容完整放入网格（contain），留白居中，与选框形状一致。
  // （此前用正方形 cellSize 会把长方形网格拉伸，导致图纸与选框不一致）。
  const gridAspect = cols / rows;
  let drawW, drawH;
  if (gridAspect >= 1) {
    drawW = 720;
    drawH = Math.round(720 / gridAspect);
  } else {
    drawH = 720;
    drawW = Math.round(720 * gridAspect);
  }
  // 小屏适配：如果预览容器宽度小于画布宽度，按比例缩小
  const previewContainer = previewCanvas.parentElement;
  const maxContainerW = previewContainer.clientWidth - 16; // 减去 padding 8px×2
  if (drawW + 8 > maxContainerW) {
    const scale = Math.max(0.35, maxContainerW / (drawW + 8));
    drawW = Math.round(drawW * scale);
    drawH = Math.round(drawH * scale);
  }
  // 单元格尺寸（长方形，保持网格真实比例）
  const cellW = drawW / cols;
  const cellH = drawH / rows;
  const minCell = Math.min(cellW, cellH);

  const dpr = window.devicePixelRatio || 1;
  const padding = 4;

  const canvasW = drawW + padding * 2;
  const canvasH = drawH + padding * 2;

  previewCanvas.width = canvasW * dpr;
  previewCanvas.height = canvasH * dpr;
  previewCanvas.style.width = canvasW + 'px';
  previewCanvas.style.height = canvasH + 'px';

  const ctx = previewCanvas.getContext('2d');
  ctx.scale(dpr, dpr);

  // 背景
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvasW, canvasH);

  // 第一遍：填充所有格子（空格子留白）
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cell = grid[row][col];
      ctx.fillStyle = cell ? cell.hex : '#FFFFFF';
      ctx.fillRect(padding + col * cellW, padding + row * cellH, cellW, cellH);
    }
  }
  // 空格子画斜线标记
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (grid[row][col]) continue;
      const x = padding + col * cellW;
      const y = padding + row * cellH;
      ctx.strokeStyle = 'rgba(0,0,0,0.1)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + cellW, y + cellH);
      ctx.moveTo(x + cellW, y);
      ctx.lineTo(x, y + cellH);
      ctx.stroke();
    }
  }
  // 第二遍：统一绘制网格线（避免同色格子覆盖边框）
  ctx.strokeStyle = 'rgba(0,0,0,0.15)';
  ctx.lineWidth = 0.5;
  for (let row = 0; row <= rows; row++) {
    ctx.beginPath();
    ctx.moveTo(padding, padding + row * cellH);
    ctx.lineTo(padding + cols * cellW, padding + row * cellH);
    ctx.stroke();
  }
  for (let col = 0; col <= cols; col++) {
    ctx.beginPath();
    ctx.moveTo(padding + col * cellW, padding);
    ctx.lineTo(padding + col * cellW, padding + rows * cellH);
    ctx.stroke();
  }

  // 第三遍：绘制色号文字（空格子跳过）
  const minCellForText = 10;
  if (minCell >= minCellForText) {
    const fontSize = Math.max(5, minCell * 0.35);
    ctx.font = `${fontSize}px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const c = grid[row][col];
        if (!c) continue;
        const cx = padding + col * cellW + cellW / 2;
        const cy = padding + row * cellH + cellH / 2;
        const lum = (c.r * 0.299 + c.g * 0.587 + c.b * 0.114) / 255;
        ctx.fillStyle = lum > 0.5 ? '#000000' : '#FFFFFF';
        ctx.fillText(c.name, cx, cy);
      }
    }
  }

  previewInfo.textContent = `${cols}×${rows} 网格 · ${Math.round(cellW)}×${Math.round(cellH)}px/格`;
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

// 分享按钮
shareBtn.addEventListener('click', () => {
  if (!state.gridData) return;
  sharePNG();
});

function sharePNG() {
  if (!state.gridData) return;
  // 先渲染下载画布，再分享
  renderDownloadCanvas();
  const grid = state.gridData;
  const rows = grid.length;
  const cols = grid[0].length;

  // 预检：超限时 toBlob 会静默回 null，这里先给出提示（见 REVIEW.md C2）
  if (!checkExportSize(cols, rows)) return;

  downloadCanvas.toBlob((blob) => {
    if (!blob) {
      showError('导出画布过大，无法生成 PNG，请改用较小的网格尺寸');
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
 */
function computeDownloadSize() {
  const rows = state.gridData.length;
  const cols = state.gridData[0].length;

  // 按网格宽高比计算单元格尺寸，避免图纸被拉伸
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

  const dpr = 2; // 2x 高清
  const padding = 16;
  const titleHeight = 40;
  const legendItemHeight = 28;
  const legendPadding = 16;
  const legendTop = rows * cellH + padding * 2 + titleHeight;

  const legendCols = 5;
  const legendRows = Math.ceil((state.colorCounts ? state.colorCounts.length : 0) / legendCols);
  const legendW = padding * 2 + legendCols * 180;

  const canvasW = Math.max(cols * cellW + padding * 2, legendW);
  const canvasH = legendTop + legendPadding + legendRows * legendItemHeight + padding;

  return { canvasW, canvasH, cellW, cellH, dpr, padding, titleHeight, legendItemHeight, legendPadding, legendTop, legendRows, legendW, rows, cols };
}

/**
 * 导出前的尺寸预检。
 * iOS Safari 画布上限约 16.78MP（4096²），超过时 toBlob 静默回 null，
 * 用户点了「下载」毫无反应。这里提前拦截并给出可操作的提示。
 * 返回 true 表示可以继续导出。
 */
function checkExportSize(cols, rows) {
  const { canvasW, canvasH, dpr } = computeDownloadSize();
  const mp = (canvasW * dpr * canvasH * dpr) / 1e6;
  if (mp > MAX_EXPORT_MP) {
    showError(
      `${cols}×${rows} 的图纸约 ${mp.toFixed(1)}MP，超出本设备浏览器上限（约 ${MAX_EXPORT_MP}MP），` +
      `导出可能失败。建议改用 52×52 或更小的尺寸。`
    );
    return false;
  }
  return true;
}

/** 渲染下载用画布（网格 + 标题 + 图例），downloadPNG 和 sharePNG 共用 */
function renderDownloadCanvas() {
  const {
    canvasW, canvasH, cellW, cellH, dpr, padding, titleHeight,
    legendItemHeight, legendPadding, legendTop, rows, cols,
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
  ctx.font = 'bold 20px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`拼豆图纸 ${cols}×${rows}`, canvasW / 2, padding + 28);

  // 绘制网格
  const gridX = (canvasW - cols * cellW) / 2;
  const gridY = padding + titleHeight;

  // 第一遍：填充所有格子（空格子留白）
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cell = grid[row][col];
      ctx.fillStyle = cell ? cell.hex : '#FFFFFF';
      ctx.fillRect(gridX + col * cellW, gridY + row * cellH, cellW, cellH);
    }
  }
  // 第二遍：统一绘制网格线
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 0.5;
  for (let row = 0; row <= rows; row++) {
    ctx.beginPath();
    ctx.moveTo(gridX, gridY + row * cellH);
    ctx.lineTo(gridX + cols * cellW, gridY + row * cellH);
    ctx.stroke();
  }
  for (let col = 0; col <= cols; col++) {
    ctx.beginPath();
    ctx.moveTo(gridX + col * cellW, gridY);
    ctx.lineTo(gridX + col * cellW, gridY + rows * cellH);
    ctx.stroke();
  }

  // 第三遍：绘制色号文字
  const fontSize = Math.max(5, Math.round(minCell * 0.35));
  ctx.font = `${fontSize}px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const c = grid[row][col];
      if (!c) continue;
      const cx = gridX + col * cellW + cellW / 2;
      const cy = gridY + row * cellH + cellH / 2;
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
}

function downloadPNG() {
  if (!state.gridData) return;
  renderDownloadCanvas();
  const cols = state.gridData[0].length;
  const rows = state.gridData.length;

  // 预检：超限时 toBlob 会静默回 null（见 REVIEW.md C2）
  if (!checkExportSize(cols, rows)) return;

  // iOS Safari 不支持 blob URL 的 <a download>，改为新窗口打开让用户长按保存。
  // 必须在用户手势的调用栈内同步开窗 —— toBlob 回调是异步的，
  // 在那里 window.open 会被弹窗拦截（见 REVIEW.md C2）。
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const iosWindow = isIOS ? window.open('', '_blank') : null;
  if (isIOS && !iosWindow) {
    showError('浏览器拦截了新窗口，请允许弹窗后重试下载');
    return;
  }

  // 触发下载
  downloadCanvas.toBlob((blob) => {
    if (!blob) {
      if (iosWindow) iosWindow.close();
      showError('导出画布过大，无法生成 PNG，请改用较小的网格尺寸');
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

// ============================================================
// 工具函数
// ============================================================

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

// 重新上传
$('#resetBtn').addEventListener('click', () => {
  state.image = null;
  state.gridData = null;
  state.colorCounts = null;
  state.rawGridData = null;
  state.rawColorCounts = null;
  // 简化强度与网格尺寸回到默认，避免影响下一张图（C1 / m12）
  resetSimplify();
  state.gridW = 29;
  state.gridH = 29;
  $$('.grid-btn').forEach((b) => b.classList.toggle('active', b.dataset.w === '29'));
  // 清空画布，避免残留旧图片
  viewerCtx.clearRect(0, 0, viewerCanvas.width, viewerCanvas.height);
  selectionBox.classList.remove('visible');
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

// ============================================================
// 9. 加载状态
// ============================================================

function showLoading(msg) {
  loadingText.textContent = msg || '正在处理…';
  loadingOverlay.hidden = false;
}

function hideLoading() {
  loadingOverlay.hidden = true;
}

// 在 generateGrid 中包裹加载状态
const _origGenerateGrid = generateGrid;
generateGrid = function() {
  const startTime = Date.now();
  showLoading('正在生成图纸…');
  // 使用 requestAnimationFrame 避免阻塞 UI 更新
  requestAnimationFrame(() => {
    try {
      _origGenerateGrid.call(this);
    } catch (err) {
      // 必须兜住：否则 hideLoading 永远不会执行，遮罩会永久卡死界面
      console.error('生成图纸失败：', err);
      showError('生成图纸失败，请调整选框后重试');
    } finally {
      // 至少显示 300ms 避免闪烁
      const elapsed = Date.now() - startTime;
      const delay = Math.max(0, 300 - elapsed);
      setTimeout(hideLoading, delay);
    }
  });
};

// ============================================================
// 10. 安装提示 (PWA)
// ============================================================

let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installBanner.hidden = false;
});

installBtn.addEventListener('click', () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  deferredPrompt.userChoice.then(() => {
    deferredPrompt = null;
    installBanner.hidden = true;
  });
});

installClose.addEventListener('click', () => {
  installBanner.hidden = true;
  deferredPrompt = null;
});

// 已安装或不支持 PWA 时不显示
window.addEventListener('appinstalled', () => {
  installBanner.hidden = true;
  deferredPrompt = null;
});

// 分享按钮在支持 Web Share API 的移动端显示
if (navigator.share) {
  shareBtn.hidden = false;
}