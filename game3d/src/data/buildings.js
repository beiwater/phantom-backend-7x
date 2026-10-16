// 28 种建筑定义。产业链:原料 → 加工 → 高级品 → 军工/科研;建造成本反向消耗链上产物。
// size=[宽,深](格);terrain=占地内至少一格须为该地形;near=半径 2 格内须有该地形。
// recipe.time 为 1 级时一个周期秒数;等级提升速度见 levelSpeed()。
// power:正数=发电,负数=耗电。workers:运转所需工人。

export const CATEGORIES = [
  { id: 'core', name: '核心', icon: '🏛️' },
  { id: 'raw', name: '采集', icon: '⛏️' },
  { id: 'process', name: '加工', icon: '🏭' },
  { id: 'civic', name: '民生', icon: '🏘️' },
  { id: 'science', name: '科研', icon: '🔬' },
  { id: 'military', name: '军事', icon: '⚔️' },
  { id: 'defense', name: '防御', icon: '🛡️' },
];

export const BUILDINGS = {
  hq: {
    name: '指挥中心', category: 'core', size: [3, 3], era: 1, maxLevel: 3, hp: 3000,
    cost: { money: 0 }, buildTime: 0, workers: 0, unique: true,
    storage: 400, housing: 6, income: { money: 6, time: 5 },
    desc: '文明的心脏。提供仓储、基础税收与自卫火力(射程 6);被摧毁即失败。升级随时代改变外观。',
  },
  house: {
    name: '民居', category: 'civic', size: [1, 1], era: 1, maxLevel: 4, hp: 300,
    cost: { money: 40, wood: 4 }, buildTime: 6, workers: 0,
    housing: 4, upkeep: { food: 1, time: 30 },
    desc: '提供工人。每 30 秒消耗 1 食物,断粮时只提供一半工人。',
  },
  farm: {
    name: '农场', category: 'raw', size: [2, 2], era: 1, maxLevel: 5, hp: 400,
    cost: { money: 50, wood: 4 }, buildTime: 8, workers: 2,
    recipe: { in: {}, out: { grain: 2 }, time: 8 },
    desc: '在草地上耕种谷物。',
  },
  lumber: {
    name: '伐木场', category: 'raw', size: [2, 2], era: 1, maxLevel: 5, hp: 400, near: 'forest',
    cost: { money: 40 }, buildTime: 6, workers: 2,
    // 3/周期:木材是拓荒期主要建材,2/周期时锯木厂会吃光全部原木导致无法建造(平衡机器人发现)
    recipe: { in: {}, out: { wood: 3 }, time: 8 },
    desc: '需建在森林附近(2 格内)。',
  },
  quarry: {
    name: '采石场', category: 'raw', size: [2, 2], era: 1, maxLevel: 5, hp: 500, terrain: 'rock',
    cost: { money: 60, wood: 6 }, buildTime: 8, workers: 3,
    recipe: { in: {}, out: { stone: 2 }, time: 10 },
    desc: '需覆盖岩石地块。',
  },
  pump: {
    name: '水泵站', category: 'raw', size: [1, 1], era: 1, maxLevel: 4, hp: 300, near: 'water',
    cost: { money: 40, wood: 3 }, buildTime: 5, workers: 1,
    recipe: { in: {}, out: { water: 3 }, time: 6 },
    desc: '需靠近水域(2 格内)。',
  },
  ironMine: {
    name: '铁矿场', category: 'raw', size: [2, 2], era: 1, maxLevel: 5, hp: 600, terrain: 'ore', tech: 'mining',
    cost: { money: 90, planks: 6, stone: 6 }, buildTime: 10, workers: 3,
    recipe: { in: {}, out: { ironOre: 2 }, time: 9 },
    desc: '需覆盖铁矿脉(锈红色地块)。',
  },
  coalMine: {
    name: '煤矿', category: 'raw', size: [2, 2], era: 1, maxLevel: 5, hp: 600, terrain: 'coal', tech: 'mining',
    cost: { money: 90, planks: 6, stone: 6 }, buildTime: 10, workers: 3,
    recipe: { in: {}, out: { coal: 2 }, time: 9 },
    desc: '需覆盖煤层(黑色地块)。',
  },
  oilWell: {
    name: '油井', category: 'raw', size: [2, 2], era: 2, maxLevel: 5, hp: 500, terrain: 'oil', tech: 'petroleum',
    cost: { money: 180, steel: 8, concrete: 4 }, buildTime: 12, workers: 2, power: -2,
    recipe: { in: {}, out: { crude: 2 }, time: 10 },
    desc: '需覆盖油田(深紫色沙地)。耗电 2。',
  },
  foodFactory: {
    name: '食品厂', category: 'process', size: [2, 2], era: 1, maxLevel: 5, hp: 500,
    cost: { money: 80, wood: 8, stone: 4 }, buildTime: 10, workers: 3,
    recipe: { in: { grain: 2, water: 1 }, out: { food: 2 }, time: 10 },
    desc: '谷物 + 净水 → 食物。',
  },
  sawmill: {
    name: '锯木厂', category: 'process', size: [2, 2], era: 1, maxLevel: 5, hp: 500,
    cost: { money: 70, wood: 6, stone: 2 }, buildTime: 8, workers: 2,
    recipe: { in: { wood: 3 }, out: { planks: 2 }, time: 10 },
    desc: '原木 → 木板。',
  },
  steelMill: {
    name: '炼钢厂', category: 'process', size: [3, 3], era: 1, maxLevel: 5, hp: 900, tech: 'metallurgy',
    cost: { money: 200, planks: 10, stone: 16 }, buildTime: 16, workers: 5,
    recipe: { in: { ironOre: 2, coal: 1 }, out: { steel: 1 }, time: 12 },
    desc: '铁矿石 + 煤 → 钢材。',
  },
  cement: {
    name: '水泥厂', category: 'process', size: [2, 2], era: 1, maxLevel: 5, hp: 700, tech: 'metallurgy',
    cost: { money: 150, planks: 8, stone: 10 }, buildTime: 12, workers: 3,
    recipe: { in: { stone: 2, coal: 1 }, out: { concrete: 2 }, time: 10 },
    desc: '石料 + 煤 → 水泥。',
  },
  power: {
    name: '火力电厂', category: 'process', size: [2, 2], era: 2, maxLevel: 5, hp: 800, tech: 'industry',
    cost: { money: 250, steel: 10, concrete: 10 }, buildTime: 16, workers: 3, power: 20,
    recipe: { in: { coal: 1 }, out: {}, time: 10 },
    desc: '燃烧煤炭供电 +20(每级 +60%)。电力不足时所有耗电建筑减速。',
  },
  refinery: {
    name: '炼油厂', category: 'process', size: [3, 2], era: 2, maxLevel: 5, hp: 900, tech: 'petroleum',
    cost: { money: 300, steel: 14, concrete: 10 }, buildTime: 18, workers: 4, power: -3,
    recipe: { in: { crude: 2 }, out: { fuel: 1 }, time: 12 },
    desc: '原油 → 燃油。耗电 3。',
  },
  chemical: {
    name: '化工厂', category: 'process', size: [2, 2], era: 2, maxLevel: 5, hp: 800, tech: 'petroleum',
    cost: { money: 280, steel: 12, concrete: 8 }, buildTime: 16, workers: 4, power: -3,
    recipe: { in: { crude: 1, water: 2 }, out: { plastic: 1 }, time: 12 },
    desc: '原油 + 净水 → 塑料。耗电 3。',
  },
  munitions: {
    name: '军火厂', category: 'process', size: [2, 2], era: 2, maxLevel: 5, hp: 800, tech: 'gunpowder',
    cost: { money: 260, steel: 12, concrete: 6 }, buildTime: 16, workers: 4, power: -2,
    recipe: { in: { steel: 1, coal: 1 }, out: { ammo: 3 }, time: 14 },
    desc: '钢材 + 煤 → 弹药。耗电 2。',
  },
  machine: {
    name: '机械厂', category: 'process', size: [2, 2], era: 2, maxLevel: 5, hp: 800, tech: 'industry',
    cost: { money: 300, steel: 16, concrete: 8 }, buildTime: 18, workers: 4, power: -4,
    recipe: { in: { steel: 2, planks: 1 }, out: { parts: 1 }, time: 16 },
    desc: '钢材 + 木板 → 机械零件。耗电 4。',
  },
  electronics: {
    name: '电子厂', category: 'process', size: [2, 2], era: 3, maxLevel: 5, hp: 800, tech: 'modern',
    cost: { money: 500, steel: 12, concrete: 12, parts: 4 }, buildTime: 22, workers: 5, power: -5,
    recipe: { in: { plastic: 1, steel: 1 }, out: { electronics: 1 }, time: 16 },
    desc: '塑料 + 钢材 → 电子元件。耗电 5。',
  },
  market: {
    name: '集市', category: 'civic', size: [2, 2], era: 1, maxLevel: 5, hp: 500,
    cost: { money: 60, wood: 10 }, buildTime: 8, workers: 2, market: { perCycle: 4, time: 6 },
    desc: '自动出售勾选的货物换取金币。等级越高单次卖得越多、价格越好。',
  },
  warehouse: {
    name: '仓库', category: 'civic', size: [2, 2], era: 1, maxLevel: 5, hp: 700,
    cost: { money: 80, wood: 6, stone: 6 }, buildTime: 8, workers: 1, storage: 300,
    desc: '每级 +300 仓储上限。也是道路物流节点。',
  },
  academy: {
    name: '学院', category: 'science', size: [2, 2], era: 1, maxLevel: 5, hp: 500,
    cost: { money: 100, planks: 6, stone: 8 }, buildTime: 12, workers: 3,
    recipe: { in: { food: 1, planks: 1 }, out: { research: 3 }, time: 15 },
    desc: '食物 + 木板 → 科研点,用于科技树。',
  },
  lab: {
    name: '研究所', category: 'science', size: [2, 2], era: 3, maxLevel: 5, hp: 700, tech: 'modern',
    cost: { money: 600, steel: 10, concrete: 14, electronics: 4 }, buildTime: 24, workers: 4, power: -6,
    recipe: { in: { electronics: 1 }, out: { research: 14 }, time: 20 },
    desc: '电子元件 → 大量科研点。耗电 6。',
  },
  barracks: {
    name: '兵营', category: 'military', size: [2, 2], era: 1, maxLevel: 3, hp: 900, tech: 'drill',
    cost: { money: 120, planks: 10, stone: 10 }, buildTime: 12, workers: 2,
    trains: ['militia', 'scout', 'rifleman'],
    desc: '训练步兵单位。',
  },
  vehicleFactory: {
    name: '战车工厂', category: 'military', size: [3, 3], era: 2, maxLevel: 3, hp: 1400, tech: 'mechanization',
    cost: { money: 500, steel: 24, concrete: 16, parts: 6 }, buildTime: 24, workers: 5, power: -4,
    trains: ['tank', 'artillery'],
    desc: '生产坦克与火炮。耗电 4。',
  },
  airfield: {
    name: '直升机场', category: 'military', size: [3, 3], era: 3, maxLevel: 3, hp: 1200, tech: 'aviation',
    cost: { money: 800, steel: 20, concrete: 24, electronics: 6 }, buildTime: 28, workers: 5, power: -6,
    trains: ['helicopter'],
    desc: '生产武装直升机,可飞越水面与城墙。耗电 6。',
  },
  turret: {
    name: '防御塔', category: 'defense', size: [1, 1], era: 1, maxLevel: 4, hp: 800, tech: 'fortify',
    cost: { money: 100, stone: 10, planks: 4 }, buildTime: 10, workers: 0,
    turret: { range: 6, damage: 14, cooldown: 1.2, ammoPerShot: 0.1 },
    desc: '自动攻击射程内敌军。有弹药时伤害 ×2。',
  },
  wall: {
    name: '城墙', category: 'defense', size: [1, 1], era: 1, maxLevel: 3, hp: 1200, tech: 'fortify',
    cost: { money: 10, stone: 3 }, buildTime: 2, workers: 0, wall: true, drag: true,
    desc: '阻挡地面单位,相邻城墙自动拼接。可拖拽连续建造。',
  },
};

export const BUILDING_IDS = Object.keys(BUILDINGS);

/** 每级生产速度倍率(#模块化:每级加一个模块,速度 +60%)。 */
export function levelSpeed(level) {
  return 1 + 0.6 * (level - 1);
}

/** 升级到 nextLevel 的成本 = 基础成本 × nextLevel × 0.8,金币至少 50。 */
export function upgradeCost(id, nextLevel) {
  const base = BUILDINGS[id].cost;
  const out = {};
  for (const [k, v] of Object.entries(base)) {
    const n = Math.ceil(v * nextLevel * 0.8);
    if (n > 0) out[k] = n;
  }
  out.money = Math.max(out.money ?? 0, 50 * nextLevel);
  if (id === 'hq') {
    // 指挥中心升级=迈入新时代的象征,需对应时代材料
    return nextLevel === 2 ? { money: 600, steel: 20, concrete: 20 } : { money: 2000, steel: 40, concrete: 40, electronics: 10 };
  }
  return out;
}

export function storageOf(id, level) {
  return (BUILDINGS[id].storage ?? 0) * level;
}

export function housingOf(id, level) {
  return (BUILDINGS[id].housing ?? 0) * level;
}
