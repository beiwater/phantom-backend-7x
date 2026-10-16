// 本地存档(localStorage)。所有读写包在 try/catch:隐私模式或存储被禁用时游戏照常运行,只是不保存。
const KEY = 'voxel-era-save-v1';

const REPLAY_KEY = 'voxel-era-replay-v1';

/** 录像 = 种子 + 难度 + 命令日志 + 终点校验和;固定步长 + 种子随机数保证可复现。 */
export function storeReplay(game) {
  const data = { seed: game.map.seed, difficulty: game.difficultyId, log: game.transport.log, endTick: game.tick, checksum: game.checksum(), reloaded: !!game.reloaded };
  try {
    localStorage.setItem(REPLAY_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function loadReplay() {
  try { return JSON.parse(localStorage.getItem(REPLAY_KEY) ?? 'null'); } catch { return null; }
}

export function hasSave() {
  try { return !!localStorage.getItem(KEY); } catch { return false; }
}

/** 读取存档的种子与难度,让 Game 以相同参数构造后再恢复。 */
/** 导出当前存档为 JSON 字符串(先保存一次保证最新)。 */
export function exportSave(ctx) {
  saveGame(ctx);
  try { return localStorage.getItem(KEY); } catch { return null; }
}

/** 导入存档:只做结构校验(版本/地图),通过后写入本地存档,由调用方刷新页面加载。 */
export function importSave(text) {
  let d;
  try { d = JSON.parse(text); } catch { return { ok: false, reason: '文件不是有效的 JSON' }; }
  if (!d || d.v !== 1 || !d.map || !Array.isArray(d.buildings)) return { ok: false, reason: '不是体素纪元的存档' };
  try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { return { ok: false, reason: '浏览器存储不可用' }; }
  return { ok: true };
}

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
  // 读档会对单位坐标等取整,之后的模拟与「不间断」的原局不再逐位一致,回放校验需知晓
  game.reloaded = true;
  return true;
}
