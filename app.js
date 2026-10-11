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
// 注：#selectionOverlay 是纯布局容器（无 JS 逻辑），不在此取引用 ——
// 原先的 selectionOverlay 变量是死引用（全项目 0 处使用，见 REFACTOR.md §3.4）
const selectionBox = $('#selectionBox');
const viewerHint = $('#viewerHint');
const viewerHint2 = $('#viewerHint2');
const viewerHint4 = $('#viewerHint4');
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
const rulerToggle = $('#rulerToggle');
const cameraInput = $('#cameraInput');
const cameraBtn = $('#cameraBtn');
const shareBtn = $('#shareBtn');
const loadingOverlay = $('#loadingOverlay');
const loadingText = $('#loadingText');
const installBanner = $('#installBanner');
const installBtn = $('#installBtn');
const installClose = $('#installClose');
const viewerHint3 = $('#viewerHint3');

// 触摸设备检测。
// ⚠️ 判据必须与 style.css 的 `@media (pointer: coarse)` **完全一致**（见 REVIEW.md M8）：
// 此前 JS 用 `navigator.maxTouchPoints > 0`（存在任意触摸点），
// CSS 用 `pointer: coarse`（**主**指针为粗指针）。二者不等价 ——
// 触摸屏笔记本上 JS 判定"是触摸设备"（显示「双指缩放/平移」提示），
// 而 CSS 判定"是桌面"（显示桌面拖拽上传区），界面提示与实际 UI 错配。
// 统一走 CSS 同一判据，二者永远同向。
const isTouchDevice = (() => {
  if (typeof window.matchMedia === 'function') {
    return window.matchMedia('(pointer: coarse)').matches;
  }
  // 极老浏览器无 matchMedia：退回触摸点判据（有偏差但聊胜于无）
  return navigator.maxTouchPoints > 0;
})();

// 导出画布像素上限。iOS Safari 内核（所有 WKWebView）约 16.78MP（4096²），
// 且**单边也不得超过 4096**。超过时 toBlob 会静默回 null（见 REVIEW.md C2）。
const MAX_EXPORT_MP = 16.78;
const MAX_EXPORT_SIDE = 4096;
// 期望的导出倍率（2x 高清）。设备允许时会用满，否则自动下调。
const MAX_EXPORT_DPR = 2;

/**
 * **常开**近似色合并的阈值（**平方**距离 —— `colorDistance()` 返回的就是平方值）。
 *
 * `16` ⟺ 欧氏距离 `dist = 4`。依据是本仓库实测的色板分布（见 PLAN §3.1，
 * 可用 `.pindou-devtools/probe-nearcolor.js` 复现）：
 * 全色板 24,310 个色对中，`dist < 4` 的**只有 3 对**（2.83 / 2.83 / 3.74），
 * 而 `dist < 6` 有 10 对、`dist < 8` 有 16 对。
 *
 * 故取**下限 4** —— 只并掉"肉眼无法分辨"的那几对，是风险最小的起点；
 * 是否放宽到 6 待观察真实图纸后再定（PLAN §3.1 明确要求"先窄后宽"）。
 *
 * ⚠️ 这一层**独立于「简化滑块」常开**：滑块是用户主动的强度选择，
 * 而近似色合并是针对"色板自身存在的近同色对"的修正，默认状态就必须生效。
 */
const AUTO_MERGE_DIST_SQ = 16;

// ----- 状态 -----
// ⚠️ 所有字段必须在**此处**声明后再使用（REFACTOR.md §2.3 的教训：
// 此前 dragSelection / rawGridData / rawColorCounts 是运行时动态挂上去的"影子字段"，
// 读代码的人看不到它们，改 state 时必然漏改）。
const state = {
  image: null,
  imageW: 0,
  imageH: 0,
  /** 视图缩放倍率，夹取在 0.2 ~ 5 */
  zoom: 1,
  panX: 0,
  panY: 0,
  // 选框 (百分比, 0-1)
  selection: { x: 0.15, y: 0.15, w: 0.7, h: 0.7 },
  // 网格尺寸 (15~104)
  gridW: 29,
  gridH: 29,
  // 颜色简化 0-100, 0=关闭
  simplify: 0,
  // 生成的网格数据（每个元素为 {name,hex,r,g,b} 或 null=空格）
  gridData: null,
  colorCounts: null,
  /** 简化前的原始映射数据，供滑块回溯。**与 gridData 不共享引用**（见 REVIEW.md n7） */
  rawGridData: null,
  /** 与 rawGridData 对应的、按数量降序的颜色统计 */
  rawColorCounts: null,
  /** 极端宽高比导致的量化偏差提示（无则 null），由 generateGrid 写入、renderPreview 展示 */
  aspectWarning: null,
  /**
   * 本轮因**近似色合并**而消失的色号，每项形如 `{ from: "H12", to: "E16" }`
   * （无合并时为空数组）。
   *
   * 由 `applySimplify()` 写入、`renderPreview()` 展示。
   * 存在的理由：合并是**静默改变用户产出**的行为 —— 用户会发现自己按图买的
   * H12 在图纸上根本不存在。必须如实告知，且要给出**替代色号**
   * （只说"H12 没了"而不说"改用 E16"等于没说），不能悄悄替换。
   */
  mergedColors: [],
  /**
   * 是否显示**行列标尺**（PLAN §五 第一批第 3 项）：网格外侧的行列号
   * + 每 10 格一条加粗参考线。默认开启。
   *
   * ⚠️ 与 `simplify` 的性质**不同**：simplify 是对图片的变换（因此重新上传要归零），
   * 而标尺是**显示偏好** —— 用户关掉后不该每次上传都被强行打开，
   * 所以 `handleFile()` **刻意不重置**它（这是有意为之，不是漏写）。
   *
   * 它只影响**绘制**，不参与采样与色号映射 —— 切换时无需重新生成网格。
   */
  rulerEnabled: true,
  // 拖拽状态
  isDragging: false,
  isResizing: false,
  isPanning: false,
  /**
   * 选框拖拽**起点**，**归一化图片坐标** `{ix, iy}`（0~1）。
   * 与 client 像素坐标无关 —— 换算靠 `getImageCoords()`。
   */
  dragStartImage: { ix: 0, iy: 0 },
  /**
   * 右键平移**起点**，**client 像素坐标** `{x, y}`（e.clientX 同量纲）。
   *
   * ⚠️ 与 `dragStartImage` 是**两种完全不同的坐标语义**，此前两者共用同一个
   * `state.dragStart` 字段（同名不同形状），已按 REFACTOR.md §2.2 拆开。
   * **不要**再把它们合并回一个字段，也不要拿其中一个去另一个的公式里用。
   */
  dragStartClient: { x: 0, y: 0 },
  dragHandle: null,
  /** 拖拽开始时的选框快照（归一化） */
  dragSelection: null,
  /**
   * 平移（右键拖拽 / 双指）**起点**的 pan 偏移量 `{x: panX, y: panY}`。
   * 位移必须相对它累计：`panX = panStartPan.x + 总位移`
   * （双指见 REVIEW.md M2，右键见 isPanning 分支）。
   */
  panStartPan: { x: 0, y: 0 },
  // 触摸状态
  lastTouchDist: 0,
  /** 上一帧的双指中心点（用于算缩放比与单帧增量） */
  lastTouchCenter: { x: 0, y: 0 },
  /** 双指手势起点的中心点。平移位移必须相对它累计（见 REVIEW.md M2） */
  touchStartCenter: { x: 0, y: 0 },
  isPinching: false,
};

// ----- 初始化 -----
const viewerCtx = viewerCanvas.getContext('2d');

/**
 * 把 CSS 变量里的主题色同步到 <meta name="theme-color">。
 * 主题色原本硬编码在 4 处（CSS / meta / manifest / icon.svg），改主题极易漏改
 * （见 REVIEW.md n1）。meta 这一处可以在运行时从唯一真源（`--primary`）推导，
 * 从此改主题色只需改 style.css 一处，页面主题色不会漂移。
 * manifest / 图标是构建期资源，仍须手工同步（已在 style.css 注明）。
 */
(function syncThemeColorMeta() {
  try {
    const primary = getComputedStyle(document.documentElement)
      .getPropertyValue('--primary').trim();
    if (!primary) return;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta && meta.content !== primary) meta.setAttribute('content', primary);
  } catch (err) {
    // 取不到就沿用 HTML 里写死的值，不影响功能
  }
})();

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

// ============================================================
// 工具函数
// ============================================================

/**
 * 向 #liveStatus 写入一条播报。读屏会念出来，视觉上不可见。
 * 用于生成完成、尺寸变化等「用户看不见但需要知道」的状态（见 REVIEW.md M5）。
 */
let liveTimer = null;
function announce(msg) {
  const el = document.getElementById('liveStatus');
  if (!el) return;
  // 先清空再写入：相同的字符串连续写入不会触发 aria-live 播报
  el.textContent = '';
  if (liveTimer) clearTimeout(liveTimer);
  liveTimer = setTimeout(() => { el.textContent = msg; }, 60);
}

/** 网格尺寸按钮的 aria-pressed 与 active class 必须同步（见 CLAUDE.md 双保险思路） */
function markActiveGridBtn(w) {
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
  fileInput.value = '';
});

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

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