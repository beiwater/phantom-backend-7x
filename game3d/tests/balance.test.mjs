// 平衡性机器人:只通过 game.dispatch 命令游玩经济(无战斗),检验开局可行、能在合理时间内进入工业时代。
// 失败往往意味着产业链死锁(某种材料无法获得)或数值过紧。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/sim/state.js';
import { Economy } from '../src/sim/economy.js';
import { SimLoop, TICK } from '../src/sim/loop.js';
import { BUILDINGS } from '../src/data/buildings.js';
import { TECHS } from '../src/data/tech.js';
import { MAP_W, MAP_H, CHUNK, T } from '../src/world/map.js';
import { planRoad } from '../src/sim/autoroad.js';

const ORDER = [
  'lumber', 'farm', 'pump', 'quarry', 'house', 'house', 'foodFactory', 'sawmill', 'house', 'market', 'academy',
  'house', 'house', 'lumber', 'farm', 'ironMine', 'coalMine', 'house', 'steelMill', 'cement', 'house', 'house',
  'warehouse', 'academy', 'farm', 'pump', 'foodFactory', 'house', 'house', 'power', 'coalMine', 'machine', 'house', 'house',
];
const TECH_ORDER = ['mining', 'tools', 'metallurgy', 'industry', 'petroleum', 'assembly'];

function findSpot(g, type) {
  const def = BUILDINGS[type];
  const [w, d] = def.size;
  const hq = g.playerHQ();
  const cands = [];
  for (let z = 0; z <= MAP_H - d; z++) {
    for (let x = 0; x <= MAP_W - w; x++) {
      if (!g.canPlace(type, x, z).ok) continue;
      cands.push({ x, z, dist: Math.abs(x - hq.x) + Math.abs(z - hq.z) });
    }
  }
  cands.sort((a, b) => a.dist - b.dist);
  for (const c of cands.slice(0, 40)) {
    const plan = planRoad(g, { x: c.x, z: c.z, w, d });
    if (plan) return c;
  }
  return null;
}

function bot(g) {
  const next = ORDER[g.botStep ?? 0];
  if (next) {
    const def = BUILDINGS[next];
    if (g.isUnlocked(next) && g.canAfford(def.cost)) {
      const s = findSpot(g, next);
      if (s && g.dispatch({ type: 'build', building: next, x: s.x, z: s.z, autoRoad: true }).ok) g.botStep = (g.botStep ?? 0) + 1;
      else if (!s && (def.terrain || def.near) && g.res.money >= g.map.chunkPrice()) {
        // 需要特定地形:买一块含该地形的相邻地块
        buyFor(g, def.terrain ?? def.near);
      }
    } else if (!g.isUnlocked(next) && !TECHS[def.tech]) g.botStep++;
  }
  for (const id of TECH_ORDER) if (g.canResearch(id).ok) { g.dispatch({ type: 'research', tech: id }); break; }
  for (const b of g.buildings.values()) {
    if (b.type === 'market' && b.sell.size === 0) for (const k of ['planks', 'food']) g.dispatch({ type: 'setSell', uid: b.uid, res: k, on: true });
    // 原木不够建造时暂停锯木厂,充足后恢复(玩家同样可用「暂停生产」)
    if (b.type === 'sawmill' && ((g.res.wood < 12 && !b.paused) || (g.res.wood > 40 && b.paused))) g.dispatch({ type: 'togglePause', uid: b.uid });
  }
}

function buyFor(g, terrainName) {
  const m = g.map;
  const want = terrainName ? T[terrainName] : null;
  for (let cz = 0; cz < MAP_H / CHUNK; cz++) {
    for (let cx = 0; cx < MAP_W / CHUNK; cx++) {
      if (!m.canBuyChunk(cx, cz)) continue;
      let ok = want === null;
      for (let z = cz * CHUNK; z < (cz + 1) * CHUNK && !ok; z++) for (let x = cx * CHUNK; x < (cx + 1) * CHUNK && !ok; x++) if (m.t(x, z) === want) ok = true;
      if (ok && g.dispatch({ type: 'buyChunk', cx, cz }).ok) return true;
    }
  }
  return false;
}

test('平衡机器人:50 分钟内跑通钢铁链并进入工业时代', () => {
  for (const seed of [7, 3]) {
    const g = new Game(seed);
    g.setupStart();
    const loop = new SimLoop(g, new Economy(g), null);
    const milestones = {};
    const mark = (k) => { if (!(k in milestones)) milestones[k] = Math.round(g.time); };
    const limit = (50 * 60) / TICK;
    for (let i = 0; i < limit; i++) {
      if (i % 40 === 0) bot(g);
      loop.stepTick();
      if (g.produced.food >= 10) mark('food10');
      if (g.techs.has('mining')) mark('mining');
      if (g.produced.steel >= 10) mark('steel10');
      if (g.era >= 2) mark('industry');
      if (milestones.industry !== undefined && milestones.steel10 !== undefined) break;
    }
    console.log(`seed ${seed}`, milestones, 'mission', g.mission, 'money', Math.round(g.res.money), 'bldgs', g.buildings.size);
    assert.ok(milestones.food10 < 8 * 60, `seed ${seed} 食物过慢 ${milestones.food10}`);
    assert.ok(milestones.mining !== undefined, `seed ${seed} 未能研究采矿`);
    assert.ok(milestones.industry !== undefined, `seed ${seed} 50 分钟内未进入工业时代`);
    assert.ok(milestones.steel10 !== undefined, `seed ${seed} 50 分钟内钢铁链未跑通`);
  }
});
