/* 战斗引擎：纯逻辑，不依赖 DOM / Canvas，可在 Node 中无头模拟。 */
(function (root) {
  'use strict';

  var D = root.DATA;
  var CFG = D.CFG, W = D.WORLD.w, H = D.WORLD.h;

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function angDiff(a, b) {
    var d = (a - b + Math.PI) % (Math.PI * 2);
    if (d < 0) d += Math.PI * 2;
    return d - Math.PI;
  }
  function pointInRect(x, y, rx, ry, rw, rh) {
    return x >= rx && x <= rx + rw && y >= ry && y <= ry + rh;
  }
  function segCircleHit(x1, y1, x2, y2, cx, cy, r) {
    var dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
    var t = l2 > 0 ? ((cx - x1) * dx + (cy - y1) * dy) / l2 : 0;
    t = clamp(t, 0, 1);
    var px = x1 + t * dx, py = y1 + t * dy;
    return (px - cx) * (px - cx) + (py - cy) * (py - cy) <= r * r;
  }
  // 线段与矩形是否相交（Liang-Barsky）
  function segRectHit(x1, y1, x2, y2, rx, ry, rw, rh) {
    var dx = x2 - x1, dy = y2 - y1, t0 = 0, t1 = 1;
    var p = [-dx, dx, -dy, dy];
    var q = [x1 - rx, rx + rw - x1, y1 - ry, ry + rh - y1];
    for (var i = 0; i < 4; i++) {
      if (p[i] === 0) { if (q[i] < 0) return false; continue; }
      var r = q[i] / p[i];
      if (p[i] < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
      else { if (r < t0) return false; if (r < t1) t1 = r; }
    }
    return t0 <= t1;
  }
  // 生成不规则草丛 / 树林轮廓：极坐标半径随机 + 邻域平滑 + 整体大小扰动
  function makeBlob(rng, r) {
    var n = 11 + Math.floor(rng() * 6), raw = [], sm = [], pts = [], i;
    for (i = 0; i < n; i++) raw.push(0.56 + rng() * 0.82);
    // 轻度平滑，保留明显凹凸与大小差异
    for (i = 0; i < n; i++) sm.push((raw[(i - 1 + n) % n] * 0.7 + raw[i] * 2 + raw[(i + 1) % n] * 0.7) / 3.4);
    var scale = 0.82 + rng() * 0.38, phase = rng() * Math.PI * 2, maxR = 0;
    for (i = 0; i < n; i++) {
      var a = phase + i / n * Math.PI * 2, rr = r * scale * sm[i];
      if (rr > maxR) maxR = rr;
      pts.push({ a: a, r: rr, x: Math.cos(a) * rr, y: Math.sin(a) * rr });
    }
    return { pts: pts, maxR: maxR, r: r };
  }

  // 扫描类 / 广域视野 / 狙击镜单位不做环视摆动，视野始终朝行进方向
  var PATROL_EXEMPT = { bot: 1, scout: 1, sniper: 1, defector: 1, skeleton: 1 };
  var PASSIVE = { necro: 1, defector: 1 };

  function Game(opts) {
    this.reset(opts || {});
  }

  Game.prototype.rand = function (a, b) { return a + (b - a) * this.rng(); };

  Game.prototype.reset = function (opts) {
    this.seed = (opts.seed !== undefined ? opts.seed : (Date.now() >>> 0));
    this.rng = mulberry32(this.seed);
    this.mapIndex = (opts.mapIndex !== undefined ? opts.mapIndex : Math.floor(this.rng() * D.MAPS.length)) % D.MAPS.length;
    this.map = D.MAPS[this.mapIndex];
    this.mode = D.MODES[opts.mode] ? opts.mode : 'classic';
    this.difficulty = D.DIFFICULTIES[opts.difficulty] ? opts.difficulty : 'normal';
    this.diffCfg = D.DIFFICULTIES[this.difficulty];
    this.modeCfg = D.MODES[this.mode];

    this.phase = 'deploy';
    this.timeLimit = CFG.timeLimit;
    this.timeLeft = CFG.timeLimit;
    this.elapsed = 0;
    this.energy = CFG.energyStart;
    this.paused = false;
    this.speedFactor = 1;

    this.nextId = 1;
    this.units = [];
    this.terrains = [];
    this.bridges = [];
    this.pickups = [];
    this.fires = [];
    this.gas = [];
    this.projectiles = [];
    this.effects = [];
    this.intel = {};
    this.corpses = [];
    this.events = [];
    this.sfx = [];
    this.pendingRearm = [];

    this.kills = 0;
    this.deaths = 0;
    this.necroUsed = false;
    this.defectors = 0;
    this.defectorGranted = false;
    this.overdriveT = 0;
    this.graveTimer = CFG.graveInterval;
    this.visTick = 0;

    // 模式状态
    this.civilianTotal = 0;
    this.civilianLost = 0;
    this.turnedCount = 0;
    this.infectedCount = 0;
    this.vampireWaveT = CFG.vampireWaveInterval;
    this.vampireBossDead = false;
    this.revealedEnemyIds = new Set();

    this.initMap();
    this.initialEnemyCount = this.units.filter(function (u) { return u.team === 'enemy'; }).length;
    this.emit('info', '【' + this.modeCfg.name + ' · ' + this.diffCfg.name + '】地图抽选：' +
      this.map.name + ' — ' + this.map.subtitle + '。请先规划单位与路线。');
    if (this.difficulty === 'hard') {
      this.emit('warn', '困难难度：敌方血量 ×2、攻速 +18%；建筑与墙体阻挡视线，躲在障碍后的敌人需要绕到近前才能发现（显示为半透明灰色轮廓）。');
    }
    if (this.mode === 'infection') {
      this.emit('warn', '丧尸感染：己方单兵累计受伤达 ' + CFG.infectionThreshold +
        ' 点即被感染，攻速降低，' + CFG.infectionTurn + ' 秒后转为敌方；医疗包可治愈。');
    }
    if (this.mode === 'vampire') {
      this.emit('warn', '吸血鬼之夜：保护左侧 ' + this.civilianTotal +
        ' 名平民，撑到日出（' + this.timeLimit + ' 秒）即获胜；平民阵亡超过一半则失败，吸血鬼领主攻击会回血。');
    }
    return this;
  };

  Game.prototype.initMap = function () {
    var self = this;
    this.map.terrains.forEach(function (t, i) {
      var q = {
        id: 't' + i, type: t.type, x: t.x, y: t.y, w: t.w || 0, h: t.h || 0,
        r: t.r || 0, maxR: t.r || 0, shape: null, alive: true, burning: 0, fireT: 0
      };
      if (t.type === 'grass' || t.type === 'forest') {
        var blob = makeBlob(self.rng, q.r);
        q.shape = blob.pts; q.maxR = blob.maxR;
      }
      if (q.w || q.h) { q.cx = q.x + q.w / 2; q.cy = q.y + q.h / 2; q.maxR = Math.hypot(q.w, q.h) / 2; }
      self.terrains.push(q);
    });
    this.initBridges();
    if (this.diffCfg.obstacles) this.initObstacles();

    if (this.mode === 'vampire') {
      this.initVampireScenario();
    } else {
      var hpScale = this.diffCfg.hpScale;
      this.map.enemies.forEach(function (e) {
        var x = clamp(e.x + self.rand(-12, 12), 30, W - 30);
        var y = clamp(e.y + self.rand(-12, 12), 30, H - 30);
        var u = self.spawnUnit(e.key, 'enemy', x, y,
          { homeX: e.x, homeY: e.y, angle: Math.PI, hpScale: hpScale });
        if (u) { u.patrolT = self.rand(0, 2); u.patrolX = e.x; u.patrolY = e.y; }
      });
      if (this.diffCfg.obstacles) {
        // 障碍后埋伏少量敌人：在己方单位绕到近前之前完全不可见
        var hiders = this.terrains.filter(function (t) { return t.type === 'building' || t.type === 'wall'; });
        for (var h = 0; h < Math.min(CFG.extraGuards, hiders.length); h++) {
          var o = hiders[h];
          var hx = clamp(o.x + o.w + 34 + self.rand(-6, 6), 30, W - 30);
          var hy = clamp(o.cy + self.rand(-14, 14), 30, H - 30);
          var amb = self.spawnUnit(h % 2 ? 'brute' : 'marksman', 'enemy', hx, hy,
            { homeX: hx, homeY: hy, angle: Math.PI, hpScale: hpScale });
          if (amb) { amb.patrolT = self.rand(0, 2); amb.patrolX = hx; amb.patrolY = hy; }
        }
      }
    }
    this.map.pickups.forEach(function (p) {
      self.pickups.push({
        id: 'p' + self.nextId++, type: p.type,
        x: clamp(p.x + self.rand(-9, 9), 25, W - 25),
        y: clamp(p.y + self.rand(-9, 9), 25, H - 25),
        taken: false
      });
    });
  };

  /* 困难难度：生成阻挡移动与视线的建筑 / 墙体，并让敌人躲在其东侧 */
  Game.prototype.initObstacles = function () {
    var self = this, made = 0, guard = 0;
    while (made < CFG.obstacleCount && guard++ < 300) {
      var building = made % 3 === 0;
      var w = building ? 84 + this.rand(0, 22) : (this.rng() < 0.5 ? 18 : 96 + this.rand(0, 34));
      var h = building ? 66 + this.rand(0, 18) : (w === 18 ? 96 + this.rand(0, 40) : 18);
      var x = 300 + this.rand(0, 620), y = 60 + this.rand(0, 520);
      var rect = { x: x, y: y, w: w, h: h };
      var bad = false;
      // 避开河流（含桥面）、部署带与已有障碍
      if (x < CFG.deployZone + 70 || x + w > W - 40 || y + h > H - 40) bad = true;
      for (var i = 0; i < this.terrains.length && !bad; i++) {
        var t = this.terrains[i];
        if (t.type === 'river' || t.type === 'grave') {
          if (rectOverlap(x - 18, y - 18, w + 36, h + 36, t.x, t.y, t.w || 90, t.h || 90)) bad = true;
        } else if (t.type === 'building' || t.type === 'wall') {
          if (rectOverlap(x - 60, y - 40, w + 120, h + 80, t.x, t.y, t.w, t.h)) bad = true;
        }
      }
      for (var b = 0; b < this.bridges.length && !bad; b++) {
        var br = this.bridges[b];
        if (rectOverlap(x - 15, y - 15, w + 30, h + 30, br.x, br.y, br.w, br.h)) bad = true;
      }
      // 不要把障碍压在预设敌怪或道具身上（否则单位会卡在实心块里）
      for (var m = 0; m < this.map.enemies.length && !bad; m++) {
        var me = this.map.enemies[m];
        if (rectOverlap(x - 20, y - 20, w + 40, h + 40, me.x - 14, me.y - 14, 28, 28)) bad = true;
      }
      for (var pk = 0; pk < this.map.pickups.length && !bad; pk++) {
        var mp = this.map.pickups[pk];
        if (rectOverlap(x - 14, y - 14, w + 28, h + 28, mp.x - 12, mp.y - 12, 24, 24)) bad = true;
      }
      if (bad) continue;
      var q = {
        id: 'ob' + made, type: building ? 'building' : 'wall',
        x: x, y: y, w: w, h: h, r: 0, cx: x + w / 2, cy: y + h / 2,
        maxR: Math.hypot(w, h) / 2, shape: null, alive: true, burning: 0, fireT: 0, solid: true,
        structHp: building ? CFG.buildingHp : CFG.wallHp,
        maxStruct: building ? CFG.buildingHp : CFG.wallHp
      };
      this.terrains.push(q);
      made++;
    }
    if (made) this.emit('info', '困难难度：战场上出现 ' + made + ' 处建筑与墙体，遮挡地面通行与视线。');
  };
  function rectOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  /* 吸血鬼之夜：左侧平民 + 右→左推进的血仆与领主 */
  Game.prototype.initVampireScenario = function () {
    var self = this, hpScale = this.diffCfg.hpScale;
    this.civilianTotal = CFG.civilianCount;
    for (var i = 0; i < CFG.civilianCount; i++) {
      var cx = 46 + (i % 3) * 46 + this.rand(-6, 6);
      var cy = 78 + i * 74 + this.rand(-12, 12);
      var civ = this.spawnUnit('civilian', 'civilian', cx, clamp(cy, 30, H - 30),
        { angle: 0, state: 'hold', route: [] });
      if (civ) { civ.homeX = civ.x; civ.homeY = civ.y; }
    }
    var boss = this.spawnUnit('vampire', 'enemy', 1080, 350,
      { angle: Math.PI, hpScale: hpScale, route: this.advanceRoute(1080, 350) });
    if (boss) { boss.advance = true; boss.homeX = 1080; boss.homeY = 350; }
    for (var k = 0; k < CFG.vampireThralls; k++) {
      var sx = 1120 - k * 24, sy = 150 + k * 190;
      var th = this.spawnUnit('thrall', 'enemy', sx, sy,
        { angle: Math.PI, hpScale: hpScale, route: this.advanceRoute(sx, sy) });
      if (th) { th.advance = true; th.homeX = sx; th.homeY = sy; }
    }
  };
  // 自右向左的推进路线：先压到中场，再分头扑向左侧村镇
  Game.prototype.advanceRoute = function (sx, sy) {
    return [
      { x: 860, y: clamp(sy + this.rand(-40, 40), 40, H - 40) },
      { x: 600, y: clamp(sy + this.rand(-70, 70), 40, H - 40) },
      { x: 330, y: clamp(sy + this.rand(-80, 80), 40, H - 40) },
      { x: 120, y: clamp(sy + this.rand(-60, 60), 40, H - 40) }
    ];
  };
  Game.prototype.updateVampireWaves = function (dt) {
    this.vampireWaveT -= dt;
    if (this.vampireWaveT > 0) return;
    this.vampireWaveT = CFG.vampireWaveInterval;
    var alive = 0;
    for (var i = 0; i < this.units.length; i++) {
      if (this.units[i].alive && this.units[i].key === 'thrall') alive++;
    }
    if (alive >= CFG.vampireWaveCap) return;
    var sy = 90 + this.rand(0, H - 180), sx = W - 32;
    var th = this.spawnUnit('thrall', 'enemy', sx, sy,
      { angle: Math.PI, hpScale: this.diffCfg.hpScale, route: this.advanceRoute(sx, sy) });
    if (th) { th.advance = true; th.homeX = sx; th.homeY = sy; }
    this.effects.push({ type: 'text', x: sx - 30, y: sy, text: '血仆增援', t: 0, ttl: 1.2, color: '#8e3d6a' });
    this.emit('warn', '夜色更深，右侧出现新的血仆增援。');
  };

  Game.prototype.emit = function (type, text) {
    this.events.push({ t: this.elapsed, type: type, text: text });
    if (this.events.length > 60) this.events.shift();
  };

  /* ---------------- 桥梁 ---------------- */
  // 纵贯全场的河流（或从边界延伸过半的横向河流）自动生成桥梁。
  // 桥宽 76 = 两辆装甲车（半径 18）并排 + 少量间隙。
  Game.prototype.initBridges = function () {
    var self = this, bw = CFG.bridgeWidth, n = 0;
    this.terrains.forEach(function (t) {
      if (t.type !== 'river') return;
      var vertical = t.h > t.w;
      var spanning = vertical ? (t.h >= H * 0.85)
        : (t.w >= W * 0.55 && (t.x <= 2 || t.x + t.w >= W - 2));
      if (!spanning) return;
      var b = vertical
        ? { x: t.x - 12, y: H / 2 - bw / 2, w: t.w + 24, h: bw, vertical: true }
        : { x: t.x + t.w / 2 - bw / 2, y: t.y - 12, w: bw, h: t.h + 24, vertical: false };
      b.id = 'bridge' + (n++); b.riverId = t.id;
      b.alive = true; b.bodies = 0; b.slow = false; b.heat = 0; b.repairT = 0;
      self.bridges.push(b);
    });
    if (this.bridges.length) {
      this.emit('info', '河流横贯战场，已架设 ' + this.bridges.length + ' 座双车道桥梁供大体积单位渡河。');
    }
  };
  Game.prototype.bridgeAt = function (x, y) {
    for (var i = 0; i < this.bridges.length; i++) {
      var b = this.bridges[i];
      if (pointInRect(x, y, b.x, b.y, b.w, b.h)) return b;
    }
    return null;
  };
  Game.prototype.bridgeAllows = function (x, y) {
    var b = this.bridgeAt(x, y);
    return !!b && b.alive;
  };
  Game.prototype.updateBridges = function (dt) {
    for (var i = 0; i < this.bridges.length; i++) {
      var b = this.bridges[i];
      if (!b.alive) {
        b.repairT -= dt;
        if (b.repairT <= 0) {
          b.alive = true; b.bodies = 0; b.slow = false; b.heat = 0; b.repairT = 0;
          this.emit('good', '桥梁已自动修复，残骸清理完毕，桥上减速重置。');
          this.effects.push({ type: 'text', x: b.x + b.w / 2, y: b.y + b.h / 2 - 22, text: '桥梁修复', t: 0, ttl: 1.4, color: '#2f6f52' });
        }
      } else if (b.heat > 0) {
        b.heat = Math.max(0, b.heat - dt * 0.04);
      }
    }
  };
  Game.prototype.heatBridge = function (x, y, r, amount) {
    for (var i = 0; i < this.bridges.length; i++) {
      var b = this.bridges[i];
      if (!b.alive) continue;
      var cx = clamp(x, b.x, b.x + b.w), cy = clamp(y, b.y, b.y + b.h);
      if (Math.hypot(x - cx, y - cy) > r) continue;
      b.heat += amount;
      if (b.heat >= CFG.bridgeHeatLimit) {
        b.alive = false; b.repairT = CFG.bridgeRepair;
        this.emit('warn', '桥梁被燃烧爆炸损毁！大体积单位暂时无法渡河，约 ' + Math.round(CFG.bridgeRepair) + ' 秒后自动修复。');
        this.effects.push({ type: 'blast', x: b.x + b.w / 2, y: b.y + b.h / 2, r: 60, t: 0, ttl: 0.8, color: '#c9663c' });
        this.sfx.push('boom');
      }
    }
  };

  /* ---------------- 不规则地形判定 ---------------- */
  Game.prototype.radiusAt = function (t, angle) {
    var pts = t.shape;
    if (!pts || !pts.length) return t.r;
    var n = pts.length, TAU = Math.PI * 2;
    var x = ((angle - pts[0].a) % TAU + TAU) % TAU;
    var f = x / TAU * n, i = Math.floor(f), frac = f - i;
    return pts[i % n].r + (pts[(i + 1) % n].r - pts[i % n].r) * frac;
  };
  Game.prototype.terrainContains = function (t, x, y, pad) {
    var p = pad || 0;
    if (t.w && t.h) {
      return pointInRect(x, y, t.x - p, t.y - p, t.w + p * 2, t.h + p * 2);
    }
    var dx = x - t.x, dy = y - t.y, d = Math.hypot(dx, dy);
    if (d > t.maxR + 2 + p) return false;
    return d <= this.radiusAt(t, Math.atan2(dy, dx)) + p;
  };

  /* ---------------- 单位与部署 ---------------- */

  Game.prototype.costOf = function (key) {
    var d = D.UNIT_DEFS[key];
    return d ? d.cost : 0;
  };

  Game.prototype.spawnUnit = function (key, team, x, y, opts) {
    opts = opts || {};
    var def = D.UNIT_DEFS[key];
    if (!def) return null;
    var scale = opts.hpScale !== undefined ? opts.hpScale : 1;
    var u = {
      id: 'u' + this.nextId++, key: key, def: def, team: team,
      x: x, y: y, spawnX: x, spawnY: y,
      hp: def.hp * scale, maxHp: def.hp * scale,
      shield: def.shield ? 0 : 0, maxShield: def.shield || 0,
      radius: def.radius,
      angle: opts.angle !== undefined ? opts.angle : (team === 'player' ? this.rand(-Math.PI, Math.PI) : Math.PI),
      moveAngle: 0, sweepPhase: this.rand(0, Math.PI * 2),
      sightCenter: null, sightWidth: def.visionAngle,
      alertAngle: 0, alertT: 0, engaged: false, chaseT: 0,
      flameOn: false, flamePhase: 0,
      route: (opts.route || []).map(function (p) { return { x: p.x, y: p.y }; }),
      routeIndex: 0,
      alive: true, cd: this.rand(0, 0.25), arrived: false,
      state: opts.state || 'march', deployT: 0, packT: 0,
      ammo: def.ammo !== undefined ? def.ammo : null,
      missiles: def.missiles !== undefined ? def.missiles : null,
      missileCd: 0, fireT: 0, toxicT: 0,
      statuses: { slow: 0, stun: 0, poison: 0 },
      poisonDps: 0,
      visibleTargets: new Set(), seenByEnemy: false, hidden: false,
      wallHack: false, wallWatchId: null, wallWatchT: 0,
      scanTargetId: null, riverBlocked: false, auraHaste: false,
      undead: !!opts.undead, lifesteal: opts.lifesteal || def.lifesteal || 0,
      // 载具碾压 / 推挤
      attackers: {}, ramTargetId: null, ramDir: 1, ramT: 0, ramCd: 0, ramAnchor: null,
      // 感染 / 模式
      infectLoad: 0, infected: false, infectT: 0, turned: false, zombie: !!def.zombie,
      advance: false,
      // 吸血鬼领主：化蝠 / 重整状态机
      vstate: 'advance', batForm: false, batMode: null, batTarget: null,
      batCd: CFG.vampireBatCd, batWait: 0, reformT: 0, reformCount: 0,
      // 守巷：所在建筑地形 id
      garrisonId: null,
      homeX: opts.homeX !== undefined ? opts.homeX : x,
      homeY: opts.homeY !== undefined ? opts.homeY : y,
      patrolT: 0, patrolX: x, patrolY: y
    };
    u.moveAngle = u.angle;
    if (u.route.length) u.moveAngle = Math.atan2(u.route[0].y - y, u.route[0].x - x);
    this.units.push(u);
    return u;
  };

  Game.prototype.canOccupy = function (u, x, y) {
    var r = u.radius || 9;
    if (x < 12 + r || x > W - 12 - r || y < 12 + r || y > H - 12 - r) return false;
    var def = u.def || D.UNIT_DEFS[u.key];
    if (def.size === 'air') return true;
    for (var i = 0; i < this.terrains.length; i++) {
      var t = this.terrains[i];
      if (!t.alive) continue;
      // 建筑 / 墙体：阻挡所有地面单位，空中单位可越过
      if (t.solid && def.size !== 'air' &&
        pointInRect(x, y, t.x - r * 0.65, t.y - r * 0.65, t.w + r * 1.3, t.h + r * 1.3)) return false;
      if (t.type === 'forest' && def.size === 'heavy') {
        if (this.terrainContains(t, x, y, r * 0.55)) return false;
      }
      if (t.type === 'river' && def.size === 'heavy') {
        var ix = 16, iy = 16;
        var cw = Math.max(4, t.w - ix * 2), ch = Math.max(4, t.h - iy * 2);
        if (pointInRect(x, y, t.x + ix, t.y + iy, cw, ch) && !this.bridgeAllows(x, y)) return false;
      }
    }
    return true;
  };

  // 出发点强制限定在战场一侧；路点可自由规划。
  Game.prototype.canDeployAt = function (key, x, y) {
    var def = D.UNIT_DEFS[key];
    if (!def || def.cat !== 'unit') return { ok: false, msg: '该单位不可派遣' };
    // 降军只是标出情报阵亡点，不占用出发位，故不受部署带限制
    if (key === 'defector') return { ok: true };
    if (x - def.radius < 8 || x + def.radius > CFG.deployZone) {
      return { ok: false, msg: '只能从战场左侧部署带出发（横向 8~' + CFG.deployZone + '）' };
    }
    if (!this.canOccupy({ key: key, def: def, radius: def.radius }, x, y)) {
      return { ok: false, msg: '该单位无法部署在此地形（树林 / 深水 / 边界）' };
    }
    for (var i = 0; i < this.units.length; i++) {
      var v = this.units[i];
      if (!v.alive || v.team === 'player' || v.team === 'civilian') continue;
      if (Math.hypot(v.x - x, v.y - y) < 80) return { ok: false, msg: '距离敌方单位过近，无法派遣' };
    }
    return { ok: true };
  };
  Game.prototype.deploy = function (key, x, y, route) {
    if (this.phase !== 'deploy' && this.phase !== 'battle') return { ok: false, msg: '当前阶段无法派遣' };
    var def = D.UNIT_DEFS[key];
    if (!def || def.cat !== 'unit') return { ok: false, msg: '该单位不可派遣' };
    var cost = this.costOf(key);
    if (this.energy + 1e-6 < cost) return { ok: false, msg: '费用不足（需要 ' + cost + ' 费）' };
    if (key === 'necro' && this.necroUsed) return { ok: false, msg: '死灵法师每局仅能派遣一次' };
    if (key === 'defector' && this.defectors <= 0) return { ok: false, msg: '尚未获得降军' };
    var check = this.canDeployAt(key, x, y);
    if (!check.ok) return check;

    this.energy -= cost;
    if (key === 'necro') this.necroUsed = true;

    var place = { x: x, y: y };
    var finalRoute = (route || []).map(function (p) { return { x: p.x, y: p.y }; });
    if (key === 'defector') {
      this.defectors--;
      place = { x: clamp(x - 46, 20, W - 20), y: y };
      finalRoute = [{ x: x, y: y }];
      this.revealAround(x, y, 340, 10);
      this.effects.push({ type: 'reveal', x: x, y: y, r: 340, t: 0, ttl: 0.9 });
    }

    var angle = finalRoute.length
      ? Math.atan2(finalRoute[0].y - place.y, finalRoute[0].x - place.x) : undefined;
    // 单兵初始朝向带随机扰动，避免整队齐刷刷朝右；开战后转入行进环视
    if (angle !== undefined && def.size === 'soldier' && !PATROL_EXEMPT[key]) {
      angle += this.rand(-0.55, 0.55);
    }
    var u = this.spawnUnit(key, 'player', place.x, place.y, { route: finalRoute, angle: angle });
    this.effects.push({ type: 'blast', x: place.x, y: place.y, r: 22, t: 0, ttl: 0.4, color: '#7aa8e0' });
    this.emit('deploy', '派遣 ' + def.name + '（' + cost + ' 费）' + (finalRoute.length ? '，路线 ' + finalRoute.length + ' 个节点' : '，原地驻守') + '。');
    this.sfx.push('deploy');
    return { ok: true, unit: u };
  };

  // 对局进行中，已抵达路线终点的己方单位可重新划定路线（守巷中的单位需先撤出建筑）
  Game.prototype.setRoute = function (id, route) {
    if (this.phase !== 'battle') return { ok: false, msg: '仅可在对局进行中重划路线' };
    var u = null;
    for (var i = 0; i < this.units.length; i++) {
      if (this.units[i].id === id) { u = this.units[i]; break; }
    }
    if (!u || !u.alive || u.team !== 'player') return { ok: false, msg: '未找到该己方单位' };
    if (u.key === 'jet' && u.state === 'idle') return { ok: false, msg: '战斗机需先补充导弹才能重新出击' };
    if (u.garrisonId) return { ok: false, msg: '该单位正在建筑中守巷，请先在详情面板「撤出建筑」' };
    if (!u.arrived) return { ok: false, msg: '该单位尚未抵达路线终点' };
    u.route = (route || []).map(function (p) { return { x: p.x, y: p.y }; });
    u.routeIndex = 0; u.arrived = false; u.state = 'march';
    u.engaged = false; u.chaseT = 0; u.deployT = 0; u.packT = 0;
    this.effects.push({ type: 'text', x: u.x, y: u.y - 22, text: '新路线', t: 0, ttl: 1.0, color: '#d79a2d' });
    this.emit('info', u.def.name + ' 接受新路线（' + u.route.length + ' 个节点），重新出发。');
    return { ok: true, unit: u };
  };

  Game.prototype.removeDeployed = function (id) {
    if (this.phase !== 'deploy') return false;
    var u = null;
    for (var i = 0; i < this.units.length; i++) {
      if (this.units[i].id === id && this.units[i].team === 'player') { u = this.units[i]; break; }
    }
    if (!u) return false;
    u.alive = false;
    this.energy = Math.min(CFG.energyCap, this.energy + this.costOf(u.key));
    if (u.key === 'necro') this.necroUsed = false;
    if (u.key === 'defector') this.defectors++;
    this.cleanup();
    return true;
  };

  Game.prototype.startBattle = function () {
    if (this.phase !== 'deploy') return;
    this.phase = 'battle';
    this.computeVisibility();
    var goal = this.mode === 'vampire'
      ? '守住左侧 ' + this.civilianTotal + ' 名平民，撑到 ' + this.timeLimit + ' 秒日出即获胜；平民阵亡过半则失败。'
      : '限时 ' + this.timeLimit + ' 秒，清除全部敌方单位即可通关。';
    this.emit('info', '【' + this.modeCfg.name + ' · ' + this.diffCfg.name + '】对局开始。' + goal);
    this.sfx.push('deploy');
  };

  Game.prototype.useSkill = function (key, x, y) {
    if (this.phase !== 'battle') return { ok: false, msg: '战术仅可在对局进行中使用' };
    var s = D.SKILLS[key];
    if (!s) return { ok: false, msg: '未知战术' };
    if (this.energy + 1e-6 < s.cost) return { ok: false, msg: '费用不足（需要 ' + s.cost + ' 费）' };
    var targetId = null;
    if (key === 'meteor') {
      var best = null, bd = 52;
      for (var i = 0; i < this.units.length; i++) {
        var v = this.units[i];
        if (!v.alive || v.team !== 'enemy') continue;
        var d = Math.hypot(v.x - x, v.y - y);
        if (d < bd) { bd = d; best = v; }
      }
      if (!best) return { ok: false, msg: '需点选一个敌方单位作为陨石目标' };
      targetId = best.id;
      x = best.x; y = best.y;
    }
    this.energy -= s.cost;
    if (key === 'strike') {
      this.effects.push({ type: 'strike', x: x, y: y, r: 130, t: 0, delay: 1.1, ttl: 1.9, done: false });
    } else {
      this.effects.push({ type: 'meteor', x: x, y: y, targetId: targetId, t: 0, delay: 0.9, ttl: 1.8, done: false });
    }
    this.emit('skill', '发动 ' + s.name + '（' + s.cost + ' 费）。');
    this.sfx.push('deploy');
    return { ok: true };
  };

  Game.prototype.rearmJet = function (id) {
    var u = null;
    for (var i = 0; i < this.units.length; i++) if (this.units[i].id === id) { u = this.units[i]; break; }
    if (!u || u.key !== 'jet' || u.state !== 'idle') return { ok: false, msg: '战斗机不在出发点待命' };
    if (this.energy + 1e-6 < 2) return { ok: false, msg: '费用不足（需要 2.0 费）' };
    this.energy -= 2;
    u.missiles = 4; u.missileCd = 0; u.state = 'march'; u.routeIndex = 0;
    u.x = u.spawnX; u.y = u.spawnY;
    this.pendingRearm = this.pendingRearm.filter(function (v) { return v !== id; });
    this.emit('info', '战斗机补充 4 枚导弹，重新出击。');
    return { ok: true };
  };

  /* ---------------- 建筑 / 墙体：结构强度与守巷 ---------------- */

  // 爆炸对建筑 / 墙体造成结构伤害；结构归零即被摧毁
  Game.prototype.damageStructures = function (x, y, r, dmg) {
    for (var i = 0; i < this.terrains.length; i++) {
      var t = this.terrains[i];
      if (!t.alive || !t.solid || !t.structHp) continue;
      // 圆形冲击与矩形结构的最近点距离
      var nx = clamp(x, t.x, t.x + t.w), ny = clamp(y, t.y, t.y + t.h);
      if (Math.hypot(x - nx, y - ny) > r) continue;
      t.structHp -= dmg;
      this.effects.push({ type: 'spark', x: nx, y: ny, t: 0, ttl: 0.25, color: '#c9b08a' });
      if (t.structHp <= 0) this.destroyTerrain(t);
      else if (t.structHp < t.maxStruct * 0.99) {
        this.emit('info', D.TERRAIN_INFO[t.type].name + '受到结构损伤（剩余 ' +
          Math.max(0, Math.round(t.structHp)) + ' / ' + t.maxStruct + '）。');
      }
    }
  };
  Game.prototype.destroyTerrain = function (t) {
    t.alive = false;
    this.effects.push({ type: 'blast', x: t.cx, y: t.cy, r: t.maxR + 10, t: 0, ttl: 0.8, color: '#c9a06a' });
    this.sfx.push('boom');
    // 建筑被摧毁时：内部守巷单兵直接阵亡
    var inside = this.units.filter(function (u) { return u.alive && u.garrisonId === t.id; });
    for (var i = 0; i < inside.length; i++) {
      inside[i].garrisonId = null;
      this.kill(inside[i], 'collapse', null);
    }
    if (inside.length) {
      this.emit('warn', D.TERRAIN_INFO[t.type].name + '被炸毁，内部 ' + inside.length + ' 名守巷单兵随建筑倒塌阵亡！');
    } else {
      this.emit('good', D.TERRAIN_INFO[t.type].name + '被炸毁，掩体消失。');
    }
  };
  Game.prototype.countGarrison = function (t) {
    var n = 0;
    for (var i = 0; i < this.units.length; i++) {
      if (this.units[i].alive && this.units[i].garrisonId === t.id) n++;
    }
    return n;
  };
  // 附近可守巷的建筑（存活、有结构、距离在允许范围内）
  Game.prototype.nearestGarrisonable = function (u) {
    if (!u || !u.alive || u.team !== 'player' || u.def.size !== 'soldier') return null;
    var best = null, bd = CFG.garrisonRange;
    for (var i = 0; i < this.terrains.length; i++) {
      var t = this.terrains[i];
      if (!t.alive || t.type !== 'building') continue;
      var nx = clamp(u.x, t.x, t.x + t.w), ny = clamp(u.y, t.y, t.y + t.h);
      var d = Math.hypot(u.x - nx, u.y - ny);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  };
  // 单兵进入建筑守巷：低额减伤、视野与攻击范围提升、不被所在建筑遮挡、不可移动
  Game.prototype.garrison = function (unitId, terrainId) {
    var u = null, t = null, i;
    for (i = 0; i < this.units.length; i++) if (this.units[i].id === unitId) { u = this.units[i]; break; }
    for (i = 0; i < this.terrains.length; i++) if (this.terrains[i].id === terrainId) { t = this.terrains[i]; break; }
    if (!u || !u.alive || u.team !== 'player' || u.def.size !== 'soldier') {
      return { ok: false, msg: '只有己方单兵可以守巷' };
    }
    if (u.garrisonId) return { ok: false, msg: '该单位已在建筑中守巷' };
    if (!t || !t.alive || t.type !== 'building') return { ok: false, msg: '目标不是可进入的建筑' };
    var nx = clamp(u.x, t.x, t.x + t.w), ny = clamp(u.y, t.y, t.y + t.h);
    if (Math.hypot(u.x - nx, u.y - ny) > CFG.garrisonRange) {
      return { ok: false, msg: '距离建筑太远（需在 ' + CFG.garrisonRange + ' 距离内）' };
    }
    u.garrisonId = t.id;
    u.x = t.cx + this.rand(-t.w * 0.18, t.w * 0.18);
    u.y = t.cy + this.rand(-t.h * 0.18, t.h * 0.18);
    u.route = []; u.routeIndex = 0; u.arrived = true; u.state = 'garrison';
    u.engaged = false; u.chaseT = 0;
    this.effects.push({ type: 'text', x: u.x, y: u.y - 22, text: '守巷', t: 0, ttl: 1.1, color: '#8a6a3c' });
    this.emit('info', u.def.name + '进入建筑守巷：+25% 减伤、视野与攻击范围 +35%，但无法移动；建筑被摧毁时将阵亡。');
    this.sfx.push('deploy');
    return { ok: true, terrain: t };
  };
  // 撤出建筑：从最近的边缘离开，恢复自由行动
  Game.prototype.ungarrison = function (unitId) {
    var u = null, i;
    for (i = 0; i < this.units.length; i++) if (this.units[i].id === unitId) { u = this.units[i]; break; }
    if (!u || !u.alive || !u.garrisonId) return { ok: false, msg: '该单位不在建筑中' };
    var t = null;
    for (i = 0; i < this.terrains.length; i++) if (this.terrains[i].id === u.garrisonId) { t = this.terrains[i]; break; }
    u.garrisonId = null;
    if (t && t.alive) {
      // 从距离出发点较近的一侧长边离开
      var ex = u.spawnX < t.x ? t.x - u.radius - 6 : t.x + t.w + u.radius + 6;
      var ey = clamp(u.y, t.y + u.radius + 4, t.y + t.h - u.radius - 4);
      if (this.canOccupy(u, ex, ey)) { u.x = ex; u.y = ey; }
      else { u.x = t.cx; u.y = clamp(t.y - u.radius - 8, 20, H - 20); }
    }
    u.state = 'march'; u.arrived = true; u.route = []; u.routeIndex = 0;
    this.effects.push({ type: 'text', x: u.x, y: u.y - 22, text: '撤出建筑', t: 0, ttl: 1.1, color: '#8a6a3c' });
    this.emit('info', u.def.name + '撤出建筑，恢复自由行动（已抵达终点，可重划路线）。');
    return { ok: true, unit: u };
  };

  /* ---------------- 地形 / 视野 ---------------- */

  Game.prototype.grassAt = function (x, y) {
    for (var i = 0; i < this.terrains.length; i++) {
      var t = this.terrains[i];
      if (t.alive && t.type === 'grass' && t.burning <= 0 && this.terrainContains(t, x, y)) return t;
    }
    return null;
  };
  Game.prototype.inRiver = function (x, y) {
    for (var i = 0; i < this.terrains.length; i++) {
      var t = this.terrains[i];
      if (t.alive && t.type === 'river' && pointInRect(x, y, t.x, t.y, t.w, t.h)) return t;
    }
    return null;
  };
  Game.prototype.lineBlocked = function (x1, y1, x2, y2, skipId) {
    for (var i = 0; i < this.terrains.length; i++) {
      var t = this.terrains[i];
      if (!t.alive || t.id === skipId) continue;
      if (t.solid) {
        // 建筑 / 墙体：完全遮挡视线（空中单位同样被遮挡）
        if (segRectHit(x1, y1, x2, y2, t.x, t.y, t.w, t.h)) return t;
        continue;
      }
      if (t.type !== 'forest') continue;
      if (!segCircleHit(x1, y1, x2, y2, t.x, t.y, t.maxR + 2)) continue;
      var dx = x2 - x1, dy = y2 - y1;
      var steps = Math.max(2, Math.ceil(Math.hypot(dx, dy) / 11));
      for (var s = 1; s < steps; s++) {
        var f = s / steps;
        if (this.terrainContains(t, x1 + dx * f, y1 + dy * f)) return t;
      }
    }
    return null;
  };
  // 侦察兵注视的「墙」：树林、建筑与墙体均可看透
  Game.prototype.forestAhead = function (u) {
    var best = null, bd = 1e9;
    var ca = Math.cos(u.angle), sa = Math.sin(u.angle);
    for (var i = 0; i < this.terrains.length; i++) {
      var t = this.terrains[i];
      if (!t.alive || (t.type !== 'forest' && !t.solid)) continue;
      var tx = t.cx !== undefined ? t.cx : t.x, ty = t.cy !== undefined ? t.cy : t.y;
      var dx = tx - u.x, dy = ty - u.y;
      var proj = dx * ca + dy * sa;
      if (proj < 0 || proj > u.def.vision) continue;
      var perp = Math.abs(-dx * sa + dy * ca);
      if (perp > t.maxR + 18) continue;
      if (proj < bd) { bd = proj; best = t; }
    }
    return best ? { terrain: best, dist: bd } : null;
  };
  // 平民只与敌方互为敌对（其余阵营永不伤害平民）；中立骷髅也不会攻击平民
  Game.prototype.isHostile = function (a, b) {
    if (a.team === 'civilian' || b.team === 'civilian') {
      return a.team !== b.team && (a.team === 'enemy' || b.team === 'enemy');
    }
    return a.team !== b.team;
  };
  // 该单位能否攻击目标（部分单位不能对空：丧尸等近战摸不到飞机）
  Game.prototype.canHit = function (u, v) {
    if (v.def.size === 'air' && u.def.antiAir === false) return false;
    return true;
  };
  Game.prototype.hasIntel = function (id) {
    var e = this.intel[id];
    return !!e && e.until > this.elapsed;
  };
  Game.prototype.addIntel = function (id, x, y, dur) {
    this.intel[id] = { x: x, y: y, until: this.elapsed + dur };
  };
  Game.prototype.revealAround = function (x, y, r, dur) {
    for (var i = 0; i < this.units.length; i++) {
      var v = this.units[i];
      if (v.alive && (v.team === 'enemy' || v.team === 'neutral') &&
        Math.hypot(v.x - x, v.y - y) <= r) {
        this.addIntel(v.id, v.x, v.y, dur);
      }
    }
  };
  // 困难难度：敌方单位只有在被己方单位真正看见、被情报通报、
  // 位于左侧部署区内（部署区内一切单位对玩家显形）、或处于化蝠飞行时才可见
  Game.prototype.isKnown = function (u) {
    if (this.difficulty !== 'hard') return true;
    if (u.team !== 'enemy' && u.team !== 'neutral') return true;
    if (u.batForm) return true;
    if (u.x <= CFG.deployZone + 12) return true;
    if (this.hasIntel(u.id)) return true;
    return this.revealedEnemyIds.has(u.id);
  };
  Game.prototype.visible = function (a, b) {
    var dx = b.x - a.x, dy = b.y - a.y;
    var d = Math.hypot(dx, dy);
    if (d > this.effVision(a)) return false;
    if (b.key === 'heli' && d <= 260 && a.team !== 'player') return true;
    // 视野扇形中心 = 单位朝向 u.angle（由 resolveFacing 决定：移动时朝移动方向）
    var center = a.sightCenter === null || a.sightCenter === undefined ? a.angle : a.sightCenter;
    var va = a.sightWidth === undefined ? a.def.visionAngle : a.sightWidth;
    if (va > 0 && Math.abs(angDiff(Math.atan2(dy, dx), center)) > va / 2) return false;
    if (b.hidden) {
      var gb = this.grassAt(b.x, b.y), ga = this.grassAt(a.x, a.y);
      if (!gb || !ga || gb.id !== ga.id) return false;
    }
    // 守巷单位不被所在建筑遮挡（双向：自己看出去 / 敌人看到它）
    var skip = null;
    if (a.garrisonId) skip = a.garrisonId;
    else if (b.garrisonId) skip = b.garrisonId;
    if (!a.wallHack && this.lineBlocked(a.x, a.y, b.x, b.y, skip)) return false;
    return true;
  };
  Game.prototype.computeVisibility = function () {
    var alive = this.units.filter(function (u) { return u.alive; });
    var i, j;
    // 困难难度：视野扇形不再锁定朝东，与普通难度一致跟随单位朝向
    // —— 移动时以移动方向为中线（巡视单兵以其为轴左右环视），站定后保持最后朝向
    for (i = 0; i < alive.length; i++) {
      var u = alive[i];
      u.visibleTargets = new Set();
      u.seenByEnemy = false;
      u.hidden = (u.def.size === 'soldier' && !!this.grassAt(u.x, u.y));
      u.sightCenter = null;
      u.sightWidth = u.def.visionAngle;
    }
    for (i = 0; i < alive.length; i++) {
      for (j = 0; j < alive.length; j++) {
        var a = alive[i], b = alive[j];
        if (a === b || !this.isHostile(a, b)) continue;
        if (this.visible(a, b)) { a.visibleTargets.add(b.id); b.seenByEnemy = true; }
      }
    }
    this.revealedEnemyIds = new Set();
    for (i = 0; i < alive.length; i++) {
      var p = alive[i];
      if (p.team !== 'player') continue;
      p.visibleTargets.forEach(function (id) { this.revealedEnemyIds.add(id); }, this);
    }
    // 「己方单位到来之前不可见」：一旦有己方单位绕到障碍近前，藏在其后的敌人立即暴露
    if (this.diffCfg.directionalVision) {
      for (i = 0; i < alive.length; i++) {
        var e = alive[i];
        if (e.team !== 'enemy') continue;
        var arrived = false;
        for (j = 0; j < alive.length; j++) {
          var q = alive[j];
          if (q.team === 'player' && Math.hypot(q.x - e.x, q.y - e.y) <= 96) { arrived = true; break; }
        }
        if (!arrived) continue;
        this.revealedEnemyIds.add(e.id);
        for (j = 0; j < alive.length; j++) {
          var w = alive[j];
          if (w.team === 'player' && Math.hypot(w.x - e.x, w.y - e.y) <= 136) w.visibleTargets.add(e.id);
        }
      }
    }
  };

  /* ---------------- 伤害 / 死亡 ---------------- */

  Game.prototype.applyDamage = function (t, amount, info) {
    if (!t || !t.alive || amount <= 0) return 0;
    info = info || {};
    // 化蝠期间：受伤增加且受击减速（反制窗口）
    if (t.batForm && t.key === 'vampire' && t.team === 'enemy') {
      amount *= CFG.vampireBatVuln;
      if (info.source && info.source.alive && !info.dot) {
        t.statuses.slow = Math.max(t.statuses.slow, CFG.vampireBatSlow);
      }
    }
    // 遭受攻击：视野快速转向攻击来源并保持 1 秒。是否能看见对方由视野判定决定，
    // 看不见（距离不足 / 被遮挡）时不会停下交战，仍继续前进。
    if (info.source && info.source.alive && info.source !== t && !info.dot) {
      var sd = Math.hypot(info.source.x - t.x, info.source.y - t.y);
      if (t.team === 'player' && sd <= this.effVision(t)) {
        t.alertAngle = Math.atan2(info.source.y - t.y, info.source.x - t.x);
        t.alertT = CFG.alertHold;
      }
      // 记录「非友方攻击者」，供装甲车判断是否需要停下（不止一名才停）
      if (this.isHostile(t, info.source)) t.attackers[info.source.id] = this.elapsed;
    }
    var armor = info.ignoreArmor ? 0 : (info.dot ? this.effArmor(t) * 0.5 : this.effArmor(t));
    var dmg = amount * (1 - armor);
    if (t.shield > 0) {
      var s = Math.min(t.shield, dmg);
      t.shield -= s; dmg -= s;
    }
    t.hp -= dmg;
    if (info.source && info.source.alive && info.source.lifesteal > 0 && dmg > 0) {
      info.source.hp = Math.min(info.source.maxHp, info.source.hp + dmg * info.source.lifesteal);
      if (info.source.key === 'vampire') {
        this.effects.push({ type: 'text', x: info.source.x, y: info.source.y - 28,
          text: '吸血 +' + Math.round(dmg), t: 0, ttl: 0.7, color: '#a23d76' });
      }
    }
    // 丧尸感染：己方单兵累计有效受伤达阈值即进入感染倒计时
    if (this.mode === 'infection' && t.team === 'player' && dmg > 0 &&
      t.def.size === 'soldier' && !t.infected && !t.turned) {
      t.infectLoad += dmg * (info.dot ? 0.5 : 1);
      if (info.source && info.source.zombie) t.infectLoad += CFG.zombieInfectBonus;
      if (t.infectLoad >= CFG.infectionThreshold) this.infect(t);
    }
    if (t.hp <= 0) {
      // 吸血鬼领主血量被打空：化蝠期间 → 蝠群溃散被彻底消灭；否则退往右侧重整
      if (this.mode === 'vampire' && t.key === 'vampire' && t.team === 'enemy') {
        if (t.batForm) {
          this.kill(t, info.cause || 'hit', info.source);
        } else {
          this.breakVampire(t);
        }
        return dmg;
      }
      this.kill(t, info.cause || 'hit', info.source);
    }
    return dmg;
  };
  Game.prototype.damageAOE = function (x, y, r, dmg, team, opts) {
    opts = opts || {};
    var src = { team: team };
    for (var i = 0; i < this.units.length; i++) {
      var u = this.units[i];
      if (!u.alive) continue;
      // 平民只能被推进到部署区的敌方攻击击败，其余来源（含坠毁等无差别伤害）一律豁免
      if (u.team === 'civilian') continue;
      if (!opts.any && !this.isHostile(src, u)) continue;
      if (Math.hypot(u.x - x, u.y - y) > r + u.radius * 0.5) continue;
      this.applyDamage(u, dmg, { cause: opts.cause || 'aoe' });
    }
  };
  Game.prototype.infect = function (u) {
    u.infected = true; u.infectT = CFG.infectionTurn;
    this.infectedCount++;
    this.effects.push({ type: 'text', x: u.x, y: u.y - 24, text: '感染！', t: 0, ttl: 1.1, color: '#6c9238' });
    this.emit('warn', u.def.name + ' 被感染：攻速降低，' + CFG.infectionTurn + ' 秒后将转为敌方！用医疗包可治愈。');
  };
  Game.prototype.turnZombie = function (u) {
    if (!u.alive || u.turned) return;
    var hpFrac = Math.max(0.35, u.hp / u.maxHp);
    u.team = 'enemy';
    u.key = 'zombie';
    u.def = D.UNIT_DEFS.zombie;
    u.advance = true;
    u.maxHp = u.def.hp; u.hp = Math.min(u.maxHp, u.maxHp * hpFrac);
    u.radius = u.def.radius;
    u.route = []; u.routeIndex = 0; u.arrived = false; u.state = 'march';
    u.angle = Math.PI; u.moveAngle = Math.PI; u.sightCenter = null; u.sightWidth = u.def.visionAngle;
    u.infected = false; u.infectT = 0; u.infectLoad = 0; u.turned = true; u.zombie = true;
    u.engaged = false; u.chaseT = 0; u.cd = 0; u.lifesteal = 0;
    u.homeX = u.x; u.homeY = u.y; u.patrolT = 0;
    u.visibleTargets = new Set(); u.seenByEnemy = false;
    this.turnedCount++;
    this.infectedCount = Math.max(0, this.infectedCount - 1);
    this.effects.push({ type: 'blast', x: u.x, y: u.y, r: 28, t: 0, ttl: 0.6, color: '#8ab254' });
    this.effects.push({ type: 'text', x: u.x, y: u.y - 26, text: '倒戈', t: 0, ttl: 1.2, color: '#5c8a34' });
    this.emit('warn', '一名己方单兵已转化为感染体，开始攻击原队友！');
    this.sfx.push('boom');
  };
  // 吸血鬼领主未被骚扰时击杀的单兵 → 就地转化为敌方血仆
  Game.prototype.turnThrall = function (u) {
    var def = D.UNIT_DEFS.thrall;
    u.team = 'enemy';
    u.key = 'thrall';
    u.def = def;
    u.advance = true;
    u.maxHp = def.hp; u.hp = Math.round(def.hp * 0.65);
    u.radius = def.radius;
    u.route = []; u.routeIndex = 0; u.arrived = false; u.state = 'march';
    u.angle = Math.PI; u.moveAngle = Math.PI;
    u.sightCenter = null; u.sightWidth = def.visionAngle;
    u.infected = false; u.infectT = 0; u.infectLoad = 0;
    u.engaged = false; u.chaseT = 0; u.cd = 0.5; u.lifesteal = 0;
    u.garrisonId = null;
    u.homeX = u.x; u.homeY = u.y; u.patrolT = 0;
    u.visibleTargets = new Set(); u.seenByEnemy = false;
    this.effects.push({ type: 'blast', x: u.x, y: u.y, r: 26, t: 0, ttl: 0.6, color: '#8e3d6a' });
    this.effects.push({ type: 'text', x: u.x, y: u.y - 24, text: '沦为血仆', t: 0, ttl: 1.3, color: '#8e3d6a' });
    this.emit('warn', '一名阵亡单兵被吸血鬼领主转化为血仆（领主击杀时未被骚扰）！');
    this.sfx.push('boom');
  };
  // 短时间内有多少名不同的非友方单位攻击过该单位
  Game.prototype.attackerCount = function (u) {
    var n = 0;
    for (var id in u.attackers) {
      if (this.elapsed - u.attackers[id] <= CFG.attackerWindow) n++;
      else delete u.attackers[id];
    }
    return n;
  };
  Game.prototype.kill = function (u, cause, source) {
    if (!u.alive) return;
    // 吸血鬼领主：击杀单兵且自身未被骚扰（短时间内无非友方攻击过它）→ 受害者沦为血仆
    if (this.mode === 'vampire' && source && source.alive && source.key === 'vampire' &&
      u.team === 'player' && u.def.size === 'soldier' && this.attackerCount(source) === 0) {
      this.turnThrall(u);
      return;
    }
    u.alive = false;
    // 桥上出现阵亡者：残骸使后续单位在桥上移速降低 30%
    var b = this.bridgeAt(u.x, u.y);
    if (b && b.alive) {
      b.bodies++;
      if (!b.slow) {
        b.slow = true;
        this.emit('warn', '桥梁上出现阵亡单位，后续单位在桥上移速降低 30%（修复后重置）。');
      }
    }
    this.corpses.push({
      x: u.x, y: u.y, key: u.key, team: u.team,
      single: u.def.size === 'soldier', resurrected: false
    });
    if (u.team === 'player') {
      this.deaths++;
    } else if (u.team === 'civilian') {
      this.civilianLost++;
      this.effects.push({ type: 'text', x: u.x, y: u.y - 20, text: '平民遇害', t: 0, ttl: 1.2, color: '#b5453a' });
      this.emit('warn', '一名平民遇害！已损失 ' + this.civilianLost + ' / ' + this.civilianTotal + '。');
    } else if (u.team === 'enemy') {
      this.kills++;
      var reward = u.def.energyReward !== undefined ? u.def.energyReward : 1.2;
      this.energy = Math.min(CFG.energyCap, this.energy + reward);
      if (u.key === 'vampire') {
        this.vampireBossDead = true;
        this.emit('good', '吸血鬼领主已被消灭，黎明提前到来！');
      }
      if (!this.defectorGranted && this.kills > Math.floor(this.initialEnemyCount / 2)) {
        this.defectorGranted = true; this.defectors += 1;
        this.emit('good', '击杀过半，获得 1 个「降军」（0 费情报单位）。');
      }
    }
    this.onDeath(u, cause, source);
    this.effects.push({ type: 'death', x: u.x, y: u.y, team: u.team, t: 0, ttl: 0.45 });
  };
  Game.prototype.onDeath = function (u, cause) {
    if (u.key === 'flamer') {
      this.addFire(u.x, u.y, 74, 5.0, 14, 'player');
      this.igniteTerrain(u.x, u.y, 88);
      this.heatBridge(u.x, u.y, 88, 0.9);
      this.emit('info', '喷火兵燃料殉爆，附近地形被点燃。');
    } else if (u.key === 'bot' && cause !== 'selfDestruct') {
      this.explode(u.x, u.y, 74, 92, 'player');
    } else if (u.key === 'heli') {
      this.damageAOE(u.x, u.y, 96, 84, 'player', { any: true, cause: 'crash' });
      this.damageStructures(u.x, u.y, 96, 100);
      this.effects.push({ type: 'blast', x: u.x, y: u.y, r: 96, t: 0, ttl: 0.6, color: '#e59a52' });
      this.sfx.push('boom');
      this.emit('warn', '直升机坠毁，冲击波不分敌我（平民除外），并损伤附近建筑。');
    } else if (u.key === 'gas') {
      this.addGas(u.x, u.y, 92, 15, 15, 'player', { spread: 3.4, maxR: 152, debuff: true });
      this.emit('warn', '毒气兵阵亡，留下持续扩散的毒云，费用回复降低。');
    }
  };
  Game.prototype.explode = function (x, y, r, dmg, team) {
    this.damageAOE(x, y, r, dmg, team, { cause: 'explosion' });
    this.addFire(x, y, r * 0.95, 4.2, 12, team);
    this.igniteTerrain(x, y, r * 1.15);
    this.heatBridge(x, y, r * 1.15, 1.6);
    this.damageStructures(x, y, r * 0.95, dmg);   // 爆炸破坏建筑 / 墙体
    this.effects.push({ type: 'blast', x: x, y: y, r: r, t: 0, ttl: 0.55, color: '#ef9a4a' });
    this.sfx.push('boom');
  };
  Game.prototype.igniteTerrain = function (x, y, r) {
    for (var i = 0; i < this.terrains.length; i++) {
      var t = this.terrains[i];
      if (!t.alive || (t.type !== 'grass' && t.type !== 'forest')) continue;
      if (Math.hypot(t.x - x, t.y - y) > r + (t.maxR || 10) * 0.6) continue;
      if (t.burning <= 0) {
        t.burning = 0.001;
        this.emit('info', D.TERRAIN_INFO[t.type].name + '被点燃，将在数秒后烧毁。');
      }
    }
  };
  Game.prototype.addFire = function (x, y, r, ttl, dps, team) {
    for (var i = 0; i < this.fires.length; i++) {
      var f = this.fires[i];
      if (f.team === team && Math.hypot(f.x - x, f.y - y) < Math.max(20, r * 0.5)) {
        f.ttl = Math.max(f.ttl, ttl); f.r = Math.max(f.r, r); f.dps = Math.max(f.dps, dps);
        return f;
      }
    }
    if (this.fires.length > 140) this.fires.shift();
    var nf = { x: x, y: y, r: r, ttl: ttl, maxTtl: ttl, dps: dps, team: team, t: 0 };
    this.fires.push(nf);
    return nf;
  };
  Game.prototype.addGas = function (x, y, r, ttl, dps, team, opts) {
    opts = opts || {};
    if (opts.small) {
      for (var i = 0; i < this.gas.length; i++) {
        var g = this.gas[i];
        if (g.small && Math.hypot(g.x - x, g.y - y) < 20) { g.ttl = Math.max(g.ttl, ttl); return g; }
      }
    }
    if (this.gas.length > 90) this.gas.shift();
    var ng = {
      x: x, y: y, r: r, ttl: ttl, maxTtl: ttl, dps: dps, baseDps: dps, team: team, t: 0,
      small: !!opts.small, spread: opts.spread || 0, maxR: opts.maxR || r, debuff: !!opts.debuff
    };
    this.gas.push(ng);
    return ng;
  };

  /* ---------------- 主循环 ---------------- */

  Game.prototype.update = function (dt) {
    if (this.paused || this.phase === 'victory' || this.phase === 'defeat') return;
    var d = Math.min(dt, 0.05) * this.speedFactor;
    var steps = Math.max(1, Math.ceil(d / 0.033));
    var h = d / steps;
    for (var i = 0; i < steps; i++) this.step(h);
  };
  Game.prototype.step = function (dt) {
    if (this.phase === 'battle') {
      this.elapsed += dt;
      this.timeLeft = Math.max(0, this.timeLimit - this.elapsed);
      this.overdriveT = Math.max(0, this.overdriveT - dt);
      this.updateEnergy(dt);
      if (this.mode === 'vampire') this.updateVampireWaves(dt);
    }
    this.updateTerrains(dt);
    this.updateBridges(dt);
    this.updateFires(dt);
    this.updateGas(dt);
    this.updateEffects(dt);
    this.visTick -= dt;
    if (this.visTick <= 0) { this.visTick = 0.08; this.computeVisibility(); }
    if (this.phase !== 'battle') return;
    this.updateUnits(dt);
    this.updateProjectiles(dt);
    this.updatePickups(dt);
    this.updateGraves(dt);
    this.cleanup();
    this.checkEnd();
  };
  Game.prototype.updateEnergy = function (dt) {
    var rate = CFG.energyRate;
    for (var i = 0; i < this.units.length; i++) {
      var u = this.units[i];
      if (u.alive && u.team === 'player' && u.key === 'sergeant' && !u.seenByEnemy) rate += CFG.sergeantBonus;
    }
    for (var j = 0; j < this.gas.length; j++) if (this.gas[j].debuff) rate -= CFG.gasDebuff;
    rate = Math.max(0.15, rate);
    this.energy = Math.min(CFG.energyCap, this.energy + rate * dt);
  };
  Game.prototype.updateTerrains = function (dt) {
    for (var i = 0; i < this.terrains.length; i++) {
      var t = this.terrains[i];
      if (!t.alive || t.burning <= 0) continue;
      t.burning += dt;
      t.fireT -= dt;
      if (t.fireT <= 0) {
        t.fireT = 0.55;
        this.addFire(t.x + this.rand(-t.maxR * 0.35, t.maxR * 0.35), t.y + this.rand(-t.maxR * 0.35, t.maxR * 0.35),
          Math.max(24, t.maxR * 0.6), 0.9, 8, 'player');
      }
      var limit = t.type === 'grass' ? CFG.grassBurn : CFG.forestBurn;
      if (t.burning >= limit) {
        t.alive = false;
        this.emit('info', D.TERRAIN_INFO[t.type].name + '已烧毁，地形消失。');
      }
    }
  };
  Game.prototype.updateFires = function (dt) {
    for (var k = 0; k < this.fires.length; k++) {
      var f = this.fires[k];
      f.t += dt; f.ttl -= dt;
      if (f.dps > 0) {
        for (var i = 0; i < this.units.length; i++) {
          var u = this.units[i];
          if (!u.alive || !this.isHostile({ team: f.team }, u)) continue;
          if (Math.hypot(u.x - f.x, u.y - f.y) <= f.r + u.radius * 0.5) {
            this.applyDamage(u, f.dps * dt, { dot: true, cause: 'fire' });
          }
        }
      }
    }
    this.fires = this.fires.filter(function (f) { return f.ttl > 0; });
  };
  Game.prototype.updateGas = function (dt) {
    for (var k = 0; k < this.gas.length; k++) {
      var g = this.gas[k];
      g.t += dt; g.ttl -= dt;
      if (g.spread > 0 && g.r < g.maxR) g.r = Math.min(g.maxR, g.r + g.spread * dt);
      var frac = Math.max(0, g.ttl / g.maxTtl);
      var dps = g.baseDps * (0.25 + 0.75 * frac);
      for (var i = 0; i < this.units.length; i++) {
        var u = this.units[i];
        if (!u.alive || !this.isHostile({ team: g.team }, u)) continue;
        if (Math.hypot(u.x - g.x, u.y - g.y) <= g.r + u.radius * 0.5) {
          this.applyDamage(u, dps * dt, { dot: true, cause: 'gas' });
        }
      }
    }
    this.gas = this.gas.filter(function (g) { return g.ttl > 0; });
  };
  Game.prototype.updateEffects = function (dt) {
    var keep = [];
    for (var i = 0; i < this.effects.length; i++) {
      var e = this.effects[i];
      e.t += dt;
      if (e.type === 'strike' && !e.done && e.t >= e.delay) { this.resolveStrike(e); e.done = true; }
      if (e.type === 'meteor' && !e.done && e.t >= e.delay) { this.resolveMeteor(e); e.done = true; }
      if (e.t < (e.ttl || 0.6)) keep.push(e);
    }
    this.effects = keep;
  };
  Game.prototype.resolveStrike = function (e) {
    this.damageAOE(e.x, e.y, 130, 210, 'player', { cause: 'strike' });
    this.addFire(e.x, e.y, 118, 3.0, 10, 'player');
    this.heatBridge(e.x, e.y, 130, 2.2);
    var destroyed = 0;
    for (var i = 0; i < this.terrains.length; i++) {
      var t = this.terrains[i];
      if (!t.alive || t.type === 'river') continue;
      var tx = t.cx !== undefined ? t.cx : t.x, ty = t.cy !== undefined ? t.cy : t.y;
      if (Math.hypot(tx - e.x, ty - e.y) < 130 + (t.maxR || 12) * 0.5) {
        if (t.solid) continue;   // 建筑 / 墙体改走结构伤害
        t.alive = false; destroyed++;
      }
    }
    // 呼叫打击对建筑 / 墙体造成一次性高额结构伤害（通常足以摧毁）
    this.damageStructures(e.x, e.y, 130, 210);
    this.effects.push({ type: 'blast', x: e.x, y: e.y, r: 130, t: 0, ttl: 0.6, color: '#e7a25b' });
    this.emit('good', '呼叫打击命中，区域内 ' + destroyed + ' 处地形被摧毁，建筑与墙体受到重创。');
    this.sfx.push('boom');
  };
  Game.prototype.resolveMeteor = function (e) {
    var t = null;
    for (var i = 0; i < this.units.length; i++) {
      if (this.units[i].id === e.targetId && this.units[i].alive) { t = this.units[i]; break; }
    }
    if (!t) {
      var bd = 80;
      for (var j = 0; j < this.units.length; j++) {
        var v = this.units[j];
        if (!v.alive || v.team !== 'enemy') continue;
        var d = Math.hypot(v.x - e.x, v.y - e.y);
        if (d < bd) { bd = d; t = v; }
      }
    }
    if (t) {
      if (t.def.boss) {
        this.applyDamage(t, t.maxHp * 0.3, { ignoreArmor: true, cause: 'meteor' });
        t.statuses.stun = 3;
        this.emit('good', '陨石重创 BOSS：三成血量伤害并晕眩 3 秒。');
      } else {
        this.kill(t, 'meteor');
        this.emit('good', '陨石直接击败 ' + t.def.name + '。');
      }
    } else {
      this.damageAOE(e.x, e.y, 70, 120, 'player', { cause: 'meteor' });
      this.damageStructures(e.x, e.y, 70, 140);
      this.emit('info', '陨石落空，仅造成范围冲击。');
    }
    this.effects.push({ type: 'blast', x: e.x, y: e.y, r: 88, t: 0, ttl: 0.7, color: '#e8b06a' });
    this.sfx.push('boom');
  };
  Game.prototype.updateProjectiles = function (dt) {
    for (var i = 0; i < this.projectiles.length; i++) {
      var p = this.projectiles[i];
      p.t += dt; p.ttl -= dt;
      var t = null;
      for (var j = 0; j < this.units.length; j++) {
        if (this.units[j].id === p.targetId && this.units[j].alive) { t = this.units[j]; break; }
      }
      if (t) { p.tx = t.x; p.ty = t.y; }
      var a = Math.atan2(p.ty - p.y, p.tx - p.x);
      p.angle = a;
      var s = p.speed * dt;
      p.x += Math.cos(a) * s; p.y += Math.sin(a) * s;
      if (Math.hypot(p.tx - p.x, p.ty - p.y) < 14 || p.ttl <= 0) {
        this.effects.push({ type: 'blast', x: p.x, y: p.y, r: p.radius, t: 0, ttl: 0.45, color: '#e8a45a' });
        this.damageAOE(p.x, p.y, p.radius, p.damage, p.team, { cause: 'missile' });
        this.sfx.push('boom');
        p.done = true;
      }
    }
    this.projectiles = this.projectiles.filter(function (p) { return !p.done; });
  };
  Game.prototype.updatePickups = function () {
    for (var i = 0; i < this.pickups.length; i++) {
      var p = this.pickups[i];
      if (p.taken) continue;
      for (var j = 0; j < this.units.length; j++) {
        var u = this.units[j];
        if (!u.alive || u.team !== 'player') continue;
        if (Math.hypot(u.x - p.x, u.y - p.y) < 18 + u.radius * 0.5) {
          p.taken = true;
          this.applyPickup(p);
          break;
        }
      }
    }
    this.pickups = this.pickups.filter(function (p) { return !p.taken; });
  };
  Game.prototype.applyPickup = function (p) {
    var info = D.PICKUP_INFO[p.type];
    if (p.type === 'supply') {
      this.energy = Math.min(CFG.energyCap, this.energy + 3);
    } else if (p.type === 'medkit') {
      var cured = 0;
      for (var i = 0; i < this.units.length; i++) {
        var u = this.units[i];
        if (!u.alive || u.team !== 'player') continue;
        u.hp = Math.min(u.maxHp, u.hp + 25);
        if (u.infected) { u.infected = false; u.infectT = 0; u.infectLoad = 0; cured++; }
      }
      if (cured) this.emit('good', '医疗包治愈了 ' + cured + ' 名感染单位。');
    } else if (p.type === 'intel') {
      this.revealAround(600, 350, 900, 9);
    } else if (p.type === 'overdrive') {
      this.overdriveT = 9;
    }
    this.effects.push({ type: 'text', x: p.x, y: p.y - 14, text: info.name, t: 0, ttl: 1.0, color: '#2f6f52' });
    this.emit('good', '拾取「' + info.name + '」：' + info.desc);
    this.sfx.push('pickup');
  };
  Game.prototype.updateGraves = function (dt) {
    this.graveTimer -= dt;
    if (this.graveTimer > 0) return;
    this.graveTimer = CFG.graveInterval;
    var cap = Math.min(6, 1 + Math.floor((this.kills + this.deaths) / 4));
    var current = 0, i;
    for (i = 0; i < this.units.length; i++) if (this.units[i].alive && this.units[i].key === 'skeleton') current++;
    if (current >= cap) return;
    var graves = this.terrains.filter(function (t) { return t.alive && t.type === 'grave'; });
    for (i = 0; i < graves.length && current < cap; i++) {
      var g = graves[i];
      var s = this.spawnUnit('skeleton', 'neutral', g.x + this.rand(-28, 28), g.y + this.rand(-28, 28),
        { homeX: g.x, homeY: g.y, angle: this.rand(-Math.PI, Math.PI) });
      s.patrolT = this.rand(0.5, 2.5);
      this.effects.push({ type: 'blast', x: s.x, y: s.y, r: 20, t: 0, ttl: 0.5, color: '#a99cbb' });
      current++;
    }
  };
  Game.prototype.cleanup = function () {
    this.units = this.units.filter(function (u) { return u.alive; });
    for (var k in this.intel) {
      if (this.intel[k].until <= this.elapsed) delete this.intel[k];
    }
    this.pendingRearm = this.pendingRearm.filter(function (id) {
      for (var i = 0; i < this.units.length; i++) {
        if (this.units[i].id === id && this.units[i].state === 'idle') return true;
      }
      return false;
    }.bind(this));
  };
  Game.prototype.checkEnd = function () {
    if (this.phase !== 'battle') return;
    if (this.mode === 'vampire') {
      if (this.civilianLost * 2 > this.civilianTotal) {
        this.phase = 'defeat';
        this.emit('warn', '守卫失败：' + this.civilianLost + ' / ' + this.civilianTotal + ' 名平民遇害，超过半数。');
        return;
      }
      if (this.vampireBossDead) {
        this.phase = 'victory';
        this.emit('good', '吸血鬼领主已伏诛，黎明提前到来！幸存平民 ' +
          (this.civilianTotal - this.civilianLost) + ' / ' + this.civilianTotal + '。');
        this.sfx.push('win');
        return;
      }
      if (this.timeLeft <= 0) {
        this.phase = 'victory';
        this.emit('good', '日出！夜色退去，吸血鬼被迫撤离。幸存平民 ' +
          (this.civilianTotal - this.civilianLost) + ' / ' + this.civilianTotal + '。');
        this.sfx.push('win');
      }
      return;
    }
    var left = 0;
    for (var i = 0; i < this.units.length; i++) {
      if (this.units[i].alive && this.units[i].team === 'enemy') left++;
    }
    if (left === 0) {
      this.phase = 'victory';
      this.emit('good', (this.mode === 'infection' ? '感染被扑灭：' : '通关成功：') +
        '全部敌方单位已清除，用时 ' + this.elapsed.toFixed(1) + ' 秒。');
      this.sfx.push('win');
    } else if (this.timeLeft <= 0) {
      this.phase = 'defeat';
      this.emit('warn', '时间耗尽，通关失败。');
    }
  };

  /* ---------------- 单位 AI ---------------- */

  // 守巷增益：低额额外减伤、视野与攻击范围提升（不修改原始定义，动态计算）
  Game.prototype.effVision = function (u) {
    return u.def.vision * (u.garrisonId ? CFG.garrisonBoost : 1);
  };
  Game.prototype.effRange = function (u) {
    return u.def.range * (u.garrisonId ? CFG.garrisonBoost : 1);
  };
  Game.prototype.effArmor = function (u) {
    return Math.min(0.85, u.def.armor + (u.garrisonId ? CFG.garrisonArmor : 0));
  };

  Game.prototype.hasteFactor = function (u) {
    var f = (u.auraHaste ? 1.25 : 1) * (this.overdriveT > 0 ? 1.3 : 1);
    if (u.team === 'enemy') f *= this.diffCfg.rateScale;
    if (u.infected) f *= CFG.infectionHaste;
    return f;
  };
  Game.prototype.speedOf = function (u) {
    var s = u.def.speed;
    if (u.statuses.slow > 0) s *= 0.55;
    var b = u.def.size !== 'air' ? this.bridgeAt(u.x, u.y) : null;
    if (u.def.size !== 'air' && this.inRiver(u.x, u.y) && (!b || !b.alive)) {
      s *= (u.def.size === 'heavy' ? 0.55 : 0.5);
    }
    if (b && b.slow) s *= CFG.bridgeSlow;   // 桥上残骸：后续单位 -30%
    return s;
  };
  Game.prototype.moveToward = function (u, tx, ty, dt) {
    var s = this.speedOf(u) * dt;
    var a0 = Math.atan2(ty - u.y, tx - u.x);
    u.moveAngle = a0;   // 行进方向与视野朝向分离，视野由 resolveFacing 统一决定
    var offsets = [0, 0.6, -0.6, 1.2, -1.2, 1.9, -1.9];
    for (var i = 0; i < offsets.length; i++) {
      var a = a0 + offsets[i];
      var nx = u.x + Math.cos(a) * s, ny = u.y + Math.sin(a) * s;
      if (this.canOccupy(u, nx, ny)) { u.x = nx; u.y = ny; return true; }
    }
    return false;
  };
  Game.prototype.moveAlongRoute = function (u, dt, silent) {
    if (!u.route || u.routeIndex >= u.route.length) {
      if (!u.arrived) { u.arrived = true; this.onArrive(u, silent); }
      return;
    }
    var p = u.route[u.routeIndex];
    if (Math.hypot(u.x - p.x, u.y - p.y) < 9) {
      u.routeIndex++;
      if (u.routeIndex >= u.route.length) {
        if (!u.arrived) { u.arrived = true; this.onArrive(u, silent); }
        return;
      }
      p = u.route[u.routeIndex];
    }
    this.moveToward(u, p.x, p.y, dt);
  };
  Game.prototype.onArrive = function (u, silent) {
    if (u.state === 'idle' || u.state === 'return') return;
    if (u.key === 'necro') this.resurrect(u);
    if (u.key === 'defector') this.finishDefector(u);
    if (!silent) {
      this.effects.push({ type: 'text', x: u.x, y: u.y - 20, text: '就位', t: 0, ttl: 0.9, color: '#2f6fd0' });
    }
  };
  Game.prototype.finishDefector = function (u) {
    u.alive = false;
    this.revealAround(u.x, u.y, 340, 10);
    this.effects.push({ type: 'reveal', x: u.x, y: u.y, r: 340, t: 0, ttl: 0.9 });
    this.emit('good', '降军抵达阵亡点，附近敌人位置全部暴露 10 秒。');
  };
  Game.prototype.resurrect = function (u) {
    var n = 0;
    for (var i = 0; i < this.corpses.length && n < 8; i++) {
      var c = this.corpses[i];
      if (c.resurrected || !c.single) continue;
      if (Math.hypot(c.x - u.x, c.y - u.y) > 220) continue;
      c.resurrected = true;
      var v = this.spawnUnit(c.key, 'player', c.x, c.y, { hpScale: 0.25, undead: true, lifesteal: 1, route: [] });
      if (!v) continue;
      v.state = 'hold'; v.angle = 0;
      this.effects.push({ type: 'blast', x: v.x, y: v.y, r: 26, t: 0, ttl: 0.6, color: '#9a7ac0' });
      n++;
    }
    this.emit(n > 0 ? 'good' : 'info', n > 0 ? ('死灵法师复活了 ' + n + ' 个亡灵单位（四分之一血量，100% 吸血）。') : '死灵法师抵达终点，但附近没有可复活的单兵尸体。');
  };
  Game.prototype.pickTarget = function (u, maxRange) {
    var best = null, score = 1e9;
    var lim = maxRange !== undefined ? maxRange : this.effRange(u);
    for (var i = 0; i < this.units.length; i++) {
      var v = this.units[i];
      if (!v.alive || !this.isHostile(u, v) || !this.canHit(u, v)) continue;
      var d = Math.hypot(v.x - u.x, v.y - u.y);
      if (d > lim) continue;
      var known = u.visibleTargets.has(v.id) || (u.team === 'player' && this.hasIntel(v.id));
      if (!known) continue;
      var sc = d + (u.key === 'sniper' && v.hp < v.maxHp * 0.5 ? -40 : 0) + (v.def.boss ? -25 : 0);
      if (sc < score) { score = sc; best = v; }
    }
    return best;
  };
  Game.prototype.inAttackRange = function (u, t) {
    var d = Math.hypot(u.x - t.x, u.y - t.y);
    if (u.def.attack === 'melee') return d <= u.radius + t.radius + 3;
    return d <= this.effRange(u);
  };
  Game.prototype.performAttack = function (u, t) {
    if (!t.alive) return;
    var preHp = t.hp;
    u.angle = Math.atan2(t.y - u.y, t.x - u.x);
    var dmg = u.def.damage;
    if (u.key === 'blade' && preHp < t.maxHp * 0.5) { dmg *= 1.7; t.statuses.slow = 1.6; }
    if (u.key === 'gas' && t.def.size === 'soldier') {
      var a = Math.atan2(u.y - t.y, u.x - t.x);
      t.x += Math.cos(a) * 14; t.y += Math.sin(a) * 14;
    }
    if (u.key === 'scout' && !u.seenByEnemy && preHp < u.maxHp * 0.5 && t.def.size === 'soldier') {
      this.effects.push({ type: 'text', x: t.x, y: t.y - 18, text: '处决', t: 0, ttl: 0.9, color: '#8a4ab0' });
      this.kill(t, 'executed', u);
      this.sfx.push('boom');
      return;
    }
    if (u.def.attack === 'melee') {
      this.applyDamage(t, dmg, { source: u, cause: 'melee' });
      if (u.key === 'scout') { t.statuses.poison = 3; t.poisonDps = 4; }
      this.effects.push({ type: 'spark', x: t.x, y: t.y, t: 0, ttl: 0.2, color: u.key === 'scout' ? '#9ac86a' : '#d8e2f0' });
    } else {
      this.applyDamage(t, dmg, { source: u, cause: 'shot' });
      this.effects.push({
        type: 'tracer', x1: u.x, y1: u.y, x2: t.x, y2: t.y, t: 0, ttl: 0.12,
        color: u.team === 'player' ? '#3b78d4' : '#d45a4e'
      });
      if (u.key === 'heli' && u.ammo !== null) u.ammo--;
    }
    this.sfx.push('shot');
  };
  Game.prototype.updateUnits = function (dt) {
    var i, j;
    for (i = 0; i < this.units.length; i++) if (this.units[i].alive) this.units[i].auraHaste = false;
    for (i = 0; i < this.units.length; i++) {
      var s = this.units[i];
      if (!s.alive || s.team !== 'player' || s.key !== 'sergeant') continue;
      for (j = 0; j < this.units.length; j++) {
        var v = this.units[j];
        if (v.alive && v.team === 'player' && Math.hypot(v.x - s.x, v.y - s.y) <= 160) v.auraHaste = true;
      }
    }
    var list = this.units.slice();
    for (i = 0; i < list.length; i++) this.updateUnitAI(list[i], dt);
    this.updateCollisions(dt);
  };
  Game.prototype.updateUnitAI = function (u, dt) {
    if (!u.alive) return;
    var st = u.statuses;
    st.slow = Math.max(0, st.slow - dt);
    st.stun = Math.max(0, st.stun - dt);
    st.poison = Math.max(0, st.poison - dt);
    if (st.poison > 0 && u.poisonDps > 0) {
      this.applyDamage(u, u.poisonDps * dt, { dot: true, cause: 'poison' });
      if (!u.alive) return;
    }
    if (u.undead) {
      u.hp -= u.maxHp * 0.035 * dt;
      if (u.hp <= 0) { this.kill(u, 'decay'); return; }
    }
    // 丧尸感染倒计时；医疗包可在此之前治愈
    if (u.infected) {
      u.infectT -= dt;
      if (u.infectT <= 0) this.turnZombie(u);
    }
    if (st.stun > 0) return;
    u.alertT = Math.max(0, u.alertT - dt);
    u.cd -= dt * this.hasteFactor(u);
    if (u.def.vehicle) {
      // 已满足「被多名非友方攻击」的停机条件时，连碾压冲刺也要一并停下
      var multiHitHold = u.def.holdAttackers &&
        this.attackerCount(u) >= u.def.holdAttackers && !!this.contactInRange(u);
      if (multiHitHold) { u.ramActive = false; u.ramTargetId = null; }
      else this.updateVehicleRam(u, dt);
    }

    var key = u.key, aim = null;
    if (u.team === 'civilian') aim = this.updateCivilian(u, dt);
    else if (key === 'vampire' && u.team === 'enemy') aim = this.updateVampireAI(u, dt);
    else if (key === 'bot') aim = this.updateBot(u, dt);
    else if (key === 'gunner') aim = this.updateGunner(u, dt);
    else if (key === 'jet') aim = this.updateJet(u, dt);
    else if (key === 'heli') aim = this.updateHeli(u, dt);
    else if (PASSIVE[key] && u.team === 'player') aim = this.updatePassive(u, dt);
    else if (u.team === 'player') aim = this.updatePlayerCombat(u, dt);
    else if (u.advance) aim = this.updateAdvanceAI(u, dt);
    else aim = this.updateEnemyAI(u, dt);

    this.resolveFacing(u, dt, aim);

    // 依赖最终朝向 / 移动后位置的后处理
    if (key === 'scout' && u.team === 'player') this.updateScoutVision(u, dt);
    if (key === 'flamer') this.updateFlamer(u, dt);
    if (key === 'gas') this.updateGasTrail(u, dt);
  };

  Game.prototype.faceToward = function (u, target, dt, rate) {
    if (target === null || target === undefined) return;
    var diff = angDiff(target, u.angle);
    var step = rate * dt;
    u.angle += clamp(diff, -step, step);
  };
  // 单兵行进中以行进方向为轴左右环视；受击快速转向攻击来源并保持 1 秒；
  // 交战时精确指向目标。扫描类 / 广域视野 / 狙击镜单位与空中、大体积单位不摆动。
  Game.prototype.resolveFacing = function (u, dt, aim) {
    if (aim !== null && aim !== undefined) { this.faceToward(u, aim, dt, 14); return; }
    if (u.team !== 'player') { this.faceToward(u, u.moveAngle, dt, 8); return; }
    if (u.alertT > 0) { this.faceToward(u, u.alertAngle, dt, 12); return; }
    if (u.def.size !== 'soldier' || PATROL_EXEMPT[u.key]) {
      this.faceToward(u, u.moveAngle, dt, 7);
      return;
    }
    u.sweepPhase += dt * CFG.patrolSpeed;
    var sweep = Math.sin(u.sweepPhase) * CFG.patrolSweep;
    this.faceToward(u, u.moveAngle + sweep, dt, 3.4);
  };

  // 该单位对目标的实际攻击距离
  Game.prototype.attackLimit = function (u, v) {
    return u.def.attack === 'melee' ? u.radius + (v ? v.radius : 9) + 3 : this.effRange(u);
  };
  // 「遇敌」= 敌方同时被发现（真看见，而非仅被情报通报）且在攻击范围内
  Game.prototype.contactInRange = function (u) {
    var best = null, bd = 1e9;
    for (var i = 0; i < this.units.length; i++) {
      var v = this.units[i];
      if (!v.alive || !this.isHostile(u, v) || !this.canHit(u, v) || !u.visibleTargets.has(v.id)) continue;
      var d = Math.hypot(v.x - u.x, v.y - u.y);
      if (d > Math.min(this.effVision(u), this.attackLimit(u, v))) continue;
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  };
  Game.prototype.nearestVisible = function (u, maxD, onlySoldier) {
    var best = null, bd = maxD;
    for (var i = 0; i < this.units.length; i++) {
      var v = this.units[i];
      if (!v.alive || !this.isHostile(u, v) || !this.canHit(u, v) || !u.visibleTargets.has(v.id)) continue;
      if (onlySoldier && v.def.size !== 'soldier') continue;
      var d = Math.hypot(v.x - u.x, v.y - u.y);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  };

  // 沿路线作战的通用逻辑：仅在「被发现且在射程内」时停下攻击，清空后继续原路线。
  // 例外：noHold 单位（毒气兵）永不停机；holdAttackers 单位（载具）需被多名非友方攻击才停。
  Game.prototype.updateRoutedCombat = function (u, dt, silent) {
    if (u.def.attack === 'none') {
      if (u.state === 'march') this.moveAlongRoute(u, dt, silent);
      return null;
    }
    var target = this.pickTarget(u, Math.max(this.effRange(u), this.effVision(u)));
    var contact = this.contactInRange(u);
    var aim = null;
    if (target) {
      aim = Math.atan2(target.y - u.y, target.x - u.x);
      u.angle = aim;
      if (u.def.attack !== 'flame' && u.cd <= 0 && this.inAttackRange(u, target)) {
        this.performAttack(u, target);
        u.cd = 1 / Math.max(0.01, u.def.rate);
      }
    }
    var hold = false;
    if (!u.arrived && u.state === 'march') {
      if (u.def.noHold) {
        u.engaged = !!contact;      // 持续推进，但仍在射程内开火
      } else if (u.def.holdAttackers) {
        hold = !!contact && this.attackerCount(u) >= u.def.holdAttackers;
        u.engaged = hold;
      } else {
        hold = !!contact;
        u.engaged = hold;
      }
    } else {
      u.engaged = false; u.chaseT = 0;
    }
    if (!hold && u.state === 'march') {
      if (u.ramActive) {
        // 载具正在来回碾压，位移已由 updateVehicleRam 处理
        u.chaseT = 0;
      } else if (!u.def.noHold && u.def.attack === 'melee' && !contact) {
        // 近战：只在很小范围内主动贴近，避免永远打不到敌人而卡死
        var near = this.nearestVisible(u, this.attackLimit(u, { radius: 9 }) + CFG.meleeCloseRadius);
        if (near) {
          u.chaseT += dt;
          if (u.chaseT <= CFG.meleeChaseMax && this.moveToward(u, near.x, near.y, dt)) return aim;
        }
        u.chaseT = 0;
        this.moveAlongRoute(u, dt, silent);
      } else {
        u.chaseT = 0;
        this.moveAlongRoute(u, dt, silent);
      }
    }
    return aim;
  };
  Game.prototype.updatePlayerCombat = function (u, dt) {
    return this.updateRoutedCombat(u, dt, false);
  };

  /* ---------------- 载具：来回碾压与碰撞 ---------------- */
  Game.prototype.updateVehicleRam = function (u, dt) {
    u.ramActive = false;
    u.ramCd = Math.max(0, u.ramCd - dt);
    if (u.state !== 'march' || u.arrived || u.statuses.stun > 0) { u.ramTargetId = null; return; }
    var t = null, i;
    if (u.ramTargetId) {
      for (i = 0; i < this.units.length; i++) {
        var c = this.units[i];
        if (c.id === u.ramTargetId && c.alive && c.def.size === 'soldier' && this.isHostile(u, c)) { t = c; break; }
      }
    }
    if (t && Math.hypot(t.x - u.x, t.y - u.y) > CFG.ramAcquire + 70) t = null;
    if (!t) {
      t = this.nearestVisible(u, CFG.ramAcquire, true);
      u.ramTargetId = t ? t.id : null;
      u.ramT = 0; u.ramDir = 1; u.ramAnchor = null;
    }
    if (!t) return;
    u.ramT += dt;
    if (u.ramT > CFG.ramDuration) { u.ramTargetId = null; return; }
    var d = Math.hypot(t.x - u.x, t.y - u.y);
    var ang = Math.atan2(t.y - u.y, t.x - u.x);
    var tx = t.x, ty = t.y;
    if (u.ramDir > 0) {
      if (d < u.radius + t.radius + 6) {
        u.ramDir = -1;
        u.ramAnchor = { x: u.x - Math.cos(ang) * 78, y: u.y - Math.sin(ang) * 78 };
      }
    } else {
      if (!u.ramAnchor) u.ramAnchor = { x: u.x - Math.cos(ang) * 78, y: u.y - Math.sin(ang) * 78 };
      tx = u.ramAnchor.x; ty = u.ramAnchor.y;
      if (Math.hypot(u.x - tx, u.y - ty) < 16) { u.ramDir = 1; u.ramAnchor = null; tx = t.x; ty = t.y; }
    }
    // 冲刺朝向目标 / 倒车点，形成「来回碾压」
    this.moveToward(u, clamp(tx, 20, W - 20), clamp(ty, 20, H - 20), dt * CFG.ramSpeed);
    u.ramActive = true;
  };
  Game.prototype.updateCollisions = function (dt) {
    var list = this.units, i, j;
    for (i = 0; i < list.length; i++) {
      var a = list[i];
      if (!a.alive || a.def.size !== 'heavy' || !a.def.crush) continue;
      for (j = 0; j < list.length; j++) {
        var b = list[j];
        if (a === b || !b.alive) continue;
        var d = Math.hypot(b.x - a.x, b.y - a.y);
        var ang = d > 0.01 ? Math.atan2(b.y - a.y, b.x - a.x) : 0;
        if (b.def.size === 'soldier' && !b.garrisonId && this.isHostile(a, b)) {
          if (d + b.radius <= a.radius + 1) {
            // 车身完全覆盖单兵：持续碾压
            this.applyDamage(b, CFG.crushDps * dt, { dot: true, source: a, cause: 'crush' });
            if (a.ramCd <= 0) {
              this.effects.push({ type: 'spark', x: b.x, y: b.y, t: 0, ttl: 0.25, color: '#d8a15a' });
              a.ramCd = 0.3;
            }
          } else if (d < a.radius + b.radius + 2) {
            // 体积碰撞：一次性高额伤害并推开
            if (a.ramCd <= 0) {
              this.applyDamage(b, CFG.ramDamage, { source: a, cause: 'ram' });
              a.ramCd = CFG.ramCooldown;
              this.effects.push({ type: 'blast', x: b.x, y: b.y, r: 26, t: 0, ttl: 0.4, color: '#d8a15a' });
              this.effects.push({ type: 'text', x: b.x, y: b.y - 20, text: '碾压', t: 0, ttl: 0.7, color: '#a2662a' });
              this.sfx.push('boom');
            }
            var px = b.x + Math.cos(ang) * CFG.pushForce * dt, py = b.y + Math.sin(ang) * CFG.pushForce * dt;
            if (this.canOccupy(b, px, py)) { b.x = px; b.y = py; }
          }
        } else if (b.def.size === 'heavy' && a.radius > b.radius + 0.5 && d < a.radius + b.radius) {
          // 对体积小于自身的载具造成推挤
          var shove = (a.radius + b.radius - d) * 0.5 + 1;
          var bx = b.x + Math.cos(ang) * shove, by = b.y + Math.sin(ang) * shove;
          if (this.canOccupy(b, bx, by)) { b.x = bx; b.y = by; }
        }
      }
    }
  };
  Game.prototype.updatePassive = function (u, dt) {
    if (u.state === 'march') this.moveAlongRoute(u, dt);
    return null;
  };
  // 平民：视野 150 内出现敌方时，以中等偏慢速度向反方向逃离；
  // 平日待在村界（部署区一带），因此只有敌方推进到部署区攻击才可能伤到他们
  Game.prototype.updateCivilian = function (u, dt) {
    if (this.phase !== 'battle') return null;
    var best = null, bd = u.def.vision;
    for (var i = 0; i < this.units.length; i++) {
      var v = this.units[i];
      if (!v.alive || !this.isHostile(u, v)) continue;
      var d = Math.hypot(v.x - u.x, v.y - u.y);
      if (d < bd) { bd = d; best = v; }
    }
    if (!best) { u.fleeing = false; return null; }   // 附近没有威胁：原地留守
    u.fleeing = true;
    var away = Math.atan2(u.y - best.y, u.x - best.x);
    // 边缘感知：逃离方向若会撞上村界 / 地图边缘，则沿边缘旋转滑动，避免被逼进死角
    var lim = { x0: 26, x1: CFG.deployZone + 40, y0: 26, y1: H - 26 };
    var probe = function (a) {
      return u.x + Math.cos(a) * 70 >= lim.x0 && u.x + Math.cos(a) * 70 <= lim.x1 &&
        u.y + Math.sin(a) * 70 >= lim.y0 && u.y + Math.sin(a) * 70 <= lim.y1;
    };
    if (!probe(away)) {
      var rots = [Math.PI / 2, -Math.PI / 2, Math.PI];
      for (var ri = 0; ri < rots.length; ri++) {
        if (probe(away + rots[ri])) { away += rots[ri]; break; }
      }
    }
    var tx = clamp(u.x + Math.cos(away) * 70, 22, CFG.deployZone + 40);
    var ty = clamp(u.y + Math.sin(away) * 70, 22, H - 22);
    this.moveToward(u, tx, ty, dt);
    u.fleeing = true;
    return Math.atan2(best.y - u.y, best.x - u.x);   // 逃离时回头面向威胁
  };
  // 吸血鬼之夜 / 感染体：自右向左推进，抵达路线终点后重新锁定最近的平民或己方单位
  // 吸血鬼领主与己方单位一样「优先索敌面前的目标」：距离为主，背后的目标按角度差惩罚
  Game.prototype.nearestPrey = function (u) {
    var frontal = (u.key === 'vampire');
    var face = u.angle;
    function preyScore(x, y, d) {
      if (!frontal) return d;
      var off = Math.abs(angDiff(Math.atan2(y - u.y, x - u.x), face));
      return d + off * 130;   // 背后（π）约 +408 距离惩罚，面前目标优先
    }
    var best = null, bd = 1e9, i;
    for (i = 0; i < this.units.length; i++) {
      var v = this.units[i];
      if (!v.alive || v.team !== 'civilian') continue;
      var d = Math.hypot(v.x - u.x, v.y - u.y);
      var sc = preyScore(v.x, v.y, d);
      if (sc < bd) { bd = sc; best = v; }
    }
    if (best) return best;
    for (i = 0; i < this.units.length; i++) {
      var p = this.units[i];
      if (!p.alive || p.team !== 'player') continue;
      var pd = Math.hypot(p.x - u.x, p.y - u.y);
      var psc = preyScore(p.x, p.y, pd);
      if (psc < bd) { bd = psc; best = p; }
    }
    return best;
  };
  Game.prototype.updateAdvanceAI = function (u, dt) {
    if (u.arrived || !u.route || !u.route.length) {
      var prey = this.nearestPrey(u);
      if (prey) {
        u.route = [{ x: clamp(prey.x + 12, 20, W - 20), y: clamp(prey.y, 20, H - 20) }];
        u.routeIndex = 0; u.arrived = false;
      }
    }
    return this.updateRoutedCombat(u, dt, true);
  };

  /* ---------------- 吸血鬼领主：化蝠 / 重整状态机 ---------------- */
  // 普通形态：近距高伤普攻（updateAdvanceAI）+ 大半分钟冷却的「化蝠」长距突袭。
  // 化蝠中：长距跨障碍飞行、受伤增加、受击减速。
  // 重整中：完全静止不可移动；完成后最大生命 -20%、吸血率 +15%。
  Game.prototype.updateVampireAI = function (u, dt) {
    if (u.vstate === 'reform') {
      // 重整未完成：绝不移动、不攻击
      u.reformT -= dt;
      if (u.reformT <= 0) this.finishVampireReform(u);
      return null;
    }
    if (u.vstate === 'bat') {
      // 化蝠飞行：无视一切地形与障碍直线飞行
      var d = Math.hypot(u.batTarget.x - u.x, u.batTarget.y - u.y);
      var a = Math.atan2(u.batTarget.y - u.y, u.batTarget.x - u.x);
      u.moveAngle = a;
      var s = CFG.vampireBatSpeed * (u.statuses.slow > 0 ? 0.55 : 1) * dt;
      if (d <= Math.max(s, 14)) {
        u.x = u.batTarget.x; u.y = u.batTarget.y;
        if (u.batMode === 'escape') {
          // 抵达右侧重整点：结束化蝠，进入重整（静止数秒）
          u.vstate = 'reform'; u.batForm = false; u.reformT = CFG.vampireReformTime;
          u.statuses.slow = 0;
          this.effects.push({ type: 'text', x: u.x, y: u.y - 36, text: '重整中…', t: 0, ttl: 1.6, color: '#8e3d6a' });
          this.emit('warn', '吸血鬼领主退至右侧开始重整——这是集火将其彻底消灭的机会。');
        } else {
          // 化蝠突袭落地：恢复普通形态，直接扑向猎物
          u.vstate = 'advance'; u.batForm = false;
          u.statuses.slow = 0;
          u.route = []; u.routeIndex = 0; u.arrived = true;
        }
      } else {
        u.x += Math.cos(a) * s; u.y += Math.sin(a) * s;
      }
      return a;
    }
    // 普通形态：技能冷却转好且猎物较远 → 化蝠长距突袭，跨越障碍直扑猎物
    // batCd 是真正的技能冷却（施放后 30 秒）；batWait 只是「暂不施放」的重试间隔，不显示给玩家
    if (u.batWait > 0) u.batWait -= dt;
    if (u.batCd > 0) u.batCd -= dt;
    if (u.batCd <= 0 && u.batWait <= 0) {
      var prey = this.nearestPrey(u);
      if (prey) {
        var pd = Math.hypot(prey.x - u.x, prey.y - u.y);
        if (pd > 150) {
          // 落点在「猎物 ↔ 领主」连线的领主一侧，与猎物保持 60~85 距离：
          // 领主始终从自己所在的一侧正面扑击，不会绕到猎物背后偷袭
          var dx = u.x - prey.x, dy = u.y - prey.y, dl = Math.hypot(dx, dy) || 1;
          var ad = this.rand(60, 85);
          this.triggerVampireBat(u, prey.x + dx / dl * ad, prey.y + dy / dl * ad, 'assault');
          return u.moveAngle;
        }
        u.batWait = 4;   // 猎物就在身边，稍后再考虑技能
      } else {
        u.batWait = 4;
      }
    }
    return this.updateAdvanceAI(u, dt);
  };
  Game.prototype.triggerVampireBat = function (u, tx, ty, mode) {
    tx = clamp(tx, 30, W - 30); ty = clamp(ty, 30, H - 30);
    u.vstate = 'bat'; u.batForm = true; u.batMode = mode;
    u.batTarget = { x: tx, y: ty };
    u.batCd = CFG.vampireBatCd; u.batWait = 0;   // 每次化蝠（突袭/撤退）都进入完整冷却
    u.ramTargetId = null; u.engaged = false; u.chaseT = 0;
    this.effects.push({ type: 'blast', x: u.x, y: u.y, r: 52, t: 0, ttl: 0.7, color: '#8e3d6a' });
    this.effects.push({ type: 'text', x: u.x, y: u.y - 32, text: '化蝠！', t: 0, ttl: 1.3, color: '#8e3d6a' });
    this.emit(mode === 'assault' ? 'warn' : 'info',
      mode === 'assault'
        ? '吸血鬼领主化作蝠群飞越障碍直扑猎物——化蝠期间受伤增加、受击减速！'
        : '吸血鬼领主开始化蝠飞行。');
    this.sfx.push('boom');
  };
  // 血量被打空（非化蝠状态）：化作脆弱蝠群退往右侧重整
  Game.prototype.breakVampire = function (u) {
    u.hp = u.maxHp * CFG.vampireBatHpFrac;
    u.statuses.stun = 0; u.statuses.slow = 0;
    var ry = clamp(u.y + this.rand(-90, 90), 60, H - 60);
    this.triggerVampireBat(u, W - 64, ry, 'escape');
    this.emit('warn', '吸血鬼领主血量被打空，化作蝠群退往右侧！化蝠期间血量脆弱（受伤 ×' +
      CFG.vampireBatVuln + '），追击可将其彻底消灭。');
  };
  Game.prototype.finishVampireReform = function (u) {
    u.batForm = false; u.vstate = 'advance'; u.reformCount++;
    u.maxHp = Math.max(140, Math.round(u.maxHp * CFG.vampireReformDecay));   // 每次重整最大生命 -20%
    u.hp = Math.round(u.maxHp * CFG.vampireReformHeal);
    u.lifesteal = Math.min(1.6, u.lifesteal + CFG.vampireReformLifesteal);   // 每次重整吸血率 +15%
    u.route = this.advanceRoute(u.x, u.y); u.routeIndex = 0; u.arrived = false; u.state = 'march';
    u.statuses.stun = 0; u.statuses.slow = 0;
    this.effects.push({ type: 'blast', x: u.x, y: u.y, r: 60, t: 0, ttl: 0.8, color: '#8e3d6a' });
    this.emit('warn', '吸血鬼领主完成第 ' + u.reformCount + ' 次重整：最大生命降至 ' + u.maxHp +
      '，吸血率升至 ' + Math.round(u.lifesteal * 100) + '%，再次向村镇推进。');
    this.sfx.push('boom');
  };
  Game.prototype.updateEnemyAI = function (u, dt) {
    var t = this.pickTarget(u, Math.max(this.effRange(u), this.effVision(u)));
    if (t) {
      var d = Math.hypot(u.x - t.x, u.y - t.y);
      var a = Math.atan2(t.y - u.y, t.x - u.x);
      u.angle = a;
      var homeD = Math.hypot(u.x - u.homeX, u.y - u.homeY);
      if (d > Math.max(28, u.def.range * 0.9) && homeD < 130 && !u.def.boss) {
        this.moveToward(u, t.x, t.y, dt);
      }
      if (u.cd <= 0 && this.inAttackRange(u, t)) {
        this.performAttack(u, t);
        u.cd = 1 / Math.max(0.01, u.def.rate);
      }
      return a;
    }
    u.patrolT -= dt;
    if (u.patrolT <= 0) {
      u.patrolT = 2.0 + this.rand(0, 1.8);
      u.patrolX = u.homeX + this.rand(-45, 45);
      u.patrolY = u.homeY + this.rand(-45, 45);
    }
    this.moveToward(u, u.patrolX, u.patrolY, dt * 0.55);
    return null;
  };
  Game.prototype.updateBot = function (u, dt) {
    var best = null, bd = 1e9;
    for (var i = 0; i < this.units.length; i++) {
      var v = this.units[i];
      if (!v.alive || !this.isHostile(u, v) || !this.canHit(u, v)) continue;
      var d = Math.hypot(v.x - u.x, v.y - u.y);
      if (d <= 260 && d < bd) { bd = d; best = v; }
    }
    if (best) {
      u.scanTargetId = best.id;
      this.addIntel(best.id, best.x, best.y, 2.0);
      this.moveToward(u, best.x, best.y, dt);
      var a = Math.atan2(best.y - u.y, best.x - u.x);
      u.angle = a;
      if (bd <= u.radius + best.radius + 2) {
        this.explode(u.x, u.y, 90, u.def.damage, 'player');
        this.kill(u, 'selfDestruct');
      }
      return a;
    }
    u.scanTargetId = null;
    if (u.state === 'march') this.moveAlongRoute(u, dt);
    return null;
  };
  Game.prototype.updateGunner = function (u, dt) {
    var enemyVisible = false, aim = null;
    for (var i = 0; i < this.units.length; i++) {
      var v = this.units[i];
      if (v.alive && this.isHostile(u, v) && this.canHit(u, v) && u.visibleTargets.has(v.id)) { enemyVisible = true; break; }
    }
    if (u.state === 'march') {
      if (enemyVisible) {
        u.state = 'deploy'; u.deployT = 2;
        this.effects.push({ type: 'text', x: u.x, y: u.y - 20, text: '架设中', t: 0, ttl: 0.9, color: '#2f6fd0' });
      } else this.moveAlongRoute(u, dt);
    } else if (u.state === 'deploy') {
      u.deployT -= dt;
      if (u.deployT <= 0) u.state = 'fire';
    } else if (u.state === 'fire') {
      u.shield = Math.min(u.maxShield, u.shield + 12 * dt);
      var t = this.pickTarget(u, this.effRange(u));
      if (t) {
        aim = Math.atan2(t.y - u.y, t.x - u.x);
        u.angle = aim;
        if (u.cd <= 0) { this.performAttack(u, t); u.cd = 1 / u.def.rate; }
      }
      if (!enemyVisible) {
        u.state = 'pack'; u.packT = 2;
        this.effects.push({ type: 'text', x: u.x, y: u.y - 20, text: '收枪', t: 0, ttl: 0.9, color: '#2f6fd0' });
      }
    } else if (u.state === 'pack') {
      u.packT -= dt;
      if (u.packT <= 0) u.state = 'march';
    } else {
      this.moveAlongRoute(u, dt);
    }
    return aim;
  };
  Game.prototype.updateJet = function (u, dt) {
    if (u.state === 'return') {
      if (Math.hypot(u.spawnX - u.x, u.spawnY - u.y) > 12) {
        this.moveToward(u, u.spawnX, u.spawnY, dt);
      } else {
        u.state = 'idle';
        if (this.pendingRearm.indexOf(u.id) < 0) this.pendingRearm.push(u.id);
      }
      return null;
    }
    if (u.state === 'idle') return null;
    var aim = null;
    var t = this.pickTarget(u, this.effRange(u));
    if (t) {
      aim = Math.atan2(t.y - u.y, t.x - u.x);
      u.angle = aim;
      if (u.cd <= 0) { this.performAttack(u, t); u.cd = 1 / u.def.rate; }
    }
    u.missileCd -= dt;
    if (u.missiles > 0 && u.missileCd <= 0 && t) {
      this.projectiles.push({
        type: 'missile', x: u.x, y: u.y, angle: u.angle, targetId: t.id,
        tx: t.x, ty: t.y, speed: 290, damage: 62, radius: 52, team: 'player', t: 0, ttl: 6, done: false
      });
      u.missiles--; u.missileCd = 4.0;
      this.effects.push({ type: 'blast', x: u.x, y: u.y, r: 20, t: 0, ttl: 0.3, color: '#dce8f4' });
      if (u.missiles === 0) {
        u.state = 'return';
        this.emit('info', '战斗机 4 枚导弹发射完毕，正在返回出发点。');
      }
    }
    if (u.state === 'march') this.moveAlongRoute(u, dt);
    return aim;
  };
  Game.prototype.updateHeli = function (u, dt) {
    if (u.ammo !== null && u.ammo <= 0) { this.landHeli(u); return null; }
    var aim = null;
    var t = this.pickTarget(u, this.effRange(u));
    if (t) {
      aim = Math.atan2(t.y - u.y, t.x - u.x);
      u.angle = aim;
      if (u.cd <= 0) { this.performAttack(u, t); u.cd = 1 / u.def.rate; }
    }
    if (u.state === 'march') this.moveAlongRoute(u, dt);
    return aim;
  };
  Game.prototype.landHeli = function (u) {
    u.alive = false;
    this.effects.push({ type: 'blast', x: u.x, y: u.y, r: 42, t: 0, ttl: 0.6, color: '#8fb6d9' });
    var s = this.spawnUnit('sergeant', 'player', u.x - 15, u.y + 9, { hpScale: 0.5, route: [] });
    var g = this.spawnUnit('lightGunner', 'player', u.x + 15, u.y - 9, { route: [] });
    if (s) s.state = 'hold';
    if (g) g.state = 'hold';
    this.emit('info', '直升机弹药耗尽降落，生成半血士官与轻机枪兵。');
  };
  // 窄角度火焰锥；火焰锥本体由渲染层依据 flameOn / flamePhase 连续绘制，
  // 不再逐帧堆叠半透明扇形特效。索敌范围用视野（255），命中范围用射程（104）。
  Game.prototype.updateFlamer = function (u, dt) {
    u.flamePhase += dt;
    if (this.inRiver(u.x, u.y)) { u.riverBlocked = true; u.flameOn = false; return; }
    u.riverBlocked = false;
    u.flameOn = true;
    var half = u.def.flameHalf || 0.30;
    var flameRange = this.effRange(u);
    for (var i = 0; i < this.units.length; i++) {
      var v = this.units[i];
      if (!v.alive || !this.isHostile(u, v) || !this.canHit(u, v)) continue;
      var d = Math.hypot(v.x - u.x, v.y - u.y);
      if (d > flameRange + v.radius) continue;
      if (Math.abs(angDiff(Math.atan2(v.y - u.y, v.x - u.x), u.angle)) > half) continue;
      this.applyDamage(v, u.def.damage * dt, { dot: true, source: u, cause: 'flame' });
    }
    u.fireT -= dt;
    if (u.fireT <= 0) {
      u.fireT = 0.38;
      var fx = u.x + Math.cos(u.angle) * 46, fy = u.y + Math.sin(u.angle) * 46;
      // 火焰锥由渲染层连续绘制，此处只负责点燃地形，不再堆叠圆形火团
      this.igniteTerrain(fx, fy, 50);
    }
  };
  Game.prototype.updateGasTrail = function (u, dt) {
    u.toxicT -= dt;
    if (u.toxicT <= 0) {
      u.toxicT = 0.34;
      this.addGas(u.x, u.y, 27, 4.2, 10, 'player', { small: true });
    }
  };
  Game.prototype.updateScoutVision = function (u, dt) {
    var fb = this.forestAhead(u);
    if (fb) {
      if (u.wallWatchId === fb.terrain.id) u.wallWatchT += dt;
      else { u.wallWatchId = fb.terrain.id; u.wallWatchT = 0; }
      if (u.wallWatchT >= 1.5) {
        if (!u.wallHack) {
          u.wallHack = true;
          this.emit('good', '侦察兵看透树林 / 墙体，障碍后敌人位置已通报。');
        }
        var ox = fb.terrain.cx !== undefined ? fb.terrain.cx : fb.terrain.x;
        var oy = fb.terrain.cy !== undefined ? fb.terrain.cy : fb.terrain.y;
        for (var i = 0; i < this.units.length; i++) {
          var v = this.units[i];
          if (!v.alive || (v.team !== 'enemy' && v.team !== 'neutral')) continue;
          var d = Math.hypot(v.x - u.x, v.y - u.y);
          if (d > u.def.vision || d <= fb.dist) continue;
          if (Math.hypot(v.x - ox, v.y - oy) < 240) {
            this.addIntel(v.id, v.x, v.y, 2.5);
          }
        }
      }
    } else {
      u.wallWatchId = null; u.wallWatchT = 0; u.wallHack = false;
    }
  };

  root.Game = Game;
  if (typeof module !== 'undefined' && module.exports) module.exports = { Game: Game };
})(typeof window !== 'undefined' ? window : globalThis);
