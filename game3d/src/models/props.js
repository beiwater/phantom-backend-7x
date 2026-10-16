// 场景道具:树、岩石、资源矿脉、施工脚手架、废墟。1 格 = 8 体素。
import { C, shade, hash, ring, crate, lattice, ellipsoid, finish, newModel } from './common.js';

const leafFn = (base, light) => (x, y, z) => {
  const h = hash(x, y, z);
  return h > 0.82 ? light : h < 0.15 ? shade(base, 0.82) : base;
};

// ---------- 树:0 松 / 1 圆冠橡树 / 2 白桦 / 3 灌木 ----------
export function tree(variant) {
  const m = newModel();
  const v = ((variant % 4) + 4) % 4;
  if (v === 0) {
    m.box(3, 0, 3, 2, 3, 2, C.woodDark);
    const layers = [[2, 3.6], [4, 3], [6, 2.4], [8, 1.8], [10, 1.2], [12, 0.8]];
    for (const [y, r] of layers) {
      m.cylinder(4, y, 4, r, 2, (x, j, z) => (j === y + 1 && hash(x, j, z) > 0.6 ? 0x4a8a50 : leafFn(0x2f6a3e, 0x3f7f4a)(x, j, z)));
    }
    m.set(4, 14, 4, 0x3f7f4a);
  } else if (v === 1) {
    m.box(3, 0, 3, 2, 4, 2, C.log);
    m.set(5, 3, 4, C.log);
    ellipsoid(m, 4, 7, 4, 3.5, 3, 3.5, leafFn(C.leaf, 0x8ad06a));
    ellipsoid(m, 5, 9.5, 4.5, 2, 1.5, 2, leafFn(0x6ab858, 0x9ae07a));
  } else if (v === 2) {
    for (let y = 0; y < 9; y++) m.set(4, y, 4, hash(4, y, 4) > 0.7 || y % 3 === 1 ? C.black : C.white);
    m.set(5, 6, 4, C.white);
    ellipsoid(m, 4.5, 9, 4.5, 2.6, 2.4, 2.6, leafFn(0x9ad05a, 0xc8e878));
    ellipsoid(m, 4.5, 11.5, 4.5, 1.6, 1.5, 1.6, leafFn(0x9ad05a, 0xc8e878));
  } else {
    ellipsoid(m, 3, 1.5, 4, 2.4, 2.2, 2.4, leafFn(0x4a9a48, 0x6abf5a));
    ellipsoid(m, 5.2, 1.4, 4.2, 2, 2, 2, leafFn(0x4a9a48, 0x6abf5a));
    for (const [x, y, z] of [[2, 3, 5], [4, 2, 6], [6, 3, 4], [3, 2, 2], [6, 1, 6]]) {
      if (m.get(x, y, z)) m.set(x, y, z, 0xe04a5a);
    }
  }
  return finish(m, []);
}

// ---------- 岩石:灰色巨石 ----------
const rockFn = (x, y, z) => {
  const h = hash(x, y, z);
  return shade(h > 0.85 ? 0xb8b8b4 : 0x8e908e, 0.88 + hash(z, x, y) * 0.24);
};

export function rock(variant) {
  const m = newModel();
  const v = ((variant % 3) + 3) % 3;
  if (v === 0) {
    ellipsoid(m, 4, 1.5, 4, 3.2, 3.2, 2.8, rockFn);
    ellipsoid(m, 6.3, 0.5, 6.3, 1.3, 1.2, 1.3, rockFn);
  } else if (v === 1) {
    ellipsoid(m, 3, 1, 3.5, 2.4, 2.6, 2.2, rockFn);
    ellipsoid(m, 5.5, 0.5, 5, 2, 2.2, 2, rockFn);
    ellipsoid(m, 1.5, 0.3, 6.5, 1, 1, 1, rockFn);
  } else {
    ellipsoid(m, 4, 0, 4, 3.5, 1.6, 3, rockFn);
    ellipsoid(m, 3.5, 1.2, 3.5, 1.8, 1.6, 1.6, rockFn);
    for (const [x, z] of [[1, 1], [7, 2], [6, 7]]) m.set(x, 0, z, 0x9a9c9a);
  }
  // 顶部被苔藓覆盖一点,更像自然石头
  for (const vx of [...m.voxels.values()]) {
    if (!m.get(vx.x, vx.y + 1, vx.z) && hash(vx.x, vx.y, vx.z + 7) > 0.8 && vx.y >= 2) vx.color = 0x7aa858;
  }
  return finish(m, []);
}

// ---------- 资源矿脉:ore 锈红矿石+橙色闪光 / coal 黑色煤块+暗光 / oil 深紫油池+气泡 ----------
export function deposit(kind) {
  const m = newModel();
  if (kind === 'oil') {
    for (let x = 0; x < 8; x++) {
      for (let z = 0; z < 8; z++) {
        const d = Math.hypot(x + 0.5 - 4, z + 0.5 - 4) + (hash(x, 0, z) - 0.5) * 1.4;
        if (d < 3.6) m.set(x, 0, z, d < 2 ? 0x2a1a3a : 0x3a2650);
        else if (d < 4.2) m.set(x, 0, z, 0x5a4a5a);
      }
    }
    for (const [x, z] of [[3, 3], [5, 4], [4, 5]]) m.set(x, 1, z, 0x6a4a9a);
    m.set(5, 1, 3, 0x9a7ac8, true);
    m.set(2, 1, 5, 0x9a7ac8, true);
    return finish(m, []);
  }
  const ore = kind === 'ore';
  const base = ore ? 0xa04a2a : 0x26262c;
  const glint = ore ? 0xffa040 : 0x7a8aa8;
  const lumps = ore
    ? [[2.5, 1, 2.5, 1.8], [5.5, 1, 3, 1.6], [3.5, 1, 5.8, 1.7], [6, 0.5, 6.2, 1.1]]
    : [[2.5, 1, 3, 1.9], [5.5, 0.8, 2.5, 1.4], [4.5, 1, 5.5, 2], [1.5, 0.3, 6, 1]];
  for (const [x, y, z, r] of lumps) {
    ellipsoid(m, x, y, z, r, r * 0.9, r, (i, j, k) => (hash(i, j, k) > 0.84 ? glint : shade(base, 0.85 + hash(k, i, j) * 0.3)));
  }
  for (const v of m.voxels.values()) if (v.color === glint) v.glow = ore;
  for (let i = 0; i < 8; i++) m.set(Math.floor(hash(i, 1, 3) * 8), 0, Math.floor(hash(3, i, 1) * 8), shade(base, 1.15));
  return finish(m, []);
}

// ---------- 施工脚手架:木架 + 塔吊 + 材料堆 ----------
export function scaffold(w, d) {
  const m = newModel();
  const W = w * 8;
  const D = d * 8;
  const H = 6 + 4 * Math.min(w, d);
  m.box(0, 0, 0, W, 1, D, (x, y, z) => (x === 0 || z === 0 || x === W - 1 || z === D - 1 ? 0x8a6a44 : (hash(x, 0, z) > 0.8 ? 0x9a7a52 : 0xb08a5a)));
  for (let x = 1; x < W - 1; x += 3) for (const z of [1, D - 2]) m.box(x, 1, z, 1, H, 1, C.woodLight);
  for (let z = 1; z < D - 1; z += 3) for (const x of [1, W - 2]) m.box(x, 1, z, 1, H, 1, C.woodLight);
  for (const [x, z] of [[W - 2, 1], [W - 2, D - 2], [1, D - 2], [1, 1]]) m.box(x, 1, z, 1, H, 1, C.woodLight);
  for (let y = 4; y <= H; y += 4) ring(m, 1, y, 1, W - 2, D - 2, C.wood);
  // 正面(+z)与右侧(+x)斜撑
  for (let i = 0; i < Math.min(H, W - 2); i++) m.set(1 + i, 1 + i, D - 1, C.woodDark);
  for (let i = 0; i < Math.min(H, D - 2); i++) m.set(W - 1, 1 + i, D - 2 - i, C.woodDark);
  // 安全网色带
  for (let x = 2; x < W - 2; x++) if (x % 2) m.set(x, H - 1, D - 2, C.orange);
  if (w * d > 1) {
    const cx = W - 4;
    const top = lattice(m, cx, 1, 2, 2, H + 8, 2, C.yellow, 2);
    m.box(cx - 1, top, 1, 4, 2, 4, C.yellow);
    m.set(cx + 1, top + 1, 3, C.winCool, true);
    const jib = W - 6;
    m.box(cx - jib, top + 2, 2, jib + 6, 1, 1, C.yellow);
    m.box(cx + 3, top, 2, 2, 2, 2, C.concreteDark);
    m.box(cx - jib + 2, top - 4, 2, 1, 6, 1, C.iron);
    crate(m, cx - jib + 1, top - 6, 1, 3, 2, 3, C.woodLight);
  } else {
    m.box(6, 1, 6, 1, H + 2, 1, C.yellow);
    m.box(3, H + 2, 6, 4, 1, 1, C.yellow);
    m.box(3, H - 1, 6, 1, 3, 1, C.iron);
  }
  // 材料:砖垛 + 木板 + 水泥袋
  const bx = 2;
  const bz = D - 4;
  m.box(bx, 1, bz, 3, 2, 2, (x, y) => ((x + y) % 2 ? C.brick : C.brickDark));
  if (w > 1) {
    m.box(bx + 4, 1, bz, 4, 1, 2, C.woodLight);
    m.box(bx + 4, 2, bz, 4, 1, 2, 0xe0c08a);
    m.box(W - 6, 1, D - 4, 2, 2, 2, 0xd8d0be);
  }
  return finish(m, []);
}

// ---------- 废墟:碎砖混凝土堆 + 残墙 + 焦黑 + 余烬 ----------
export function rubble(w, d) {
  const m = newModel();
  const W = w * 8;
  const D = d * 8;
  const mats = [0x9c988f, 0xb3573a, 0x6a6a6e, 0x3a3634, 0xc9c5bc, 0x8c4029];
  const pick = (x, y, z) => {
    const h = hash(x, y, z);
    if (h > 0.97) return C.ember;
    return mats[Math.floor(hash(z, y, x) * mats.length)];
  };
  m.box(0, 0, 0, W, 1, D, (x, y, z) => (hash(x, 0, z) > 0.6 ? 0x4a4644 : 0x6a6460));
  const piles = 2 + w * d;
  for (let i = 0; i < piles; i++) {
    const cx = 1.5 + hash(i, w, d) * (W - 3);
    const cz = 1.5 + hash(d, i, w) * (D - 3);
    const r = 1.6 + hash(w, d, i) * (1 + Math.min(w, d));
    ellipsoid(m, cx, 0.5, cz, r, r * 0.7, r, pick);
  }
  // 残墙断片
  const walls = Math.max(1, Math.min(w, d) + 1);
  for (let i = 0; i < walls; i++) {
    const x = 1 + Math.floor(hash(i, 7, w) * (W - 4));
    const z = 1 + Math.floor(hash(7, i, d) * (D - 4));
    const h = 3 + Math.floor(hash(i, i, 3) * (2 + 2 * Math.min(w, d)));
    for (let k = 0; k < 3; k++) m.box(x + k, 1, z, 1, Math.max(1, h - k * 2), 1, (a, b) => (b % 3 === 0 ? 0x8c4029 : 0xb3573a));
    m.box(x, 1, z + 1, 1, Math.max(1, h - 2), 2, 0x9c988f);
  }
  for (const v of m.voxels.values()) if (v.color === C.ember) v.glow = true;
  return finish(m, []);
}
