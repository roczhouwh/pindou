import { PERLER_PALETTE } from '../../color-palette.js';

// ============================================================
// js/core/serialize.js — 图纸序列化 / 版本化地基
// ============================================================
// PLAN 第三批第 6 项的**第一步（6a）**：只有纯函数，**不接 UI、不接 localStorage**。
// 下游两步依赖它：网格保存/加载（6b）、单元格编辑 + 撤销/重做（6c/6d）。
//
// ------------------------------------------------------------
// ⚠️ 为什么先做地基、且做成纯函数
// ------------------------------------------------------------
// 存档格式一旦落盘就很难改（用户的存档在别人的浏览器里），所以"存什么、怎么版本化"
// 必须先于存储层与 UI 定下来。做成纯函数则让它与 6b 的存储选型**解耦** ——
// 无论 6b 用 localStorage、IndexedDB 还是导出成文件，本模块一字不改。
//
// ------------------------------------------------------------
// ⚠️ 存档的边界 = state.js 的「① 图纸文档」类，**只有 gridData**
// ------------------------------------------------------------
// 见 js/core/state.js 里「字段三类划分」的长注释。判据是那一句：
// **"换一台设备打开，这个值还应不应该一样？"**
//   · 进存档：`gridData`（行列数由它的维度导出，**不另存**）
//   · 不进存档：显示偏好（rulerEnabled / printColorBlocks）、
//     图像参数（simplify）、一次性视图态（selection / zoom / pan …）
//
// 由此产生的**两个已确认接受的后果**（不要在 6b 里偷偷补回来）：
//   ① `simplify` 不入档 ⇒ 加载后无法复现当初的简化强度；
//   ② `rawGridData` 不入档 ⇒ 它是"**采样**的原始值"的语义，不是"加载出来的图纸的原始值"。
//      **加载存档后简化滑块该可用还是该禁用，是 6b 的产品决策**，本模块不预设
//      （既不要在 deserialize 里补一个 rawGridData 充数，也不要在这里禁用它）。
//
// ------------------------------------------------------------
// ⚠️⚠️ 格子的身份用**色号名**（`"A10"`），不用色板下标 —— 这是硬约束
// ------------------------------------------------------------
// 实测本仓库 104×104 网格的序列化体积：
//   · 完整格子对象 `{name,hex,r,g,b}` → **584KB**
//   · 色板下标数组                     → 32KB
//   · **色号名数组（本模块采用）**      → 约 65KB
// 下标最省，但它把存档**绑死到 PERLER_PALETTE 的排列顺序**上：色板一旦增删/重排，
// 老存档里的 `17` 就静默指向了另一个颜色 —— 图纸会**悄悄变色**且无法察觉。
// 这正是 PLAN §2.3 给「色板自定义编辑」标注的版本化风险。
// 65KB 对 localStorage（通常 5MB 配额）完全可承受，换来的是"改色板不会改坏老存档"。
// **不要为了省 33KB 改回下标。**（`probe-serialize-mutation.js` 有对应突变项）
//
// ------------------------------------------------------------
// ⚠️⚠️ 反序列化**必须产出色板对象的副本**，否则立刻复活三重别名缺陷
// ------------------------------------------------------------
// 背景见 PLAN §3.4 / REVIEW.md n7：`findNearestColor()` 返回的是 `PERLER_PALETTE` 里的
// **对象引用**，历史上的实际形态是三重别名（gridData ↔ rawGridData ↔ **全局色板**）。
// 后果是"改一个格子会同时改坏原始数据和全局色板"，后者污染**后续所有生成的图**。
//
// 反序列化是**同一个陷阱的第二次入口**：从名字查回色板对象后若直接赋值，
// 存档里的格子就会与全局色板共享引用 —— 单元格编辑一上线，
// 用户改一格就改坏了全局色板。**故必须逐个 `{ ...pal }` 拷贝**，
// 由 `test-serialize.js` 的"就地改存档格子后全局色板不变"断言守护。
//
// ⚠️ 这里刻意**不复用** `js/pipeline/simplify.js` 的 `cloneGrid()`：
//    · 本模块已直接产出副本，再套一层 cloneGrid 是纯粹的多余遍历（104² 次）；
//    · 更重要的是 `js/core/` → `js/pipeline/` 会**新增一条跨领域 import 边**。
//      REFACTOR §4.4 规则 2（模块间不得直接互相调用）目前是**已记录的待办**，
//      **不是可以继续扩散的先例** —— 新代码不应再添边。
//
// 本文件是原生 ES module：依赖由上方 import 显式声明。
// ============================================================

/**
 * 存档的格式标识。**故意与版本号分开两个字段**：
 * 版本号只表达"同一格式的第几版"，而格式标识能挡住"这压根不是拼豆存档"
 * （用户可能把一个随便的 JSON 文件塞进了加载入口）。
 * 只校验 version 是不够的 —— 别的应用的 JSON 也可能恰好有 `version: 1`。
 */
export const DOC_FORMAT = 'pindou-blueprint';

/**
 * 当前存档版本。**新增/改变存档字段时必须递增它，并补一条迁移函数**。
 *
 * v1：网格（色号名 + null 空格）+ 行列数。
 */
export const DOC_VERSION = 1;

/**
 * 行列数的**结构性**上限（不是产品网格范围）。
 *
 * ⚠️ 用途只有一个：**拒绝明显损坏的输入**，避免 `cells` 声明成
 * `rows: 1e9` 时在读入阶段就构造巨型数组把页面拖死。
 *
 * ⚠️ **它不是"产品允许的网格尺寸"**（那是 15~104，写在 index.html 的
 * `min`/`max` 与 `js/ui/grid-select.js` 的校验里）。此处**刻意不引用那个范围**：
 * 引用就得在两个真源之间同步，而"照着一个真源去改另一个"正是本仓库
 * 踩过的缺陷类型（见 PLAN §4.6：界面写 3.85 会诱使人照着改代码）。
 * 加载一份尺寸超范围的存档，对"展示/导出/打印"这些只读路径并无妨碍。
 */
export const MAX_DOC_SIDE = 4096;

/**
 * 序列化/反序列化失败时抛出的**具名**错误。
 *
 * 存在的理由：让 6b 的 UI 能区分"用户给的数据坏了"（应提示并保持当前图纸不变）
 * 与"代码自身抛了异常"（应走通用的错误兜底）。只靠 `Error` 无法区分。
 */
export class SerializeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SerializeError';
  }
}

/**
 * 版本迁移表：`版本号 → (doc) => doc`。
 *
 * 契约：迁移函数接收一个**该版本**的 doc，返回**版本号 +1** 的 doc。
 * 逐级升级（v1→v2→v3），不写"从任意版本直达最新"的跳级函数 ——
 * 跳级函数的数量随版本数**平方增长**，且每一级的字段语义变化会散落多份。
 *
 * 当前为空（v1 即最新）。**保留它而不是等到需要时再加**：
 * 迁移的**调度逻辑**必须现在就被测试覆盖，否则等真要迁移时，
 * 那段调度代码是**从未执行过的路径**（本仓库反复踩过"看起来能跑但没人跑过"的坑）。
 * `deserializeDoc()` 的 `migrations` 参数就是为让测试能注入假迁移、真实跑通调度。
 */
export const DOC_MIGRATIONS = new Map();

/** 取一条迁移函数，兼容 Map 与普通对象两种表形态 */
function getMigration(table, version) {
  if (!table) return undefined;
  return table instanceof Map ? table.get(version) : table[version];
}

/**
 * 逐级把存档升级到 `targetVersion`。
 *
 * ⚠️ **为什么把它单独导出**（而不是塞在 `parseDoc` 里当内部循环）：
 *    迁移的调度逻辑必须在**当前没有迁移需求时**就被测试覆盖 ——
 *    否则等真要迁移（用户手里已经有 v1 存档）那一刻，这段代码是
 *    **从未被执行过的路径**。本仓库反复踩过这类坑（REFACTOR §8.7 的假绿教训）。
 *    单独导出后，测试可以注入假的迁移表 + 假的目标版本号，
 *    把"逐级升级 / 缺步骤 / 版本号没推进"三条分支真实跑一遍。
 *
 * 契约：`migrations[from]` 接收 v`from` 的存档，必须返回 **version === from + 1** 的存档。
 * 逐级升级而非跳级：跳级函数数量随版本数平方增长，且字段语义变化会散落多份。
 *
 * @param {object} doc 起始存档（须含合法的 `version`）
 * @param {Map<number, Function>|object} migrations 版本 → 迁移函数
 * @param {number} targetVersion 目标版本
 * @returns {object} 升级到 `targetVersion` 的存档
 * @throws {SerializeError}
 */
export function runMigrations(doc, migrations, targetVersion) {
  let cur = doc;
  // ⚠️ 用**有界 for**，不用 `while (cur.version < targetVersion)`：
  //    契约保证每一步把版本号 +1，因此需要的迭代次数在进入循环前就是已知的
  //    （`targetVersion - doc.version`）。写成 while 就必须再加一个"防死循环"
  //    守卫 —— 而那个守卫在契约成立时**永远不会执行**，是一段测不到的死代码
  //    （本仓库对死代码的态度见 PLAN §4.3 项 1 的 `PRINT_CELL_MM` 教训）。
  //    迁移函数写错时，下行的契约检查会**当场**报错，不会静默空转。
  for (let v = doc.version; v < targetVersion; v++) {
    const migrate = getMigration(migrations, v);
    if (typeof migrate !== 'function') {
      throw new SerializeError(
        `存档版本 v${v} 无法升级到 v${targetVersion}：缺少该版本的迁移步骤`
      );
    }
    const next = migrate(cur);
    if (!isPlainObject(next) || next.version !== v + 1) {
      throw new SerializeError(
        `v${v} 的迁移函数未按契约返回 v${v + 1} 的存档`
      );
    }
    cur = next;
  }
  return cur;
}

/** 判断是否"普通对象"（排除 null 与数组） */
function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 校验一个正整数（用于 rows/cols）。返回 true 表示合法 */
function isPositiveInt(v, max) {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= max;
}

/**
 * 从**当前的 `gridData`** 构建一份存档对象（纯函数，不读 `state`）。
 *
 * 显式传入 grid 而不是自己去读 `state.gridData`：这样本模块
 * 无状态、可对任意网格调用，测试也能直接喂造好的网格进来。
 *
 * @param {Array<Array<{name:string}|null>>} grid 二维网格（`state.gridData` 的形状）
 * @returns {{format:string, version:number, rows:number, cols:number, cells:Array<Array<string|null>>}}
 * @throws {SerializeError} grid 不是合法的二维网格时
 */
export function buildDoc(grid) {
  if (!Array.isArray(grid) || grid.length === 0) {
    throw new SerializeError('没有可保存的图纸：网格数据为空');
  }
  const rows = grid.length;
  if (!isPositiveInt(rows, MAX_DOC_SIDE)) {
    throw new SerializeError(`网格行数非法：${rows}`);
  }
  if (!Array.isArray(grid[0])) {
    throw new SerializeError('网格数据不是二维数组，无法保存');
  }
  const cols = grid[0].length;
  if (!isPositiveInt(cols, MAX_DOC_SIDE)) {
    throw new SerializeError(`网格列数非法：${cols}`);
  }

  // 逐行转成"色号名 / null"。同时**校验行宽一致** ——
  // 参差不齐的网格（某行短了一截）是真实可能的损坏形态，
  // 存进去之后在加载端才发现，排查成本高得多。
  const cells = new Array(rows);
  for (let r = 0; r < rows; r++) {
    const row = grid[r];
    if (!Array.isArray(row) || row.length !== cols) {
      throw new SerializeError(
        `网格数据不完整：第 ${r} 行应有 ${cols} 列，实为 ${Array.isArray(row) ? row.length : '非数组'}`
      );
    }
    const out = new Array(cols);
    for (let c = 0; c < cols; c++) {
      const cell = row[c];
      if (cell === null || cell === undefined) { out[c] = null; continue; }
      if (typeof cell.name !== 'string' || cell.name === '') {
        throw new SerializeError(`网格数据损坏：第 ${r} 行第 ${c} 列缺少色号名`);
      }
      out[c] = cell.name;
    }
    cells[r] = out;
  }

  return { format: DOC_FORMAT, version: DOC_VERSION, rows, cols, cells };
}

/**
 * 把当前网格序列化成**存档字符串**（可直接交给 localStorage / 文件）。
 * @param {Array<Array<{name:string}|null>>} grid
 * @returns {string}
 */
export function serializeDoc(grid) {
  return JSON.stringify(buildDoc(grid));
}

/**
 * 解析并**校验**一份存档字符串，返回存档对象（**尚未转成网格**）。
 *
 * 校验分四层，任何一层不过都抛 `SerializeError` 且带可读原因：
 *   ① 语法   —— 是不是合法 JSON；
 *   ② 身份   —— `format` 是否为本产品的存档、`version` 是否为已知版本；
 *   ③ 版本   —— 过旧则走迁移表升级、过新则拒绝（**不要猜**）；
 *   ④ 结构   —— rows/cols 与 cells 的维度是否自洽。
 *
 * ⚠️ 第 ③ 层的"过新则拒绝"是刻意的：更新的版本可能引入了本代码不认识的字段，
 * 强行读入会**静默丢字段**——用户在新版本里存的图纸，回到旧版本打开会缺一块。
 * 明确拒绝比静默损坏好。
 *
 * @param {string} text
 * @param {{migrations?: Map<number, Function>}} [opts] `migrations` 仅供测试注入，
 *        生产调用不要传（走 `DOC_MIGRATIONS`）。
 * @returns {object} 校验并迁移后的存档对象
 * @throws {SerializeError}
 */
export function parseDoc(text, opts = {}) {
  const migrations = opts.migrations || DOC_MIGRATIONS;

  // ---- ① 语法 ----
  if (typeof text !== 'string') {
    throw new SerializeError('存档内容不是文本，无法读取');
  }
  if (text.trim() === '') {
    throw new SerializeError('存档内容为空');
  }
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    throw new SerializeError('存档内容不是合法的 JSON，可能已损坏');
  }

  // ---- ② 身份 ----
  if (!isPlainObject(doc)) {
    throw new SerializeError('存档内容不是对象，可能不是图纸存档');
  }
  if (doc.format !== DOC_FORMAT) {
    throw new SerializeError('这不是拼豆图纸存档（格式标识不匹配）');
  }
  if (!isPositiveInt(doc.version, Number.MAX_SAFE_INTEGER)) {
    throw new SerializeError(`存档版本号非法：${JSON.stringify(doc.version)}`);
  }
  if (doc.version > DOC_VERSION) {
    throw new SerializeError(
      `存档版本 v${doc.version} 高于本程序支持的 v${DOC_VERSION}，` +
      '请更新后再打开（强行读取会丢失新版本才有的内容）'
    );
  }

  // ---- ③ 版本迁移：逐级升级（调度逻辑见 runMigrations，它被单独测试覆盖）----
  const cur = runMigrations(doc, migrations, DOC_VERSION);

  // ---- ④ 结构 ----
  if (!isPositiveInt(cur.rows, MAX_DOC_SIDE) || !isPositiveInt(cur.cols, MAX_DOC_SIDE)) {
    throw new SerializeError(
      `存档的网格尺寸非法：${JSON.stringify(cur.rows)}×${JSON.stringify(cur.cols)}`
    );
  }
  if (!Array.isArray(cur.cells) || cur.cells.length !== cur.rows) {
    throw new SerializeError(
      `存档的网格数据与行数不符：应有 ${cur.rows} 行，` +
      `实为 ${Array.isArray(cur.cells) ? cur.cells.length : '非数组'}`
    );
  }
  for (let r = 0; r < cur.rows; r++) {
    const row = cur.cells[r];
    if (!Array.isArray(row) || row.length !== cur.cols) {
      throw new SerializeError(
        `存档的网格数据不完整：第 ${r} 行应有 ${cur.cols} 列，` +
        `实为 ${Array.isArray(row) ? row.length : '非数组'}`
      );
    }
  }

  return cur;
}

/**
 * 把已校验的存档对象转成**网格**（`state.gridData` 的形状）。
 *
 * ⚠️ 每个格子都从色板**拷贝**出来（`{ ...pal }`），不共享色板对象引用 ——
 * 见文件头「必须产出色板对象的副本」一节。**不要改成直接赋值。**
 *
 * 色号名在色板里找不到时（例如色板换代删掉了某个色号）：
 *   · 该格置为 `null`（空格），**不猜一个近似色** —— 猜色的后果是用户按图买的
 *     色号与实际不符，比留空更难发现；
 *   · 同时把该色号名与出现次数记进 `warnings`，由调用方**如实告知用户**。
 *     这是本仓库既有的一贯要求（同 §3.1 近似色合并必须播报替代色号）：
 *     **静默改变用户产出是不可接受的**，哪怕改动本身是"合理的降级"。
 *
 * @param {object} doc 已由 `parseDoc()` 校验过的存档对象
 * @returns {{grid:Array<Array<object|null>>, rows:number, cols:number,
 *            warnings:Array<{name:string, count:number}>}}
 */
export function docToGrid(doc) {
  // 色号名 → 色板对象。用 name 而不是 hex 建索引：存档里存的就是 name，
  // 而 `color-palette.js` 实测 221 色的 name 与 hex 都唯一（PLAN §6.1 已复核）。
  const byName = new Map(PERLER_PALETTE.map((p) => [p.name, p]));

  const rows = doc.rows;
  const cols = doc.cols;
  const grid = new Array(rows);
  const missing = new Map();   // 未知色号名 → 出现次数

  for (let r = 0; r < rows; r++) {
    const srcRow = doc.cells[r];
    const out = new Array(cols);
    for (let c = 0; c < cols; c++) {
      const name = srcRow[c];
      if (name === null || name === undefined) { out[c] = null; continue; }
      const pal = byName.get(name);
      if (!pal) {
        out[c] = null;
        missing.set(name, (missing.get(name) || 0) + 1);
        continue;
      }
      // ⚠️ 拷贝：直接 `out[c] = pal` 会让存档里的格子与全局色板共享引用，
      //    单元格编辑一上线就会改坏全局色板（PLAN §3.4 / REVIEW.md n7）
      out[c] = { ...pal };
    }
    grid[r] = out;
  }

  // 警告按色号名排序，保证文案稳定（不随扫描顺序变化）—— 同 applySimplify 的先例
  const warnings = Array.from(missing, ([name, count]) => ({ name, count }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  return { grid, rows, cols, warnings };
}

/**
 * **反序列化的唯一入口**：存档字符串 → 可直接放进 `state.gridData` 的网格。
 *
 * 返回对象而不是裸网格，是为了让 `warnings` 无处可藏 —— 调用方必须显式取出它，
 * 才可能漏掉"如实告知"。返回裸网格 + 一个旁路数组，很容易被忽略。
 *
 * ⚠️ 本函数**只负责产出网格**，不写 `state`、不触发任何渲染。
 * 写入 `state` 与后续的重绘/统计/播报属于 6b 的编排，
 * 且那时必须一并重建 `colorCounts`（用现成的 `rebuildColorCounts()`，见 PLAN §3.4）。
 *
 * @param {string} text
 * @param {{migrations?: Map<number, Function>}} [opts] 仅供测试注入迁移表
 * @returns {{grid:Array<Array<object|null>>, rows:number, cols:number,
 *            warnings:Array<{name:string, count:number}>}}
 * @throws {SerializeError}
 */
export function deserializeDoc(text, opts = {}) {
  return docToGrid(parseDoc(text, opts));
}
