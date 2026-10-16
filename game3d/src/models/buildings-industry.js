// 加工类建筑(上):食品厂、锯木厂、炼钢厂、水泥厂、火力电厂。
import {
  C, shade, vary, hash, pad, ring, block, chimney, crate, cylX, lattice, ellipsoid, pipeX, pipeY, finish, newModel,
} from './common.js';

/** 锯齿屋顶:沿 z 每 period 格一个齿,竖直面为天窗玻璃(发光)。 */
function sawtooth(m, x, y, z, w, d, roof, glass, period = 4) {
  for (let k = z; k < z + d; k++) {
    const t = (k - z) % period;
    m.box(x, y, k, w, t + 1, 1, roof);
    if (t === period - 1) m.box(x, y + 1, k, w, t, 1, glass, true);
  }
}

// ---------- 食品厂:L1 主厂房+烤炉烟囱 / L2 谷物筒仓 / L3 输送廊桥 / L4 装货区 / L5 第二烤炉+货车 ----------
export function foodFactory(L) {
  const m = newModel();
  const smoke = [];
  pad(m, 16, 16, { inner: (x, z) => (z === 12 && x > 9 ? C.yellow : null) });
  block(m, 1, 3, 1, 9, 5, 10, { wall: C.cream, sx: 2, sy: 5, wy: 2, oy: 1, ox: 1, faces: 'z' });
  m.box(1, 1, 1, 9, 2, 10, C.creamDark);
  m.box(4, 1, 10, 3, 3, 1, C.woodDark);
  m.box(3, 4, 11, 5, 1, 1, (x) => (x % 2 ? C.red : C.white));
  m.box(3, 5, 11, 5, 1, 1, (x) => (x % 2 ? C.white : C.red));
  sawtooth(m, 1, 8, 1, 9, 10, C.terracotta, C.winCool, 5);
  // 面包招牌
  m.box(3, 8, 11, 5, 3, 1, C.white);
  m.box(4, 9, 11, 3, 1, 1, 0xd8963a);
  m.set(5, 10, 11, 0xd8963a);
  chimney(m, 2, 8, 2, 2, 7, C.brick, null, smoke);
  if (L >= 2) {
    for (const z of [2.5, 6.5]) {
      m.cylinder(12.5, 1, z, 1.8, 10, (x, y) => (y % 4 === 0 ? C.wheatDark : C.white));
      m.cylinder(12.5, 11, z, 1, 1, C.wheatDark);
    }
  }
  if (L >= 3) {
    m.box(10, 9, 3, 2, 2, 1, C.steel);
    m.box(10, 9, 7, 2, 2, 1, C.steel);
    m.box(10, 11, 3, 2, 1, 5, C.steelDark);
  }
  if (L >= 4) {
    m.box(10, 1, 9, 5, 2, 3, C.concreteDark);
    m.box(10, 6, 9, 5, 1, 4, C.teal);
    m.box(14, 3, 9, 1, 3, 1, C.steelDark);
    for (const [x, c] of [[10, 0xe89a52], [12, 0xe8c252]]) crate(m, x, 3, 9, 2, 2, 2, c);
  }
  if (L >= 5) {
    chimney(m, 7, 8, 2, 2, 8, C.brickDark, C.white, smoke);
    m.box(11, 1, 13, 3, 3, 2, C.white);
    m.box(14, 1, 13, 1, 2, 2, C.red);
    m.set(14, 2, 13, C.winCool, true);
    m.box(11, 3, 13, 3, 1, 2, C.red);
  }
  return finish(m, smoke);
}

// ---------- 锯木厂:L1 开放棚+圆锯 / L2 木板垛 / L3 原木进料 / L4 干燥窑 / L5 木屑旋风塔 ----------
function plankStack(m, x, y, z, w, h, d) {
  m.box(x, y, z, w, h, d, (i, j) => (j % 2 ? C.woodLight : 0xe0c08a));
  m.box(x, y + h, z, w, 1, 1, C.woodDark);
}

export function sawmill(L) {
  const m = newModel();
  const smoke = [];
  pad(m, 16, 16, { inner: (x, z) => (hash(x, 2, z) > 0.7 ? 0xe6cfa0 : vary(0xcdb68a, 0.05)(x, 0, z)) });
  // 后部开放木棚
  m.box(1, 1, 4, 9, 1, 6, C.woodDark);
  for (const [x, z] of [[1, 4], [9, 4], [1, 9], [9, 9], [5, 9]]) m.box(x, 2, z, 1, 6, 1, C.woodDark);
  m.gableRoof(0, 8, 3, 11, 8, (x, y) => (y % 2 ? 0x8a5a32 : 0x74492a));
  plankStack(m, 2, 2, 5, 3, 2, 3);
  // 前院锯台 + 巨型圆锯(xy 平面,正对 +z 可见)
  m.box(1, 1, 11, 9, 2, 3, C.steel);
  m.box(1, 3, 11, 9, 1, 3, C.steelDark);
  cylX(m, 1, 4, 5, 12.5, 1.4, logC);
  for (let i = -4; i <= 4; i++) {
    for (let j = -4; j <= 4; j++) {
      const d = Math.hypot(i, j);
      if (d > 4.2 || j < -1) continue;
      const c = d < 1.2 ? C.iron : d > 3.3 ? ((i + j) % 2 ? C.steelDark : C.white) : C.offWhite;
      m.set(7 + i, 4 + j, 12, c);
    }
  }
  if (L >= 2) {
    plankStack(m, 11, 1, 11, 4, 3, 4);
    plankStack(m, 11, 5, 12, 4, 2, 3);
  }
  if (L >= 3) {
    for (let r = 0; r < 2; r++) for (let i = 0; i < 2 - r; i++) cylX(m, 1, 9, 2.4 + r * 2.4, 1.5 + i * 2.6 + r * 1.3, 1.3, logC);
    m.box(10, 1, 1, 1, 2, 3, C.iron);
  }
  if (L >= 4) {
    block(m, 11, 1, 1, 4, 6, 5, { wall: (i, j) => ((i + j) % 3 ? C.brick : C.brickDark), noWin: true });
    m.box(12, 1, 5, 2, 4, 1, C.iron);
    m.box(11, 7, 1, 4, 1, 5, C.slate);
    chimney(m, 13, 8, 2, 1, 6, C.steelDark, null, smoke);
  }
  if (L >= 5) {
    for (const x of [11, 13]) m.box(x, 1, 7, 1, 6, 1, C.steelDark);
    for (let y = 7; y < 12; y++) m.cylinder(12.5, y, 8, Math.min(2.2, 0.8 + (y - 7) * 0.5), 1, C.offWhite);
    pipeX(m, 8, 11, 11, 8, C.steel);
    pipeY(m, 8, 11, 8, 8, C.steel);
  }
  return finish(m, smoke);
}

const logC = (x) => (x === 1 ? C.logEnd : (x % 3 ? C.log : shade(C.log, 0.85)));

// ---------- 炼钢厂(3×3):L1 厂房+高炉+烟囱 / L2 第二烟囱 / L3 钢水池+行车 / L4 第二高炉 / L5 红热钢坯输送线 ----------
function blastFurnace(m, cx, cz, r, h) {
  m.cylinder(cx, 1, cz, r + 0.6, 2, C.steelDark);
  m.cylinder(cx, 3, cz, r, h, (x, y) => ((y - 3) % 5 === 4 ? C.iron : C.rust));
  m.cylinder(cx, 3 + h, cz, r - 1, 2, C.rustDark);
  m.cylinder(cx, 5 + h, cz, r - 2, 3, C.steelDark);
  const fx = Math.floor(cx);
  const fz = Math.floor(cz + r);
  m.box(fx - 1, 3, fz, 2, 2, 1, C.molten, true);
  return 8 + h;
}

export function steelMill(L) {
  const m = newModel();
  const smoke = [];
  pad(m, 24, 24, { color: 0xb8b2a6, edge: 0x7e786e, inner: (x, z) => vary(0xb8b2a6, 0.06)(x, 0, z) });
  // 左侧主厂房:暗灰波纹墙 + 锈色腰带 + 屋脊天窗
  m.box(1, 1, 2, 10, 10, 16, (x, y, z) => (y === 6 || y === 7 ? C.rust : ((x + z) % 2 ? 0x5e646c : 0x525860)));
  for (let z = 4; z < 17; z += 3) m.box(10, 2, z, 1, 3, 2, C.molten, true);
  m.gableRoof(0, 11, 1, 12, 18, (x) => (x === 5 || x === 6 ? C.win : 0x454a52), false);
  for (const v of m.voxels.values()) if (v.color === C.win && v.y > 10) v.glow = true;
  // 右后:烟囱;右前:高炉(最显眼的位置)
  chimney(m, 19, 1, 2, 3, 28, 0x5a5e66, C.white, smoke);
  blastFurnace(m, 17.5, 16.5, 3.5, 12);
  m.box(11, 1, 16, 4, 1, 2, C.molten, true);
  pipeX(m, 11, 14, 12, 16, C.rustDark);
  if (L >= 2) chimney(m, 14, 1, 2, 3, 24, 0x5a5e66, C.red, smoke);
  if (L >= 3) {
    // 前排钢水池 + 黄色行车
    ring(m, 2, 1, 19, 9, 4, C.iron, 2);
    m.box(3, 1, 20, 7, 2, 2, C.molten, true);
    for (const x of [1, 11]) for (const z of [19, 22]) m.box(x, 1, z, 1, 9, 1, C.yellow);
    for (const z of [19, 22]) m.box(1, 10, z, 11, 1, 1, C.yellow);
    m.box(5, 10, 19, 2, 1, 4, C.yellow);
    m.box(5, 7, 20, 2, 3, 2, C.iron);
    m.box(5, 6, 20, 2, 1, 2, C.molten, true);
  }
  if (L >= 4) {
    blastFurnace(m, 17.5, 8.5, 3, 9);
    pipeX(m, 11, 14, 14, 8, C.rustDark);
  }
  if (L >= 5) {
    m.box(13, 1, 21, 10, 1, 2, C.iron);
    for (let x = 13; x < 23; x += 3) m.box(x, 2, 21, 2, 1, 2, C.molten, true);
    chimney(m, 3, 11, 12, 2, 10, C.steelDark, C.orange, smoke);
  }
  return finish(m, smoke);
}

// ---------- 水泥厂:L1 回转窑+窑头 / L2 筒仓 / L3 第二筒仓 / L4 预热塔 / L5 搅拌车 ----------
export function cement(L) {
  const m = newModel();
  const smoke = [];
  const dust = 0xd8d0be;
  pad(m, 16, 16, { color: dust, edge: 0xa8a090, inner: (x, z) => vary(dust, 0.05)(x, 0, z) });
  for (const x of [2, 5, 8]) m.box(x, 1, 9, 1, 3, 3, C.concreteDark);
  cylX(m, 1, 10, 4.5, 10.5, 1.9, (x) => (x % 3 === 0 ? C.steelDark : 0xc2a88a));
  m.box(1, 3, 9, 1, 3, 3, C.molten, true);
  block(m, 11, 1, 8, 4, 6, 5, { wall: C.concrete, sx: 2, sy: 3, oy: 2, win: C.win });
  chimney(m, 13, 7, 9, 1, 3, C.steelDark, null, L >= 4 ? null : smoke);
  block(m, 12, 1, 1, 3, 4, 5, { wall: C.white, win: C.winCool, sx: 2, sy: 4, oy: 2 });
  m.box(12, 5, 1, 3, 1, 5, C.teal);
  const silo = (cx) => {
    m.cylinder(cx, 1, 4, 2.4, 15, (x, y) => (y % 5 === 0 ? 0xb0aa9e : C.concrete));
    m.cylinder(cx, 16, 4, 1.6, 1, 0xb0aa9e);
    m.box(Math.floor(cx), 17, 3, 1, 1, 1, C.steelDark);
  };
  if (L >= 2) silo(3.5);
  if (L >= 3) silo(8.5);
  if (L >= 4) {
    lattice(m, 11, 7, 8, 4, 14, 5, C.steelDark, 3);
    for (const y of [9, 13, 17]) m.cylinder(13, y, 10.5, 1.4, 3, (x, j) => (j === y ? 0xc2a88a : C.white));
    m.box(11, 21, 8, 4, 1, 5, C.steel);
    chimney(m, 12, 22, 9, 2, 4, C.steelDark, C.red, smoke);
  }
  if (L >= 5) {
    m.box(2, 1, 13, 7, 1, 2, C.steelDark);
    m.box(7, 2, 13, 2, 3, 2, C.yellow);
    m.set(8, 4, 13, C.winCool, true);
    cylX(m, 2, 5, 3.5, 14, 1.4, (x) => (x % 2 ? C.orange : C.white));
    for (const x of [2, 4, 7]) m.set(x, 1, 15, C.black);
  }
  return finish(m, smoke);
}

function coolingTower(m, cx, cz, h, rBot, rWaist, rTop) {
  // 双曲面:下部收腰到 70% 高度,顶部略外扩;颜色保持纯净只留顶部红带
  for (let j = 0; j < h; j++) {
    const t = j / (h - 1);
    const r = t < 0.7 ? rWaist + (rBot - rWaist) * (1 - t / 0.7) ** 2 : rWaist + (rTop - rWaist) * ((t - 0.7) / 0.3) ** 2;
    m.cylinder(cx, 1 + j, cz, r, 1, j >= h - 3 && j < h - 1 ? C.red : (j === 0 ? C.concreteDark : 0xeceae4));
  }
  m.cylinder(cx, h, cz, rTop - 1, 1, 0x6a737c);
}

// ---------- 火力电厂:L1 锅炉房+冷却塔 / L2 烟囱 / L3 变压器场 / L4 第二烟囱 / L5 前场煤堆+输送带 ----------
export function power(L) {
  const m = newModel();
  const smoke = [];
  pad(m, 16, 16, { inner: (x, z) => (x === 9 && z > 8 ? C.yellow : null) });
  coolingTower(m, 11.5, 4.5, 16, 4.3, 3, 3.5);
  smoke.push([11, 16, 4]);
  block(m, 1, 1, 6, 8, 8, 5, { wall: (i, j) => ((i + j) % 3 ? C.brick : C.brickDark), sx: 2, sy: 3, oy: 2, base: C.stone });
  m.box(1, 9, 6, 8, 1, 5, C.slate);
  m.box(3, 10, 7, 4, 2, 3, C.steel);
  pipeX(m, 8, 9, 6, 7, C.steelDark);
  if (L >= 2) chimney(m, 2, 1, 2, 2, 22, C.white, C.red, smoke);
  if (L >= 3) {
    for (const [x, z] of [[10, 10], [13, 10], [10, 13], [13, 13]]) {
      m.box(x, 1, z, 2, 3, 2, C.steelDark);
      m.set(x, 4, z, C.winCool, true);
      m.set(x + 1, 4, z + 1, C.winCool, true);
    }
    m.box(12, 1, 9, 1, 8, 1, C.steel);
    m.box(10, 8, 9, 5, 1, 1, C.steel);
    for (const x of [10, 14]) m.set(x, 7, 9, C.winCool, true);
  }
  if (L >= 4) chimney(m, 5, 1, 2, 2, 19, C.white, C.red, smoke);
  if (L >= 5) {
    ellipsoid(m, 3.5, 0.5, 13, 3, 2.6, 1.8, (x, y, z) => (hash(x, y, z) > 0.85 ? 0x6a7a90 : 0x2a2a30));
    for (let i = 0; i < 5; i++) m.box(7, 3 + i, 14 - i, 1, 1, 1, C.iron);
    m.box(7, 1, 13, 1, 3, 1, C.steelDark);
  }
  return finish(m, smoke);
}

