// 兵种表(玩家与敌军共用)。speed 格/秒,range 格,cooldown 秒。
// splash>0 为范围伤害半径;air=true 飞行单位无视地形与城墙;antiAir=是否能攻击空中。
export const UNITS = {
  militia: {
    name: '民兵', tech: 'drill', hp: 60, damage: 7, range: 1.6, cooldown: 1.0, speed: 1.6,
    cost: { money: 20, food: 2, planks: 1 }, time: 8, antiAir: false, size: 0.35,
    desc: '廉价近战步兵。',
  },
  scout: {
    name: '侦察兵', tech: 'drill', hp: 45, damage: 4, range: 3, cooldown: 1.0, speed: 2.6,
    cost: { money: 25, food: 1 }, time: 6, antiAir: false, size: 0.35,
    desc: '移动迅速、视野极远(10 格),适合探索遗迹与侦察敌情。',
  },
  rifleman: {
    name: '步枪兵', tech: 'gunpowder', hp: 90, damage: 10, range: 4.5, cooldown: 1.1, speed: 1.5,
    cost: { money: 35, food: 2, ammo: 2 }, time: 10, antiAir: true, size: 0.35,
    desc: '远程步兵,可对空。',
  },
  tank: {
    name: '坦克', tech: 'mechanization', hp: 420, damage: 34, range: 5, cooldown: 2.0, speed: 1.3,
    cost: { money: 120, steel: 6, fuel: 3, parts: 2 }, time: 20, antiAir: false, size: 0.7,
    desc: '重装甲主战坦克,擅长拆建筑。',
  },
  artillery: {
    name: '火炮', tech: 'ballistics', hp: 160, damage: 46, range: 9, cooldown: 3.6, speed: 1.0,
    cost: { money: 100, steel: 4, parts: 2, ammo: 4 }, time: 20, antiAir: false, size: 0.65, splash: 1.4, minRange: 2.5,
    desc: '超远射程范围伤害,近身脆弱。',
  },
  helicopter: {
    name: '武装直升机', tech: 'aviation', hp: 300, damage: 22, range: 5, cooldown: 0.9, speed: 2.8,
    cost: { money: 180, steel: 4, fuel: 4, electronics: 2 }, time: 24, antiAir: true, size: 0.8, air: true,
    desc: '高速飞行单位,飞越一切障碍。',
  },
};

export const UNIT_IDS = Object.keys(UNITS);

// 兵种克制:攻击方 → 目标类别(infantry/vehicle/air/building)的伤害倍率,未列出为 1
export const COUNTERS = {
  militia: { vehicle: 0.5, building: 0.6, infantry: 1.2 },
  scout: { vehicle: 0.3, building: 0.3 },
  rifleman: { infantry: 1.25, vehicle: 0.6, air: 1.3, building: 0.7 },
  tank: { vehicle: 1.3, building: 1.5 },
  artillery: { building: 1.6, infantry: 1.2, vehicle: 0.8 },
  helicopter: { vehicle: 1.6, building: 0.8, infantry: 0.9 },
};
const CLASS = { militia: 'infantry', scout: 'infantry', rifleman: 'infantry', tank: 'vehicle', artillery: 'vehicle', helicopter: 'air' };
export const CLASS_NAMES = { infantry: '步兵', vehicle: '载具', air: '空中', building: '建筑' };

/** 目标类别:单位按兵种,建筑统一为 building。 */
export function targetClass(t) {
  return t.type && CLASS[t.type] && t.def ? CLASS[t.type] : 'building';
}

export function counterMult(attacker, target) {
  return COUNTERS[attacker]?.[targetClass(target)] ?? 1;
}

export const TEAM_COLORS = {
  player: { primary: 0x3a7bd5, secondary: 0xe8eef8, dark: 0x1d3f72 },
  enemy: { primary: 0xc8402e, secondary: 0x2a2a2e, dark: 0x6a1a12 },
};
