# NEXT.md — 下一步入口（结构改造交接）

> ⚠️ **本文件已过期，内容已并入 [REFACTOR.md](REFACTOR.md) §八。**
> 保留它只为让旧链接不 404 —— **不要再以本文件为准**。
>
> **步骤 0（改 ESM）已于本轮完成**：真实仓库已迁移，`run-all.js` **21 套件 / 193 断言全绿**
> （另有真实 Chrome 端到端 **7/7**）。
> 当前状态与后续入口见 [REFACTOR.md](REFACTOR.md) §八 与 [CLAUDE.md](CLAUDE.md)。

---

## 一、历史现状（写作时：步骤 5 已完成、步骤 0 未开工）

**步骤 5（拆文件）已完成**：`app.js` 2136 行 → **19 个模块，`app.js` 已删除**。
**步骤 0（改 ESM）当时还没开始**，但所有前置障碍已实测清除。

> 上述「步骤 0 未开工」是**当时的**状态，现已改变。以下内容保留作历史记录。

---

## 二、步骤 0 的实际执行结果（已完成 ✅）

### 实际顺序（与原计划的差异已标注）

原计划：
```
① 改造 harness（新增 ESM 加载路径，但先不切换）
② 让 harness 两种模式都能跑（旧路径继续用，确认 188 仍绿）
③ 改产品代码为 ESM
④ 切换 harness 到 ESM 路径，跑 188
⑤ 删除旧的 eval 加载路径
```

**实际执行**：①②③④⑤ 全部完成。其中：
- ① 改为**直接重写** harness（不再保留 `window.eval` 分支），
  因为两条路径无法共存（同一个 `state` 只能有一种加载方式）；
- 因此 ⑤「删除旧的 eval 加载路径」**在①时就一并完成了**，
  而非等到最后 —— 原计划里"先不切换"这一步在实现上不成立。
- 断言数 **188 → 189**（新增了「src-manifest 判据已切换为 import 图」一条）。

### 实际改动清单

| 文件 | 改动 |
|---|---|
| 19 个产品模块 | 加 `import` / `export`（61 条 import、90 个 export 符号） |
| `index.html` | 19 个裸 `<script src>` → **1 个** `<script type="module" src="js/main.js">` |
| `sw.js` | `CACHE_NAME` `pindou-v17` → **`pindou-v18`**（清单 18 项，已核对与磁盘一致） |
| `color-palette.js` | 加 `export` |
| `.gitignore` | 新增 `.esm-backup/`（迁移脚本的本地备份，**不应提交**） |
| `.pindou-devtools/harness.js` | **重写**：拼接源码 + `window.eval` → runner 子进程 + 真实 `import()` |
| `.pindou-devtools/runner-esm.mjs` | **新增**：ESM 子进程（jsdom 预装 + 双通道协议） |
| `.pindou-devtools/jsdom-env.js` | **新增**：桩代码与项目目录的唯一装配点 |
| `.pindou-devtools/migrate-to-esm.js` | **新增**：一次性迁移工具（`--dry` / `--apply`，自动备份） |
| `.pindou-devtools/lint-noundef.js` | **重写**：双通道（ESM 独立模块作用域 / 经典共享词法环境）+ 坏 import 检查 |
| `.pindou-devtools/verify-review-claims.js` | `vm` 拼接 → 真实模块装载 |
| `.pindou-devtools/probe-esm-cost.js` | 断言②④ 判据按新现实翻转 |

### 已实测确认的事实（原文档列出，均已验证成立）

| 结论 | 状态 |
|---|---|
| 依赖图里有**环**，但 ESM **能正常加载** | ✅ 已实测（实际 **38 个**环） |
| 跨模块共享 `state` 在 ESM 下生效 | ✅ 已实测 |
| 环内函数可真实调用 | ✅ 已实测 |
| 加载期无未捕获异常（无 TDZ 报错） | ✅ 已实测 |
| 需要加 `export` 的符号数量 | 实测 **90 个**（原估 86） |

**结论：ESM 化的真正阻塞为零。** 环不是问题 —— 所有跨模块引用都在函数体内（延迟求值），
函数声明会提升，只有「顶层立即求值」才会踩 TDZ。

---

## 三、步骤 0 之后还剩什么

| 项 | 说明 |
|---|---|
| **步骤 6** | 拆 `pointermove` 三合一回调；把跨领域调用收拢到 `main.js`（REFACTOR §7.1 步骤 6、§3.3） |
| **文档同步** | ✅ 已完成（`REFACTOR.md` §八 / `CLAUDE.md` / `README.md`） |

---

## 四、模块清单（步骤 5 的产出，步骤 0 后未变）

```
js/core/     dom.js   state.js
js/input/    camera.js   upload.js
js/viewer/   viewer.js   selection.js   panzoom.js
js/pipeline/ render.js   simplify.js   grid.js
js/output/   preview.js   stats.js   export.js
js/ui/       a11y.js   grid-select.js   loading.js   install.js
js/main.js   （编排层，当前刻意不承载逻辑 —— 见下）
```

> ⚠️ **ESM 后「加载顺序不能颠倒」这条约束已消失** ——
> 依赖顺序由各模块的 `import` 语句表达，ESM 解析器负责拓扑排序。
> 原来的「<script> 顺序不对会抛 TDZ」不再是风险点。

> `js/main.js` 目前**刻意不承载逻辑**：§4.2 规划里它要收拢的跨领域编排
> （`pointerup` 反向驱动 `generateGrid`、`#resetBtn` 横跨 5 个领域）
> 属于**步骤 6** 的范围。**不要往它里面堆新功能。**

---

## 五、命令速查

```powershell
# 回归测试（退出码 0 = 全绿）—— 21 套件 / 193 断言
cd F:\claudeapp\demo\.pindou-devtools
node run-all.js

# 真实浏览器端到端（脚本自己起 http.server，无需手工准备）—— 7/7
# ⚠️ 若报「模块未被真实加载」，先删掉 %TEMP%\pindou-split-chrome
#    （残留的 Service Worker 缓存会让模块不走网络，是**环境**造成的假红）
node verify-browser-split.js

# 加/改模块后必跑：入口有没有把整张模块图拉起来
node probe-verify-entry-chain.js

# 突变测试（证明断言真的有约束力；会真实改动产品文件，跑完自动还原）
node probe-simplify-mutation.js
node probe-ruler-mutation.js

# 手工查看页面（⚠️ 必须经 HTTP，不能双击 —— ESM 受 CORS 限制）
cd F:\claudeapp\demo\pindou
python -m http.server 8080     # 访问 http://localhost:8080
```

---

## 六、脚手架工具一览（都在 `.pindou-devtools/`，不在交付物内）

| 文件 | 用途 |
|---|---|
| `src-manifest.js` | **源码清单唯一真源**：ESM 下从 `js/main.js` 的 import 图递归解析（旧形态回退到 `index.html`） |
| `src-index.js` | **符号源码索引**：`srcIndexOf('drawGrid').text` 取代 `app.js.indexOf(...)` |
| `runner-esm.mjs` | ESM 子进程：真实 `import()` 加载模块图 + 双通道协议 |
| `jsdom-env.js` | jsdom 环境与桩的唯一装配点 |
| `migrate-to-esm.js` | 一次性迁移工具（`--dry` / `--apply`，含 `sw.js` 清单核对） |
| `harness.js` | 测试端驱动（`createApp` → runner 子进程） |
| `probe-verify-entry-chain.js` | **入口链路守护**：main.js 是否拉起整张模块图（4/4，**已接入 run-all**） |
| `probe-esm-real.js` | 步骤 0 的可行性证据（4/4） |
| `probe-simplify-mutation.js` | **突变测试**：4 种"改回旧行为"必须让 `test-simplify.js` 转红 |
| `probe-ruler-mutation.js` | **突变测试**：8 种"标尺改坏"必须让 `test-ruler.js` 转红 |
| `verify-browser-split.js` | 真实 Chrome 端到端：页面仍完整可用（7/7） |

> **⚠️ 已标为"历史原型"、不要再运行的**（前提已消失，运行会明确跳过或报错）：
> `probe-src-index.js`（以单文件 `app.js` 为基线，方案已产品化为 `src-index.js`）、
> `probe-move-dryrun.js`（干跑前提是"符号都在 `app.js` 里"，该文件已删除）。
> 两者都加了 `require.main === module` 守卫 —— **不要去掉**，
> 因为 `src-index.js` 会 `require` 前者来复用词法器（见 §七 第 20 条）。

---

## 七、经验教训（真实踩到的坑，**新增步骤 0 的部分**）

### 步骤 5 期间（原有）

1. **`typeof x` 对未声明标识符返回 `"undefined"` 而不抛错** —— 拿它当"顺序敏感"的判据会**假绿**。
2. **测试里的文本计数必须先剥注释** —— 头注释里会有"看起来像代码"的文本。
3. **`lex()` 的 `holes` 是 `[start, end]` 的数组**，不是扁平数组。
4. **`probe-src-index.js` 的 `start`/`end` 是相对所属文件的偏移**，不能与整文 `indexOf` 比较。
5. **搬迁"函数群"时容易漏掉夹在中间的装配代码**。
6. **`<script>` 顺序不对会抛 TDZ**（ESM 后此风险消失）。

### 步骤 0 期间（新增 —— 都是本轮真实踩到的）

7. **`execFile` 返回后必须立刻 `child.stdout.pause()`**，中间不许插别的语句。
   返回时 stdout 已是 flowing 模式，没有监听器时到达的数据会被**直接丢弃**。
   表现为 `client.ready` 永远 pending、`app.state` 恒为 null。挂好监听再 `resume()`。

8. **`await client.ready` 立即 resolve ⇒ 十有八九是缺 getter**。
   `await undefined` 不报错、立刻返回。`get ready()` 忘了写就是这个症状。

9. **`BRIDGE` 白名单里不能有定时器**（`setTimeout` 等）—— 会与 jsdom 自递归，
   报 `RangeError: Maximum call stack size exceeded`。用 Node 自己的。

10. **`installGlobals` 要在 `buildEnv` 之后**再调一次：`buildEnv` 会替换 window 上的桩，
    导致 `FileReader is not defined` / `Image is not defined`。

11. **剥注释时不能把字符串/模板字面量一起抹掉**：`exportScaleNote` 出现在**模板字面量**里，
    用"剥注释+字符串"的版本扫描会导致**漏 export**。要的是 `stripCommentsOnly()`。

12. **`EXTRA_EXPORTS` 不能漏**：不被别的模块引用的符号不会自动 export，
    但脚手架要读它们（如 `computeDownloadSize`）。

13. **stdout 会被大数组打爆**：几 MB 的 `Uint8ClampedArray` / `state.image.__pixels`
    会让子进程被杀（`code=null`，看不出原因）。要显式拒绝超大值并给可操作提示。

14. **`setInterval(...).unref()` 会让子进程提前退出** ——
    父进程阻塞在 `Atomics.wait` 上时，子进程的同步目录轮询必须保持事件循环存活。
    **不要加 `.unref()`。**

15. **`app.inner.*` 是异步的，漏 `await` 会造成偶发红**（本轮最隐蔽的一类缺陷）。
    实测：`test-e2e` 的「回归 C1」约 40% 概率红（报 `滑块应生效 0 !== 60`），
    `test-a11y` 的「m6」偶发 22/23 —— 全是漏 `await`。
    **共修 12 处**（测试套件）+ **17 处**（探针）。
    模板字面量里**不能**直接 await，必须先取出来再插值。

16. **同一个"引用稳定性"需求会与"就地写穿透"冲突**：
    我为稳住 `test-ruler` 的引用断言加了"按编码串缓存解码结果"，
    结果共享的可变数组让 `test-n7` 的就地写**落在了缓存上**（写没穿透、还把缓存改脏）。
    实测两者**此消彼长**（禁缓存 → n7 绿/ruler 红）。
    **正解**：缓存按 app 实例隔离 + 给网格套"只加 `set` 陷阱"的代理下发子进程，
    代理身份按骨架 WeakMap 缓存 ⇒ 两个需求同时满足。

17. **静态检查必须防"假绿退化"**：ESM 化后 DOM 声明都带 `export ` 前缀，
    只匹配 `^const` 会让「死 DOM 引用」检查**静默退化为 0 个引用**并永远报通过。
    已加哨兵：解析到 0 个声明但源码里有 `$('#…')` 时报错。

18. **判"是否仍用旧路径"之前必须剥注释**：`harness.js` 的头注释里写到了
    `window.eval(拼接源码)`（有价值的说明），直接扫原文会误判为"仍在使用"。

19. **迁移工具的文档承诺要与实现一致**：`migrate-to-esm.js` 头部写了
    ⑤「同步 sw.js 的 CACHE_NAME 与资源清单」，但**代码里从没实现**。
    `CACHE_NAME` 不递增会让 cache-first 的老用户一直拿到旧文件。已补上并有核对。

20. **⚠️ 被 `require` 的文件里不能有"提前退出"的副作用**
    （本轮**最危险**的一处，靠突变测试才发现）。

    `probe-src-index.js` 既是**可运行原型**，又被 `src-index.js` 用
    `require('./probe-src-index')` **复用其词法器**。我给它加了一句
    「前提消失就 `process.exit(0)` 跳过」，后果是：

    > **每一个引用 `src-index` 的套件**（`test-simplify.js` / `lint-noundef.js` …）
    > **都在加载期直接退出、退出码 0** —— 表现为"套件全绿"，
    > 而实际上**一条断言都没跑**。

    **正解**：任何"跳过/提前退出"都必须包在 `require.main === module` 判断里。

    > **为什么这条值得单独记**：它是一次**静默的、覆盖整张安全网**的假绿 ——
    > 而且是我**自己为了"清理一个历史探针"而引入的新缺陷**。
    >
    > 抓到它靠的是**突变测试**：把 `generateGridCore` 改坏后
    > `test-simplify.js` **仍然 exit 0**，才顺藤摸到根因。
    > **当时全量回归 `run-all.js` 是全绿的** —— 它完全没发现。
    >
    > **推论**：`run-all.js` 全绿 ≠ 断言真的跑了。
    > **突变测试是这种假绿的唯一解药**，这也是为什么
    > `probe-simplify-mutation.js` / `probe-ruler-mutation.js` 必须保持可用。

21. **步骤 0/5 会让"读单个源码文件"的探针全部失效，且失效形态不止一种**：
    本轮修了 6 个探针，共三种失效形态与三种对策：

    | 失效形态 | 例子 | 表现 | 对策 |
    |---|---|---|---|
    | 读 `app.js`（已删除） | `probe-nearcolor` / `probe-src-index` / `probe-move-dryrun` | `ENOENT` | 改读新模块 / 标为历史并加 `require.main` 守卫 |
    | `new Function(源码)` 求值 ESM | `probe-nearcolor` | `SyntaxError: Unexpected token 'export'` | 改用真实模块装载器（`require(绝对路径)`，Node ≥ 22.12 支持 require ESM） |
    | 把大数组搬过进程边界 | `probe-ruler-density` | 「runner 应答过大（2813KB > 2048KB）」 | **在子进程里算成标量再传回** |

    > 第三种为此给 harness 补了两个方法：`ctx.countCalls(method, pred)` 与
    > `ctx.distinctNumbers(method, argIndex, pred)` —— 判据只需"数一数/去重后有哪些"，
    > 根本不必把几 MB 的调用记录搬过来。谓词**在子进程里跑**，所以不能引用本进程的自由变量。
    >
    > ⚠️ **突变探针必须修好、不能只标"历史"** —— 它们是"断言是否真有约束力"的唯一手段
    > （见第 20 条）。两个突变探针现已改为**按模块定位**（每条突变写明 `file`），
    > 因为标尺代码在步骤 5 后散落在 `render.js` / `export.js` / `preview.js` **三处**，
    > 而近似色合并的调用点（`grid.js`）与实现在 `simplify.js` 也**分了家**。

22. **⚠️⚠️ 入口没有 `import` ⇒ 整张模块图不会被浏览器加载**
    （本轮**最严重**的缺陷：测试全绿，页面完全没反应）。

    **事实**：`index.html` 改成单入口 `<script type="module" src="js/main.js">` 后，
    `js/main.js` **只有注释、一条 `import` 都没有**
    （它原先被设计成"占位编排层"，依赖的是"标签顺序即依赖"的旧模型）。

    **后果**：ESM 的模块图是**从入口的 import 出发**解析的 ——
    没被 import 到的文件**浏览器根本不会请求**。实测 Chrome 网络层只看到
    `index.html / style.css / js/main.js / manifest.json / icon-*.png`，
    **18 个 js/ 模块一个都没加载**。

    **为什么 `run-all.js` 全绿也没发现**（三个检查都**结构性地**看不见）：

    | 检查 | 盲区所在 |
    |---|---|
    | `run-all.js` 脚手架 | `await import(js/main.js)` 之后**又按 `MODULES` 数组逐个 import** 了全部模块 —— **绕过了入口** |
    | `lint-noundef.js` | 只看"每个文件自己有没有坏引用"，不问"有没有人引用它" |
    | `probe-esm-real.js` 等 | import 的是**指定的模块清单**，同样不经过入口 |

    **修法**：`main.js` 补齐 **17 条静态 `import './xxx.js'`**（覆盖全部模块）。

    **守护**（**已接入 `run-all.js`，放在最前**）：`probe-verify-entry-chain.js`，
    4 条断言 —— ① 唯一 module 入口；② **沿 import 图可达每一个** `js/` 模块；
    ③ 入口的 import 是**静态**的（动态 `import()` 不参与加载期模块图）；
    ④ 真实 `import()` 后符号可用。
    **已用突变测试自证**：删光 main.js 的 import → 探针转红（2/4 失败）。

    > **⚠️ 加模块时必须同步在入口补 import**（若它不被其它模块引用）——
    > 否则那个文件**永远不会被加载**，而且**所有自动化检查都发现不了**。

23. **`check()` 不 `await` 而断言体是 `async` ⇒ 整份报告是假绿**

    `verify-browser-split.js` 的 `check` 原本是同步的：
    ```js
    function check(name, fn) {
      try { fn(); results.push(['✅', name]); }
      catch (e) { results.push(['❌', ...]); }
    }
    ```
    而 **7 条断言里有 6 条是 `async`**。`fn()` 只返回一个 Promise，
    **同步的 `try/catch` 抓不到它内部的失败** —— 断言体还没跑完就被记为 ✅，
    内部抛错变成 unhandled rejection、消失在噪音里。

    **它曾报出「✅ 真实浏览器验证通过 (7/7)」**，而同一次运行里
    页面明明有第 22 条那个模块加载问题。**这是一次彻底的假绿。**

    **修法**：`await fn()`；全部 7 个调用点补 `await`；
    再注册 `process.on('unhandledRejection')` 让未捕获的 Promise 失败**硬失败**
    （Node 默认只打印警告、**退出码仍是 0** —— 对脚本来说等于"通过"）。

24. **探针初版与"已是 ESM 的源码"重叠时，判据要判全**
    （第 21 条那个 `probe-esm-real.js` 的**第二版**坑）。

    它是**步骤 0 开工前**的机械转换验证，会给源码加 `export`。
    改造后源码已是 ESM，于是我加了"已是 ESM 就跳过"的守卫 ——
    但第一版守卫只判 `export`：

    > `js/main.js` 是**副作用入口**：有 17 条 `import`，却**一条 `export` 都没有**。
    > 只判 `export` ⇒ 它被当成"未迁移" ⇒ **再前置一遍 import 头** ⇒
    > 同一模块被导入两次 ⇒ `SyntaxError: Identifier 'viewerWrapper' has already been declared`。

    **正解**：判据改为 `/(?:export|import)\s/m` —— **两者任一出现**即视为已是 ESM，
    机械改写**整体让路**（不要再"补插 import 头"）。

    > **一般化的教训**：写"是否已迁移/已处理"这类**幂等守卫**时，
    > 判据要覆盖**全部**迁移特征，不能只挑最显眼的那一个。
    > 这里 `export` 是最显眼的，而 `import` 才是入口类文件的唯一特征。

25. **中断会留下"突变残留"，必须三层防护**（在突变探针上实测踩到）。

    突变探针会**真的改动产品文件**。跑到一半被 Ctrl+C / 超时杀掉，
    文件就**停在突变状态** —— 之后 `run-all.js` 莫名其妙地红，
    而看代码的人分不清那是"探针残留"还是"真的坏了"。

    实测确认：**`SIGKILL` 拦不住**（不触发任何退出处理器）。
    本轮就真的留下了两处残留（`export.js` 的 `canvasW` 少了 `+ gutter`、
    `grid.js` 的 `applySimplify()` 调用被换成条件分支），
    **是后来人工核对/自检才发现的**。

    **三层防护，缺一不可**：
    | 层 | 作用 |
    |---|---|
    | ① **启动自检** `assertClean()` | 开跑前确认产品文件**不是**突变态。**这是 `SIGKILL` 唯一能靠的一层** |
    | ② **退出即还原** `restoreAll()` | 覆盖正常结束、异常、`SIGINT`/`SIGTERM` |
    | ③ 每条突变后**立刻还原** | 不让下一条建立在脏状态上 |

    > ⚠️ 还原用**启动时读到的原文**，**不用 `git checkout`** ——
    > 那样会误伤工作区里其它未提交的改动。
    > ⚠️ `assertClean()` 必须在"确认原始状态是绿的"**之前**跑，
    > 否则残留会让测试先变红、报到"前提失败"上去，把"探针脏了"误报成"代码坏了"。
