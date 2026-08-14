/* ═══════════════════════════════════════════
   五洲匠汇 — 共享导航注入
   ═══════════════════════════════════════════ */
(function(){
  'use strict';

  // 从脚本路径推断根目录
  var scriptSrc = document.currentScript ? document.currentScript.src : '';
  var root = '';
  if (scriptSrc.indexOf('/assets/nav.js') !== -1){
    root = scriptSrc.substring(0, scriptSrc.indexOf('/assets/nav.js'));
    // 转为相对路径：取最后一段
    var parts = root.split('/');
    root = parts.length > 3 ? '../' : './';
  }

  // 检测当前页面
  var path = window.location.pathname;
  var current = 'home';
  if (path.indexOf('/india/') !== -1) current = 'india';
  else if (path.indexOf('/zulu/') !== -1) current = 'zulu';
  else if (path.indexOf('/russia/') !== -1) current = 'russia';
  else if (path.indexOf('/brazil/') !== -1) current = 'brazil';
  else if (path.indexOf('/about/') !== -1) current = 'about';

  var links = [
    {id:'india',  label:'印度', href:root+'india/'},
    {id:'zulu',   label:'南非', href:root+'zulu/'},
    {id:'russia', label:'俄罗斯', href:root+'russia/'},
    {id:'brazil', label:'巴西', href:root+'brazil/'},
    {id:'china',  label:'中国', href:'https://4ktyj09crz99a.feishuapp.com/app/app_17bzq8pfve2', ext:true}
  ];

  var linksHtml = links.map(function(l){
    var cls = 'wz-link' + (l.id === current ? ' active' : '') + (l.ext ? ' ext' : '');
    var target = l.ext ? ' target="_blank" rel="noopener"' : '';
    return '<a class="'+cls+'" href="'+l.href+'"'+target+'>'+l.label+'</a>';
  }).join('');

  var nav = document.createElement('nav');
  nav.id = 'wz-nav';
  nav.className = 'visible';
  nav.innerHTML =
    '<a class="wz-logo" href="'+root+'"><span class="wz-gem">◈</span><span>五洲匠汇</span></a>' +
    '<div class="wz-links">'+linksHtml+'</div>';

  // 插入到 body 最前面
  if (document.body){
    document.body.insertBefore(nav, document.body.firstChild);
  } else {
    document.addEventListener('DOMContentLoaded', function(){
      document.body.insertBefore(nav, document.body.firstChild);
    });
  }

  // 自动隐藏：鼠标移开顶部 3 秒后淡出（仅在有 canvas 的沉浸式页面）
  var hasCanvas = document.querySelector('canvas');
  if (hasCanvas){
    var hideTimer = null;
    function showNav(){
      nav.classList.add('visible');
      nav.classList.remove('hidden');
      clearTimeout(hideTimer);
      hideTimer = setTimeout(function(){
        nav.classList.remove('visible');
        nav.classList.add('hidden');
      }, 3000);
    }
    document.addEventListener('mousemove', function(e){
      if (e.clientY < 80) showNav();
    });
    nav.addEventListener('mouseenter', function(){
      clearTimeout(hideTimer);
      nav.classList.add('visible');
      nav.classList.remove('hidden');
    });
    nav.addEventListener('mouseleave', showNav);
    // 初始 3 秒后隐藏
    showNav();
  }
})();
