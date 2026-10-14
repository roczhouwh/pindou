import { $, printBtn, printColorToggle, printRoot, printPages, printInfo } from '../core/dom.js';
import { state } from '../core/state.js';
import { showToast } from '../input/upload.js';
// ⚠️ 黑白字判定**复用** pipeline/render.js 的实现，不抄第二份 ——
//    抄一份之后两边会各自漂移（同色格子在预览/导出/打印三处显示不同的字色）。
import { pickTextColor } from '../pipeline/render.js';

// ============================================================
// js/output/print.js — A4 打印出口（PLAN §4.2~4.5）
// ============================================================
// 与 PNG 导出**并存**，不互相替代：
//   · PNG（js/output/export.js）服务分享与数字查看；
//   · 打印走**独立 DOM 布局** → `window.print()`，不经位图。
//
// ⚠️ **为什么不能用"导出图片再打印"**（PLAN §4.1 已论证）：
//    canvas.toBlob 固定写 96dpi 元数据，PNG 里**没有物理尺寸**。
//    52×52 走"100% 原始大小"是 78.7cm 宽、"适应页面"每格只有 3.846mm，
//    两个极端都不可用。而 CSS 的 mm 是真实物理单位 —— 这是本模块存在的理由。
//
// ⚠️ **落位与耦合**：本模块是 js/output/ 下的**叶子模块**，与 export.js 同构 ——
//    只读 `state`、只写自己那棵 DOM 子树，**不新增跨领域直接调用**
//    （REFACTOR §4.4 规则 2 当前仍是已知违反状态，不是可以继续扩散的先例）。
//
// ⚠️ **为什么不复用 drawGrid()**（PLAN §五 第二批第 5 项原写"复用 pipeline/render.js，
//    不新写绘制循环"）—— **这条要求在打印出口的物理尺寸下无法照字面执行**，
//    留此记录以免后人误以为是漏做：
//      · `drawGrid` 的接口单位是 **px**，而打印版面的唯一约束是 **mm**
//        （每格 200/52mm、色号 6.2pt）。用它就得把 mm 折算成"某个 dpr 下的 px"，
//        而 @page 一旦生效，浏览器按纸面 mm 重排，这个 px↔mm 折算**不再由我们控制**，
//        折算错就会静默改变物理尺寸 —— 那正是本方案要根治的问题。
//      · `drawGrid` 按 `minCell * 0.35` 自算字号，而 §4.6 项 1 已**实测定案 6.2pt**
//        （在实测上限 6.37pt 内留 3% 余量），是独立常量，不是派生的。
//      · 打印路径还要求"色号是矢量文字"（§4.2 优势②）与"关掉复选框 = 省墨模式"
//        （§4.6 项 4），这两条只能由 DOM 文字 + CSS 提供，canvas 给不了。
//    **不重复的部分已真复用了**：`encodeCellName()` 的编码表、
//    `computePrintPaging()` 的分页规则、`pickTextColor()` 的黑白字判定
//    —— 其中黑白字判定直接 import 自 pipeline/render.js，不再抄一份。
//
// ⚠️⚠️ **绝不能加 `print-color-adjust: exact`**（见 style.css 的打印段）：
//    该属性会强制打印背景，使「背景图形」复选框**彻底失效** ——
//    用户就失去了 §4.5 要的"省墨模式"。这是样张实测踩出来的（PLAN §4.6「项 4 的真相」）。
//
// ⚠️ **状态按 `rulerEnabled` 的先例处理**：打印设置是**显示/输出偏好**，
//    `handleFile()` 刻意不重置它（与 `simplify` 相反 —— 后者是图像参数，必须归零）。
//    这样无需改动任何重置逻辑。
//
// ⚠️ 失败提示一律用 `showToast`（全局 toast），**不能用 `showError`** ——
//    后者写进 #uploadError，而 showViewer() 已把 #uploadSection 隐藏，消息会静默丢失。
//
// 本文件是原生 ES module：依赖由上方 import 显式声明。
// ============================================================

// ------------------------------------------------------------
// 版面常量 —— 全部来自 PLAN §4.3 / §4.4.1 / §4.6，**不要就地改数值**：
// 每一个值都有对应的实测依据，改之前先读 PLAN 里那一节。
// ------------------------------------------------------------

/** A4 竖版可打印宽（mm）：210 − 5mm×2 边距。**分页与每格尺寸都以它为基准**。 */
export const PRINT_PRINTABLE_W_MM = 200;

/** 每页列数。§4.6 项 1 实测定案：52 列/页 ⇒ 52×52 主路径正好 **1 页**。 */
export const PRINT_COLS_PER_PAGE = 52;

/**
 * 每格边长（mm）= 200 / 52 ≈ 3.846153…
 *
 * ⚠️ **不要写成 3.85** —— PLAN §4.3 初版写 3.85，但 `3.85 × 52 = 200.2mm`，
 * **超出可打印宽 0.2mm**，会表现为"多出空白页 / 整体被缩小"，
 * 从而被误判成"`@page` 不支持"（§4.6 项 3 的判据里专门提醒过这一点）。
 * 必须用**精确除法**，不要手抄小数。
 *
 * ⚠️ **每格尺寸只有一个真源**：主路径（整页 52 列）与末页不足一块时
 * 都按 52 列排版（见 `forEachPrintPage` 的说明），所以
 * `computePrintPaging().cellMm` 也直接引用本常量 ——
 * **不要在那里面另写一遍 `200/pageCols`**。
 * （实测踩过：两处各算一次时，把本常量改成 3.85 对分页结果**毫无影响**，
 *   常量成了死代码、页面用的是另一份公式 —— 突变测试才发现。）
 */
export const PRINT_CELL_MM = PRINT_PRINTABLE_W_MM / PRINT_COLS_PER_PAGE;

/**
 * 色号字号（pt）。§4.6 项 1 **实测定案 6.2pt**：
 * 52 列下 2 字符码的贴满上限实测为 6.37pt、留 8% 边距上限 5.74pt，
 * 取 6.2pt = 在贴满上限内留约 3% 水平余量，避免最宽码（如 `Hm`）顶到格线。
 *
 * ⚠️ 换字体（如 iOS 上的 SF Pro）必须用 `.pindou-devtools/probe-print-fit.js`
 *    **重新量上限**再定 —— 字形宽不同，6.2pt 不是普适值。
 */
export const PRINT_FONT_PT = 6.2;

/**
 * 色号编码：`a-z` 去掉 `i` / `l` / `o` 后恰好 23 个字母。
 *
 * 序号 10~32 也恰好需要 23 个 —— **零浪费，完美匹配**（§4.4）。
 * 跳过 `i/l/o` 是 Crockford Base32 / VIN 码等人类抄录场景的通行做法：
 * 按十六进制式直接映射会让序号 22 → `l`，与序号 1 的数字 `1` 在无衬线字体中几乎同形，
 * 而灰度打印下**色号是唯一信息源**（§4.5），信息源本身有歧义则地基不稳。
 */
const CODE_LETTERS = 'abcdefghjkmnpqrstuvwxyz';

/**
 * 把色板色号（`A10`）压成 2 字符编码（`Aa`）。
 *
 * 第一位保留**组别大写字母**，第二位用**小写字母**表示 10 以上的序号，
 * 与第一位大写天然区分。这样色号**仍可直接对应采购** ——
 * 优于"本地重新编号 1/2/3"（后者使用户须先查图例换算，§4.4）。
 *
 * ⚠️ 实测：全色板最大序号为 32，221 色**全部得到唯一编码**、长度统一为 2、
 *    且不含 `i`/`l`/`o` 任一字母。本函数的边界由 `test-print.js` 守护。
 *
 * @param {string} name 色板原名，形如 `A10`（大写组别字母 + 1~2 位数字）
 * @returns {string} 2 字符编码，形如 `Aa`
 * @throws {Error} 名字不符合 `^[A-Z]\d{1,2}$`，或序号超出 32（色板扩了要同步扩编码表）
 */
export function encodeCellName(name) {
  const m = /^([A-Z])(\d{1,2})$/.exec(String(name));
  if (!m) throw new Error(`非法色号：${name}（应为「大写字母+数字」，如 A10）`);
  const no = Number(m[2]);
  if (no < 1) throw new Error(`非法色号序号：${name}（序号从 1 起）`);
  // 1~9 直接沿用数字本身（此时第一位是大写字母、第二位是数字，与 10+ 的小写字母不混）
  if (no <= 9) return m[1] + m[2];
  const ch = CODE_LETTERS[no - 10];
  if (!ch) {
    throw new Error(
      `色号序号 ${no}（${name}）超出 2 字符编码上限 32 —— ` +
      `色板扩展后必须同步扩展编码表（见 PLAN §4.4）`);
  }
  return m[1] + ch;
}

/**
 * 分页计算：每边 `ceil(n / 52)` 页，格子**放大填满页宽 200mm**（§4.3 统一分页规则）。
 *
 * 两条由该规则**自然涌现**的优良性质（§4.3，已确认保住）：
 *   · **104×104 每页正好 52×52 格、每格 3.846mm**，与 52×52 主路径完全相同
 *     ⇒ 「一张 A4 = 一块实物豆板」与实物工作流天然对齐；
 *   · 格子越少 → 每页越大 → 色号越清楚，分页策略自带良性梯度。
 *
 * @param {number} cols 网格列数
 * @param {number} rows 网格行数
 * @returns {{pageCols:number, pageRows:number, cols:number, rows:number, pagesX:number,
 *            pagesY:number, totalPages:number, cellMm:number}}
 */
export function computePrintPaging(cols, rows) {
  if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols < 1 || rows < 1) {
    throw new Error(`非法网格尺寸：${cols}×${rows}`);
  }
  // ⚠️ 每页列数固定为 52（不随网格变化）：这正是"104×104 每页正好 52×52"成立的原因。
  //    若改成"每页 ceil(n/pages) 格"，每格尺寸会随网格漂移，上述对应关系立刻失效。
  const pageCols = Math.min(cols, PRINT_COLS_PER_PAGE);
  const pageRows = Math.min(rows, PRINT_COLS_PER_PAGE);
  const pagesX = Math.ceil(cols / PRINT_COLS_PER_PAGE);
  const pagesY = Math.ceil(rows / PRINT_COLS_PER_PAGE);
  return {
    pageCols,
    pageRows,
    cols,
    rows,
    pagesX,
    pagesY,
    totalPages: pagesX * pagesY,
    // ⚠️ **引用 `PRINT_CELL_MM`，不要在这里重算 `200 / pageCols`**。
    //    两者数学上等价（pageCols 恒为 52，见上），但分成两处写就有两个真源：
    //    实测踩过 —— 把 `PRINT_CELL_MM` 改成 3.85 时，分页结果**一点没变**
    //    （页面用的是这一行），常量成了死代码，而"超宽 0.2mm"的回归也就无人拦截。
    //    突变测试①捕获的正是这个缺陷。
    cellMm: PRINT_CELL_MM,
  };
}

/**
 * 遍历所有分页，回调每页的**块范围**（含半开的结束边界）。
 *
 * 走查顺序为**行优先**（先左到右铺满一行页，再换下一行页），
 * 与纸质图纸"横向拼接"的阅读习惯一致 —— 页脚标注的"第 N 页 / 第 N 行第 M 块"
 * 依赖这个顺序，改顺序会让标注与实际对不上。
 *
 * @param {{pagesX:number, pagesY:number, pageCols:number, pageRows:number}} paging
 * @param {(page:{index:number, px:number, py:number, x0:number, y0:number,
 *                 x1:number, y1:number, w:number, h:number}) => void} fn
 */
export function forEachPrintPage(paging, fn) {
  const { pagesX, pagesY, pageCols, pageRows } = paging;
  let index = 0;
  for (let py = 0; py < pagesY; py++) {
    for (let px = 0; px < pagesX; px++) {
      const x0 = px * pageCols;
      const y0 = py * pageRows;
      // 末页可能不足一整块（如 78 列 ⇒ 第一页 52 列、第二页 26 列），
      // 此时**依旧按 52 列的格宽排版**，只是格子数少 —— 保持跨页格宽一致，
      // 拼接时才对得齐（若把末页拉伸到 200mm，两页的格子尺寸会不同，拼不上）。
      const w = Math.min(pageCols, paging.cols - x0);
      const h = Math.min(pageRows, paging.rows - y0);
      fn({ index: index++, px, py, x0, y0, x1: x0 + w, y1: y0 + h, w, h });
    }
  }
}

/**
 * 计算屏幕上给用户看的**页数与每格尺寸预览**文案。
 *
 * PLAN §五 第二批第 5 项明确要求"屏幕上先给用户**页数与每格尺寸预览**"——
 * 打印是不可逆的物理动作（费纸费墨），用户必须在点之前就知道会出几页、格子多大。
 *
 * @param {number} cols
 * @param {number} rows
 * @returns {string}
 */
export function printSummaryText(cols, rows) {
  const p = computePrintPaging(cols, rows);
  // ⚠️ 用 **3 位小数**，不要用 2 位：`(200/52).toFixed(2)` = "3.85"，
  //    而 3.85 正是 PLAN §4.3 初版那个**会超宽 0.2mm** 的错误值（3.85×52 = 200.2）。
  //    界面文案显示成 3.85 会让人以为产品用的就是这个值，
  //    将来有人"照界面上的数改代码"就会真的引入那个缺陷。
  //    3 位小数显示 3.846，既准确又不啰嗦。
  const scale = `每格 ${p.cellMm.toFixed(3)}mm`;
  if (p.totalPages === 1) {
    return `A4 打印：共 1 页 · ${scale} · 色号 ${PRINT_FONT_PT}pt`;
  }
  return `A4 打印：共 ${p.totalPages} 页（${p.pagesY} 行 × ${p.pagesX} 列拼接）· ` +
    `${scale} · 色号 ${PRINT_FONT_PT}pt`;
}

// ------------------------------------------------------------
// DOM 版面构建
// ------------------------------------------------------------

/**
 * 构建打印版面的 DOM（一页一个 `<section class="print-page">`）。
 *
 * ⚠️ **两条结构约定，改之前先读 PLAN §4.6「项 4 的真相」**：
 *   ① **网格线用 `border`，不能用 `background`** ——
 *      实测：不勾「背景图形」时，`background` 会随色块**一起消失**，
 *      而 `border` 仍以 `#ababab` 印出。若网格线写成 background，
 *      省墨模式下就只剩色号、没有格子边界，根本没法照着拼。
 *   ② **色号文字用真实文本节点，不画在 canvas 上** ——
 *      §4.2 优势②：DOM 文字由打印机按自身分辨率渲染，色号才"根本性地看得清"；
 *      且实测"不勾背景"时文本操作数完全不变（色号完整保留）。
 *
 * ⚠️ 色块**只在勾选「打印色块」时才输出 `background`** —— 该复选框正是
 *    §4.6 项 4 那个"反直觉取舍"的落点：想让用户能选省墨模式，
 *    就不能把 `print-color-adjust: exact` 加死。两者互斥，故做成显式开关。
 *
 * @param {Array<Array<{name:string,hex:string,r:number,g:number,b:number}|null>>} grid
 * @param {object} [opts]
 * @param {boolean} [opts.withColor=true] 是否输出色块底色（关掉即省墨模式）
 * @param {Document} [opts.doc=document] 文档对象（测试可注入）
 * @returns {{pages:number, cells:number, codes:number}}
 */
export function renderPrintLayout(grid, opts = {}) {
  const withColor = opts.withColor !== false;
  const doc = opts.doc || document;

  const rows = grid.length;
  const cols = grid[0].length;
  const paging = computePrintPaging(cols, rows);

  const frag = doc.createDocumentFragment();
  let cells = 0;
  let codes = 0;

  forEachPrintPage(paging, (page) => {
    const section = doc.createElement('section');
    section.className = 'print-page';
    section.dataset.page = String(page.index + 1);

    // ---- 页眉：标题 + 分页标注（跨页拼接时靠它认顺序）----
    const head = doc.createElement('header');
    head.className = 'print-head';
    const title = doc.createElement('h1');
    title.className = 'print-title';
    title.textContent = `拼豆图纸 ${cols}×${rows}`;
    const pos = doc.createElement('span');
    pos.className = 'print-pos';
    pos.textContent = paging.totalPages > 1
      ? `第 ${page.index + 1} / ${paging.totalPages} 页 · 第 ${page.py + 1} 行第 ${page.px + 1} 块 · ` +
        `列 ${page.x0 + 1}-${page.x1} / 行 ${page.y0 + 1}-${page.y1}`
      : `全图 · 列 1-${cols} / 行 1-${rows}`;
    head.appendChild(title);
    head.appendChild(pos);
    section.appendChild(head);

    // ---- 网格本体 ----
    const wrap = doc.createElement('div');
    wrap.className = 'print-grid-wrap';
    const table = doc.createElement('div');
    table.className = 'print-grid';
    // 列数以**整页宽 52** 为准（不是本页实际格数），见 forEachPrintPage 的说明
    table.style.gridTemplateColumns = `repeat(${paging.pageCols}, ${paging.cellMm}mm)`;

    for (let r = page.y0; r < page.y1; r++) {
      for (let c = page.x0; c < page.x1; c++) {
        const cell = grid[r][c];
        const box = doc.createElement('div');
        box.className = 'print-cell';
        if (cell) {
          // ⚠️ 空格子**不加底色**（透明像素留白标记，与预览/导出一致）
          if (withColor) box.style.background = cell.hex;
          const code = encodeCellName(cell.name);
          const i = doc.createElement('i');
          i.textContent = code;
          // 深色格白字 / 浅色格黑字 —— 直接复用 pipeline/render.js 的判定，不抄第二份
          // （⚠️ 用行内样式而非 CSS 类：黑白字判定依赖每个格子的真实色值，CSS 给不了）
          box.dataset.fg = pickTextColor(cell) === '#FFFFFF' ? 'light' : 'dark';
          box.appendChild(i);
          codes++;
        }
        cells++;
        table.appendChild(box);
      }
    }
    wrap.appendChild(table);
    section.appendChild(wrap);
    frag.appendChild(section);
  });

  // 一次性替换整棵子树（避免 2704 次 appendChild 触发 2704 次布局）
  printPages.textContent = '';
  printPages.appendChild(frag);

  return { pages: paging.totalPages, cells, codes };
}

/**
 * 生成打印版面并写入屏幕预览区的**说明文案**。
 * 抽出来供 `printGrid()` 与复选框变更共用 —— 两处若各写一份，文案必然漂移。
 */
function updatePrintInfo() {
  if (!printInfo) return;
  const grid = state.gridData;
  if (!grid) { printInfo.textContent = ''; return; }
  const rows = grid.length;
  const cols = grid[0].length;
  printInfo.textContent = printSummaryText(cols, rows) +
    (state.printColorBlocks ? '' : ' · 已关闭色块（省墨模式，仅印网格线与色号）');
}

/**
 * **构建打印版面并唤起浏览器打印**（PLAN §4.2：`@media print` + `@page`，不导出位图）。
 *
 * 这是打印出口的唯一入口。调用前必须已有 `state.gridData`。
 */
export function printGrid() {
  const grid = state.gridData;
  if (!grid) return;
  const rows = grid.length;
  const cols = grid[0].length;

  renderPrintLayout(grid, { withColor: state.printColorBlocks });
  updatePrintInfo();

  // ⚠️ 同步调用 `window.print()`：必须在用户手势的调用栈内，
  //    否则会被弹窗拦截策略挡掉（与 export.js 里 iOS 开窗同一类约束）。
  try {
    window.print();
  } catch (err) {
    // 打印失败要让用户知道，且给出下一步动作 —— 不能只说"失败了"
    showToast('无法唤起打印窗口，请用浏览器菜单的「打印」或按 Ctrl+P');
  }
  void rows; void cols;
}

/**
 * 按当前 state 重建打印版面（**不**唤起打印）。
 * 供"打印色块"复选框切换时刷新屏幕预览用。
 */
export function refreshPrintLayout() {
  if (!state.gridData) { updatePrintInfo(); return null; }
  const result = renderPrintLayout(state.gridData, { withColor: state.printColorBlocks });
  updatePrintInfo();
  return result;
}

// ------------------------------------------------------------
// 按钮与复选框装配（随模块一起求值；**不要漏** ——
// 漏了的表现就是"点打印没反应"，与 export.js 里漏装配的表现同类）
// ------------------------------------------------------------
if (printBtn) {
  printBtn.addEventListener('click', () => {
    if (!state.gridData) return;
    printGrid();
  });
}

if (printColorToggle) {
  // 打印设置按 `rulerEnabled` 先例：显示/输出偏好，handleFile() 不重置。
  // 初始值从 DOM 读，避免"HTML 写 checked 而 state 说 false"的双真源漂移。
  state.printColorBlocks = printColorToggle.checked;
  printColorToggle.addEventListener('change', () => {
    state.printColorBlocks = printColorToggle.checked;
    // 切换后重建版面：屏幕预览上能立刻看出色块去留（不是只在纸上才知道）
    refreshPrintLayout();
  });
}

void $; void printRoot;
