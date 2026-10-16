// 科技树(文明式):三个时代,时代科技解锁下一时代的建筑与兵种。
// col/row 仅用于科技树面板布局。effect 为全局加成键,由 sim 读取。
export const ERAS = [
  { id: 1, name: '拓荒时代', color: '#7cc46a' },
  { id: 2, name: '工业时代', color: '#e0a040' },
  { id: 3, name: '现代', color: '#50a8e8' },
];

export const TECHS = {
  mining: { name: '采矿', cost: 15, era: 1, req: [], col: 0, row: 0, desc: '解锁铁矿场、煤矿。' },
  drill: { name: '军事训练', cost: 15, era: 1, req: [], col: 0, row: 1, desc: '解锁兵营、民兵。' },
  tools: { name: '改良工具', cost: 25, era: 1, req: [], col: 0, row: 2, effect: { raw: 0.25 }, desc: '采集类建筑产量 +25%。' },
  metallurgy: { name: '冶金', cost: 35, era: 1, req: ['mining'], col: 1, row: 0, desc: '解锁炼钢厂、水泥厂。' },
  fortify: { name: '筑城术', cost: 30, era: 1, req: ['drill'], col: 1, row: 1, desc: '解锁城墙、防御塔。' },
  industry: { name: '工业革命', cost: 80, era: 2, req: ['metallurgy'], col: 2, row: 0, era_up: 2, desc: '进入工业时代。解锁火力电厂、机械厂。' },
  gunpowder: { name: '火药', cost: 60, era: 2, req: ['industry', 'fortify'], col: 3, row: 1, desc: '解锁军火厂、步枪兵。' },
  petroleum: { name: '石油化工', cost: 90, era: 2, req: ['industry'], col: 3, row: 0, desc: '解锁油井、炼油厂、化工厂。' },
  assembly: { name: '流水线', cost: 100, era: 2, req: ['industry'], col: 3, row: 2, effect: { process: 0.25 }, desc: '加工类建筑速度 +25%。' },
  mechanization: { name: '机械化', cost: 150, era: 2, req: ['petroleum', 'gunpowder'], col: 4, row: 0, desc: '解锁战车工厂、坦克。' },
  ballistics: { name: '弹道学', cost: 140, era: 2, req: ['gunpowder'], col: 4, row: 1, desc: '解锁火炮。' },
  armor: { name: '复合装甲', cost: 160, era: 2, req: ['mechanization'], col: 5, row: 1, effect: { unitHp: 0.3 }, desc: '所有单位生命 +30%。' },
  modern: { name: '信息时代', cost: 250, era: 3, req: ['mechanization'], col: 5, row: 0, era_up: 3, desc: '进入现代。解锁电子厂、研究所。' },
  aviation: { name: '航空', cost: 300, era: 3, req: ['modern'], col: 6, row: 0, desc: '解锁直升机场、武装直升机。' },
  automation: { name: '自动化', cost: 320, era: 3, req: ['modern', 'assembly'], col: 6, row: 2, effect: { raw: 0.25, process: 0.25 }, desc: '所有生产 +25%。' },
  precision: { name: '精确制导', cost: 350, era: 3, req: ['modern', 'ballistics'], col: 6, row: 1, effect: { unitDamage: 0.3, turretDamage: 0.5 }, desc: '单位伤害 +30%,防御塔 +50%。' },
};

export const TECH_IDS = Object.keys(TECHS);
