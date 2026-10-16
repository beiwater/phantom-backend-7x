// 模型作者共用的调色板与体素部件(烟囱、储罐、旗帜、管道、窗户墙面……)。
// 约定:模型坐标 x∈[0,W)、z∈[0,D)、y≥0;+z 为正面(等距相机看到 +x/+y/+z 三个面)。
import { VoxelModel, shade } from '../engine/voxel.js';
import { TEAM_COLORS } from '../data/units.js';

export { VoxelModel, shade };

export const C = {
  pad: 0xddd7c9, padEdge: 0xb8b1a1, padDark: 0xa59e8e,
  grass: 0x8cc463, grassDark: 0x6fa84c, soil: 0x7d5a3a, soilDark: 0x5f4229, dirt: 0xb08d5e, sand: 0xd8c08a,
  cream: 0xf3ead6, creamDark: 0xddcfb2, white: 0xf6f6f2, offWhite: 0xe7e5de,
  terracotta: 0xc9653f, terracottaDark: 0xa04a2c, teal: 0x3a9c98, tealDark: 0x2a7470,
  slate: 0x5b6878, slateDark: 0x434d5a,
  wood: 0x9c6b3c, woodDark: 0x6b4728, woodLight: 0xcaa069, log: 0x87572f, logEnd: 0xe0b77c,
  brick: 0xb3573a, brickDark: 0x8c4029,
  stone: 0xa9aba7, stoneDark: 0x7e817f, stoneLight: 0xc9cac4,
  concrete: 0xcbc7bd, concreteDark: 0x9c988f,
  steel: 0x8e9aa8, steelDark: 0x4d545e, iron: 0x373b42, black: 0x26262b,
  rust: 0xc4632a, rustDark: 0x8a3f1c,
  glass: 0x6fb8e6, glassDark: 0x3d7cad,
  win: 0xffd27a, winCool: 0x9fe8ff, lamp: 0xfff0b0, molten: 0xff8a1e, fire: 0xffb030, ember: 0xff5a1e,
  wheat: 0xeac24a, wheatDark: 0xc99a2c, leaf: 0x5aa84a, leafDark: 0x3c7c38,
  olive: 0x76804a, oliveDark: 0x555d34, khaki: 0xbfae7c,
  yellow: 0xf2c230, orange: 0xec8a2a, red: 0xd04a3a, green: 0x3fae5a, chem: 0x52cc5e, blue: 0x3a7bd5,
  water: 0x4aa8e8, asphalt: 0x4b4e55, solar: 0x2b3f78,
};

export function teamColors(team) {
  return TEAM_COLORS[team] ?? TEAM_COLORS.player;
}

// 军事建筑统一配色:玩家=橄榄绿 + 阵营色饰边;敌军=暗钢 + 红色,看起来更具威胁(同占地)。
export function milPalette(team) {
  const t = teamColors(team);
  if (team === 'enemy') {
    return {
      t, enemy: true, wall: 0x45484f, wallDark: 0x2d2f35, roof: 0x232428, trim: t.primary, accent: t.primary,
      accentDark: t.dark, win: 0xff5a36, metal: 0x5a5e66, ground: 0x8a847a, cloth: 0x3a3236, spike: 0x1c1c20,
    };
  }
  return {
    t, enemy: false, wall: C.olive, wallDark: C.oliveDark, roof: t.primary, trim: t.secondary, accent: t.primary,
    accentDark: t.dark, win: C.win, metal: C.steel, ground: 0xc8bc98, cloth: C.khaki, spike: C.woodDark,
  };
}

export function hash(x, y, z) {
  let h = (x * 73856093) ^ (y * 19349663) ^ (z * 83492791);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** 按位置哈希在 base 上做轻微明暗变化,用于石头/泥土/碎石质感。 */
export function vary(base, amt = 0.12) {
  return (x, y, z) => shade(base, 1 - amt + hash(x, y, z) * 2 * amt);
}

/** 地块底座:1 体素厚,深色描边,inner(x,z) 可返回内部颜色(草条、地砖等)。 */
export function pad(m, W, D, { color = C.pad, edge = C.padEdge, inner = null } = {}) {
  m.box(0, 0, 0, W, 1, D, (x, y, z) => {
    if (x === 0 || z === 0 || x === W - 1 || z === D - 1) return edge;
    return (inner && inner(x, z)) ?? color;
  });
  return m;
}

/** 只画周长一圈(女儿墙、围栏、圆环)。 */
export function ring(m, x, y, z, w, d, color, h = 1) {
  m.box(x, y, z, w, h, 1, color);
  m.box(x, y, z + d - 1, w, h, 1, color);
  m.box(x, y, z, 1, h, d, color);
  m.box(x + w - 1, y, z, 1, h, d, color);
  return m;
}

/**
 * 带窗网格的墙体块:sx/sy 为窗户周期,wx/wy 为窗户尺寸,ox/oy 为偏移。
 * 窗户只画在四个外立面上,glow 让窗户在任何光照下都亮。
 */
export function block(m, x, y, z, w, h, d, o = {}) {
  const {
    wall, win = C.win, glow = true, sx = 3, sy = 3, wx = 1, wy = 1, ox = 1, oy = 1,
    base = null, top = null, faces = 'xz', noWin = false,
  } = o;
  m.box(x, y, z, w, h, d, (i, j) => {
    if (base !== null && j === y) return base;
    if (top !== null && j === y + h - 1) return top;
    return typeof wall === 'function' ? wall(i, j) : wall;
  });
  if (noWin) return m;
  const isWin = (u, j) => {
    const uu = u - ox;
    const jj = j - y - oy;
    return uu >= 0 && jj >= 0 && uu % sx < wx && jj % sy < wy && j < y + h - 1 && j > y;
  };
  for (let j = y; j < y + h; j++) {
    for (let i = x + 1; i < x + w - 1; i++) {
      if (!isWin(i - x, j)) continue;
      m.set(i, j, z + d - 1, win, glow);
      if (faces.includes('z')) m.set(i, j, z, win, glow);
    }
    for (let k = z + 1; k < z + d - 1; k++) {
      if (!isWin(k - z, j)) continue;
      m.set(x + w - 1, j, k, win, glow);
      if (faces.includes('x')) m.set(x, j, k, win, glow);
    }
  }
  return m;
}

/** 方形烟囱:带色环 + 黑色烟口;把烟口体素写入 smoke。 */
export function chimney(m, x, y, z, s, h, color, band, smoke) {
  m.box(x, y, z, s, h, s, (i, j) => (band && (y + h - j) % 6 >= 4 && (y + h - j) < 14 ? band : color));
  m.box(x, y + h - 1, z, s, 1, s, shade(color, 0.8));
  if (s >= 3) m.box(x + 1, y + h - 1, z + 1, s - 2, 1, s - 2, C.black);
  smoke?.push([x + Math.floor(s / 2), y + h - 1, z + Math.floor(s / 2)]);
  return y + h;
}

/** 圆形烟囱(cx,cz 为中心体素坐标 +0.5 处)。 */
export function stack(m, cx, y, cz, r, h, color, band, smoke) {
  m.cylinder(cx, y, cz, r, h, (i, j) => (band && (y + h - j) % 5 >= 3 && (y + h - j) < 12 ? band : color));
  m.cylinder(cx, y + h - 1, cz, Math.max(0.6, r - 1), 1, C.black);
  smoke?.push([Math.floor(cx), y + h - 1, Math.floor(cz)]);
  return y + h;
}

/** 立式储罐:圆柱 + 拱顶 + 可选色带。 */
export function tank(m, cx, y, cz, r, h, color, stripe = null, stripeAt = []) {
  m.cylinder(cx, y, cz, r, h, (i, j) => (stripe && stripeAt.includes(j - y) ? stripe : color));
  m.cylinder(cx, y + h, cz, r - 0.8, 1, shade(color, 0.95));
  if (r > 2) m.cylinder(cx, y + h + 1, cz, r - 2, 1, shade(color, 0.9));
  return y + h + (r > 2 ? 2 : 1);
}

/** 旗杆 + 旗面(沿 +x 飘)。 */
export function flag(m, x, y, z, h, color, pole = C.stoneLight, fw = 3, fh = 2) {
  m.box(x, y, z, 1, h, 1, pole);
  m.box(x + 1, y + h - fh - 1, z, fw, fh, 1, (i, j) => (i === x + fw && j === y + h - 2 ? shade(color, 0.85) : color));
  m.set(x, y + h, z, C.yellow);
  return y + h + 1;
}

export function pipeX(m, x0, x1, y, z, color) { return m.box(Math.min(x0, x1), y, z, Math.abs(x1 - x0) + 1, 1, 1, color); }
export function pipeZ(m, z0, z1, y, x, color) { return m.box(x, y, Math.min(z0, z1), 1, 1, Math.abs(z1 - z0) + 1, color); }
export function pipeY(m, y0, y1, x, z, color) { return m.box(x, Math.min(y0, y1), z, 1, Math.abs(y1 - y0) + 1, 1, color); }

/** 木箱/货箱:边框深色。 */
export function crate(m, x, y, z, w, h, d, color, edge = shade(color, 0.7)) {
  m.box(x, y, z, w, h, d, (i, j, k) => {
    const ex = i === x || i === x + w - 1;
    const ey = j === y || j === y + h - 1;
    const ez = k === z || k === z + d - 1;
    return (ex && ey) || (ey && ez) || (ex && ez) ? edge : color;
  });
  return m;
}

/** 沿 x 轴的横卧圆柱(原木、回转窑)。 */
export function cylX(m, x0, len, cy, cz, r, color) {
  const r2 = r * r;
  for (let j = Math.floor(cy - r); j <= Math.ceil(cy + r); j++) {
    for (let k = Math.floor(cz - r); k <= Math.ceil(cz + r); k++) {
      const dy = j + 0.5 - cy;
      const dz = k + 0.5 - cz;
      if (dy * dy + dz * dz > r2) continue;
      for (let i = x0; i < x0 + len; i++) m.set(i, j, k, typeof color === 'function' ? color(i, j, k) : color);
    }
  }
  return m;
}

/** 沿 z 轴的横卧圆柱。 */
export function cylZ(m, z0, len, cx, cy, r, color) {
  const r2 = r * r;
  for (let i = Math.floor(cx - r); i <= Math.ceil(cx + r); i++) {
    for (let j = Math.floor(cy - r); j <= Math.ceil(cy + r); j++) {
      const dx = i + 0.5 - cx;
      const dy = j + 0.5 - cy;
      if (dx * dx + dy * dy > r2) continue;
      for (let k = z0; k < z0 + len; k++) m.set(i, j, k, typeof color === 'function' ? color(i, j, k) : color);
    }
  }
  return m;
}

/** 半圆拱顶棚(活动板房/机库),拱沿 z 方向延伸;只取 y≥y0 的半圆。 */
export function quonset(m, x, y, z, w, d, color, rib = shade(color, 0.8), end = null) {
  const r = w / 2;
  const cx = x + r;
  for (let i = x; i < x + w; i++) {
    for (let j = y; j < y + Math.ceil(r) + 1; j++) {
      const dx = i + 0.5 - cx;
      const dy = j - y + 0.5;
      if (dx * dx + dy * dy > r * r) continue;
      for (let k = z; k < z + d; k++) {
        const isEnd = k === z + d - 1 || k === z;
        m.set(i, j, k, isEnd && end ? end : ((k - z) % 3 === 0 ? rib : color));
      }
    }
  }
  return m;
}

/** 四棱锥屋顶。 */
export function pyramid(m, x, y, z, w, d, color) {
  let l = 0;
  while (w - 2 * l > 0 && d - 2 * l > 0) {
    m.box(x + l, y + l, z + l, w - 2 * l, 1, d - 2 * l, color);
    l++;
  }
  return y + l;
}

/** 开放式钢/木桁架塔:四角立柱 + 每 step 层一圈横梁。 */
export function lattice(m, x, y, z, w, h, d, color, step = 3) {
  for (const [i, k] of [[x, z], [x + w - 1, z], [x, z + d - 1], [x + w - 1, z + d - 1]]) m.box(i, y, k, 1, h, 1, color);
  for (let j = y + step - 1; j < y + h; j += step) ring(m, x, j, z, w, d, color);
  return y + h;
}

/** 剔除完全被包围的内部体素:不影响渲染(面与 AO 都不变),只减少体素/遍历量。 */
export function compact(m) {
  const drop = [];
  for (const v of m.voxels.values()) {
    const { x, y, z } = v;
    if (m.get(x + 1, y, z) && m.get(x - 1, y, z) && m.get(x, y + 1, z) && m.get(x, y - 1, z)
      && m.get(x, y, z + 1) && m.get(x, y, z - 1)) drop.push(v);
  }
  for (const v of drop) m.remove(v.x, v.y, v.z);
  return m;
}

/** 收尾:写入元数据并压缩。 */
export function finish(m, smoke = [], extra = {}) {
  m.smoke = smoke;
  m.labelY = m.height() + 2;
  Object.assign(m, extra);
  return compact(m);
}

export function newModel() {
  return new VoxelModel();
}
