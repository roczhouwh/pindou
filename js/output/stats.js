import { $, statsBody, statsFoot, statsSection } from '../core/dom.js';
import { state } from '../core/state.js';

// ============================================================
// js/output/stats.js — 颜色用量统计表
// ============================================================
// 自 app.js 的「7. 颜色统计」整段搬迁而来（REFACTOR §7.1 步骤 5）。
//
// ⚠️ 统计**只读** `state.colorCounts`（由 js/pipeline/simplify.js 的
//    rebuildColorCounts / applySimplify 写入）。本模块不改变任何状态，
//    这是 REFACTOR 附录 A「gridData/colorCounts 建议改为单向」的第一步。
//
// 本文件是原生 ES module（步骤 0 已完成）：依赖由上方 import 显式声明，
// 不再靠"共享全局词法环境"。
// ============================================================
// ============================================================
// 7. 颜色统计
// ============================================================

export function renderStats() {
  if (!state.colorCounts) return;
  statsSection.hidden = false;

  let html = '';
  let total = 0;
  for (const c of state.colorCounts) {
    // 「选为画笔色」按钮（PLAN 第三批 6c）：**选色入口就挂在统计表上** ——
    // 这张表本来就是"当前图纸用到哪些色号"的清单，用户想改的正是其中一个，
    // 不必再去别处翻 221 色的色板。
    // ⚠️ 用真实 `<button>`（不是可点的 `<tr>`）：键盘可达、读屏能报出动作名，
    //    而"整行可点"在触屏上还会与滚动抢手势。
    // ⚠️ `data-name` 只带**色号名**，颜色对象由编辑层按名字回查 ——
    //    把 hex/rgb 也塞进 DOM 属性会让"哪个是真源"变成两处维护。
    html += `
      <tr>
        <td><span class="color-swatch" style="background:${c.hex};"></span></td>
        <td><span class="color-name">${c.name}</span></td>
        <td><span class="color-hex">${c.hex}</span></td>
        <td><span class="color-count">${c.count}</span></td>
        <td><button type="button" class="stats-pick-btn" data-name="${c.name}"
                    aria-label="用 ${c.name} 作为画笔颜色">🖌 选为画笔色</button></td>
      </tr>`;
    total += c.count;
  }

  statsBody.innerHTML = html;
  statsFoot.innerHTML = `
    <tr>
      <td colspan="4">总计</td>
      <td><span class="color-count">${total} 颗</span></td>
    </tr>`;
}
