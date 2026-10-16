// 命令总线:所有玩家意图(建造、铺路、升级、研究、下达军令…)都表示为纯 JSON 命令,
// 由 applyCommand 在 tick 边界执行。这样本地单人、录像回放、未来的锁步联机走同一条路径。
// 命令格式:{ type, p: 玩家 id, ...参数 };返回 { ok, reason?, ...附加结果 }。
import { BUILDINGS } from '../data/buildings.js';
import { RESOURCES } from '../data/resources.js';

const RTS_TYPES = new Set(['move', 'attack', 'stop', 'rally', 'train', 'cancelTrain']);

function owned(game, cmd) {
  const b = game.buildings.get(cmd.uid);
  return b && b.team === cmd.p ? b : null;
}

const HANDLERS = {
  build(game, cmd) {
    if (!BUILDINGS[cmd.building]) return { ok: false, reason: '未知建筑' };
    return game.placeBuilding(cmd.building, cmd.x, cmd.z, cmd.p);
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
  policy(game, cmd) {
    return game.setPolicy(cmd.slot, cmd.id ?? null);
  },
  deliver(game, cmd) {
    return game.contracts?.deliver(cmd.id) ?? { ok: false, reason: '合同系统未就绪' };
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
  setSell(game, cmd) {
    const b = owned(game, cmd);
    if (!b || !BUILDINGS[b.type].market) return { ok: false, reason: '不是你的集市' };
    if (!RESOURCES[cmd.res]) return { ok: false, reason: '未知货物' };
    if (cmd.on) b.sell.add(cmd.res);
    else b.sell.delete(cmd.res);
    return { ok: true };
  },
};

export function applyCommand(game, cmd) {
  if (!cmd || typeof cmd.type !== 'string' || typeof cmd.p !== 'string') return { ok: false, reason: '无效命令' };
  if (RTS_TYPES.has(cmd.type)) {
    return game.unitSystem?.applyCommand?.(cmd) ?? { ok: false, reason: '单位系统未就绪' };
  }
  const h = HANDLERS[cmd.type];
  if (!h) return { ok: false, reason: `未知命令 ${cmd.type}` };
  // 经济目前只有本地玩家一份(game.res);非本地玩家的经济命令在接入多人经济前一律拒绝
  if (cmd.p !== game.localPlayer) return { ok: false, reason: '该玩家没有经济权限' };
  return h(game, cmd);
}

export const COMMAND_TYPES = [...Object.keys(HANDLERS), ...RTS_TYPES];
