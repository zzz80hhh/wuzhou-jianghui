'use strict';
/* ═══════════════════════════════════════════
   音频共振 · 宇宙几何  —  Vedic Resonance
   Web Audio API + Canvas 2D 实时曼陀罗声画

   改进要点：
   - 移动端降负载（fftSize 2048 / 30fps / DPR 1.25 / 更少粒子与星尘）
   - 帧节流 + 星云渐变缓存，降低 CPU/GPU 占用
   - drawRing 使用预分配 Float32Array，消除每帧对象分配
   - Blob URL 生命周期管理（revokeObjectURL + 卸载清理）
   - MediaRecorder / captureStream 特性检测与优雅降级
   - 画布状态 save/restore 防止 globalCompositeOperation 泄漏
   - 无障碍：aria-label、键盘导航、focus-visible 样式
   - ?audio= 同源校验，toast 反馈，长录制提醒
   ═══════════════════════════════════════════ */

/* ── DOM 引用 ── */
const canvas = document.getElementById('bg');
const ctx = canvas.getContext('2d');
const TWO_PI = Math.PI * 2;

/* ── 移动端检测（降低粒子数 / FFT / 帧率保证流畅）── */
const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
  || window.innerWidth < 768;

/* ── 录制能力检测 ── */
const canRecord = !!HTMLCanvasElement.prototype.captureStream && typeof MediaRecorder !== 'undefined';

/* ── 配置 ── */
const CFG = {
  fftSize: 4096,
  mobileFftSize: 2048,
  smoothing: 0.88,
  symmetry: 8,
  pointsPerSeg: 90,
  trailAlpha: 0.085,
  rotSpeed: 0.00025,
  maxParticles: isMobile ? 350 : 700,
  targetFPS: isMobile ? 30 : 60,
  dprCap: isMobile ? 1.25 : 2,
  starCount: isMobile ? 120 : 240,
  rings: [
    { baseR: 0.305, ampR: 0.085, f0: 2,   f1: 90,  color: '#FFD700', glow: '#FF8C00', lw: 1.4 },
    { baseR: 0.268, ampR: 0.065, f0: 25,  f1: 220, color: '#FF8C42', glow: '#C2410C', lw: 1.2 },
    { baseR: 0.238, ampR: 0.048, f0: 90,  f1: 420, color: '#7DD3FC', glow: '#1E40AF', lw: 1.0 },
  ],
};

/* ── 画布状态 ── */
let W = 0, H = 0, cx = 0, cy = 0, dpr = 1;

/* ── 音频状态 ── */
let audioCtx, analyser, audioEl;
let freqData, waveData, smoothed;
let bass = 0, mid = 0, treble = 0, level = 0;
let activeFftSize = isMobile ? CFG.mobileFftSize : CFG.fftSize;

/* ── 动画状态 ── */
let rotation = 0;
let particles = [];
let started = false;
let playing = false;
let firstFrame = true;
let frameCount = 0;
let lastFrameTS = 0;
const frameInterval = 1000 / CFG.targetFPS;

/* ── 指针交互（鼠标+触摸统一）── */
let pointerX = 0, pointerY = 0;
let pointerActive = false;
let pointerDown = false;

/* ── 资源管理 ── */
let lastObjectUrl = null;

/* ── 录制 ── */
let mediaRecorder = null, recChunks = [], recStart = 0, recTimer = null, recDest = null;
const recInd = document.getElementById('recIndicator');
const recTimeEl = document.getElementById('recTime');

/* ── 声环顶点缓存（按环索引复用 Float32Array，避免每帧分配）── */
const ringPtsCache = [];

/* ── 星云渐变缓存（位置缓慢漂移，每 3 帧重建一次渐变）── */
const nebulaCache = { g1: null, g2: null, g3: null };

/* ── 外圈波纹 ── */
const ripples = [];

/* ── 背景星尘 ── */
let bgStars = [];

/* ── 粒子调色板 ── */
const PALETTE = ['#FFD700', '#FF8C42', '#7DD3FC', '#FEF3C7', '#FFE082'];

/* ═══════════════════════════════════════════
   画布尺寸
   ═══════════════════════════════════════════ */
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, CFG.dprCap);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.floor(W * dpr);
  canvas.height = Math.floor(H * dpr);
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cx = W / 2;
  cy = H / 2;
  firstFrame = true;
}
window.addEventListener('resize', resize);

/* ═══════════════════════════════════════════
   音频初始化
   ═══════════════════════════════════════════ */
function initAudio() {
  if (audioCtx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  audioCtx = new AC();
  analyser = audioCtx.createAnalyser();
  activeFftSize = isMobile ? CFG.mobileFftSize : CFG.fftSize;
  analyser.fftSize = activeFftSize;
  analyser.smoothingTimeConstant = CFG.smoothing;
  freqData = new Uint8Array(analyser.frequencyBinCount);
  waveData = new Uint8Array(analyser.fftSize);
  smoothed = new Float32Array(analyser.frequencyBinCount);

  audioEl = new Audio();
  audioEl.crossOrigin = 'anonymous';
  const src = audioCtx.createMediaElementSource(audioEl);
  src.connect(analyser);
  analyser.connect(audioCtx.destination);

  audioEl.addEventListener('ended', () => {
    playing = false;
    document.getElementById('btnPlay').textContent = '▶';
  });
}

/* ═══════════════════════════════════════════
   加载音频文件（含 Blob URL 生命周期管理）
   ═══════════════════════════════════════════ */
async function loadFile(file) {
  initAudio();
  if (audioCtx.state === 'suspended') await audioCtx.resume();

  // 暂停旧音频并撤销上一个 Blob URL，防止内存泄漏
  audioEl.pause();
  if (lastObjectUrl) {
    try { URL.revokeObjectURL(lastObjectUrl); } catch (e) { /* noop */ }
    lastObjectUrl = null;
  }

  const objectUrl = URL.createObjectURL(file);
  lastObjectUrl = objectUrl;
  audioEl.src = objectUrl;

  try {
    await audioEl.play();
    playing = true;
    started = true;
    document.getElementById('intro').classList.add('hidden');
    document.getElementById('player').classList.remove('hidden');
    document.getElementById('btnPlay').textContent = '⏸';
    const autoHint = document.getElementById('autoHint');
    if (autoHint) autoHint.remove();
  } catch (e) {
    console.error(e);
    showToast('浏览器阻止了自动播放，请点击画面开始');
    showPlayPrompt();
  }

  // 重置 file input，使同一文件可再次被选择
  const fileInput = document.getElementById('fileInput');
  if (fileInput) fileInput.value = '';
}

/* ── 自动播放被阻止时的点击提示 ── */
function showPlayPrompt() {
  let overlay = document.getElementById('playPrompt');
  if (overlay) return;
  overlay = document.createElement('div');
  overlay.id = 'playPrompt';
  overlay.textContent = '点击任意位置开始';
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:40;display:flex;align-items:center;justify-content:center;' +
    'color:rgba(255,180,90,.85);font-size:1.1rem;letter-spacing:.3em;cursor:pointer;' +
    'background:rgba(5,5,16,.35);backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px)';
  const dismiss = async () => {
    try {
      if (audioCtx && audioCtx.state === 'suspended') await audioCtx.resume();
      if (audioEl) {
        await audioEl.play();
        playing = true;
        document.getElementById('btnPlay').textContent = '⏸';
      }
    } catch (e) { /* 用户仍可手动点播放 */ }
    overlay.remove();
  };
  overlay.addEventListener('click', dismiss);
  document.body.appendChild(overlay);
}

/* ═══════════════════════════════════════════
   频谱分析
   ═══════════════════════════════════════════ */
function analyze() {
  analyser.getByteFrequencyData(freqData);
  analyser.getByteTimeDomainData(waveData);

  let bSum = 0, mSum = 0, tSum = 0, aSum = 0;
  const binHz = audioCtx.sampleRate / analyser.fftSize;
  let bCount = 0, mCount = 0, tCount = 0;

  for (let i = 1; i < freqData.length; i++) {
    smoothed[i] += (freqData[i] - smoothed[i]) * 0.13;
    aSum += smoothed[i];
    const hz = i * binHz;
    if (hz < 260)       { bSum += smoothed[i]; bCount++; }
    else if (hz < 2200) { mSum += smoothed[i]; mCount++; }
    else if (hz < 9000) { tSum += smoothed[i]; tCount++; }
  }

  // 空间平滑（相邻频段平均，消除锯齿）；移动端减少遍数省 CPU
  const smoothPasses = isMobile ? 1 : 2;
  const smoothLimit = Math.min(smoothed.length - 1, 500);
  for (let pass = 0; pass < smoothPasses; pass++) {
    for (let i = 2; i < smoothLimit; i++) {
      smoothed[i] = smoothed[i - 1] * 0.22 + smoothed[i] * 0.56 + smoothed[i + 1] * 0.22;
    }
  }

  bass   = bCount ? bSum / bCount / 255 : 0;
  mid    = mCount ? mSum / mCount / 255 : 0;
  treble = tCount ? tSum / tCount / 255 : 0;
  level  = aSum / freqData.length / 255;
}

/* ── 空闲呼吸动画（无音频时）── */
function idle(t) {
  const breathe = Math.sin(t * 0.0008) * 0.5 + 0.5;
  const breathe2 = Math.sin(t * 0.0013 + 1.5) * 0.5 + 0.5;
  for (let i = 1; i < smoothed.length; i++) {
    const v = (
      Math.sin(i * 0.045 + t * 0.0015) * 0.25 +
      Math.sin(i * 0.12 + t * 0.003) * 0.15 +
      breathe * 0.35 + breathe2 * 0.15
    ) * 200;
    smoothed[i] += (Math.max(0, v) - smoothed[i]) * 0.04;
  }
  bass = breathe * 0.45;
  mid = 0.25 + breathe2 * 0.15;
  treble = 0.12 + Math.sin(t * 0.004) * 0.08;
  level = 0.25;
}

/* ═══════════════════════════════════════════
   声环绘制（预分配 Float32Array 复用顶点）
   ═══════════════════════════════════════════ */
/**
 * 确保指定环的顶点缓存足够大
 * @param {number} i - 环索引
 * @param {number} N - 顶点数
 * @returns {Float32Array} 交错 x,y 数组
 */
function ensureRingCache(i, N) {
  const needed = (N + 1) * 2;
  if (!ringPtsCache[i] || ringPtsCache[i].length < needed) {
    ringPtsCache[i] = new Float32Array(needed);
  }
  return ringPtsCache[i];
}

function drawRing(ring, ringIdx) {
  const S = CFG.symmetry;
  const P = CFG.pointsPerSeg;
  const N = P * S;
  const minD = Math.min(W, H);
  const baseR = ring.baseR * minD;
  const ampR = ring.ampR * minD;
  const pts = ensureRingCache(ringIdx, N);
  const waveLen = waveData ? waveData.length : 0;

  for (let i = 0; i <= N; i++) {
    const seg = (i / P) | 0;
    const pos = i % P;
    const angle = (i / N) * TWO_PI - Math.PI / 2 + rotation;
    // 奇段镜像 → 曼陀罗对称
    const bp = (seg % 2 === 0) ? pos : (P - pos);
    const binIdx = (ring.f0 + (bp / P) * (ring.f1 - ring.f0)) | 0;
    // 相邻频段平均，曲线更流畅
    const s0 = smoothed[binIdx > 0 ? binIdx - 1 : 0];
    const s1 = smoothed[binIdx];
    const s2 = smoothed[binIdx + 1 < smoothed.length ? binIdx + 1 : smoothed.length - 1];
    const amp = (s0 * 0.2 + s1 * 0.6 + s2 * 0.2) / 255;
    // 叠加时间域波形细节（轻微）
    const wIdx = ((i / N) * waveLen) | 0;
    const wAmp = waveLen ? (waveData[wIdx] - 128) / 128 * 0.005 * minD : 0;
    const r = baseR + amp * ampR + wAmp;
    const xi = i * 2;
    pts[xi]     = cx + Math.cos(angle) * r;
    pts[xi + 1] = cy + Math.sin(angle) * r;
  }

  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 1; i < N; i++) {
    const xi = i * 2;
    const xc = (pts[xi] + pts[xi + 2]) / 2;
    const yc = (pts[xi + 1] + pts[xi + 3]) / 2;
    ctx.quadraticCurveTo(pts[xi], pts[xi + 1], xc, yc);
  }
  ctx.closePath();

  // 模拟辉光（多层描边）
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = ring.glow;
  ctx.globalAlpha = 0.04; ctx.lineWidth = ring.lw * 8; ctx.stroke();
  ctx.globalAlpha = 0.10; ctx.lineWidth = ring.lw * 4; ctx.stroke();
  ctx.globalAlpha = 0.22; ctx.lineWidth = ring.lw * 2; ctx.stroke();
  ctx.globalAlpha = 0.95; ctx.lineWidth = ring.lw;
  ctx.strokeStyle = ring.color;
  ctx.stroke();
  ctx.restore();
}

/* ── 基圆（唱片边缘感）── */
function drawBaseCircle() {
  const minD = Math.min(W, H);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, CFG.rings[0].baseR * minD, 0, TWO_PI);
  ctx.strokeStyle = `rgba(255,180,90,${0.08 + bass * 0.12})`;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, CFG.rings[2].baseR * minD - 8, 0, TWO_PI);
  ctx.strokeStyle = 'rgba(125,211,252,0.06)';
  ctx.stroke();
  ctx.restore();
}

/* ── 内圈波形 ── */
function drawInnerWave() {
  if (!waveData) return;
  const minD = Math.min(W, H);
  const r = 0.185 * minD;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.beginPath();
  for (let i = 0; i <= waveData.length; i += 2) {
    const idx = i % waveData.length;
    const angle = (i / waveData.length) * TWO_PI - Math.PI / 2 + rotation * 0.6;
    const v = (waveData[idx] - 128) / 128;
    const rad = r + v * 18 * (0.5 + mid);
    const x = cx + Math.cos(angle) * rad;
    const y = cy + Math.sin(angle) * rad;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.strokeStyle = `rgba(255,220,160,${0.12 + treble * 0.15})`;
  ctx.lineWidth = 0.6;
  ctx.stroke();
  ctx.restore();
}

/* ── 中心辉光 + Bindu ── */
function drawCenter() {
  const minD = Math.min(W, H);
  const glowR = (0.12 + bass * 0.12) * minD;
  ctx.save();
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
  grad.addColorStop(0, `rgba(255,200,80,${0.06 + bass * 0.12})`);
  grad.addColorStop(0.4, `rgba(30,64,175,${0.03 + mid * 0.06})`);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, glowR, 0, TWO_PI);
  ctx.fill();

  // Bindu 点
  const bs = 1.8 + bass * 3.5;
  ctx.beginPath();
  ctx.arc(cx, cy, bs, 0, TWO_PI);
  ctx.fillStyle = `rgba(255,230,180,${0.5 + bass * 0.4})`;
  ctx.shadowBlur = 18;
  ctx.shadowColor = '#FFB347';
  ctx.fill();
  ctx.restore();
}

/* ═══════════════════════════════════════════
   粒子
   ═══════════════════════════════════════════ */
function spawnParticles() {
  const count = Math.floor(treble * 6 + bass * 2 + mid * 2);
  const minD = Math.min(W, H);
  const ring = CFG.rings[0];
  for (let i = 0; i < count; i++) {
    if (particles.length >= CFG.maxParticles) break;
    const angle = Math.random() * TWO_PI + rotation;
    // 用对称段的振幅决定出生半径
    const rel = ((((angle - rotation) / TWO_PI) % 1) + 1) % 1;
    const seg = (rel * CFG.symmetry) | 0;
    const segPos = (rel * CFG.symmetry - seg) * CFG.pointsPerSeg;
    const bp = (seg % 2 === 0) ? segPos : (CFG.pointsPerSeg - segPos);
    const binIdx = (ring.f0 + (bp / CFG.pointsPerSeg) * (ring.f1 - ring.f0)) | 0;
    const amp = smoothed[binIdx] / 255;
    const baseR = ring.baseR * minD + amp * ring.ampR * minD;
    const x = cx + Math.cos(angle) * baseR;
    const y = cy + Math.sin(angle) * baseR;
    const spd = 0.4 + Math.random() * 1.8 + treble * 2.5 + bass * 1.2;
    const tangential = (Math.random() - 0.5) * 0.8;
    particles.push({
      x, y,
      vx: Math.cos(angle) * spd + Math.cos(angle + Math.PI / 2) * tangential,
      vy: Math.sin(angle) * spd + Math.sin(angle + Math.PI / 2) * tangential,
      life: 1,
      decay: 0.004 + Math.random() * 0.012,
      size: 0.8 + Math.random() * 2.2 + treble * 1.5,
      color: PALETTE[(Math.random() * PALETTE.length) | 0]
    });
  }
}

function updateParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    // 指针引力（鼠标/触摸吸引粒子）
    if (pointerActive) {
      const dx = pointerX - p.x;
      const dy = pointerY - p.y;
      const dist = Math.sqrt(dx * dx + dy * dy) + 0.1;
      const force = pointerDown ? 0.08 : 0.025;
      p.vx += (dx / dist) * force;
      p.vy += (dy / dist) * force;
    }
    p.x += p.vx;
    p.y += p.vy;
    p.vx *= 0.985;
    p.vy *= 0.985;
    p.life -= p.decay;
    if (p.life <= 0) particles.splice(i, 1);
  }
}

/* ── 指针点击爆发 ── */
function pointerBurst(x, y) {
  const count = pointerDown ? 40 : 20;
  for (let i = 0; i < count; i++) {
    if (particles.length >= CFG.maxParticles) break;
    const a = Math.random() * TWO_PI;
    const spd = 1 + Math.random() * 4;
    particles.push({
      x, y,
      vx: Math.cos(a) * spd,
      vy: Math.sin(a) * spd,
      life: 1,
      decay: 0.008 + Math.random() * 0.015,
      size: 1 + Math.random() * 2.5,
      color: PALETTE[(Math.random() * PALETTE.length) | 0]
    });
  }
  ripples.push({ r: 0.05, alpha: 0.15, speed: 0.2 });
}

function drawParticles() {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    ctx.globalAlpha = p.life * 0.7;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * p.life, 0, TWO_PI);
    ctx.fillStyle = p.color;
    ctx.fill();
  }
  ctx.restore();
}

/* ── 外圈虚线（神圣几何感）── */
function drawOuterGrid() {
  const minD = Math.min(W, H);
  const r = 0.38 * minD;
  const S = CFG.symmetry * 2;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = 'rgba(255,180,90,0.06)';
  ctx.lineWidth = 0.5;
  ctx.setLineDash([2, 6]);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TWO_PI);
  ctx.stroke();
  ctx.setLineDash([]);
  for (let i = 0; i < S; i++) {
    const a = (i / S) * TWO_PI - Math.PI / 2 + rotation * 0.3;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * (0.34 * minD), cy + Math.sin(a) * (0.34 * minD));
    ctx.lineTo(cx + Math.cos(a) * (0.37 * minD), cy + Math.sin(a) * (0.37 * minD));
    ctx.stroke();
  }
  ctx.restore();
}

/* ═══════════════════════════════════════════
   背景星尘
   ═══════════════════════════════════════════ */
function initBgStars() {
  bgStars = [];
  for (let i = 0; i < CFG.starCount; i++) {
    bgStars.push({
      x: Math.random(), y: Math.random(),
      r: 0.25 + Math.random() * 1.1,
      phase: Math.random() * TWO_PI,
      speed: 0.0004 + Math.random() * 0.0014,
      drift: (Math.random() - 0.5) * 0.000025
    });
  }
}

function drawBgStars(t) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < bgStars.length; i++) {
    const s = bgStars[i];
    s.x += s.drift;
    if (s.x < 0) s.x = 1; if (s.x > 1) s.x = 0;
    const tw = Math.sin(t * s.speed + s.phase) * 0.4 + 0.6;
    ctx.beginPath();
    ctx.arc(s.x * W, s.y * H, s.r, 0, TWO_PI);
    ctx.fillStyle = `rgba(255,232,190,${0.25 * tw + treble * 0.12})`;
    ctx.fill();
  }
  ctx.restore();
}

/* ═══════════════════════════════════════════
   星云光晕（渐变缓存，每 3 帧重建一次）
   ═══════════════════════════════════════════ */
function drawNebula(t) {
  const minD = Math.min(W, H);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  if (frameCount % 3 === 0 || !nebulaCache.g1) {
    // 藏红金星云（左下，祭祀火色调）
    const nx1 = cx + Math.sin(t * 0.00009) * 0.16 * W;
    const ny1 = cy + Math.cos(t * 0.00011) * 0.13 * H;
    const r1 = (0.45 + bass * 0.14) * minD;
    const g1 = ctx.createRadialGradient(nx1, ny1, 0, nx1, ny1, r1);
    g1.addColorStop(0, `rgba(255,140,66,${0.05 + bass * 0.035})`);
    g1.addColorStop(0.5, `rgba(210,90,30,${0.025 + bass * 0.015})`);
    g1.addColorStop(1, 'rgba(0,0,0,0)');

    // 深靛蓝星云（右上，吠陀夜空）
    const nx2 = cx + Math.cos(t * 0.000075) * 0.18 * W;
    const ny2 = cy + Math.sin(t * 0.000095) * 0.15 * H;
    const r2 = (0.48 + mid * 0.12) * minD;
    const g2 = ctx.createRadialGradient(nx2, ny2, 0, nx2, ny2, r2);
    g2.addColorStop(0, `rgba(30,64,175,${0.045 + mid * 0.03})`);
    g2.addColorStop(1, 'rgba(0,0,0,0)');

    // 暖金星云（右下，梵天光环）
    const nx3 = cx + Math.sin(t * 0.00011 + 2) * 0.15 * W;
    const ny3 = cy + Math.cos(t * 0.000085 + 1) * 0.14 * H;
    const r3 = (0.42 + treble * 0.14) * minD;
    const g3 = ctx.createRadialGradient(nx3, ny3, 0, nx3, ny3, r3);
    g3.addColorStop(0, `rgba(255,215,0,${0.035 + treble * 0.02})`);
    g3.addColorStop(1, 'rgba(0,0,0,0)');

    nebulaCache.g1 = g1;
    nebulaCache.g2 = g2;
    nebulaCache.g3 = g3;
  }

  ctx.fillStyle = nebulaCache.g1; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = nebulaCache.g2; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = nebulaCache.g3; ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

/* ═══════════════════════════════════════════
   神圣几何：双层莲花瓣
   ═══════════════════════════════════════════ */
function drawSacredGeometry() {
  const minD = Math.min(W, H);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const rot = rotation * 0.15;

  // 外层 16 瓣莲花（金色，顺时针旋转 = 阳/湿婆能量）
  const P1 = 16, R1 = 0.42 * minD, tip1 = 0.58 * minD;
  ctx.strokeStyle = `rgba(255,215,0,${0.1 + level * 0.04})`;
  ctx.fillStyle = `rgba(255,180,50,${0.015 + level * 0.008})`;
  ctx.lineWidth = 0.8;
  for (let i = 0; i < P1; i++) {
    const a0 = (i / P1) * TWO_PI + rot;
    const am = ((i + 0.5) / P1) * TWO_PI + rot;
    const a1 = ((i + 1) / P1) * TWO_PI + rot;
    const x0 = cx + Math.cos(a0) * R1, y0 = cy + Math.sin(a0) * R1;
    const x1 = cx + Math.cos(a1) * R1, y1 = cy + Math.sin(a1) * R1;
    const xt = cx + Math.cos(am) * tip1, yt = cy + Math.sin(am) * tip1;
    const c1x = cx + Math.cos(a0 + (am - a0) * 0.35) * (R1 + (tip1 - R1) * 0.6);
    const c1y = cy + Math.sin(a0 + (am - a0) * 0.35) * (R1 + (tip1 - R1) * 0.6);
    const c2x = cx + Math.cos(a1 - (a1 - am) * 0.35) * (R1 + (tip1 - R1) * 0.6);
    const c2y = cy + Math.sin(a1 - (a1 - am) * 0.35) * (R1 + (tip1 - R1) * 0.6);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(c1x, c1y, xt, yt);
    ctx.quadraticCurveTo(c2x, c2y, x1, y1);
    ctx.fill();
    ctx.stroke();
  }

  // 内层 12 瓣莲花（藏红/琥珀，逆时针旋转 = 阴/夏克提能量）
  const P2 = 12, R2 = 0.35 * minD, tip2 = 0.47 * minD;
  ctx.strokeStyle = `rgba(255,140,66,${0.08 + mid * 0.035})`;
  ctx.fillStyle = `rgba(230,100,40,${0.012 + mid * 0.006})`;
  const rot2 = -rot * 1.3;
  for (let i = 0; i < P2; i++) {
    const a0 = (i / P2) * TWO_PI + rot2;
    const am = ((i + 0.5) / P2) * TWO_PI + rot2;
    const a1 = ((i + 1) / P2) * TWO_PI + rot2;
    const x0 = cx + Math.cos(a0) * R2, y0 = cy + Math.sin(a0) * R2;
    const x1 = cx + Math.cos(a1) * R2, y1 = cy + Math.sin(a1) * R2;
    const xt = cx + Math.cos(am) * tip2, yt = cy + Math.sin(am) * tip2;
    const c1x = cx + Math.cos(a0 + (am - a0) * 0.35) * (R2 + (tip2 - R2) * 0.6);
    const c1y = cy + Math.sin(a0 + (am - a0) * 0.35) * (R2 + (tip2 - R2) * 0.6);
    const c2x = cx + Math.cos(a1 - (a1 - am) * 0.35) * (R2 + (tip2 - R2) * 0.6);
    const c2y = cy + Math.sin(a1 - (a1 - am) * 0.35) * (R2 + (tip2 - R2) * 0.6);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(c1x, c1y, xt, yt);
    ctx.quadraticCurveTo(c2x, c2y, x1, y1);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/* ── Sri Yantra 三角形交织（吠陀最神圣几何）── */
function drawSriYantra() {
  const minD = Math.min(W, H);
  const R = 0.30 * minD;
  const rot = rotation * 0.08;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineWidth = 0.5;

  // 4 个向上三角形（湿婆），大小递减
  ctx.strokeStyle = `rgba(255,180,90,${0.06 + bass * 0.03})`;
  for (let k = 0; k < 4; k++) {
    const s = R * (1 - k * 0.18);
    const yOff = -R * 0.05 * k;
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.8 + yOff);
    ctx.lineTo(-s * 0.7, s * 0.5 + yOff);
    ctx.lineTo(s * 0.7, s * 0.5 + yOff);
    ctx.closePath();
    ctx.stroke();
  }

  // 5 个向下三角形（夏克提），大小递减
  ctx.strokeStyle = `rgba(125,211,252,${0.05 + mid * 0.025})`;
  for (let k = 0; k < 5; k++) {
    const s = R * (0.92 - k * 0.15);
    const yOff = R * 0.04 * k;
    ctx.beginPath();
    ctx.moveTo(0, s * 0.8 + yOff);
    ctx.lineTo(-s * 0.7, -s * 0.5 + yOff);
    ctx.lineTo(s * 0.7, -s * 0.5 + yOff);
    ctx.closePath();
    ctx.stroke();
  }

  // 外圈圆（Bhupura）
  ctx.strokeStyle = `rgba(255,200,130,${0.05 + level * 0.025})`;
  ctx.beginPath();
  ctx.arc(0, 0, R * 1.05, 0, TWO_PI);
  ctx.stroke();
  ctx.restore();
}

/* ── 神庙放射光（极淡，从中心向外）── */
function drawTempleRays(t) {
  const minD = Math.min(W, H);
  const rays = 24;
  const rot = rotation * 0.05 + t * 0.00003;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * TWO_PI;
    const len = (0.5 + Math.sin(t * 0.001 + i) * 0.15 + bass * 0.2) * minD;
    const grad = ctx.createLinearGradient(0, 0, Math.cos(a) * len, Math.sin(a) * len);
    grad.addColorStop(0, `rgba(255,200,120,${0.035 + bass * 0.02})`);
    grad.addColorStop(1, 'rgba(255,200,120,0)');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len);
    ctx.stroke();
  }
  ctx.restore();
}

/* ═══════════════════════════════════════════
   能量波纹（中心扩散圆环）
   ═══════════════════════════════════════════ */
function spawnRipple() {
  if (ripples.length < 3 && Math.random() < 0.006 + bass * 0.025) {
    ripples.push({ r: 0.08, alpha: 0.1 + bass * 0.07, speed: 0.12 + bass * 0.09 });
  }
}

function updateRipples() {
  for (let i = ripples.length - 1; i >= 0; i--) {
    ripples[i].r += ripples[i].speed;
    ripples[i].alpha *= 0.982;
    if (ripples[i].alpha < 0.004 || ripples[i].r > 1.3) ripples.splice(i, 1);
  }
}

function drawRipples() {
  const minD = Math.min(W, H);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const rp of ripples) {
    ctx.beginPath();
    ctx.arc(cx, cy, rp.r * minD, 0, TWO_PI);
    ctx.strokeStyle = `rgba(255,210,150,${rp.alpha})`;
    ctx.lineWidth = 0.7;
    ctx.stroke();
  }
  ctx.restore();
}

/* ── 暗角（聚焦中心）── */
function drawVignette() {
  const g = ctx.createRadialGradient(cx, cy, Math.min(W, H) * 0.25, cx, cy, Math.max(W, H) * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

/* ═══════════════════════════════════════════
   Toast 轻提示
   ═══════════════════════════════════════════ */
function showToast(msg, duration) {
  duration = duration || 2500;
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = '1';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.style.opacity = '0'; }, duration);
}

/* ═══════════════════════════════════════════
   主渲染（帧节流）
   ═══════════════════════════════════════════ */
function render(t) {
  requestAnimationFrame(render);

  // 帧率节流：移动端 30fps，桌面 60fps
  if (t - lastFrameTS < frameInterval) return;
  lastFrameTS = t;
  frameCount++;

  // 拖尾
  ctx.fillStyle = firstFrame ? '#050510' : `rgba(5,5,16,${CFG.trailAlpha})`;
  ctx.fillRect(0, 0, W, H);
  firstFrame = false;

  rotation += CFG.rotSpeed * (1 + level * 2);

  if (started && playing && audioEl && !audioEl.paused) {
    analyze();
    spawnParticles();
  } else {
    idle(t);
    if (Math.random() < 0.3) spawnParticles();
  }

  updateParticles();

  // 背景层（从远到近）
  drawNebula(t);
  drawBgStars(t);
  drawTempleRays(t);
  drawSriYantra();
  drawSacredGeometry();
  spawnRipple();
  updateRipples();
  drawRipples();
  drawOuterGrid();
  drawBaseCircle();
  drawCenter();

  // 从外到内画环
  for (let i = CFG.rings.length - 1; i >= 0; i--) {
    drawRing(CFG.rings[i], i);
  }

  drawInnerWave();
  drawParticles();
  drawVignette();

  // UI 更新
  if (started && audioEl) {
    const cur = fmtTime(audioEl.currentTime);
    const dur = fmtTime(audioEl.duration || 0);
    document.getElementById('timeDisplay').textContent = cur + ' / ' + dur;
    const pct = audioEl.duration ? (audioEl.currentTime / audioEl.duration) * 100 : 0;
    document.getElementById('progress').style.width = pct + '%';
  }
}

function fmtTime(s) {
  if (!isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return m + ':' + (sec < 10 ? '0' : '') + sec;
}

/* ═══════════════════════════════════════════
   录制（特性检测 + 资源清理）
   ═══════════════════════════════════════════ */
async function toggleRecord() {
  if (!canRecord) {
    showToast('当前浏览器不支持录制（需桌面 Chrome / Edge）');
    return;
  }
  if (!audioCtx || !started) return;

  if (!mediaRecorder) {
    try {
      const canvasStream = canvas.captureStream(CFG.targetFPS);
      recDest = audioCtx.createMediaStreamDestination();
      analyser.connect(recDest);
      const combined = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...recDest.stream.getAudioTracks()
      ]);
      const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9' : 'video/webm';
      mediaRecorder = new MediaRecorder(combined, { mimeType: mime, videoBitsPerSecond: 8000000 });
      mediaRecorder.ondataavailable = e => { if (e.data.size) recChunks.push(e.data); };
      mediaRecorder.onstop = () => {
        const blob = new Blob(recChunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'vedic-resonance-' + Date.now() + '.webm';
        document.body.appendChild(a);
        a.click();
        a.remove();
        // 延迟撤销，确保下载已触发
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        // 断开录制音频目标，释放资源
        if (recDest) {
          try { recDest.disconnect(); } catch (e) { /* noop */ }
          recDest = null;
        }
        recChunks = [];
      };
    } catch (e) {
      console.error(e);
      showToast('录制启动失败：' + e.message);
      return;
    }
  }

  const btn = document.getElementById('btnRecord');
  if (mediaRecorder.state === 'inactive') {
    recChunks = [];
    mediaRecorder.start();
    recStart = Date.now();
    recInd.classList.remove('hidden');
    btn.classList.add('active');
    showToast('录制中… 再次点击停止并下载', 2000);
    let sizeWarned = false;
    recTimer = setInterval(() => {
      const s = Math.floor((Date.now() - recStart) / 1000);
      recTimeEl.textContent = fmtTime(s);
      if (!sizeWarned && s >= 120) {
        sizeWarned = true;
        showToast('录制时间较长，文件可能较大', 2500);
      }
    }, 500);
  } else {
    mediaRecorder.stop();
    btn.classList.remove('active');
    recInd.classList.add('hidden');
    clearInterval(recTimer);
  }
}

/* ═══════════════════════════════════════════
   UI 事件
   ═══════════════════════════════════════════ */
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');

dropzone.addEventListener('click', () => fileInput.click());
// 键盘可访问：Enter / Space 触发文件选择
dropzone.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
});

fileInput.addEventListener('change', e => {
  if (e.target.files[0]) loadFile(e.target.files[0]);
});

['dragover', 'dragenter'].forEach(ev =>
  dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.add('drag'); })
);
['dragleave', 'drop'].forEach(ev =>
  dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.remove('drag'); })
);
dropzone.addEventListener('drop', e => {
  if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
});

// 播放/暂停
document.getElementById('btnPlay').addEventListener('click', async () => {
  if (!audioEl) return;
  if (audioCtx.state === 'suspended') await audioCtx.resume();
  if (playing) {
    audioEl.pause();
    playing = false;
    document.getElementById('btnPlay').textContent = '▶';
  } else {
    try {
      await audioEl.play();
      playing = true;
      document.getElementById('btnPlay').textContent = '⏸';
    } catch (e) {
      showPlayPrompt();
    }
  }
});

// 新文件
document.getElementById('btnNew').addEventListener('click', () => fileInput.click());

// 对称切换
const SYMS = [4, 6, 8, 12, 16, 24];
let symIdx = 2;
document.getElementById('btnSym').addEventListener('click', () => {
  symIdx = (symIdx + 1) % SYMS.length;
  CFG.symmetry = SYMS[symIdx];
  document.getElementById('btnSym').textContent = '☸ 对称 ' + CFG.symmetry;
});

// 录制
document.getElementById('btnRecord').addEventListener('click', toggleRecord);

// 进度条跳转
document.querySelector('.progress-wrap').addEventListener('click', e => {
  if (!audioEl || !audioEl.duration) return;
  const rect = e.currentTarget.getBoundingClientRect();
  audioEl.currentTime = ((e.clientX - rect.left) / rect.width) * audioEl.duration;
});

// 键盘快捷键：空格 / Enter 播放暂停
document.addEventListener('keydown', e => {
  if ((e.code === 'Space' || e.code === 'Enter') && started) {
    // 避免在按钮聚焦时重复触发
    if (document.activeElement && document.activeElement.tagName === 'BUTTON') return;
    e.preventDefault();
    document.getElementById('btnPlay').click();
  }
});

// 控件自动隐藏 + 指针交互
let hideTimer;
function showControls() {
  const pl = document.getElementById('player');
  pl.style.opacity = '1';
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if (playing) pl.style.opacity = '0.15';
  }, 3500);
}

// 统一指针事件（鼠标+触摸）
canvas.addEventListener('pointermove', e => {
  const rect = canvas.getBoundingClientRect();
  const nx = e.clientX - rect.left;
  const ny = e.clientY - rect.top;
  pointerX = nx;
  pointerY = ny;
  pointerActive = true;
  showControls();
});
canvas.addEventListener('pointerdown', e => {
  const rect = canvas.getBoundingClientRect();
  pointerX = e.clientX - rect.left;
  pointerY = e.clientY - rect.top;
  pointerDown = true;
  pointerActive = true;
  pointerBurst(pointerX, pointerY);
  showControls();
});
canvas.addEventListener('pointerup', () => { pointerDown = false; });
canvas.addEventListener('pointercancel', () => { pointerDown = false; pointerActive = false; });
canvas.addEventListener('pointerleave', () => { pointerActive = false; pointerDown = false; });

// 触摸时阻止默认滚动
canvas.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
canvas.addEventListener('touchstart', e => e.preventDefault(), { passive: false });

/* ═══════════════════════════════════════════
   自动加载（测试用 ?audio=filename.mp3）
   仅允许同源 URL，防止跨域加载风险
   ═══════════════════════════════════════════ */
const urlParams = new URLSearchParams(window.location.search);
const autoAudio = urlParams.get('audio');
if (autoAudio) {
  // 同源校验
  let allowedUrl = null;
  try {
    const u = new URL(autoAudio, window.location.href);
    if (u.origin === window.location.origin) {
      allowedUrl = u.toString();
    } else {
      console.warn('[Vedic Resonance] 已阻止跨域音频自动加载:', autoAudio);
    }
  } catch (e) {
    console.warn('[Vedic Resonance] 无效的 audio 参数:', autoAudio);
  }

  if (allowedUrl) {
    let autoLoaded = false;
    const tryAutoLoad = async () => {
      if (autoLoaded) return;
      autoLoaded = true;
      try {
        const r = await fetch(allowedUrl);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const blob = await r.blob();
        const fn = decodeURIComponent(allowedUrl.split('/').pop().split('?')[0]);
        await loadFile(new File([blob], fn, { type: blob.type || 'audio/mpeg' }));
      } catch (e) { console.warn('Auto-load failed:', e); }
    };
    // 等用户首次交互后再加载（浏览器自动播放策略）
    window.addEventListener('pointerdown', tryAutoLoad, { once: true });
    window.addEventListener('keydown', tryAutoLoad, { once: true });

    const hint = document.createElement('div');
    hint.id = 'autoHint';
    hint.textContent = '点击任意位置开始';
    hint.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);z-index:30;' +
      'color:rgba(255,180,90,.7);font-size:.85rem;letter-spacing:.2em;' +
      'animation:pulse 2s infinite;pointer-events:none';
    document.body.appendChild(hint);
  }
}

/* ═══════════════════════════════════════════
   录制按钮可用性初始化
   ═══════════════════════════════════════════ */
(function initRecordButton() {
  const btnRec = document.getElementById('btnRecord');
  if (!canRecord) {
    btnRec.disabled = true;
    btnRec.title = '当前浏览器不支持录制（需桌面 Chrome / Edge）';
    btnRec.setAttribute('aria-disabled', 'true');
  }
})();

/* ═══════════════════════════════════════════
   卸载清理：释放 Blob URL / 音频 / AudioContext
   ═══════════════════════════════════════════ */
window.addEventListener('beforeunload', () => {
  if (lastObjectUrl) {
    try { URL.revokeObjectURL(lastObjectUrl); } catch (e) { /* noop */ }
  }
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    try { mediaRecorder.stop(); } catch (e) { /* noop */ }
  }
  if (audioEl) {
    try { audioEl.pause(); audioEl.src = ''; } catch (e) { /* noop */ }
  }
  if (audioCtx && audioCtx.close) {
    try { audioCtx.close(); } catch (e) { /* noop */ }
  }
});

/* ═══════════════════════════════════════════
   启动
   ═══════════════════════════════════════════ */
resize();
initBgStars();
// 预分配空闲动画所需的平滑数组（initAudio 之前）
smoothed = new Float32Array(activeFftSize / 2);
waveData = new Uint8Array(activeFftSize);
requestAnimationFrame(render);
