// 网格寻路:8 向 A*(禁止切角)+ 视线平滑 + 站位判定。
// 64×64 地图很小,用定长类型数组 + 访问戳 + 二叉堆,单次全图搜索也 <1ms,无需每次清空。
import { MAP_W, MAP_H } from '../world/map.js';

const N = MAP_W * MAP_H;
const SQ2 = Math.SQRT2;
const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, SQ2], [1, -1, SQ2], [-1, 1, SQ2], [-1, -1, SQ2]];

const gScore = new Float32Array(N);
const parent = new Int32Array(N);
const seen = new Uint32Array(N);
const closed = new Uint32Array(N);
let stampNo = 0;

// 惰性删除的二叉堆:同一节点可多次入堆,出堆时用 closed 戳过滤
const HEAP_MAX = N * 8;
const heapI = new Int32Array(HEAP_MAX);
const heapF = new Float32Array(HEAP_MAX);
let heapN = 0;

function push(i, f) {
  if (heapN >= HEAP_MAX) return;
  let k = heapN++;
  while (k > 0) {
    const p = (k - 1) >> 1;
    if (heapF[p] <= f) break;
    heapI[k] = heapI[p]; heapF[k] = heapF[p];
    k = p;
  }
  heapI[k] = i; heapF[k] = f;
}

function pop() {
  const top = heapI[0];
  const li = heapI[--heapN];
  const lf = heapF[heapN];
  let k = 0;
  for (;;) {
    let c = 2 * k + 1;
    if (c >= heapN) break;
    if (c + 1 < heapN && heapF[c + 1] < heapF[c]) c++;
    if (heapF[c] >= lf) break;
    heapI[k] = heapI[c]; heapF[k] = heapF[c];
    k = c;
  }
  heapI[k] = li; heapF[k] = lf;
  return top;
}

function octile(dx, dz) {
  dx = Math.abs(dx); dz = Math.abs(dz);
  return Math.max(dx, dz) + (SQ2 - 1) * Math.min(dx, dz);
}

/**
 * A* 寻路。goal 为 { x, z }(目标格)或 { rect: {x,z,w,d} }(到达建筑占地的任一 8 邻格即可)。
 * opts.extraCost(i) 返回不可通行格的额外代价(null=不可通行),用于「破墙」寻路。
 * 返回 { cells: [[x,z],...](不含起点), reached }。未达时返回离目标最近的可达格路径。
 */
export function findPath(map, sx, sz, goal, { extraCost = null, maxNodes = N + 64 } = {}) {
  stampNo++;
  if (stampNo === 0xffffffff) { seen.fill(0); closed.fill(0); stampNo = 1; }
  heapN = 0;
  const rect = goal.rect;
  const gx = goal.x;
  const gz = goal.z;
  const h = rect
    ? (x, z) => octile(Math.max(rect.x - 1 - x, 0, x - (rect.x + rect.w)), Math.max(rect.z - 1 - z, 0, z - (rect.z + rect.d)))
    : (x, z) => octile(x - gx, z - gz);
  const isGoal = rect
    ? (x, z) => x >= rect.x - 1 && x <= rect.x + rect.w && z >= rect.z - 1 && z <= rect.z + rect.d
      && !(x >= rect.x && x < rect.x + rect.w && z >= rect.z && z < rect.z + rect.d)
    : (x, z) => x === gx && z === gz;
  const cost = (x, z) => {
    if (!map.inside(x, z)) return null;
    if (map.walkable(x, z)) return 0;
    return extraCost ? extraCost(map.idx(x, z)) : null;
  };

  const s = map.idx(sx, sz);
  seen[s] = stampNo;
  gScore[s] = 0;
  parent[s] = -1;
  push(s, h(sx, sz));
  let best = s;
  let bestH = h(sx, sz);
  let expanded = 0;
  let found = -1;
  while (heapN > 0 && expanded < maxNodes) {
    const i = pop();
    if (closed[i] === stampNo) continue;
    closed[i] = stampNo;
    expanded++;
    const x = i % MAP_W;
    const z = (i - x) / MAP_W;
    if (isGoal(x, z)) { found = i; break; }
    const hi = h(x, z);
    if (hi < bestH) { bestH = hi; best = i; }
    for (const [dx, dz, step] of DIRS) {
      const nx = x + dx;
      const nz = z + dz;
      const c = cost(nx, nz);
      if (c === null) continue;
      // 禁止切角:斜走时两侧正交格都须可通行
      if (dx && dz && (cost(x + dx, z) === null || cost(x, z + dz) === null)) continue;
      const ni = map.idx(nx, nz);
      if (closed[ni] === stampNo) continue;
      const ng = gScore[i] + step + c;
      if (seen[ni] === stampNo && ng >= gScore[ni]) continue;
      seen[ni] = stampNo;
      gScore[ni] = ng;
      parent[ni] = i;
      push(ni, ng + h(nx, nz) * 1.001);
    }
  }
  const end = found >= 0 ? found : best;
  const cells = [];
  for (let i = end; i !== s && i >= 0; i = parent[i]) cells.push([i % MAP_W, Math.floor(i / MAP_W)]);
  cells.reverse();
  return { cells, reached: found >= 0 || (!rect && sx === gx && sz === gz) };
}

/** 以 (x,z) 为中心、半径 r 的单位能否站立:中心与 8 个偏移点都在可通行格内。 */
export function canStand(map, x, z, r = 0.2) {
  const d = r * 0.7;
  return map.walkable(Math.floor(x), Math.floor(z))
    && map.walkable(Math.floor(x + r), Math.floor(z)) && map.walkable(Math.floor(x - r), Math.floor(z))
    && map.walkable(Math.floor(x), Math.floor(z + r)) && map.walkable(Math.floor(x), Math.floor(z - r))
    && map.walkable(Math.floor(x + d), Math.floor(z + d)) && map.walkable(Math.floor(x - d), Math.floor(z - d))
    && map.walkable(Math.floor(x + d), Math.floor(z - d)) && map.walkable(Math.floor(x - d), Math.floor(z + d));
}

export function lineClear(map, ax, az, bx, bz, r = 0.24) {
  const len = Math.hypot(bx - ax, bz - az);
  const n = Math.ceil(len / 0.2);
  for (let k = 1; k <= n; k++) {
    const t = k / n;
    if (!canStand(map, ax + (bx - ax) * t, az + (bz - az) * t, r)) return false;
  }
  return true;
}

const MAX_SEG = 10;

/** 视线平滑:贪心向前延伸,能直线到达就跳过中间格;返回世界坐标路点。 */
export function smoothPath(map, sx, sz, cells) {
  const pts = cells.map(([x, z]) => [x + 0.5, z + 0.5]);
  if (pts.length <= 2) return pts;
  const out = [];
  let ax = sx;
  let az = sz;
  let j = 0;
  while (j < pts.length) {
    let k = j;
    while (k + 1 < pts.length && k - j < MAX_SEG && lineClear(map, ax, az, pts[k + 1][0], pts[k + 1][1])) k++;
    out.push(pts[k]);
    [ax, az] = pts[k];
    j = k + 1;
  }
  return out;
}

/** 螺旋搜索离 (x,z) 最近的可站立格(返回格坐标),ok 为附加过滤。 */
export function nearestWalkable(map, x, z, maxR = 6, ok = null) {
  const cx = Math.floor(x);
  const cz = Math.floor(z);
  let best = null;
  let bestD = Infinity;
  for (let r = 0; r <= maxR; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const nx = cx + dx;
        const nz = cz + dz;
        if (!map.walkable(nx, nz) || (ok && !ok(nx, nz))) continue;
        const d = Math.hypot(nx + 0.5 - x, nz + 0.5 - z);
        if (d < bestD) { bestD = d; best = { x: nx, z: nz }; }
      }
    }
    if (best) return best;
  }
  return null;
}

/** 建筑占地外一圈的格子(训练出兵、近战包围用)。 */
export function ringCells(b) {
  const out = [];
  for (let z = b.z - 1; z <= b.z + b.d; z++) {
    for (let x = b.x - 1; x <= b.x + b.w; x++) {
      if (x >= b.x && x < b.x + b.w && z >= b.z && z < b.z + b.d) continue;
      out.push([x, z]);
    }
  }
  return out;
}
