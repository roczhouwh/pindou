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
    html += `
      <tr>
        <td><span class="color-swatch" style="background:${c.hex};"></span></td>
        <td><span class="color-name">${c.name}</span></td>
        <td><span class="color-hex">${c.hex}</span></td>
        <td><span class="color-count">${c.count}</span></td>
      </tr>`;
    total += c.count;
  }

  statsBody.innerHTML = html;
  statsFoot.innerHTML = `
    <tr>
      <td colspan="3">总计</td>
      <td><span class="color-count">${total} 颗</span></td>
    </tr>`;
}
