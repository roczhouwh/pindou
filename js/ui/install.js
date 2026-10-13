import { installBanner, installBtn, installClose, shareBtn } from '../core/dom.js';

// ============================================================
// js/ui/install.js — PWA 安装提示
// ============================================================
// 自 app.js 的「10. 安装提示 (PWA)」段搬迁而来（REFACTOR §7.1 步骤 5）。
//
// ⚠️ `deferredPrompt` 只在本模块内读写（REFACTOR 附录 A：可私有化）。
// ⚠️ 分享按钮的显隐也在这里（依赖 navigator.share，属同一 UI 关注点）。
// ============================================================
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
