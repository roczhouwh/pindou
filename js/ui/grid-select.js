// ============================================================
// js/ui/grid-select.js — 网格尺寸选择（预设 / 自定义 / 简化滑块 / 标尺开关）
// ============================================================
// 自 app.js 的「4. 网格尺寸选择」段搬迁而来（REFACTOR §7.1 步骤 5）。
//
// ⚠️ 切换**标尺开关不重新生成网格**，只重绘预览 ——
//    标尺只影响绘制；重新生成会白跑一次逐格采样（大网格下明显卡顿）。
// ⚠️ `state.rulerEnabled` 是**显示偏好**，`handleFile()` 刻意不重置它；
//    而 `simplify` 是图像变换参数，重新上传必须归零（resetSimplify）。
// ============================================================
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
