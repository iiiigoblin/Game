/* 交互层：面板、路线绘制、HUD、音效与游戏循环。 */
(function () {
  'use strict';
  var D = window.DATA, W = D.WORLD.w, H = D.WORLD.h;
  var canvas = document.getElementById('game');
  var renderer = new window.Renderer(canvas);
  window.__renderer = renderer;   // 调试 / 测试句柄

  // 开局设置：模式 / 难度 / 地图（-1 = 随机抽选）
  var settings = { mode: 'classic', difficulty: 'normal', mapIndex: -1 };
  function gameOpts(randomMap) {
    var o = { mode: settings.mode, difficulty: settings.difficulty };
    if (!randomMap && settings.mapIndex >= 0) o.mapIndex = settings.mapIndex;
    return o;
  }
  var game = new window.Game(gameOpts(false));
  window.__game = game;   // 调试 / 测试句柄
  var setupOpen = true;

  var ui = {
    tab: 'unit', selected: null, pending: null, hover: null,
    hoverUnitId: null, selectedUnitId: null, muted: false,
    noticeUntil: 0, overShown: false, lastLogCount: -1, lastCardRefresh: 0,
    lastSituation: 0, lastSfx: 0, lastDeploySig: ''
  };

  var el = {};
  ['mapLabel', 'timeVal', 'timeLabel', 'enemyVal', 'killVal', 'energyVal', 'energyFill', 'energyRate',
    'btnPause', 'btnSpeed', 'btnStart', 'btnRestart', 'btnHelp', 'btnMute', 'btnSetup',
    'cardList', 'hintBar', 'overlay', 'overlayTitle', 'overlayText', 'overlayStats',
    'btnAgain', 'btnCloseOverlay', 'deployList', 'btnRearm', 'btnFinishRoute', 'btnCancel',
    'detail', 'situation', 'log', 'phaseText', 'tipText', 'helpModal', 'btnCloseHelp',
    'canvasWrap', 'setupModal', 'setupSummary', 'modeOptions', 'diffOptions', 'mapOptions',
    'btnSetupStart', 'btnSetupCancel', 'modeChip', 'civilianStat', 'civilianVal'
  ].forEach(function (id) { el[id] = document.getElementById(id); });

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function fmtTime(s) { var v = Math.max(0, Math.ceil(s)); return pad2(Math.floor(v / 60)) + ':' + pad2(v % 60); }

  /* ---------------- 开局设置 ---------------- */
  function buildSetup() {
    el.modeOptions.innerHTML = '';
    Object.keys(D.MODES).forEach(function (key) {
      var m = D.MODES[key];
      var b = document.createElement('button');
      b.className = 'opt'; b.dataset.mode = key;
      b.innerHTML = '<div class="opt-head"><span class="opt-icon">' + m.icon + '</span>' +
        '<span class="opt-name">' + m.name + '</span><span class="opt-tag">' + m.tagline + '</span></div>' +
        '<div class="opt-desc">' + m.desc + '</div>';
      b.addEventListener('click', function () { settings.mode = key; renderSetup(); });
      el.modeOptions.appendChild(b);
    });
    el.diffOptions.innerHTML = '';
    Object.keys(D.DIFFICULTIES).forEach(function (key) {
      var d = D.DIFFICULTIES[key];
      var b = document.createElement('button');
      b.className = 'opt' + (key === 'hard' ? ' danger' : ''); b.dataset.diff = key;
      b.innerHTML = '<div class="opt-head"><span class="opt-icon">' +
        (key === 'hard' ? '◆' : '◇') + '</span><span class="opt-name">' + d.name + '</span></div>' +
        '<div class="opt-desc">' + d.desc + '</div>';
      b.addEventListener('click', function () { settings.difficulty = key; renderSetup(); });
      el.diffOptions.appendChild(b);
    });
    el.mapOptions.innerHTML = '';
    var opts = [{ i: -1, name: '随机抽选' }].concat(D.MAPS.map(function (m, i) {
      return { i: i, name: '#' + (i + 1) + ' ' + m.name };
    }));
    opts.forEach(function (o) {
      var b = document.createElement('button');
      b.className = 'map-opt'; b.dataset.map = o.i; b.textContent = o.name;
      b.addEventListener('click', function () { settings.mapIndex = o.i; renderSetup(); });
      el.mapOptions.appendChild(b);
    });
  }
  function renderSetup() {
    var modes = el.modeOptions.querySelectorAll('.opt');
    for (var i = 0; i < modes.length; i++) modes[i].classList.toggle('active', modes[i].dataset.mode === settings.mode);
    var diffs = el.diffOptions.querySelectorAll('.opt');
    for (var j = 0; j < diffs.length; j++) diffs[j].classList.toggle('active', diffs[j].dataset.diff === settings.difficulty);
    var maps = el.mapOptions.querySelectorAll('.map-opt');
    for (var k = 0; k < maps.length; k++) maps[k].classList.toggle('active', +maps[k].dataset.map === settings.mapIndex);
    var m = D.MODES[settings.mode], d = D.DIFFICULTIES[settings.difficulty];
    var mapName = settings.mapIndex < 0 ? '开局随机抽选 4 张预设地形之一' : D.MAPS[settings.mapIndex].name;
    var goal = settings.mode === 'vampire'
      ? '守到日出即胜利 · 平民阵亡过半失败'
      : (settings.mode === 'infection' ? '清除全部敌方单位（含倒戈者）' : '限时清除全部敌方单位');
    el.setupSummary.innerHTML = '当前选择：<b>' + m.name + ' · ' + d.name + '</b>　|　地图：<b>' + mapName + '</b><br>' +
      '胜利条件：<b>' + goal + '</b>　|　限时 <b>' + D.CFG.timeLimit + ' 秒</b>　|　' + d.desc;
  }
  function openSetup() {
    setupOpen = true;
    ui.pausedBeforeSetup = game.paused;
    if (game.phase === 'battle') game.paused = true;
    el.btnSetupCancel.classList.remove('hidden');
    el.setupModal.classList.remove('hidden');
    renderSetup();
    updateButtons();
  }
  function closeSetup() {
    setupOpen = false;
    el.setupModal.classList.add('hidden');
    game.paused = !!ui.pausedBeforeSetup;
    updateButtons();
  }
  function applySettings() {
    settings.mode = D.MODES[settings.mode] ? settings.mode : 'classic';
    settings.difficulty = D.DIFFICULTIES[settings.difficulty] ? settings.difficulty : 'normal';
    game = new window.Game(gameOpts(false));
    window.__game = game;
    setupOpen = false;
    ui.selected = null; ui.pending = null; ui.selectedUnitId = null; ui.hoverUnitId = null;
    ui.overShown = false; ui.lastLogCount = -1; ui.lastDeploySig = '';
    el.setupModal.classList.add('hidden');
    el.overlay.classList.add('hidden');
    el.helpModal.classList.add('hidden');
    el.hintBar.textContent = defaultHint(); el.hintBar.className = 'hint-bar';
    ui.noticeUntil = 0;
    buildCards(); renderDeployList(true); updateSituation(); updateDetail(); updateButtons(); updateLog();
    notice('已按「' + D.MODES[settings.mode].name + ' · ' + D.DIFFICULTIES[settings.difficulty].name +
      '」开始部署。地图：' + game.map.name + '。', 'good');
  }

  /* ---------------- 画布尺寸 ---------------- */
  function fitCanvas() {
    var cw = el.canvasWrap.clientWidth - 14, ch = el.canvasWrap.clientHeight - 14;
    var scale = Math.max(0.2, Math.min(cw / W, ch / H));
    canvas.style.width = Math.floor(W * scale) + 'px';
    canvas.style.height = Math.floor(H * scale) + 'px';
  }
  function toWorld(e) {
    var r = canvas.getBoundingClientRect();
    return {
      x: clamp((e.clientX - r.left) / r.width * W, 0, W),
      y: clamp((e.clientY - r.top) / r.height * H, 0, H)
    };
  }
  function unitAt(p) {
    var best = null, bd = 1e9;
    for (var i = 0; i < game.units.length; i++) {
      var u = game.units[i];
      if (!u.alive || !game.isKnown(u)) continue;
      var d = Math.hypot(u.x - p.x, u.y - p.y);
      if (d < u.radius + 8 && d < bd) { bd = d; best = u; }
    }
    return best;
  }

  /* ---------------- 卡片面板 ---------------- */
  function makeCard(kind, key, icon, color, name, desc, tags, costText, free) {
    var div = document.createElement('div');
    div.className = 'card';
    div.dataset.kind = kind; div.dataset.key = key;
    var ic = document.createElement('div');
    ic.className = 'card-icon'; ic.style.background = color; ic.textContent = icon;
    var main = document.createElement('div');
    main.className = 'card-main';
    var nm = document.createElement('div'); nm.className = 'card-name'; nm.textContent = name;
    var ds = document.createElement('div'); ds.className = 'card-desc'; ds.textContent = desc;
    var tg = document.createElement('div'); tg.className = 'card-tags';
    tags.slice(0, 3).forEach(function (t) {
      var s = document.createElement('span'); s.className = 'tag'; s.textContent = t; tg.appendChild(s);
    });
    main.appendChild(nm); main.appendChild(ds); main.appendChild(tg);
    var pill = document.createElement('div');
    pill.className = 'cost-pill' + (free ? ' free' : '');
    pill.textContent = costText;
    div.appendChild(ic); div.appendChild(main); div.appendChild(pill);
    div.addEventListener('click', function () { selectCard(kind, key); });
    return div;
  }
  function buildCards() {
    el.cardList.innerHTML = '';
    if (ui.tab === 'unit') {
      var note = document.createElement('div');
      note.className = 'section-note';
      note.textContent = '单兵血量相近、减伤不同；大体积单位血量按体积放大。点击卡片后即可在地图放置并绘制路线。';
      el.cardList.appendChild(note);
      D.PLAYABLE.forEach(function (key) {
        var d = D.UNIT_DEFS[key];
        el.cardList.appendChild(makeCard('unit', key, d.short, d.color, d.name, d.desc, d.tags,
          d.cost === 0 ? '0 费' : d.cost + ' 费', d.cost === 0));
      });
    } else if (ui.tab === 'skill') {
      var n2 = document.createElement('div');
      n2.className = 'section-note';
      n2.textContent = '战术技能仅在对局进行中可用，选中后直接点击地图目标位置（天命所归需点选敌方单位）。';
      el.cardList.appendChild(n2);
      Object.keys(D.SKILLS).forEach(function (key) {
        var s = D.SKILLS[key];
        el.cardList.appendChild(makeCard('skill', key, s.short, '#8a5aa8', s.name, s.desc, s.tags, s.cost + ' 费', false));
      });
      var n3 = document.createElement('div');
      n3.className = 'section-note';
      n3.innerHTML = '<b>条件单位</b>：降军在击杀过半后自动获得，出现在「兵种」页最下方，0 费派遣。';
      el.cardList.appendChild(n3);
    } else {
      var n4 = document.createElement('div');
      n4.className = 'section-note';
      n4.textContent = '地形与道具随机抽选预设地图，对局中可被火焰、打击或单位行为改变。';
      el.cardList.appendChild(n4);
      var colors = { river: '#6fa9d2', bridge: '#b09a72', grass: '#8fbe68', forest: '#4a7a4e',
        grave: '#9a90a8', wall: '#8c8f96', building: '#a98a68' };
      var icons = { river: '≈', bridge: '═', grass: '❋', forest: '♣', grave: '✝', wall: '▤', building: '▣' };
      Object.keys(D.TERRAIN_INFO).forEach(function (key) {
        var t = D.TERRAIN_INFO[key];
        el.cardList.appendChild(makeCard('info', key, icons[key], colors[key], t.name, t.desc, [], '地形', true));
      });
      var pcolors = D.PICKUP_INFO;
      Object.keys(pcolors).forEach(function (key) {
        var p = pcolors[key];
        el.cardList.appendChild(makeCard('info', key, p.short, p.color, p.name, p.desc, [], '道具', true));
      });
    }
    refreshCards();
  }
  function refreshCards() {
    var cards = el.cardList.querySelectorAll('.card');
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i], kind = c.dataset.kind, key = c.dataset.key;
      var pill = c.querySelector('.cost-pill');
      var locked = false, unavailable = false;
      if (kind === 'unit') {
        var d = D.UNIT_DEFS[key];
        if (key === 'defector') {
          pill.textContent = game.defectors > 0 ? '×' + game.defectors + ' · 0 费' : '未获得';
          locked = game.defectors <= 0;
        } else if (key === 'necro') {
          pill.textContent = game.necroUsed ? '已使用' : d.cost + ' 费';
          locked = game.necroUsed;
        } else {
          pill.textContent = d.cost + ' 费';
        }
        unavailable = game.energy + 1e-6 < d.cost;
      } else if (kind === 'skill') {
        var s = D.SKILLS[key];
        unavailable = game.energy + 1e-6 < s.cost;
        pill.textContent = s.cost + ' 费';
      }
      var active = ui.selected && ui.selected.kind === kind && ui.selected.key === key;
      c.className = 'card' + (active ? ' active' : '') +
        (unavailable && !active ? ' unavailable' : '') + (locked ? ' locked' : '');
    }
  }
  function selectCard(kind, key) {
    if (kind === 'info') { showDetailInfo(key); return; }
    if (kind === 'unit') {
      if (key === 'defector' && game.defectors <= 0) { notice('尚未获得降军：击杀数超过敌方初始单位数的一半后自动获得。', 'warn'); return; }
      if (key === 'necro' && game.necroUsed) { notice('死灵法师每局仅能派遣一次。', 'warn'); return; }
    }
    if (ui.selected && ui.selected.kind === kind && ui.selected.key === key) ui.selected = null;
    else ui.selected = { kind: kind, key: key };
    ui.pending = null;
    refreshCards(); updateDetail(); updateButtons();
    if (ui.selected) {
      if (kind === 'skill') notice('已选中「' + D.SKILLS[key].name + '」：点击地图指定位置' + (key === 'meteor' ? '上的敌方单位' : '') + '。');
      else notice('已选中「' + D.UNIT_DEFS[key].name + '」：点击地图确定出发点，再逐个点击添加路点，双击或回车完成。');
    } else notice('已取消选择。');
  }

  /* ---------------- 部署交互 ---------------- */
  function notice(text, type) {
    el.hintBar.textContent = text;
    el.hintBar.className = 'hint-bar' + (type ? ' ' + type : '');
    ui.noticeUntil = performance.now() + 3000;
  }
  function defaultHint() {
    var prefix = '【' + D.MODES[settings.mode].name + ' · ' + D.DIFFICULTIES[settings.difficulty].name + '】';
    if (settings.mode === 'vampire') {
      if (game.phase === 'deploy') return prefix + '守住左侧平民：单位只能从左侧部署带出发，尽快布置防线；平民遇敌会自行逃离，撑到日出即获胜。';
      if (game.phase === 'battle') return prefix + '血仆自右向左推进；领主超高血量、近距高伤，血量打空会化蝠退回右侧重整（期间易伤可追杀），注意保护平民。';
    }
    if (settings.mode === 'infection' && game.phase !== 'deploy') {
      return prefix + '伤势累积会感染并倒戈，医疗包可治愈；仍需清除全部敌方单位（含转化者）。';
    }
    if (settings.difficulty === 'hard' && game.phase !== 'deploy') {
      return prefix + '敌方血量翻倍；障碍后的敌人显示为半透明灰色轮廓，走近才真正发现；视野扇形跟随单位朝向（移动时以移动方向为中线）；选中单兵可在详情面板进入建筑守巷。';
    }
    if (game.phase === 'deploy') return prefix + '部署阶段：单位只能从左侧蓝色部署带出发 → 选兵种 → 点出发点 → 点路点 → 双击 / 回车完成；蓝图为视野索敌、橙环为攻击范围。';
    if (game.phase === 'battle') return prefix + '对局中：敌人被发现且进入射程才停下清场；单击已抵达终点（金色「可重划」）的己方单位可再划新路线；选中单兵可在详情面板进入建筑守巷。';
    return '本局已结束。点击「换图重开」或「开局设置」开始新一局。';
  }
  function onCanvasClick(e) {
    if (game.phase === 'victory' || game.phase === 'defeat') return;
    var p = toWorld(e);
    if (ui.pending) {
      var last = ui.pending.route.length ? ui.pending.route[ui.pending.route.length - 1]
        : { x: ui.pending.x, y: ui.pending.y };
      if (Math.hypot(p.x - last.x, p.y - last.y) < 9) {
        notice('该位置与上一路点重合，已忽略；双击、回车或点「完成路线」结束绘制。');
        return;
      }
      ui.pending.route.push({ x: p.x, y: p.y });
      notice((ui.pending.mode === 'repath' ? '新路线' : '路线') + '已添加第 ' + ui.pending.route.length +
        ' 个路点；双击、回车或点「完成路线」结束绘制。');
      return;
    }
    // 对局中单击已抵达终点的己方单位 → 立即进入重划路线模式（守巷中的单位除外）
    var hit = unitAt(p);
    if (hit && hit.team === 'player' && hit.arrived && !hit.garrisonId && game.phase === 'battle' &&
      (!ui.selected || ui.selected.kind !== 'skill')) {
      ui.selected = null; refreshCards();
      ui.selectedUnitId = hit.id;
      ui.pending = { mode: 'repath', unitId: hit.id, x: hit.x, y: hit.y, route: [] };
      notice('已选中抵达终点的「' + hit.def.name + '」：点击地图添加新路点，双击 / 回车确认，右键取消。');
      updateButtons(); updateDetail();
      return;
    }
    if (!ui.selected) {
      ui.selectedUnitId = hit ? hit.id : null;
      updateDetail();
      return;
    }
    if (ui.selected.kind === 'skill') {
      var r = game.useSkill(ui.selected.key, p.x, p.y);
      if (!r.ok) notice(r.msg, 'warn');
      else {
        notice('战术已发动：' + D.SKILLS[ui.selected.key].name + '。', 'good');
        ui.selected = null; refreshCards(); updateDetail();
      }
      return;
    }
    // 出发点即时校验：强制从战场左侧部署带出发
    var check = game.canDeployAt(ui.selected.key, p.x, p.y);
    if (!check.ok) { notice(check.msg, 'warn'); return; }
    ui.pending = { mode: 'deploy', kind: 'unit', key: ui.selected.key, x: p.x, y: p.y, route: [] };
    notice('出发点已设定：继续点击添加路点；若原地驻守，直接双击 / 回车完成。');
    updateButtons();
  }
  function finishRoute() {
    if (!ui.pending) return;
    var p = ui.pending, r;
    if (p.mode === 'repath') {
      r = game.setRoute(p.unitId, p.route);
      ui.pending = null;
      if (!r.ok) notice(r.msg, 'warn');
      else notice('已为「' + r.unit.def.name + '」重划路线（' + p.route.length + ' 个节点），单位重新出发。', 'good');
    } else {
      r = game.deploy(p.key, p.x, p.y, p.route);
      ui.pending = null;
      if (!r.ok) notice(r.msg, 'warn');
      else notice('已派遣 ' + D.UNIT_DEFS[p.key].name + (p.route.length ? '，路线 ' + p.route.length + ' 个节点。' : '，原地驻守。'), 'good');
    }
    renderDeployList(true); refreshCards(); updateButtons(); updateDetail();
  }
  function cancelAction() {
    if (ui.pending) { ui.pending = null; notice('已取消本次派遣，费用未扣除。'); }
    else if (ui.selected) { ui.selected = null; notice('已取消选择。'); }
    else ui.selectedUnitId = null;
    refreshCards(); updateButtons(); updateDetail();
  }

  /* ---------------- 详情 / 态势 / 日志 ---------------- */
  function statRow(label, value) {
    return '<div><span>' + label + '</span><b>' + value + '</b></div>';
  }
  function showDetailInfo(key) {
    var t = D.TERRAIN_INFO[key];
    if (t) {
      el.detail.innerHTML = '<h3>' + t.name + '</h3><div class="d-sub">地形图鉴</div><p>' + t.desc + '</p>';
    } else {
      var p = D.PICKUP_INFO[key];
      el.detail.innerHTML = '<h3>' + p.name + '</h3><div class="d-sub">战场道具</div><p>' + p.desc + '</p>';
    }
  }
  function updateDetail() {
    var target = null;
    for (var i = 0; i < game.units.length; i++) {
      if (game.units[i].id === ui.selectedUnitId && game.units[i].alive) { target = game.units[i]; break; }
    }
    if (!target && ui.hoverUnitId) {
      for (var j = 0; j < game.units.length; j++) {
        if (game.units[j].id === ui.hoverUnitId && game.units[j].alive) { target = game.units[j]; break; }
      }
    }
    if (target) {
      var d = target.def;
      var st = [];
      if (target.statuses.stun > 0) st.push('晕眩');
      if (target.statuses.slow > 0) st.push('减速');
      if (target.statuses.poison > 0) st.push('中毒');
      if (target.hidden) st.push('草丛隐身');
      if (target.undead) st.push('亡灵');
      if (target.wallHack) st.push('透视');
      if (target.riverBlocked) st.push('河流禁火');
      if (target.engaged) st.push('交战停机');
      if (target.alertT > 0) st.push('受击警戒');
      if (target.infected) st.push('感染 ' + Math.max(0, Math.ceil(target.infectT)) + 's 后倒戈');
      if (target.turned) st.push('已倒戈');
      if (target.ramActive) st.push('碾压冲刺');
      if (target.arrived && target.team === 'player' && !target.garrisonId) st.push('已抵达 · 可单击重划');
      if (target.garrisonId) st.push('守巷中 · 不可移动');
      if (target.team === 'civilian') st.push(target.fleeing ? '逃离中' : '留守村镇');
      if (target.batForm) st.push('化蝠飞行 · 易伤减速');
      if (target.vstate === 'reform') st.push('重整中 · 静止');
      var extra = '';
      if (target.key === 'heli') extra = statRow('剩余弹药', target.ammo + ' / 60');
      if (target.key === 'jet') extra = statRow('剩余导弹', target.missiles + ' / 4');
      if (target.maxShield > 0) extra += statRow('护盾', Math.round(target.shield) + ' / ' + target.maxShield);
      if (target.key === 'gunner') extra += statRow('状态', target.state === 'deploy' ? '架设中' : (target.state === 'fire' ? '射击中' : (target.state === 'pack' ? '收枪中' : '行进')));
      if (target.infected) extra += statRow('感染量', Math.round(target.infectLoad) + ' / ' + D.CFG.infectionThreshold);
      if (target.def.holdAttackers) extra += statRow('非友方攻击源', game.attackerCount(target) + ' / ' + target.def.holdAttackers);
      if (target.lifesteal) extra += statRow('攻击吸血', Math.round(target.lifesteal * 100) + '%');
      if (target.key === 'vampire') {
        extra += statRow('重整次数', target.reformCount + '（每次最大生命 -20%、吸血 +15%）');
        if (target.vstate === 'reform') extra += statRow('重整剩余', Math.max(0, Math.ceil(target.reformT)) + ' 秒');
        else if (target.vstate === 'advance') extra += statRow('化蝠冷却',
          target.batCd > 0 ? Math.max(0, Math.ceil(target.batCd)) + ' 秒' : '就绪');
        else if (target.vstate === 'bat') extra += statRow('化蝠状态', '受伤 ×' + D.CFG.vampireBatVuln + ' · 受击减速');
      }
      if (target.garrisonId) {
        extra += statRow('守巷增益', '减伤 +25% · 视野/射程 +35%');
        extra += statRow('实际视野/射程', Math.round(game.effVision(target)) + ' / ' + Math.round(game.effRange(target)));
      }
      // 守巷操作按钮
      var actions = '';
      if (target.team === 'player' && target.def.size === 'soldier' &&
        game.phase !== 'victory' && game.phase !== 'defeat') {
        if (target.garrisonId) {
          actions = '<div class="detail-actions">' +
            '<button class="btn small" data-act="ungarrison" data-id="' + target.id + '">撤出建筑</button>' +
            '<span class="d-note">恢复自由行动；建筑被摧毁时守巷单兵会直接阵亡</span></div>';
        } else {
          var nb = game.nearestGarrisonable(target);
          if (nb) {
            actions = '<div class="detail-actions">' +
              '<button class="btn small accent" data-act="garrison" data-id="' + target.id + '" data-tid="' + nb.id + '">进入建筑守巷</button>' +
              '<span class="d-note">+25% 减伤 · 视野/射程 +35% · 不可移动 · 不被所在建筑遮挡</span></div>';
          } else {
            var hasBuilding = game.terrains.some(function (t) { return t.alive && t.type === 'building'; });
            if (hasBuilding && game.phase === 'battle') {
              actions = '<div class="detail-actions"><span class="d-note">附近 ' + D.CFG.garrisonRange +
                ' 距离内没有建筑——把该单兵移动到琥珀色虚线边框的建筑旁，这里就会出现「进入建筑守巷」按钮</span></div>';
            }
          }
        }
      }
      var teamName = target.team === 'player' ? '己方' :
        (target.team === 'enemy' ? '敌方' : (target.team === 'civilian' ? '平民 · 需保护' : '中立'));
      el.detail.innerHTML = '<h3>' + d.name + (d.boss ? ' · BOSS' : '') + '</h3>' +
        '<div class="d-sub">' + teamName + ' · ' +
        (d.size === 'air' ? '空中' : (d.size === 'heavy' ? '大体积' : '单兵')) + ' · ' + target.state +
        (d.antiAir === false ? ' · 不可对空' : '') + '</div>' +
        '<div class="stat-grid">' +
        statRow('血量', Math.max(0, Math.round(target.hp)) + ' / ' + Math.round(target.maxHp)) +
        statRow('减伤', Math.round(game.effArmor(target) * 100) + '%') +
        statRow('移速', target.garrisonId ? '—（守巷）' : d.speed) +
        statRow('视野', Math.round(game.effVision(target))) +
        statRow('射程', Math.round(game.effRange(target))) +
        statRow('伤害', d.damage) +
        statRow('攻速', d.rate ? d.rate + '/秒' : '—') +
        statRow('状态', st.length ? st.join('、') : '正常') + extra + '</div>' +
        '<p style="margin-top:8px">' + d.desc + '</p>' + actions;
      return;
    }
    if (ui.selected && ui.selected.kind === 'unit') {
      var def = D.UNIT_DEFS[ui.selected.key];
      el.detail.innerHTML = '<h3>' + def.name + '</h3><div class="d-sub">可派遣兵种 · ' +
        (def.cost === 0 ? '条件获得' : def.cost + ' 费') + '</div>' +
        '<div class="stat-grid">' +
        statRow('血量', def.hp) + statRow('减伤', Math.round(def.armor * 100) + '%') +
        statRow('移速', def.speed) + statRow('视野', def.vision) +
        statRow('视野角', def.visionAngle > 0 ? Math.round(def.visionAngle * 57.3) + '°' : '360°') +
        statRow('射程', def.range) + statRow('伤害', def.damage || '—') +
        statRow('攻速', def.rate ? def.rate + '/秒' : '—') + '</div>' +
        '<p style="margin-top:8px">' + def.desc + '</p>' +
        '<div class="card-tags" style="margin-top:6px">' + def.tags.map(function (t) { return '<span class="tag">' + t + '</span>'; }).join('') + '</div>';
      return;
    }
    if (ui.selected && ui.selected.kind === 'skill') {
      var s = D.SKILLS[ui.selected.key];
      el.detail.innerHTML = '<h3>' + s.name + '</h3><div class="d-sub">战术技能 · ' + s.cost + ' 费</div><p>' + s.desc + '</p>';
      return;
    }
    el.detail.innerHTML = '<h3>操作提示</h3><p>所有己方单位的<b>蓝色视野/索敌范围</b>与<b>橙色攻击范围</b>全程展示，点选或悬停会加亮。对局中单击带金色「可重划」环的己方单位，可为已抵达终点的单位重新划路线。</p>';
  }
  function updateSituation() {
    var own = 0, enemy = 0, neutral = 0, civilians = 0, burning = 0, hidden = 0, intel = 0, garrisoned = 0;
    for (var i = 0; i < game.units.length; i++) {
      var u = game.units[i];
      if (!u.alive) continue;
      if (u.team === 'player') own++;
      else if (u.team === 'enemy') enemy++;
      else if (u.team === 'civilian') civilians++;
      else neutral++;
      if (u.hidden) hidden++;
      if (u.garrisonId) garrisoned++;
    }
    for (var j = 0; j < game.terrains.length; j++) if (game.terrains[j].alive && game.terrains[j].burning > 0) burning++;
    for (var k in game.intel) if (game.intel[k].until > game.elapsed) intel++;
    var graves = game.terrains.filter(function (t) { return t.alive && t.type === 'grave'; }).length;
    var modeLine = '';
    if (game.mode === 'vampire') {
      modeLine = '距日出 <b>' + fmtTime(game.timeLeft) + '</b> · 平民幸存 <b>' +
        (game.civilianTotal - game.civilianLost) + ' / ' + game.civilianTotal + '</b>（超过半数阵亡即失败）<br>';
    }
    if (game.mode === 'infection') {
      var infected = 0;
      for (var q = 0; q < game.units.length; q++) if (game.units[q].alive && game.units[q].infected) infected++;
      modeLine = '感染中 <b>' + infected + '</b> · 已倒戈 <b>' + game.turnedCount +
        '</b>（医疗包可治愈感染）<br>';
    }
    if (game.difficulty === 'hard') {
      var unknown = 0;
      for (var z = 0; z < game.units.length; z++) {
        var eu = game.units[z];
        if (eu.alive && eu.team === 'enemy' && !game.isKnown(eu)) unknown++;
      }
      modeLine += '未被发现的敌人 <b>' + unknown + '</b> · 视野跟随单位朝向<br>';
    }
    el.situation.innerHTML = modeLine +
      '己方 <b>' + own + '</b> · 敌方 <b>' + enemy + '</b> · 平民 <b>' + civilians +
      '</b> · 中立骷髅 <b>' + neutral + '</b> · 守巷单兵 <b>' + garrisoned + '</b><br>' +
      '燃烧地形 <b>' + burning + '</b> · 隐身单位 <b>' + hidden + '</b> · 已通报坐标 <b>' + intel + '</b><br>' +
      '坟墓 <b>' + graves + '</b> · 火区 <b>' + game.fires.length + '</b> · 毒雾 <b>' + game.gas.length + '</b><br>' +
      '阵亡累计 <b>' + (game.kills + game.deaths) + '</b> · 骷髅上限 <b>' + Math.min(6, 1 + Math.floor((game.kills + game.deaths) / 4)) + '</b><br>' +
      '死灵法师 <b>' + (game.necroUsed ? '已使用' : '可用') + '</b> · 可复活尸体 <b>' +
      game.corpses.filter(function (c) { return c.single && !c.resurrected; }).length + '</b>';
  }
  function updateLog() {
    if (ui.lastLogCount === game.events.length) return;
    ui.lastLogCount = game.events.length;
    var items = game.events.slice(-8).reverse(), html = '';
    for (var i = 0; i < items.length; i++) {
      var e = items[i];
      html += '<div class="log-item ' + e.type + '"><i></i><time>' + fmtTime(e.t) + '</time><span>' + e.text + '</span></div>';
    }
    el.log.innerHTML = html;
  }
  function renderDeployList(force) {
    var own = game.units.filter(function (u) { return u.alive && u.team === 'player'; });
    var sig = game.phase + '|' + own.map(function (u) { return u.id; }).join(',') + '|' + game.seed;
    if (!force && sig === ui.lastDeploySig) return;
    ui.lastDeploySig = sig;
    if (!own.length) { el.deployList.innerHTML = '<span style="font-size:10.5px;color:#8a96a4">尚未派遣单位</span>'; return; }
    var html = '';
    for (var i = 0; i < own.length; i++) {
      var u = own[i];
      html += '<span class="deploy-chip"><b>' + u.def.name + '</b> ' + u.route.length + ' 点' +
        (game.phase === 'deploy' ? '<button data-remove="' + u.id + '" title="移除并退费">×</button>' : '') + '</span>';
    }
    el.deployList.innerHTML = html;
    var btns = el.deployList.querySelectorAll('button[data-remove]');
    for (var j = 0; j < btns.length; j++) {
      btns[j].addEventListener('click', function (ev) {
        var id = ev.target.getAttribute('data-remove');
        if (game.removeDeployed(id)) { renderDeployList(); refreshCards(); notice('已移除单位并退还费用。'); }
      });
    }
  }
  function updateButtons() {
    el.btnFinishRoute.disabled = !ui.pending;
    el.btnCancel.disabled = !ui.pending && !ui.selected && !ui.selectedUnitId;
    el.btnStart.disabled = game.phase !== 'deploy';
    el.btnStart.textContent = game.phase === 'deploy' ? '开始对局' : '对局中';
    el.btnPause.textContent = game.paused ? '继续' : '暂停';
    el.btnSpeed.textContent = game.speedFactor + '×';
    el.btnMute.textContent = ui.muted ? '♪̸' : '♪';
    var showRearm = game.pendingRearm.length > 0 && game.phase === 'battle';
    el.btnRearm.classList.toggle('hidden', !showRearm);
    el.btnRearm.disabled = game.energy < 2;
    el.mapLabel.textContent = '#' + (game.mapIndex + 1) + ' ' + game.map.name + ' · ' + game.map.subtitle;
    el.modeChip.textContent = D.MODES[settings.mode].name + ' · ' + D.DIFFICULTIES[settings.difficulty].name;
    el.modeChip.className = 'mode-chip' + (settings.difficulty === 'hard' ? ' hard' : '');
    el.timeLabel.textContent = game.mode === 'vampire' ? '距日出' : '剩余时间';
    el.civilianStat.classList.toggle('hidden', game.mode !== 'vampire');
  }

  /* ---------------- 胜负遮罩 ---------------- */
  function showOverlay() {
    var win = game.phase === 'victory', vampire = game.mode === 'vampire';
    var title, text;
    if (vampire) {
      title = win ? '日出 · 守夜成功' : '平民伤亡过半 · 守卫失败';
      text = win ? '晨光驱散了夜色，吸血鬼领主被迫撤离，村镇得以保全。'
        : '超过半数平民倒在夜袭中。试着把更多兵力留在左侧、用路点封锁推进路线。';
    } else if (game.mode === 'infection') {
      title = win ? '感染已被扑灭' : '时间耗尽 · 清剿失败';
      text = win ? '全部敌方单位（含倒戈的感染体）已被清除。' : '未能在限时内清除敌方单位，注意及时用医疗包救治感染单位。';
    } else {
      title = win ? '通关成功' : '时间耗尽 · 通关失败';
      text = win ? '全部敌方单位已被清除。' : '未能在限时内清除敌方单位，可调整兵种搭配与路线后重试。';
    }
    el.overlayTitle.textContent = title;
    el.overlayTitle.className = 'overlay-title ' + (win ? 'win' : 'lose');
    el.overlayText.textContent = text;
    var extra = '';
    if (vampire) extra = '平民幸存 <b>' + (game.civilianTotal - game.civilianLost) + ' / ' + game.civilianTotal + '</b><br>';
    if (game.mode === 'infection') extra = '感染倒戈 <b>' + game.turnedCount + '</b> 名<br>';
    el.overlayStats.innerHTML =
      '模式 <b>' + D.MODES[settings.mode].name + '</b> · 难度 <b>' + D.DIFFICULTIES[settings.difficulty].name + '</b><br>' +
      extra +
      '用时 <b>' + game.elapsed.toFixed(1) + ' 秒</b> / ' + game.timeLimit + ' 秒<br>' +
      '击杀 <b>' + game.kills + ' / ' + game.initialEnemyCount + '</b> · 己方阵亡 <b>' + game.deaths + '</b><br>' +
      '剩余费用 <b>' + game.energy.toFixed(1) + '</b> · 地图 <b>' + game.map.name + '</b>';
    el.overlay.classList.remove('hidden');
    ui.overShown = true;
  }

  /* ---------------- 音效 ---------------- */
  var audioCtx = null;
  function playTone(type) {
    if (ui.muted) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audioCtx) audioCtx = new AC();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      var now = audioCtx.currentTime;
      var o = audioCtx.createOscillator(), g = audioCtx.createGain();
      var cfg = type === 'boom' ? { f: 130, f2: 45, d: 0.20, v: 0.10, w: 'triangle' }
        : type === 'win' ? { f: 520, f2: 880, d: 0.35, v: 0.07, w: 'sine' }
          : type === 'pickup' ? { f: 700, f2: 1050, d: 0.14, v: 0.05, w: 'sine' }
            : type === 'deploy' ? { f: 380, f2: 620, d: 0.12, v: 0.05, w: 'sine' }
              : { f: 620, f2: 380, d: 0.045, v: 0.022, w: 'square' };
      o.type = cfg.w;
      o.frequency.setValueAtTime(cfg.f, now);
      o.frequency.exponentialRampToValueAtTime(Math.max(30, cfg.f2), now + cfg.d);
      g.gain.setValueAtTime(cfg.v, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + cfg.d);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(now); o.stop(now + cfg.d + 0.02);
    } catch (err) { /* 浏览器音频策略限制时静默降级 */ }
  }
  function consumeSfx() {
    if (!game.sfx.length) return;
    var arr = game.sfx;
    game.sfx = [];
    var now = performance.now();
    if (now - ui.lastSfx < 80) return;
    var order = ['win', 'boom', 'pickup', 'deploy', 'shot'];
    for (var i = 0; i < order.length; i++) {
      if (arr.indexOf(order[i]) >= 0) { playTone(order[i]); ui.lastSfx = now; break; }
    }
  }

  /* ---------------- HUD ---------------- */
  function updateHUD(now) {
    el.timeVal.textContent = fmtTime(game.timeLeft);
    el.timeVal.style.color = game.timeLeft < 30 && game.phase === 'battle' ? '#c95045' : '';
    var enemies = 0;
    for (var i = 0; i < game.units.length; i++) if (game.units[i].alive && game.units[i].team === 'enemy') enemies++;
    el.enemyVal.textContent = enemies;
    el.civilianVal.textContent = (game.civilianTotal - game.civilianLost) + ' / ' + game.civilianTotal;
    el.killVal.textContent = game.kills + ' / ' + game.defectors;
    el.energyVal.textContent = game.energy.toFixed(1) + ' / ' + D.CFG.energyCap;
    el.energyFill.style.width = (game.energy / D.CFG.energyCap * 100) + '%';

    var rate = D.CFG.energyRate, sergeants = 0, clouds = 0;
    for (var j = 0; j < game.units.length; j++) {
      var u = game.units[j];
      if (u.alive && u.team === 'player' && u.key === 'sergeant' && !u.seenByEnemy) { rate += D.CFG.sergeantBonus; sergeants++; }
    }
    for (var k = 0; k < game.gas.length; k++) if (game.gas[k].debuff) clouds++;
    rate = Math.max(0.15, rate - clouds * D.CFG.gasDebuff);
    el.energyRate.textContent = '自然恢复 ' + rate.toFixed(2) + '/秒' +
      (sergeants ? '（士官 +' + sergeants + '）' : '') + (clouds ? '（毒云 -' + clouds + '）' : '') +
      (game.overdriveT > 0 ? ' · 兴奋剂生效' : '');

    var phaseName = game.phase === 'deploy' ? '部署阶段' : (game.phase === 'battle' ? '对局进行中' : '对局结束');
    el.phaseText.textContent = game.paused && game.phase === 'battle' ? '已暂停' : phaseName;
    el.phaseText.className = 'phase-chip' + (game.phase === 'battle' ? ' battle' : (game.phase !== 'deploy' ? ' over' : ''));
    var idleTip = game.mode === 'vampire'
      ? '守住平民，撑到日出；敌方自右向左推进。'
      : (game.mode === 'infection' ? '注意感染倒计时，医疗包可治愈；抵达终点可单击重划路线。'
        : '发现且进入射程才停下清场；抵达终点可单击重划路线。');
    el.tipText.textContent = ui.pending
      ? (ui.pending.mode === 'repath' ? '正在重划路线：' : '正在绘制路线：') + ui.pending.route.length + ' 个路点'
      : (game.phase === 'deploy' ? '先规划，后开战；仅限左侧部署带出发。' : idleTip);

    if (ui.noticeUntil && now > ui.noticeUntil) {
      el.hintBar.textContent = defaultHint();
      el.hintBar.className = 'hint-bar';
      ui.noticeUntil = 0;
    }
    if (now - ui.lastCardRefresh > 220) { ui.lastCardRefresh = now; refreshCards(); updateButtons(); }
    if (now - ui.lastSituation > 260) { ui.lastSituation = now; updateSituation(); updateDetail(); renderDeployList(); }
    updateLog();
    if (!ui.overShown && (game.phase === 'victory' || game.phase === 'defeat')) showOverlay();
  }

  /* ---------------- 事件绑定 ---------------- */
  canvas.addEventListener('click', onCanvasClick);
  canvas.addEventListener('dblclick', function () {
    if (ui.pending) {
      var r = ui.pending.route;
      // 双击的第二次 click 会额外压入一个与出发点重合的路点，需剔除
      if (r.length) {
        var a = r[r.length - 1];
        if (Math.hypot(a.x - ui.pending.x, a.y - ui.pending.y) < 9) r.pop();
      }
      if (r.length >= 2) {
        var c = r[r.length - 1], d = r[r.length - 2];
        if (Math.hypot(c.x - d.x, c.y - d.y) < 9) r.pop();
      }
    }
    finishRoute();
  });
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); cancelAction(); });
  canvas.addEventListener('mousemove', function (e) {
    ui.hover = toWorld(e);
    var u = unitAt(ui.hover);
    ui.hoverUnitId = u ? u.id : null;
  });
  canvas.addEventListener('mouseleave', function () { ui.hover = null; ui.hoverUnitId = null; });

  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (x) { x.classList.remove('active'); });
      t.classList.add('active');
      ui.tab = t.dataset.tab;
      buildCards();
    });
  });
  el.btnFinishRoute.addEventListener('click', finishRoute);
  el.btnCancel.addEventListener('click', cancelAction);
  // 详情面板：守巷 / 撤出建筑
  el.detail.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest ? e.target.closest('button[data-act]') : null;
    if (!btn) return;
    var id = btn.getAttribute('data-id');
    if (btn.getAttribute('data-act') === 'garrison') {
      var r = game.garrison(id, btn.getAttribute('data-tid'));
      notice(r.ok ? '已进入建筑守巷：+25% 减伤、视野与攻击范围 +35%，但不可移动。' : r.msg,
        r.ok ? 'good' : 'warn');
    } else {
      var r2 = game.ungarrison(id);
      notice(r2.ok ? '已撤出建筑，恢复自由行动（可单击重划路线）。' : r2.msg, r2.ok ? 'good' : 'warn');
    }
    updateDetail(); updateButtons(); renderDeployList();
  });
  el.btnRearm.addEventListener('click', function () {
    if (!game.pendingRearm.length) return;
    var r = game.rearmJet(game.pendingRearm[0]);
    notice(r.ok ? '战斗机已补满导弹并重新出击。' : r.msg, r.ok ? 'good' : 'warn');
    updateButtons();
  });
  el.btnStart.addEventListener('click', function () {
    if (setupOpen) { notice('请先在「开局设置」中确认模式与难度。', 'warn'); return; }
    game.startBattle();
    renderDeployList(); updateButtons();
    notice(game.mode === 'vampire'
      ? '夜幕降临！守住左侧 ' + game.civilianTotal + ' 名平民，撑到日出即获胜。'
      : '对局开始！限时 ' + game.timeLimit + ' 秒，清除全部敌方单位即可通关。', 'good');
  });
  el.btnPause.addEventListener('click', function () { game.paused = !game.paused; updateButtons(); });
  el.btnSpeed.addEventListener('click', function () {
    game.speedFactor = game.speedFactor === 1 ? 2 : 1;
    updateButtons();
    notice('对局速度：' + game.speedFactor + '×。');
  });
  el.btnRestart.addEventListener('click', restart);
  el.btnAgain.addEventListener('click', restart);
  el.btnSetup.addEventListener('click', openSetup);
  el.modeChip.addEventListener('click', openSetup);
  el.btnSetupStart.addEventListener('click', applySettings);
  el.btnSetupCancel.addEventListener('click', closeSetup);
  el.btnCloseOverlay.addEventListener('click', function () { el.overlay.classList.add('hidden'); });
  el.btnMute.addEventListener('click', function () { ui.muted = !ui.muted; updateButtons(); });
  el.btnHelp.addEventListener('click', function () { el.helpModal.classList.remove('hidden'); });
  el.btnCloseHelp.addEventListener('click', function () { el.helpModal.classList.add('hidden'); });
  el.helpModal.addEventListener('click', function (e) {
    if (e.target === el.helpModal) el.helpModal.classList.add('hidden');
  });
  window.addEventListener('keydown', function (e) {
    if (setupOpen) {
      if (e.key === 'Enter') { applySettings(); e.preventDefault(); }
      else if (e.key === 'Escape' && !el.btnSetupCancel.classList.contains('hidden')) closeSetup();
      return;
    }
    if (e.key === 'Enter') { finishRoute(); e.preventDefault(); }
    else if (e.key === 'Escape') {
      if (!el.helpModal.classList.contains('hidden')) el.helpModal.classList.add('hidden');
      else cancelAction();
    } else if (e.code === 'Space') { game.paused = !game.paused; updateButtons(); e.preventDefault(); }
    else if (e.key === '1') { game.speedFactor = 1; updateButtons(); }
    else if (e.key === '2') { game.speedFactor = 2; updateButtons(); }
  });
  window.addEventListener('resize', fitCanvas);

  function restart() {
    // 沿用当前模式与难度，重新随机抽选地图
    game = new window.Game(gameOpts(true));
    window.__game = game;
    setupOpen = false;
    ui.selected = null; ui.pending = null; ui.selectedUnitId = null; ui.hoverUnitId = null;
    ui.overShown = false; ui.lastLogCount = -1;
    el.overlay.classList.add('hidden');
    el.helpModal.classList.add('hidden');
    el.setupModal.classList.add('hidden');
    el.hintBar.textContent = defaultHint(); el.hintBar.className = 'hint-bar';
    ui.noticeUntil = 0;
    buildCards(); renderDeployList(true); updateSituation(); updateDetail(); updateButtons(); updateLog();
    notice('已重新抽选地图：' + game.map.name + '（' + D.MODES[settings.mode].name + ' · ' +
      D.DIFFICULTIES[settings.difficulty].name + '）。', 'good');
  }

  /* ---------------- 主循环 ---------------- */
  var last = performance.now();
  function frame(now) {
    var dt = (now - last) / 1000;
    last = now;
    game.update(dt);
    renderer.draw(game, ui);
    updateHUD(now);
    consumeSfx();
    requestAnimationFrame(frame);
  }

  fitCanvas();
  requestAnimationFrame(fitCanvas);
  buildSetup(); renderSetup();
  buildCards();
  renderDeployList();
  updateSituation();
  updateDetail();
  updateButtons();
  updateLog();
  requestAnimationFrame(frame);
})();
