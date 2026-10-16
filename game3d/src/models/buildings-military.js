// 军事 / 防御建筑:兵营、战车工厂、直升机场、防御塔(塔身 + 可旋转炮塔头)。
// 全部使用阵营色:玩家=橄榄绿 + 蓝色饰边,敌军=暗钢 + 红色 + 尖刺。
import {
  C, shade, vary, pad, ring, block, chimney, crate, cylZ, quonset, lattice, flag, pyramid, finish, newModel,
  milPalette,
} from './common.js';

function spikes(m, x, y, z, w, d, P) {
  if (!P.enemy) return;
  for (let i = x; i < x + w; i += 2) { m.set(i, y, z, P.spike); m.set(i, y, z + d - 1, P.spike); }
}

// ---------- 兵营:L1 营房+旗杆 / L2 瞭望塔 / L3 第二营房+训练场 ----------
function hut(m, x, z, w, d, h, P) {
  block(m, x, 1, z, w, h, d, { wall: (i, j) => (j === 1 ? P.wallDark : P.wall), win: P.win, sx: 3, sy: 4, oy: 2, ox: 1 });
  m.box(x + Math.floor(w / 2), 1, z + d - 1, 1, 3, 1, P.wallDark);
  m.gableRoof(x - 1, h + 1, z - 1, w + 2, d + 2, (i, j) => (j === h + 1 ? P.accentDark : P.roof));
  spikes(m, x, h + Math.ceil((d + 2) / 2), z + Math.floor(d / 2), w, 1, P);
}

export function barracks(L, team) {
  const P = milPalette(team);
  const m = newModel();
  pad(m, 16, 16, { color: P.ground, edge: shade(P.ground, 0.75), inner: (x, z) => vary(P.ground, 0.06)(x, 0, z) });
  hut(m, 2, 2, 9, 5, 5, P);
  flag(m, 13, 1, 9, 12, P.accent, C.stoneLight, 4, 3);
  ring(m, 12, 1, 8, 3, 3, C.stone);
  for (let x = 2; x < 11; x += 2) m.box(x, 1, 8, 2, 1, 1, P.cloth);
  if (L >= 2) {
    lattice(m, 12, 1, 1, 3, 13, 3, C.woodDark, 4);
    m.box(11, 14, 0, 5, 1, 5, C.woodLight);
    ring(m, 11, 15, 0, 5, 5, P.wall);
    pyramid(m, 11, 17, 0, 5, 5, P.roof);
    m.set(13, 16, 4, P.enemy ? 0xff3a2a : C.lamp, true);
  }
  if (L >= 3) {
    hut(m, 2, 10, 6, 4, 4, P);
    // 训练场:靶人 + 跨栏
    for (const x of [10, 12, 14]) {
      m.box(x, 1, 12, 1, 3, 1, C.woodDark);
      m.box(x, 3, 12, 1, 2, 1, P.cloth);
      m.set(x, 4, 13, P.accent);
    }
    m.box(9, 2, 14, 6, 1, 1, C.wood);
    for (const x of [9, 14]) m.set(x, 1, 14, C.woodDark);
  }
  return finish(m, []);
}

// ---------- 战车工厂(3×3):L1 拱顶总装车间 / L2 侧跨+烟囱+行车 / L3 停放坦克+油罐 ----------
function miniTank(m, x, z, P) {
  m.box(x, 1, z, 1, 2, 5, C.iron);
  m.box(x + 4, 1, z, 1, 2, 5, C.iron);
  m.box(x + 1, 2, z, 3, 2, 5, P.wall);
  m.box(x + 1, 4, z + 1, 3, 2, 3, P.accent);
  m.box(x + 2, 5, z + 4, 1, 1, 2, C.iron);
}

export function vehicleFactory(L, team) {
  const P = milPalette(team);
  const m = newModel();
  const smoke = [];
  const wall = P.enemy ? P.wall : 0x9aa298;
  pad(m, 24, 24, {
    color: C.concrete,
    inner: (x, z) => (z === 18 && x >= 3 && x <= 14 ? ((x % 2) ? C.yellow : C.black) : null),
  });
  m.box(1, 1, 2, 16, 9, 15, (x, y) => (y === 7 ? P.accent : wall));
  m.box(4, 1, 16, 10, 6, 1, (x, y) => (y % 2 ? P.metal : shade(P.metal, 0.8)));
  for (let z = 4; z < 15; z += 3) m.box(16, 3, z, 1, 2, 2, P.win, true);
  // 筒形拱顶
  for (let i = 0; i < 9; i++) {
    const y = 10 + Math.round(Math.sin((i / 8) * Math.PI) * 3);
    m.box(1 + i, 10, 2, 1, y - 9, 15, (x, j, z) => (z % 4 === 0 ? P.accentDark : P.roof));
    m.box(16 - i, 10, 2, 1, y - 9, 15, (x, j, z) => (z % 4 === 0 ? P.accentDark : P.roof));
  }
  spikes(m, 2, 14, 2, 14, 15, P);
  chimney(m, 2, 10, 3, 2, 8, P.metal, P.accent, smoke);
  if (L >= 2) {
    block(m, 17, 1, 2, 6, 7, 12, { wall, win: P.win, sx: 3, sy: 3, oy: 2 });
    m.box(17, 8, 2, 6, 1, 12, P.roof);
    chimney(m, 19, 9, 4, 2, 13, P.metal, P.accent, smoke);
    for (const z of [7, 12]) m.box(18, 9, z, 5, 1, 1, C.yellow);
    m.box(21, 9, 7, 1, 1, 6, C.yellow);
  }
  if (L >= 3) {
    miniTank(m, 3, 17, P);
    miniTank(m, 10, 17, P);
    cylZ(m, 16, 6, 20, 2.2, 1.6, P.enemy ? P.metal : C.olive);
    m.box(17, 1, 16, 1, 1, 6, C.steelDark);
    m.box(22, 1, 16, 1, 1, 6, C.steelDark);
    flag(m, 21, 4, 21, 6, P.accent);
  }
  return finish(m, smoke);
}

// ---------- 直升机场(3×3):L1 停机坪+塔台 / L2 机库 / L3 第二停机坪+雷达 ----------
function helipad(m, x0, z0, s, P) {
  const c = x0 + s / 2;
  const cz = z0 + s / 2;
  m.box(x0, 1, z0, s, 1, s, (x, y, z) => {
    const d = Math.hypot(x + 0.5 - c, z + 0.5 - cz);
    if (d > s / 2) return null;
    if (d > s / 2 - 1.2) return P.accent;
    const hx = x - x0;
    const hz = z - z0;
    if ((hx === 3 || hx === s - 4) && hz >= 3 && hz <= s - 4) return C.white;
    if (hz === Math.floor(s / 2) && hx > 3 && hx < s - 4) return C.white;
    return 0x6a6e76;
  });
  for (const [x, z] of [[x0 + 1, z0 + 1], [x0 + s - 2, z0 + 1], [x0 + 1, z0 + s - 2], [x0 + s - 2, z0 + s - 2]]) m.set(x, 1, z, 0x6aff8a, true);
}

export function airfield(L, team) {
  const P = milPalette(team);
  const m = newModel();
  pad(m, 24, 24, { color: C.asphalt, edge: 0x3a3c42, inner: (x, z) => (x === 12 && z % 3 === 0 ? C.yellow : null) });
  helipad(m, 1, 13, 10, P);
  // 塔台
  m.box(15, 1, 1, 4, 12, 4, (x, y) => (y % 4 === 0 ? P.accent : (P.enemy ? P.wall : C.offWhite)));
  m.box(14, 13, 0, 6, 1, 6, P.metal);
  m.box(14, 14, 0, 6, 3, 6, (x, y, z) => (x === 14 || x === 19 || z === 0 || z === 5 ? P.win : C.iron));
  for (const v of m.voxels.values()) if (v.color === P.win && v.y >= 14 && v.y <= 16) v.glow = true;
  m.box(14, 17, 0, 6, 1, 6, P.roof);
  flag(m, 17, 18, 2, 4, P.accent);
  // 风向袋
  m.box(22, 1, 10, 1, 6, 1, C.steel);
  m.box(22, 6, 11, 1, 1, 3, (x, y, z) => (z % 2 ? C.orange : C.white));
  if (L >= 2) {
    quonset(m, 13, 1, 10, 10, 12, P.enemy ? P.wall : 0xb8bcc0, P.accent, P.metal);
    m.box(15, 1, 21, 6, 4, 1, (x, y) => (y % 2 ? 0x55595f : 0x45494f));
  }
  if (L >= 3) {
    helipad(m, 1, 1, 10, P);
    m.box(17, 18, 3, 1, 2, 1, C.steel);
    m.box(15, 20, 3, 5, 3, 1, (x, y) => (y === 21 ? C.white : C.offWhite));
    m.set(17, 21, 4, 0xff3a2a, true);
  }
  return finish(m, []);
}

// ---------- 防御塔塔身(1×1):L1 木塔 / L2 石塔 / L3 混凝土塔+阵营条纹 / L4 加装甲板+弹药箱 ----------
const TOWER_TOP = [0, 9, 11, 12, 13];

export function turret(L, team) {
  const P = milPalette(team);
  const m = newModel();
  const top = TOWER_TOP[Math.min(4, L)];
  pad(m, 8, 8, { color: C.stoneLight });
  if (L === 1) {
    for (const [x, z] of [[1, 1], [6, 1], [1, 6], [6, 6]]) m.box(x, 1, z, 1, top - 1, 1, C.log);
    for (let y = 3; y < top; y += 3) ring(m, 1, y, 1, 6, 6, C.wood);
    m.box(0, top - 1, 0, 8, 1, 8, C.woodLight);
    m.box(4, 3, 6, 2, 3, 1, P.accent);
  } else if (L === 2) {
    m.box(1, 1, 1, 6, top - 1, 6, (x, y, z) => vary(C.stone, 0.12)(x, y, z));
    m.box(0, top - 1, 0, 8, 1, 8, C.stoneLight);
    for (const y of [4, 7]) { m.set(3, y, 6, C.black); m.set(6, y, 3, C.black); }
    m.box(3, 5, 7, 2, 4, 1, P.accent);
  } else {
    m.box(1, 1, 1, 6, top - 1, 6, (x, y) => (y >= top - 3 && y < top - 1 ? P.accent : (P.enemy ? P.wall : C.concrete)));
    m.box(0, top - 1, 0, 8, 1, 8, P.enemy ? P.wallDark : C.concreteDark);
    for (const y of [4, 7]) { m.box(3, y, 6, 2, 1, 1, P.win, true); m.box(6, y, 3, 1, 1, 2, P.win, true); }
    m.box(0, 1, 0, 8, 2, 1, P.enemy ? P.wallDark : C.concreteDark);
    if (L >= 4) {
      for (const [x, z] of [[0, 0], [7, 0], [0, 7], [7, 7]]) m.box(x, 1, z, 1, top - 1, 1, P.metal);
      crate(m, 6, 1, 6, 2, 2, 2, C.olive);
      m.box(0, top, 0, 1, 4, 1, C.steel);
      m.set(0, top + 4, 0, 0xff3a2a, true);
    }
  }
  return finish(m, [], { pivotY: top });
}

// ---------- 炮塔头:原点 = 旋转轴(体素 0,0,0),炮管朝 +z ----------
export function turretHead(L, team) {
  const P = milPalette(team);
  const m = newModel();
  if (L === 1) {
    m.cylinder(0, 0, 0, 2.5, 1, C.woodLight);
    m.box(-2, 1, -2, 1, 2, 4, C.wood);
    m.box(1, 1, -2, 1, 2, 4, C.wood);
    m.box(-1, 2, -2, 2, 2, 6, 0xb8863a);
    m.box(-1, 2, 4, 2, 2, 1, C.iron);
    m.set(-1, 4, -2, P.accent);
  } else if (L === 2) {
    m.cylinder(0, 0, 0, 3, 1, C.iron);
    m.box(-2, 1, -2, 4, 3, 4, C.steelDark);
    m.box(-3, 1, 2, 6, 4, 1, P.metal);
    m.box(-1, 2, -1, 2, 2, 8, C.iron);
    m.set(-1, 4, -1, P.accent);
    m.set(0, 4, -1, P.accent);
  } else {
    const body = P.enemy ? P.wall : C.olive;
    m.cylinder(0, 0, 0, 3, 1, C.iron);
    m.box(-3, 1, -3, 6, 4, 6, (x, y) => (y === 3 ? P.accent : body));
    m.box(-2, 5, -2, 4, 1, 4, shade(body, 0.85));
    if (L === 3) {
      m.box(-1, 2, 3, 2, 2, 7, C.iron);
      m.box(-1, 2, 9, 2, 2, 1, C.black);
    } else {
      for (const x of [-2, 1]) { m.box(x, 2, 3, 1, 2, 8, C.iron); m.set(x, 3, 10, C.black); }
      m.box(-1, 6, -2, 1, 2, 1, C.steel);
      m.box(-2, 8, -3, 3, 2, 1, C.offWhite);
      m.set(-1, 8, -2, P.win, true);
    }
  }
  return finish(m, [], { pivotY: TOWER_TOP[Math.min(4, L)], footW: 0, footD: 0 });
}
