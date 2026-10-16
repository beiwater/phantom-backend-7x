// 本地存档(localStorage)。所有读写包在 try/catch:隐私模式或存储被禁用时游戏照常运行,只是不保存。
const KEY = 'voxel-era-save-v1';

export function hasSave() {
  try { return !!localStorage.getItem(KEY); } catch { return false; }
}

/** 读取存档的种子与难度,让 Game 以相同参数构造后再恢复。 */
export function savedMeta() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return d ? { seed: d.map?.seed, difficulty: d.difficulty } : null;
  } catch {
    return null;
  }
}

export function clearSave() {
  try { localStorage.removeItem(KEY); } catch { /* 存储不可用 */ }
}

export function saveGame({ game, rts, economy }) {
  const data = {
    v: 1,
    difficulty: game.difficultyId,
    time: game.time,
    tick: game.tick,
    rng: game.random.s,
    log: game.transport.log.slice(-5000),
    speed: game.speed,
    res: game.res,
    era: game.era,
    techs: [...game.techs],
    researching: game.researching,
    mission: game.mission,
    counters: game.counters,
    produced: game.produced,
    nextUid: game.nextUid,
    map: game.map.serialize(),
    buildings: [...game.buildings.values()].map((b) => ({ ...b, sell: [...b.sell] })),
    rts: rts.serialize(),
    fog: game.fog?.serialize(),
    ruins: game.ruins.serialize(),
    buffs: game.buffs,
    policies: game.policies,
    policyReadyAt: game.policyReadyAt,
    contracts: economy.contracts.serialize(),
    econ: { market: economy.market.serialize(), stats: economy.stats.serialize(), society: economy.society.serialize() },
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

/** 恢复状态;不触发 building:add 事件,调用方负责 view.rebuildAll()。失败返回 false 并开新局。 */
export function loadGame({ game, rts, economy, onFog }) {
  let data;
  try { data = JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { return false; }
  if (!data || data.v !== 1 || data.map?.seed !== game.map.seed) return false;
  game.time = data.time;
  game.tick = data.tick ?? 0;
  if (data.rng !== undefined) game.random.s = data.rng;
  game.transport.log = data.log ?? [];
  game.speed = data.speed ?? 1;
  Object.assign(game.res, data.res);
  game.era = data.era;
  game.techs = new Set(data.techs);
  game.researching = data.researching;
  game.mission = data.mission ?? 0;
  Object.assign(game.counters, data.counters);
  Object.assign(game.produced, data.produced);
  game.nextUid = data.nextUid;
  game.map.load(data.map);
  game.buildings.clear();
  for (const raw of data.buildings) {
    const b = { ...raw, sell: new Set(raw.sell) };
    game.buildings.set(b.uid, b);
    for (let z = b.z; z < b.z + b.d; z++) {
      for (let x = b.x; x < b.x + b.w; x++) game.map.building[game.map.idx(x, z)] = b.uid;
    }
  }
  game.map.version++;
  game.buffs = data.buffs ?? [];
  game.ruins.load(data.ruins);
  game.policies = data.policies ?? [];
  game.policyReadyAt = data.policyReadyAt ?? 0;
  economy.contracts.load(data.contracts);
  onFog?.(data.fog);
  economy.market.load(data.econ?.market);
  economy.stats.load(data.econ?.stats);
  economy.society.load(data.econ?.society);
  rts.load(data.rts ?? {});
  return true;
}
