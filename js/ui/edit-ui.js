// ⚠️ **必须写成单行具名 import**：`lint-noundef.js` 的解析器只认这一种形态。
import { brushBtn, editColorName, editColorSwatch, editHint, eraseBtn, exitEditBtn, pickBtn, previewCanvas, redoBtn, statsBody, undoBtn } from '../core/dom.js';
import { state } from '../core/state.js';
import { showToast } from '../input/upload.js';
import { hitTestCell, cellsBetween, previewLayoutFor, renderPreview } from '../output/preview.js';
import { renderStats } from '../output/stats.js';
import { EDIT_TOOL, beginStroke, canRedo, canUndo, endStroke, paintCell, pickColorAt, redoEdit, setEditColor, setEditStateListener, setEditTool, undoEdit } from '../pipeline/edit.js';
import { announce } from './a11y.js';
import { refreshSamplingControls } from './grid-select.js';

// ============================================================
// js/ui/edit-ui.js — 单元格编辑的**界面层**（PLAN 第三批 6c / 6d）
// ============================================================
// 三层分工（与 6b 的存档三层同构，**不要互相越界**）：
//   · `js/pipeline/edit.js`   —— 改哪一格、撤销栈怎么记（模型层，不碰 DOM）
//   · `js/output/preview.js`  —— 预览版面几何 + `hitTestCell()`（纯函数，**唯一几何真源**）
//   · **本模块**              —— 指针事件 / 工具栏 / 统计表选色 / 快捷键
//
// ⚠️ **五条硬约束**（`test-edit.js` + `probe-edit-mutation.js` 守护）：
//
// 1. **未选工具时预览画布绝不接管指针**（`state.editTool === 'none'` 直接返回）。
//    移动端在预览上滑动是极常见的动作（翻页/滚动页面），若默认就编辑，
//    用户会在毫无察觉的情况下改掉图纸 —— 编辑必须由用户显式进入。
//
// 2. **命中测试只能用 `previewLayoutFor()` 的几何**，不要在本地再算一遍
//    "canvas 宽减 padding 除以列数"。两处几何一旦漂移，症状是
//    **点这一格、改的是旁边那一格** —— 用户会照着改了号的图纸去买豆。
//
// 3. **坐标用 `getBoundingClientRect()`，不要用 `canvas.width`**。
//    `canvas.width = canvasW * dpr`，在 2x 屏上它是 CSS 尺寸的两倍；
//    拿它去算命中会把所有点击映射到左上角 1/4 区域（这正是本项目 iOS 缺陷
//    "css 尺寸 vs 位图尺寸" 的同一类陷阱，见 CLAUDE.md 的 iOS 备忘）。
//
// 4. **拖拽期间只重绘预览，统计表在抬笔时才刷新**。理由有两条，都不是性能洁癖：
//    ① 统计表是 `innerHTML` 整表重建，会把用户刚点的「选为画笔色」按钮**删掉**、
//       焦点丢失（键盘用户直接失去落点）；
//    ② 统计的语义是"这一笔之后的用量"，抬笔才是一笔的提交点（撤销栈也在那里入栈）。
//
// 5. **撤销快捷键要避开输入框**：用户在「存档名称」里按 Ctrl+Z 时，
//    那是**文本框自己的撤销**，抢过来会删掉他刚放弃的图纸编辑 —— 两件事互不相干。
//
// 本文件是原生 ES module：依赖由上方 import 显式声明。
// ============================================================

/** 预览画布是否正在被拖动涂色（与 `state.editTool` 分开：后者是"模式"，前者是"此刻"） */
let painting = false;
/** 上一次涂过的格子，用于跳过同格的重复派发（指针在同一格内移动仍会触发 pointermove） */
let lastPainted = null;
/**
 * 本笔的句柄（`pointerdown` 开、`pointerup` 收）。
 * 保留它让"一次拖拽 = 一笔"这条契约在代码里**看得见**，也便于将来排查
 * （不需要在 `pointerup` 里再去问"现在这一笔是谁开的"）。
 */
let strokeHandle = null;
/**
 * 「画笔还没选色」这条提示是否已经报过。
 * ⚠️ 它在**一笔之内**只报一次：拖拽期间每格都会失败，逐格弹提示会刷屏。
 *    （此前把标志挂在函数对象上，那属于"给函数加属性"的写法 ——
 *     与 REFACTOR §4.4 规则 4 要防的猴补丁是同一类坏味道，故改成模块级变量。）
 */
let warnedNoColor = false;

/** 工具的中文名（提示条与播报共用一份，避免两处文案各自漂移） */
const TOOL_LABEL = {
  [EDIT_TOOL.BRUSH]: '画笔',
  [EDIT_TOOL.ERASE]: '擦除',
  [EDIT_TOOL.PICK]: '吸管',
};

/** 编辑是否处于"可动手"状态（有图纸且选了工具） */
function editActive() {
  return state.editTool !== EDIT_TOOL.NONE && !!state.gridData;
}

// ------------------------------------------------------------
// 界面同步
// ------------------------------------------------------------

/**
 * 把工具栏 / 提示条 / 撤销重做按钮 / 简化滑块锁，全部对齐到当前 state。
 *
 * ⚠️ 收成**一个**函数、由 `setEditStateListener()` 统一触发，而不是在七八个地方
 *    各写一次"顺便更新一下按钮" —— 后者必然漏掉某条路径，
 *    表现就是"按钮状态与实际情况不符"（本仓库对这类漂移有专门记录）。
 */
function updateEditUI() {
  const tool = state.editTool;
  const active = editActive();

  for (const [el, value] of [[brushBtn, EDIT_TOOL.BRUSH], [eraseBtn, EDIT_TOOL.ERASE], [pickBtn, EDIT_TOOL.PICK]]) {
    const on = tool === value;
    el.classList.toggle('active', on);
    // ⚠️ 用 `aria-checked`（radiogroup 的单选语义），**不是** `aria-pressed`：
    //    这组按钮是单选的、"再按一次不取消"，与 `aria-pressed`（可切换）语义不符。
    //    详见 index.html 里这段工具栏的注释。
    el.setAttribute('aria-checked', on ? 'true' : 'false');
  }
  // 「退出编辑」只在真的进入编辑后出现 —— 常驻会让人以为编辑是默认状态
  exitEditBtn.hidden = !active;
  // 编辑模式下预览画布才接受指针手势（约束 1）；`touch-action` 靠这个 class 切换，
  // 否则触屏拖动会变成滚动页面、涂不上
  previewCanvas.classList.toggle('editing', active);

  // 当前画笔颜色：色号名是**文本**（色盲用户唯一能依赖的信息），色块只是辅助
  if (state.editColor) {
    editColorSwatch.style.background = state.editColor.hex;
    editColorSwatch.hidden = false;
    editColorName.textContent = state.editColor.name;
  } else {
    editColorSwatch.style.background = 'transparent';
    editColorSwatch.hidden = true;
    editColorName.textContent = '未选色';
  }

  undoBtn.disabled = !canUndo();
  redoBtn.disabled = !canRedo();

  editHint.textContent = editHintText();
  editHint.classList.toggle('edit-hint-warn', !!(active && tool === EDIT_TOOL.BRUSH && !state.editColor));

  // 手工编辑过 ⇒ 简化滑块必须锁住并说明原因（否则一拉滑块整份重算、编辑静默消失）
  refreshSamplingControls();
}

/**
 * 提示条文案。**必须能回答"现在点预览会发生什么"**，
 * 否则用户只能靠试错去发现工具没生效（本仓库一贯要求：静默失效不可接受）。
 */
function editHintText() {
  if (!state.gridData) return '';
  const tool = state.editTool;
  if (tool === EDIT_TOOL.NONE) {
    return '要修正算法判错的格子？点上面的「画笔」，再在预览图上点格子即可涂色。';
  }
  if (tool === EDIT_TOOL.PICK) {
    return '吸管：点预览图上的格子，取它的色号作为画笔颜色（空格子取不到色）。';
  }
  if (!state.editColor) {
    return '还没有选颜色：在上方「颜色统计」表里点某一行的「🖌 选为画笔色」，或用「吸管」从图上取色。';
  }
  if (tool === EDIT_TOOL.ERASE) {
    return `擦除：点或拖过预览图上的格子，把它清成空格（当前画笔色 ${state.editColor.name} 不受影响）。`;
  }
  return `画笔：点或拖过预览图上的格子，涂成 ${state.editColor.name}。`;
}

/** 播报一笔/一次撤销的结果（读屏用户看不到画布变化，必须听得到） */
function announceEditResult(what, cells) {
  if (!cells) return;
  announce(`${what} ${cells} 格，当前 ${state.colorCounts ? state.colorCounts.length : 0} 种颜色`);
}

/**
 * 刷新统计表，并**保住键盘焦点**。
 *
 * ⚠️ `renderStats()` 是整表 `innerHTML` 重建 —— 焦点会掉回 `<body>`。
 *    用户点的是「选为画笔色」，重建后那个按钮已经是**新节点**，
 *    不显式还原的话键盘用户立刻失去落点（约束 4 的另一半）。
 */
function refreshStatsKeepingFocus() {
  const el = document.activeElement;
  const keepName = el && el.classList && el.classList.contains('stats-pick-btn')
    ? el.dataset.name
    : null;
  renderStats();
  if (!keepName) return;
  const next = statsBody.querySelector(`.stats-pick-btn[data-name="${keepName}"]`);
  if (next) next.focus();
}

// ------------------------------------------------------------
// 编辑之后的收尾（重绘预览 + 统计）
// ------------------------------------------------------------

let editRedrawPending = false;
/**
 * 把预览重绘合并到每帧一次。
 *
 * 必要性：一次拖拽的 `pointermove` 可以每秒触发上百次，每次全画布重绘会明显卡顿。
 * 安全性依据与 `scheduleViewerRedraw()` 相同：`state.gridData` 在监听器里**已同步更新**，
 * 重绘只读 state，因此延迟到下一帧画的必然是最新内容。
 */
function scheduleEditRedraw() {
  if (editRedrawPending) return;
  editRedrawPending = true;
  requestAnimationFrame(() => {
    editRedrawPending = false;
    renderPreview();
  });
}

/** 一笔结束后的收尾：重绘 + 统计 + 按钮态 */
function commitStroke() {
  const changed = endStroke();
  if (changed) {
    renderPreview();
    refreshStatsKeepingFocus();
  }
  updateEditUI();
  return changed;
}

// ------------------------------------------------------------
// 指针交互：点 / 拖拽连续涂（PLAN §3.4 的"预览命中测试"）
// ------------------------------------------------------------

/** 把一次指针事件换算成格子行列号（几何全部来自 previewLayoutFor） */
function cellFromEvent(e) {
  // ⚠️ 没有图纸时**不能**直接读 `state.gridData[0]` —— 会抛 TypeError。
  //    真实路径上 `editActive()` 已挡住，但本函数也被逐帧的 pointermove 调用，
  //    多一道判空的成本远低于"运行时抛错、监听器静默失效"的排查成本。
  if (!state.gridData) return null;
  const layout = previewLayoutFor(state.gridData, state.rulerEnabled);
  // ⚠️ 约束 3：用 rect（CSS 像素），**不要**用 previewCanvas.width（已乘 dpr）
  const rect = previewCanvas.getBoundingClientRect();
  const localX = e.clientX - rect.left;
  const localY = e.clientY - rect.top;
  return hitTestCell(localX, localY, layout);
}

/** 对一格施加当前工具；返回是否真的改动了 */
function applyToolAt(cell) {
  if (!cell) return false;
  const res = paintCell(cell.row, cell.col);
  if (!res.ok && res.reason === 'no-color') {
    // 画笔没选色：一笔之内只提示一次，不刷屏（拖拽期间会连续触发）
    if (!warnedNoColor) {
      warnedNoColor = true;
      showToast('请先选颜色：在「颜色统计」里点「🖌 选为画笔色」，或用吸管从图上取色');
    }
    return false;
  }
  warnedNoColor = false;
  return !!res.changed;
}

/**
 * 把一次指针移动**经过**的所有格子都涂上（含前一个采样点到当前点的路径）。
 *
 * ⚠️ 只涂"事件落在哪一格"是不够的（实测踩到）：浏览器按帧派发 `pointermove`，
 *    快速拖动时两次事件之间会跨过好几格，图纸上就留下**断点**（画出来是虚线）。
 *    路径补全在 `cellsBetween()`（纯几何，与命中测试同模块）。
 */
function paintAlong(prev, cell) {
  let changed = false;
  if (prev) {
    for (const c of cellsBetween(prev, cell)) {
      if (applyToolAt(c)) changed = true;
    }
  }
  if (applyToolAt(cell)) changed = true;
  return changed;
}

previewCanvas.addEventListener('pointerdown', (e) => {
  // 约束 1：没进编辑模式就完全不接管（右键留给浏览器/其它逻辑）
  if (!editActive() || e.button === 2) return;
  const cell = cellFromEvent(e);
  if (!cell) return;   // 点在图纸之外：什么也不做（不夹取到边缘格）

  e.preventDefault();

  // 吸管是**一次性**动作：取完色自动切回画笔，用户下一步必然是要涂
  if (state.editTool === EDIT_TOOL.PICK) {
    const res = pickColorAt(cell.row, cell.col);
    if (!res.ok) {
      showToast(res.reason === 'empty-cell'
        ? '这一格是空格，没有颜色可取'
        : '这一格在图纸之外');
      return;
    }
    setEditTool(EDIT_TOOL.BRUSH);
    updateEditUI();
    announce(`已吸取颜色 ${res.color.name}，当前工具：画笔`);
    return;
  }

  painting = true;
  lastPainted = { row: cell.row, col: cell.col };
  // 开这一笔，**由 pointerup 收尾**（一次拖拽 = 一笔）。
  // ⚠️ `paintCell()` 在"没有进行中的一笔"时会自己补开一笔、并排一个微任务收掉它；
  //    那个微任务只收**它自己开的那一笔**（对象身份判据，见 `autoCloseStroke`），
  //    所以在这里先开一笔是安全的 —— 补开分支不会走到。
  strokeHandle = beginStroke();
  if (applyToolAt(cell)) scheduleEditRedraw();
  // 指针捕获：拖出画布再回来仍算同一笔（与选框拖拽同一处理）
  if (previewCanvas.setPointerCapture) previewCanvas.setPointerCapture(e.pointerId);
});

previewCanvas.addEventListener('pointermove', (e) => {
  if (!painting) return;
  const cell = cellFromEvent(e);
  if (!cell) return;
  // 同一格内的多次 pointermove 直接跳过：省掉一次无谓的路径计算。
  // ⚠️ 但**只有在没有中间路径**时才能跳 —— 慢速移动时两次事件常落在同一格，
  //    跳过它是安全的（前一次已经处理过这一格）。
  if (lastPainted && lastPainted.row === cell.row && lastPainted.col === cell.col) return;
  const prev = lastPainted;
  lastPainted = { row: cell.row, col: cell.col };
  if (paintAlong(prev, cell)) scheduleEditRedraw();
});

/** 抬笔 / 指针被系统取消（来电、手势返回）都要结掉这一笔，否则会漏掉一笔改动 */
function finishPainting() {
  if (!painting) return;
  painting = false;
  lastPainted = null;
  strokeHandle = null;
  warnedNoColor = false;
  const changed = commitStroke();
  if (changed) announceEditResult(state.editTool === EDIT_TOOL.ERASE ? '已擦除' : '已涂色', changed);
}

previewCanvas.addEventListener('pointerup', finishPainting);
previewCanvas.addEventListener('pointercancel', finishPainting);

// ------------------------------------------------------------
// 工具栏
// ------------------------------------------------------------

/**
 * 进入/切换工具。
 *
 * ⚠️ **点当前已选中的工具不退出编辑**（初版是"再点一次 = 退出"，实测后改掉）：
 *    实际走一遍就会撞到 —— 在颜色统计表点了「选为画笔色」之后会自动进入画笔态，
 *    用户接着想"我要用画笔"就会去点「🖌 画笔」按钮，而那时它**已经**是选中的，
 *    于是**静默退出了编辑**：接下来在预览图上怎么点都不改图。
 *    截图脚本（`shot-edit.js`）就是这么撞上的 —— 写脚本的人知道这个设计，
 *    仍然顺手点了第二下。真实用户更会。
 *
 *    改为"点工具 = 选中它"，与**所有绘图软件**的通行行为一致
 *    （Photoshop / Procreate / 画图：点当前工具不会退出该工具）。
 *    退出编辑有**显式**的「✕ 退出编辑」按钮，不需要复用工具按钮。
 */
function toggleTool(tool) {
  if (!state.gridData) {
    showToast('还没有图纸可编辑，请先上传图片生成图纸或载入一份存档');
    return;
  }
  // 已经是这个工具：重复点是**无操作**，不是退出（见上方说明）
  if (state.editTool === tool) return;
  setEditTool(tool);
  updateEditUI();
  if (tool === EDIT_TOOL.BRUSH && !state.editColor) {
    announce('画笔：请先在颜色统计表里选一个颜色');
  } else {
    announce(`已切换到${TOOL_LABEL[tool]}`);
  }
}

brushBtn.addEventListener('click', () => toggleTool(EDIT_TOOL.BRUSH));
eraseBtn.addEventListener('click', () => toggleTool(EDIT_TOOL.ERASE));
pickBtn.addEventListener('click', () => toggleTool(EDIT_TOOL.PICK));

exitEditBtn.addEventListener('click', () => {
  setEditTool(EDIT_TOOL.NONE);
  updateEditUI();
  announce('已退出单元格编辑');
});

// ------------------------------------------------------------
// 选色：颜色统计表（**选色入口就挂在那张表上**，见 stats.js 的说明）
// ------------------------------------------------------------
// ⚠️ 用**事件委托**而不是给每行的按钮绑定：统计表会被整表重建，
//    逐个绑定在每次重绘后都要重来一遍，漏一次的表现就是"按钮点了没反应"。
statsBody.addEventListener('click', (e) => {
  const btn = e.target.closest ? e.target.closest('.stats-pick-btn') : null;
  if (!btn) return;
  const name = btn.dataset.name;
  const entry = (state.colorCounts || []).find((c) => c.name === name);
  if (!entry) {
    // 统计表与网格不同步才会走到这里（正常路径不可达）—— 如实报告，不静默
    showToast('这个色号已不在当前图纸里，请重新选择');
    return;
  }
  setEditColor(entry);
  // 选了色就意味着要改：直接从"未进入编辑"进到画笔，省掉一次点击
  if (state.editTool === EDIT_TOOL.NONE) setEditTool(EDIT_TOOL.BRUSH);
  updateEditUI();
  announce(`已选择画笔颜色 ${name}`);
  showToast(`画笔颜色：${name}`);
});

// ------------------------------------------------------------
// 撤销 / 重做
// ------------------------------------------------------------

function doUndo() {
  const n = undoEdit();
  if (!n) { showToast('没有可撤销的编辑'); return; }
  renderPreview();
  refreshStatsKeepingFocus();
  updateEditUI();
  announceEditResult('已撤销', n);
}

function doRedo() {
  const n = redoEdit();
  if (!n) { showToast('没有可重做的编辑'); return; }
  renderPreview();
  refreshStatsKeepingFocus();
  updateEditUI();
  announceEditResult('已重做', n);
}

undoBtn.addEventListener('click', doUndo);
redoBtn.addEventListener('click', doRedo);

// 快捷键：Ctrl/Cmd+Z 撤销、Ctrl/Cmd+Shift+Z 重做（Ctrl+Y 是 Windows 的通行备选）
document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  const key = e.key ? e.key.toLowerCase() : '';
  if (key !== 'z' && key !== 'y') return;
  // 约束 5：输入框里的 Ctrl+Z 是文本框自己的撤销，不要抢
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  if (!state.gridData) return;
  const redo = key === 'y' || e.shiftKey;
  e.preventDefault();
  if (redo) doRedo(); else doUndo();
});

// ------------------------------------------------------------
// 与其它路径的接线
// ------------------------------------------------------------
// ⚠️ 本模块**不再导出** `exitEditMode()` / `dropEditHistory()` 这类转发函数：
//    "换文档"（`#resetBtn` / 重新上传 / 载入存档）与"重新生成图纸"三条路径
//    各自在别的特性域里，它们**直接调模型层的 `resetEditState()` /
//    `clearEditHistory()`**（`js/pipeline/edit.js`）。让它们反过来 import 本模块
//    会新增三条跨领域依赖边，而"模块间不得直接互相调用"是**已记录的待办、
//    不是可扩散的先例**（REFACTOR §4.4 规则 2）。
//    界面刷新由模型层的观察者通知兜住（见下），不需要它们记得调本模块 ——
//    **这正是把刷新收成唯一入口的价值**。

// 编辑态变化 → 统一刷新界面（模型层只管数据，不碰 DOM）。
// ⚠️ 这是**唯一**的界面同步入口：任何路径改了编辑态都会经它刷新，
//    所以不存在"某条分支忘了更新按钮"的可能（那类漂移只有用户能撞见）。
setEditStateListener(updateEditUI);

// ⚠️ **刻意不在模块顶层调一次 `updateEditUI()`**：
//    `refreshSamplingControls()` 读的是 `js/ui/grid-select.js` 的模块级变量，
//    而两个模块之间存在 import 边（grid-select → 本模块的依赖 edit.js）。
//    顶层调用会依赖"grid-select.js 的模块体先求值完"这一**隐式时序**，
//    一旦将来有人调整 import 顺序，症状是启动即抛 TDZ ReferenceError。
//    初始界面由 **index.html 静态声明**（按钮未选中、撤销/重做呈禁用、
//    提示条为空、色号显示"未选色"），与初始 state 本来就一致 ——
//    第一条 `updateEditUI()` 由真实的编辑动作触发（选色/切工具/撤销）。
