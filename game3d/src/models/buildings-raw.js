// 采集类建筑:农场、伐木场、采石场、水泵站、铁矿、煤矿、油井。每级追加一个可见模块。
import {
  C, shade, vary, hash, pad, ring, block, chimney, stack, crate, cylX, cylZ, tank, lattice, pipeX, pipeZ, pipeY,
  finish, newModel,
} from './common.js';

// ---------- 农场:L1 谷仓+麦田 / L2 第二块麦田 / L3 筒仓 / L4 菜田 / L5 第二筒仓+拖拉机 ----------
function wheatField(m, x0, z0, w, d, crop = 'wheat') {
  m.box(x0, 1, z0, w, 1, d, (x) => (x % 2 ? C.soil : C.soilDark));
  for (let x = x0; x < x0 + w; x += 2) {
    for (let z = z0; z < z0 + d; z++) {
      if (crop === 'wheat') {
        m.set(x, 2, z, C.wheatDark);
        m.set(x, 3, z, hash(x, 3, z) > 0.5 ? C.wheat : 0xf2d468);
      } else if (z % 2 === 0) {
        m.set(x, 2, z, hash(x, 2, z) > 0.5 ? C.leaf : 0x7cc85a);
        if (hash(z, x, 1) > 0.6) m.set(x, 3, z, 0x8ad06a);
      }
    }
  }
}

function silo(m, cx, cz) {
  m.cylinder(cx, 1, cz, 1.7, 11, (x, y) => (y % 3 === 0 ? 0xb8c0c8 : 0xd8dde2));
  m.cylinder(cx, 12, cz, 1.2, 1, 0xc8402e);
  m.set(Math.floor(cx), 13, Math.floor(cz), 0xc8402e);
}

export function farm(L) {
  const m = newModel();
  pad(m, 16, 16, { inner: (x, z) => (x === 7 || z === 8 ? C.dirt : C.grass) });
  // 红谷仓
  m.box(1, 1, 1, 4, 5, 6, (x, y, z) => ((x === 1 || x === 4) && (z === 1 || z === 6) ? C.white : 0xb83a2a));
  m.box(2, 1, 6, 2, 3, 1, C.white);
  m.set(2, 2, 6, 0xb83a2a); m.set(3, 3, 6, 0xb83a2a);
  m.gableRoof(0, 6, 1, 6, 6, (x) => (x % 2 ? 0x5a4a4a : 0x4a3a3a), false);
  m.set(2, 7, 6, C.win, true);
  wheatField(m, 8, 1, 7, 7);
  // 稻草人
  m.box(11, 4, 4, 1, 2, 1, C.woodDark);
  m.box(10, 5, 4, 3, 1, 1, 0x5a7ad0);
  m.set(11, 6, 4, C.wheat);
  if (L >= 2) wheatField(m, 8, 9, 7, 6);
  if (L >= 3) silo(m, 6.5, 2.5);
  if (L >= 4) wheatField(m, 1, 9, 6, 6, 'veg');
  if (L >= 5) {
    silo(m, 6.5, 5.5);
    // 拖拉机停在田间小路
    m.box(6, 1, 11, 3, 2, 3, 0xc8402e);
    m.box(7, 3, 11, 2, 2, 2, 0xd85a3a);
    m.set(7, 4, 13, C.winCool, true);
    for (const z of [11, 13]) { m.set(5, 1, z, C.black); m.set(9, 1, z, C.black); }
    m.box(6, 3, 13, 1, 2, 1, C.iron);
  }
  return finish(m, []);
}

// ---------- 伐木场:L1 木屋+原木堆 / L2 第二堆 / L3 树苗圃 / L4 装木吊臂 / L5 瞭望塔 ----------
function logPile(m, x0, z0, len, rows = 3) {
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < rows - r; i++) {
      cylX(m, x0, len, 2 + r * 1.8, z0 + 1 + i * 2 + r, 1, (x) => (x === x0 || x === x0 + len - 1 ? C.logEnd : C.log));
    }
  }
}

export function lumber(L) {
  const m = newModel();
  pad(m, 16, 16, { inner: (x, z) => (hash(x, 0, z) > 0.75 ? 0xd8b886 : vary(0xbfa070, 0.06)(x, 0, z)) });
  m.box(1, 1, 1, 6, 5, 5, (x, y) => (y % 2 ? C.log : shade(C.log, 0.82)));
  m.box(3, 1, 5, 2, 3, 1, C.woodDark);
  m.set(6, 3, 3, C.win, true);
  m.gableRoof(0, 6, 0, 8, 7, (x, y) => (y % 2 ? 0x6a8a3a : 0x587a30));
  chimney(m, 2, 7, 2, 1, 4, C.stone);
  // 劈柴墩 + 斧头
  m.cylinder(6, 1, 7.5, 1, 1, C.logEnd);
  m.box(5, 2, 7, 1, 2, 1, C.woodDark);
  m.set(5, 3, 6, C.steel);
  logPile(m, 9, 0, 6, 3);
  if (L >= 2) logPile(m, 9, 6, 6, 2);
  if (L >= 3) {
    for (let x = 1; x <= 6; x += 2) {
      for (let z = 10; z <= 14; z += 2) {
        m.set(x, 1, z, C.woodDark);
        m.set(x, 2, z, C.leafDark);
        m.set(x, 3, z, C.leaf);
      }
    }
  }
  if (L >= 4) {
    m.box(9, 1, 11, 2, 2, 2, C.steelDark);
    m.box(9, 3, 11, 1, 8, 1, C.yellow);
    for (let i = 0; i < 6; i++) m.set(9 + i, 10 - Math.floor(i / 2), 11 - Math.floor(i / 3), C.yellow);
    m.box(14, 4, 9, 1, 4, 1, C.iron);
    cylX(m, 12, 4, 3.5, 9.5, 0.8, C.log);
  }
  if (L >= 5) {
    for (const [x, z] of [[12, 12], [14, 12], [12, 14], [14, 14]]) m.box(x, 1, z, 1, 11, 1, C.woodDark);
    m.box(11, 12, 11, 5, 1, 5, C.woodLight);
    ring(m, 11, 13, 11, 5, 5, C.wood);
    m.gableRoof(11, 15, 11, 5, 5, 0x6a8a3a);
    for (let y = 2; y < 12; y += 3) m.box(12, y, 14, 3, 1, 1, C.wood);
  }
  return finish(m, []);
}

// ---------- 采石场:L1 阶梯石壁+石块 / L2 木吊杆 / L3 输送带 / L4 碎石机 / L5 自卸车 ----------
export function quarry(L) {
  const m = newModel();
  pad(m, 16, 16, { inner: (x, z) => vary(0xc0bbb0, 0.1)(x, 0, z) });
  // 阶梯开采面:越靠后越高
  const steps = [[1, 9], [3, 7], [5, 5], [7, 3]];
  for (const [z, h] of steps) m.box(1, 1, z, 14, h, 2, (x, y, k) => vary(0x8e8a82, 0.1)(x, y, k));
  for (const [z, h] of steps) m.box(1, h, z, 14, 1, 2, (x, y, k) => (hash(x, y, k) > 0.85 ? 0x9a9690 : 0xbdb9b0));
  for (const [x, y, z] of [[5, 1, 10], [7, 1, 10], [6, 3, 10], [5, 1, 12]]) crate(m, x, y, z, 2, 2, 2, 0xd2cec4, 0xa8a49a);
  // 工棚
  m.box(1, 1, 10, 3, 4, 4, C.woodLight);
  m.box(3, 1, 13, 1, 2, 1, C.woodDark);
  m.box(0, 5, 10, 5, 1, 4, C.terracotta);
  if (L >= 2) {
    m.box(12, 1, 9, 1, 11, 1, C.woodDark);
    m.box(11, 1, 9, 3, 1, 1, C.woodDark);
    for (let i = 0; i < 7; i++) m.set(12 - i, 10 - Math.floor(i / 3), 9, C.wood);
    m.box(6, 5, 9, 1, 3, 1, C.iron);
    crate(m, 6, 3, 8, 2, 2, 2, 0xd2cec4);
  }
  if (L >= 3) {
    for (let i = 0; i < 7; i++) {
      m.box(9, 2 + i, 13 - i, 2, 1, 1, i % 2 ? C.iron : 0x55595f);
      m.set(9, 1 + i, 13 - i, C.steelDark);
    }
    m.box(9, 2, 13, 2, 1, 1, C.iron);
  }
  if (L >= 4) {
    m.box(11, 1, 11, 4, 4, 3, C.yellow);
    m.box(12, 5, 11, 3, 2, 3, (x, y, z) => (y === 6 && x > 12 && z === 12 ? C.iron : C.yellow));
    m.box(11, 3, 14, 4, 1, 1, C.black);
    chimney(m, 14, 7, 11, 1, 2, C.steelDark);
  }
  if (L >= 5) {
    m.box(5, 2, 14, 4, 2, 1, C.orange);
    m.box(5, 1, 14, 4, 1, 1, C.black);
    m.box(8, 2, 14, 1, 3, 1, C.orange);
    crate(m, 5, 4, 14, 3, 1, 1, 0xbdb9b0);
  }
  return finish(m, []);
}

// ---------- 水泵站(1×1):L1 泵房+管道 / L2 储水罐 / L3 过滤池 / L4 高位水塔 ----------
export function pump(L) {
  const m = newModel();
  pad(m, 8, 8, { color: C.concrete });
  block(m, 1, 1, 1, 4, 4, 4, { wall: C.white, sx: 2, sy: 4, oy: 2, ox: 1, win: C.winCool });
  m.box(2, 1, 4, 1, 2, 1, C.tealDark);
  m.gableRoof(0, 5, 0, 6, 6, C.teal);
  pipeX(m, 5, 7, 1, 3, C.water);
  m.set(5, 2, 3, C.red);
  if (L >= 2) tank(m, 6.5, 1, 1.5, 1.4, 5, 0x9ab8d0, C.white, [3]);
  if (L >= 3) {
    ring(m, 1, 1, 5, 4, 3, C.stoneLight, 2);
    m.box(2, 1, 6, 2, 1, 1, C.water, true);
    m.box(2, 2, 6, 2, 1, 1, 0x7ac8f8, true);
  }
  if (L >= 4) {
    for (const [x, z] of [[5, 4], [7, 4], [5, 7], [7, 7]]) m.box(x, 1, z, 1, 10, 1, C.steelDark);
    m.cylinder(6.5, 10, 5.5, 2, 4, (x, y) => (y === 12 ? C.white : C.water));
    m.cylinder(6.5, 14, 5.5, 1.2, 1, C.steel);
    pipeY(m, 1, 9, 6, 5, C.steel);
  }
  return finish(m, []);
}

// ---------- 铁矿场:L1 矿洞+铁轨矿车 / L2 矿石堆 / L3 挖掘机 / L4 料仓+输送带 / L5 选矿厂 ----------
function orePile(m, cx, cz, r, base, glint, glintGlow) {
  for (let y = 1; y <= r + 1; y++) {
    const rr = r - (y - 1) * 0.9;
    if (rr <= 0) break;
    m.cylinder(cx, y, cz, rr, 1, (x, j, z) => (hash(x, j, z) > 0.86 ? glint : shade(base, 0.85 + hash(z, j, x) * 0.3)));
  }
  for (const v of m.voxels.values()) if (v.color === glint) v.glow = glintGlow;
}

function rails(m, x, z0, z1) {
  for (let z = z0; z <= z1; z++) {
    if (z % 2 === 0) m.box(x - 1, 1, z, 4, 1, 1, C.woodDark);
    m.set(x, 1, z, C.steel);
    m.set(x + 1, 1, z, C.steel);
  }
}

export function ironMine(L) {
  const m = newModel();
  const smoke = [];
  const ore = 0xa8502e;
  pad(m, 16, 16, { edge: 0x8a5a44, inner: (x, z) => vary(0xb87a5a, 0.1)(x, 0, z) });
  // 红土山丘 + 坑道口
  for (let y = 1; y <= 7; y++) {
    const s = y - 1;
    m.box(1 + Math.floor(s / 2), y, 1, 9 - s, 1, 7 - Math.floor(s / 2), (x, j, z) => vary(ore, 0.15)(x, j, z));
  }
  m.box(3, 1, 7, 4, 4, 1, C.woodDark);
  m.box(4, 1, 7, 2, 3, 1, C.black);
  rails(m, 4, 8, 14);
  m.box(4, 2, 11, 2, 2, 3, C.rustDark);
  m.box(4, 4, 11, 2, 1, 3, (x, y, z) => (hash(x, y, z) > 0.6 ? C.orange : ore));
  if (L >= 2) orePile(m, 12, 12, 3.2, ore, 0xffa040, true);
  if (L >= 3) {
    m.box(11, 1, 2, 4, 2, 4, C.black);
    m.box(11, 3, 2, 4, 3, 3, C.yellow);
    m.set(14, 5, 4, C.winCool, true);
    for (let i = 0; i < 5; i++) m.set(10 - i, 6 - Math.abs(i - 2), 3, C.yellow);
    m.box(5, 4, 3, 2, 2, 2, C.steelDark);
  }
  if (L >= 4) {
    for (const [x, z] of [[8, 9], [10, 9]]) m.box(x, 1, z, 1, 7, 1, C.rustDark);
    m.box(7, 8, 8, 5, 3, 3, C.rust);
    m.box(8, 7, 9, 3, 1, 1, C.iron);
    for (let i = 0; i < 4; i++) m.box(9, 11 - i, 11 + i, 1, 1, 1, C.iron);
  }
  if (L >= 5) {
    block(m, 1, 1, 10, 3, 6, 5, { wall: C.rust, win: C.win, sx: 2, sy: 3, oy: 2, ox: 1 });
    m.box(1, 7, 10, 3, 1, 5, C.rustDark);
    stack(m, 2.5, 8, 11.5, 1, 6, C.steelDark, C.white, smoke);
  }
  return finish(m, smoke);
}

// ---------- 煤矿:L1 木井架+绞车房 / L2 煤堆 / L3 砖砌锅炉房+烟囱 / L4 煤车 / L5 第二煤堆+输送带 ----------
export function coalMine(L) {
  const m = newModel();
  const smoke = [];
  pad(m, 16, 16, { edge: 0x3a3a40, inner: (x, z) => vary(0x5a5a60, 0.12)(x, 0, z) });
  // 井口 + 木制井架(A 字形)
  m.box(5, 1, 5, 4, 1, 4, C.stoneDark);
  m.box(6, 1, 6, 2, 1, 2, C.black);
  for (const [x, z] of [[5, 5], [8, 5], [5, 8], [8, 8]]) m.box(x, 2, z, 1, 12, 1, C.woodDark);
  for (let y = 4; y < 14; y += 4) ring(m, 5, y, 5, 4, 4, C.wood);
  for (let i = 0; i < 8; i++) m.set(9 + Math.floor(i / 2), 2 + i, 6, C.wood);
  cylZ(m, 6, 2, 7, 14.5, 1.8, (x, y) => (Math.abs(x + 0.5 - 7) < 0.6 || Math.abs(y + 0.5 - 14.5) < 0.6 ? C.iron : C.steelDark));
  block(m, 10, 1, 2, 5, 5, 4, { wall: (i, j) => ((i + j) % 3 ? C.woodLight : C.wood), sx: 2, sy: 4, oy: 2 });
  m.gableRoof(10, 6, 1, 5, 6, C.slate);
  if (L >= 2) orePile(m, 3.5, 12, 3, 0x2a2a30, 0x8a9ab8, false);
  if (L >= 3) {
    block(m, 1, 1, 1, 3, 6, 4, { wall: (i, j) => ((i + j) % 3 ? C.brick : C.brickDark), sx: 2, sy: 3, oy: 2, ox: 0 });
    chimney(m, 1, 7, 1, 2, 10, C.brickDark, null, smoke);
  }
  if (L >= 4) {
    rails(m, 11, 7, 14);
    for (const z of [8, 12]) {
      m.box(11, 2, z, 2, 2, 3, C.rustDark);
      m.box(11, 4, z, 2, 1, 3, (x, y, k) => (hash(x, y, k) > 0.7 ? 0x6a7a90 : 0x26262b));
    }
  }
  if (L >= 5) {
    orePile(m, 8, 12.5, 2.2, 0x2a2a30, 0x8a9ab8, false);
    for (let i = 0; i < 6; i++) m.set(8, 2 + i, 11 - i, C.iron);
    for (let i = 0; i < 6; i += 2) m.box(8, 1, 11 - i, 1, 1 + i, 1, C.steelDark);
  }
  return finish(m, smoke);
}

// ---------- 油井:L1 磕头机 / L2 储油罐 / L3 第二台磕头机 / L4 钻塔 / L5 第二储罐+管线 ----------
function pumpJack(m, x0, z0) {
  m.box(x0, 1, z0, 9, 1, 3, C.steelDark);
  m.box(x0 + 4, 2, z0 + 1, 1, 5, 1, C.iron);
  m.box(x0 + 3, 2, z0 + 1, 1, 3, 1, C.iron);
  m.box(x0 + 5, 2, z0 + 1, 1, 3, 1, C.iron);
  m.box(x0 + 1, 7, z0 + 1, 7, 1, 1, C.orange);
  m.box(x0 + 7, 5, z0 + 1, 2, 3, 1, C.black);
  m.box(x0 + 8, 1, z0 + 1, 1, 4, 1, C.steel);
  m.box(x0, 4, z0, 2, 3, 3, C.orange);
  m.box(x0 + 1, 2, z0, 1, 2, 3, C.steelDark);
}

export function oilWell(L) {
  const m = newModel();
  pad(m, 16, 16, { edge: 0x4a3a50, inner: (x, z) => (hash(x, 1, z) > 0.8 ? 0x4a3a58 : vary(0x8a7a82, 0.08)(x, 0, z)) });
  pumpJack(m, 1, 1);
  m.box(9, 1, 2, 1, 1, 1, C.black);
  if (L >= 2) tank(m, 12.5, 1, 12.5, 2.7, 6, C.white, C.red, [4]);
  if (L >= 3) pumpJack(m, 1, 6);
  if (L >= 4) {
    lattice(m, 2, 1, 10, 5, 18, 5, C.red, 3);
    for (let y = 19; y < 23; y++) m.box(4, y, 12, 1, 1, 1, C.red);
    m.box(3, 22, 11, 3, 1, 3, C.steelDark);
    m.box(3, 1, 11, 3, 2, 3, C.steelDark);
  }
  if (L >= 5) {
    tank(m, 12.5, 1, 5.5, 2.2, 5, C.white, C.yellow, [3]);
    pipeX(m, 9, 12, 1, 9, C.steelDark);
    pipeZ(m, 9, 12, 1, 12, C.steelDark);
    m.set(12, 2, 9, C.red);
  }
  return finish(m, []);
}

