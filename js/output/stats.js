// ============================================================
// js/output/stats.js — 颜色用量统计表
// ============================================================
// 自 app.js 的「7. 颜色统计」整段搬迁而来（REFACTOR §7.1 步骤 5）。
//
// ⚠️ 统计**只读** `state.colorCounts`（由 js/pipeline/simplify.js 的
//    rebuildColorCounts / applySimplify 写入）。本模块不改变任何状态，
//    这是 REFACTOR 附录 A「gridData/colorCounts 建议改为单向」的第一步。
//
// 当前阶段仍用裸 <script> src 加载（步骤 0 未做），故本文件不使用 import/export。
// ============================================================
// ============================================================
// 7. 颜色统计
// ============================================================

function renderStats() {
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
