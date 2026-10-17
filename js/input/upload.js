import { $, cameraBtn, cameraInput, fileInput, uploadError, uploadZone } from '../core/dom.js';
import { state } from '../core/state.js';
import { closeCamera, openCamera } from './camera.js';
import { resetEditState } from '../pipeline/edit.js';
import { markActiveGridBtn } from '../ui/a11y.js';
import { resetSimplify } from '../ui/grid-select.js';
import { showViewer } from '../viewer/viewer.js';

// ============================================================
// js/input/upload.js — 图片上传（选择/拖拽/相机入口）与阶段提示
// ============================================================
// 自 app.js 的「1. 图片上传」段搬迁而来（REFACTOR §7.1 步骤 5）。
// 含 handleFile / showError / showToast 与上传区的全部监听器。
//
// ⚠️ **showError 与 showToast 用途不同，不要混用**（CLAUDE.md 有专门的坑记录）：
//    · showError(msg) → #uploadError，**仅上传阶段可用**
//    · showToast(msg) → #toast（position:fixed，独立于所有分区），**上传之后一律用它**
//    原因：showViewer() 会设 uploadSection.hidden = true，
//    上传完成后写进 #uploadError 的消息会**静默丢失**。
// ============================================================
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
// （相机相关已迁至 js/input/camera.js）

// 页面被隐藏 / 关闭时必须释放摄像头，否则相机指示灯常亮、
// 且在 iOS 上会一直占用设备（见 REVIEW.md M3）
//
// ⚠️ **必须包一层箭头函数，不能直接传 `closeCamera`**：
//    直接传会在**模块顶层立即求值** `closeCamera` —— 这在裸 <script> 下只是加载顺序问题，
//    但在 ESM 下 closeCamera 是 import 绑定，与 camera.js 构成**循环导入**，
//    顶层求值会命中 TDZ 并抛 `ReferenceError: Cannot access 'closeCamera' before initialization`。
//    包一层后引用推迟到事件触发时求值，循环导入即安全。
//    （本项由 tmp-cycle-kind.js 实测定位：全项目**唯一**一处顶层跨模块求值。）
window.addEventListener('pagehide', () => closeCamera());
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

export function handleFile(file) {
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
      // 换文档：编辑态一并复位（撤销栈 + 工具 + 画笔色）。
      // ⚠️ 撤销栈绝不能跨文档保留：新网格是**另一张图**的采样结果，
      //    旧编辑点在这里没有对应关系（见 js/pipeline/edit.js 的硬约束 4）。
      resetEditState();
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

export function showError(msg) {
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
export function showToast(msg, duration = 6000) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, duration);
}
