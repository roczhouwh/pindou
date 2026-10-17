import { state } from '../core/state.js';
import { rebuildColorCounts } from './simplify.js';

// ============================================================
// js/pipeline/edit.js — 单元格编辑的**模型层**（PLAN 第三批 6c / 6d）
// ============================================================
// 职责边界（与 6b 的三层分工同构，**不要互相越界**）：
//   · **本模块**            —— 改哪个格子、怎么改、撤销栈怎么记（**不碰 DOM**）
//   · `js/output/preview.js`—— 预览版面几何（`computePreviewLayout` / `hitTestCell`）
//   · `js/ui/edit-ui.js`    —— 指针事件 / 工具栏 / 统计表选色（**不自己改 gridData**）
//
// ⚠️ **四条硬约束**（`test-edit.js` + `probe-edit-mutation.js` 守护）：
//
// 1. **写入的格子必须是副本，不能直接塞色板对象**。
//    这是 PLAN §3.4「三重别名」缺陷的**第四个入口**（前三次：采样路径 / 反序列化 /
//    adoptGrid）。`state.editColor` 即使来自统计表（那是 `rebuildColorCounts` 的产物、
//    已经是副本），本模块仍逐次 `{ ...color }` —— 因为**调用方不可信**，
//    而一旦某个格子指向全局色板，下一次编辑就会就地改坏**所有后续生成的图**。
//
// 2. **撤销栈是独立的，绝不能用 `rawGridData`**（PLAN §5.1 明确要求）。
//    `rawGridData` 的语义是"**采样**原始值"，而载入存档后它**是 null**
//    （§3.7 的载入路径刻意不重建它）。拿它当撤销栈会在"无原图模式"下当场拿到 null。
//    本模块的栈只记**每次改动的前后值**，与数据来源无关。
//
// 3. **"改了但值没变"不许进栈**（同值画笔、拖过同一格两次）。
//    否则用户按一次撤销"什么都没发生"，会以为撤销坏了 ——
//    而这类"看起来坏了"的界面比直接报错更难排查。
//
// 4. **重新生成图纸必须清栈**（`clearEditHistory()`，由 `generateGridCore` 调用）。
//    新网格是**重新采样**的结果，旧编辑点已无对应关系；不清栈就会出现
//    "撤销一下，格子被改回**上一张图**的值"这种最难看懂的数据错乱。
//
// 本文件是原生 ES module：依赖由上方 import 显式声明。
// ⚠️ 本模块**不 import DOM、不 import 渲染** —— 它只认 `state.gridData` 与
//    `state.colorCounts`。这样它才能被测试直接驱动，也才不会被界面改动牵动。
// ============================================================

/** 编辑工具。`none` = 未进入编辑模式（预览画布不接管指针） */
export const EDIT_TOOL = {
  NONE: 'none',
  BRUSH: 'brush',
  ERASE: 'erase',
  PICK: 'pick',
};

/**
 * 撤销栈**最多保留的笔数**（一笔 = 一次按下到抬起之间的全部改动）。
 *
 * 有上限是必须的：一次长拖拽可以改掉上万个格子，每笔都留着会让内存随编辑时长
 * 无上限增长（104×104 全图改一遍约 1.1 万条记录）。超出后**丢弃最早的一笔** ——
 * 代价是"改得太多之后最早那几步撤不回去"，这比"越编辑越卡"更可接受。
 */
export const MAX_EDIT_STROKES = 100;

/**
 * 正在进行的这一笔（按下 → 抬起之间）。
 *
 * ⚠️ 它**刻意不放进 `state`**：它是"指针按住期间"的临时收集器，
 *    不是需要跨模块观察的状态（同 `viewer.js` 的 `viewerRedrawPending` 的处理）。
 *    `state` 里只放跨模块要读的字段（见 `js/core/state.js` 的编辑态三字段）。
 */
let stroke = null;

/**
 * 编辑态变化的**观察者**（由 `js/ui/edit-ui.js` 注册为"刷新工具栏/按钮/提示"）。
 *
 * ⚠️ 方向是 **UI 监听模型**，不是"模型反过来调 UI"：本模块**不 import 任何 UI 模块**，
 *    因此"谁改了编辑态"这件事不需要每个调用点都记得刷新界面 ——
 *    少写一处刷新，症状是"改了但按钮没变"，属于只有用户能撞见的那类漂移。
 *    这与 `state` 的"声明即契约"是同一思路。
 */
let editStateListener = null;

/** 注册编辑态变化的监听者（传 `null` 可注销）。 */
export function setEditStateListener(fn) {
  editStateListener = typeof fn === 'function' ? fn : null;
}

/** 通知监听者。⚠️ 只在**离散的**状态变化处调用（工具/颜色/一笔结束/撤销重做/清栈），
 *  不要在 `paintCell()` 里逐格调用 —— 拖拽时那是每格一次 DOM 全量刷新。 */
function notifyEditState() {
  if (editStateListener) editStateListener();
}

/** 取单元格的**色号名**用于等值判定；空格返回 `null` */
function cellName(cell) {
  return cell ? cell.name : null;
}

/** 两格是否"同一个颜色"（空格与空格也算相同）。判据是色号名，不是引用 */
function sameCell(a, b) {
  return cellName(a) === cellName(b);
}

/** 深拷贝一格（`null` 保持 `null`）。**所有写入路径都必须经过它**（硬约束 1） */
function copyCell(cell) {
  return cell ? { ...cell } : null;
}

/** 当前网格（无图纸时返回 null） */
function gridOrNull() {
  const grid = state.gridData;
  if (!Array.isArray(grid) || grid.length === 0) return null;
  if (!Array.isArray(grid[0])) return null;
  return grid;
}

/**
 * 行列号是否落在当前网格内（尺寸可能被 6b 的载入路径改成非正方形）。
 *
 * @param {number} row
 * @param {number} col
 * @param {number} [cols] 该网格的列数；省略时按**该行自身**的长度判断。
 *        ⚠️ 传 `cols` 的场合是"按最长行判定"（见 `paintCell` 的说明），
 *        因为网格的行长度理论上可能不一致，逐行判断会放过越界写。
 */
export function inBounds(row, col, cols) {
  const grid = gridOrNull();
  if (!grid) return false;
  if (!Number.isInteger(row) || !Number.isInteger(col)) return false;
  if (row < 0 || row >= grid.length) return false;
  const limit = Number.isInteger(cols) ? cols : grid[row].length;
  return col >= 0 && col < limit;
}

/**
 * 网格是否已应用过编辑（有编辑就必须禁用简化滑块，见 `js/ui/grid-select.js`）。
 *
 * ⚠️ 判据是 `editIndex > 0`（**还有未撤销的编辑**），不是 `editHistory.length > 0`：
 *    撤销掉全部编辑后简化滑块应当**恢复可用**，否则用户被永久锁住
 *    （`test-edit.js` 有对应断言）。
 */
export function hasAppliedEdits() {
  return state.editIndex > 0;
}

/** 能否撤销 / 重做 */
export function canUndo() {
  return state.editIndex > 0;
}
export function canRedo() {
  return state.editIndex < state.editHistory.length;
}

/** 把统计与网格对齐。**每次改动后都必须调用** —— 否则统计表与图纸说的不是同一件事 */
function syncColorCounts() {
  state.colorCounts = rebuildColorCounts(state.gridData);
}

/**
 * 设置画笔颜色。
 *
 * ⚠️ **存的是快照，不是调用方持有的那个对象**（逐字段拷贝）。
 *    调用方若传进 `PERLER_PALETTE` 里的对象（或任何它还会继续改的对象），
 *    不拷贝就会有两条独立的坏路径：
 *      ① 之后**任何人**改动那个对象，画笔色会被悄悄改掉；
 *      ② 与 `copyCell()` 配合，涂上去的格子会与全局色板共享引用 ——
 *         改一格就改坏**所有后续生成的图**（PLAN §3.4 三重别名）。
 *    故这里与 `copyCell()` 是**两道独立的防线**，由 `test-edit.js` 分别守护。
 *
 * @param {{name:string,hex:string,r:number,g:number,b:number}|null} color
 * @returns {{name:string,hex:string}|null} 实际记录下来的颜色（供界面显示色号）
 */
export function setEditColor(color) {
  state.editColor = color ? { ...color } : null;
  notifyEditState();
  return state.editColor ? { name: state.editColor.name, hex: state.editColor.hex } : null;
}

/**
 * 切换编辑工具。
 * ⚠️ 切换到画笔时若还没有颜色，**不静默失败** —— 由 UI 层提示用户先选色
 *    （见 `js/ui/edit-ui.js` 的 `toggleTool()`）。本函数只负责改状态。
 */
export function setEditTool(tool) {
  state.editTool = Object.values(EDIT_TOOL).includes(tool) ? tool : EDIT_TOOL.NONE;
  notifyEditState();
  return state.editTool;
}

// ------------------------------------------------------------
// 一笔编辑的生命周期
// ------------------------------------------------------------

/**
 * 开始一笔（指针按下）。重复调用会先**结掉**上一笔，避免留下悬空收集器
 * （指针事件在极端情况下可能丢 `pointerup`，那时宁可多记一笔，也不要丢改动）。
 *
 * ⚠️ **没有"显式/隐式"参数**（初版有，实测后删掉）：
 *    初版用 `beginStroke(explicit)` 记一个 `auto` 标志，用来决定"谁会被自动收尾"。
 *    但自动收尾是靠**对象身份**判断的（见 `autoCloseStroke`），而
 *    `paintCell()` 只在"当时没有进行中的一笔"时才开笔 ——
 *    也就是说**它开的每一笔都该被自动收尾**，标志位永远与身份判据同向。
 *    一个永远同向的标志位是**死代码**，而它还会误导读者以为它起了作用
 *    （突变测试实测：把它改成恒 `true` 不产生任何行为差异 —— 即 no-op 突变）。
 *
 * @returns {object} 这一笔的句柄。⚠️ **开笔方必须持有它** ——
 *        自动收尾靠对象身份判断该收哪一笔（见 `autoCloseStroke` 的说明）。
 */
export function beginStroke() {
  if (stroke) endStroke();
  stroke = { changes: [], seen: new Set() };
  return stroke;
}

/**
 * 当前是否有一笔正在进行（`beginStroke()` 之后、`endStroke()` 之前）。
 * 供 UI 判断"要不要由我来收尾"，也供测试核对生命周期。
 */
export function isStrokeOpen() {
  return stroke !== null;
}

/** 某一格是否已经在本笔里被处理过（供测试核对"同一笔不重复记账"） */
export function strokeHasCell(row, col) {
  return stroke ? stroke.seen.has(`${row},${col}`) : false;
}

/**
 * 把**当前工具**作用到某一格。
 *
 * 行为矩阵：
 * | 工具 | 行为 |
 * |---|---|
 * | `brush` | 涂成 `state.editColor`；**没有颜色时不涂也不擦**（返回 `no-color`） |
 * | `erase` | 置为空格 |
 * | `pick`  | **不改网格**（取色走 `pickColorAt()`），本函数直接返回 `pick` |
 * | `none`  | 不改（未进入编辑模式） |
 *
 * @param {number} row
 * @param {number} col
 * @param {number} [gridW] 当前网格的列数（**可选**，见下方 ⚠️）
 * @returns {{ok:boolean, reason?:string, changed?:boolean}} `changed` 表示**真的**改了值
 */
export function paintCell(row, col, gridW) {
  const grid = gridOrNull();
  if (!grid) return { ok: false, reason: 'no-grid' };
  if (state.editTool === EDIT_TOOL.NONE) return { ok: false, reason: 'no-tool' };
  if (state.editTool === EDIT_TOOL.PICK) return { ok: false, reason: 'pick' };
  // ⚠️ 不能只靠 `inBounds()`（它按**行**自身的长度判断）：网格里可能存在
  //    **参差不齐的行**（历史上载入过被截断的存档，或将来有别的来源），
  //    那样越界的写会静默造出一个新元素、或在严格模式下抛错。
  //    故再按"最长行"（= 网格应有的列数）夹一道。
  //    `gridW` 由调用方传入时以它为准（命中测试知道真实列数），否则取最长行。
  const cols = Number.isInteger(gridW)
    ? gridW
    : grid.reduce((m, r) => Math.max(m, r.length), 0);
  if (!inBounds(row, col, cols)) return { ok: false, reason: 'out-of-bounds' };

  let next;
  if (state.editTool === EDIT_TOOL.ERASE) {
    next = null;
  } else {
    // 画笔：没有颜色时**什么都不做**。若这里退化成"擦除"，用户会以为工具坏了
    if (!state.editColor) return { ok: false, reason: 'no-color' };
    next = copyCell(state.editColor);
  }

  const key = `${row},${col}`;
  // 无进行中的一笔时**自动开一笔**：`paintCell()` 是公开导出，脚本/测试/将来的
  // 别的入口都可能直接调它。若不自动开笔，那次改动就**永远不会进撤销栈** ——
  // 用户会看到"改是改了，但撤销不回去"，这是最难解释的一类不一致。
  // 自动开的一笔在当前微任务结束时收尾（见下方 queueMicrotask），
  // 因此"一次点击 = 一笔"，与 UI 路径的粒度一致。
  if (!stroke) {
    const auto = beginStroke();
    queueMicrotask(() => autoCloseStroke(auto));
  }
  // 同一笔里拖过同一格两次：只记第一次（硬约束 3）
  if (stroke.seen.has(key)) return { ok: true, changed: false };

  const before = grid[row][col];
  if (sameCell(before, next)) {
    // 值没变：不进栈（否则撤销会"点了没反应"）
    stroke.seen.add(key);
    return { ok: true, changed: false };
  }

  grid[row][col] = next;
  stroke.seen.add(key);
  stroke.changes.push({ row, col, before: copyCell(before), after: copyCell(next) });
  syncColorCounts();
  return { ok: true, changed: true };
}

/**
 * 吸管：取某一格的色号作为画笔颜色。
 * @returns {{ok:boolean, reason?:string, color?:object}} 空格返回 `empty-cell`
 *          （**不猜近似色** —— 与本仓库"未知色号留空 + 告知"的一贯要求一致）
 */
export function pickColorAt(row, col) {
  const grid = gridOrNull();
  if (!grid) return { ok: false, reason: 'no-grid' };
  if (!inBounds(row, col)) return { ok: false, reason: 'out-of-bounds' };
  const cell = grid[row][col];
  if (!cell) return { ok: false, reason: 'empty-cell' };
  // 取自网格的格子**也要再拷一份**：网格里的对象虽然已是副本，
  // 但吸管取到的引用一旦被别处复用，就会绕过硬约束 1 的防线
  const color = setEditColor(cell);
  return { ok: true, color };
}

/**
 * 结掉当前这一笔：有改动才入栈。
 *
 * ⚠️ **入栈时会截断"已撤销"的尾部**（标准撤销栈语义）：撤销两步后又画一笔，
 *    原来那两步的重做分支就该消失，否则重做会把用户带到一个他从未见过的状态。
 *
 * @returns {number} 本笔**真正改动**的格子数（0 = 这一笔什么也没改）
 */
export function endStroke() {
  if (!stroke) return 0;
  const changes = stroke.changes;
  stroke = null;
  if (!changes.length) return 0;

  state.editHistory.length = state.editIndex;
  state.editHistory.push({ changes });
  state.editIndex = state.editHistory.length;

  // 超出上限时丢最早的一笔。`editIndex` 同步前移，保证它仍等于"已应用笔数"
  while (state.editHistory.length > MAX_EDIT_STROKES) {
    state.editHistory.shift();
    state.editIndex--;
  }
  notifyEditState();
  return changes.length;
}

/**
 * 自动收尾**隐式**开出的那一笔（见 `paintCell` 的兜底）。
 *
 * ⚠️ 用**对象身份**判断，不要在收尾时读"当前这一笔"的标志位（实测踩到）：
 *    微任务是**延迟**执行的 —— `paintCell()` 排好微任务之后、它真正跑之前，
 *    调用方完全可能已经 `endStroke()` 又 `beginStroke(true)` 开了新的一笔。
 *    那时若只看 `stroke.auto`，就会把**新那一笔**提前结掉 ——
 *    表现是"有时一次拖拽被切成两笔，撤销要按两下"，且只在特定时序下复现。
 *    捕获当时那个对象即可让这个时序问题**不存在**。
 *
 * ⚠️ 只收隐式的一笔：**显式**的一笔（UI 在 `pointerdown` 里开的）必须活到
 *    `pointerup`，否则一次拖拽会被拆成许多笔、撤销只能一格一格退。
 *
 * ⚠️ 用微任务而不是宏任务（`setTimeout 0`）：微任务在**同一次同步调用栈**
 *    结束后立刻跑，把"连续同步调用多次 `paintCell`"正确地归为一笔，
 *    而 `setTimeout` 会被中间插入的其它宏任务切碎成多笔。
 */
function autoCloseStroke(target) {
  if (stroke && stroke === target) endStroke();
}

// ------------------------------------------------------------
// 撤销 / 重做
// ------------------------------------------------------------

/**
 * 撤销一笔。**逐格还原成改动前的值**（含 `null` 空格）。
 * @returns {number} 被还原的格子数（0 = 没有可撤销的）
 */
export function undoEdit() {
  if (!canUndo()) return 0;
  const batch = state.editHistory[state.editIndex - 1];
  const grid = gridOrNull();
  if (!grid) return 0;
  // 倒序还原：同一笔里同一格只会出现一次，但倒序让语义与"回放的反向"一致
  for (let i = batch.changes.length - 1; i >= 0; i--) {
    const ch = batch.changes[i];
    if (!inBounds(ch.row, ch.col)) continue;
    grid[ch.row][ch.col] = copyCell(ch.before);
  }
  state.editIndex--;
  syncColorCounts();
  notifyEditState();
  return batch.changes.length;
}

/**
 * 重做一笔。
 * @returns {number} 被重新应用的格子数（0 = 没有可重做的）
 */
export function redoEdit() {
  if (!canRedo()) return 0;
  const batch = state.editHistory[state.editIndex];
  const grid = gridOrNull();
  if (!grid) return 0;
  for (const ch of batch.changes) {
    if (!inBounds(ch.row, ch.col)) continue;
    grid[ch.row][ch.col] = copyCell(ch.after);
  }
  state.editIndex++;
  syncColorCounts();
  notifyEditState();
  return batch.changes.length;
}

// ------------------------------------------------------------
// 清栈
// ------------------------------------------------------------

/**
 * 清空撤销栈（**重新生成图纸时必须调用**，硬约束 4）。
 *
 * @returns {number} 被丢弃的**已应用笔数**（0 = 本来就没有编辑）。
 *          返回值交给调用方决定要不要提示用户 —— 本模块不弹提示（它不碰 DOM）。
 *          ⚠️ 这一提示**不能省**：重新生成会静默抹掉用户的手工修正，
 *          而"我改的地方自己变回去了"是最容易被归因为"这工具坏了"的一类。
 */
export function clearEditHistory() {
  const applied = state.editIndex;
  state.editHistory.length = 0;
  state.editIndex = 0;
  stroke = null;
  notifyEditState();
  return applied;
}

/**
 * 完整复位编辑态（历史 + 工具 + 画笔颜色）。
 *
 * 用在"换了一张图 / 重置"这类**换文档**的路径上（见 `js/ui/edit-ui.js` 的
 * `exitEditMode()`，它另外负责把按钮与色卡同步回界面）。
 * ⚠️ 与 `clearEditHistory()` 分开是**刻意的**：重新生成图纸只该清历史，
 *    不该把用户正在用的工具与颜色也一并抹掉（他多半还要接着改）。
 */
export function resetEditState() {
  clearEditHistory();
  state.editTool = EDIT_TOOL.NONE;
  state.editColor = null;
  // ⚠️ 必须**再**通知一次：`clearEditHistory()` 里那次通知发生时，
  //    工具与画笔色还是旧值。少了这一条，界面会停在"工具仍选中、
  //    色号仍显示上一次的色"的状态，而 state 已经复位 —— 界面在说谎。
  notifyEditState();
}
