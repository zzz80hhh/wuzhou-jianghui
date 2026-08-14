/* ═══════════════════════════════════════════
   极地三界 · 奥隆霍战神 — 主脚本
   ═══════════════════════════════════════════ */

// ── 角色数据 ──
const CHARACTERS = {
  heroine: {
    name: '英雄女',
    realm: '中土 · Middle World',
    title: '中土守护者 · 极光剑姬',
    desc: '来自奥隆霍史诗中的中土英雄，身披冰晶铠甲，手持极光之剑，守护人间三界秩序。铠甲上的几何纹样源自雅库特传统图腾，每一道纹路都是先民与冰雪共生的印记。',
    weapon: '极光晶剑',
    element: '冰霜 · 极光',
    faction: '中土守护者',
    image: 'images/heroine.png'
  },
  horse: {
    name: '神圣天马',
    realm: '上界 · Upper World',
    title: '上界灵兽 · 极光之翼',
    desc: '上界神灵赐予英雄的神圣坐骑，银晶身躯折射北极光华，翼展如极光流淌于永夜。在雅库特文化中，马是连接天地的神圣生灵，是英雄灵魂的另一半。',
    weapon: '极光双翼',
    element: '极光 · 银晶',
    faction: '上界神灵',
    image: 'images/horse.png'
  },
  oluu: {
    name: '魔王 Oluu',
    realm: '下界 · Lower World',
    title: '下界之主 · 混沌雷锤',
    desc: '下界黑暗之主，黑曜石鳞甲下奔涌着混沌紫电，手持雷霆战锤，企图吞噬三界光明。铠甲上的螺旋纹样是其远古邪力的印记，乌鸦是其窥视人间的耳目。',
    weapon: '雷霆战锤',
    element: '紫电 · 混沌',
    faction: '下界魔族',
    image: 'images/oluu.png'
  }
};

// ── DOM 引用 ──
const tabs = document.querySelectorAll('.tab');
const charImage = document.getElementById('charImage');
const charRealm = document.getElementById('charRealm');
const charName = document.getElementById('charName');
const charTitle = document.getElementById('charTitle');
const charDesc = document.getElementById('charDesc');
const charWeapon = document.getElementById('charWeapon');
const charElement = document.getElementById('charElement');
const charFaction = document.getElementById('charFaction');
const loadingVeil = document.getElementById('loadingVeil');
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightboxImg');
const lightboxClose = document.getElementById('lightboxClose');
const imageWrap = document.querySelector('.char-image-wrap');

let currentChar = 'heroine';
const preloaded = {};

// ── 预加载图片 ──
function preloadImage(key) {
  if (preloaded[key]) return preloaded[key];
  const img = new Image();
  img.src = CHARACTERS[key].image;
  preloaded[key] = img;
  return img;
}
Object.keys(CHARACTERS).forEach(preloadImage);

// ── 切换角色 ──
function switchCharacter(key) {
  if (key === currentChar) return;
  const data = CHARACTERS[key];
  currentChar = key;

  // 更新标签状态
  tabs.forEach(t => {
    const active = t.dataset.char === key;
    t.classList.toggle('active', active);
    t.setAttribute('aria-selected', active);
  });

  // 图片淡出→切换→淡入
  charImage.classList.add('changing');
  loadingVeil.classList.add('show');

  setTimeout(() => {
    charImage.src = data.image;
    charImage.alt = data.name + '概念图';
    charRealm.textContent = data.realm;
    charName.textContent = data.name;
    charTitle.textContent = data.title;
    charDesc.textContent = data.desc;
    charWeapon.textContent = data.weapon;
    charElement.textContent = data.element;
    charFaction.textContent = data.faction;

    const onLoad = () => {
      charImage.classList.remove('changing');
      loadingVeil.classList.remove('show');
      charImage.removeEventListener('load', onLoad);
    };
    if (charImage.complete) onLoad();
    else charImage.addEventListener('load', onLoad);
  }, 250);
}

tabs.forEach(tab => {
  tab.addEventListener('click', () => switchCharacter(tab.dataset.char));
});

// ── Lightbox ──
function openLightbox() {
  lightboxImg.src = CHARACTERS[currentChar].image;
  lightboxImg.alt = CHARACTERS[currentChar].name + '概念图大图';
  lightbox.classList.add('open');
  lightbox.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}
function closeLightbox() {
  lightbox.classList.remove('open');
  lightbox.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}
imageWrap.addEventListener('click', openLightbox);
lightboxClose.addEventListener('click', closeLightbox);
lightbox.addEventListener('click', e => { if (e.target === lightbox) closeLightbox(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeLightbox();
  if (e.key === 'ArrowLeft') {
    const keys = Object.keys(CHARACTERS);
    const idx = keys.indexOf(currentChar);
    switchCharacter(keys[(idx - 1 + keys.length) % keys.length]);
  }
  if (e.key === 'ArrowRight') {
    const keys = Object.keys(CHARACTERS);
    const idx = keys.indexOf(currentChar);
    switchCharacter(keys[(idx + 1) % keys.length]);
  }
});

// ═══════════════════════════════════════════
// 冰霜粒子背景
// ═══════════════════════════════════════════
const canvas = document.getElementById('frostCanvas');
const ctx = canvas.getContext('2d');
let W, H, particles = [];
const isMobile = window.matchMedia('(max-width:640px)').matches;
const PARTICLE_COUNT = isMobile ? 50 : 120;

function resize() {
  W = canvas.width = window.innerWidth;
  H = canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

class FrostParticle {
  constructor() { this.reset(true); }
  reset(initial) {
    this.x = Math.random() * W;
    this.y = initial ? Math.random() * H : -10;
    this.r = Math.random() * 1.8 + 0.4;
    this.vy = Math.random() * 0.4 + 0.15;
    this.vx = (Math.random() - 0.5) * 0.3;
    this.opacity = Math.random() * 0.5 + 0.15;
    this.twinkle = Math.random() * Math.PI * 2;
    this.twinkleSpeed = Math.random() * 0.02 + 0.005;
    this.hue = Math.random() < 0.7 ? 200 : (Math.random() < 0.5 ? 190 : 260);
  }
  update() {
    this.y += this.vy;
    this.x += this.vx + Math.sin(this.twinkle) * 0.15;
    this.twinkle += this.twinkleSpeed;
    if (this.y > H + 10) this.reset(false);
  }
  draw() {
    const a = this.opacity * (0.6 + 0.4 * Math.sin(this.twinkle));
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
    ctx.fillStyle = `hsla(${this.hue},80%,75%,${a})`;
    ctx.fill();
    // 光晕
    if (this.r > 1.2) {
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r * 3, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${this.hue},80%,75%,${a * 0.08})`;
      ctx.fill();
    }
  }
}

for (let i = 0; i < PARTICLE_COUNT; i++) {
  particles.push(new FrostParticle());
}

let animId;
function animate() {
  ctx.clearRect(0, 0, W, H);
  for (const p of particles) { p.update(); p.draw(); }
  animId = requestAnimationFrame(animate);
}
animate();

// 页面不可见时暂停动画节省 CPU
document.addEventListener('visibilitychange', () => {
  if (document.hidden) cancelAnimationFrame(animId);
  else animate();
});
