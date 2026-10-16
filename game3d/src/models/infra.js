// 自动拼接构件:道路与城墙。mask 位:1=北(-z) 2=东(+x) 4=南(+z) 8=西(-x)。
import { C, shade, vary, hash, finish, newModel, milPalette } from './common.js';

const N = 1;
const E = 2;
const S = 4;
const W = 8;

const ROAD = 0x50535a;
const WALK = 0xc9c6bd;
const CURB = 0xa9a69e;
const LINE = 0xf2d45a;

// ---------- 道路:沥青 + 未连接边的人行道/路缘 + 沿连接方向的虚线 ----------
export function road(mask) {
  const m = newModel();
  if (mask === 0) return plaza(m);
  const conn = (bit) => (mask & bit) !== 0;
  const count = [N, E, S, W].filter(conn).length;
  const walk = (x, z) => {
    if ((!conn(N) && z === 0) || (!conn(S) && z === 7) || (!conn(W) && x === 0) || (!conn(E) && x === 7)) return true;
    // 两条已连接方向相交的拐角:邻格人行道在这里汇合
    const cx = x === 0 ? W : x === 7 ? E : 0;
    const cz = z === 0 ? N : z === 7 ? S : 0;
    return cx !== 0 && cz !== 0 && conn(cx) && conn(cz);
  };
  const dashed = (t) => t % 4 < 2;
  const line = (x, z) => {
    const midX = x === 3 || x === 4;
    const midZ = z === 3 || z === 4;
    const junction = count >= 3;
    if (junction && x >= 2 && x <= 5 && z >= 2 && z <= 5) return false;
    if (midX && ((conn(N) && z <= 4) || (conn(S) && z >= 3))) return dashed(z);
    if (midZ && ((conn(W) && x <= 4) || (conn(E) && x >= 3))) return dashed(x);
    return false;
  };
  const cross = (x, z) => {
    if (count < 3) return false;
    if ((x === 1 || x === 6) && z >= 1 && z <= 6) return (conn(W) && x === 1 || conn(E) && x === 6) && z % 2 === 1;
    if ((z === 1 || z === 6) && x >= 1 && x <= 6) return (conn(N) && z === 1 || conn(S) && z === 6) && x % 2 === 1;
    return false;
  };
  for (let x = 0; x < 8; x++) {
    for (let z = 0; z < 8; z++) {
      if (walk(x, z)) {
        m.set(x, 0, z, WALK);
        m.set(x, 1, z, (x + z) % 3 === 0 ? CURB : WALK);
        continue;
      }
      let c = shade(ROAD, 0.94 + hash(x, 0, z) * 0.12);
      if (line(x, z)) c = LINE;
      else if (cross(x, z)) c = C.white;
      m.set(x, 0, z, c);
    }
  }
  if (count === 1) {
    // 尽头路:回车场中央画白色停止线
    const z = conn(N) ? 5 : conn(S) ? 2 : -1;
    const x = conn(W) ? 5 : conn(E) ? 2 : -1;
    for (let i = 1; i < 7; i++) {
      if (z >= 0) m.set(i, 0, z, C.white);
      if (x >= 0) m.set(x, 0, i, C.white);
    }
  }
  return finish(m, []);
}

function plaza(m) {
  for (let x = 0; x < 8; x++) {
    for (let z = 0; z < 8; z++) {
      const edge = x === 0 || z === 0 || x === 7 || z === 7;
      m.set(x, 0, z, edge ? CURB : ((x + z) % 2 ? WALK : 0xdcd4c0));
    }
  }
  m.box(3, 1, 3, 2, 1, 2, C.stoneLight);
  m.box(3, 2, 3, 2, 1, 2, C.leaf);
  m.set(3, 3, 4, 0xf06a8a);
  m.set(4, 3, 3, 0xffd04a);
  m.box(1, 1, 6, 2, 1, 1, C.wood);
  m.box(6, 1, 1, 1, 3, 1, C.iron);
  m.set(6, 4, 1, C.lamp, true);
  return finish(m, []);
}

// ---------- 城墙:中心立柱 + 向已连接方向伸出的墙臂;L1 木栅 / L2 石墙 / L3 混凝土+阵营条纹 ----------
export function wall(mask, level, team) {
  const P = milPalette(team);
  const m = newModel();
  const L = Math.max(1, Math.min(3, level));
  const half = L === 1 ? 1 : 2;
  const lo = 4 - half;
  const hi = 4 + half;
  const armH = [0, 9, 10, 11][L];
  const postH = [0, 12, 13, 14][L];
  const pLo = L === 1 ? 2 : 1;
  const pHi = 8 - pLo;
  const arms = [];
  if (mask & N) arms.push([lo, 0, hi - lo, pLo]);
  if (mask & S) arms.push([lo, pHi, hi - lo, 8 - pHi]);
  if (mask & W) arms.push([0, lo, pLo, hi - lo]);
  if (mask & E) arms.push([pHi, lo, 8 - pHi, hi - lo]);

  if (L === 1) {
    const logC = (x, y, z) => (y % 3 === 0 ? shade(C.log, 0.85) : C.log);
    for (const [x, z, w, d] of arms) {
      for (let i = x; i < x + w; i++) {
        for (let k = z; k < z + d; k++) {
          const h = armH - ((i + k) % 2);
          m.box(i, 0, k, 1, h, 1, logC);
          m.set(i, h, k, C.woodLight);
        }
      }
      m.box(x, 4, z, w, 1, d, C.woodDark);
    }
    m.box(pLo, 0, pLo, pHi - pLo, postH, pHi - pLo, logC);
    m.box(pLo - 1, postH, pLo - 1, pHi - pLo + 2, 1, pHi - pLo + 2, C.woodDark);
    for (const [x, z] of [[pLo - 1, pLo - 1], [pHi, pLo - 1], [pLo - 1, pHi], [pHi, pHi]]) m.set(x, postH + 1, z, C.woodDark);
    m.box(pLo, postH - 5, pHi, pHi - pLo, 4, 1, P.accent);
    m.box(pHi, postH - 5, pLo, 1, 4, pHi - pLo, P.accent);
  } else {
    const stone = L === 2;
    const body = stone ? (x, y, z) => vary(C.stone, 0.12)(x, y, z)
      : (x, y) => (y === armH - 3 || y === armH - 4 ? P.accent : (P.enemy ? P.wall : C.concrete));
    const capC = stone ? C.stoneLight : (P.enemy ? P.wallDark : C.concreteDark);
    for (const [x, z, w, d] of arms) {
      m.box(x, 0, z, w, armH, d, body);
      m.box(x, armH, z, w, 1, d, capC);
      // 雉堞:沿墙方向隔格加一层
      for (let i = x; i < x + w; i++) {
        for (let k = z; k < z + d; k++) {
          const along = w > d ? i : k;
          const outer = w > d ? (k === z || k === z + d - 1) : (i === x || i === x + w - 1);
          if (outer && along % 2 === 0) m.set(i, armH + 1, k, capC);
        }
      }
      if (P.enemy) for (let i = x; i < x + w; i += 2) for (let k = z; k < z + d; k += 2) m.set(i, armH + 2, k, P.spike);
    }
    m.box(pLo, 0, pLo, pHi - pLo, postH, pHi - pLo, (x, y, z) => (y >= postH - 4 && y < postH - 2 ? P.accent : body(x, y, z)));
    m.box(pLo - 1, postH, pLo - 1, pHi - pLo + 2, 1, pHi - pLo + 2, capC);
    for (let i = pLo - 1; i <= pHi; i++) {
      for (let k = pLo - 1; k <= pHi; k++) {
        const rim = i === pLo - 1 || i === pHi || k === pLo - 1 || k === pHi;
        if (rim && (i + k) % 2 === 0) m.set(i, postH + 1, k, capC);
      }
    }
    if (L === 3) m.set(4, postH + 1, 4, P.enemy ? 0xff3a2a : C.lamp, true);
    else {
      m.box(4, postH + 1, 4, 1, 4, 1, C.woodDark);
      m.box(5, postH + 3, 4, 2, 2, 1, P.accent);
    }
  }
  return finish(m, []);
}
