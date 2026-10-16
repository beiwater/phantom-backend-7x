// 文明评分:综合人口、科技、建筑等级、时代、军功、财富与成就,用于 HUD 与本地排行榜(纯读状态)。
export function civScore(g) {
  let levels = 0;
  for (const b of g.buildings.values()) if (b.team === g.localPlayer && b.state !== 'construct') levels += b.level;
  const parts = {
    人口: g.stats.housing * 5,
    科技: g.techs.size * 40,
    建筑: levels * 6,
    时代: (g.era - 1) * 300,
    军功: (g.counters.enemyKilled ?? 0) * 8 + (g.counters.wavesSurvived ?? 0) * 60,
    财富: Math.floor(g.res.money / 50),
    奇迹: (g.counters.ruins ?? 0) * 30 + (g.counters.contracts ?? 0) * 25,
  };
  const total = Object.values(parts).reduce((s, v) => s + v, 0);
  return { total: Math.round(total), parts };
}

export function rank(total) {
  if (total >= 6000) return 'S';
  if (total >= 3500) return 'A';
  if (total >= 1800) return 'B';
  if (total >= 800) return 'C';
  return 'D';
}

const KEY = 'voxel-era-leaderboard';

export function recordScore(entry) {
  let list = [];
  try { list = JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { list = []; }
  list.push(entry);
  list.sort((a, b) => b.score - a.score);
  list = list.slice(0, 8);
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* 存储不可用 */ }
  return list;
}

export function leaderboard() {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; }
}
