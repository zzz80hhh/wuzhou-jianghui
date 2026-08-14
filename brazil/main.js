/* ═══════════════════════════════════════════
   自由之影 · 卡波耶拉 — 光影流体雕塑
   ═══════════════════════════════════════════ */
(function(){
  'use strict';

  var canvas = document.getElementById('flowCanvas');
  var ctx = canvas.getContext('2d');
  var isMobile = window.matchMedia('(max-width:768px)').matches;

  // ── 尺寸 ──
  var W, H, dpr;
  function resize(){
    dpr = Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  // ── 色彩模式 ──
  var COLORS = {
    fire:   {h1: 30,  h2: 55,  sat: 95, light: 60},
    forest: {h1: 120, h2: 170, sat: 70, light: 55},
    ocean:  {h1: 180, h2: 240, sat: 80, light: 60}
  };
  var colorMode = 'fire';

  function particleColor(age, maxAge){
    var c = COLORS[colorMode];
    var t = age / maxAge;
    var h = c.h1 + (c.h2 - c.h1) * t;
    var l = c.light * (0.3 + 0.7 * (1 - t));
    var a = 0.85 * (1 - t * 0.6);
    return 'hsla(' + h + ',' + c.sat + '%,' + l + '%,' + a + ')';
  }

  // ── 流场（多层正弦叠加）──
  var t = 0;
  function flowAngle(x, y){
    return (
      Math.sin(x * 0.0025 + t * 0.3) * Math.cos(y * 0.0025 + t * 0.2) * 2.2
      + Math.sin(x * 0.006 - t * 0.15) * 0.6
      + Math.cos(y * 0.005 + t * 0.18) * 0.6
      + Math.sin((x + y) * 0.0015 + t * 0.1) * 0.8
    );
  }

  // ── 粒子系统 ──
  var MAX_PARTICLES = isMobile ? 600 : 1400;
  var particles = [];

  function Particle(x, y, vx, vy){
    this.x = x;
    this.y = y;
    this.vx = vx || 0;
    this.vy = vy || 0;
    this.age = 0;
    this.maxAge = 60 + Math.random() * 120;
    this.size = 1 + Math.random() * 2;
  }

  function addParticle(x, y, vx, vy){
    if (particles.length >= MAX_PARTICLES) particles.shift();
    particles.push(new Particle(x, y, vx, vy));
  }

  // 初始化一些粒子
  function seedParticles(){
    for (var i = 0; i < (isMobile ? 200 : 500); i++){
      addParticle(Math.random() * W, Math.random() * H);
    }
  }
  seedParticles();

  // ── 鼠标/触摸交互 ──
  var mouse = {x: -1000, y: -1000, active: false, prevX: 0, prevY: 0};

  function getPos(e){
    if (e.touches && e.touches[0]){
      return {x: e.touches[0].clientX, y: e.touches[0].clientY};
    }
    return {x: e.clientX, y: e.clientY};
  }

  function onPointerDown(e){
    mouse.active = true;
    var p = getPos(e);
    mouse.x = mouse.prevX = p.x;
    mouse.y = mouse.prevY = p.y;
    for (var i = 0; i < 30; i++){
      addParticle(mouse.x, mouse.y, (Math.random()-0.5)*4, (Math.random()-0.5)*4);
    }
  }
  function onPointerMove(e){
    if (!mouse.active) return;
    var p = getPos(e);
    mouse.prevX = mouse.x;
    mouse.prevY = mouse.y;
    mouse.x = p.x;
    mouse.y = p.y;
    var dx = mouse.x - mouse.prevX;
    var dy = mouse.y - mouse.prevY;
    var speed = Math.sqrt(dx*dx + dy*dy);
    var count = Math.min(Math.floor(speed * 0.8) + 5, 40);
    for (var i = 0; i < count; i++){
      addParticle(
        mouse.x + (Math.random()-0.5)*10,
        mouse.y + (Math.random()-0.5)*10,
        dx * 0.3 + (Math.random()-0.5)*2,
        dy * 0.3 + (Math.random()-0.5)*2
      );
    }
  }
  function onPointerUp(){ mouse.active = false; }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);

  // ── 动画循环 ──
  function draw(){
    // 半透明覆盖产生拖尾
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(10,14,10,0.06)';
    ctx.fillRect(0, 0, W, H);

    // 加法混合绘制粒子
    ctx.globalCompositeOperation = 'lighter';

    for (var i = particles.length - 1; i >= 0; i--){
      var p = particles[i];
      p.age++;

      if (p.age > p.maxAge || p.x < -50 || p.x > W + 50 || p.y < -50 || p.y > H + 50){
        particles.splice(i, 1);
        continue;
      }

      // 流场力
      var angle = flowAngle(p.x, p.y);
      p.vx += Math.cos(angle) * 0.08;
      p.vy += Math.sin(angle) * 0.08;

      // 鼠标排斥力
      if (mouse.active){
        var dx = p.x - mouse.x;
        var dy = p.y - mouse.y;
        var dist2 = dx*dx + dy*dy;
        if (dist2 < 40000){
          var f = (1 - dist2 / 40000) * 1.5;
          p.vx += (dx / Math.sqrt(dist2 + 1)) * f;
          p.vy += (dy / Math.sqrt(dist2 + 1)) * f;
        }
      }

      // 阻尼
      p.vx *= 0.96;
      p.vy *= 0.96;

      // 限速
      var spd = Math.sqrt(p.vx*p.vx + p.vy*p.vy);
      if (spd > 6){ p.vx = p.vx/spd*6; p.vy = p.vy/spd*6; }

      p.x += p.vx;
      p.y += p.vy;

      // 绘制
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = particleColor(p.age, p.maxAge);
      ctx.fill();
    }

    // 持续补充环境粒子
    if (particles.length < (isMobile ? 300 : 700)){
      for (var j = 0; j < 3; j++){
        addParticle(Math.random() * W, Math.random() * H);
      }
    }

    t += 0.01;
    requestAnimationFrame(draw);
  }
  draw();

  // ── 色彩切换 ──
  var cmBtns = document.querySelectorAll('.cm-btn');
  cmBtns.forEach(function(btn){
    btn.addEventListener('click', function(){
      colorMode = btn.dataset.mode;
      cmBtns.forEach(function(b){
        b.classList.remove('active');
        b.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
    });
  });

  // ── 清空 ──
  document.getElementById('btnClear').addEventListener('click', function(){
    particles.length = 0;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#0a0e0a';
    ctx.fillRect(0, 0, W, H);
    seedParticles();
  });

  // ── 导出 PNG ──
  document.getElementById('btnExport').addEventListener('click', function(){
    var tmp = document.createElement('canvas');
    tmp.width = canvas.width;
    tmp.height = canvas.height;
    var tctx = tmp.getContext('2d');
    tctx.fillStyle = '#0a0e0a';
    tctx.fillRect(0, 0, tmp.width, tmp.height);
    tctx.drawImage(canvas, 0, 0);
    tmp.toBlob(function(blob){
      if (!blob) return;
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'capoeira-shadow.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }, 'image/png');
  });

  // ── 卡波耶拉动作预设（自动演示轨迹）──
  var presetAnim = null;
  function runPreset(type){
    if (presetAnim) cancelAnimationFrame(presetAnim);
    var startT = Date.now();
    var cx = W / 2, cy = H / 2;
    var R = Math.min(W, H) * 0.25;

    function animate(){
      var elapsed = (Date.now() - startT) / 1000;
      var px, py;

      if (type === 'ginga'){
        // Ginga：三角形摇摆轨迹
        var phase = elapsed * 1.8;
        var tri = ((phase % (Math.PI * 2)) / (Math.PI * 2)) * 3;
        var i = Math.floor(tri);
        var f = tri - i;
        var pts = [
          {x: cx, y: cy - R},
          {x: cx - R * 0.9, y: cy + R * 0.6},
          {x: cx + R * 0.9, y: cy + R * 0.6}
        ];
        var a = pts[i % 3], b = pts[(i+1) % 3];
        px = a.x + (b.x - a.x) * f;
        py = a.y + (b.y - a.y) * f;
      } else {
        // Au：手翻圆周轨迹
        var ang = -elapsed * 2.5;
        px = cx + Math.cos(ang) * R;
        py = cy + Math.sin(ang) * R * 0.7;
      }

      // 模拟鼠标事件
      mouse.active = true;
      mouse.prevX = mouse.x;
      mouse.prevY = mouse.y;
      mouse.x = px;
      mouse.y = py;

      var dx = mouse.x - mouse.prevX;
      var dy = mouse.y - mouse.prevY;
      for (var k = 0; k < 15; k++){
        addParticle(px + (Math.random()-0.5)*8, py + (Math.random()-0.5)*8,
          dx*0.2 + (Math.random()-0.5)*3, dy*0.2 + (Math.random()-0.5)*3);
      }

      if (elapsed < (type === 'ginga' ? 6 : 4)){
        presetAnim = requestAnimationFrame(animate);
      } else {
        mouse.active = false;
        document.querySelectorAll('.p-btn').forEach(function(b){ b.classList.remove('playing'); });
      }
    }

    document.querySelectorAll('.p-btn').forEach(function(b){ b.classList.remove('playing'); });
    var btnId = type === 'ginga' ? 'btnGinga' : 'btnAu';
    document.getElementById(btnId).classList.add('playing');
    animate();
  }

  document.getElementById('btnGinga').addEventListener('click', function(){ runPreset('ginga'); });
  document.getElementById('btnAu').addEventListener('click', function(){ runPreset('au'); });

  // ── 伯朗布琴（Berimbau）音效合成 ──
  var audioCtx = null, soundOn = false, berimbauNodes = null;

  function initAudio(){
    if (audioCtx) return;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch(e){ return; }
  }

  function startBerimbau(){
    initAudio();
    if (!audioCtx) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();
    stopBerimbau();

    var master = audioCtx.createGain();
    master.gain.value = 0.12;
    master.connect(audioCtx.destination);

    // 基础嗡鸣（铜弦声）
    var osc = audioCtx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 196; // G3

    var oscGain = audioCtx.createGain();
    oscGain.gain.value = 0.3;

    var filter = audioCtx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 800;
    filter.Q.value = 3;

    // 嗡嗡声（cabaça 共鸣）
    var osc2 = audioCtx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = 98; // G2

    var osc2Gain = audioCtx.createGain();
    osc2Gain.gain.value = 0.2;

    // 轻微颤音
    var lfo = audioCtx.createOscillator();
    lfo.frequency.value = 4.5;
    var lfoGain = audioCtx.createGain();
    lfoGain.gain.value = 3;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);

    osc.connect(filter);
    filter.connect(oscGain);
    oscGain.connect(master);
    osc2.connect(osc2Gain);
    osc2Gain.connect(master);

    osc.start();
    osc2.start();
    lfo.start();

    berimbauNodes = {osc: osc, osc2: osc2, lfo: lfo, master: master};
  }

  function stopBerimbau(){
    if (!berimbauNodes) return;
    try {
      var n = berimbauNodes;
      n.master.gain.setTargetAtTime(0, audioCtx.currentTime, 0.1);
      setTimeout(function(){
        try { n.osc.stop(); n.osc2.stop(); n.lfo.stop(); } catch(e){}
      }, 300);
    } catch(e){}
    berimbauNodes = null;
  }

  document.getElementById('btnSound').addEventListener('click', function(){
    var btn = this;
    soundOn = !soundOn;
    if (soundOn){
      startBerimbau();
      btn.classList.add('on');
      btn.textContent = '🔊 琴音';
    } else {
      stopBerimbau();
      btn.classList.remove('on');
      btn.textContent = '🔈 琴音';
    }
  });

  // 页面隐藏时暂停
  document.addEventListener('visibilitychange', function(){
    if (document.hidden && soundOn){
      stopBerimbau();
    } else if (!document.hidden && soundOn){
      startBerimbau();
    }
  });

})();
