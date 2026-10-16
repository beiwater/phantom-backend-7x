// 政策(文明式市政):时代决定政策槽数量(1/2/3)。每项政策有收益也有代价,更换需金币并有冷却。
// effects 的键由 game.effect() 汇总:raw/process/marketPrice/research/tax/happy/pollution/unitCost/unitHp/unitDamage/turretDamage/housing
export const POLICIES = {
  freeMarket: { name: '自由市场', era: 1, effects: { marketPrice: 0.2, happy: -4 }, desc: '集市售价 +20%,民心 -4。' },
  planned: { name: '计划经济', era: 1, effects: { process: 0.15, marketPrice: -0.15 }, desc: '加工速度 +15%,集市售价 -15%。' },
  agrarian: { name: '重农主义', era: 1, effects: { farm: 0.3, pump: 0.3, process: -0.1 }, desc: '农场与水泵 +30%,加工 -10%。' },
  levy: { name: '全民皆兵', era: 1, effects: { unitCost: -0.25, happy: -8 }, desc: '训练单位成本 -25%,民心 -8。' },
  education: { name: '义务教育', era: 1, effects: { research: 0.3, tax: -0.1 }, desc: '科研产出 +30%,税收 -10%。' },
  welfare: { name: '社会福利', era: 2, effects: { happy: 12, tax: -0.15 }, desc: '民心 +12,税收 -15%。' },
  green: { name: '环保法案', era: 2, effects: { pollution: -0.6, process: -0.1 }, desc: '污染影响 -60%,加工 -10%。' },
  industrialism: { name: '工业至上', era: 2, effects: { process: 0.2, raw: 0.1, pollution: 0.5 }, desc: '加工 +20%、采集 +10%,污染影响 +50%。' },
  militarism: { name: '军国主义', era: 2, effects: { unitHp: 0.15, unitDamage: 0.15, happy: -6 }, desc: '单位生命与伤害 +15%,民心 -6。' },
  fortress: { name: '堡垒战略', era: 2, effects: { turretDamage: 0.4, housing: -0.1 }, desc: '防御塔伤害 +40%,住户 -10%。' },
  technocracy: { name: '技术官僚', era: 3, effects: { research: 0.5, process: 0.1, happy: -5 }, desc: '科研 +50%,加工 +10%,民心 -5。' },
  globalTrade: { name: '全球贸易', era: 3, effects: { marketPrice: 0.35, tax: 0.1 }, desc: '集市售价 +35%,税收 +10%。' },
};

export const POLICY_IDS = Object.keys(POLICIES);
export const POLICY_SWITCH_COST = 150;
export const POLICY_COOLDOWN = 60;

export function policySlots(era) {
  return era;
}
