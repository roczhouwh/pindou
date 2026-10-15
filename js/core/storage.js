import { DOC_FORMAT, DOC_VERSION, buildDoc, deserializeDoc, serializeDoc } from './serialize.js';

// ============================================================
// js/core/storage.js — 图纸存档的**存储层**（PLAN 第三批 6b）
// ============================================================
// 职责边界：本模块只做「一份/多份图纸怎么落到 localStorage、怎么读回来」。
//   · **不做序列化** —— 那是 6a 的 `js/core/serialize.js`（纯函数，已就绪）；
//   · **不碰 DOM、不写 `state`** —— 展示与编排在 `js/ui/library.js`。
// 这样"存什么"（6a）与"存到哪"（本模块）与"怎么给用户看"（UI）三者互不缠绕，
// 也延续了 6a 刻意与存储选型解耦的初衷（把本模块换成 IndexedDB 时，
// serialize.js 与 UI 都无需改动）。
//
// ------------------------------------------------------------
// ⚠️ 为什么是「一个键装全部」而不是「一份图纸一个键」
// ------------------------------------------------------------
// 后者（索引键 + 每份一个内容键）看起来更省写入量，但它**没有原子性**：
// 写内容成功、写索引失败 ⇒ 索引指向不存在的图纸；反过来 ⇒ 图纸永远列不出来。
// 而这些残留**只有用户下次打开时才暴露**，且无法可靠区分"残留"与"用户真这么存的"。
//
// 单键方案下一次 `setItem` 就是一次原子提交：**要么整份存档集更新，要么完全不动**。
// 配额不足时旧存档**逐字节保持原样**，用户可以删掉几份再存 —— 这是可解释的行为。
// 代价是每次保存要重写全部存档（104×104 约 65KB/份，5MB 配额下可存数十份，
// 实测重写耗时在毫秒级），对本工具的使用规模完全可接受。
//
// ------------------------------------------------------------
// ⚠️ 两层版本：**存储格式** 与 **图纸文档** 各有各的版本号
// ------------------------------------------------------------
//   · 图纸文档：`DOC_FORMAT` / `DOC_VERSION`（6a 定义，v1）。本模块原样存放
//     `serializeDoc()` 产出的**文本**，不解析、不改写 —— 于是迁移逻辑只有一处
//     （`deserializeDoc()` 里那条四层校验 + 逐级迁移链），不会出现第二份。
//   · 存储格式：`STORE_FORMAT` / `STORE_VERSION`（本模块）。它管的是"这个键里
//     装的是不是一份存档集合、条目长什么样"。两者**必须分开**：将来若给条目
//     加字段（如"所属相册"），要升的是 STORE_VERSION，而用户的图纸文档仍是 v1，
//     不该被迫迁移。
//
// ------------------------------------------------------------
// ⚠️ 损坏时**不覆盖**：宁可让用户只读，也不静默清空他的存档
// ------------------------------------------------------------
// 键里的 JSON 解析失败时，本模块**不写回**任何东西，而是把 `corrupt` 标记交给 UI。
// 直接"清空重来"看起来更"健壮"，实际是把用户唯一的副本抹掉且不可恢复 ——
// 与本仓库"静默改变用户产出不可接受"的一贯要求相反（同近似色合并必须播报替代色号）。
// 代价（已确认接受）：损坏后 UI 会暂停保存，用户需自行清理站点数据才能继续存新的。
//
// 本文件是原生 ES module：依赖由上方 import 显式声明。
// ============================================================

/** 存档集合在 localStorage 里的键 */
export const STORE_KEY = 'pindou-library';

/** 存储格式标识（与 `DOC_FORMAT` 是两个不同层级的标识，见文件头说明） */
export const STORE_FORMAT = 'pindou-library';

/** 存储格式版本。**改变条目的字段结构时必须递增它，并补一条迁移** */
export const STORE_VERSION = 1;

/**
 * 存档份数上限。
 *
 * 不是"配额"（配额由浏览器给，约 5MB），而是**防止无上限增长**：
 * 没有上限时，反复保存会把配额耗尽，而失败发生在"用户正想保存"的那一刻 ——
 * 更糟的是当时代码已经遍历了一遍全部存档。
 * 50 份 × 65KB（104×104）≈ 3.3MB，仍在常见配额内。
 */
export const MAX_ARCHIVES = 50;

/** 存档名长度上限。与 index.html 的 `maxlength="40"` 一致（两处需同步） */
export const MAX_NAME_LEN = 40;

/**
 * 存储层失败时抛出的**具名**错误。
 *
 * 存在的理由（同 `SerializeError`）：让 UI 能区分
 *   · `reason: 'unavailable'` —— 浏览器不给用本地存储（隐私模式等），
 *     应提示用户"这个浏览器存不了"并提供下一步，而不是报"保存失败"了事；
 *   · `reason: 'quota'`       —— 空间满了，应提示"删掉几份再存"；
 *   · `reason: 'limit'`       —— 份数到上限，同样是"删几份"；
 *   · `reason: 'invalid'`     —— 输入本身不合法（名字为空/过长、没有图纸），
 *     应就地提示怎么改。
 * 三类要用户做的事完全不同，只靠 `Error` 无法区分。
 */
export class StorageError extends Error {
  constructor(message, reason) {
    super(message);
    this.name = 'StorageError';
    this.reason = reason;
  }
}

/**
 * 探测本地存储**能不能写**，并区分"不给用"与"写满了"两种原因。
 *
 * ⚠️ 必须真写一次：Safari 隐私模式下 `localStorage` 对象**存在且可读**，
 *    但任何 `setItem` 都抛 `QuotaExceededError`。只看
 *    `typeof localStorage !== 'undefined'` 会把这种情况判成"可用"，
 *    然后用户在点保存时才失败。
 *
 * ⚠️⚠️ **两种失败原因的区分是本函数存在的另一半理由**（由 `test-library.js` 实测抓出）：
 *    隐私模式与"空间真的满了"**抛的是同一个 `QuotaExceededError`**，
 *    但用户该做的事完全不同（前者无解、后者删几份就行）。
 *    判据：**写入失败时，我们自己的键里是否已经有数据** ——
 *      · 有 ⇒ 曾经写得进去，现在写不进去了 = **空间被占满**；
 *      · 没有 ⇒ 从来没写进去过 = **浏览器不给用**。
 *    这个判据在真实场景下成立（本工具的键只由本工具写）。
 *    最初版本没做这个区分，后果是"存储满了"被报成"浏览器不允许本地存储"——
 *    用户会去换浏览器，而其实只要删掉两份旧存档。
 *
 * @returns {{available:boolean, reason:'ok'|'quota'|'denied'}}
 */
export function probeStorage() {
  try {
    if (typeof localStorage === 'undefined' || !localStorage) {
      return { available: false, reason: 'denied' };
    }
  } catch (err) {
    // 连访问 localStorage 这个属性本身都可能抛（部分浏览器的严格模式）
    return { available: false, reason: 'denied' };
  }

  const probe = `${STORE_KEY}::probe`;
  try {
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return { available: true, reason: 'ok' };
  } catch (err) {
    if (!isQuotaError(err)) return { available: false, reason: 'denied' };
    let hasOwnData = false;
    try { hasOwnData = localStorage.getItem(STORE_KEY) !== null; } catch (e) { /* 读不了就当没有 */ }
    return { available: false, reason: hasOwnData ? 'quota' : 'denied' };
  }
}

/**
 * 本地存储是否可用（**实测一次真实写入**，不是只看对象在不在）。
 * 只关心"能不能写"这一个布尔量的调用方用它；要区分原因请用 `probeStorage()`。
 */
export function isStorageAvailable() {
  return probeStorage().available;
}

/** 两种"写不进去"的用户可读说明（措辞不同，因为用户该做的事不同） */
const UNAVAILABLE_MSG = '本浏览器不允许使用本地存储（常见于隐私/无痕模式），无法保存图纸存档。';
const QUOTA_MSG = '本机浏览器的存储空间已满，未能保存。请先删除不再需要的存档再试。';

/** 判定是否为"空间不足"类错误（各浏览器命名不一致，且旧实现用 code） */
function isQuotaError(err) {
  if (!err) return false;
  const name = err.name || '';
  // Chrome/Safari/新版 Firefox：QuotaExceededError
  // 旧 Firefox：NS_ERROR_DOM_QUOTA_REACHED + code 1014；旧 WebKit：code 22
  return name === 'QuotaExceededError'
    || name === 'NS_ERROR_DOM_QUOTA_REACHED'
    || err.code === 22
    || err.code === 1014;
}

/** 判断是否"普通对象"（排除 null 与数组），与 serialize.js 同一判据 */
function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 读取集合的**原始文本**（读不到返回 null）。不解析、不清理。 */
function readRaw() {
  try {
    if (typeof localStorage === 'undefined' || !localStorage) return null;
    return localStorage.getItem(STORE_KEY);
  } catch (err) {
    // 读取本身可能抛（隐私模式、存储被禁用）
    return null;
  }
}

/**
 * 读出一份**只含展示所需字段**的条目（不含 doc 正文）。
 *
 * 拆成两个函数是有意的：列表刷新（每次保存/删除后都要做）不应把所有图纸文档
 * 都解析一遍 —— 50 份 × 65KB 每次刷新都过一遍 JSON，是白烧的时间。
 * 只有真正"载入"某一份时才需要正文（见 `getArchive`）。
 */
function itemMeta(it) {
  return { id: it.id, name: it.name, savedAt: it.savedAt, rows: it.rows, cols: it.cols };
}

/**
 * 读出整个存档集合。
 *
 * **本函数不抛错**：它把各种情况如实报出来，由 UI 决定怎么呈现 ——
 * 载入列表是页面初始化路径，一个抛错会让整个图纸功能区不可用。
 *
 * ⚠️ **「能读」与「能写」是两个独立的量，不要合并**（实测踩到）：
 *    空间**写满**时，`localStorage.getItem()` 仍然正常（读不需要配额），
 *    但任何 `setItem` 都失败。若把两者合成一个 `available`，后果是
 *    **用户看不到也删不掉自己的存档，同时系统告诉他"存不了"** ——
 *    唯一能腾出空间的动作被我们自己封掉了。
 *    故：`available` 管"读得到吗"（决定列表能不能列），
 *    `writable` 管"写得进吗"（决定保存能不能做）。删除只需要读 + 一次
 *    更小的写入，因此**列表与删除在"读满"状态下仍然可用**。
 *
 * @returns {{available:boolean, writable:boolean,
 *            items:Array<{id:string,name:string,savedAt:number,rows:number,cols:number}>,
 *            corrupt:boolean, error:string|null}}
 *   · `available:false` —— 浏览器压根不给用本地存储（此时 items 恒为空）
 *   · `writable:false`  —— 读得到但写不进（空间满 / 隐私模式）
 *   · `corrupt:true`    —— 键里有内容但读不懂（**不会被本模块覆盖**，见文件头）
 *   · `error`           —— 给用户看的中文原因（无错时为 null）
 */
export function readLibrary() {
  const probe = probeStorage();

  // 先试着把已有内容读出来 —— **无论能不能写**都要读。
  // 这一步在"空间写满"时是关键：用户必须看得到自己的存档才可能去删（见上方说明）。
  const raw = readRaw();

  if (!probe.available) {
    // 读得到内容时，列表照常给出（可载入、可删除）；读不到才彻底不可用
    const parsed = parseLibraryText(raw);
    if (!parsed.corrupt && parsed.items.length) {
      return {
        available: true,
        writable: false,
        items: parsed.items,
        corrupt: false,
        error: probe.reason === 'quota' ? QUOTA_MSG : UNAVAILABLE_MSG,
      };
    }
    return {
      available: false,
      writable: false,
      items: [],
      corrupt: probe.reason !== 'quota' && parsed.corrupt,
      error: probe.reason === 'quota' ? QUOTA_MSG : UNAVAILABLE_MSG,
    };
  }

  const parsed = parseLibraryText(raw);
  return {
    available: true,
    writable: true,
    items: parsed.items,
    corrupt: parsed.corrupt,
    error: parsed.error,
  };
}

/**
 * 解析键里的文本（不做任何写入）。**所有"内容读不懂"的判定集中在这里**，
 * 一处定义、一处修改（此前它散在 `readLibrary` 的多个早返回里）。
 *
 * @param {string|null} raw
 * @returns {{items:Array, corrupt:boolean, error:string|null}}
 */
function parseLibraryText(raw) {
  if (raw === null || raw === undefined || raw.trim() === '') {
    return { items: [], corrupt: false, error: null };
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    return {
      items: [],
      corrupt: true,
      error: '本机的图纸存档数据已损坏（不是合法 JSON），为避免覆盖它，已暂停保存。',
    };
  }

  if (!isPlainObject(data) || data.format !== STORE_FORMAT) {
    return {
      items: [],
      corrupt: true,
      error: '本机的图纸存档数据不是本程序的格式，为避免覆盖它，已暂停保存。',
    };
  }
  if (!Number.isInteger(data.version) || data.version < 1) {
    return {
      items: [],
      corrupt: true,
      error: `本机的图纸存档版本号异常（${JSON.stringify(data.version)}），已暂停保存。`,
    };
  }
  if (data.version > STORE_VERSION) {
    return {
      items: [],
      corrupt: true,
      error: `本机的图纸存档来自更新的版本（v${data.version}），当前程序只认到 v${STORE_VERSION}。`
        + '为避免写坏它，已暂停保存；请更新后再打开。',
    };
  }
  if (!Array.isArray(data.items)) {
    return { items: [], corrupt: true, error: '本机的图纸存档缺少条目列表，已暂停保存。' };
  }

  // 逐条校验：**单条坏掉不该让整份列表消失**（用户会以为所有存档都没了）。
  // 坏条目被跳过并计数，由 UI 如实告知。
  const items = [];
  let bad = 0;
  for (const it of data.items) {
    if (!isPlainObject(it) || typeof it.id !== 'string' || typeof it.doc !== 'string') { bad++; continue; }
    items.push({ ...itemMeta(it), name: typeof it.name === 'string' && it.name ? it.name : '未命名图纸' });
  }
  // 按保存时间降序（最近的在前）：列表里最常用的那份总在第一个
  items.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));

  return {
    items,
    corrupt: false,
    error: bad
      ? `有 ${bad} 份存档条目已损坏，已跳过（其余 ${items.length} 份仍可载入）。`
      : null,
  };
}

/** 内部：把整份集合写回。**唯一的写入点**（便于保证格式一致）。 */
function writeLibrary(items) {
  const payload = JSON.stringify({
    format: STORE_FORMAT,
    version: STORE_VERSION,
    items,
  });
  try {
    localStorage.setItem(STORE_KEY, payload);
  } catch (err) {
    if (isQuotaError(err)) {
      throw new StorageError(
        '本机浏览器的存储空间已满，未能保存。请先删除不再需要的存档再试。',
        'quota',
      );
    }
    throw new StorageError(
      `保存到本机存储失败：${err && err.message ? err.message : '未知原因'}`,
      'unavailable',
    );
  }
}

/** 内部：读出**未做展示裁剪**的原始条目（载入/删除需要 doc 正文） */
function readRawItems() {
  const raw = readRaw();
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    if (!isPlainObject(data) || data.format !== STORE_FORMAT || !Array.isArray(data.items)) return [];
    return data.items.filter((it) => isPlainObject(it) && typeof it.id === 'string');
  } catch (err) {
    return [];
  }
}

/** 生成一个新的条目 id（时间戳 + 递增序号，避免同毫秒内保存两份时撞号） */
let idSeq = 0;
function makeId(now) {
  idSeq += 1;
  return `a${now.toString(36)}-${idSeq}`;
}

/**
 * 规范化存档名：去首尾空白。
 * **不做静默截断** —— 超长直接报错让用户改，而不是悄悄改掉他起的名。
 */
function normalizeName(name) {
  const s = typeof name === 'string' ? name.trim() : '';
  if (!s) {
    throw new StorageError('请先给这份图纸起个名字（例如「小猫头像」）', 'invalid');
  }
  if (s.length > MAX_NAME_LEN) {
    throw new StorageError(
      `存档名太长（${s.length} 字，上限 ${MAX_NAME_LEN} 字），请改短一些`, 'invalid');
  }
  return s;
}

/**
 * 保存一份图纸。
 *
 * ⚠️ **允许重名**：用户常对同一张图存多个版本（改了颜色再存一份），
 *    强行去重会让后一份"覆盖"前一份 —— 那是**不可撤销的数据丢失**，
 *    与"删除前先确认"的纪律相反。列表里靠"尺寸 + 时间"区分同名的两份。
 *
 * @param {string} name 存档名（去空白后必须非空、不超长）
 * @param {Array<Array<object|null>>} grid 图纸网格（`state.gridData` 的形状）
 * @param {{now?:number}} [opts] `now` 仅供测试注入固定时间
 * @returns {{id:string, name:string, savedAt:number, rows:number, cols:number}}
 * @throws {StorageError} 名字非法 / 超份数 / 配额不足 / 存储不可用
 */
export function saveArchive(name, grid, opts = {}) {
  const clean = normalizeName(name);
  // 序列化先做：网格本身不合法（空、参差、缺色号）时**不该白占一个存档位**，
  // 而且 `serializeDoc` 抛的是 SerializeError，与本模块的 StorageError 各司其职。
  const doc = serializeDoc(grid);
  const built = buildDoc(grid);

  // ⚠️ 局部变量名**不要叫 `state`**：本模块的卖点之一就是"不写 `state`"
  //    （见文件头与 test-library.js 的静态判据），用一个同名局部变量会让
  //    "本文件里有没有碰全局 state"这件事**无法靠阅读与静态检查判断**。
  const lib = readLibrary();
  if (!lib.available) {
    throw new StorageError(lib.error || '本浏览器不允许使用本地存储', 'unavailable');
  }
  // ⚠️ `writable` 与 `available` 分开判（见 readLibrary 的说明）：
  //    "读得到但写不进"就是**空间满了**，此时用户该做的是删掉几份 ——
  //    而删除用得到"读"，正因为如此列表此时仍然给得出来。
  if (!lib.writable) {
    throw new StorageError(lib.error || QUOTA_MSG, 'quota');
  }
  if (lib.corrupt) {
    // 见文件头「损坏时不覆盖」：不冒把用户旧数据写没的风险
    throw new StorageError(lib.error || '本机的存档数据已损坏，已暂停保存', 'unavailable');
  }
  if (lib.items.length >= MAX_ARCHIVES) {
    throw new StorageError(
      `存档份数已达上限 ${MAX_ARCHIVES} 份，请先删除不再需要的存档`, 'limit');
  }

  const now = typeof opts.now === 'number' ? opts.now : Date.now();
  const entry = {
    id: makeId(now),
    name: clean,
    savedAt: now,
    // ⚠️ rows/cols 是**展示用元数据**，真源始终是 doc 正文 ——
    //    载入时尺寸以 `deserializeDoc()` 的结果为准（见 readArchive）。
    //    冗余一份的理由：列表刷新不必解析全部文档（见 itemMeta）。
    rows: built.rows,
    cols: built.cols,
    doc,
  };

  const rawItems = readRawItems();
  rawItems.push(entry);
  writeLibrary(rawItems);

  return { id: entry.id, name: entry.name, savedAt: entry.savedAt, rows: entry.rows, cols: entry.cols };
}

/**
 * 删除一份存档。
 *
 * ⚠️ 删除后写回的数据**一定比原来小**，因此**空间写满时删除仍应成功** ——
 *    这正是用户唯一的自救手段（见 `readLibrary` 的 available/writable 说明）。
 *    若将来有人把删除改成"先校验可写再动手"，这条自救路径就被封死了。
 *
 * @returns {boolean} 是否真的删掉了一份（id 不存在时返回 false）
 */
export function deleteArchive(id) {
  const rawItems = readRawItems();
  const left = rawItems.filter((it) => it.id !== id);
  if (left.length === rawItems.length) return false;
  writeLibrary(left);
  return true;
}

/**
 * 取出一份存档并转成网格（**载入路径的唯一入口**）。
 *
 * 尺寸以**文档正文**为准（`deserializeDoc` 的返回值），不信条目上的 `rows/cols` ——
 * 那只是展示元数据，万一两者不一致（旧版本的写入缺陷、人为改过 localStorage），
 * 以文档为准才不会画出尺寸错位的图。
 *
 * @param {string} id
 * @returns {{grid:Array<Array<object|null>>, rows:number, cols:number,
 *            warnings:Array<{name:string,count:number}>, name:string, savedAt:number}}
 * @throws {StorageError} id 不存在或文档读不出来
 */
export function readArchive(id) {
  const rawItems = readRawItems();
  const it = rawItems.find((x) => x.id === id);
  if (!it) {
    throw new StorageError('这份存档已不存在（可能已在别处删除）', 'invalid');
  }
  if (typeof it.doc !== 'string' || it.doc === '') {
    throw new StorageError('这份存档的内容为空，无法载入', 'invalid');
  }
  // 文档层的问题（版本过新、结构损坏、不是本程序格式）由 6a 抛 SerializeError，
  // 本模块**不吞掉它** —— UI 需要如实转述"为什么读不了"。
  const parsed = deserializeDoc(it.doc);
  return {
    grid: parsed.grid,
    rows: parsed.rows,
    cols: parsed.cols,
    warnings: parsed.warnings,
    name: typeof it.name === 'string' && it.name ? it.name : '未命名图纸',
    savedAt: it.savedAt,
  };
}

/** 供测试与诊断用：把集合的整体状态摘成一个标量对象 */
export function librarySummary() {
  const s = readLibrary();
  return {
    available: s.available,
    writable: s.writable,
    corrupt: s.corrupt,
    count: s.items.length,
    max: MAX_ARCHIVES,
    storeVersion: STORE_VERSION,
    docVersion: DOC_VERSION,
    docFormat: DOC_FORMAT,
  };
}
