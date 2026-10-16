// 核心 / 民生 / 科研建筑:指挥中心(随时代变化)、民居、集市、仓库、学院、研究所。
import {
  C, shade, vary, hash, pad, ring, block, chimney, flag, crate, pyramid, lattice, finish, newModel, teamColors,
} from './common.js';

const GOLD = 0xe2b440;

// ---------- 指挥中心:L1 拓荒木石议事厅 / L2 工业时代砖楼 + 钟楼 / L3 现代玻璃塔 + 停机坪 ----------
export function hq(L, team) {
  const m = newModel();
  const t = teamColors(team);
  const enemy = team === 'enemy';
  const smoke = [];
  if (L <= 1) hqFrontier(m, t, enemy, smoke);
  else if (L === 2) hqIndustrial(m, t, enemy, smoke);
  else hqModern(m, t, enemy);
  return finish(m, smoke);
}

function hqFrontier(m, t, enemy, smoke) {
  const log = enemy ? 0x4a3a30 : C.log;
  const logD = enemy ? 0x33281f : C.woodDark;
  const found = enemy ? 0x55565c : C.stone;
  const roof = enemy ? 0x2c2426 : 0x9a4a2a;
  pad(m, 24, 24, {
    edge: enemy ? 0x5a554c : C.padEdge,
    inner: (x, z) => {
      if (z >= 17 && x >= 10 && x <= 13) return vary(C.stoneLight, 0.08)(x, 0, z);
      if (x < 3 || x > 20 || z < 3 || z > 20) return enemy ? 0x6c6a52 : C.grass;
      return vary(enemy ? 0x7a6a56 : C.dirt, 0.08)(x, 0, z);
    },
  });
  // 木栅栏,正门(+z)留口;敌军栅栏更高更尖
  const fh = enemy ? 5 : 3;
  for (let i = 1; i <= 22; i++) {
    for (const [x, z] of [[i, 1], [i, 22], [1, i], [22, i]]) {
      if (z === 22 && x >= 9 && x <= 14) continue;
      const h = fh + ((x + z) % 2);
      m.box(x, 1, z, 1, h, 1, log);
      m.set(x, h + 1, z, enemy ? 0x1c1c20 : C.woodLight);
    }
  }
  // 石基 + 原木墙
  m.box(5, 1, 6, 14, 2, 11, vary(found, 0.1));
  m.box(5, 3, 6, 14, 7, 11, (x, y, z) => {
    if ((x === 5 || x === 18) && (z === 6 || z === 16)) return logD;
    return y % 2 ? log : shade(log, 0.88);
  });
  m.box(11, 3, 16, 2, 4, 1, logD);
  for (const [x, z] of [[6, 16], [7, 16], [16, 16], [17, 16]]) m.box(x, 5, z, 1, 2, 1, C.win, true);
  for (const z of [8, 9, 13, 14]) m.box(18, 5, z, 1, 2, 1, C.win, true);
  m.gableRoof(4, 10, 5, 16, 13, (x, y) => (y % 2 ? roof : shade(roof, 0.85)));
  // 门廊
  m.box(8, 1, 17, 8, 2, 3, C.woodLight);
  m.box(8, 3, 19, 1, 5, 1, logD);
  m.box(15, 3, 19, 1, 5, 1, logD);
  m.box(7, 8, 17, 10, 1, 4, shade(roof, 0.9));
  // 屋脊钟楼 + 阵营旗
  m.box(10, 14, 9, 4, 6, 4, log);
  m.box(11, 17, 12, 2, 2, 1, C.black);
  m.set(11, 17, 12, GOLD);
  pyramid(m, 9, 20, 8, 6, 6, roof);
  flag(m, 11, 23, 10, 4, t.primary, C.woodLight);
  chimney(m, 16, 10, 7, 2, 9, found, null, smoke);
  // 门口旗杆 + 火把
  for (const x of [8, 15]) {
    flag(m, x, 1, 22, 7, t.primary, logD, 2, 3);
    m.set(x, 5, 21, C.fire, true);
  }
  // 水井
  ring(m, 3, 1, 18, 3, 3, C.stone, 2);
  m.set(4, 1, 19, C.water, true);
  m.box(3, 3, 18, 1, 3, 1, logD);
  m.box(5, 3, 20, 1, 3, 1, logD);
  m.gableRoof(2, 6, 18, 5, 3, roof);
  crate(m, 19, 1, 18, 2, 2, 2, C.woodLight);
  crate(m, 19, 3, 18, 2, 1, 2, C.wood);
}

function hqIndustrial(m, t, enemy, smoke) {
  const brick = enemy ? 0x4c403c : C.brick;
  const brickD = enemy ? 0x382f2c : C.brickDark;
  const stoneL = enemy ? 0x77777c : C.stoneLight;
  const roof = enemy ? 0x26272b : C.slate;
  const win = enemy ? 0xff5a36 : C.win;
  pad(m, 24, 24, {
    edge: enemy ? 0x4a4a4e : C.padEdge,
    inner: (x, z) => ((x < 3 || x > 20) && z > 18 ? (enemy ? 0x5c5a4a : C.grass) : vary(enemy ? 0x7a7a7e : C.stoneLight, 0.06)(x, 0, z)),
  });
  const brickFn = (i, j) => ((i + (j % 2) * 2) % 4 === 0 ? brickD : brick);
  block(m, 3, 1, 5, 18, 11, 12, { wall: brickFn, win, sx: 3, sy: 4, wy: 2, oy: 1, base: stoneL });
  m.box(2, 12, 4, 20, 1, 14, stoneL);
  m.box(3, 13, 5, 18, 1, 12, roof);
  m.box(4, 14, 6, 16, 1, 10, shade(roof, 0.85));
  chimney(m, 4, 13, 6, 2, 8, brickD, null, smoke);
  chimney(m, 18, 13, 6, 2, 8, brickD, null, smoke);
  // 钟楼(向前突出)
  m.box(9, 1, 13, 6, 23, 6, (x, y, z) => ((x === 9 || x === 14) && (z === 13 || z === 18) ? stoneL : brickFn(x + z, y)));
  m.box(11, 1, 18, 2, 4, 1, C.woodDark);
  m.box(10, 5, 18, 4, 1, 1, stoneL);
  for (const y of [8, 9, 13, 14]) { m.box(11, y, 18, 2, 1, 1, win, true); m.box(14, y, 15, 1, 1, 2, win, true); }
  const face = enemy ? 0xc8beb0 : C.white;
  const hand = enemy ? t.primary : C.black;
  for (let a = 0; a < 4; a++) {
    for (let b = 0; b < 4; b++) {
      if ((a === 0 || a === 3) && (b === 0 || b === 3)) continue;
      m.set(10 + a, 18 + b, 18, face, true);
      m.set(14, 18 + b, 14 + a, face, true);
    }
  }
  m.set(11, 20, 18, hand); m.set(11, 21, 18, hand); m.set(12, 20, 18, hand);
  m.set(14, 20, 15, hand); m.set(14, 21, 15, hand); m.set(14, 20, 16, hand);
  m.box(8, 24, 12, 8, 1, 8, stoneL);
  pyramid(m, 9, 25, 13, 6, 6, roof);
  flag(m, 11, 28, 15, 5, t.primary);
  m.box(10, 1, 19, 4, 1, 2, stoneL);
  // 立面阵营旗幡 + 路灯
  for (const x of [5, 17]) m.box(x, 5, 17, 2, 5, 1, (i, j) => (j === 5 ? GOLD : t.primary));
  for (const x of [7, 16]) { m.box(x, 1, 21, 1, 4, 1, C.iron); m.set(x, 5, 21, C.lamp, true); }
}

function hqModern(m, t, enemy) {
  const con = enemy ? 0x3a3c42 : C.concrete;
  const glass = enemy ? 0x23262d : C.glass;
  const mull = enemy ? 0x15161a : C.steel;
  const win = enemy ? 0xff4a2e : C.winCool;
  pad(m, 24, 24, {
    edge: enemy ? 0x3a3a3e : C.padEdge,
    inner: (x, z) => ((x + z) % 6 === 0 ? (enemy ? 0x5a5a60 : C.offWhite) : (enemy ? 0x6a6a70 : C.pad)),
  });
  for (const [x, z] of [[1, 1], [20, 1], [1, 20], [20, 20]]) {
    m.box(x, 1, z, 3, 1, 3, C.concrete);
    m.box(x, 2, z, 3, 1, 3, C.leaf);
  }
  block(m, 4, 1, 4, 16, 5, 16, { wall: con, win, sx: 4, wx: 3, sy: 5, wy: 3, ox: 1, oy: 1 });
  ring(m, 4, 6, 4, 16, 16, t.primary);
  m.box(5, 6, 5, 14, 1, 14, enemy ? 0x4a4c52 : C.grass);
  m.box(9, 4, 20, 6, 1, 2, t.primary);
  // 幕墙:竖梃 + 随机亮窗
  m.box(7, 7, 7, 10, 18, 10, (x, y, z) => {
    const u = x === 7 || x === 16 ? z : x;
    if (y % 3 === 0 || u % 3 === 1) return mull;
    return glass;
  });
  for (let y = 7; y < 25; y++) {
    for (let u = 7; u < 17; u++) {
      if (y % 3 === 0 || u % 3 === 1 || hash(u, y, 5) < 0.45) continue;
      m.set(u, y, 16, win, true);
      if (hash(y, u, 9) > 0.4) m.set(16, y, u, win, true);
    }
  }
  ring(m, 7, 15, 7, 10, 10, t.primary);
  ring(m, 7, 24, 7, 10, 10, t.primary);
  // 屋顶停机坪
  m.box(6, 25, 6, 12, 1, 12, (x, y, z) => {
    const d = Math.hypot(x + 0.5 - 12, z + 0.5 - 12);
    if (d > 4.2 && d < 5.3) return C.yellow;
    const hBar = (x === 10 || x === 13) && z >= 10 && z <= 13;
    const hMid = z === 12 && x > 10 && x < 13;
    return hBar || hMid ? C.white : 0x3a3d44;
  });
  for (const [x, z] of [[6, 6], [17, 6], [6, 17], [17, 17]]) m.set(x, 26, z, enemy ? t.primary : 0x6aff8a, true);
  m.box(16, 26, 7, 1, 7, 1, C.steel);
  m.set(16, 33, 7, 0xff3a2a, true);
}

// ---------- 民居:L1 小屋 / L2 二层 / L3 烟囱+花园 / L4 太阳能板+天线 ----------
export function house(L) {
  const m = newModel();
  const smoke = [];
  pad(m, 8, 8, { inner: (x, z) => (z >= 6 && (x === 3 || x === 4) ? C.stoneLight : C.grass) });
  const H = L >= 2 ? 7 : 4;
  m.box(1, 1, 1, 6, H, 5, (x, y) => (y >= 5 ? (y % 2 ? C.woodLight : shade(C.woodLight, 0.9)) : C.cream));
  m.box(3, 1, 5, 1, 2, 1, C.woodDark);
  m.set(5, 2, 5, C.win, true);
  m.set(6, 2, 3, C.win, true);
  if (L >= 2) {
    for (const x of [2, 5]) m.set(x, 6, 5, C.win, true);
    for (const z of [2, 4]) m.set(6, 6, z, C.win, true);
  }
  const roofC = L >= 2 ? C.terracotta : 0xb8743c;
  m.gableRoof(0, H + 1, 0, 8, 7, (x, y) => ((y - H) % 2 ? roofC : shade(roofC, 0.85)));
  if (L >= 3) {
    chimney(m, 5, H + 1, 2, 1, 6, C.brick, null, smoke);
    for (const x of [1, 2, 5, 6]) {
      m.set(x, 1, 6, C.leaf);
      m.set(x, 2, 6, (x % 2 ? 0xf06a8a : 0xffd04a));
    }
  }
  if (L >= 4) {
    for (let l = 0; l < 3; l++) {
      for (let x = 1; x <= 4; x++) m.set(x, H + 1 + l, 6 - l, (x + l) % 2 ? C.solar : 0x3d5ca8);
    }
    m.box(1, H + 4, 3, 1, 3, 1, C.steel);
    m.box(0, H + 6, 3, 3, 1, 1, C.steel);
  }
  return finish(m, smoke);
}

// ---------- 集市:每级加一个摊位 / 喷泉 / 商铺 ----------
function stall(m, x0, z0, color, goods) {
  m.box(x0, 1, z0 + 3, 5, 2, 2, C.wood);
  for (let i = 0; i < 5; i++) for (let k = 0; k < 2; k++) m.set(x0 + i, 3, z0 + 3 + k, goods[(i + k * 2) % goods.length]);
  m.box(x0 + 1, 1, z0, 3, 2, 1, C.woodDark);
  for (const [i, k] of [[0, 0], [4, 0], [0, 4], [4, 4]]) m.box(x0 + i, 1, z0 + k, 1, 5, 1, C.woodDark);
  m.gableRoof(x0, 6, z0, 5, 5, (x) => ((x - x0) % 2 ? C.white : color));
  for (let i = 0; i < 5; i += 2) m.set(x0 + i, 5, z0 + 4, color);
}

export function market(L) {
  const m = newModel();
  pad(m, 16, 16, { inner: (x, z) => (((x >> 1) + (z >> 1)) % 2 ? 0xe9d6b2 : 0xd6b688) });
  stall(m, 1, 1, C.red, [0xd03a2a, 0xf08a2a, 0x7ac040, 0xe8c040]);
  crate(m, 6, 1, 2, 2, 2, 2, C.woodLight);
  m.cylinder(7, 3, 3, 1, 1, 0xf08a2a);
  if (L >= 2) stall(m, 10, 1, C.blue, [0x5a8ad0, 0xf6f6f2, 0x3a5aa0, 0xd0d8e8]);
  if (L >= 3) stall(m, 1, 10, C.green, [0x7ac040, 0xa05a2a, 0xf0e050, 0x5aa04a]);
  if (L >= 4) {
    ring(m, 6, 1, 6, 4, 4, C.stoneLight, 2);
    m.box(7, 1, 7, 2, 1, 2, C.water, true);
    m.box(7, 2, 7, 2, 2, 2, C.stoneLight);
    m.box(7, 4, 7, 2, 1, 2, C.water, true);
    m.set(7, 5, 7, 0xbfe8ff, true);
  }
  if (L >= 5) {
    block(m, 10, 1, 10, 5, 7, 5, { wall: (i, j) => ((i + j) % 3 ? C.brick : C.brickDark), sx: 2, sy: 3, ox: 1, oy: 3 });
    m.box(11, 1, 14, 3, 3, 1, C.win, true);
    m.box(9, 4, 15, 7, 1, 1, (x) => (x % 2 ? C.yellow : C.white));
    m.box(10, 8, 10, 5, 1, 5, C.terracotta);
    m.box(11, 9, 14, 3, 2, 1, C.yellow, true);
    for (const [x, z] of [[6, 14], [9, 1]]) { m.box(x, 1, z, 1, 6, 1, C.iron); m.set(x, 7, z, C.lamp, true); }
  }
  return finish(m, []);
}

// ---------- 仓库:L1 仓棚+叉车 / L2 装卸台 / L3 集装箱 / L4 叠箱 / L5 龙门吊 ----------
function container(m, x, y, z, w, h, d, color) {
  m.box(x, y, z, w, h, d, (i, j, k) => (k === z || k === z + d - 1 ? shade(color, 0.75) : ((i + k) % 2 ? color : shade(color, 0.88))));
}

export function warehouse(L) {
  const m = newModel();
  pad(m, 16, 16, { inner: (x, z) => ((z === 13 && x % 3 === 0) || (x === 10 && z > 12) ? C.yellow : null) });
  m.box(1, 1, 1, 9, 6, 11, (x, y, z) => ((x + z) % 2 ? 0xd2d8de : 0xb8c0c8));
  m.box(3, 1, 11, 5, 4, 1, (x, y) => (y % 2 ? 0x707880 : 0x5a6068));
  m.box(9, 1, 4, 1, 3, 2, C.woodDark);
  m.set(9, 5, 7, C.win, true);
  m.gableRoof(1, 7, 0, 9, 13, (x) => (x % 2 ? C.teal : C.tealDark), false);
  m.box(4, 9, 12, 3, 2, 1, C.orange);
  // 叉车
  m.box(4, 1, 13, 2, 2, 2, C.yellow);
  m.box(4, 3, 13, 2, 1, 1, C.black);
  m.box(4, 1, 15, 2, 1, 1, C.steelDark);
  m.box(4, 1, 12, 1, 4, 1, C.steelDark);
  if (L >= 2) {
    m.box(10, 1, 2, 2, 2, 9, C.concreteDark);
    m.box(11, 3, 2, 1, 1, 9, C.yellow);
    m.box(10, 7, 1, 3, 1, 11, C.steel);
    m.box(12, 1, 1, 1, 6, 1, C.steelDark);
    m.box(12, 1, 11, 1, 6, 1, C.steelDark);
    crate(m, 10, 3, 3, 1, 2, 2, C.woodLight);
    crate(m, 10, 3, 7, 1, 1, 2, C.woodLight);
  }
  if (L >= 3) {
    container(m, 13, 1, 1, 2, 3, 6, 0xc8402e);
    container(m, 13, 1, 8, 2, 3, 6, 0x3a6ad0);
  }
  if (L >= 4) {
    container(m, 13, 4, 2, 2, 3, 6, 0x3fae5a);
    container(m, 13, 4, 8, 2, 3, 5, 0xf2a230);
  }
  if (L >= 5) {
    for (const x of [12, 15]) m.box(x, 1, 7, 1, 10, 1, C.yellow);
    m.box(12, 11, 6, 4, 1, 3, C.yellow);
    m.box(13, 10, 7, 2, 1, 1, C.iron);
    m.box(13, 8, 7, 1, 2, 1, C.black);
  }
  return finish(m, []);
}

// ---------- 学院:古典柱廊 + 山花;L2 右翼 / L3 穹顶 / L4 钟楼 / L5 庭院 ----------
export function academy(L) {
  const m = newModel();
  pad(m, 16, 16, {
    color: C.stoneLight,
    inner: (x, z) => (z >= 12 && (x < 4 || x > 7) ? C.grass : null),
  });
  m.box(1, 1, 1, 10, 1, 11, C.stoneLight);
  block(m, 2, 2, 2, 8, 6, 7, { wall: C.cream, sx: 2, sy: 6, wy: 3, oy: 1 });
  m.box(5, 2, 8, 2, 4, 1, C.woodDark);
  for (const x of [2, 4, 7, 9]) m.box(x, 2, 10, 1, 6, 1, C.white);
  m.box(1, 8, 2, 10, 1, 10, C.white);
  m.gableRoof(1, 9, 2, 10, 10, (x, y, z) => (z === 11 ? C.offWhite : C.terracotta), false);
  m.set(6, 11, 11, GOLD);
  if (L >= 2) {
    block(m, 11, 1, 3, 4, 5, 7, { wall: C.creamDark, sx: 2, sy: 5, wy: 2, oy: 1, ox: 1 });
    m.box(11, 6, 3, 4, 1, 7, C.terracotta);
    m.box(10, 1, 10, 5, 1, 1, C.stoneLight);
  }
  if (L >= 3) {
    m.cylinder(6, 14, 5.5, 2, 3, (x, y, z) => ((x + z) % 2 ? C.white : C.cream));
    m.sphere(6, 17, 5.5, 2.2, (x, y) => (y < 17 ? null : GOLD));
    m.box(5, 19, 5, 1, 2, 1, GOLD);
  }
  if (L >= 4) {
    block(m, 11, 1, 0, 4, 15, 3, { wall: C.cream, sx: 2, sy: 4, wy: 2, oy: 7, ox: 1, base: C.stoneLight });
    m.box(10, 16, 0, 6, 1, 4, C.white);
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) m.set(12 + a, 13 + b, 2, C.white, true);
    m.set(12, 14, 2, C.black);
    pyramid(m, 11, 17, 0, 4, 3, C.terracotta);
  }
  if (L >= 5) {
    for (const x of [2, 10]) {
      m.box(x, 1, 13, 1, 3, 1, C.woodDark);
      m.sphere(x + 0.5, 5, 13.5, 2.2, (i, j, k) => (hash(i, j, k) > 0.7 ? C.leafDark : C.leaf));
    }
    for (const x of [4, 7]) m.box(x, 1, 12, 1, 1, 3, 0xf06a8a);
    m.box(5, 1, 14, 2, 2, 1, C.stone);
    m.box(5, 3, 14, 2, 3, 1, C.stoneLight);
  }
  return finish(m, []);
}

// ---------- 研究所:白色现代楼 + 天文穹顶;L2 玻璃楼 / L3 卫星天线 / L4 第二穹顶 / L5 通信塔 ----------
export function lab(L) {
  const m = newModel();
  pad(m, 16, 16, { color: C.offWhite, inner: (x, z) => (x === 10 || z === 9 ? C.teal : null) });
  block(m, 1, 1, 1, 9, 5, 8, { wall: C.white, win: C.winCool, sx: 4, wx: 3, sy: 5, wy: 1, oy: 2, top: C.teal });
  m.box(4, 1, 8, 2, 3, 1, C.glassDark);
  m.cylinder(5, 6, 4.5, 3.6, 1, C.steel);
  safeDome(m, 5, 7, 4.5, 3.5);
  if (L >= 2) {
    m.box(9, 1, 9, 6, 8, 6, (x, y, z) => (y % 2 === 0 || (x + z) % 3 === 0 ? C.steel : C.glass));
    for (let y = 1; y < 8; y += 2) for (let i = 10; i < 14; i += 2) { m.set(i, y, 14, C.winCool, true); m.set(14, y, i, C.winCool, true); }
    m.box(9, 9, 9, 6, 1, 6, C.white);
  }
  if (L >= 3) {
    m.box(3, 1, 11, 2, 3, 2, C.steelDark);
    for (let u = -3; u <= 3; u++) {
      for (let v = -3; v <= 3; v++) {
        if (u * u + v * v > 10) continue;
        const rim = u * u + v * v > 6;
        m.set(4 + u, Math.round(6 + v * 0.7), Math.round(12 - v * 0.7 + (u * u + v * v) * 0.08), rim ? C.offWhite : C.white);
      }
    }
    m.box(4, 6, 13, 1, 2, 1, C.steelDark);
    m.set(4, 8, 13, 0xff4a3a, true);
  }
  if (L >= 4) {
    m.cylinder(12, 10, 12, 3, 1, C.steel);
    safeDome(m, 12, 11, 12, 3);
  }
  if (L >= 5) {
    lattice(m, 11, 1, 2, 3, 20, 3, C.steel, 3);
    m.box(12, 21, 3, 1, 3, 1, C.steel);
    m.set(12, 24, 3, 0xff3a2a, true);
    m.set(12, 12, 3, 0xff3a2a, true);
  }
  return finish(m, []);
}

// 半球:sphere 颜色函数返回 null 跳过赤道以下;+z 一侧留观测缝
function safeDome(m, cx, y, cz, r) {
  m.sphere(cx, y, cz, r, (x, j, z) => {
    if (j < y) return null;
    return Math.abs(x + 0.5 - cx) < 0.7 && z + 0.5 > cz && j > y ? 0x2a4a6a : C.white;
  });
}
