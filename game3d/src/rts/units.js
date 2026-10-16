// 单位对象、空间哈希、导航(寻路 + 跟随 + 卡住重寻)与分离转向。
import { UNITS } from '../data/units.js';
import { MAP_W, MAP_H } from '../world/map.js';
import { findPath, smoothPath, canStand, nearestWalkable } from './path.js';

export const AIR_Y = 2.2;
const STAND_R = 0.2;
const REPATH_MIN = 0.6; // 追击时重寻路的最小间隔(秒)
export const PATHS_PER_TICK = 10; // 每帧寻路预算,大波次出兵时分摊到多帧

export function makeUnit(id, type, team, x, z, hpMult = 1, rng = Math.random) {
  const def = UNITS[type];
  const maxHp = Math.round(def.hp * hpMult);
  return {
    kind: 'unit', id, type, team, def,
    x, z, hp: maxHp, maxHp, baseHp: def.hp,
    air: !!def.air, r: def.size * 0.5,
    heading: team === 'enemy' ? Math.PI * 0.75 : -Math.PI * 0.25,
    aimYaw: null,
    order: { kind: 'idle' },
    target: null, forced: false, alerted: false,
    cd: rng() * def.cooldown, scanT: rng() * 0.4,
    path: null, pathI: 0, rawCells: null, goalKey: '', pathVer: -1, pathT: -99, breach: null,
    stuckT: 0, stuckN: 0, moving: false, lastX: x, lastZ: z, returning: false,
    anchor: { x, z }, home: null, guard: false, wave: null,
    lastAttacker: null, hitT: -99, fireT: -99, dead: false,
  };
}

export function isUnit(t) { return t?.kind === 'unit'; }

// ---------- 空间哈希:2×2 格一桶,每 tick 重建 ----------
const BUCKET = 2;
const BW = Math.ceil(MAP_W / BUCKET);
const BH = Math.ceil(MAP_H / BUCKET);

export class SpatialGrid {
  constructor() {
    this.buckets = Array.from({ length: BW * BH }, () => []);
  }

  rebuild(units) {
    for (const b of this.buckets) b.length = 0;
    for (const u of units) {
      if (u.dead) continue;
      const bx = Math.min(BW - 1, Math.max(0, Math.floor(u.x / BUCKET)));
      const bz = Math.min(BH - 1, Math.max(0, Math.floor(u.z / BUCKET)));
      this.buckets[bz * BW + bx].push(u);
    }
  }

  /** 遍历 (x,z) 半径 r 内的单位;cb 返回 true 可提前终止。 */
  query(x, z, r, cb) {
    const x0 = Math.max(0, Math.floor((x - r) / BUCKET));
    const x1 = Math.min(BW - 1, Math.floor((x + r) / BUCKET));
    const z0 = Math.max(0, Math.floor((z - r) / BUCKET));
    const z1 = Math.min(BH - 1, Math.floor((z + r) / BUCKET));
    const r2 = r * r;
    for (let bz = z0; bz <= z1; bz++) {
      for (let bx = x0; bx <= x1; bx++) {
        for (const u of this.buckets[bz * BW + bx]) {
          const dx = u.x - x;
          const dz = u.z - z;
          if (dx * dx + dz * dz <= r2 && !u.dead && cb(u)) return;
        }
      }
    }
  }
}

// ---------- 命令 ----------
function resetNav(u) {
  u.path = null;
  u.goalKey = '';
  u.breach = null;
  u.stuckN = 0;
}

export function orderIdle(u) {
  u.order = { kind: 'idle' };
  u.target = null;
  u.forced = false;
  u.alerted = false;
  u.anchor = { x: u.x, z: u.z };
  resetNav(u);
}

export function orderMove(u, x, z) {
  u.order = { kind: 'move', x, z };
  u.target = null;
  u.forced = false;
  resetNav(u);
}

export function orderAttack(u, t) {
  u.order = { kind: 'attack', t };
  u.target = t;
  u.forced = true;
  resetNav(u);
}

/** 攻击移动:沿途交战。hq=true 时目的地为玩家指挥中心(敌军波次,读档后惰性解析)。 */
export function orderAMove(u, x, z, hq = false) {
  u.order = { kind: 'amove', x, z, hq };
  u.target = null;
  u.forced = false;
  resetNav(u);
}

export function orderHold(u) {
  u.order = { kind: 'hold' };
  u.target = null;
  u.forced = false;
  resetNav(u);
}

// ---------- 导航 ----------
function pathBlocked(map, u) {
  if (!u.rawCells) return false;
  for (const [x, z] of u.rawCells) if (!map.walkable(x, z)) return true;
  return false;
}

function computePath(rts, u, tx, tz, rect, key) {
  if (rts.pathBudget <= 0) return false;
  rts.pathBudget--;
  const map = rts.game.map;
  const sx = Math.floor(u.x);
  const sz = Math.floor(u.z);
  let goal;
  if (rect) goal = { rect };
  else {
    let gx = Math.floor(tx);
    let gz = Math.floor(tz);
    // 点在水上/建筑上:改为附近可通行格,避免全图搜索后停在奇怪的位置
    if (!map.walkable(gx, gz)) {
      const n = nearestWalkable(map, tx, tz, 3);
      if (n) { gx = n.x; gz = n.z; }
    }
    goal = { x: gx, z: gz };
  }
  let res = findPath(map, sx, sz, goal);
  u.breach = null;
  if (!res.reached && rect && rect.team && rect.team !== u.team) {
    // 目标被城墙围住:允许穿过敌方建筑(高代价),路径上第一座敌方建筑即为要拆的阻挡物
    const g = rts.game;
    const alt = findPath(map, sx, sz, goal, {
      extraCost: (i) => {
        const b = g.buildings.get(map.building[i]);
        return b && b.team !== u.team ? 8 : null;
      },
    });
    if (alt.reached) {
      const k = alt.cells.findIndex(([x, z]) => !map.walkable(x, z));
      if (k >= 0) {
        const [bx, bz] = alt.cells[k];
        u.breach = g.buildingAt(bx, bz);
        res = { cells: alt.cells.slice(0, k), reached: false };
      }
    }
  }
  u.rawCells = res.cells;
  u.path = smoothPath(map, u.x, u.z, res.cells);
  // 抵达目标格时把终点换成精确坐标(编队站位),否则停在格中心
  if (!rect && res.reached && canStand(map, tx, tz, STAND_R)) {
    if (u.path.length) u.path[u.path.length - 1] = [tx, tz];
    else u.path.push([tx, tz]);
  }
  u.pathI = 0;
  u.goalKey = key;
  u.pathVer = map.version;
  u.pathT = rts.game.time;
  u.stuckT = 0;
  return true;
}

/**
 * 朝 (tx,tz) 或建筑占地 rect 导航一步。返回 'moving' | 'arrived' | 'waiting'。
 * chase=true 表示目标会移动,目标所在格变化时(限频)重新寻路。
 */
export function navigate(rts, u, tx, tz, dt, { rect = null, chase = false } = {}) {
  const map = rts.game.map;
  if (u.air) {
    const d = Math.hypot(tx - u.x, tz - u.z);
    if (d < 0.08) return 'arrived';
    stepFree(u, tx, tz, dt);
    return 'moving';
  }
  const key = rect ? `b${rect.uid}` : `${Math.floor(tx)},${Math.floor(tz)}${chase ? '' : `:${tx.toFixed(2)},${tz.toFixed(2)}`}`;
  let blocked = false;
  if (u.path && map.version !== u.pathVer) {
    blocked = pathBlocked(map, u);
    if (!blocked) u.pathVer = map.version;
  }
  const stale = !u.path || blocked
    || (u.goalKey !== key && (!chase || rts.game.time - u.pathT > REPATH_MIN));
  if (stale && !computePath(rts, u, tx, tz, rect, key)) return u.path && !blocked ? follow(rts, u, dt) : 'waiting';
  return follow(rts, u, dt);
}

function follow(rts, u, dt) {
  while (u.path && u.pathI < u.path.length) {
    const [wx, wz] = u.path[u.pathI];
    const d = Math.hypot(wx - u.x, wz - u.z);
    const last = u.pathI === u.path.length - 1;
    if (d < (last ? 0.06 : 0.25)) { u.pathI++; continue; }
    stepGround(rts, u, wx, wz, dt);
    if (u.stuckT > 0.7) {
      u.stuckT = 0;
      u.stuckN++;
      // 多次卡住且离终点已很近(被友军挤住),视为到达
      const [ex, ez] = u.path[u.path.length - 1];
      if (u.stuckN > 2 && Math.hypot(ex - u.x, ez - u.z) < 1.4) { u.path = null; return 'arrived'; }
      u.path = null; // 下次调用重寻路
      return 'moving';
    }
    return 'moving';
  }
  u.path = null;
  return 'arrived';
}

function stepFree(u, tx, tz, dt) {
  const dx = tx - u.x;
  const dz = tz - u.z;
  const d = Math.hypot(dx, dz);
  const m = Math.min(d, u.def.speed * dt);
  u.x = Math.min(MAP_W - 0.3, Math.max(0.3, u.x + (dx / d) * m));
  u.z = Math.min(MAP_H - 0.3, Math.max(0.3, u.z + (dz / d) * m));
  u.heading = Math.atan2(dx, dz);
  u.moving = true;
}

function stepGround(rts, u, tx, tz, dt) {
  const map = rts.game.map;
  const dx = tx - u.x;
  const dz = tz - u.z;
  const d = Math.hypot(dx, dz);
  const m = Math.min(d, u.def.speed * dt);
  const nx = u.x + (dx / d) * m;
  const nz = u.z + (dz / d) * m;
  u.heading = Math.atan2(dx, dz);
  u.moving = true;
  if (canStand(map, nx, nz, STAND_R)) { u.x = nx; u.z = nz; }
  else if (canStand(map, nx, u.z, STAND_R)) u.x = nx;
  else if (canStand(map, u.x, nz, STAND_R)) u.z = nz;
  else { u.stuckT += dt; return; }
  // 位移明显小于期望(被挤住)也累计卡住时间
  if (m > 0.001 && Math.hypot(u.x - u.lastX, u.z - u.lastZ) < m * 0.25) u.stuckT += dt;
  else u.stuckT = Math.max(0, u.stuckT - dt);
}

export function stopNav(u) {
  u.path = null;
  u.goalKey = '';
}

/** 分离转向:同层(地面/空中)单位互相推开,推力受站位校验约束,不会被推进建筑或水里。 */
export function separate(rts, dt) {
  const map = rts.game.map;
  const grid = rts.grid;
  const maxPush = 1.6 * dt;
  for (const u of rts.units) {
    if (u.dead) continue;
    let px = 0;
    let pz = 0;
    grid.query(u.x, u.z, u.r + 0.5, (o) => {
      if (o === u || o.air !== u.air) return false;
      const dx = u.x - o.x;
      const dz = u.z - o.z;
      const min = u.r + o.r + 0.08;
      const d2 = dx * dx + dz * dz;
      if (d2 >= min * min) return false;
      const d = Math.sqrt(d2) || 0.001;
      const k = (min - d) / min;
      // 移动中的单位推开静止单位更多,避免挡路
      const w = u.moving && !o.moving ? 0.35 : !u.moving && o.moving ? 1.4 : 1;
      px += (d2 === 0 ? Math.cos(u.id) : dx / d) * k * w;
      pz += (d2 === 0 ? Math.sin(u.id) : dz / d) * k * w;
      return false;
    });
    const pl = Math.hypot(px, pz);
    if (pl < 1e-4) continue;
    const s = Math.min(maxPush, pl * 3 * dt) / pl;
    const nx = u.x + px * s;
    const nz = u.z + pz * s;
    if (u.air) { u.x = Math.min(MAP_W - 0.3, Math.max(0.3, nx)); u.z = Math.min(MAP_H - 0.3, Math.max(0.3, nz)); continue; }
    if (canStand(map, nx, nz, STAND_R)) { u.x = nx; u.z = nz; }
    else if (canStand(map, nx, u.z, STAND_R)) u.x = nx;
    else if (canStand(map, u.x, nz, STAND_R)) u.z = nz;
  }
}

/** 单位卡在不可通行格(读档、建筑放置边界情况):挪到最近可通行格中心。 */
export function unstick(map, u) {
  if (u.air || canStand(map, u.x, u.z, STAND_R * 0.5)) return;
  const n = nearestWalkable(map, u.x, u.z, 6);
  if (n) { u.x = n.x + 0.5; u.z = n.z + 0.5; }
}
