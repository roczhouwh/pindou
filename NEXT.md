# NEXT.md — 下一步入口（结构改造交接）

> **本文件是一次性的交接说明，不是长期文档。**
> 结构改造全部完成后请删除它，或把内容合并进 [REFACTOR.md](REFACTOR.md)。
>
> 写作时间：本次会话结束时（步骤 5 已完成、步骤 0 尚未开工）
> 基线：`run-all.js` **20 套件 / 188 断言全绿**，`git status` 干净

---

## 一、一句话现状

**步骤 5（拆文件）已全部完成**：`app.js` 2136 行 → **19 个模块，`app.js` 已删除**。
**步骤 0（改 ESM）还没开始**，但**所有前置障碍已实测清除**，可以开工。

---

## 二、明天从这里开始（步骤 0）

### 目标

把裸 `<script src>` 改成原生 ES module：

1. `index.html` 的 19 个 `<script src=...>` 加 `type="module"`
2. 19 个模块加 `import` / `export`
3. `sw.js` 清单同步（模块路径不变，但 `CACHE_NAME` 要递增）
4. **改造测试脚手架**：`harness.js` 的加载方式从「拼接源码 + `window.eval`」改成真实 ESM `import`

### ⚠️ 顺序硬约束：先改脚手架，再改产品代码

`harness.js` 靠 `window.eval(拼接源码)` 加载，**与 ESM 不兼容**（`export` 在 eval 里是语法错误）。
若先改产品代码，**188 条断言会立刻全失效**，后续改动将没有安全网。

**正确顺序**：
```
① 改造 harness（新增 ESM 加载路径，但先不切换）
② 让 harness 两种模式都能跑（旧路径继续用，确认 188 仍绿）
③ 改产品代码为 ESM
④ 切换 harness 到 ESM 路径，跑 188
⑤ 删除旧的 eval 加载路径
```

### 已实测确认的事实（可直接依赖，不必重验）

> 证据脚本：`.pindou-devtools/probe-esm-real.js`（**4/4 通过**）
> 它把**真实的 19 个模块**机械转成 ESM 后，在 Node ESM + 预装 jsdom 下真实加载并驱动。

| 结论 | 状态 |
|---|---|
| 依赖图里有**环**（7 个模块构成一个大环），但 ESM **能正常加载** | ✅ 已实测 |
| 跨模块共享 `state` 在 ESM 下生效（环内两模块拿到同一对象引用） | ✅ 已实测 |
| 环内函数可真实调用（`generateGrid` / `drawGrid` 均为 function） | ✅ 已实测 |
| 加载期无未捕获异常（无 TDZ 报错） | ✅ 已实测 |
| 全项目 200+ 处跨模块引用中，**顶层立即求值只有 1 处**，且是启发式对箭头函数体的**误报** | ✅ 已实测 |
| 需要加 `export` 的符号数量 | **86 个** |

**结论：ESM 化的真正阻塞为零。** 环不是问题 —— 因为所有跨模块引用都在函数体内（延迟求值），
函数声明会提升，只有「顶层立即求值」才会踩 TDZ，而那种情况已经不存在了。

### 可以复用的转换逻辑

`.pindou-devtools/probe-esm-real.js` 里已经写好了**机械转换器**（在临时目录里跑）：

- 用 `src-index.js` 建符号归属表 → 算出每个模块该 `import` 谁
- 按 `idx.symbols` 的偏移给顶层声明加 `export` 前缀
- 边界匹配用的是 `(^|[^A-Za-z0-9_$])NAME(?![A-Za-z0-9_$])`
  （**注意**：`$` / `$$` 这类符号名用 `\b` 会匹配错，已踩过）

把它从「实验脚本」改造成「一次性迁移脚本」即可 —— 但**建议迁移后人工复核**，
不要盲信机械结果。

### 顺带已在上一轮修掉的一处真实隐患

`js/input/upload.js` 的 `window.addEventListener('pagehide', closeCamera)`
已改为 `() => closeCamera()` —— 直接传函数引用会在模块顶层立即求值，
ESM 下与 `camera.js` 的循环导入会抛 TDZ。**不要改回去。**

---

## 三、步骤 0 之后还剩什么

| 项 | 说明 |
|---|---|
| **步骤 6** | 拆 `pointermove` 三合一回调；把跨领域调用收拢到 `main.js`（REFACTOR §7.1 步骤 6、§3.3） |
| **文档同步** | `REFACTOR.md` / `CLAUDE.md` / `README.md` 的「文件结构」「运行方式」等章节仍描述旧的 `app.js` 单文件形态 |
| `README.md` | 「必须经 HTTP 服务打开」要强调**不再支持双击**（ESM 的既定代价，用户已确认接受） |

---

## 四、当前模块清单（步骤 5 的产出）

```
js/core/     dom.js 74   state.js 146
js/input/    camera.js 95   upload.js 132
js/viewer/   viewer.js 176   selection.js 152   panzoom.js 97
js/pipeline/ render.js 250   simplify.js 202   grid.js 229
js/output/   preview.js 167   stats.js 39   export.js 320
js/ui/       a11y.js 125   grid-select.js 91   loading.js 24   install.js 44
js/main.js   38（编排层，当前不承载逻辑 —— 见下）
```

**加载顺序**（= 依赖层次，**不能颠倒**）：

```
color-palette.js
→ js/core/dom.js, js/core/state.js
→ js/input/camera.js, js/input/upload.js
→ js/pipeline/render.js, simplify.js, grid.js
→ js/viewer/viewer.js, selection.js, panzoom.js
→ js/output/preview.js, stats.js, export.js
→ js/ui/a11y.js, grid-select.js, loading.js, install.js
→ js/main.js
```

> `js/main.js` 目前**刻意不承载逻辑**：§4.2 规划里它要收拢的跨领域编排
> （`pointerup` 反向驱动 `generateGrid`、`#resetBtn` 横跨 5 个领域）
> 属于**步骤 6** 的范围。它的存在是为了给步骤 6 一个明确落点，
> 以及步骤 0 后成为模块图入口。**不要往它里面堆新功能。**

---

## 五、命令速查

```powershell
# 回归测试（退出码 0 = 全绿）
cd F:\claudeapp\demo\.pindou-devtools
node run-all.js

# 真实浏览器端到端（脚本自己起 http.server，无需手工准备）
node verify-browser-split.js

# ESM 转换可行性（含真实加载）
node probe-esm-real.js

# 手工查看页面
cd F:\claudeapp\demo\pindou
python -m http.server 8080     # 访问 http://localhost:8080
```

---

## 六、本次会话新增的脚手架工具（都在 `.pindou-devtools/`，不在交付物内）

| 文件 | 用途 |
|---|---|
| `src-manifest.js` | **源码清单唯一真源**：解析 `index.html` 的 `<script src>` 顺序。加模块不用改脚手架 |
| `src-index.js` | **符号源码索引**：`srcIndexOf('drawGrid').text` 取代 `app.js.indexOf(...)`。让测试对「符号在哪个文件」免疫 |
| `probe-src-index.js` | 索引的可行性原型（130/130）。`src-index.js` 复用了它的词法器 |
| `probe-move-dryrun.js` | 搬家干跑：真实把符号切到新文件，验证测试是否仍通过 |
| `probe-split-share.js` | 真实 Chrome：验证「经典多 script」与 ESM 的 `state` 共享行为等价（6/6） |
| `probe-esm-real.js` | **步骤 0 的可行性证据**（4/4） |
| `verify-browser-split.js` | 真实 Chrome 端到端：拆文件后页面仍完整可用（7/7） |

> 这些工具**后续步骤仍会用到**（尤其步骤 0 改脚手架、步骤 6），不要删。

---

## 七、经验教训（本次会话真实踩到的坑）

1. **`typeof x` 对未声明标识符返回 `"undefined"` 而不抛错** —— 拿它当"顺序敏感"的判据会**假绿**。
   要测 TDZ 必须**直接访问**（如 `state.gridW`）。
2. **测试里的文本计数必须先剥注释** —— 新模块的头注释里写了 `computeImageRect(w, h)`、
   `type="module"` 这类**看起来像代码的文本**，直接扫原文会误报。
   `src-index.js` 已提供 `stripCommentsAndStrings()` / `srcCode()`。
3. **`lex()` 的 `holes` 是 `[start, end]` 的数组**，不是扁平数组。按扁平处理会让遮罩变成空操作（静默失效）。
4. **`probe-src-index.js` 的 `start`/`end` 是相对所属文件的偏移**，不能与整文 `indexOf` 结果比较。
   用 `ownersOf()` 或 `fileAt()` 代替。
5. **搬迁"函数群"时容易漏掉夹在中间的装配代码** —— 本次就漏了 `downloadBtn`/`shareBtn`
   的 click 注册，表现为"点下载没反应"。这类缺陷**测试网能抓到，肉眼看不出来**。
6. **`<script>` 顺序不对会抛 TDZ**，且报错信息（`Cannot access '$' before initialization`）
   不会直接告诉你是哪两个文件的问题。改顺序后务必跑真实浏览器验证。
