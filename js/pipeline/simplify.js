// ============================================================
// js/pipeline/simplify.js — 颜色简化（含常开近似色合并）
// ============================================================
// 自 app.js 的「5.5 颜色简化」整段搬迁而来（REFACTOR §7.1 步骤 5），
// 偿还 REFACTOR §4.4 记录的**第 1 笔技术债**：
//   applySimplify / rebuildColorCounts / getStaticMergeMap / staticMergeCache
//   此前未按规则 1 落位到本文件。
//
// ⚠️ 两条硬约束（test-simplify.js 的 14 条断言 + 突变测试守护，不要改回去）：
//   ① 决胜规则是「**色板序号较小者优先**」，**不是频率** ——
//      按频率决胜会让同一张图换网格尺寸后色号漂移（实测 29×29 得 E16、52×52 得 H12）。
//   ② 合并表必须是「**静态色板级**」（只看色板，与图上出现哪些色无关），
//      否则上述漂移会重新出现。判据要用**纯 H12 图**（图上没有 E16 才区分得出来）。
//
// ⚠️ `AUTO_MERGE_DIST_SQ` 仍留在 app.js（它靠近顶部的常量区）。
//
// 当前阶段仍用裸 <script> src 加载（步骤 0 未做），故本文件不使用 import/export，
// 顶层声明与其它文件共享同一全局词法环境。
// ============================================================
// ============================================================
// 5.5 颜色简化 — 合并映射后的相近颜色
// ============================================================

/**
 * 深拷贝一份网格：行数组与格子对象都不共享。
 * 关键点是格子对象 —— `findNearestColor()` 返回的是 PERLER_PALETTE 里的
 * 对象引用，浅拷贝会让格子仍然指向全局色板（见 REVIEW.md n7）。
 */
function cloneGrid(grid) {
  return grid.map((row) => row.map((cell) => (cell ? { ...cell } : null)));
}

/** 从 gridData 重建 colorCounts */
function rebuildColorCounts(grid) {
  const map = new Map();
  for (const row of grid) {
    for (const cell of row) {
      if (!cell) continue;
      const key = cell.hex;
      if (!map.has(key)) map.set(key, { ...cell, count: 0 });
      map.get(key).count++;
    }
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

/**
 * 基于 rawGridData 重新计算简化后的 gridData 和 colorCounts。
 *
 * 合并分**两层**，这是 PLAN §3.1 定下的结构（勿合并回单一层）：
 *
 * ┌ ① **常开近似色合并** —— 恒定为 `AUTO_MERGE_DIST_SQ`（dist ≤ 4），与滑块无关。
 * │   针对的是**色板自身的缺陷**：221 色里存在几对肉眼无法分辨的近同色
 * │   （最近一对 E16/H12 距离仅 2.83），最近邻匹配会在它们之间抖动，
 * │   凭空多出色号 → 污染统计、抬高采购量、预览出噪点。
 * │   滑块拉回 0 也**仍然生效** —— 这不是用户的强度选择，而是数据修正。
 * │   旧实现在 `threshold <= 0` 时直接早返回、完全跳过合并循环，
 * │   所以默认状态（simplify=0）下这些近同色对**原样存在** —— 这正是本次要修的。
 * │
 * └ ② **滑块合并** —— `simplify > 0` 时的用户主动压缩，在层 ① 之上继续合并。
 *
 * ⚠️ **决胜规则：色板序号较小者优先，不按采样频率**（PLAN §3.1 已决）。
 * 旧实现按频率决胜（低频并入高频），后果是**同一张图换网格尺寸后色号会漂移** ——
 * 采样网格一变、频率排序就变、主色随之改变。实测证据（改动前基线，可复现）：
 * 同一张近白测试图在 `simplify=30%` 下，**29×29 得 `E16`、52×52 得 `H12`**。
 * 用户按 29×29 的图纸买了 E16，改看 52×52 时色号变成 H12 —— 对按图采购是硬伤。
 * 「色号可复现」是图纸工具的基本要求，故改用固定规则。
 *
 * ⚠️ **合并关系是"静态色板级"，与图上出现了哪些色无关**（见 `getStaticMergeMap`）。
 * 这是上一条能成立的**前提**，不是可选优化：若改成"只在图上出现过的色里选目标"，
 * 则同一张图 29×29 可能只出现 H12（图内无 E16 可并，H12 保留）、
 * 52×52 同时出现两者（H12 并入 E16）—— **漂移依旧存在**，等于白改。
 */
function applySimplify() {
  const threshold = state.simplify;
  const raw = state.rawGridData;
  if (!raw) return;

  // 合并阈值：层 ① 常开；层 ② 仅在用户拖动滑块时叠加。
  // 取两者的较大值 —— 滑块调到小档位（如 1% → 平方 50）不应把层 ① 反而关掉。
  const sliderDistSq = threshold > 0 ? (threshold / 100) * 5000 : 0;
  const maxDistSq = Math.max(AUTO_MERGE_DIST_SQ, sliderDistSq);
  if (maxDistSq <= 0) {
    // 当前不可达（AUTO_MERGE_DIST_SQ 恒 > 0），保留以防该常量将来被改成 0。
    // 早返回会让 gridData 停留在旧值、与新的 simplify 不一致 ——
    // 必须补齐 state 同步，而不是留一个静默退出（见 REVIEW.md m13）
    state.gridData = cloneGrid(state.rawGridData);
    state.colorCounts = state.rawColorCounts;
    state.mergedColors = [];
    return;
  }

  const rows = raw.length;
  const cols = raw[0].length;

  // 深拷贝一份原始网格（格子对象也要独立，见 cloneGrid 注释）
  const grid = cloneGrid(raw);

  const mergeMap = getStaticMergeMap(maxDistSq);

  // 执行合并
  const paletteMap = new Map(PERLER_PALETTE.map(p => [p.hex, p]));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = grid[r][c];
      if (cell && mergeMap.has(cell.hex)) {
        const tgt = paletteMap.get(mergeMap.get(cell.hex));
        // 拷贝而非直接引用色板对象：直接赋值会让 gridData 里混入全局色板引用，
        // 将来单元格编辑会就地改坏色板（见 REVIEW.md n7）
        if (tgt) grid[r][c] = { ...tgt };
      }
    }
  }

  // 记录被丢弃的**色号名**，供 renderPreview 如实告知用户。
  // 只记图上**确实出现过**且被并掉的 —— 不夸大影响：
  // 色板级合并在阈值 4 时会并掉 4 个色号，但一张图通常只涉及其中一两个。
  const mergedColors = [];
  const seenHex = new Set();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = raw[r][c];
      if (!cell || seenHex.has(cell.hex)) continue;
      seenHex.add(cell.hex);
      if (!mergeMap.has(cell.hex)) continue;
      const src = paletteMap.get(cell.hex);
      const dst = paletteMap.get(mergeMap.get(cell.hex));
      if (src && dst) mergedColors.push({ from: src.name, to: dst.name });
    }
  }

  state.gridData = grid;
  state.colorCounts = rebuildColorCounts(grid);
  // 按源色号名排序，保证提示文案稳定（不随扫描顺序变化）
  state.mergedColors = mergedColors.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
}

/**
 * `getStaticMergeMap()` 的阈值 → 合并表缓存。
 *
 * 必要性：滑块 `input` 会随拖动连续触发，而每次算表都要做 221²/2 ≈ 24,310 次
 * 距离比较。滑块取值有限（0-100 共 101 档，外加常开层 1 档），缓存后
 * 每个阈值只算一次。
 *
 * ⚠️ 必须声明在 `getStaticMergeMap()` **之前**：`const` 有暂时性死区（TDZ），
 * 声明在使用之后虽然当前调用时序不会踩到，但一旦将来有代码在脚本加载完成前
 * 触发合并，就会抛 ReferenceError。顺序即契约，不要调换。
 */
const staticMergeCache = new Map();

/**
 * **静态色板级**合并表：`source hex → target hex`。
 * 只由色板本身与阈值决定，与当前图片、采样尺寸、颜色频率**全部无关**。
 *
 * 这就是"色号可复现"的实现基础：同一张图不论导出成 29×29 还是 104×104，
 * 每个格子都查同一张映射表，不存在"换个尺寸色号就变"的可能。
 *
 * 规则：对每个色板颜色 p，在**序号比它小**的色板颜色中找最近者 q；
 * 距离 ≤ 阈值则 p → q。等价于"**色板序号较小者优先**"（PLAN §3.1 已决）。
 * 最后做链式解析（p→q, q→r ⇒ p→r），带环保护。
 *
 * **副作用（已实测确认并接受）**：会有若干色号**永久不可达** ——
 * 阈值 4 时是 4 个（`G18/H12/H17/H21`），阈值 6 时 9 个。
 * 这是"固定规则决胜"的必然代价：任何固定规则都会让输的一方不可达；
 * 换来的是跨分辨率一致，且被并掉的两色**肉眼无法分辨**（实测距离 ≤ 4；
 * 本仓库实测 `dist < 4` 全色板仅 3 对）。数据见 `probe-nearcolor.js`。
 *
 * @param {number} distSq 平方距离阈值（`colorDistance()` 的量纲）
 * @returns {Map<string, string>} 源色号 hex → 目标色号 hex
 */
function getStaticMergeMap(distSq) {
  const cached = staticMergeCache.get(distSq);
  if (cached) return cached;

  const rawMap = new Map(); // idx → idx（未解析链）
  for (let i = 0; i < PERLER_PALETTE.length; i++) {
    const p = PERLER_PALETTE[i];
    let bestSq = Infinity;
    let best = -1;
    // 只在**序号更小**的候选里找 —— 这就是"序号小者胜出"的实现方式
    for (let j = 0; j < i; j++) {
      const d = colorDistance(p, PERLER_PALETTE[j]);
      if (d < bestSq) { bestSq = d; best = j; }
    }
    if (best >= 0 && bestSq <= distSq) rawMap.set(i, best);
  }

  // 链式解析：i→j, j→k ⇒ i→k
  const resolved = new Map();
  for (const [i, j0] of rawMap) {
    let cur = j0;
    const seen = new Set([i]);
    while (rawMap.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      cur = rawMap.get(cur);
    }
    resolved.set(PERLER_PALETTE[i].hex, PERLER_PALETTE[cur].hex);
  }

  staticMergeCache.set(distSq, resolved);
  return resolved;
}
