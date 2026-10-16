// 命令总线:所有玩家意图(建造、铺路、升级、研究、下达军令…)都表示为纯 JSON 命令,
// 由 applyCommand 在 tick 边界执行。这样本地单人、录像回放、未来的锁步联机走同一条路径。
// 命令格式:{ type, p: 玩家 id, ...参数 };返回 { ok, reason?, ...附加结果 }。
import { BUILDINGS } from '../data/buildings.js';
import { RESOURCES } from '../data/resources.js';
import { MODULES, MODULE_MIN_LEVEL } from '../data/modules.js';
import { planRoad } from '../sim/autoroad.js';
import { rushCost } from '../sim/economy.js';
import { Game } from '../sim/state.js';

const RTS_TYPES = new Set(['move', 'attack', 'stop', 'rally', 'train', 'cancelTrain', 'upgradeUnits']);

function owned(game, cmd) {
  const b = game.buildings.get(cmd.uid);
  return b && b.team === cmd.p ? b : null;
}

const HANDLERS = {
  /** autoRoad:同时铺设通往路网的最短道路;建筑 + 道路总成本全量预检,要么全成要么全不成。 */
  build(game, cmd) {
    const def = Object.hasOwn(BUILDINGS, cmd.building) ? BUILDINGS[cmd.building] : null;
    if (!def) return { ok: false, reason: '未知建筑' };
    const roads = cmd.autoRoad && (def.recipe || def.market || def.trains || def.storage)
      ? planRoad(game, { x: cmd.x, z: cmd.z, w: def.size[0], d: def.size[1] }) ?? []
      : [];
    if (roads.length) {
      const total = { ...def.cost };
      for (const [k, v] of Object.entries(Game.ROAD_COST)) total[k] = (total[k] ?? 0) + v * roads.length;
      if (!game.canAfford(total)) return { ok: false, reason: `资源不足(含自动铺路 ${roads.length} 格)` };
    }
    const r = game.placeBuilding(cmd.building, cmd.x, cmd.z, cmd.p);
    if (!r.ok) return r;
    for (const [x, z] of roads) game.placeRoad(x, z);
    return { ...r, roads: roads.length };
  },
  /** 批量格子(道路/城墙拖拽):逐格执行,返回成功数量。 */
  roads(game, cmd) {
    let n = 0;
    for (const [x, z] of cmd.cells.slice(0, 80)) if (game.placeRoad(x, z).ok) n++;
    return n ? { ok: true, n } : { ok: false, reason: '无法在此铺路' };
  },
  walls(game, cmd) {
    let n = 0;
    for (const [x, z] of cmd.cells.slice(0, 80)) if (game.placeBuilding('wall', x, z, cmd.p).ok) n++;
    return n ? { ok: true, n } : { ok: false, reason: '无法在此建墙' };
  },
  demolish(game, cmd) {
    if (!owned(game, cmd)) return { ok: false, reason: '不是你的建筑' };
    return game.demolish(cmd.uid);
  },
  removeRoad(game, cmd) {
    return game.removeRoad(cmd.x, cmd.z);
  },
  upgrade(game, cmd) {
    if (!owned(game, cmd)) return { ok: false, reason: '不是你的建筑' };
    return game.upgrade(cmd.uid);
  },
  repair(game, cmd) {
    if (!owned(game, cmd)) return { ok: false, reason: '不是你的建筑' };
    return game.repair(cmd.uid);
  },
  buyChunk(game, cmd) {
    return game.buyChunk(cmd.cx, cmd.cz);
  },
  research(game, cmd) {
    return game.startResearch(cmd.tech);
  },
  queueResearch(game, cmd) {
    return game.queueResearch(cmd.tech);
  },
  policy(game, cmd) {
    return game.setPolicy(cmd.slot, cmd.id ?? null);
  },
  deliver(game, cmd) {
    return game.contracts?.deliver(cmd.id) ?? { ok: false, reason: '合同系统未就绪' };
  },
  /** 专精模块:3 级以上的生产/集市建筑;全量预检扣费,选同一模块拒绝(防重复扣费)。 */
  setModule(game, cmd) {
    const b = owned(game, cmd);
    const def = b && BUILDINGS[b.type];
    if (!b || !(def.recipe || def.market)) return { ok: false, reason: '该建筑不能安装模块' };
    if (b.state !== 'active') return { ok: false, reason: '建筑忙碌中' };
    if (b.level < MODULE_MIN_LEVEL) return { ok: false, reason: `需 ${MODULE_MIN_LEVEL} 级` };
    const m = Object.hasOwn(MODULES, cmd.module) ? MODULES[cmd.module] : null;
    if (!m) return { ok: false, reason: '未知模块' };
    if (b.module === cmd.module) return { ok: false, reason: '已安装该模块' };
    if (!game.spend(m.cost)) return { ok: false, reason: '资源不足' };
    b.module = cmd.module;
    game.map.version++;
    game.events.emit('building:change', b);
    return { ok: true };
  },
  fund(game, cmd) {
    return game.projects.fund(cmd.id);
  },
  useGreat(game, cmd) {
    return game.great?.use(cmd.i) ?? { ok: false, reason: '伟人系统未就绪' };
  },
  tribute(game) {
    return game.unitSystem?.ai?.tribute() ?? { ok: false, reason: '外交不可用' };
  },
  /** 暂停/恢复生产:暂停后不占工人与电力,也不消耗原料。 */
  togglePause(game, cmd) {
    const b = owned(game, cmd);
    const def = b && BUILDINGS[b.type];
    if (!b || !(def.recipe || def.market || def.trains)) return { ok: false, reason: '该建筑不能暂停' };
    b.paused = !b.paused;
    return { ok: true, paused: b.paused };
  },
  /** 加速(仿等距经营游戏的 RUSH):按剩余时间付金币,下一 tick 完工。 */
  rush(game, cmd) {
    const b = owned(game, cmd);
    if (!b || (b.state !== 'construct' && b.state !== 'upgrade')) return { ok: false, reason: '没有可加速的工程' };
    const cost = rushCost(b);
    if (!game.spend({ money: cost })) return { ok: false, reason: `加速需要 ${cost} 金币` };
    b.progress = 1;
    return { ok: true, cost };
  },
  setReserve(game, cmd) {
    const b = owned(game, cmd);
    if (!b || !BUILDINGS[b.type].market) return { ok: false, reason: '不是你的集市' };
    if (![20, 50, 100, 200].includes(cmd.n)) return { ok: false, reason: '无效的保留量' };
    b.reserve = cmd.n;
    return { ok: true };
  },
  setSell(game, cmd) {
    const b = owned(game, cmd);
    if (!b || !BUILDINGS[b.type].market) return { ok: false, reason: '不是你的集市' };
    if (!Object.hasOwn(RESOURCES, cmd.res)) return { ok: false, reason: '未知货物' };
    if (cmd.on) b.sell.add(cmd.res);
    else b.sell.delete(cmd.res);
    return { ok: true };
  },
};

export function applyCommand(game, cmd) {
  if (!cmd || typeof cmd.type !== 'string' || typeof cmd.p !== 'string') return { ok: false, reason: '无效命令' };
  // 经济目前只有本地玩家一份(game.res);训练/取消也动用经济,所以对所有命令统一校验玩家
  if (!game.isPlayer(cmd.p)) return { ok: false, reason: '该玩家无权下达命令' };
  // 归属校验按阵营进行:合作模式下不同玩家 id 映射到同一阵营
  const c = { ...cmd, p: game.teamOf(cmd.p), issuer: cmd.p };
  if (RTS_TYPES.has(c.type)) {
    return game.unitSystem?.applyCommand?.(c) ?? { ok: false, reason: '单位系统未就绪' };
  }
  const h = Object.hasOwn(HANDLERS, c.type) ? HANDLERS[c.type] : null;
  if (!h) return { ok: false, reason: `未知命令 ${c.type}` };
  return h(game, c);
}

export const COMMAND_TYPES = [...Object.keys(HANDLERS), ...RTS_TYPES];
