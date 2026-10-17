// ⚠️ **必须写成单行具名 import**：`lint-noundef.js` 的解析器只认这一种形态
//    （它刻意对其它形态返回 null 并报错，以防"静默漏检"）。
//    写成多行会让静态检查直接 SyntaxError —— 实测踩到。
import { archiveBanner, archiveHint, archiveName, archiveSelect, controlsSection, deleteArchiveBtn, loadArchiveBtn, saveArchiveBtn, selectionBox, uploadSection, viewerSection } from '../core/dom.js';
import { state } from '../core/state.js';
import { MAX_ARCHIVES, deleteArchive, readArchive, readLibrary, saveArchive } from '../core/storage.js';
import { showToast } from '../input/upload.js';
import { adoptGrid } from '../pipeline/grid.js';
import { resetEditState } from '../pipeline/edit.js';
import { announce, markActiveGridBtn } from './a11y.js';
import { resetSimplify, setSamplingControlsEnabled } from './grid-select.js';

// ============================================================
// js/ui/library.js — 图纸存档的**界面层**（PLAN 第三批 6b）
// ============================================================
// 三段职责清晰分层，本模块只做中间那一段：
//   · `js/core/serialize.js`（6a）—— 存什么、怎么版本化（纯函数）
//   · `js/core/storage.js`  （6b）—— 存到哪、多份怎么管理（不碰 DOM）
//   · **本模块**                —— 按钮/列表/提示，以及**载入后的界面切换**
//
// ⚠️ 载入路径**不能走 `showViewer()`** —— 它依赖 `state.image`，
//    而 `generateGridCore()` 在无图时直接早返回（PLAN §5.1 开工前就记录的结构缺口）。
//    故本模块自己走一条**不经过 viewer 的展示路径**：直接亮
//    `#controlsSection` + `#previewSection` + `#statsSection`（后两者由
//    `adoptGrid()` 的收尾点亮，与图片生成路径共用同一份收尾，不抄第二遍）。
//
// ⚠️ 本模块**不自己拼网格、不自己造存档格式**：一份图纸从"网格"到"文本"
//    只经 `storage.js`，从"文本"到"网格"也只经 `storage.js`。
//    在这里就地 `JSON.stringify` 会立刻产生第二份格式定义（版本号、字段名各写一遍），
//    而存档格式一旦分叉，用户的存档就会在两条路径下读出不同的结果。
//
// 本文件是原生 ES module：依赖由上方 import 显式声明。
// ============================================================

/**
 * 最近一次 `readLibrary()` 得到的"存储是否可用且未损坏"。
 *
 * ⚠️ 它**只用于提示文案与点击时的确切原因**，**不**用来预设「保存」按钮的
 *    禁用态 —— 那条规则只有一个：「与 `downloadBtn` 同启用时机」
 *    （都表示"已有一张图纸"），由网格生成/重置路径统一设置。
 *    理由见 `saveCurrentArchive()` 的说明。
 */
let storageUsable = false;

/** 把一份存档的展示元数据格式化成下拉项的文字 */
function formatItemLabel(it) {
  const when = new Date(it.savedAt || 0);
  const stamp = Number.isNaN(when.getTime())
    ? ''
    : `${when.getMonth() + 1}/${when.getDate()} ${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`;
  // 同名存档是允许的（见 storage.js 的说明），故标签里带上尺寸与时间以便区分
  return `${it.name} · ${it.cols}×${it.rows}${stamp ? ` · ${stamp}` : ''}`;
}

/**
 * 重建存档下拉列表与相关按钮态。
 * 在页面初始化、保存后、删除后、载入后都会调用一次。
 */
export function refreshArchiveList() {
  const lib = readLibrary();
  // ⚠️ 用 `writable`（能不能写），**不是** `available`（能不能读）：
  //    空间写满时读得到、写不进，列表与删除必须照常可用 ——
  //    删掉几份是用户唯一的自救手段（见 storage.js 的 readLibrary 说明）。
  storageUsable = lib.available && lib.writable && !lib.corrupt;

  // 记住当前选中项，刷新后尽量保持（否则删一份之后选中项会跳到第一项，
  // 用户再点删除就删错了对象 —— 删除是不可撤销的）
  const prev = archiveSelect.value;

  archiveSelect.textContent = '';
  const opts = [];
  if (!lib.available) {
    opts.push({ value: '', label: '（本浏览器不允许本地存储）' });
  } else if (lib.corrupt) {
    opts.push({ value: '', label: '（本机存档数据已损坏，已暂停读写）' });
  } else if (lib.items.length === 0) {
    opts.push({ value: '', label: lib.writable ? '（还没有保存过图纸）' : '（存储空间已满）' });
  } else {
    for (const it of lib.items) opts.push({ value: it.id, label: formatItemLabel(it) });
  }
  for (const o of opts) {
    const el = document.createElement('option');
    el.value = o.value;
    el.textContent = o.label;
    archiveSelect.appendChild(el);
  }
  if (prev && opts.some((o) => o.value === prev)) archiveSelect.value = prev;

  // ⚠️ 载入与删除只看"列表里有没有条目"，**不看能不能写** ——
  //    写满时正是要靠删除来自救（见上方说明）。
  const hasItems = lib.available && !lib.corrupt && lib.items.length > 0;
  loadArchiveBtn.disabled = !hasItems;
  deleteArchiveBtn.disabled = !hasItems;

  // 提示优先说"出了什么问题"（不可用/损坏/写满/有条目损坏），
  // 没问题时才说"存了几份" —— 不能让一句"已保存 3 份"盖住一条错误。
  // ⚠️ 写满时还要**明确指路**（"删除不再需要的存档"），因为此时删除键是亮的，
  //    用户照着做就能恢复 —— 只说"空间已满"会让人以为没救了。
  if (lib.error) {
    archiveHint.textContent = lib.error
      + (lib.available && !lib.writable && lib.items.length
        ? ` 下面这 ${lib.items.length} 份仍可载入或删除，删除后即可继续保存。`
        : '');
    archiveHint.hidden = false;
  } else if (lib.items.length) {
    archiveHint.textContent = `本机已保存 ${lib.items.length} 份图纸（上限 ${MAX_ARCHIVES} 份）`;
    archiveHint.hidden = false;
  } else {
    archiveHint.textContent = '图纸只保存在本机浏览器里，不会上传到任何服务器';
    archiveHint.hidden = false;
  }
}

/**
 * 退出「无原图模式」（载入存档后的状态）。
 *
 * 调用点只有一个：`showViewer()` —— 它是**任何**载入原图的路径的唯一必经之处
 * （`handleFile()` 只在那里收尾）。收在必经之路上，才不会出现
 * "上传了新图、横幅还挂着、控件还是灰的"这类只在某条分支上出现的残留态。
 *
 * ⚠️ **不做"没进过存档模式就早返回"的优化**：那需要靠另一个标志位记住当前模式，
 *    于是"模式标志"与"横幅实际显隐"成了两份状态，两者一旦不同步，
 *    控件就会永久灰着且没有任何提示 —— 正是本模块最该避免的故障形态。
 *    这里的操作都是幂等的（置 hidden / 置空文案 / 逐个启用控件），直接每次做完。
 */
export function exitArchiveMode() {
  archiveBanner.hidden = true;
  archiveBanner.textContent = '';
  // 恢复依赖原图的控件（读取 state.simplify 以重算滑块读数）
  setSamplingControlsEnabled(true);
}

/**
 * 进入「无原图模式」：清空原图，直接展示一份**已载入的图纸**。
 *
 * 6b 开工前与用户确认的产品决策：**清空原图**（而不是保留）。
 * 理由：存档按 6a 的定案只含图纸本身、**不含选框** —— 保留原图会让
 * "选框框住的区域"与"图纸内容"对不上，界面自相矛盾。
 */
function enterArchiveMode(meta) {
  state.image = null;
  state.imageW = 0;
  state.imageH = 0;
  selectionBox.classList.remove('visible');

  // ⚠️ 不经过 showViewer()：它依赖 state.image，且会把 preview/stats 关掉。
  //    这里只负责"上传区留在原处（用户可重新上传续调）+ 控制栏亮起"，
  //    preview / stats 的显隐交给 adoptGrid() 的收尾（与图片路径同一份实现）。
  viewerSection.hidden = true;
  uploadSection.hidden = false;        // 留着上传区，用户才能"重新上传原图继续调"
  controlsSection.hidden = false;

  // 载入的图纸没有走过采样 ⇒ simplify 必须归零（它是**图像参数**，见 state.js 三类划分）
  resetSimplify();
  // 编辑态复位：载入的是**另一份图纸**，上一张图的撤销栈在这里没有对应关系
  // （尺寸都可能不同）。`adoptGrid()` 里也会清一次 —— 两处都不省：
  // 那是"接管任何外部图纸"的公共入口，将来别的来源同样需要它。
  resetEditState();
  // 依赖原图重新采样的控件全部禁用（网格尺寸 / 自定义 / 简化滑块）
  setSamplingControlsEnabled(false);

  archiveBanner.textContent =
    `已载入存档「${meta.name}」（${meta.cols}×${meta.rows}），当前没有原图：`
    + `网格尺寸与颜色简化需要重新采样原图，暂时不可用。上传一张图片即可继续调整。`;
  archiveBanner.hidden = false;
}

/** 把当前网格对应的网格尺寸按钮点亮（预设之外的尺寸则全部熄灭） */
function markActiveForSize(cols, rows) {
  const hit = Array.from(document.querySelectorAll('.grid-btn'))
    .find((b) => b.dataset.w === String(cols) && b.dataset.h === String(rows));
  if (hit) {
    markActiveGridBtn(cols);
    return;
  }
  // 自定义尺寸（如 20×60）不匹配任何预设 ⇒ 必须清掉 active，
  // 否则会留着上一个预设的高亮，界面在说谎
  for (const b of document.querySelectorAll('.grid-btn')) {
    b.classList.remove('active');
    b.setAttribute('aria-pressed', 'false');
  }
}

/** 保存当前图纸。供按钮调用，也供测试直接调用。 */
export function saveCurrentArchive() {
  if (!state.gridData) {
    showToast('还没有可保存的图纸，请先上传图片生成图纸');
    return null;
  }
  let saved;
  try {
    saved = saveArchive(archiveName.value, state.gridData);
  } catch (err) {
    // ⚠️ 用 showToast，不用 showError：后者写进 #uploadError（在 #uploadSection 内），
    //    而载入存档后上传区**是可见的**、上传图片后它又是隐藏的 ——
    //    跨阶段都要能看见的提示只有 toast 一个（CLAUDE.md 有专门的坑记录）。
    //    ⚠️ 这里**不做"存储不可用就提前返回"**：是否可用由 `saveArchive()` 实测
    //       （它内部会真写一次探针键），本模块缓存的那个布尔值只用于**提示文案**。
    //       多写一条前置判断的后果是"两处口径可能不一致"，而其中一处会静默挡住另一处。
    showToast(err && err.message ? err.message : '保存失败');
    return null;
  }
  refreshArchiveList();
  // 选中刚保存的那一份：用户接着点「载入/删除」时，对象正是他刚存的那份
  archiveSelect.value = saved.id;
  showToast(`已保存存档「${saved.name}」（${saved.cols}×${saved.rows}）`);
  return saved;
}

/**
 * 载入选中的存档。
 *
 * 抛错一律**转述原文**（`SerializeError` / `StorageError` 的 message 都是给用户看的中文），
 * 不吞成一句"载入失败" —— 用户需要知道是"版本过新"还是"内容损坏"，
 * 两者的下一步动作完全不同（升级程序 vs 放弃这份存档）。
 */
export function loadSelectedArchive() {
  const id = archiveSelect.value;
  if (!id) {
    showToast('请先在下拉框中选择一份存档');
    return null;
  }
  let parsed;
  try {
    parsed = readArchive(id);
  } catch (err) {
    showToast(err && err.message ? err.message : '载入存档失败');
    return null;
  }

  enterArchiveMode({ name: parsed.name, cols: parsed.cols, rows: parsed.rows });
  const size = adoptGrid(parsed.grid);
  markActiveForSize(size.cols, size.rows);
  refreshArchiveList();
  // 刷新会把选中项尽量保持住（见 refreshArchiveList）
  archiveSelect.value = id;

  // ⚠️ 未知色号必须**如实告知**（6a 的硬约束 4：该格留空 + warnings，不猜近似色）。
  //    猜色会让用户按图买的色号与实际不符，比留空更难发现。
  if (parsed.warnings.length) {
    const list = parsed.warnings.map((w) => `${w.name}×${w.count}`).join('、');
    showToast(
      `存档里有 ${parsed.warnings.length} 个色号在当前色板中不存在（${list}），`
      + '对应格子已留空。请对照原图确认这几处。'
    );
  }
  announce(`已载入存档「${parsed.name}」：${size.cols}×${size.rows} 网格，`
    + `${state.colorCounts ? state.colorCounts.length : 0} 种颜色；当前没有原图，`
    + '网格尺寸与颜色简化暂不可用');
  return size;
}

/** 删除选中的存档（**不可撤销**，故先确认）。 */
export function deleteSelectedArchive() {
  const id = archiveSelect.value;
  if (!id) return false;
  const label = archiveSelect.options[archiveSelect.selectedIndex]
    ? archiveSelect.options[archiveSelect.selectedIndex].textContent
    : '这份存档';
  // ⚠️ 删除是**不可撤销**的：必须先报告对象再执行（仓库纪律：清理数据前先报告）。
  //    confirm 的返回值在无头环境里恒为 undefined（jsdom 未实现），
  //    故测试要显式替换 window.confirm 才能验到"真的删掉了"那条分支 ——
  //    这是**刻意的**：默认行为绝不能是"静默删除"。
  const ok = typeof window !== 'undefined' && typeof window.confirm === 'function'
    ? window.confirm(`确定删除存档「${label}」吗？此操作无法撤销。`)
    : false;
  if (!ok) return false;

  let removed = false;
  try {
    removed = deleteArchive(id);
  } catch (err) {
    showToast(err && err.message ? err.message : '删除失败');
    return false;
  }
  refreshArchiveList();
  if (removed) showToast('已删除该份存档');
  else showToast('这份存档已不存在（可能已在别处删除）');
  return removed;
}

// ------------------------------------------------------------
// 按钮装配（随模块一起求值；**不要漏** ——
// 漏了的表现就是"点保存/载入没反应"，与 export.js 漏装配 downloadBtn 同类）
// ------------------------------------------------------------
saveArchiveBtn.addEventListener('click', () => { saveCurrentArchive(); });
loadArchiveBtn.addEventListener('click', () => { loadSelectedArchive(); });
deleteArchiveBtn.addEventListener('click', () => { deleteSelectedArchive(); });
// 输入框回车即保存：这是表单类界面的通行预期，也省得用户在触屏上瞄准按钮
archiveName.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    saveCurrentArchive();
  }
});

// 初始化：把列表与按钮态与真实存储对齐（此时还没有图纸，保存按钮自然是灰的）
refreshArchiveList();
