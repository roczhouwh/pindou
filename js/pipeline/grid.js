// ============================================================
// js/pipeline/grid.js — 网格生成（逐格采样 → 色板映射）
// ============================================================
// 自 app.js 的「5. 网格生成 + 色板映射」整段搬迁而来（REFACTOR §7.1 步骤 5）。
//
// ⚠️ **两条契约必须原样保留**（均有测试守护，见 test-patch-removal.js）：
//   ① `generateGrid()` 是**唯一入口** —— 它驱动加载遮罩 + 把重活推到 rAF + finally 兜底。
//      真实实现在 `generateGridCore()`；**直接调它会绕过遮罩**，
//      用户观感就是"点了没反应"（CLAUDE.md 有同类教训）。
//   ② **时序契约**：`generateGrid()` 返回时 `state.gridData` / `state.colorCounts`
//      **仍是上一轮**的数据（真实生成被推迟到下一帧）。需要新数据请在下一帧之后再读。
//
// ⚠️ 两者**必须同文件** —— 入口与实现是同一职责，拆开会让 ① 的"唯一入口"失效。
//
// 当前阶段仍用裸 <script> src 加载（步骤 0 未做），故本文件不使用 import/export。
// 它调用的 showLoading / hideLoading / showToast / announce / renderPreview /
// renderStats / applySimplify 等来自其它文件，靠共享全局词法环境解析。
// ============================================================
// ============================================================
// 5. 网格生成 + 色板映射
// ============================================================
/**
 * 生成图纸的**唯一入口**（编排：加载遮罩 + 帧调度 + 错误兜底）。
 *
 * ⚠️ **时序契约（REFACTOR.md §7.4 步 1 要求显式化）**：
 * 真实生成被推迟到 `requestAnimationFrame`，因此**本函数返回时
 * `state.gridData` / `state.colorCounts` 仍是上一轮的数据**。
 * 调用后立刻读这两个字段会读到旧值；需要新数据请在下一帧之后再读。
 * 步骤 5 搬迁模块时务必保留此语义，否则会出现"偶发读到上一轮"的 bug。
 *
 * 收尾放在 `finally` 是必须的：真实生成一旦抛错，`hideLoading()` 将永不执行，
 * 加载遮罩会**永久卡死界面**（这正是下方 catch 存在的理由）。
 *
 * > 本函数此前是「函数声明 + 文件末尾猴补丁整体覆盖」的形态，
 * > 已按 REFACTOR.md §2.1 拆除。**不要再对函数做猴补丁** —— 它是模块化的硬阻塞。
 */
function generateGrid() {
  const startTime = Date.now();
  showLoading('正在生成图纸…');
  // 用 rAF 把重活推到下一帧：先让遮罩真正画出来，再阻塞主线程采样
  requestAnimationFrame(() => {
    try {
      generateGridCore();
    } catch (err) {
      // 必须兜住：否则 hideLoading 永远不会执行，遮罩会永久卡死界面
      console.error('生成图纸失败：', err);
      showToast('生成图纸失败，请调整选框后重试');
    } finally {
      // 至少显示 300ms 避免闪烁
      const elapsed = Date.now() - startTime;
      setTimeout(hideLoading, Math.max(0, 300 - elapsed));
    }
  });
}

/**
 * 真实的网格生成实现（逐格采样 → 色板映射 → 颜色简化 → 预览 + 统计）。
 *
 * **请勿直接调用** —— 走 `generateGrid()` 入口，否则加载遮罩不会被驱动，
 * 用户观感就是"点了没反应"（见 CLAUDE.md「按阶段选对函数」的同类教训）。
 */
function generateGridCore() {
  if (!state.image) return;

  const { x, y, w, h } = state.selection;
  const gw = state.gridW;
  const gh = state.gridH;

  // 创建离屏 canvas 用于采样。
  // iOS Safari 对大 canvas 有硬限制（~4096px 或总像素上限），
  // 大图先降采样到最长边 2048 再采样。
  // ⚠️ 精度说明（更正原注释）：降采样**会**影响颜色 —— drawImage 会做平滑平均，
  // 对细纹理/高频细节是真实的低通损失，只是对"每格平均色"这一用途影响很小。
  // 原注释称"颜色精度不受影响"夸大其保证（见 REVIEW.md m11）。
  // 用 imageSmoothingQuality='high' 减轻该损失（见 REVIEW.md n9）。
  const MAX_OFFSCREEN = 2048;
  let sampleW = state.imageW;
  let sampleH = state.imageH;
  if (Math.max(sampleW, sampleH) > MAX_OFFSCREEN) {
    const scale = MAX_OFFSCREEN / Math.max(sampleW, sampleH);
    sampleW = Math.round(sampleW * scale);
    sampleH = Math.round(sampleH * scale);
  }

  const offCtx = offscreenCanvas.getContext('2d');
  offscreenCanvas.width = sampleW;
  offscreenCanvas.height = sampleH;
  // 降采样质量默认是 'low'，会加重细纹理的插值损失（见 REVIEW.md n9）。
  // 必须在赋值 width/height **之后**设置：给 canvas 尺寸赋值会重置绘图状态。
  offCtx.imageSmoothingEnabled = true;
  offCtx.imageSmoothingQuality = 'high';
  offCtx.drawImage(state.image, 0, 0, sampleW, sampleH);

  // 选框像素坐标
  // 夹取到图片范围内：选框由 UI 拖拽产生，x+w 可能 > 1（拖到右/下缘外），
  // 不夹取会让后面的裁剪宽高算出负数（见 REVIEW.md M10）
  const selX = clamp(Math.floor(x * sampleW), 0, sampleW - 1);
  const selY = clamp(Math.floor(y * sampleH), 0, sampleH - 1);
  const selW = Math.max(1, Math.min(Math.floor(w * sampleW), sampleW - selX));
  const selH = Math.max(1, Math.min(Math.floor(h * sampleH), sampleH - selY));

  // ---- 选框内容完整放入网格（contain），居中，不裁剪 ----
  // 选框宽高比 vs 网格宽高比，计算内容在网格中占据的格数
  // 选框宽于网格时，内容填满宽度，上下留空；高于网格时，填满高度，左右留空
  const selAspect = selW / selH;
  const gridAspect = gw / gh;

  let contentW, contentH, offsetCol, offsetRow;
  if (selAspect >= gridAspect) {
    // 内容填满宽度，上下留空
    // 取整分工（见 REVIEW.md m14）：格数取最接近值（round），留白取整数格（floor）
    contentW = gw;
    contentH = Math.max(1, Math.min(gh, Math.round(gw / selAspect)));
    offsetCol = 0;
    offsetRow = Math.floor((gh - contentH) / 2);
  } else {
    // 内容填满高度，左右留空
    contentH = gh;
    contentW = Math.max(1, Math.min(gw, Math.round(gh * selAspect)));
    offsetCol = Math.floor((gw - contentW) / 2);
    offsetRow = 0;
  }

  // ---- 极端宽高比的量化偏差提示（见 REVIEW.md M9）----
  // 内容只占很少格数时，Math.round 的 ±0.5 格就是很大的相对偏差
  // （实测 29×29 配 20:1 选框 → 内容 29×1，偏差 +45%）。
  // 这不是逻辑错误而是**量化极限**（偏差 ≈ 0.5 ÷ content 短边格数），
  // 故不强行修正，而是如实提示用户。
  const contentShort = Math.min(contentW, contentH);
  const quantError = 0.5 / contentShort;
  state.aspectWarning = quantError > 0.08
    ? `选框比例较极端（内容仅 ${contentW}×${contentH} 格），图纸约有 ${Math.round(quantError * 100)}% 的量化拉伸。建议把选框选得更方正些。`
    : null;

  // 每个内容格对应选框的像素尺寸（contentW/gw = contentH/gh = selAspect，格子为正方形）
  const cellSampW = selW / contentW;
  const cellSampH = selH / contentH;

  const grid = [];
  const colorMap = new Map();

  for (let row = 0; row < gh; row++) {
    grid[row] = [];
    for (let col = 0; col < gw; col++) {
      // 判断是否在内容区域内，不在则留空
      if (row < offsetRow || row >= offsetRow + contentH ||
          col < offsetCol || col >= offsetCol + contentW) {
        grid[row][col] = null;
        continue;
      }

      // 映射到选框内的像素坐标
      const contentRow = row - offsetRow;
      const contentCol = col - offsetCol;

      // 每格采样区 = 该格在选框内占据的完整矩形，相邻格首尾相接。
      // 旧实现用「中心点 ± 半格窗口」，窗口边长只有 cellSamp*0.5，
      // 导致相邻窗口之间空出半格宽的缝（见 REVIEW.md M11）：
      // 实测 512→29 时整行 54.7% 的像素从未被采样，且缝隙随列号周期漂移，
      // 等效固定相位梳状降采样，细纹理图会产生规律性串色。
      // 改为按格边界取整，并保证 [x0, x1) 至少 1px、不超出画布。
      let x0 = selX + Math.floor(contentCol * cellSampW);
      let x1 = selX + Math.floor((contentCol + 1) * cellSampW);
      let y0 = selY + Math.floor(contentRow * cellSampH);
      let y1 = selY + Math.floor((contentRow + 1) * cellSampH);

      x0 = clamp(x0, 0, sampleW - 1);
      x1 = clamp(x1, x0 + 1, sampleW);
      y0 = clamp(y0, 0, sampleH - 1);
      y1 = clamp(y1, y0 + 1, sampleH);

      const imageData = offCtx.getImageData(x0, y0, x1 - x0, y1 - y0);

      // 平均色
      let r = 0, g = 0, b = 0, count = 0;
      for (let i = 0; i < imageData.data.length; i += 4) {
        const alpha = imageData.data[i + 3];
        if (alpha < 128) continue; // 透明/半透明像素跳过
        r += imageData.data[i];
        g += imageData.data[i + 1];
        b += imageData.data[i + 2];
        count++;
      }

      if (count === 0) {
        // 整格全透明，标记为空
        grid[row][col] = null;
      } else {
        const avg = { r: Math.round(r / count), g: Math.round(g / count), b: Math.round(b / count) };
        const nearest = findNearestColor(avg);
        grid[row][col] = nearest;

        // 统计（空格不计入）
        const key = nearest.hex;
        if (!colorMap.has(key)) {
          colorMap.set(key, { ...nearest, count: 0 });
        }
        colorMap.get(key).count++;
      }
    }
  }

  // 保存原始映射数据（颜色简化用）
  // 深拷贝两层：行数组与**格子对象**都要独立。
  // 必要性（见 REVIEW.md n7 / PLAN §3.4）：
  //  ① `findNearestColor` 返回的是 PERLER_PALETTE 里的**对象引用**，
  //     若直接存进 gridData，将来做单元格编辑就会就地改坏**全局色板**；
  //  ② gridData 与 rawGridData 若共享行数组，"滑块回 0 恢复原始数据"
  //     会恢复出被编辑过的内容且不可逆。
  state.rawGridData = cloneGrid(grid);
  // 与 rebuildColorCounts 一致地按数量降序：否则 simplify=0 与 simplify>0
  // 两条路径给出的统计表顺序不同，拖动滑块会看到表格重排（见 REVIEW.md M1）
  state.rawColorCounts = Array.from(colorMap.values())
    .map(c => ({ ...c }))
    .sort((a, b) => b.count - a.count);

  // 应用颜色简化。
  // ⚠️ **无论滑块是否为 0 都必须走 `applySimplify()`** —— 它内含
  // 「常开近似色合并」层（针对色板自身的近同色对，见该函数 JSDoc）。
  // 此前 `simplify <= 0` 时走的是"直接复制 raw"的旁路，导致默认状态下
  // 近同色对原样存在、凭空多出色号（PLAN §3.1 的缺陷）。
  applySimplify();

  renderPreview();
  renderStats();
  downloadBtn.disabled = false;
  // 播报生成结果：读屏用户此前对"图纸已生成"完全无感（见 REVIEW.md M5）
  announce(`图纸已生成：${gw}×${gh} 网格，${state.colorCounts ? state.colorCounts.length : 0} 种颜色`);
}
