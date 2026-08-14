'use strict';
/* ═══════════════════════════════════════════
   无字情书 · 祖鲁珠绣 — Zulu Love Letters
   交互式珠绣密语创作器
   ═══════════════════════════════════════════ */

/* ── 祖鲁珠绣颜色密码（7 色，含正/反双重含义）── */
const COLORS = [
  null, // 0 = 空
  { name: '白色', zulu: 'mhlophe', hex: '#F5F0E8',
    pos: '纯洁、真爱、忠贞、好运', neg: null },
  { name: '黑色', zulu: 'msimamo', hex: '#1C1C1E',
    pos: '婚姻、重生、承诺', neg: '悲伤、黑暗、不幸' },
  { name: '红色', zulu: 'bomvu', hex: '#C0392B',
    pos: '炽热的爱、激情、强烈情感', neg: '愤怒、心痛、望眼欲穿' },
  { name: '蓝色', zulu: 'ijuba（鸽子）', hex: '#2E6FB5',
    pos: '忠诚、坚贞、求爱', neg: '孤独、相思、敌意' },
  { name: '黄色', zulu: 'iphuzi', hex: '#E8B522',
    pos: '财富、丰收、生育', neg: '嫉妒、贫瘠、相思' },
  { name: '绿色', zulu: 'uluhlaza（新草）', hex: '#2E8B57',
    pos: '新生、满足、家和', neg: '疾病、相思、嫉妒' },
  { name: '粉色', zulu: '—', hex: '#D4759A',
    pos: '新生、希望', neg: '贫穷、拮据' },
];

/* ── 图形符号 ── */
const SHAPES = {
  pen:      { label: '笔', icon: 'pen' },
  triUp:    { label: '正三角', icon: 'triUp', meaning: '未婚女子' },
  triDown:  { label: '倒三角', icon: 'triDown', meaning: '未婚男子' },
  diamond:  { label: '菱形', icon: 'diamond', meaning: '已婚女子·生育' },
  hourglass:{ label: '沙漏', icon: 'hourglass', meaning: '已婚男子·繁衍' },
  eraser:   { label: '橡皮', icon: 'eraser' },
};

/* ── 网格配置 ── */
const COLS = 25;
const ROWS = 33;
const TRI_H = 3; // 三角形半高（底边半宽）

/* ── 状态 ── */
let grid = new Uint8Array(COLS * ROWS);
let currentColor = 1;
let currentTool = 'pen';
let bgMode = 'white';
let isDrawing = false;
let lastCell = null;
let placedShapes = []; // {type, color, col, row}
let history = [];
const MAX_HISTORY = 30;

/* ── DOM ── */
const canvas = document.getElementById('beadCanvas');
const ctx = canvas.getContext('2d');
const canvasWrap = document.getElementById('canvasWrap');
const canvasHint = document.getElementById('canvasHint');
const paletteEl = document.getElementById('colorPalette');
const colorMeaningEl = document.getElementById('colorMeaning');
const toolPaletteEl = document.getElementById('toolPalette');
const readingText = document.getElementById('readingText');
const shapeTagsEl = document.getElementById('shapeTags');

let beadSize = 14;
let canvasW = 0, canvasH = 0;

/* ── 预渲染珠子精灵 ── */
const beadSprites = {};
function buildBeadSprites() {
  const size = 64;
  for (let ci = 1; ci < COLORS.length; ci++) {
    const c = COLORS[ci];
    const bc = document.createElement('canvas');
    bc.width = size; bc.height = size;
    const bx = bc.getContext('2d');
    const cx = size / 2, cy = size / 2, r = size / 2 - 2;
    // 主体径向渐变（高光偏左上）
    const g = bx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
    const dark = shadeColor(c.hex, -40);
    const light = shadeColor(c.hex, 50);
    g.addColorStop(0, light);
    g.addColorStop(0.4, c.hex);
    g.addColorStop(1, dark);
    bx.fillStyle = g;
    bx.beginPath();
    bx.arc(cx, cy, r, 0, Math.PI * 2);
    bx.fill();
    // 边缘暗圈
    bx.strokeStyle = dark;
    bx.lineWidth = 1.5;
    bx.stroke();
    // 高光点
    bx.fillStyle = 'rgba(255,255,255,0.5)';
    bx.beginPath();
    bx.arc(cx - r * 0.28, cy - r * 0.28, r * 0.18, 0, Math.PI * 2);
    bx.fill();
    beadSprites[ci] = bc;
  }
}

function shadeColor(hex, percent) {
  let r = parseInt(hex.slice(1, 3), 16);
  let g = parseInt(hex.slice(3, 5), 16);
  let b = parseInt(hex.slice(5, 7), 16);
  r = Math.max(0, Math.min(255, r + Math.round(255 * percent / 100)));
  g = Math.max(0, Math.min(255, g + Math.round(255 * percent / 100)));
  b = Math.max(0, Math.min(255, b + Math.round(255 * percent / 100)));
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

/* ── 画布尺寸 ── */
function resize() {
  const maxW = Math.min(canvasWrap.parentElement.clientWidth - 56, 480);
  const maxH = window.innerHeight - 280;
  const sizeByW = Math.floor(maxW / COLS);
  const sizeByH = Math.floor(maxH / ROWS);
  beadSize = Math.max(8, Math.min(sizeByW, sizeByH, 20));
  canvasW = beadSize * COLS;
  canvasH = beadSize * ROWS;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = canvasW * dpr;
  canvas.height = canvasH * dpr;
  canvas.style.width = canvasW + 'px';
  canvas.style.height = canvasH + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  render();
}

/* ── 渲染 ── */
function render() {
  // 底色
  if (bgMode === 'white') {
    ctx.fillStyle = '#F5F0E8';
    ctx.fillRect(0, 0, canvasW, canvasH);
  } else if (bgMode === 'black') {
    ctx.fillStyle = '#1C1C1E';
    ctx.fillRect(0, 0, canvasW, canvasH);
  } else {
    ctx.clearRect(0, 0, canvasW, canvasH);
    drawCheckerboard();
  }
  // 珠子
  const gap = Math.max(1, beadSize * 0.08);
  const drawR = (beadSize - gap) / 2;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const v = grid[r * COLS + c];
      if (!v) continue;
      const x = c * beadSize + beadSize / 2;
      const y = r * beadSize + beadSize / 2;
      const sprite = beadSprites[v];
      if (sprite) {
        ctx.drawImage(sprite, x - drawR, y - drawR, drawR * 2, drawR * 2);
      }
    }
  }
}

function drawCheckerboard() {
  const s = beadSize;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      ctx.fillStyle = (r + c) % 2 ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.01)';
      ctx.fillRect(c * s, r * s, s, s);
    }
  }
}

/* ── 坐标转换 ── */
function eventToCell(e) {
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX || (e.touches && e.touches[0].clientX)) - rect.left;
  const y = (e.clientY || (e.touches && e.touches[0].clientY)) - rect.top;
  const c = Math.floor(x / beadSize);
  const r = Math.floor(y / beadSize);
  if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return null;
  return { c, r };
}

/* ── 形状模板生成 ── */
function shapeCells(type, cc, rr) {
  const cells = [];
  const h = TRI_H;
  const add = (dr, dc) => {
    const r = rr + dr, c = cc + dc;
    if (r >= 0 && r < ROWS && c >= 0 && c < COLS) cells.push({ r, c });
  };
  if (type === 'triUp') {
    for (let dr = 0; dr <= h; dr++)
      for (let dc = -dr; dc <= dr; dc++) add(dr, dc);
  } else if (type === 'triDown') {
    for (let dr = 0; dr <= h; dr++)
      for (let dc = -(h - dr); dc <= (h - dr); dc++) add(dr, dc);
  } else if (type === 'diamond') {
    for (let dr = 0; dr <= h; dr++)
      for (let dc = -dr; dc <= dr; dc++) add(dr, dc);
    for (let dr = 1; dr <= h; dr++)
      for (let dc = -(h - dr); dc <= (h - dr); dc++) add(h + dr, dc);
  } else if (type === 'hourglass') {
    for (let dr = 0; dr <= h; dr++)
      for (let dc = -(h - dr); dc <= (h - dr); dc++) add(dr, dc);
    for (let dr = 1; dr <= h; dr++)
      for (let dc = -dr; dc <= dr; dc++) add(h + dr, dc);
  }
  return cells;
}

/* ── 绘画操作 ── */
function paintCell(c, r, val) {
  grid[r * COLS + c] = val;
}

function applyTool(cell) {
  if (!cell) return;
  if (currentTool === 'pen') {
    paintCell(cell.c, cell.r, currentColor);
  } else if (currentTool === 'eraser') {
    paintCell(cell.c, cell.r, 0);
  } else {
    const cells = shapeCells(currentTool, cell.c, cell.r);
    cells.forEach(p => paintCell(p.c, p.r, currentColor));
    placedShapes.push({ type: currentTool, color: currentColor, col: cell.c, row: cell.r });
  }
}

function pushHistory() {
  history.push({ grid: grid.slice(), shapes: placedShapes.slice() });
  if (history.length > MAX_HISTORY) history.shift();
}

function undo() {
  if (!history.length) return;
  const prev = history.pop();
  grid = prev.grid;
  placedShapes = prev.shapes;
  render();
  updateReading();
}

/* ── 指针事件 ── */
function onPointerDown(e) {
  e.preventDefault();
  canvas.setPointerCapture?.(e.pointerId);
  isDrawing = true;
  pushHistory();
  const cell = eventToCell(e);
  if (cell) {
    applyTool(cell);
    lastCell = cell;
    canvasHint.classList.add('hidden');
    render();
    updateReading();
  }
}

function onPointerMove(e) {
  if (!isDrawing) return;
  e.preventDefault();
  const cell = eventToCell(e);
  if (!cell) return;
  if (lastCell && cell.c === lastCell.c && cell.r === lastCell.r) return;
  // 笔/橡皮模式：连点成线；形状模式：只在起点盖一个
  if (currentTool === 'pen' || currentTool === 'eraser') {
    // 插值填充拖动经过的格子
    const line = bresenham(lastCell.c, lastCell.r, cell.c, cell.r);
    line.forEach(p => paintCell(p.c, p.r, currentTool === 'eraser' ? 0 : currentColor));
  }
  lastCell = cell;
  render();
  updateReading();
}

function onPointerUp(e) {
  isDrawing = false;
  lastCell = null;
}

function bresenham(x0, y0, x1, y1) {
  const pts = [];
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  while (true) {
    pts.push({ c: x0, r: y0 });
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 < dx) { err += dx; y0 += sy; }
  }
  return pts;
}

canvas.addEventListener('pointerdown', onPointerDown);
canvas.addEventListener('pointermove', onPointerMove);
canvas.addEventListener('pointerup', onPointerUp);
canvas.addEventListener('pointercancel', onPointerUp);
canvas.addEventListener('pointerleave', onPointerUp);

/* ── 构建颜色面板 ── */
function buildPalette() {
  for (let i = 1; i < COLORS.length; i++) {
    const c = COLORS[i];
    const btn = document.createElement('button');
    btn.className = 'color-swatch' + (i === currentColor ? ' active' : '');
    btn.style.background = c.hex;
    btn.title = c.name;
    btn.setAttribute('aria-label', c.name + ' ' + c.zulu);
    btn.dataset.color = i;
    btn.addEventListener('click', () => selectColor(i));
    paletteEl.appendChild(btn);
  }
  showColorMeaning(currentColor);
}

function selectColor(i) {
  currentColor = i;
  document.querySelectorAll('.color-swatch').forEach((el, idx) => {
    el.classList.toggle('active', idx + 1 === i);
  });
  showColorMeaning(i);
  // 选颜色时自动切回笔工具
  if (currentTool === 'eraser') selectTool('pen');
}

function showColorMeaning(i) {
  const c = COLORS[i];
  let html = `<span class="cm-name"><span class="clr-dot" style="background:${c.hex}"></span> ${c.name} <em>${c.zulu}</em></span>`;
  html += `<span class="cm-pos">正：${c.pos}</span>`;
  if (c.neg) html += `<br><span class="cm-neg">反：${c.neg}</span>`;
  colorMeaningEl.innerHTML = html;
}

/* ── 构建工具面板 ── */
function buildTools() {
  const order = ['pen', 'triUp', 'triDown', 'diamond', 'hourglass', 'eraser'];
  order.forEach(key => {
    const s = SHAPES[key];
    const btn = document.createElement('button');
    btn.className = 'tool-btn' + (key === currentTool ? ' active' : '') + (key === 'eraser' ? ' eraser-btn' : '');
    btn.dataset.tool = key;
    btn.setAttribute('aria-label', s.label + (s.meaning ? '：' + s.meaning : ''));
    btn.innerHTML = toolSVG(s.icon) + `<span>${s.label}</span>`;
    btn.addEventListener('click', () => selectTool(key));
    toolPaletteEl.appendChild(btn);
  });
}

function selectTool(key) {
  currentTool = key;
  document.querySelectorAll('.tool-btn').forEach(el => {
    el.classList.toggle('active', el.dataset.tool === key);
  });
  canvas.style.cursor = key === 'eraser' ? 'cell' : 'crosshair';
}

function toolSVG(icon) {
  const icons = {
    pen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>',
    triUp: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3L22 21H2z"/></svg>',
    triDown: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21L2 3h20z"/></svg>',
    diamond: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 2L22 12L12 22L2 12z"/></svg>',
    hourglass: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 2h16M4 22h16M7 2l5 8 5-8M7 22l5-8 5 8"/></svg>',
    eraser: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20H7L3 16a2 2 0 010-2.8l9.2-9.2a2 2 0 012.8 0l5.2 5.2a2 2 0 010 2.8L13 20"/></svg>',
  };
  return icons[icon] || '';
}

/* ── 底色切换 ── */
document.querySelectorAll('.bg-opt').forEach(btn => {
  btn.addEventListener('click', () => {
    bgMode = btn.dataset.bg;
    document.querySelectorAll('.bg-opt').forEach(b => b.classList.toggle('active', b === btn));
    render();
  });
});

/* ── 清空 / 撤销 ── */
document.getElementById('btnUndo').addEventListener('click', undo);
document.getElementById('btnClear').addEventListener('click', () => {
  if (!grid.some(v => v)) return;
  pushHistory();
  grid.fill(0);
  placedShapes = [];
  render();
  updateReading();
});

/* ── 实时密语解读 ── */
function updateReading() {
  const counts = new Array(COLORS.length).fill(0);
  let total = 0;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i]) { counts[grid[i]]++; total++; }
  }

  if (!total) {
    readingText.textContent = '选择左侧颜色开始编织，你的珠绣情书将在此被解读……';
    shapeTagsEl.innerHTML = '';
    return;
  }

  // 颜色占比排序
  const used = [];
  for (let i = 1; i < COLORS.length; i++) {
    if (counts[i] > 0) used.push({ ci: i, count: counts[i], pct: counts[i] / total });
  }
  used.sort((a, b) => b.count - a.count);

  const dot = (hex) => `<span class="clr-dot" style="background:${hex}"></span>`;
  let html = '';

  // 主色
  const main = used[0];
  const mc = COLORS[main.ci];
  html += `${dot(mc.hex)}<b>${mc.name}</b>为这封情书的主色（${Math.round(main.pct * 100)}%），${mc.pos}。`;

  // 辅色
  for (let i = 1; i < Math.min(used.length, 4); i++) {
    const u = used[i];
    const c = COLORS[u.ci];
    if (u.pct < 0.05) continue;
    html += `<br>${dot(c.hex)}<b>${c.name}</b>点缀其间——${c.pos}。`;
  }

  // 反义提醒（非白色的主色提一句负面可能）
  if (main.ci !== 1 && mc.neg && main.pct > 0.5) {
    html += `<br><span class="neg">但珠绣密语从来有正反两面——${mc.name}亦可解作${mc.neg}。心意如何，全凭读信人领会。</span>`;
  }

  readingText.innerHTML = html;

  // 图形标签
  shapeTagsEl.innerHTML = '';
  if (placedShapes.length) {
    const shapeCounts = {};
    placedShapes.forEach(s => {
      const key = s.type + '_' + s.color;
      if (!shapeCounts[key]) shapeCounts[key] = { type: s.type, color: s.color, count: 0 };
      shapeCounts[key].count++;
    });
    Object.values(shapeCounts).forEach(sc => {
      const tag = document.createElement('span');
      tag.className = 'shape-tag';
      tag.innerHTML = `${dot(COLORS[sc.color].hex)}${SHAPES[sc.type].label} · ${SHAPES[sc.type].meaning}`;
      shapeTagsEl.appendChild(tag);
    });
  }
}

/* ── 导出 PNG ── */
document.getElementById('btnExport').addEventListener('click', () => {
  if (!grid.some(v => v)) {
    alert('画布还是空的，先编织一些珠子吧。');
    return;
  }
  const scale = 3;
  const ex = document.createElement('canvas');
  ex.width = canvasW * scale;
  ex.height = canvasH * scale;
  const ectx = ex.getContext('2d');
  ectx.scale(scale, scale);

  // 底色
  if (bgMode === 'white') {
    ectx.fillStyle = '#F5F0E8';
    ectx.fillRect(0, 0, canvasW, canvasH);
  } else if (bgMode === 'black') {
    ectx.fillStyle = '#1C1C1E';
    ectx.fillRect(0, 0, canvasW, canvasH);
  }

  const gap = Math.max(1, beadSize * 0.08);
  const drawR = (beadSize - gap) / 2;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const v = grid[r * COLS + c];
      if (!v) continue;
      const x = c * beadSize + beadSize / 2;
      const y = r * beadSize + beadSize / 2;
      ectx.drawImage(beadSprites[v], x - drawR, y - drawR, drawR * 2, drawR * 2);
    }
  }

  const link = document.createElement('a');
  link.download = 'zulu-love-letter-' + Date.now() + '.png';
  link.href = ex.toDataURL('image/png');
  link.click();
});

/* ── 示例图案 ── */
document.getElementById('btnPreset').addEventListener('click', loadPreset);

function loadPreset() {
  pushHistory();
  grid.fill(0);
  placedShapes = [];

  // 白色底（手动铺白珠边框区域）
  // 中央红色菱形
  stampPreset('diamond', 12, 14, 3); // red
  // 蓝色倒三角（男子）在上方
  stampPreset('triDown', 12, 5, 4); // blue
  // 绿色正三角（女子）在下方
  stampPreset('triUp', 12, 24, 6); // green
  // 黄色沙漏在右侧
  stampPreset('hourglass', 19, 14, 5); // yellow
  // 粉色小正三角在左侧
  stampPreset('triUp', 5, 14, 7); // pink
  // 黑色边框装饰点
  for (let c = 2; c < COLS - 2; c += 2) {
    grid[1 * COLS + c] = 2;
    grid[(ROWS - 2) * COLS + c] = 2;
  }
  for (let r = 4; r < ROWS - 4; r += 2) {
    grid[r * COLS + 2] = 2;
    grid[r * COLS + (COLS - 3)] = 2;
  }

  render();
  updateReading();
  canvasHint.classList.add('hidden');
}

function stampPreset(type, cc, rr, colorIdx) {
  const cells = shapeCells(type, cc, rr);
  cells.forEach(p => grid[p.r * COLS + p.c] = colorIdx);
  placedShapes.push({ type, color: colorIdx, col: cc, row: rr });
}

/* ── 键盘快捷键 ── */
document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey) {
    if (e.key === 'z') { e.preventDefault(); undo(); }
    return;
  }
  // 数字键 1-7 选颜色
  const num = parseInt(e.key);
  if (num >= 1 && num <= 7) selectColor(num);
  // E 切橡皮
  if (e.key === 'e' || e.key === 'E') selectTool('eraser');
  if (e.key === 'b' || e.key === 'B') selectTool('pen');
});

/* ── 启动 ── */
buildBeadSprites();
buildPalette();
buildTools();
resize();
updateReading();
window.addEventListener('resize', resize);
