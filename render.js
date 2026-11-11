/* 渲染层：Canvas 2D 俯视角绘制，仅读取引擎状态，不修改逻辑。 */
(function (root) {
  'use strict';
  var D = root.DATA, W = D.WORLD.w, H = D.WORLD.h;

  function hash(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0) / 4294967296;
  }
  function rgba(hex, a) {
    var s = hex.replace('#', '');
    var r = parseInt(s.substring(0, 2), 16), g = parseInt(s.substring(2, 4), 16), b = parseInt(s.substring(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }
  function label(c, text, x, y, color) {
    c.font = 'bold 11px "Microsoft YaHei", system-ui, sans-serif';
    c.textAlign = 'center';
    c.lineWidth = 3.2; c.strokeStyle = 'rgba(255,255,255,0.88)';
    c.strokeText(text, x, y);
    c.fillStyle = color; c.fillText(text, x, y);
  }
  // 不规则草丛 / 树林轮廓：以各顶点为控制点的平滑闭合曲线
  function blobPath(c, q) {
    var pts = q.shape, n = pts ? pts.length : 0;
    c.beginPath();
    if (!n) { c.arc(q.x, q.y, q.r, 0, Math.PI * 2); return; }
    var last = pts[n - 1];
    c.moveTo(q.x + (last.x + pts[0].x) / 2, q.y + (last.y + pts[0].y) / 2);
    for (var i = 0; i < n; i++) {
      var p = pts[i], nx = pts[(i + 1) % n];
      c.quadraticCurveTo(q.x + p.x, q.y + p.y,
        q.x + (p.x + nx.x) / 2, q.y + (p.y + nx.y) / 2);
    }
    c.closePath();
  }
  function wedgePath(c, x, y, r, a1, a2) {
    c.beginPath(); c.moveTo(x, y); c.arc(x, y, r, a1, a2); c.closePath();
  }

  function Renderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = Math.min(2, root.devicePixelRatio || 1);
    canvas.width = Math.round(W * this.dpr);
    canvas.height = Math.round(H * this.dpr);
    this.specks = [];
    for (var i = 0; i < 260; i++) {
      this.specks.push({ x: hash('x' + i) * W, y: hash('y' + i) * H, r: 0.6 + hash('r' + i) * 1.8, a: 0.03 + hash('a' + i) * 0.05 });
    }
  }

  Renderer.prototype.draw = function (game, ui) {
    var c = this.ctx, t = (root.performance ? root.performance.now() : Date.now()) / 1000;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    this.drawGround(c, t);
    this.drawTerrains(c, game, t);
    this.drawBridges(c, game, t);
    this.drawFires(c, game, t);
    this.drawGas(c, game, t);
    this.drawPickups(c, game, t);
    this.drawRoutes(c, game, ui);
    this.drawVision(c, game, ui);
    this.drawFlameCones(c, game, t);
    this.drawUnits(c, game, ui);
    this.drawProjectiles(c, game);
    this.drawEffects(c, game, t);
    this.drawModeBanner(c, game, t);
    this.drawPreview(c, game, ui, t);
  };

  Renderer.prototype.drawGround = function (c, t) {
    c.fillStyle = '#e9e2d0';
    c.fillRect(0, 0, W, H);
    c.strokeStyle = 'rgba(80,90,70,0.075)';
    c.lineWidth = 1;
    c.beginPath();
    for (var x = 0; x <= W; x += 40) { c.moveTo(x + 0.5, 0); c.lineTo(x + 0.5, H); }
    for (var y = 0; y <= H; y += 40) { c.moveTo(0, y + 0.5); c.lineTo(W, y + 0.5); }
    c.stroke();
    for (var i = 0; i < this.specks.length; i++) {
      var s = this.specks[i];
      c.fillStyle = 'rgba(90,80,60,' + s.a + ')';
      c.beginPath(); c.arc(s.x, s.y, s.r, 0, Math.PI * 2); c.fill();
    }
    // 强制部署带：所有单位只能从这一侧出发
    var dz = D.CFG.deployZone;
    c.fillStyle = 'rgba(70,125,200,0.075)';
    c.fillRect(0, 0, dz, H);
    c.save();
    c.beginPath(); c.rect(0, 0, dz, H); c.clip();
    c.strokeStyle = 'rgba(70,125,200,0.10)'; c.lineWidth = 1;
    for (var sx = -H; sx < dz; sx += 18) {
      c.beginPath(); c.moveTo(sx, 0); c.lineTo(sx + H, H); c.stroke();
    }
    c.restore();
    c.strokeStyle = 'rgba(55,105,180,0.62)';
    c.setLineDash([9, 6]); c.lineWidth = 2;
    c.beginPath(); c.moveTo(dz + 0.5, 0); c.lineTo(dz + 0.5, H); c.stroke();
    c.setLineDash([]);
    c.save();
    c.translate(19, H / 2); c.rotate(-Math.PI / 2);
    c.fillStyle = 'rgba(40,85,150,0.78)';
    c.font = 'bold 13px "Microsoft YaHei", system-ui, sans-serif';
    c.textAlign = 'center';
    c.fillText('部署带 · 所有单位只能从左侧出发', 0, 0);
    c.restore();
    // 边框
    c.strokeStyle = 'rgba(60,70,55,0.28)'; c.lineWidth = 2;
    c.strokeRect(1, 1, W - 2, H - 2);
  };

  Renderer.prototype.drawTerrains = function (c, game, t) {
    var terrains = game.terrains, i, k;
    for (i = 0; i < terrains.length; i++) {
      var q = terrains[i];
      if (!q.alive) continue;
      if (q.type === 'river') {
        c.fillStyle = 'rgba(112,172,214,0.72)';
        c.fillRect(q.x, q.y, q.w, q.h);
        c.strokeStyle = 'rgba(60,125,175,0.55)'; c.lineWidth = 2;
        c.strokeRect(q.x, q.y, q.w, q.h);
        c.save();
        c.beginPath(); c.rect(q.x, q.y, q.w, q.h); c.clip();
        c.strokeStyle = 'rgba(255,255,255,0.32)'; c.lineWidth = 1.4;
        var vertical = q.h > q.w;
        if (vertical) {
          for (k = q.y + 14; k < q.y + q.h; k += 26) {
            c.beginPath();
            for (var vx = q.x; vx <= q.x + q.w; vx += 8) {
              var vy = k + Math.sin(vx * 0.055 + t * 1.2 + k) * 3.5;
              if (vx === q.x) c.moveTo(vx, vy); else c.lineTo(vx, vy);
            }
            c.stroke();
          }
        } else {
          for (k = q.x + 14; k < q.x + q.w; k += 26) {
            c.beginPath();
            for (var hy = q.y; hy <= q.y + q.h; hy += 8) {
              var hx = k + Math.sin(hy * 0.055 + t * 1.2 + k) * 3.5;
              if (hy === q.y) c.moveTo(hx, hy); else c.lineTo(hx, hy);
            }
            c.stroke();
          }
        }
        // 深水核心区（大体积地面单位无法进入）
        c.strokeStyle = 'rgba(35,95,150,0.30)';
        c.setLineDash([5, 6]); c.lineWidth = 1;
        c.strokeRect(q.x + 16, q.y + 16, Math.max(4, q.w - 32), Math.max(4, q.h - 32));
        c.setLineDash([]);
        c.restore();
        c.fillStyle = 'rgba(35,85,135,0.65)';
        c.font = 'bold 12px "Microsoft YaHei", system-ui, sans-serif';
        c.textAlign = 'left';
        c.fillText('河流 · 减速', q.x + 8, Math.max(18, q.y + 18));
      } else if (q.type === 'grass') {
        blobPath(c, q);
        c.fillStyle = 'rgba(150,196,110,0.62)'; c.fill();
        c.strokeStyle = 'rgba(95,145,70,0.60)'; c.lineWidth = 1.6;
        c.setLineDash([6, 6]); c.stroke(); c.setLineDash([]);
        for (k = 0; k < 22; k++) {
          var ga = hash(q.id + 'a' + k) * Math.PI * 2,
            gr = Math.sqrt(hash(q.id + 'b' + k)) * q.maxR * 0.92;
          var gx = q.x + Math.cos(ga) * gr, gy = q.y + Math.sin(ga) * gr;
          if (!game.terrainContains(q, gx, gy, -3)) continue;
          c.strokeStyle = 'rgba(75,125,55,0.62)'; c.lineWidth = 1.2;
          c.beginPath(); c.moveTo(gx, gy); c.lineTo(gx - 2, gy - 6); c.stroke();
          c.beginPath(); c.moveTo(gx, gy); c.lineTo(gx + 2, gy - 5); c.stroke();
        }
        label(c, '草丛 · 隐身', q.x, q.y - q.maxR - 6, '#3c6b32');
      } else if (q.type === 'forest') {
        blobPath(c, q);
        c.fillStyle = 'rgba(70,116,78,0.88)'; c.fill();
        c.strokeStyle = 'rgba(35,75,48,0.75)'; c.lineWidth = 2; c.stroke();
        for (k = 0; k < 15; k++) {
          var fa = hash(q.id + 'f' + k) * Math.PI * 2,
            fr = Math.sqrt(hash(q.id + 'g' + k)) * q.maxR * 0.80;
          var fx = q.x + Math.cos(fa) * fr, fy = q.y + Math.sin(fa) * fr;
          if (!game.terrainContains(q, fx, fy, -7)) continue;
          c.fillStyle = 'rgba(38,86,52,0.85)';
          c.beginPath(); c.arc(fx, fy, 8 + hash(q.id + 's' + k) * 5, 0, Math.PI * 2); c.fill();
          c.fillStyle = 'rgba(150,190,130,0.35)';
          c.beginPath(); c.arc(fx - 2, fy - 3, 3, 0, Math.PI * 2); c.fill();
        }
        label(c, '树林 · 阻挡', q.x, q.y - q.maxR - 6, '#2b5637');
      } else if (q.type === 'wall' || q.type === 'building') {
        var isBld = q.type === 'building';
        c.fillStyle = 'rgba(35,38,34,0.18)';
        c.fillRect(q.x + 4, q.y + 5, q.w, q.h);
        c.fillStyle = isBld ? '#bda07c' : '#9da1a9';
        c.fillRect(q.x, q.y, q.w, q.h);
        c.strokeStyle = isBld ? '#7c6346' : '#6c7078'; c.lineWidth = 2;
        c.strokeRect(q.x, q.y, q.w, q.h);
        c.save();
        c.beginPath(); c.rect(q.x, q.y, q.w, q.h); c.clip();
        if (isBld) {
          // 屋顶斜纹与窗格
          c.strokeStyle = 'rgba(120,94,62,0.32)'; c.lineWidth = 1;
          for (var hx = q.x - q.h; hx < q.x + q.w; hx += 12) {
            c.beginPath(); c.moveTo(hx, q.y + q.h); c.lineTo(hx + q.h, q.y); c.stroke();
          }
          c.fillStyle = 'rgba(70,90,115,0.72)';
          var cols = Math.max(1, Math.floor(q.w / 30)), rows = Math.max(1, Math.floor(q.h / 30));
          for (var wi = 0; wi < cols; wi++) for (var wj = 0; wj < rows; wj++) {
            c.fillRect(q.x + 8 + wi * (q.w - 12) / cols, q.y + 8 + wj * (q.h - 12) / rows, 9, 11);
          }
        } else {
          // 墙体砖缝
          c.strokeStyle = 'rgba(70,75,82,0.42)'; c.lineWidth = 1;
          for (var by = q.y + 9; by < q.y + q.h; by += 11) {
            c.beginPath(); c.moveTo(q.x, by); c.lineTo(q.x + q.w, by); c.stroke();
          }
          for (var bx = q.x + 12; bx < q.x + q.w; bx += 22) {
            c.beginPath(); c.moveTo(bx, q.y); c.lineTo(bx, q.y + q.h); c.stroke();
          }
        }
        c.restore();
        c.fillStyle = 'rgba(255,255,255,0.55)';
        c.fillRect(q.x + 2, q.y + 2, q.w - 4, 2);
        // 守巷中的建筑：琥珀色内框 + 守军数量
        if (isBld && q.alive) {
          var gc = game.countGarrison(q);
          if (gc > 0) {
            c.strokeStyle = 'rgba(200,140,50,0.95)'; c.lineWidth = 2.5;
            c.setLineDash([8, 5]);
            c.strokeRect(q.x + 4, q.y + 4, q.w - 8, q.h - 8);
            c.setLineDash([]);
            label(c, '守巷 × ' + gc, q.x + q.w / 2, q.y + q.h + 14, '#a8701a');
          }
        }
        // 结构损伤：裂纹 + 剩余结构条
        if (q.structHp !== undefined && q.structHp < q.maxStruct && q.alive) {
          var sf = Math.max(0, q.structHp / q.maxStruct);
          c.strokeStyle = 'rgba(50,38,28,0.55)'; c.lineWidth = 1.4;
          c.beginPath();
          c.moveTo(q.x + q.w * 0.2, q.y + q.h * 0.15);
          c.lineTo(q.x + q.w * 0.42, q.y + q.h * 0.5);
          c.lineTo(q.x + q.w * 0.3, q.y + q.h * 0.85);
          c.moveTo(q.x + q.w * 0.72, q.y + q.h * 0.1);
          c.lineTo(q.x + q.w * 0.62, q.y + q.h * 0.55);
          c.lineTo(q.x + q.w * 0.8, q.y + q.h * 0.9);
          c.stroke();
          var sbw = Math.max(30, q.w - 16);
          c.fillStyle = 'rgba(255,255,255,0.85)';
          c.fillRect(q.x + 8, q.y + q.h - 7, sbw, 4);
          c.fillStyle = sf > 0.5 ? '#c9903c' : '#c95645';
          c.fillRect(q.x + 8, q.y + q.h - 7, sbw * sf, 4);
        }
        label(c, isBld ? '建筑 · 遮挡 / 可守巷' : '墙体 · 遮挡', q.x + q.w / 2, q.y - 6,
          isBld ? '#6b5334' : '#5b6068');
      } else if (q.type === 'grave') {
        c.strokeStyle = 'rgba(120,105,145,0.45)'; c.lineWidth = 1.2;
        c.setLineDash([4, 6]);
        c.beginPath(); c.arc(q.x, q.y, 46, 0, Math.PI * 2); c.stroke();
        c.setLineDash([]);
        c.fillStyle = 'rgba(130,130,140,0.9)';
        c.beginPath();
        c.moveTo(q.x - 11, q.y + 12); c.lineTo(q.x - 11, q.y - 6);
        c.arc(q.x, q.y - 6, 11, Math.PI, 0);
        c.lineTo(q.x + 11, q.y + 12); c.closePath(); c.fill();
        c.strokeStyle = 'rgba(80,80,90,0.9)'; c.lineWidth = 1; c.stroke();
        c.strokeStyle = 'rgba(245,245,245,0.85)'; c.lineWidth = 2;
        c.beginPath(); c.moveTo(q.x, q.y - 12); c.lineTo(q.x, q.y + 4);
        c.moveTo(q.x - 5, q.y - 7); c.lineTo(q.x + 5, q.y - 7); c.stroke();
        label(c, '坟墓 · 骷髅', q.x, q.y + 30, '#5b4a72');
      }
      if (q.burning > 0) {
        var alpha = 0.35 + 0.2 * Math.sin(t * 9 + i);
        c.fillStyle = 'rgba(232,120,40,' + alpha + ')';
        if (q.type === 'river') c.fillRect(q.x, q.y, q.w, q.h);
        else { blobPath(c, q); c.fill(); }
        c.fillStyle = 'rgba(255,205,90,' + (0.35 + 0.25 * Math.sin(t * 12 + i)) + ')';
        for (k = 0; k < 6; k++) {
          var ba = hash(q.id + 'burn' + k) * Math.PI * 2,
            br = Math.sqrt(hash(q.id + 'burnr' + k)) * q.maxR * 0.85;
          var bx = q.x + Math.cos(ba) * br, by = q.y + Math.sin(ba) * br;
          if (!game.terrainContains(q, bx, by, -3)) continue;
          c.beginPath(); c.moveTo(bx, by - 8); c.lineTo(bx + 3.5, by); c.lineTo(bx - 3.5, by); c.closePath(); c.fill();
        }
      }
    }
  };

  /* 桥梁：双车道、残骸减速、损毁与修复倒计时 */
  Renderer.prototype.drawBridges = function (c, game, t) {
    for (var i = 0; i < game.bridges.length; i++) {
      var b = game.bridges[i], bridgeHorizontal = b.vertical; // 河流纵向 → 桥面水平跨越
      c.save();
      if (b.alive) {
        c.fillStyle = 'rgba(40,45,35,0.18)';
        c.fillRect(b.x + 3, b.y + 4, b.w, b.h);
        c.fillStyle = '#cdbb94';
        c.fillRect(b.x, b.y, b.w, b.h);
        c.strokeStyle = '#7c6a4c'; c.lineWidth = 2;
        c.strokeRect(b.x, b.y, b.w, b.h);
        // 桥面板条
        c.strokeStyle = 'rgba(120,100,70,0.32)'; c.lineWidth = 1;
        if (bridgeHorizontal) {
          for (var x = b.x + 8; x < b.x + b.w; x += 11) {
            c.beginPath(); c.moveTo(x, b.y + 3); c.lineTo(x, b.y + b.h - 3); c.stroke();
          }
        } else {
          for (var y = b.y + 8; y < b.y + b.h; y += 11) {
            c.beginPath(); c.moveTo(b.x + 3, y); c.lineTo(b.x + b.w - 3, y); c.stroke();
          }
        }
        // 两侧护栏
        c.strokeStyle = '#8a7554'; c.lineWidth = 3;
        c.beginPath();
        if (bridgeHorizontal) {
          c.moveTo(b.x, b.y + 3); c.lineTo(b.x + b.w, b.y + 3);
          c.moveTo(b.x, b.y + b.h - 3); c.lineTo(b.x + b.w, b.y + b.h - 3);
        } else {
          c.moveTo(b.x + 3, b.y); c.lineTo(b.x + 3, b.y + b.h);
          c.moveTo(b.x + b.w - 3, b.y); c.lineTo(b.x + b.w - 3, b.y + b.h);
        }
        c.stroke();
        // 中央双车道分隔虚线
        c.strokeStyle = 'rgba(255,255,255,0.65)'; c.lineWidth = 1.4;
        c.setLineDash([8, 7]);
        c.beginPath();
        if (bridgeHorizontal) { c.moveTo(b.x + 2, b.y + b.h / 2); c.lineTo(b.x + b.w - 2, b.y + b.h / 2); }
        else { c.moveTo(b.x + b.w / 2, b.y + 2); c.lineTo(b.x + b.w / 2, b.y + b.h - 2); }
        c.stroke(); c.setLineDash([]);
        label(c, '桥梁 · 双车道', b.x + b.w / 2, b.y - 7, '#6b5738');
        if (b.slow) {
          c.fillStyle = 'rgba(120,55,45,0.72)';
          c.font = 'bold 10px "Microsoft YaHei", system-ui, sans-serif'; c.textAlign = 'center';
          c.fillText('残骸 · 移速 -30%', b.x + b.w / 2, b.y + b.h + 14);
        }
        if (b.heat > 0.05) {
          var frac = Math.min(1, b.heat / 3.2);
          c.fillStyle = 'rgba(255,255,255,0.8)'; c.fillRect(b.x + 4, b.y + b.h - 8, b.w - 8, 4);
          c.fillStyle = 'rgba(214,90,45,0.9)';
          c.fillRect(b.x + 4, b.y + b.h - 8, (b.w - 8) * frac, 4);
        }
      } else {
        c.fillStyle = 'rgba(48,42,38,0.55)';
        c.fillRect(b.x, b.y, b.w, b.h);
        c.strokeStyle = 'rgba(30,26,24,0.85)'; c.lineWidth = 2;
        c.setLineDash([5, 5]); c.strokeRect(b.x, b.y, b.w, b.h); c.setLineDash([]);
        c.strokeStyle = 'rgba(235,130,70,0.85)'; c.lineWidth = 2;
        c.beginPath();
        if (bridgeHorizontal) {
          c.moveTo(b.x + b.w * 0.42, b.y); c.lineTo(b.x + b.w * 0.54, b.y + b.h * 0.4);
          c.lineTo(b.x + b.w * 0.44, b.y + b.h * 0.7); c.lineTo(b.x + b.w * 0.58, b.y + b.h);
        } else {
          c.moveTo(b.x, b.y + b.h * 0.42); c.lineTo(b.x + b.w * 0.4, b.y + b.h * 0.54);
          c.lineTo(b.x + b.w * 0.7, b.y + b.h * 0.44); c.lineTo(b.x + b.w, b.y + b.h * 0.58);
        }
        c.stroke();
        label(c, '桥梁损毁 · 修复 ' + Math.max(0, Math.ceil(b.repairT)) + 's',
          b.x + b.w / 2, b.y + b.h / 2 + 4, '#ffd9b0');
      }
      c.restore();
    }
  };

  Renderer.prototype.drawFires = function (c, game, t) {
    for (var i = 0; i < game.fires.length; i++) {
      var f = game.fires[i];
      if (f.r <= 0) continue;
      var g = c.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r);
      g.addColorStop(0, 'rgba(255,196,80,0.55)');
      g.addColorStop(0.55, 'rgba(240,120,40,0.34)');
      g.addColorStop(1, 'rgba(220,90,30,0)');
      c.fillStyle = g;
      c.beginPath(); c.arc(f.x, f.y, f.r, 0, Math.PI * 2); c.fill();
      for (var k = 0; k < 5; k++) {
        var a = hash('fire' + i + k) * Math.PI * 2, rr = Math.sqrt(hash('firer' + i + k)) * f.r * 0.7;
        var fx = f.x + Math.cos(a) * rr, fy = f.y + Math.sin(a) * rr;
        var h = 5 + Math.sin(t * 11 + i + k * 2) * 2.5;
        c.fillStyle = 'rgba(255,215,110,0.8)';
        c.beginPath(); c.moveTo(fx, fy - h); c.lineTo(fx + 3, fy); c.lineTo(fx - 3, fy); c.closePath(); c.fill();
      }
    }
  };

  Renderer.prototype.drawGas = function (c, game, t) {
    for (var i = 0; i < game.gas.length; i++) {
      var q = game.gas[i];
      var g = c.createRadialGradient(q.x, q.y, 0, q.x, q.y, q.r);
      g.addColorStop(0, 'rgba(126,168,86,0.36)');
      g.addColorStop(0.65, 'rgba(120,155,90,0.22)');
      g.addColorStop(1, 'rgba(110,150,90,0)');
      c.fillStyle = g;
      c.beginPath(); c.arc(q.x, q.y, q.r, 0, Math.PI * 2); c.fill();
      c.strokeStyle = 'rgba(90,135,70,0.28)'; c.lineWidth = 1;
      c.setLineDash([5, 7]); c.stroke(); c.setLineDash([]);
      for (var k = 0; k < 3; k++) {
        var a = t * 0.5 + k * 2.1 + i;
        var px = q.x + Math.cos(a) * q.r * 0.45, py = q.y + Math.sin(a) * q.r * 0.35;
        c.fillStyle = 'rgba(190,215,150,0.28)';
        c.beginPath(); c.arc(px, py, 7, 0, Math.PI * 2); c.fill();
      }
    }
  };

  Renderer.prototype.drawPickups = function (c, game, t) {
    for (var i = 0; i < game.pickups.length; i++) {
      var p = game.pickups[i], info = D.PICKUP_INFO[p.type];
      var bob = Math.sin(t * 3 + i) * 2.5;
      c.save(); c.translate(p.x, p.y + bob);
      c.fillStyle = 'rgba(255,255,255,0.75)';
      c.beginPath(); c.arc(0, 4, 15, 0, Math.PI * 2); c.fill();
      c.rotate(Math.PI / 4);
      c.fillStyle = info.color;
      c.fillRect(-9, -9, 18, 18);
      c.strokeStyle = 'rgba(255,255,255,0.9)'; c.lineWidth = 1.5;
      c.strokeRect(-9, -9, 18, 18);
      c.rotate(-Math.PI / 4);
      c.fillStyle = '#ffffff'; c.font = 'bold 11px "Microsoft YaHei", system-ui, sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(info.short, 0, 0);
      c.restore();
    }
    c.textBaseline = 'alphabetic';
  };

  Renderer.prototype.drawRoutes = function (c, game, ui) {
    var i, j;
    for (i = 0; i < game.units.length; i++) {
      var u = game.units[i];
      if (u.team !== 'player' || !u.route || !u.route.length) continue;
      var active = (ui.selectedUnitId === u.id);
      c.strokeStyle = active ? 'rgba(45,110,205,0.9)' : 'rgba(45,110,205,0.30)';
      c.lineWidth = active ? 2.2 : 1.4;
      c.setLineDash([7, 6]);
      c.beginPath();
      var sx = u.x, sy = u.y;
      if (game.phase === 'deploy') { sx = u.spawnX; sy = u.spawnY; }
      c.moveTo(sx, sy);
      for (j = u.routeIndex; j < u.route.length; j++) c.lineTo(u.route[j].x, u.route[j].y);
      c.stroke(); c.setLineDash([]);
      for (j = u.routeIndex; j < u.route.length; j++) {
        c.fillStyle = active ? '#2f6fd0' : 'rgba(47,111,208,0.5)';
        c.beginPath(); c.arc(u.route[j].x, u.route[j].y, active ? 4 : 3, 0, Math.PI * 2); c.fill();
      }
      var last = u.route[u.route.length - 1];
      c.strokeStyle = active ? '#2f6fd0' : 'rgba(47,111,208,0.45)'; c.lineWidth = 1.4;
      c.beginPath(); c.moveTo(last.x, last.y); c.lineTo(last.x, last.y - 13); c.stroke();
      c.fillStyle = active ? '#2f6fd0' : 'rgba(47,111,208,0.45)';
      c.beginPath(); c.moveTo(last.x, last.y - 13); c.lineTo(last.x + 9, last.y - 10);
      c.lineTo(last.x, last.y - 7); c.closePath(); c.fill();
    }
  };

  // 蓝色 = 视野 / 索敌范围（扇形或全向），橙色 = 攻击范围（圆环）
  function drawRangePair(c, u, col, fillA, strokeA, strong, game) {
    var x = u.x, y = u.y, v = game.effVision(u), r = game.effRange(u);
    // 视野扇形中心 = 单位朝向（移动时朝移动方向）；绘制与索敌判定使用同一个中心
    var center = (u.sightCenter !== null && u.sightCenter !== undefined) ? u.sightCenter : u.angle;
    var va = (u.sightWidth !== null && u.sightWidth !== undefined) ? u.sightWidth : u.def.visionAngle;
    // 超远视野（狙击镜等）进一步淡出填充，避免大扇形遮挡地形
    var fade = v > 340 ? 0.5 : 1;
    c.fillStyle = 'rgba(' + col + ',' + (fillA * fade).toFixed(3) + ')';
    c.strokeStyle = 'rgba(' + col + ',' + Math.min(0.9, strokeA + 0.12) + ')';
    c.lineWidth = strong ? 1.9 : 1;
    c.setLineDash(strong ? [] : [5, 7]);
    c.beginPath(); c.moveTo(x, y);
    if (va > 0) c.arc(x, y, v, center - va / 2, center + va / 2);
    else c.arc(x, y, v, 0, Math.PI * 2);
    c.closePath(); c.fill(); c.stroke();
    c.setLineDash([]);
    if (r > 0) {
      c.strokeStyle = strong ? 'rgba(206,102,48,0.88)' : 'rgba(206,102,48,0.44)';
      c.lineWidth = strong ? 2 : 1.1;
      c.setLineDash(strong ? [] : [4, 6]);
      c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.stroke();
      c.setLineDash([]);
    }
  }
  Renderer.prototype.drawVision = function (c, game, ui) {
    var focusId = ui.selectedUnitId || ui.hoverUnitId, i, u;
    // 敌方 / 中立：仅在悬停或点选时显示
    if (focusId) {
      for (i = 0; i < game.units.length; i++) {
        u = game.units[i];
        if (u.id === focusId && u.alive && u.team !== 'player') {
          drawRangePair(c, u, u.team === 'enemy' ? '212,80,70' : '130,120,150', 0.06, 0.55, true, game);
          break;
        }
      }
    }
    // 己方：全部单位全程展现
    for (i = 0; i < game.units.length; i++) {
      u = game.units[i];
      if (u.alive && u.team === 'player' && u.id !== focusId) drawRangePair(c, u, '47,111,208', 0.016, 0.24, false, game);
    }
    if (focusId) {
      for (i = 0; i < game.units.length; i++) {
        u = game.units[i];
        if (u.id === focusId && u.alive && u.team === 'player') {
          drawRangePair(c, u, '47,111,208', 0.075, 0.62, true, game);
          break;
        }
      }
    }
    // 图例
    c.fillStyle = 'rgba(255,255,255,0.82)';
    c.fillRect(W - 202, H - 29, 194, 21);
    c.strokeStyle = 'rgba(90,100,90,0.25)'; c.lineWidth = 1;
    c.strokeRect(W - 202, H - 29, 194, 21);
    c.font = '11px "Microsoft YaHei", system-ui, sans-serif'; c.textAlign = 'left';
    c.fillStyle = '#2f6fd0'; c.fillText('▣ 视野 / 索敌范围', W - 195, H - 14);
    c.fillStyle = '#c36630'; c.fillText('○ 攻击范围', W - 88, H - 14);
  };

  /* 喷火兵：连续绘制的窄角度火焰锥（多层渐变 + 火舌粒子 + 枪口闪光） */
  Renderer.prototype.drawFlameCones = function (c, game, t) {
    for (var i = 0; i < game.units.length; i++) {
      var u = game.units[i];
      if (!u.alive || !u.flameOn || u.riverBlocked) continue;
      var R = u.def.range, half = u.def.flameHalf || 0.30, a = u.angle;
      var phase = u.flamePhase || 0;
      c.save();
      wedgePath(c, u.x, u.y, R, a - half, a + half);
      c.clip();
      // 外层热浪
      var g = c.createRadialGradient(u.x, u.y, 4, u.x, u.y, R);
      g.addColorStop(0, 'rgba(255,242,180,0.62)');
      g.addColorStop(0.28, 'rgba(255,178,64,0.48)');
      g.addColorStop(0.68, 'rgba(238,106,38,0.28)');
      g.addColorStop(1, 'rgba(190,60,25,0)');
      c.fillStyle = g;
      c.fillRect(u.x - R, u.y - R, R * 2, R * 2);
      // 内层亮芯
      var g2 = c.createRadialGradient(u.x, u.y, 2, u.x, u.y, R * 0.82);
      g2.addColorStop(0, 'rgba(255,252,214,0.72)');
      g2.addColorStop(0.45, 'rgba(255,205,100,0.38)');
      g2.addColorStop(1, 'rgba(255,150,50,0)');
      c.fillStyle = g2;
      wedgePath(c, u.x, u.y, R * 0.9, a - half * 0.62, a + half * 0.62); c.fill();
      // 火舌粒子：沿锥方向向外流动
      for (var k = 0; k < 18; k++) {
        var seed = hash(u.id + 'f' + k);
        var frac = (phase * 1.7 + seed + k * 0.13) % 1;
        var ang = a + (hash(u.id + 'g' + k) * 2 - 1) * half * 0.94;
        var rr = R * (0.10 + 0.84 * frac);
        var px = u.x + Math.cos(ang) * rr, py = u.y + Math.sin(ang) * rr;
        var size = (1 - frac * 0.55) * (3.2 + hash(u.id + 's' + k) * 4.5);
        c.fillStyle = frac < 0.4 ? 'rgba(255,244,190,0.85)'
          : (frac < 0.75 ? 'rgba(255,178,70,0.72)' : 'rgba(226,92,38,0.48)');
        c.beginPath();
        c.ellipse(px, py, size * 1.5, size * 0.72, ang, 0, Math.PI * 2);
        c.fill();
      }
      c.restore();
      // 锥边与枪口闪光
      c.strokeStyle = 'rgba(255,164,72,0.42)'; c.lineWidth = 1.2;
      c.beginPath();
      c.moveTo(u.x, u.y); c.lineTo(u.x + Math.cos(a - half) * R, u.y + Math.sin(a - half) * R);
      c.moveTo(u.x, u.y); c.lineTo(u.x + Math.cos(a + half) * R, u.y + Math.sin(a + half) * R);
      c.stroke();
      var muzzle = c.createRadialGradient(u.x + Math.cos(a) * 12, u.y + Math.sin(a) * 12, 0,
        u.x + Math.cos(a) * 12, u.y + Math.sin(a) * 12, 13);
      muzzle.addColorStop(0, 'rgba(255,250,205,0.9)');
      muzzle.addColorStop(1, 'rgba(255,170,60,0)');
      c.fillStyle = muzzle;
      c.beginPath(); c.arc(u.x + Math.cos(a) * 12, u.y + Math.sin(a) * 12, 13, 0, Math.PI * 2); c.fill();
    }
  };

  Renderer.prototype.drawUnits = function (c, game, ui) {
    var t = (root.performance ? root.performance.now() : Date.now()) / 1000;
    for (var i = 0; i < game.units.length; i++) {
      var u = game.units[i];
      if (!u.alive) continue;
      if (!game.isKnown(u)) {
        // 困难迷雾：未被发现的敌人以半透明灰色轮廓提示（无血条 / 无标识）
        if (u.team !== 'enemy' && u.team !== 'neutral') continue;
        c.save();
        c.globalAlpha = 0.14;
        c.fillStyle = '#5a6270';
        c.beginPath(); c.arc(u.x, u.y, u.radius, 0, Math.PI * 2); c.fill();
        c.globalAlpha = 0.30;
        c.strokeStyle = '#5a6270'; c.lineWidth = 1;
        c.setLineDash([3, 4]);
        c.beginPath(); c.arc(u.x, u.y, u.radius + 4, 0, Math.PI * 2); c.stroke();
        c.setLineDash([]);
        c.restore();
        continue;
      }
      var r = u.radius;
      var base = u.team === 'player' ? '#3a76cf' :
        (u.team === 'enemy' ? '#d0554a' : (u.team === 'civilian' ? '#48a587' : '#8b829c'));
      var dark = u.team === 'player' ? '#1f4d94' :
        (u.team === 'enemy' ? '#8f2f2c' : (u.team === 'civilian' ? '#2c6f5b' : '#5b5470'));
      if (u.key === 'vampire') { base = '#7b2f63'; dark = '#3f1834'; }
      else if (u.zombie) { base = '#7e9c4a'; dark = '#48622b'; }
      c.save();
      c.globalAlpha = u.hidden ? 0.5 : 1;
      // 阴影
      c.fillStyle = 'rgba(40,45,35,0.18)';
      c.beginPath(); c.ellipse(u.x + 2, u.y + (u.def.size === 'air' ? 12 : 4), r + 3, r * 0.72, 0, 0, Math.PI * 2); c.fill();
      if (u.def.size === 'air') {
        c.strokeStyle = dark; c.lineWidth = 2;
        c.beginPath();
        c.moveTo(u.x - r - 10, u.y - 5); c.lineTo(u.x + r + 10, u.y - 5);
        c.moveTo(u.x - 4, u.y - r - 6); c.lineTo(u.x + 4, u.y - r - 6);
        c.stroke();
      }
      // 主体
      c.fillStyle = base;
      c.beginPath(); c.arc(u.x, u.y, r, 0, Math.PI * 2); c.fill();
      c.strokeStyle = dark; c.lineWidth = 2; c.stroke();
      c.fillStyle = 'rgba(255,255,255,0.16)';
      c.beginPath(); c.arc(u.x - r * 0.3, u.y - r * 0.35, r * 0.42, 0, Math.PI * 2); c.fill();
      // 朝向
      c.strokeStyle = '#ffffff'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(u.x, u.y);
      c.lineTo(u.x + Math.cos(u.angle) * (r + 6), u.y + Math.sin(u.angle) * (r + 6)); c.stroke();
      // 简称
      c.fillStyle = '#ffffff';
      c.font = 'bold ' + (r >= 17 ? 12 : 10) + 'px "Microsoft YaHei", system-ui, sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(u.def.short, u.x, u.y + 0.5);
      c.textBaseline = 'alphabetic';
      // 血条
      var bw = Math.max(22, r * 2 + 8), bx = u.x - bw / 2, by = u.y - r - 11;
      c.fillStyle = 'rgba(255,255,255,0.85)'; c.fillRect(bx - 1, by - 1, bw + 2, 5.5);
      c.fillStyle = '#5a6068'; c.fillRect(bx, by, bw, 3.5);
      var frac = Math.max(0, u.hp / u.maxHp);
      c.fillStyle = frac > 0.5 ? '#4ba35e' : (frac > 0.25 ? '#d8a03c' : '#cf4f45');
      c.fillRect(bx, by, bw * frac, 3.5);
      if (u.maxShield > 0 && u.shield > 0) {
        c.fillStyle = '#5aa8d8';
        c.fillRect(bx, by - 4, bw * (u.shield / u.maxShield), 2.5);
      }
      // 状态环
      if (u.hidden) {
        c.strokeStyle = 'rgba(70,130,60,0.85)'; c.lineWidth = 1.5;
        c.setLineDash([3, 3]);
        c.beginPath(); c.arc(u.x, u.y, r + 5, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
      }
      if (u.undead) {
        c.strokeStyle = '#9a6ec0'; c.lineWidth = 2;
        c.beginPath(); c.arc(u.x, u.y, r + 3, 0, Math.PI * 2); c.stroke();
      }
      if (u.def.boss) {
        c.strokeStyle = '#d9a83c'; c.lineWidth = 2.5;
        c.beginPath(); c.arc(u.x, u.y, r + 6, 0, Math.PI * 2); c.stroke();
        c.fillStyle = '#8f2f36'; c.font = 'bold 11px system-ui, sans-serif'; c.textAlign = 'center';
        c.fillText('BOSS', u.x, by - 8);
      }
      // 感染：绿色虚线环 + 倒戈倒计时
      if (u.infected) {
        c.strokeStyle = 'rgba(94,140,48,0.95)'; c.lineWidth = 2;
        c.setLineDash([3, 3]);
        c.beginPath(); c.arc(u.x, u.y, r + 7, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
        c.fillStyle = '#5c8a34'; c.font = 'bold 9px "Microsoft YaHei", system-ui, sans-serif';
        c.textAlign = 'center';
        c.fillText('感染 ' + Math.max(0, Math.ceil(u.infectT)) + 's', u.x, u.y - r - 16);
      }
      // 平民：白色保护环
      if (u.team === 'civilian') {
        c.strokeStyle = 'rgba(255,255,255,0.9)'; c.lineWidth = 1.4;
        c.beginPath(); c.arc(u.x, u.y, r + 4, 0, Math.PI * 2); c.stroke();
      }
      // 吸血鬼领主：紫色蝠翼 / 化蝠群 / 重整茧
      if (u.key === 'vampire') {
        if (u.batForm) {
          // 化蝠：环绕的小蝙蝠群 + 高亮轮廓
          c.strokeStyle = 'rgba(190,80,150,0.9)'; c.lineWidth = 2;
          c.setLineDash([4, 3]);
          c.beginPath(); c.arc(u.x, u.y, r + 8 + Math.sin(t * 10) * 2, 0, Math.PI * 2); c.stroke();
          c.setLineDash([]);
          c.fillStyle = 'rgba(80,26,64,0.85)';
          for (var bi = 0; bi < 5; bi++) {
            var ba2 = t * 6.5 + bi * 1.257, br2 = 17 + Math.sin(t * 9 + bi * 1.9) * 6;
            var bpx = u.x + Math.cos(ba2) * br2, bpy = u.y + Math.sin(ba2) * br2 * 0.62;
            var fl = Math.sin(t * 22 + bi) * 3.5;
            c.beginPath();
            c.moveTo(bpx, bpy - 3);
            c.lineTo(bpx - 6, bpy - 3 - fl);
            c.lineTo(bpx - 2, bpy + 1);
            c.lineTo(bpx + 2, bpy + 1);
            c.lineTo(bpx + 6, bpy - 3 - fl);
            c.closePath(); c.fill();
          }
          label(c, '化蝠 · 易伤', u.x, u.y + r + 24, '#8e3d6a');
        } else if (u.vstate === 'reform') {
          // 重整：静止的血茧与倒计时
          var pulse = 0.5 + 0.5 * Math.sin(t * 5);
          c.fillStyle = 'rgba(142,61,106,' + (0.22 + pulse * 0.18) + ')';
          c.beginPath(); c.arc(u.x, u.y, r + 12 + pulse * 5, 0, Math.PI * 2); c.fill();
          c.strokeStyle = 'rgba(142,61,106,0.85)'; c.lineWidth = 2.5;
          c.beginPath(); c.arc(u.x, u.y, r + 16, 0, Math.PI * 2); c.stroke();
          label(c, '重整 ' + Math.max(0, Math.ceil(u.reformT)) + 's', u.x, u.y + r + 26, '#8e3d6a');
        } else {
          c.fillStyle = 'rgba(109,43,87,0.55)';
          for (var wing = -1; wing <= 1; wing += 2) {
            var flap = Math.sin(t * 4) * 3;
            c.beginPath();
            c.moveTo(u.x + wing * r * 0.5, u.y);
            c.lineTo(u.x + wing * (r + 18), u.y - 13 - flap);
            c.lineTo(u.x + wing * (r + 10), u.y + 2);
            c.lineTo(u.x + wing * (r + 17), u.y + 12 + flap);
            c.lineTo(u.x + wing * r * 0.5, u.y + 5);
            c.closePath(); c.fill();
          }
          if (u.batCd > 0) {
            label(c, '化蝠 ' + Math.max(0, Math.ceil(u.batCd)) + 's', u.x, u.y + r + 24, '#9a5a8a');
          } else {
            // 冷却已转好：提示玩家领主随时可能化蝠突袭
            label(c, '化蝠就绪', u.x, u.y + r + 24, 'rgba(154,90,138,0.75)');
          }
        }
      }
      // 守巷单兵：建筑内的沙袋掩体环
      if (u.garrisonId) {
        c.strokeStyle = 'rgba(160,120,60,0.95)'; c.lineWidth = 3;
        c.setLineDash([7, 4]);
        c.beginPath(); c.arc(u.x, u.y, r + 7, 0, Math.PI * 2); c.stroke();
        c.setLineDash([]);
        label(c, '守巷', u.x, u.y + r + 16, '#8a6a3c');
      }
      if (ui.selectedUnitId === u.id) {
        c.strokeStyle = '#ffffff'; c.lineWidth = 2;
        c.setLineDash([4, 3]);
        c.beginPath(); c.arc(u.x, u.y, r + 9, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
      }
      // 抵达终点：提示可单击重划路线
      if (u.team === 'player' && u.arrived && game.phase === 'battle') {
        c.strokeStyle = 'rgba(215,150,45,0.9)'; c.lineWidth = 1.6;
        c.setLineDash([3, 4]);
        c.beginPath(); c.arc(u.x, u.y, r + 13, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
        c.fillStyle = '#a8701a'; c.font = 'bold 9px "Microsoft YaHei", system-ui, sans-serif';
        c.textAlign = 'center';
        c.fillText('可重划', u.x, u.y + r + 25);
      }
      // 特殊状态标记
      var marks = [];
      if (u.statuses.stun > 0) marks.push('晕');
      if (u.statuses.slow > 0) marks.push('缓');
      if (u.wallHack) marks.push('透');
      if (u.key === 'gunner' && u.state === 'deploy') marks.push('架');
      if (u.key === 'gunner' && u.state === 'pack') marks.push('收');
      if (u.key === 'jet' && u.state === 'return') marks.push('返');
      if (u.key === 'jet' && u.state === 'idle') marks.push('待');
      if (u.riverBlocked) marks.push('河');
      if (u.engaged) marks.push('战');
      if (u.alertT > 0) marks.push('警');
      if (u.garrisonId) marks.push('巷');
      if (u.batForm) marks.push('蝠');
      if (u.vstate === 'reform') marks.push('整');
      if (u.team === 'civilian' && u.fleeing) marks.push('逃');
      if (marks.length) {
        c.fillStyle = 'rgba(255,255,255,0.92)';
        c.font = 'bold 10px "Microsoft YaHei", system-ui, sans-serif'; c.textAlign = 'left';
        c.fillText(marks.join(''), u.x + r + 4, u.y - r - 2);
      }
      // 情报通报标记
      if (u.team !== 'player' && game.hasIntel(u.id)) {
        c.fillStyle = '#d8a13c';
        c.beginPath();
        c.moveTo(u.x, u.y - r - 26); c.lineTo(u.x + 6, u.y - r - 18);
        c.lineTo(u.x, u.y - r - 10); c.lineTo(u.x - 6, u.y - r - 18);
        c.closePath(); c.fill();
        c.fillStyle = '#ffffff'; c.font = 'bold 9px system-ui, sans-serif'; c.textAlign = 'center';
        c.fillText('!', u.x, u.y - r - 15);
      }
      // 弹药提示
      if (u.key === 'heli' && u.ammo !== null) {
        c.fillStyle = 'rgba(35,60,95,0.8)'; c.font = '10px system-ui, sans-serif'; c.textAlign = 'center';
        c.fillText(u.ammo + '发', u.x, u.y + r + 13);
      }
      if (u.key === 'jet') {
        c.fillStyle = 'rgba(35,60,95,0.8)'; c.font = '10px system-ui, sans-serif'; c.textAlign = 'center';
        c.fillText('导弹' + u.missiles, u.x, u.y + r + 13);
      }
      c.restore();
    }
  };

  Renderer.prototype.drawProjectiles = function (c, game) {
    for (var i = 0; i < game.projectiles.length; i++) {
      var p = game.projectiles[i];
      c.save(); c.translate(p.x, p.y); c.rotate(p.angle);
      c.fillStyle = 'rgba(240,150,70,0.35)';
      c.beginPath(); c.moveTo(-16, 0); c.lineTo(-4, -4); c.lineTo(-4, 4); c.closePath(); c.fill();
      c.fillStyle = '#5b6b7a';
      c.beginPath(); c.moveTo(7, 0); c.lineTo(-5, -4); c.lineTo(-5, 4); c.closePath(); c.fill();
      c.fillStyle = '#ef9a4a';
      c.beginPath(); c.arc(-7, 0, 3, 0, Math.PI * 2); c.fill();
      c.restore();
    }
  };

  Renderer.prototype.drawEffects = function (c, game, t) {
    for (var i = 0; i < game.effects.length; i++) {
      var e = game.effects[i];
      var p = Math.min(1, e.t / (e.ttl || 0.6));
      if (e.type === 'tracer') {
        c.strokeStyle = rgba(e.color || '#3b78d4', 1 - p);
        c.lineWidth = 2.2;
        c.beginPath(); c.moveTo(e.x1, e.y1); c.lineTo(e.x2, e.y2); c.stroke();
      } else if (e.type === 'spark') {
        c.fillStyle = rgba(e.color || '#ffffff', 1 - p);
        c.beginPath(); c.arc(e.x, e.y, 3 + p * 7, 0, Math.PI * 2); c.fill();
      } else if (e.type === 'blast') {
        c.strokeStyle = rgba(e.color || '#e89a52', 0.85 * (1 - p));
        c.lineWidth = 3 * (1 - p) + 1;
        c.beginPath(); c.arc(e.x, e.y, e.r * (0.2 + p * 0.9), 0, Math.PI * 2); c.stroke();
        var g = c.createRadialGradient(e.x, e.y, 0, e.x, e.y, e.r * (0.35 + p * 0.7));
        g.addColorStop(0, rgba(e.color || '#e89a52', 0.35 * (1 - p)));
        g.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g;
        c.beginPath(); c.arc(e.x, e.y, e.r * (0.35 + p * 0.7), 0, Math.PI * 2); c.fill();
      } else if (e.type === 'text') {
        c.globalAlpha = 1 - p;
        c.fillStyle = e.color || '#ffffff';
        c.font = 'bold 13px "Microsoft YaHei", system-ui, sans-serif'; c.textAlign = 'center';
        c.fillText(e.text, e.x, e.y - p * 22);
        c.globalAlpha = 1;
      } else if (e.type === 'death') {
        c.strokeStyle = rgba(e.team === 'player' ? '#3a76cf' : '#d0554a', 0.75 * (1 - p));
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(e.x - 7 - p * 5, e.y - 7 - p * 5); c.lineTo(e.x + 7 + p * 5, e.y + 7 + p * 5);
        c.moveTo(e.x + 7 + p * 5, e.y - 7 - p * 5); c.lineTo(e.x - 7 - p * 5, e.y + 7 + p * 5);
        c.stroke();
      } else if (e.type === 'strike') {
        var remain = Math.max(0, e.delay - e.t);
        c.strokeStyle = 'rgba(205,70,55,0.9)'; c.lineWidth = 2.5;
        c.setLineDash([9, 7]);
        c.beginPath(); c.arc(e.x, e.y, e.r, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
        c.fillStyle = 'rgba(205,70,55,0.09)'; c.fill();
        c.strokeStyle = 'rgba(205,70,55,0.8)'; c.lineWidth = 2;
        c.beginPath();
        c.moveTo(e.x - 14, e.y); c.lineTo(e.x + 14, e.y);
        c.moveTo(e.x, e.y - 14); c.lineTo(e.x, e.y + 14); c.stroke();
        if (!e.done) {
          c.fillStyle = '#b93f34'; c.font = 'bold 16px system-ui, sans-serif'; c.textAlign = 'center';
          c.fillText(remain.toFixed(1), e.x, e.y - 6);
        }
      } else if (e.type === 'meteor') {
        c.strokeStyle = 'rgba(180,90,45,0.8)'; c.lineWidth = 3;
        c.beginPath(); c.arc(e.x, e.y, 34 + p * 12, 0, Math.PI * 2); c.stroke();
        if (!e.done) {
          var fall = 1 - Math.min(1, e.t / e.delay);
          c.fillStyle = '#c9542f';
          c.beginPath(); c.arc(e.x + 120 * fall, e.y - 260 * fall, 12, 0, Math.PI * 2); c.fill();
          c.strokeStyle = 'rgba(230,150,80,0.6)'; c.lineWidth = 8;
          c.beginPath(); c.moveTo(e.x + 120 * fall, e.y - 260 * fall);
          c.lineTo(e.x + 120 * fall + 22, e.y - 260 * fall - 45); c.stroke();
        }
      } else if (e.type === 'reveal') {
        c.strokeStyle = 'rgba(60,130,200,' + (0.8 * (1 - p)) + ')'; c.lineWidth = 3;
        c.beginPath(); c.arc(e.x, e.y, e.r * (0.3 + p * 0.75), 0, Math.PI * 2); c.stroke();
      }
    }
  };

  /* 模式状态横幅：难度 / 感染 / 守夜进度 */
  Renderer.prototype.drawModeBanner = function (c, game, t) {
    var bx = 268, by = 8, bw = W - bx - 16, bh = 30;
    c.save();
    c.fillStyle = 'rgba(255,255,255,0.88)';
    c.fillRect(bx, by, bw, bh);
    c.strokeStyle = game.difficulty === 'hard' ? 'rgba(201,80,69,0.45)' : 'rgba(90,110,140,0.28)';
    c.lineWidth = 1; c.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
    var head = game.modeCfg.name + ' · ' + game.diffCfg.name;
    c.fillStyle = game.difficulty === 'hard' ? '#b5443a' : '#2f6fd0';
    c.font = 'bold 12px "Microsoft YaHei", system-ui, sans-serif';
    c.textAlign = 'left';
    c.fillText(head, bx + 10, by + 19);
    var info = '', col = '#5b6877';
    if (game.mode === 'vampire') {
      var secs = Math.max(0, Math.ceil(game.timeLeft));
      var mm = secs >= 60 ? Math.floor(secs / 60) : 0, ss = secs % 60;
      info = '距日出 ' + (mm ? mm + ':' : '') + (ss < 10 && mm ? '0' : '') + ss +
        ' · 平民 ' + (game.civilianTotal - game.civilianLost) + '/' + game.civilianTotal + ' 幸存';
      var boss = null;
      for (var vb = 0; vb < game.units.length; vb++) {
        if (game.units[vb].alive && game.units[vb].key === 'vampire') { boss = game.units[vb]; break; }
      }
      if (boss) {
        info += ' · 领主 ' + Math.max(0, Math.round(boss.hp)) + '/' + boss.maxHp +
          ' · 吸血 ' + Math.round(boss.lifesteal * 100) + '%' +
          (boss.reformCount ? ' · 已重整 ' + boss.reformCount + ' 次' : '');
      } else {
        info += ' · 领主已被消灭';
      }
      col = '#9a5a2c';
    } else if (game.mode === 'infection') {
      var inf = 0;
      for (var i = 0; i < game.units.length; i++) if (game.units[i].alive && game.units[i].infected) inf++;
      info = '感染中 ' + inf + ' · 已倒戈 ' + game.turnedCount + ' · 医疗包可治愈';
      col = '#5c8a34';
    }
    if (game.difficulty === 'hard') {
      var unknown = 0;
      for (var j = 0; j < game.units.length; j++) {
        var e = game.units[j];
        if (e.alive && e.team === 'enemy' && !game.isKnown(e)) unknown++;
      }
      info += (info ? '　|　' : '') + '敌方 HP×2 / 攻速 +18% · 视线自左向右 · 未发现敌人 ' + unknown;
      col = '#b5443a';
    } else if (!info) {
      info = '发现且进入射程才停下 · 抵达终点可单击重划路线';
    }
    c.fillStyle = col;
    c.font = '11px "Microsoft YaHei", system-ui, sans-serif';
    c.textAlign = 'right';
    c.fillText(info, bx + bw - 10, by + 19);
    if (game.mode === 'vampire') {
      var frac = clamp01(game.elapsed / game.timeLimit);
      c.fillStyle = 'rgba(230,190,120,0.35)'; c.fillRect(bx + 2, by + bh - 4, bw - 4, 3);
      var grd = c.createLinearGradient(bx, 0, bx + bw, 0);
      grd.addColorStop(0, '#7a5bb0'); grd.addColorStop(0.6, '#d28a4a'); grd.addColorStop(1, '#f2c96a');
      c.fillStyle = grd; c.fillRect(bx + 2, by + bh - 4, (bw - 4) * frac, 3);
      // 日出图标随时间变亮
      c.fillStyle = 'rgba(242,190,90,' + (0.35 + 0.55 * frac) + ')';
      c.beginPath(); c.arc(bx + bw - 10, by + bh - 2.5, 4 + frac * 3, 0, Math.PI * 2); c.fill();
    }
    c.restore();
  };
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

  Renderer.prototype.drawPreview = function (c, game, ui, t) {
    if (!ui.pending) return;
    var p = ui.pending;
    c.strokeStyle = 'rgba(215,150,45,0.9)'; c.lineWidth = 2;
    c.setLineDash([8, 5]);
    c.beginPath(); c.moveTo(p.x, p.y);
    for (var i = 0; i < p.route.length; i++) c.lineTo(p.route[i].x, p.route[i].y);
    if (ui.hover) c.lineTo(ui.hover.x, ui.hover.y);
    c.stroke(); c.setLineDash([]);
    c.fillStyle = '#d79a2d';
    c.beginPath(); c.arc(p.x, p.y, 5, 0, Math.PI * 2); c.fill();
    for (var j = 0; j < p.route.length; j++) {
      c.fillStyle = '#d79a2d';
      c.beginPath(); c.arc(p.route[j].x, p.route[j].y, 4, 0, Math.PI * 2); c.fill();
    }
    // 放置点预演 / 重划路线提示
    var def = D.UNIT_DEFS[p.key];
    if (p.mode === 'repath') {
      c.strokeStyle = 'rgba(215,150,45,0.85)'; c.lineWidth = 1.5;
      c.beginPath(); c.arc(p.x, p.y, 16 + Math.sin(t * 5) * 1.5, 0, Math.PI * 2); c.stroke();
      c.fillStyle = '#a8701a'; c.font = 'bold 12px "Microsoft YaHei", system-ui, sans-serif';
      c.textAlign = 'center';
      c.fillText('重划路线 · 点击添加路点，双击/回车完成', p.x, p.y - 26);
    } else if (def) {
      c.strokeStyle = 'rgba(215,150,45,0.85)'; c.lineWidth = 1.5;
      c.beginPath(); c.arc(p.x, p.y, def.radius + 5 + Math.sin(t * 5) * 1.5, 0, Math.PI * 2); c.stroke();
      c.fillStyle = 'rgba(215,150,45,0.9)'; c.font = 'bold 12px "Microsoft YaHei", system-ui, sans-serif';
      c.textAlign = 'center';
      c.fillText(def.name + ' · 点击添加路点，双击/回车完成', p.x, p.y - def.radius - 14);
    }
  };

  root.Renderer = Renderer;
})(typeof window !== 'undefined' ? window : globalThis);
