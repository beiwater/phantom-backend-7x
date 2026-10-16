// 自动铺路:为一个(拟放置的)占地找到通往已连通道路网的最短新路。
// 纯函数,只读地图状态 → 可在 UI 预览与命令执行中共用,结果确定。
import { OWNER, T, MAP_W } from '../world/map.js';
import { ring } from './economy.js';

const MAX_LEN = 30;

/** 从指挥中心外圈出发,沿道路 BFS,得到已连通道路集合。 */
function connectedRoads(game) {
  const m = game.map;
  const hq = game.playerHQ();
  const seen = new Set();
  if (!hq) return seen;
  const q = [];
  for (const [x, z] of ring(hq)) {
    if (m.inside(x, z) && m.road[m.idx(x, z)]) { seen.add(m.idx(x, z)); q.push([x, z]); }
  }
  for (let i = 0; i < q.length; i++) {
    const [x, z] = q[i];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const nz = z + dz;
      if (!m.inside(nx, nz)) continue;
      const ni = m.idx(nx, nz);
      if (m.road[ni] && !seen.has(ni)) { seen.add(ni); q.push([nx, nz]); }
    }
  }
  return seen;
}

/**
 * 返回需要新铺的道路格 [[x,z]...];已连通返回 [];找不到返回 null。
 * 占地 {x,z,w,d} 内的格子视为障碍(建筑将占据)。
 */
export function planRoad(game, fp) {
  const m = game.map;
  const hq = game.playerHQ();
  const net = connectedRoads(game);
  const inFp = (x, z) => x >= fp.x && x < fp.x + fp.w && z >= fp.z && z < fp.z + fp.d;
  const start = ring(fp).filter(([x, z]) => m.inside(x, z));
  if (start.some(([x, z]) => net.has(m.idx(x, z)) || (hq && m.building[m.idx(x, z)] === hq.uid))) return [];
  const free = (x, z) => {
    if (!m.inside(x, z) || inFp(x, z)) return false;
    const i = m.idx(x, z);
    return m.ownerAt(x, z) === OWNER.player && m.terrain[i] !== T.water && !m.building[i] && !game.ruins?.at(x, z);
  };
  const prev = new Map();
  const q = [];
  for (const [x, z] of start) {
    if (!free(x, z)) continue;
    const i = m.idx(x, z);
    prev.set(i, -1);
    q.push([x, z, 1]);
  }
  for (let qi = 0; qi < q.length; qi++) {
    const [x, z, len] = q[qi];
    const i = m.idx(x, z);
    // 到达:当前格紧邻已连通道路(或指挥中心)
    const touches = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => {
      const nx = x + dx;
      const nz = z + dz;
      if (!m.inside(nx, nz)) return false;
      const ni = m.idx(nx, nz);
      return net.has(ni) || (hq && m.building[ni] === hq.uid);
    });
    if (touches) return rebuild(m, i, prev);
    if (len >= MAX_LEN) continue;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const nz = z + dz;
      if (!free(nx, nz)) continue;
      const ni = m.idx(nx, nz);
      if (prev.has(ni)) continue;
      prev.set(ni, i);
      q.push([nx, nz, len + 1]);
    }
  }
  return null;
}

/** 沿 prev 回溯得到路径,跳过已有道路格(未连通的旧路可复用)。 */
function rebuild(m, end, prev) {
  const out = [];
  for (let c = end; c !== -1; c = prev.get(c)) {
    if (m.road[c]) continue;
    const x = c % MAP_W;
    out.push([x, (c - x) / MAP_W]);
  }
  return out;
}
