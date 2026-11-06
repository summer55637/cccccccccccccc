// 小樹官網共用導覽列:每頁放 <nav class="nav" id="nav"></nav> + <script src="nav.js"></script>,這支把連結補進去並標出目前這頁。
// 首頁的導覽列一開始是透明的,捲動後才變實心(index 的 <nav> 加 data-hero);其他頁一律實心。
// 分組:新手入門 / 遊戲系統 / 資料查詢 / 活動與公告。每組第一項是「整頁」,後面縮排的是該頁的熱門小節(錨點名稱跟 gen_pages.js 約定,見 README)。
(function () {
  var GAME = 'https://test.xiaoshu.gg/play/';
  var MENU = [
    ['新手入門', [
      ['新手指南', 'guide.html'],
      ['職業試煉', 'guide.html#class-trial', 1],
      ['創角送的禮', 'guide.html#newbie-gift', 1],
      ['離線掛機', 'guide.html#afk', 1],
      ['建議練功路線', 'guide.html#route', 1],
    ]],
    ['遊戲系統', [
      ['系統介紹', 'systems.html'],
      ['月卡', 'systems.html#monthcard', 1],
      ['禮包碼', 'systems.html#giftcode', 1],
      ['倉庫', 'systems.html#warehouse', 1],
      ['交易所', 'systems.html#market', 1],
      ['面對面交易', 'systems.html#trade', 1],
      ['排行榜', 'systems.html#rank', 1],
      ['技能介紹', 'skills.html'],
      ['裝備強化', 'enhance.html'],
      ['變身與娃娃', 'cards.html'],
      ['召喚與寵物', 'pets.html'],
    ]],
    ['資料查詢', [
      ['獵場列表', 'zones.html'],
      ['怪物掉落', 'monsters.html'],
    ]],
    ['活動與公告', [
      ['活動', 'events.html'],
      ['更新日誌', 'changelog.html'],
    ]],
    ['加入社群', 'index.html#join'],
  ];
  var nav = document.getElementById('nav');
  if (!nav) return;
  var here = (location.pathname.split('/').pop() || 'index.html');
  var hero = nav.hasAttribute('data-hero');
  function link(item) {
    var cls = [];
    if (item[1] === here) cls.push('on');
    if (item[2]) cls.push('sub');
    return '<a href="' + item[1] + '"' + (cls.length ? ' class="' + cls.join(' ') + '"' : '') + '>' + item[0] + '</a>';
  }
  var links = MENU.map(function (m) {
    if (typeof m[1] === 'string') return link(m);
    var on = m[1].some(function (s) { return s[1] === here; });
    return '<div class="dd' + (on ? ' on' : '') + '"><button type="button" class="dd-btn">' + m[0] + ' <span>▾</span></button>' +
      '<div class="dd-menu">' + m[1].map(link).join('') + '</div></div>';
  }).join('');
  // 手機:每組一個小標題,下面連結兩欄排
  var flat = MENU.map(function (m) {
    if (typeof m[1] === 'string') return '<div class="m-grp"><a href="' + m[1] + '">' + m[0] + '</a></div>';
    return '<div class="m-grp"><div class="m-ttl">' + m[0] + '</div><div class="m-list">' + m[1].map(link).join('') + '</div></div>';
  }).join('');
  nav.innerHTML = '<div class="wrap">' +
    '<a class="brand" href="index.html">小樹放置天堂</a>' +
    '<div class="nav-links">' + links + '</div>' +
    '<a class="btn btn-gold nav-play" href="' + GAME + '" target="_blank" rel="noopener">進入遊戲</a>' +
    '<button type="button" class="burger" aria-label="選單"><i></i><i></i><i></i></button>' +
    '</div><div class="m-menu">' + flat + '<a class="m-play" href="' + GAME + '" target="_blank" rel="noopener">▶ 進入遊戲</a></div>';
  if (!hero) nav.classList.add('solid');
  else {
    var onScroll = function () { nav.classList.toggle('solid', window.scrollY > 40 || nav.classList.contains('open')); };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }
  // 下拉選單:點按開關(手機/平板沒有 hover),點外面收起
  nav.addEventListener('click', function (e) {
    var b = e.target.closest('.dd-btn');
    if (b) { var dd = b.parentNode; var open = !dd.classList.contains('show'); closeAll(); if (open) dd.classList.add('show'); e.stopPropagation(); return; }
    if (e.target.closest('.burger')) { nav.classList.toggle('open'); if (hero) nav.classList.toggle('solid', nav.classList.contains('open') || window.scrollY > 40); e.stopPropagation(); return; }
    if (e.target.closest('.m-menu a')) nav.classList.remove('open');
  });
  function closeAll() { nav.querySelectorAll('.dd.show').forEach(function (d) { d.classList.remove('show'); }); }
  document.addEventListener('click', closeAll);

  // 全站共用:頁尾連結 + 回到頂端(頁面有 <footer> 才補;已有 .foot-links 就不重複)
  var foot = document.querySelector('footer .wrap');
  if (foot && !foot.querySelector('.foot-links')) {
    var fl = document.createElement('div');
    fl.className = 'foot-links';
    fl.innerHTML = [['新手指南', 'guide.html'], ['系統介紹', 'systems.html'], ['獵場列表', 'zones.html'], ['怪物掉落', 'monsters.html'], ['活動', 'events.html'], ['更新日誌', 'changelog.html'], ['加入社群', 'index.html#join']]
      .map(function (x) { return '<a href="' + x[1] + '">' + x[0] + '</a>'; }).join('');
    foot.insertBefore(fl, foot.firstChild);
  }
  var up = document.createElement('a');
  up.className = 'to-top'; up.href = '#'; up.setAttribute('aria-label', '回到頂端'); up.textContent = '▲';
  up.addEventListener('click', function (e) { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
  document.body.appendChild(up);
  window.addEventListener('scroll', function () { up.classList.toggle('show', window.scrollY > 600); }, { passive: true });
})();
