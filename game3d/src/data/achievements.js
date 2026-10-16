// 成就:跨局保存在本机(不进模拟状态,不影响确定性)。test(game) 为真即解锁。
const mine = (g, type) => [...g.buildings.values()].filter((b) => b.team === g.localPlayer && b.type === type);
const army = (g) => (g.unitSystem?.units ?? []).filter((u) => u.team === g.localPlayer);

export const ACHIEVEMENTS = [
  { id: 'first_steps', name: '第一锹土', desc: '建造第一座生产建筑', test: (g) => [...g.buildings.values()].some((b) => b.team === g.localPlayer && b.type !== 'hq' && b.state === 'active') },
  { id: 'chain', name: '产业链', desc: '同时拥有农场、水泵站与食品厂', test: (g) => ['farm', 'pump', 'foodFactory'].every((t) => mine(g, t).length) },
  { id: 'synergy', name: '珠联璧合', desc: '让一座建筑获得 +30% 相邻协同', test: (g) => [...g.buildings.values()].some((b) => b.team === g.localPlayer && (b.synergy?.bonus ?? 0) >= 0.3) },
  { id: 'town', name: '小镇初成', desc: '拥有 10 座民居', test: (g) => mine(g, 'house').length >= 10 },
  { id: 'landlord', name: '地主', desc: '拥有 10 块地块', test: (g) => g.map.ownedChunkCount() >= 10 },
  { id: 'max_level', name: '精益求精', desc: '把任意建筑升到 5 级', test: (g) => [...g.buildings.values()].some((b) => b.team === g.localPlayer && b.level >= 5) },
  { id: 'module', name: '模块化', desc: '安装一个专精模块', test: (g) => [...g.buildings.values()].some((b) => b.team === g.localPlayer && b.module) },
  { id: 'industrial', name: '蒸汽与钢铁', desc: '进入工业时代', test: (g) => g.era >= 2 },
  { id: 'modern', name: '信息洪流', desc: '进入现代', test: (g) => g.era >= 3 },
  { id: 'rich', name: '富甲一方', desc: '持有 10000 金币', test: (g) => g.res.money >= 10000 },
  { id: 'happy', name: '安居乐业', desc: '民心达到 85', test: (g) => (g.society?.happiness ?? 0) >= 85 },
  { id: 'trader', name: '通商四海', desc: '完成 5 份贸易合同', test: (g) => (g.counters.contracts ?? 0) >= 5 },
  { id: 'explorer', name: '考古学家', desc: '探索 5 处古代遗迹', test: (g) => (g.counters.ruins ?? 0) >= 5 },
  { id: 'army', name: '百万雄师', desc: '同时拥有 30 个单位', test: (g) => army(g).length >= 30 },
  { id: 'veteran', name: '王牌', desc: '培养一名 3 星王牌', test: (g) => army(g).some((u) => (u.rank ?? 0) >= 3) },
  { id: 'defender', name: '固若金汤', desc: '击退 5 波进攻', test: (g) => g.counters.wavesSurvived >= 5 },
  { id: 'warlord', name: '征服者', desc: '取得征服胜利', test: (g) => g.over === 'win' && g.victoryKind === 'domination' },
  { id: 'scientist', name: '星辰大海', desc: '取得科技胜利', test: (g) => g.over === 'win' && g.victoryKind === 'science' },
  { id: 'tycoon', name: '商业帝国', desc: '取得经济胜利', test: (g) => g.over === 'win' && g.victoryKind === 'economic' },
  { id: 'hard_win', name: '铁血统帅', desc: '在铁血难度下获胜', test: (g) => g.over === 'win' && g.difficultyId === 'hard' },
];
