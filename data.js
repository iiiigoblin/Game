/* 数据层：单位、技能、地形与地图预设。纯数据，不依赖 DOM。 */
(function (root) {
  'use strict';

  var WORLD = { w: 1200, h: 700 };

  // size: soldier 单兵 / heavy 大体积地面 / air 空中
  // armor: 伤害减免比例。单兵血量统一在 100 上下，差异主要体现在减伤；大体积单位血量按体积放大。
  var UNIT_DEFS = {
    /* ---------- 可派遣兵种 ---------- */
    scout: {
      key: 'scout', name: '侦察兵', short: '侦', cost: 1, cat: 'unit', size: 'soldier', radius: 9,
      hp: 100, armor: 0.10, speed: 62, vision: 320, visionAngle: 2.6, range: 20,
      damage: 10, rate: 1.0, attack: 'melee', color: '#2f6fd0', antiAir: false,
      tags: ['单兵', '广域视野', '透视墙', '处决', '毒匕首', '不可对空'],
      desc: '视野广且远；朝墙注视 1.5 秒后可看透墙后并通报敌人；毒匕首仅在体积碰撞时生效；未被任何敌方单位看见时，可处决血量低于 50 的目标。近战兵器摸不到空中单位。'
    },
    bot: {
      key: 'bot', name: '自爆机器人', short: '爆', cost: 1, cat: 'unit', size: 'soldier', radius: 9,
      hp: 90, armor: 0.00, speed: 118, vision: 260, visionAngle: 0, range: 260,
      damage: 170, rate: 0, attack: 'suicide', color: '#3f8fbf', antiAir: false,
      tags: ['单兵', '穿墙扫描', '位置通报', '追猎', '自爆', '不可对空'],
      desc: '移速快；260 范围穿墙扫描索敌并持续向队友通报位置；索敌后放弃原路线寻路跟随，扫描到更近目标则改换目标；体积碰撞后自爆，造成一次性高额伤害并灼烧地形。无法触及空中单位。'
    },
    flamer: {
      key: 'flamer', name: '喷火兵', short: '焰', cost: 1.5, cat: 'unit', size: 'soldier', radius: 9,
      hp: 78, armor: 0.00, speed: 46, vision: 255, visionAngle: 1.55, range: 104,
      flameHalf: 0.30, damage: 52, rate: 0, attack: 'flame', color: '#e07a3c', antiAir: false,
      tags: ['单兵', '窄锥火焰', '点燃地形', '河流禁用', '死亡自爆', '不可对空'],
      desc: '255 范围索敌、窄角度火焰锥持续伤害，可点燃草丛与树林；遇敌停下喷火，清空视野内目标才继续行进；血量低、背负燃料导致移速低；身处河流时无法攻击；被击败后自爆并灼烧附近一段时间。'
    },
    blade: {
      key: 'blade', name: '刀客', short: '刀', cost: 1.5, cat: 'unit', size: 'soldier', radius: 9,
      hp: 100, armor: 0.45, speed: 96, vision: 190, visionAngle: 2.2, range: 22,
      damage: 24, rate: 1.5, attack: 'melee', color: '#4a80c8', antiAir: false,
      tags: ['单兵', '高减伤', '近战', '斩杀', '减速', '不可对空'],
      desc: '可格挡的近战兵器带来高减伤；移速快；对血量低于一半的目标造成 1.7 倍伤害并施加减速；攻击距离很短，且无法攻击空中单位。'
    },
    sergeant: {
      key: 'sergeant', name: '士官', short: '士', cost: 2, cat: 'unit', size: 'soldier', radius: 9,
      hp: 100, armor: 0.20, speed: 68, vision: 220, visionAngle: 2.2, range: 170,
      damage: 12, rate: 1.2, attack: 'hitscan', color: '#3568b8',
      tags: ['单兵', '攻速光环', '费用增益'],
      desc: '160 范围内己方单位攻速 +25%；当自身未被任何敌方单位发现时，费用自然回复速度 +0.18/秒（可叠加）。'
    },
    gunner: {
      key: 'gunner', name: '机枪手', short: '机', cost: 2.5, cat: 'unit', size: 'soldier', radius: 10,
      hp: 100, armor: 0.15, speed: 56, vision: 270, visionAngle: 2.4, range: 300,
      damage: 9, rate: 10, attack: 'hitscan', shield: 60, color: '#2c5fae',
      tags: ['单兵', '架设 2 秒', '高攻速', '护盾', '收枪 2 秒'],
      desc: '遇敌原地停下，2 秒架起机枪进入高攻速射击，护盾在射击中缓慢恢复；消灭视野内全部敌人后花 2 秒收枪，再沿原路线继续移动。'
    },
    sniper: {
      key: 'sniper', name: '狙击手', short: '狙', cost: 3, cat: 'unit', size: 'soldier', radius: 9,
      hp: 100, armor: 0.05, speed: 54, vision: 440, visionAngle: 0.55, range: 400,
      damage: 96, rate: 0.45, attack: 'hitscan', color: '#2a55a0',
      tags: ['单兵', '窄视野', '超远射程', '高伤慢速'],
      desc: '狙击镜带来极远但很窄的视野与射程；单发伤害高、攻速慢；子弹可越过树林，但自身视野会被树林遮挡，需依靠队友通报。'
    },
    gas: {
      key: 'gas', name: '毒气兵', short: '毒', cost: 3, cat: 'unit', size: 'soldier', radius: 10,
      hp: 110, armor: 0.65, speed: 82, vision: 180, visionAngle: 2.0, range: 84,
      damage: 26, rate: 0.7, attack: 'hitscan', color: '#6f9a4a',
      noHold: true,
      tags: ['单兵', '永不驻足', '高额免伤', '毒雾轨迹', '拖拽', '死亡毒云'],
      desc: '高额免伤，移速中等偏高；行进路径不断留下小范围毒雾；攻击范围中等偏近、攻速慢，每一击将单兵敌人略拖向自己；死亡留下大范围毒雾，缓慢扩散、伤害衰减，期间费用回复降低。无论是否被高血量目标缠住都不停机，始终按计划路线推进以扩大毒雾覆盖。'
    },
    apc: {
      key: 'apc', name: '装甲车', short: '甲', cost: 3, cat: 'unit', size: 'heavy', radius: 18,
      hp: 360, armor: 0.35, speed: 58, vision: 250, visionAngle: 2.2, range: 260,
      damage: 15, rate: 4, attack: 'hitscan', color: '#3b6ea8',
      vehicle: true, crush: true, holdAttackers: 2,
      tags: ['大体积', '来回碾压', '碰撞伤害', '推挤载具', '多源受击才停'],
      desc: '大体积地面载具。持续按路线推进并射击，只有当短时间内受到不止一名非友方单位攻击时才会停下交战；车身完全覆盖单兵时持续碾压，撞击单兵造成高额碰撞伤害并可来回碾压；对体积小于自身的载具产生推挤。无法通过树林，只能进入河流浅滩而无法深入深水区。'
    },
    necro: {
      key: 'necro', name: '死灵法师', short: '灵', cost: 2.5, cat: 'unit', size: 'soldier', radius: 9,
      hp: 96, armor: 0.15, speed: 58, vision: 200, visionAngle: 2.0, range: 0,
      damage: 0, rate: 0, attack: 'none', color: '#8465a8',
      tags: ['每局一个', '终点复活', '亡灵衰减', '吸血'],
      desc: '每局仅可派遣一次，无攻击能力。抵达路线终点时复活周围 220 范围内所有单兵尸体，复活者仅有生前四分之一血量且持续自然衰减，但获得 100% 攻击吸血。'
    },
    heli: {
      key: 'heli', name: '直升机', short: '直', cost: 3.5, cat: 'unit', size: 'air', radius: 16,
      hp: 240, armor: 0.25, speed: 88, vision: 290, visionAngle: 2.4, range: 300,
      damage: 11, rate: 6, attack: 'hitscan', ammo: 60, color: '#3a78b4',
      tags: ['空中', '跨越一切地形', '强制暴露', '弹药 60', '坠毁误伤'],
      desc: '可跨越任何地形；射速中等的机枪；无论敌方视野如何，260 范围内的敌人必定发现它；被击败后坠毁，对附近单位造成伤害且不分敌我；弹药耗尽后降落，生成半血士官与轻机枪兵。'
    },
    jet: {
      key: 'jet', name: '战斗机', short: '战', cost: 4, cat: 'unit', size: 'air', radius: 15,
      hp: 210, armor: 0.20, speed: 132, vision: 330, visionAngle: 1.8, range: 320,
      damage: 9, rate: 8, attack: 'hitscan', missiles: 4, color: '#2f6ba8',
      tags: ['空中', '无限机枪弹药', '4 枚追踪导弹', '返航补给'],
      desc: '机枪射速更快且弹药无限；携带 4 枚低攻速、小范围伤害的追踪导弹；四枚发射完毕后直接返回出发点待命，可花费 2.0 费（每枚 0.5 费）补满后重新出击。'
    },
    defector: {
      key: 'defector', name: '降军', short: '降', cost: 0, cat: 'unit', size: 'soldier', radius: 9,
      hp: 42, armor: 0.00, speed: 96, vision: 340, visionAngle: 0, range: 0,
      damage: 0, rate: 0, attack: 'none', color: '#b58a3c',
      tags: ['条件获得', '0 费', '情报揭示'],
      desc: '击杀数超过敌方初始单位数的一半时获得 1 个。派遣时指定其阵亡地点：立即揭示该点周围 340 范围内所有敌人的位置（含草丛、墙后隐身目标），持续 10 秒。'
    },

    /* ---------- 派生 / 不可直接派遣 ---------- */
    lightGunner: {
      key: 'lightGunner', name: '轻机枪兵', short: '轻', cost: 0, cat: 'derived', size: 'soldier', radius: 9,
      hp: 50, armor: 0.15, speed: 62, vision: 230, visionAngle: 2.2, range: 220,
      damage: 8, rate: 6, attack: 'hitscan', color: '#4a7ab4',
      tags: ['派生单位', '半血'],
      desc: '直升机弹药耗尽降落后生成的单位之一，只有标准血量的一半。'
    },
    skeleton: {
      key: 'skeleton', name: '骷髅兵', short: '骨', cost: 0, cat: 'derived', size: 'soldier', radius: 8,
      hp: 45, armor: 0.00, speed: 66, vision: 200, visionAngle: 0, range: 28,
      damage: 9, rate: 1.2, attack: 'melee', color: '#8c8496', antiAir: false,
      tags: ['中立', '无差别攻击', '坟墓生成', '不可对空'],
      desc: '由坟墓自然生成的弱小单位，在坟墓附近巡逻并无差别攻击所有阵营（不含平民）。对局中死亡单位越多，可同时存在的数量越大，最多 6 个。无法攻击空中单位。'
    },
    zombie: {
      key: 'zombie', name: '感染体', short: '尸', cost: 0, cat: 'derived', size: 'soldier', radius: 9,
      hp: 120, armor: 0.10, speed: 54, vision: 250, visionAngle: 2.4, range: 24,
      damage: 16, rate: 1.1, attack: 'melee', color: '#78984a', energyReward: 1.0,
      zombie: true, antiAir: false,
      tags: ['感染转化', '近战', '传播感染', '不可对空'],
      desc: '己方单兵被感染后转化而成，转为敌方并扑向最近的活体；其攻击会加速感染其他己方单兵。丧尸摸不到天上的飞机——对空中单位毫无办法。'
    },
    civilian: {
      key: 'civilian', name: '平民', short: '民', cost: 0, cat: 'derived', size: 'soldier', radius: 8,
      hp: 110, armor: 0.05, speed: 50, vision: 150, visionAngle: 0, range: 0,
      damage: 0, rate: 0, attack: 'none', color: '#48a587', civilian: true,
      tags: ['需保护', '视野 150', '遇敌逃离'],
      desc: '吸血鬼之夜中左侧村镇的居民，没有攻击能力。视野 150，发现敌方逼近后会以中等偏慢的速度向反方向逃窜（会沿边缘滑动避免被逼进死角），但不会逃出村界；只有敌方推进到部署区内攻击才会遇害。被击杀超过一半即守卫失败。'
    },
    thrall: {
      key: 'thrall', name: '血仆', short: '仆', cost: 0, cat: 'enemy', size: 'soldier', radius: 9,
      hp: 150, armor: 0.20, speed: 68, vision: 270, visionAngle: 2.4, range: 26,
      damage: 18, rate: 1.2, attack: 'melee', color: '#8e3d6a', energyReward: 1.4, antiAir: false,
      tags: ['敌方', '右→左推进', '追猎平民', '不可对空'],
      desc: '吸血鬼之夜的爪牙，从战场右侧出发按路线向左推进，遇敌停下攻击，清场后继续，并会持续扑向左侧的平民。近战爪牙无法攻击空中单位。'
    },
    vampire: {
      key: 'vampire', name: '吸血鬼领主', short: '血', cost: 0, cat: 'enemy', size: 'heavy', radius: 22,
      hp: 2800, armor: 0.35, speed: 52, vision: 330, visionAngle: 2.5, range: 44,
      damage: 72, rate: 0.9, attack: 'melee', color: '#6d2b57', boss: true,
      lifesteal: 0.7, crush: true, energyReward: 6.0, antiAir: false,
      tags: ['BOSS', '超高血量', '近距高伤', '吸血成长', '化蝠', '重整衰减'],
      desc: '吸血鬼之夜的首领，血量极高，自右向左推进。近距高伤普攻，初始吸血 70%。内置约 30 秒冷却的「化蝠」：长距离飞越一切障碍直扑猎物，期间受伤增加、受击减速。击杀单兵且自身未被骚扰时，会将受害者转化为血仆。血量被打空后化作脆弱蝠群退往右侧重整（重整期间静止不动）：每次重整最大生命值降低当前的 20%，但吸血率提升 15%——重整次数越多越容易被击杀，也可能在化蝠途中被彻底消灭。'
    },

    /* ---------- 敌方单位 ---------- */
    raider: {
      key: 'raider', name: '流寇', short: '寇', cost: 0, cat: 'enemy', size: 'soldier', radius: 9,
      hp: 100, armor: 0.10, speed: 54, vision: 250, visionAngle: 2.0, range: 200,
      damage: 10, rate: 1.1, attack: 'hitscan', energyReward: 1.2, color: '#c9564c',
      tags: ['敌方'], desc: '驻守型敌方步兵。'
    },
    brute: {
      key: 'brute', name: '重甲兵', short: '重', cost: 0, cat: 'enemy', size: 'soldier', radius: 11,
      hp: 130, armor: 0.42, speed: 42, vision: 210, visionAngle: 2.2, range: 90,
      damage: 17, rate: 0.9, attack: 'hitscan', energyReward: 2.0, color: '#b4483f',
      tags: ['敌方', '高减伤'], desc: '高减伤的敌方近中程单位。'
    },
    marksman: {
      key: 'marksman', name: '敌方狙击手', short: '敌狙', cost: 0, cat: 'enemy', size: 'soldier', radius: 9,
      hp: 90, armor: 0.05, speed: 44, vision: 380, visionAngle: 0.9, range: 350,
      damage: 42, rate: 0.5, attack: 'hitscan', energyReward: 2.0, color: '#a83f4a',
      tags: ['敌方', '远程'], desc: '视野窄但射程远的敌方射手。'
    },
    enemyApc: {
      key: 'enemyApc', name: '敌方装甲车', short: '敌甲', cost: 0, cat: 'enemy', size: 'heavy', radius: 18,
      hp: 340, armor: 0.35, speed: 50, vision: 250, visionAngle: 2.2, range: 240,
      damage: 13, rate: 3.2, attack: 'hitscan', energyReward: 2.8, color: '#a34540',
      vehicle: true, crush: true, holdAttackers: 2,
      tags: ['敌方', '大体积', '来回碾压'], desc: '敌方大体积装甲载具，可碾压单兵并推挤更小的载具。'
    },
    warlord: {
      key: 'warlord', name: '据点指挥官', short: 'BOSS', cost: 0, cat: 'enemy', size: 'heavy', radius: 24,
      hp: 900, armor: 0.30, speed: 30, vision: 330, visionAngle: 0, range: 250,
      damage: 24, rate: 1.3, attack: 'hitscan', energyReward: 5.0, color: '#8f2f36', boss: true,
      crush: true,
      tags: ['BOSS', '高血量', '碾压'], desc: '据点首领。天命所归无法直接击败，只会造成三成血量伤害并晕眩 3 秒。'
    }
  };

  var SKILLS = {
    strike: {
      key: 'strike', name: '呼叫打击', short: '击', cost: 4.5,
      tags: ['面积伤害', '摧毁地形', '1.1 秒延迟'],
      desc: '指定一片区域，1.1 秒后造成半径 130 的一次性大量伤害，并摧毁范围内大多数地形（草丛、树林、坟墓）。'
    },
    meteor: {
      key: 'meteor', name: '天命所归', short: '陨', cost: 6,
      tags: ['斩杀', 'BOSS 克制', '晕眩'],
      desc: '点选一个敌方单位召唤陨石：非 BOSS 单位直接击败；对 BOSS 造成其最大血量 30% 的伤害并晕眩 3 秒。'
    }
  };

  var PLAYABLE = ['scout', 'bot', 'flamer', 'blade', 'sergeant', 'gunner', 'sniper', 'gas', 'apc', 'necro', 'heli', 'jet', 'defector'];

  var TERRAIN_INFO = {
    river: { name: '河流', desc: '范围内单位移速降低；喷火兵无法攻击；装甲车等大体积地面单位只能停留在浅滩，无法深入深水区。' },
    bridge: { name: '桥梁', desc: '横贯战场的河流自动生成桥梁，宽度刚好容纳两辆装甲车并排通过。桥上有单位阵亡后，后续单位在桥上移速降低 30%；桥上累积一定量燃烧或爆炸会损毁，约 14 秒后自动修复并重置减速。' },
    grass: { name: '草丛', desc: '不规则轮廓；单兵在其中对外隐身，只有身处同一草丛的单位能看见它；可被点燃，约 3 秒后烧毁。' },
    forest: { name: '树林', desc: '不规则轮廓；大体积地面单位无法通过，并遮挡视野；可被点燃，燃烧约 12 秒后烧毁。' },
    grave: { name: '坟墓', desc: '周期性生成骷髅兵在附近巡逻，无差别攻击。对局中死亡单位越多可同时存在越多，最多 6 个。' },
    wall: { name: '墙体', desc: '困难难度出现的实心障碍：阻挡一切地面单位与视线，空中单位可越过；躲在其后（东侧）的敌人，在己方单位绕到近前之前无法被发现。可被呼叫打击与各类爆炸破坏，结构强度低于建筑。' },
    building: { name: '建筑', desc: '困难难度出现的实心建筑：比墙体更宽厚，阻挡地面单位与视线，是敌方藏身的理想掩体；可被呼叫打击与各类爆炸破坏（结构强度更高）。单兵可进入建筑「守巷」：获得 25% 额外减伤、视野与攻击范围 +35%、不被所在建筑遮挡视线，但不可移动；建筑被摧毁时内部单兵直接阵亡。' }
  };

  var MODES = {
    classic: {
      key: 'classic', name: '常规推演', short: '常规', icon: '◈',
      tagline: '限时清剿 · 经典规则',
      desc: '180 秒内清除全部敌方单位（含 BOSS）即通关，时间耗尽失败。地形、兵种与战术按基础规则运作。'
    },
    infection: {
      key: 'infection', name: '丧尸感染', short: '感染', icon: '☣',
      tagline: '伤势累积 · 阵线倒戈',
      desc: '己方单兵累计承受一定伤害后进入感染：攻速降低 35%，12 秒后转为敌方感染体并反过来攻击队友；感染体的近战会加速传播。医疗包可治愈感染。仍需限时清除全部敌方单位（含被转化的队友）。'
    },
    vampire: {
      key: 'vampire', name: '吸血鬼之夜', short: '血夜', icon: '☾',
      tagline: '守到日出 · 护住平民',
      desc: '敌方按与己方类似的「发现且在射程内才停下」逻辑自右向左推进；左侧村镇有 8 名平民需要保护（视野 150，遇敌会向反方向逃窜）。吸血鬼领主血量极高、近距高伤、初始吸血 70%，内置约 30 秒冷却的「化蝠」长距突袭；血量打空后退往右侧重整，每次重整最大生命 -20%、吸血率 +15%。撑到时间结束即日出获胜、中途击杀领主同样获胜；平民被击杀超过一半则失败。'
    }
  };

  var DIFFICULTIES = {
    normal: {
      key: 'normal', name: '标准', short: '标准',
      desc: '敌方血量、攻速保持基准值；无建筑与墙体；己方视野随单位朝向自由环视。适合熟悉规则。',
      hpScale: 1, rateScale: 1, obstacles: false, directionalVision: false
    },
    hard: {
      key: 'hard', name: '困难', short: '困难',
      desc: '敌方血量翻倍、攻速 +18%；场上出现阻挡移动与视线的建筑与墙体；躲在障碍后的敌人在己方单位绕到近前之前只显示为半透明灰色轮廓。',
      hpScale: 2, rateScale: 1.18, obstacles: true, directionalVision: true
    }
  };

  var PICKUP_INFO = {
    supply: { name: '补给箱', short: '补', color: '#d9a53c', desc: '立即 +3 费用。' },
    medkit: { name: '医疗包', short: '疗', color: '#4fa86a', desc: '全体己方单位恢复 25 点血量。' },
    intel: { name: '情报终端', short: '侦', color: '#5a8fc0', desc: '揭示全图敌方位置，持续 9 秒。' },
    overdrive: { name: '兴奋剂', short: '速', color: '#b06bb0', desc: '全体己方攻速 +30%，持续 9 秒。' }
  };

  /* 4 张预设地图，开局随机抽选；敌怪与道具点位带小幅随机扰动 */
  var MAPS = [
    {
      id: 'ford', name: '渡河防线', subtitle: '河流纵贯战场，浅滩是唯一通道',
      terrains: [
        { type: 'river', x: 520, y: 0, w: 108, h: 700 },
        { type: 'grass', x: 350, y: 150, r: 68 },
        { type: 'grass', x: 760, y: 520, r: 74 },
        { type: 'grass', x: 980, y: 190, r: 62 },
        { type: 'forest', x: 410, y: 420, r: 56 },
        { type: 'forest', x: 860, y: 330, r: 62 },
        { type: 'forest', x: 700, y: 100, r: 50 },
        { type: 'grave', x: 900, y: 590 }
      ],
      enemies: [
        { key: 'raider', x: 300, y: 260 }, { key: 'brute', x: 470, y: 610 },
        { key: 'raider', x: 660, y: 230 }, { key: 'marksman', x: 700, y: 430 },
        { key: 'brute', x: 640, y: 620 }, { key: 'raider', x: 810, y: 150 },
        { key: 'raider', x: 900, y: 410 }, { key: 'marksman', x: 1010, y: 300 },
        { key: 'enemyApc', x: 830, y: 620 }, { key: 'brute', x: 1050, y: 500 },
        { key: 'raider', x: 1120, y: 150 }, { key: 'warlord', x: 1080, y: 350 }
      ],
      pickups: [
        { type: 'supply', x: 260, y: 520 }, { type: 'medkit', x: 690, y: 350 },
        { type: 'intel', x: 430, y: 220 }, { type: 'overdrive', x: 950, y: 100 },
        { type: 'supply', x: 760, y: 650 }
      ]
    },
    {
      id: 'grove', name: '焦土林地', subtitle: '树林与草丛密布，纵火可开路',
      terrains: [
        { type: 'forest', x: 360, y: 180, r: 66 }, { type: 'forest', x: 520, y: 420, r: 70 },
        { type: 'forest', x: 700, y: 150, r: 60 }, { type: 'forest', x: 800, y: 500, r: 72 },
        { type: 'forest', x: 1010, y: 300, r: 64 }, { type: 'forest', x: 250, y: 520, r: 55 },
        { type: 'grass', x: 460, y: 300, r: 78 }, { type: 'grass', x: 650, y: 610, r: 76 },
        { type: 'grass', x: 930, y: 120, r: 70 }, { type: 'grass', x: 1080, y: 560, r: 68 },
        { type: 'grave', x: 620, y: 60 }, { type: 'grave', x: 900, y: 640 }
      ],
      enemies: [
        { key: 'raider', x: 320, y: 330 }, { key: 'marksman', x: 470, y: 120 },
        { key: 'brute', x: 560, y: 560 }, { key: 'raider', x: 640, y: 330 },
        { key: 'marksman', x: 760, y: 280 }, { key: 'raider', x: 870, y: 620 },
        { key: 'brute', x: 930, y: 200 }, { key: 'enemyApc', x: 1080, y: 420 },
        { key: 'raider', x: 1130, y: 140 }, { key: 'brute', x: 1120, y: 640 },
        { key: 'warlord', x: 1000, y: 420 }
      ],
      pickups: [
        { type: 'supply', x: 200, y: 200 }, { type: 'medkit', x: 590, y: 250 },
        { type: 'intel', x: 720, y: 650 }, { type: 'overdrive', x: 980, y: 90 },
        { type: 'supply', x: 420, y: 630 }
      ]
    },
    {
      id: 'boneyard', name: '古战场', subtitle: '三处坟墓持续吐出骷髅，速战速决',
      terrains: [
        { type: 'river', x: 0, y: 320, w: 470, h: 92 },
        { type: 'grass', x: 300, y: 160, r: 72 }, { type: 'grass', x: 620, y: 250, r: 76 },
        { type: 'grass', x: 880, y: 570, r: 80 }, { type: 'grass', x: 1080, y: 200, r: 66 },
        { type: 'forest', x: 520, y: 520, r: 62 }, { type: 'forest', x: 760, y: 100, r: 58 },
        { type: 'forest', x: 980, y: 400, r: 58 },
        { type: 'grave', x: 420, y: 560 }, { type: 'grave', x: 700, y: 390 }, { type: 'grave', x: 1060, y: 620 }
      ],
      enemies: [
        { key: 'raider', x: 280, y: 250 }, { key: 'brute', x: 460, y: 180 },
        { key: 'marksman', x: 560, y: 300 }, { key: 'raider', x: 640, y: 620 },
        { key: 'brute', x: 760, y: 250 }, { key: 'raider', x: 820, y: 480 },
        { key: 'marksman', x: 900, y: 150 }, { key: 'enemyApc', x: 940, y: 640 },
        { key: 'brute', x: 1100, y: 330 }, { key: 'raider', x: 1140, y: 520 },
        { key: 'warlord', x: 1050, y: 420 }
      ],
      pickups: [
        { type: 'supply', x: 180, y: 500 }, { type: 'medkit', x: 560, y: 100 },
        { type: 'intel', x: 760, y: 620 }, { type: 'overdrive', x: 1000, y: 90 },
        { type: 'supply', x: 900, y: 300 }
      ]
    },
    {
      id: 'pass', name: '混合隘口', subtitle: '河流、树林、草丛、坟墓俱全',
      terrains: [
        { type: 'river', x: 0, y: 470, w: 700, h: 100 },
        { type: 'river', x: 880, y: 0, w: 96, h: 330 },
        { type: 'forest', x: 430, y: 220, r: 68 }, { type: 'forest', x: 700, y: 320, r: 60 },
        { type: 'forest', x: 800, y: 610, r: 64 }, { type: 'forest', x: 1060, y: 450, r: 58 },
        { type: 'grass', x: 250, y: 250, r: 76 }, { type: 'grass', x: 590, y: 130, r: 68 },
        { type: 'grass', x: 760, y: 180, r: 64 }, { type: 'grass', x: 1000, y: 620, r: 72 },
        { type: 'grave', x: 300, y: 620 }, { type: 'grave', x: 820, y: 120 }
      ],
      enemies: [
        { key: 'raider', x: 290, y: 130 }, { key: 'brute', x: 480, y: 360 },
        { key: 'marksman', x: 620, y: 230 }, { key: 'raider', x: 680, y: 620 },
        { key: 'brute', x: 760, y: 430 }, { key: 'marksman', x: 830, y: 250 },
        { key: 'raider', x: 970, y: 150 }, { key: 'enemyApc', x: 1000, y: 340 },
        { key: 'brute', x: 1100, y: 570 }, { key: 'raider', x: 1140, y: 260 },
        { key: 'marksman', x: 620, y: 660 }, { key: 'warlord', x: 1060, y: 420 }
      ],
      pickups: [
        { type: 'supply', x: 180, y: 360 }, { type: 'medkit', x: 540, y: 620 },
        { type: 'intel', x: 700, y: 90 }, { type: 'overdrive', x: 900, y: 650 },
        { type: 'supply', x: 1120, y: 100 }
      ]
    }
  ];

  var CFG = {
    world: WORLD,
    timeLimit: 180,
    energyStart: 12,
    energyCap: 24,
    energyRate: 0.60,
    sergeantBonus: 0.18,
    gasDebuff: 0.12,
    graveInterval: 4.5,
    grassBurn: 3.0,
    forestBurn: 12.0,
    deployZone: 240,          // 强制部署带：单位只能从战场左侧该宽度内出发
    bridgeWidth: 76,          // 两辆装甲车（直径 36）并排 + 间隙
    bridgeRepair: 14,         // 损毁后十几秒自动修复
    bridgeHeatLimit: 3.2,     // 累计燃烧 / 爆炸热量阈值
    bridgeSlow: 0.70,         // 桥上有阵亡者时的移速系数
    alertHold: 1.0,           // 受击后视野锁定攻击来源的时长
    patrolSweep: 0.85,        // 行进中左右环视幅度（弧度）
    patrolSpeed: 2.2,         // 环视角频率
    /* 交战与载具 */
    attackerWindow: 3.0,      // 「多名非友方攻击」的统计时间窗
    meleeCloseRadius: 46,     // 近战单位允许的最大接敌偏移
    meleeChaseMax: 3.0,       // 近战接敌机动时限
    crushDps: 130,            // 车身完全覆盖单兵时的持续碾压伤害 / 秒
    ramDamage: 58,            // 单次体积碰撞造成的高额伤害
    ramCooldown: 0.55,        // 同一载具的碰撞伤害冷却
    ramAcquire: 150,          // 触发来回碾压的索敌距离
    ramSpeed: 1.65,           // 碾压冲刺倍率
    ramDuration: 7.0,         // 单次来回碾压最长时长
    pushForce: 46,            // 大体积对小体积载具的推挤速度
    /* 困难难度 */
    obstacleCount: 6,         // 建筑 + 墙体数量
    extraGuards: 2,           // 障碍后额外埋伏的敌人
    /* 丧尸感染 */
    infectionThreshold: 46,   // 累计有效受伤触发感染
    infectionTurn: 12,        // 感染后转化倒计时（秒）
    infectionHaste: 0.65,     // 感染期间攻速系数
    zombieInfectBonus: 20,    // 感染体每次命中额外附加的感染量
    /* 吸血鬼之夜 */
    civilianCount: 8,
    vampireWaveInterval: 9,   // 血仆增援间隔
    vampireWaveCap: 8,        // 同时存在的血仆上限
    vampireThralls: 3,        // 开局血仆数量
    vampireBatCd: 30,         // 「化蝠」技能冷却（大半分钟）
    vampireBatSpeed: 205,     // 化蝠飞行速度（长距跨障碍）
    vampireBatVuln: 1.8,      // 化蝠期间受伤倍率
    vampireBatSlow: 0.6,      // 化蝠期间受击减速时长（秒）
    vampireBatHpFrac: 0.18,   // 被打散化蝠时的血量池（最大生命比例）
    vampireReformTime: 6,     // 重整时长（期间完全静止）
    vampireReformHeal: 0.45,  // 重整完成后的恢复比例
    vampireReformDecay: 0.8,  // 每次重整最大生命值 ×0.8（降低当前 20%）
    vampireReformLifesteal: 0.15, // 每次重整吸血率 +15%
    /* 建筑守巷与结构 */
    garrisonArmor: 0.25,      // 守巷额外减伤（低额）
    garrisonBoost: 1.35,      // 守巷视野 / 攻击范围倍率
    garrisonRange: 170,       // 允许进入建筑的最大距离
    buildingHp: 190,          // 建筑结构强度
    wallHp: 110               // 墙体结构强度
  };

  var API = {
    WORLD: WORLD, CFG: CFG, UNIT_DEFS: UNIT_DEFS, SKILLS: SKILLS, PLAYABLE: PLAYABLE,
    TERRAIN_INFO: TERRAIN_INFO, PICKUP_INFO: PICKUP_INFO, MAPS: MAPS,
    MODES: MODES, DIFFICULTIES: DIFFICULTIES
  };

  root.DATA = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
