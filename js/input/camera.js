import { cameraInput } from '../core/dom.js';
import { handleFile } from './upload.js';

// ============================================================
// js/input/camera.js — 相机（移动端拍照上传）
// ============================================================
// 自 app.js 的「1. 图片上传」段搬迁而来（REFACTOR §7.1 步骤 5）。
//
// ⚠️ `cameraStream` 只在本模块内读写，是**唯一可私有化**的状态之一
//    （REFACTOR 附录 A）。步骤 0（ESM）后它会变成真正的模块私有变量。
// ⚠️ `closeCamera()` 挂在 window 的 pagehide 与 visibilitychange 上 ——
//    离开页面必须释放摄像头，否则手机上指示灯常亮。
// ============================================================
let cameraStream = null;

export function openCamera() {
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

export function capturePhoto() {
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

export function closeCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
  }
  const overlay = document.getElementById('cameraOverlay');
  if (overlay) overlay.hidden = true;
}
