// ============================================================
// 拼豆图纸生成器 — 主逻辑
// ============================================================

// 核心层（DOM 引用 / 常量 / state / 初始化）已迁至 js/core/（REFACTOR §7.1 步骤 5）
//   js/core/dom.js   —— $ / $$ / 全部 DOM 引用 / isTouchDevice
//   js/core/state.js —— MAX_EXPORT_* / AUTO_MERGE_DIST_SQ / state / viewerCtx / 主题同步

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

  // 复用同一个离屏 canvas，而不是每次拍照都 createElement。
  // 原实现每次新建一个全分辨率的 canvas（1920×1080 ≈ 8MB 显存），
  // 连续拍照会累积占用 —— 在 iOS 的 canvas 内存预算下尤其危险（见 REVIEW.md m8 / PLAN §3.2）。
  if (!captureCanvas) captureCanvas = document.createElement('canvas');
  const canvas = captureCanvas;

  // 只在尺寸变化时重设：给 canvas 尺寸赋值会重置绘图状态
  if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }
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

/** 拍照用的复用画布（见 REVIEW.md m8） */
let captureCanvas = null;

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
      markActiveGridBtn(29);
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

/**
 * 全局提示条。用于「上传阶段之后」的错误：
 * #uploadError 位于 #uploadSection 内，而生成/导出时该分区已 hidden，
 * 消息写进去用户根本看不见（这正是 C2 提示「点了没反应」的原因）。
 * 这里用独立的固定定位元素，不受各分区显隐影响。
 */
let toastTimer = null;
function showToast(msg, duration = 6000) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, duration);
}

// ============================================================
// 2. 图片查看器
// ============================================================

/**
 * 计算图片在画布中的**实际绘制矩形**（contain 适配 + zoom/pan 变换）。
 *
 * 这是整个 viewer 的坐标换算基准，此前在 `renderViewer` / `getImageCoords` /
 * `updateSelectionBox` 里**重复了三份**（REFACTOR §3.1 重复项 #1）。抽取后
 * 三处共用同一份数学，避免"改了一处、漏了另两处"。
 *
 * @param {number} w 画布宽（**调用方决定来源**，见下方 ⚠️）
 * @param {number} h 画布高
 * @returns {{imgX:number, imgY:number, scaledW:number, scaledH:number}}
 *          图片左上角坐标与缩放后的宽高（client 像素）
 *
 * ⚠️ **为什么把 w/h 做成参数、而不在函数内自己取**（REFACTOR §7.4 步 2）：
 * 三个调用方的宽度来源**本来就不同**，且这个差异**必须保留**：
 *   - `renderViewer`        → `viewerCanvas.width`（canvas 位图尺寸）
 *   - `getImageCoords`      → `getBoundingClientRect().width`
 *   - `updateSelectionBox`  → `getBoundingClientRect().width`
 * `resizeViewerCanvas()` 之后二者应相等，但在 **iOS 的 0 尺寸时序窗口内不相等**
 * （`resizeViewerCanvas` 的零尺寸 rAF 重试正为此存在）。
 * 若在此"顺手统一"成单一来源，就会把已修复的 iOS 缺陷改回来。
 *
 * ⚠️ 另：本函数**不读** `state.image`，也不做 `state.imageW/imageH` 的有效性检查，
 * 调用方须自行保证（`renderViewer` 已在入口判空）。
 */
function computeImageRect(w, h) {
  // contain 适配：图片按原比例完整放入画布
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

  // 应用 zoom 和 pan（以画布中心为基准）
  const cx = w / 2 + state.panX;
  const cy = h / 2 + state.panY;
  const scaledW = drawW * state.zoom;
  const scaledH = drawH * state.zoom;

  return { imgX: cx - scaledW / 2, imgY: cy - scaledH / 2, scaledW, scaledH };
}

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
  // 键盘提示与触摸提示同源同判据：触摸设备没有物理键盘，显示它只是噪音（见 REVIEW.md M8）
  viewerHint4.hidden = isTouchDevice;
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
  // ⚠️ 宽高来源是 viewerCanvas（不是 getBoundingClientRect）—— 见 computeImageRect 的说明
  const w = viewerCanvas.width;
  const h = viewerCanvas.height;
  const ctx = viewerCtx;
  ctx.clearRect(0, 0, w, h);

  const { imgX, imgY, scaledW, scaledH } = computeImageRect(w, h);

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

  // ⚠️ 这里必须用 getBoundingClientRect 的宽高（不是 viewerCanvas.width），
  // 与 renderViewer 的差异是**刻意保留**的，详见 computeImageRect 的说明
  const { imgX, imgY, scaledW, scaledH } = computeImageRect(rect.width, rect.height);

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

/**
 * 合并同一帧内的视图重绘。
 *
 * 背景（见 REVIEW.md §六「性能耦合」）：pointermove 一个回调并联了
 * isDragging / isResizing / isPanning 三套逻辑，每套都各调一次
 * updateSelectionBox() + renderViewer()，**无节流、无 rAF 合并** ——
 * 移动端每次指针移动可能触发 2 次全画布重绘。
 *
 * 这里把重绘收敛成"每帧至多一次"。安全性依据：
 * state.selection / panX / panY 在监听器里**已同步更新**，
 * 重绘只读 state，因此延迟到下一帧画的必然是最新状态，不会画丢中间态。
 * 若已有排队的重绘则直接复用，不再重复排队。
 */
let viewerRedrawPending = false;
function scheduleViewerRedraw() {
  if (viewerRedrawPending) return;
  viewerRedrawPending = true;
  requestAnimationFrame(() => {
    viewerRedrawPending = false;
    renderViewer();
    updateSelectionBox();
  });
}

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

// ============================================================
// 4. 网格尺寸选择
// ============================================================

$$('.grid-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    markActiveGridBtn(btn.dataset.w);
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

  if (!hasW && !hasH) {
    // 此前静默返回，用户点「应用」毫无反应、不知为何（见 REVIEW.md m10）
    const bad = [];
    if (customW.value !== '' && !hasW) bad.push(`宽 ${customW.value}`);
    if (customH.value !== '' && !hasH) bad.push(`高 ${customH.value}`);
    showToast(
      bad.length
        ? `${bad.join('、')} 超出范围，请填 15 ~ 104 之间的整数`
        : '请至少填写宽或高（15 ~ 104 之间的整数）'
    );
    return;
  }
  // 固定网格尺寸：选框内容按比例 fit 进网格，不再调整网格尺寸
  state.gridW = hasW ? w : state.gridW;
  state.gridH = hasH ? h : state.gridH;
  // 自定义尺寸与预设按钮互斥：清掉 active 与 aria-pressed（两者必须同步）
  $$('.grid-btn').forEach((b) => {
    b.classList.remove('active');
    b.setAttribute('aria-pressed', 'false');
  });
  generateGrid();
});

// 颜色简化滑块
simplifySlider.addEventListener('input', () => {
  const val = parseInt(simplifySlider.value);
  state.simplify = val;
  const label = val === 0 ? '关闭' : `${val}%`;
  simplifyValue.textContent = label;
  // 滑块需要可访问的值文本：读屏只报数字，不知道 0 表示"关闭"（见 REVIEW.md m6）
  simplifySlider.setAttribute('aria-valuetext', label);
  if (state.rawGridData) {
    applySimplify();
    renderPreview();
    renderStats();
    announce(`颜色简化 ${label}，当前 ${state.colorCounts ? state.colorCounts.length : 0} 种颜色`);
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
  simplifySlider.setAttribute('aria-valuetext', '关闭');
}

// 行列标尺开关（PLAN §五 第一批第 3 项）。
// ⚠️ 它只影响**绘制**，不参与采样与色号映射 —— 因此**不重新生成网格**，
// 只重绘预览。重新生成会白跑一次逐格采样（大网格下明显卡顿），且毫无必要。
// 导出画布按需渲染（downloadPNG/sharePNG 里才调），故无需在此处理。
rulerToggle.addEventListener('change', () => {
  state.rulerEnabled = rulerToggle.checked;
  if (state.gridData) renderPreview();
  announce(state.rulerEnabled ? '已显示行列标尺' : '已隐藏行列标尺');
});

// 「5. 网格生成 + 色板映射」段已迁至 js/pipeline/grid.js（REFACTOR §7.1 步骤 5）
//   generateGrid（唯一入口）/ generateGridCore（真实实现）—— 两者必须同文件

// 「5.5 颜色简化」段已迁至 js/pipeline/simplify.js（REFACTOR §7.1 步骤 5）
//   cloneGrid / rebuildColorCounts / applySimplify / staticMergeCache / getStaticMergeMap

// 「5.9 网格绘制」段已迁至 js/pipeline/render.js（REFACTOR §7.1 步骤 5）
//   FONT_STACK / RULER_* / rulerMetrics / drawRuler / pickTextColor / drawGrid

// 「6. 图纸预览」段已迁至 js/output/preview.js（REFACTOR §7.1 步骤 5）
//   fitPreviewGrid / renderPreview

// 「7. 颜色统计」段已迁至 js/output/stats.js（REFACTOR §7.1 步骤 5）
//   renderStats

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

// 「PNG 导出」函数群已迁至 js/output/export.js（REFACTOR §7.1 步骤 5）
//   sharePNG / computeDownloadSize / pickExportDpr / checkExportSize /
//   exportScaleNote / renderDownloadCanvas / downloadPNG

// 「UI / a11y 工具」段已迁至 js/ui/a11y.js（REFACTOR §7.1 步骤 5）
//   announce / markActiveGridBtn / 键盘操作选框 / clamp

// ============================================================
// 9. 加载状态
// ============================================================
// 说明：加载遮罩原先靠文件末尾的「猴补丁整体覆盖 generateGrid」接入，
// 已按 REFACTOR.md §2.1 拆除 —— 现在由 generateGrid() 入口**显式**驱动，
// showLoading / hideLoading 就在这里定义，被入口直接调用。

function showLoading(msg) {
  loadingText.textContent = msg || '正在处理…';
  loadingOverlay.hidden = false;
}

function hideLoading() {
  loadingOverlay.hidden = true;
}

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