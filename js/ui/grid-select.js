import { $, $$, applyCustom, customH, customW, rulerToggle, simplifyLockHint, simplifySlider, simplifyValue } from '../core/dom.js';
import { state } from '../core/state.js';
import { showToast } from '../input/upload.js';
import { renderPreview } from '../output/preview.js';
import { renderStats } from '../output/stats.js';
import { hasAppliedEdits } from '../pipeline/edit.js';
import { generateGrid } from '../pipeline/grid.js';
import { applySimplify } from '../pipeline/simplify.js';
import { announce, markActiveGridBtn } from './a11y.js';

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

/**
 * 当前是否**有原图**（"依赖重新采样的控件"能否可用的原因之一）。
 * 由 `setSamplingControlsEnabled()` 维护；与"是否被手工编辑锁住"是两个独立的量，
 * 见 `refreshSamplingControls()` 的说明。
 */
let hasImage = false;

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
  // ⚠️ 被编辑锁住时**不能**继续：`applySimplify()` 会拿 rawGridData 整份重算，
  //    把用户的逐格修正全部抹掉。控件已置 `disabled`（挡得住键盘与指针），
  //    但脚本/自动化仍能派发 input —— 故这里必须再挡一道，并且**说明原因**，
  //    不做成"拖了没反应"（本仓库一贯要求：静默失效不可接受）。
  if (hasAppliedEdits()) {
    showToast('图纸已被手工编辑过：颜色简化会按原始采样值整份重算、抹掉这些修改。'
      + '请先撤销全部编辑（Ctrl+Z）再用简化。');
    // 把滑块位置拨回与 state 一致，避免界面显示一个并未生效的强度
    simplifySlider.value = String(state.simplify);
    return;
  }
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
 *
 * ⚠️ 读数文案**交给 `refreshSamplingControls()`**，不要在这里直接写死"关闭"：
 *    禁用有"无原图"与"已手工编辑"两个原因，两处的读数不同，
 *    两处各写一份必然漂移（表现为读数与实际可用性不符）。
 */
export function resetSimplify() {
  state.simplify = 0;
  simplifySlider.value = 0;
  refreshSamplingControls();
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

/**
 * 统一开关「**依赖原图重新采样**」的控件（PLAN 第三批 6b）。
 *
 * 涉及：网格预设按钮 / 自定义宽高输入与「应用」/ 颜色简化滑块。
 * 这五个控件的共同点是——**必须有一张原图**才能产出结果：
 *   · 网格尺寸变化 ⇒ 要重新逐格采样；
 *   · 简化强度变化 ⇒ 要回到 `rawGridData`（**采样**原始值）重算。
 * 而载入存档时原图已清空（6b 产品决策），两者都**不可能**生效。
 *
 * ⚠️ 为什么禁用而不是隐藏，也不是"点了再提示"（6b 开工前与用户确认的决策）：
 *   · **隐藏**：用户不知道这些能力去哪了，会以为工具退化了；
 *   · **点了再提示**：控件看起来可用，用户得先撞一次墙才知道不行；
 *   · **禁用 + 横幅**：控件仍在原位（说明"它存在，只是现在用不了"），
 *     横幅说明**为什么**不能用、以及怎么恢复（上传一张图）。
 *   本仓库一贯要求"静默失效不可接受"（同近似色合并必须播报替代色号）。
 *
 * ⚠️ 必须**逐个控件**设置 `disabled`，不能只给容器加样式：
 *   样式层禁用挡不住键盘与脚本触发，那正是"看起来灰了其实还能点"的假象。
 *    同时给自定义输入置 `readOnly` 之外还要置 `disabled` —— 前者仍可聚焦输入，
 *    用户会以为自己能改。
 *
 * @param {boolean} enabled true = 有原图，恢复可用（默认路径）
 */
export function setSamplingControlsEnabled(enabled) {
  hasImage = !!enabled;
  refreshSamplingControls();
}

/**
 * 按**当前真实状态**重算"哪些采样控件可用"，并同步读数与说明。
 *
 * ⚠️ 抽成"按 state 重算"而不是"设一个布尔"，是因为禁用有**两个独立原因**：
 *   ① 无原图（6b 的产品决策）；
 *   ② 图纸被手工编辑过（6c）—— 见下。
 *    用"设布尔"的写法时，两个原因会互相覆盖：上传新图调 `(true)` 会把
 *    编辑锁一起解开，而那时编辑锁**必须**还在。
 *
 * ⚠️ **编辑锁的理由**（PLAN 第三批 6c 的产品决策）：
 *    `applySimplify()` 是"拿 `rawGridData` **整份重算**"，
 *    它会把用户的逐格修正**全部抹掉** —— 而滑块本身完全看不出这件事。
 *    只置灰不解释 = 用户以为工具坏了，故同时显示 `#simplifyLockHint` 说明原因
 *    与恢复办法（撤销掉全部编辑）。
 */
export function refreshSamplingControls() {
  const lockedByEdit = hasAppliedEdits();
  const gridEnabled = hasImage;
  const simplifyEnabled = hasImage && !lockedByEdit;

  // 网格预设按钮：预设尺寸本身仍要显示当前值（active 态保留），只是不可再切换
  $$('.grid-btn').forEach((b) => { b.disabled = !gridEnabled; });
  customW.disabled = !gridEnabled;
  customH.disabled = !gridEnabled;
  applyCustom.disabled = !gridEnabled;
  simplifySlider.disabled = !simplifyEnabled;

  // 置灰时把滑块读数改成说明文字：否则屏幕上会留一个"0 = 关闭"的读数，
  // 让人以为简化被关掉了，而真实原因是它压根不可用。
  // ⚠️ aria-valuetext 必须一起改 —— 只改可见文字的话，
  //    读屏用户听到的仍是"关闭"（`<input type=range>` 的读数取自该属性）。
  let label;
  if (!hasImage) {
    label = '需原图';
  } else if (lockedByEdit) {
    label = '已手工编辑';
  } else {
    label = state.simplify === 0 ? '关闭' : `${state.simplify}%`;
  }
  simplifyValue.textContent = label;
  simplifySlider.setAttribute('aria-valuetext', label);

  // 就近说明"为什么灰了"（横幅在大网格/无原图路径上已有说明，
  // 但滑块右边这一条在**编辑锁**这一新原因下是唯一的解释来源）
  simplifyLockHint.hidden = !lockedByEdit;
  simplifyLockHint.textContent = lockedByEdit
    ? '已手工修改过图纸：颜色简化会按原始采样值整份重算，抹掉这些修改。'
      + '若要再用简化，请先撤销全部编辑（快捷键 Ctrl+Z）。'
    : '';
}
