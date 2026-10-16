// 加工类建筑(上):食品厂、锯木厂、炼钢厂、水泥厂、火力电厂。
import {
  C, shade, vary, hash, pad, ring, block, chimney, stack, crate, cylX, tank, lattice, pipeX, pipeY, finish, newModel,
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
  m.box(1, 1, 4, 9, 1, 8, C.woodDark);
  for (const [x, z] of [[1, 4], [9, 4], [1, 11], [9, 11], [5, 4], [5, 11]]) m.box(x, 2, z, 1, 6, 1, C.woodDark);
  m.gableRoof(0, 8, 3, 11, 10, (x, y) => (y % 2 ? 0x8a5a32 : 0x74492a));
  // 锯台 + 巨型圆锯(yz 平面)
  m.box(2, 2, 7, 7, 2, 2, C.steel);
  cylX(m, 2, 7, 4.5, 8, 0.9, (x) => (x === 2 ? C.logEnd : C.log));
  for (let j = 0; j < 7; j++) {
    for (let k = 0; k < 7; k++) {
      const d = Math.hypot(j - 3, k - 3);
      if (d > 3.3) continue;
      m.set(6, 3 + j, 5 + k, d < 1 ? C.iron : d > 2.6 ? ((j + k) % 2 ? C.steelDark : C.white) : C.offWhite);
    }
  }
  if (L >= 2) {
    plankStack(m, 11, 1, 11, 4, 3, 4);
    plankStack(m, 11, 5, 12, 4, 2, 3);
  }
  if (L >= 3) {
    for (let r = 0; r < 2; r++) for (let i = 0; i < 3 - r; i++) cylX(m, 2, 7, 2 + r * 1.8, 1.5 + i * 1.6 + r * 0.8, 0.9, (x) => (x === 8 ? C.logEnd : C.log));
    m.box(9, 1, 1, 1, 2, 3, C.iron);
  }
  if (L >= 4) {
    block(m, 11, 1, 1, 4, 6, 5, { wall: (i, j) => ((i + j) % 3 ? C.brick : C.brickDark), noWin: true });
    m.box(12, 1, 5, 2, 4, 1, C.iron);
    m.box(11, 7, 1, 4, 1, 5, C.slate);
    chimney(m, 13, 8, 2, 1, 6, C.steelDark, null, smoke);
  }
  if (L >= 5) {
    for (const x of [11, 13]) m.box(x, 1, 7, 1, 6, 1, C.steelDark);
    for (let y = 7; y < 12; y++) {
      const r = Math.min(2.2, 0.8 + (y - 7) * 0.5);
      m.cylinder(12.5, y, 8, r, 1, C.offWhite);
    }
    pipeX(m, 8, 11, 11, 8, C.steel);
    pipeY(m, 8, 11, 8, 8, C.steel);
  }
  return finish(m, smoke);
}

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
  // 主厂房:暗灰波纹墙 + 锈色腰带 + 顶部天窗
  m.box(1, 1, 11, 11, 10, 10, (x, y, z) => (y === 6 || y === 7 ? C.rust : ((x + z) % 2 ? 0x5e646c : 0x525860)));
  for (let x = 3; x < 11; x += 3) m.box(x, 2, 20, 2, 3, 1, C.molten, true);
  m.box(3, 1, 20, 1, 4, 1, C.iron);
  m.gableRoof(0, 11, 10, 13, 12, (x) => (x === 6 ? C.win : 0x454a52), false);
  for (const v of m.voxels.values()) if (v.color === C.win && v.y > 10) v.glow = true;
  blastFurnace(m, 17, 6, 3.5, 12);
  // 高炉 → 厂房的钢水槽
  m.box(14, 1, 9, 4, 1, 2, C.molten, true);
  m.box(12, 1, 10, 3, 1, 1, C.molten, true);
  chimney(m, 20, 1, 12, 3, 28, 0x5a5e66, C.white, smoke);
  if (L >= 2) chimney(m, 20, 1, 17, 3, 24, 0x5a5e66, C.red, smoke);
  if (L >= 3) {
    ring(m, 13, 1, 15, 6, 6, C.iron, 2);
    m.box(14, 1, 16, 4, 2, 4, C.molten, true);
    for (const [x, z] of [[13, 14], [18, 14], [13, 21], [18, 21]]) m.box(x, 1, z, 1, 12, 1, C.yellow);
    m.box(13, 13, 14, 6, 1, 1, C.yellow);
    m.box(13, 13, 21, 6, 1, 1, C.yellow);
    m.box(15, 13, 14, 2, 1, 8, C.yellow);
    m.box(15, 12, 17, 2, 1, 2, C.iron);
    pipeY(m, 8, 11, 16, 18, C.iron);
    m.cylinder(16, 5, 18.5, 1.6, 3, C.iron);
    m.cylinder(16, 7, 18.5, 1, 1, C.molten);
  }
  if (L >= 4) {
    blastFurnace(m, 6, 5.5, 3, 9);
    pipeX(m, 9, 13, 15, 5, C.rustDark);
    pipeX(m, 9, 13, 14, 5, C.steelDark);
  }
  if (L >= 5) {
    m.box(1, 1, 21, 12, 1, 2, C.iron);
    for (let x = 2; x < 12; x += 3) m.box(x, 2, 21, 2, 1, 2, C.molten, true);
    for (let x = 1; x < 13; x += 2) m.set(x, 1, 23, C.steelDark);
    chimney(m, 9, 11, 13, 2, 9, C.steelDark, C.orange, smoke);
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

// ---------- 火力电厂:L1 锅炉房+冷却塔 / L2 烟囱 / L3 变压器场 / L4 第二烟囱 / L5 煤堆+输送带 ----------
function coolingTower(m, cx, cz, h, rBot, rWaist, rTop) {
  for (let j = 0; j < h; j++) {
    const t = j / (h - 1);
    const waist = 0.65;
    const r = t < waist
      ? rBot + (rWaist - rBot) * Math.sin((t / waist) * Math.PI / 2)
      : rWaist + (rTop - rWaist) * ((t - waist) / (1 - waist)) ** 2;
    m.cylinder(cx, 1 + j, cz, r, 1, (x, y) => (y >= h - 2 ? C.red : (y === 1 ? C.concreteDark : C.offWhite)), true);
  }
  m.cylinder(cx, h - 1, cz, rTop - 1.2, 1, 0x9aa4ae);
}

export function power(L) {
  const m = newModel();
  const smoke = [];
  pad(m, 16, 16, { inner: (x, z) => (x === 9 && z > 8 ? C.yellow : null) });
  coolingTower(m, 11.5, 4.5, 15, 4, 2.7, 3.3);
  smoke.push([11, 15, 4]);
  block(m, 1, 1, 9, 8, 8, 6, { wall: (i, j) => ((i + j) % 3 ? C.brick : C.brickDark), sx: 2, sy: 3, oy: 2, base: C.stone });
  m.box(1, 9, 9, 8, 1, 6, C.slate);
  m.box(3, 10, 10, 4, 2, 3, C.steel);
  pipeX(m, 7, 10, 6, 9, C.steelDark);
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
    for (let y = 1; y <= 3; y++) m.box(1 + y - 1, y, 5, 6 - (y - 1) * 2, 1, 3, (x, j, z) => (hash(x, j, z) > 0.8 ? 0x5a6a80 : 0x2a2a30));
    for (let i = 0; i < 5; i++) m.set(7, 2 + i, 7 + Math.floor(i / 2), C.iron);
    m.box(7, 1, 7, 1, 2, 1, C.steelDark);
  }
  return finish(m, smoke);
}

export { tank, stack };
