// 加工类建筑(下):炼油厂、化工厂、军火厂、机械厂、电子厂。
import {
  C, shade, hash, pad, ring, block, chimney, stack, crate, tank, quonset, lattice, pipeX, pipeZ, pipeY,
  finish, newModel,
} from './common.js';

// ---------- 炼油厂(3×2):L1 分馏塔+加热炉+储罐 / L2 第二储罐 / L3 第二分馏塔 / L4 火炬塔 / L5 第三储罐+管廊 ----------
function column(m, cx, cz, h) {
  m.cylinder(cx, 1, cz, 1.7, h, (x, y) => (y % 6 === 0 ? C.steelDark : C.offWhite));
  for (let y = 6; y < h; y += 6) m.cylinder(cx, y, cz, 2.4, 1, C.yellow, true);
  m.cylinder(cx, h + 1, cz, 1, 1, C.steelDark);
}

export function refinery(L) {
  const m = newModel();
  const smoke = [];
  pad(m, 24, 16, { inner: (x, z) => (z === 8 && x % 4 < 2 ? C.yellow : null) });
  column(m, 3.5, 3.5, 20);
  block(m, 14, 1, 1, 8, 5, 5, { wall: C.concrete, win: C.win, sx: 3, sy: 5, oy: 2, top: C.steel });
  chimney(m, 19, 6, 2, 2, 6, C.steelDark, C.red, smoke);
  pipeX(m, 4, 14, 4, 3, C.steelDark);
  tank(m, 4.5, 1, 11.5, 3.3, 6, C.white, C.red, [2, 3]);
  if (L >= 2) tank(m, 11.5, 1, 11.5, 3.3, 6, C.white, C.blue, [2, 3]);
  if (L >= 3) {
    column(m, 8.5, 3.5, 16);
    pipeX(m, 4, 8, 12, 3, C.steelDark);
  }
  if (L >= 4) {
    m.box(12, 1, 3, 1, 22, 1, C.steel);
    for (let y = 4; y < 22; y += 4) { m.set(11, y, 3, C.steel); m.set(13, y, 3, C.steel); }
    m.box(11, 23, 2, 3, 1, 3, C.steelDark);
    m.set(12, 24, 3, C.fire, true);
    m.set(12, 25, 3, C.ember, true);
    m.set(11, 24, 3, C.fire, true);
  }
  if (L >= 5) {
    tank(m, 18.5, 1, 11.5, 3.3, 6, C.white, C.yellow, [2, 3]);
    for (const x of [2, 9, 16, 22]) m.box(x, 1, 8, 1, 3, 1, C.steelDark);
    pipeX(m, 1, 22, 4, 8, C.steel);
    pipeX(m, 1, 22, 3, 8, C.rust);
  }
  return finish(m, smoke);
}

// ---------- 化工厂:L1 工艺楼+反应釜 / L2 球罐 / L3 绿色管廊 / L4 第二反应釜 / L5 洗涤塔 ----------
function reactor(m, cx, cz, h) {
  m.cylinder(cx, 1, cz, 1.8, h, (x, y) => (y % 4 === 0 ? C.chem : C.offWhite));
  m.cylinder(cx, h + 1, cz, 1, 1, C.chem);
  m.box(Math.floor(cx), 4, Math.floor(cz + 1.5), 1, 3, 1, 0x7aff8a, true);
}

export function chemical(L) {
  const m = newModel();
  const smoke = [];
  pad(m, 16, 16, { edge: 0x8aa890, inner: (x, z) => (x === 8 && z % 3 === 0 ? C.chem : null) });
  block(m, 1, 1, 1, 7, 6, 7, { wall: C.white, win: C.winCool, sx: 2, sy: 3, oy: 2, top: C.chem });
  m.box(3, 1, 7, 2, 3, 1, C.steelDark);
  m.box(2, 7, 2, 3, 2, 3, C.steel);
  reactor(m, 10.5, 3.5, 10);
  pipeX(m, 7, 10, 5, 3, C.chem);
  pipeX(m, 7, 9, 3, 2, C.chem);
  if (L >= 2) {
    for (const [x, z] of [[9, 9], [13, 9], [9, 13], [13, 13]]) m.box(x, 1, z, 1, 4, 1, C.steelDark);
    m.sphere(11.5, 7, 11.5, 3.3, (x, y) => (y === 7 ? C.chem : C.white));
  }
  if (L >= 3) {
    for (const x of [2, 6]) m.box(x, 1, 10, 1, 5, 1, C.steelDark);
    pipeX(m, 1, 9, 6, 10, C.chem);
    pipeX(m, 1, 9, 5, 11, 0x2a9a4a);
    pipeZ(m, 10, 13, 6, 9, C.chem);
  }
  if (L >= 4) {
    reactor(m, 13.5, 3.5, 13);
    pipeX(m, 11, 13, 9, 3, C.chem);
  }
  if (L >= 5) {
    stack(m, 3.5, 1, 12.5, 1.6, 18, C.offWhite, C.chem, smoke);
    m.cylinder(3.5, 8, 12.5, 2.3, 1, C.steelDark, true);
  }
  return finish(m, smoke);
}

// ---------- 军火厂:L1 拱形掩体 / L2 弹药箱垛 / L3 第二掩体 / L4 炮弹堆 / L5 沙袋墙+排气塔 ----------
function shell(m, x, z, h) {
  m.box(x, 1, z, 1, h, 1, 0xd8a838);
  m.set(x, h + 1, z, 0x8a6a2a);
}

export function munitions(L) {
  const m = newModel();
  const smoke = [];
  pad(m, 16, 16, { edge: C.black, inner: (x, z) => (x === 1 || z === 1 || x === 14 || z === 14 ? ((x + z) % 2 ? C.yellow : C.black) : null) });
  quonset(m, 2, 1, 2, 8, 9, C.olive, C.oliveDark, C.khaki);
  m.box(4, 1, 10, 4, 3, 1, C.oliveDark);
  m.box(4, 4, 10, 4, 1, 1, (x) => (x % 2 ? C.yellow : C.black));
  m.set(6, 5, 10, 0xff3a2a, true);
  chimney(m, 5, 5, 4, 1, 3, C.steelDark, null, smoke);
  if (L >= 2) {
    for (const [x, y, z] of [[10, 2, 10], [12, 2, 10], [10, 2, 12], [12, 2, 12], [11, 4, 11]]) {
      crate(m, x, y, z, 2, 2, 2, 0x5a6a3a, 0x3a4a24);
      m.set(x + 1, y + 1, z + 1, C.yellow);
    }
  }
  if (L >= 3) quonset(m, 11, 1, 2, 4, 7, C.olive, C.oliveDark, C.khaki);
  if (L >= 4) {
    for (let x = 2; x <= 7; x++) for (const z of [12, 13]) shell(m, x, z, 2 + ((x + z) % 2));
    m.box(2, 1, 11, 6, 1, 1, C.woodDark);
  }
  if (L >= 5) {
    for (let x = 9; x < 15; x++) m.box(x, 1, 8, 1, 2 + (x % 2), 1, (i, j) => (j % 2 ? C.khaki : shade(C.khaki, 0.85)));
    stack(m, 13, 1, 4, 1.2, 14, C.steelDark, C.yellow, smoke);
  }
  return finish(m, smoke);
}

// ---------- 机械厂:L1 厂房+齿轮标志 / L2 龙门吊 / L3 零件堆 / L4 第二车间+烟囱 / L5 屋顶机械臂 ----------
function gear(m, cx, cy, z, r, color) {
  for (let i = -r - 1; i <= r + 1; i++) {
    for (let j = -r - 1; j <= r + 1; j++) {
      const d = Math.hypot(i, j);
      const a = Math.atan2(j, i);
      const tooth = d <= r + 1 && d > r && Math.cos(a * 8) > 0.3;
      if ((d <= r && d >= r - 1.3) || tooth || d < 0.8) m.set(cx + i, cy + j, z, color);
    }
  }
}

export function machine(L) {
  const m = newModel();
  const smoke = [];
  const wall = 0x5a7a9a;
  pad(m, 16, 16, { inner: (x, z) => (x === 11 ? C.yellow : null) });
  m.box(1, 1, 1, 10, 9, 10, (x, y, z) => (y === 5 ? C.white : ((x + z) % 2 ? wall : shade(wall, 0.9))));
  m.box(10, 1, 3, 1, 5, 4, (x, y) => (y % 2 ? 0x8a96a4 : 0x707a86));
  for (let x = 2; x < 10; x += 2) m.box(x, 7, 10, 1, 2, 1, C.win, true);
  m.box(1, 10, 1, 10, 1, 10, C.steelDark);
  for (const x of [3, 7]) m.box(x, 11, 2, 2, 1, 8, C.winCool, true);
  gear(m, 5, 3, 11, 2, C.yellow);
  if (L >= 2) {
    for (const z of [1, 14]) for (const x of [12, 14]) m.box(x, 1, z, 1, 10, 1, C.yellow);
    m.box(12, 11, 1, 3, 1, 14, C.yellow);
    m.box(12, 10, 7, 3, 1, 2, C.iron);
    m.box(13, 7, 7, 1, 3, 1, C.black);
    gear(m, 13, 5, 7, 1, C.steel);
  }
  if (L >= 3) {
    crate(m, 12, 1, 2, 3, 2, 3, C.steel, C.steelDark);
    crate(m, 12, 1, 10, 3, 3, 3, C.woodLight);
    m.cylinder(13.5, 3, 3.5, 1.2, 1, C.steelDark);
  }
  if (L >= 4) {
    block(m, 1, 1, 11, 8, 6, 4, { wall: shade(wall, 1.1), sx: 2, sy: 3, oy: 2 });
    m.box(1, 7, 11, 8, 1, 4, C.slate);
    chimney(m, 2, 8, 12, 2, 6, C.steelDark, C.white, smoke);
  }
  if (L >= 5) {
    m.box(6, 11, 5, 2, 1, 2, C.iron);
    m.box(6, 12, 5, 1, 5, 1, C.orange);
    for (let i = 0; i < 4; i++) m.set(6 + i, 16 - Math.floor(i / 2), 5, C.orange);
    m.box(9, 13, 5, 1, 2, 1, C.iron);
    m.set(9, 12, 5, C.winCool, true);
  }
  return finish(m, smoke);
}

// ---------- 电子厂:L1 白色厂房+芯片标志 / L2 玻璃二层 / L3 屋顶空调 / L4 太阳能阵列 / L5 发光顶冠 ----------
export function electronics(L) {
  const m = newModel();
  pad(m, 16, 16, { color: C.offWhite, inner: (x, z) => (z === 10 ? C.teal : null) });
  block(m, 2, 1, 2, 12, 5, 7, { wall: C.white, win: C.winCool, sx: 4, wx: 3, sy: 5, wy: 2, oy: 2, top: C.teal });
  // 芯片标志
  m.box(6, 2, 9, 4, 3, 1, (x, y) => (x === 6 || x === 9 || y === 2 || y === 4 ? 0xe2b440 : 0x2a8a5a));
  m.box(7, 3, 9, 2, 1, 1, 0x6affb0, true);
  if (L >= 2) {
    m.box(3, 6, 3, 10, 4, 5, (x, y, z) => ((x + z) % 3 === 0 ? C.steel : C.glass));
    for (let x = 4; x < 12; x += 2) for (const y of [7, 8]) m.set(x, y, 7, C.winCool, true);
    m.box(3, 10, 3, 10, 1, 5, C.white);
  }
  if (L >= 3) {
    for (const x of [4, 8]) {
      m.box(x, 11, 4, 3, 2, 3, C.stoneLight);
      m.set(x + 1, 13, 5, C.steelDark);
    }
    pipeX(m, 7, 11, 11, 6, C.steel);
  }
  if (L >= 4) {
    for (let x = 1; x < 15; x += 5) {
      m.box(x + 1, 1, 12, 1, 2, 1, C.steelDark);
      m.box(x, 3, 11, 4, 1, 3, (i, j, k) => ((i + k) % 2 ? C.solar : 0x3d5ca8));
    }
  }
  if (L >= 5) {
    m.box(5, 11, 6, 6, 4, 2, (x, y) => (y === 14 ? C.white : C.glassDark));
    m.box(5, 13, 7, 6, 1, 1, 0x6affe0, true);
    m.box(10, 15, 6, 1, 4, 1, C.steel);
    m.set(10, 19, 6, 0xff3a2a, true);
  }
  return finish(m, []);
}

export { ring, hash, lattice, pipeY };
