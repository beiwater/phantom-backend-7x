// 主线目标:引导玩家逐步走通产业链 → 时代升级 → 军事胜利。
// progress(game) 返回 0..1;完成后发放 reward(走 game.addRes,金币无上限)。
const count = (g, type, active = true) => [...g.buildings.values()].filter((b) => b.team === 'player' && b.type === type && (!active || b.state === 'active')).length;
const enemyCount = (g, type) => [...g.buildings.values()].filter((b) => b.team === 'enemy' && b.type === type).length;
const ratio = (n, goal) => Math.min(1, n / goal);

export const MISSIONS = [
  {
    title: '扎根', goal: '建造农场与水泵站', focus: ['farm', 'pump'],
    hint: '在「采集」分类中选择农场放在草地上,水泵站需靠近池塘。建筑必须邻接连通指挥中心的道路才能运转。',
    progress: (g) => (Math.min(1, count(g, 'farm')) + Math.min(1, count(g, 'pump'))) / 2,
    reward: { money: 150 },
  },
  {
    title: '第一口面包', goal: '建造食品厂,累计生产 10 食物', focus: ['foodFactory'],
    hint: '食品厂把谷物和净水加工成食物;民居需要食物维持工人数量。',
    progress: (g) => ratio(g.produced.food, 10),
    reward: { money: 200, planks: 10 },
  },
  {
    title: '木与石', goal: '建造伐木场、锯木厂与采石场', focus: ['lumber', 'sawmill', 'quarry'],
    hint: '伐木场要贴近森林,采石场要覆盖灰色岩石。木板与石料是大部分建筑的材料。',
    progress: (g) => (Math.min(1, count(g, 'lumber')) + Math.min(1, count(g, 'sawmill')) + Math.min(1, count(g, 'quarry'))) / 3,
    reward: { money: 200 },
  },
  {
    title: '人丁兴旺', goal: '建造 4 座民居', focus: ['house'],
    hint: '每座民居提供 4 名工人。工人不足时所有生产减速。',
    progress: (g) => ratio(count(g, 'house'), 4),
    reward: { money: 150, food: 10 },
  },
  {
    title: '开市大吉', goal: '建造集市,卖出 20 件货物', focus: ['market'],
    hint: '选中集市,在面板中勾选要自动出售的货物。',
    progress: (g) => ratio(g.counters.sold, 20),
    reward: { money: 250 },
  },
  {
    title: '启蒙', goal: '建造学院并研究「采矿」', focus: ['academy'],
    hint: '学院消耗食物与木板产出科研点。点击顶栏「科技」打开科技树。',
    progress: (g) => (g.techs.has('mining') ? 1 : count(g, 'academy') ? 0.5 : 0),
    reward: { money: 200, research: 10 },
  },
  {
    title: '开疆拓土', goal: '购买 1 块新地块',
    hint: '使用工具栏「扩地」,点击与领地相邻的灰色地块。铁矿与煤层大多在领地之外。',
    progress: (g) => ratio(g.map.ownedChunkCount() - 4, 1),
    reward: { money: 300 },
  },
  {
    title: '治国理政', goal: '在政务中采纳一项政策',
    hint: '顶栏「政务」(J)。政策有利有弊,每个时代多一个政策槽。',
    progress: (g) => (g.policies.some(Boolean) ? 1 : 0),
    reward: { money: 200 },
  },
  {
    title: '钢铁洪流', goal: '累计生产 10 钢材',
    hint: '研究冶金 → 建造铁矿场、煤矿、炼钢厂。',
    progress: (g) => ratio(g.produced.steel, 10),
    reward: { money: 400 },
  },
  {
    title: '通商四海', goal: '完成 1 份贸易合同',
    hint: '城邦会发布高价订单,备好货物后在政务面板交付。声望越高报价越好。',
    progress: (g) => ratio(g.counters.contracts ?? 0, 1),
    reward: { money: 300, research: 20 },
  },
  {
    title: '保家卫国', goal: '研究军事训练,训练 5 名士兵',
    hint: '敌军会从东北方渡河进攻。兵营训练民兵,右键设定集结点。',
    progress: (g) => ratio(g.counters.unitsTrained, 5),
    reward: { money: 300, food: 20 },
  },
  {
    title: '寻宝', goal: '派部队探索 1 处古代遗迹',
    hint: '地图上闪烁金光的石柱废墟就是遗迹,让任意单位走到旁边即可获得随机奖励。较远的遗迹有敌军哨兵把守,带够兵力。',
    progress: (g) => ratio(g.counters.ruins ?? 0, 1),
    reward: { money: 150 },
  },
  {
    title: '击退来犯', goal: '击退 1 波敌军进攻',
    hint: '框选部队后右键移动或攻击。筑城术可解锁城墙与防御塔。',
    // 和平沙盒没有进攻波次,自动视为完成以免卡住后续目标
    progress: (g) => (g.difficulty?.peaceful ? 1 : ratio(g.counters.wavesSurvived, 1)),
    reward: { money: 500 },
  },
  {
    title: '工业革命', goal: '进入工业时代',
    hint: '研究「工业革命」。之后可升级指挥中心改变城市面貌。',
    progress: (g) => (g.era >= 2 ? 1 : 0),
    reward: { money: 600 },
  },
  {
    title: '电力时代', goal: '建造火力电厂并让其运转',
    hint: '电厂烧煤供电;油井、炼油厂等耗电建筑需要电力。',
    progress: (g) => ([...g.buildings.values()].some((b) => b.team === 'player' && b.type === 'power' && b.working) ? 1 : 0),
    reward: { money: 600 },
  },
  {
    title: '装甲铁拳', goal: '训练 3 辆坦克',
    hint: '石油化工 + 火药 → 机械化,建造战车工厂。坦克需要钢材、燃油与机械零件。',
    progress: (g) => ratio(g.unitSystem?.units.filter((u) => u.team === 'player' && u.type === 'tank').length ?? 0, 3),
    reward: { money: 800 },
  },
  {
    title: '拔除前哨', goal: '摧毁敌军的 2 座兵营',
    hint: '兵营是敌军步兵的来源,摧毁后进攻会减弱。',
    progress: (g) => ratio(2 - enemyCount(g, 'barracks'), 2),
    reward: { money: 1000 },
  },
  {
    title: '信息时代', goal: '进入现代',
    hint: '研究「信息时代」,解锁电子厂、研究所与航空。',
    progress: (g) => (g.era >= 3 ? 1 : 0),
    reward: { money: 1200 },
  },
  {
    title: '终局', goal: '取得任意一种胜利',
    hint: '征服:摧毁敌军指挥中心;科技:研究全部科技并有 3 级研究所;经济:声望 15 + 金币 30000。进度见政务面板。',
    progress: (g) => (g.over === 'win' ? 1 : 0),
    reward: { money: 0 },
  },
];
