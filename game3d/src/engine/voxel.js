// 体素模型构建器:按体素坐标填色,输出带面剔除 + 顶点 AO + 颜色抖动的 BufferGeometry。
// 1 个地块格 = VOXELS_PER_CELL 个体素;模型原点 = 占地中心、地面高度 0。
import * as THREE from 'three';

export const VOXELS_PER_CELL = 8;
const VOXEL_SIZE = 1 / VOXELS_PER_CELL;

const FACES = [
  { n: [1, 0, 0], c: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], shade: 0.86 },
  { n: [-1, 0, 0], c: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]], shade: 0.86 },
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], shade: 1.0 },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: 0.6 },
  { n: [0, 0, 1], c: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]], shade: 0.93 },
  { n: [0, 0, -1], c: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]], shade: 0.93 },
];

const key = (x, y, z) => `${x},${y},${z}`;

function hash3(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

export class VoxelModel {
  constructor() {
    /** @type {Map<string, {x:number,y:number,z:number,color:number,glow:boolean}>} */
    this.voxels = new Map();
  }

  set(x, y, z, color, glow = false) {
    x = Math.round(x); y = Math.round(y); z = Math.round(z);
    if (y < 0) return this;
    this.voxels.set(key(x, y, z), { x, y, z, color, glow });
    return this;
  }

  get(x, y, z) {
    return this.voxels.get(key(x, y, z));
  }

  remove(x, y, z) {
    this.voxels.delete(key(x, y, z));
    return this;
  }

  /** 实心长方体:起点 (x,y,z),尺寸 (w,h,d)。color 可为函数 (x,y,z)=>hex 以绘制条纹/窗户。 */
  box(x, y, z, w, h, d, color, glow = false) {
    for (let i = x; i < x + w; i++) {
      for (let j = y; j < y + h; j++) {
        for (let k = z; k < z + d; k++) {
          const c = typeof color === 'function' ? color(i, j, k) : color;
          if (c !== null && c !== undefined) this.set(i, j, k, c, glow);
        }
      }
    }
    return this;
  }

  /** 镂空:删除长方体范围内的体素。 */
  carve(x, y, z, w, h, d) {
    for (let i = x; i < x + w; i++) {
      for (let j = y; j < y + h; j++) {
        for (let k = z; k < z + d; k++) this.remove(i, j, k);
      }
    }
    return this;
  }

  /** 竖直圆柱:底面圆心 (cx,cz),半径 r,自 y 起高 h。hollow=true 只保留外壳。 */
  cylinder(cx, y, cz, r, h, color, hollow = false) {
    const r2 = r * r;
    const inner = (r - 1) * (r - 1);
    for (let i = Math.floor(cx - r); i <= Math.ceil(cx + r); i++) {
      for (let k = Math.floor(cz - r); k <= Math.ceil(cz + r); k++) {
        const dx = i + 0.5 - cx;
        const dz = k + 0.5 - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 > r2) continue;
        if (hollow && d2 < inner) continue;
        for (let j = y; j < y + h; j++) {
          const c = typeof color === 'function' ? color(i, j, k) : color;
          if (c !== null && c !== undefined) this.set(i, j, k, c);
        }
      }
    }
    return this;
  }

  /** 实心球(用于树冠、油罐顶)。 */
  sphere(cx, cy, cz, r, color) {
    const r2 = r * r;
    for (let i = Math.floor(cx - r); i <= Math.ceil(cx + r); i++) {
      for (let j = Math.floor(cy - r); j <= Math.ceil(cy + r); j++) {
        for (let k = Math.floor(cz - r); k <= Math.ceil(cz + r); k++) {
          const dx = i + 0.5 - cx;
          const dy = j + 0.5 - cy;
          const dz = k + 0.5 - cz;
          if (dx * dx + dy * dy + dz * dz <= r2) {
            // 与 box 一致:颜色函数返回 null 时跳过(用于半球/镂空)
            const c = typeof color === 'function' ? color(i, j, k) : color;
            if (c !== null && c !== undefined) this.set(i, j, k, c);
          }
        }
      }
    }
    return this;
  }

  /** 两段式坡屋顶:沿 x 方向的屋脊,底部范围 (x,z,w,d) 起于高度 y。 */
  gableRoof(x, y, z, w, d, color, alongX = true) {
    const span = alongX ? d : w;
    const layers = Math.ceil(span / 2);
    for (let l = 0; l < layers; l++) {
      if (alongX) this.box(x, y + l, z + l, w, 1, d - 2 * l, color);
      else this.box(x + l, y + l, z, w - 2 * l, 1, d, color);
    }
    return this;
  }

  /**
   * 生成几何体。footprint 以格为单位(决定中心偏移)。
   * jitter:每个体素的亮度随机幅度,形成像素块质感。
   */
  toGeometry({ footW = 1, footD = 1, jitter = 0.06, scale = VOXEL_SIZE } = {}) {
    const positions = [];
    const normals = [];
    const colors = [];
    const glows = [];
    const indices = [];
    const occ = (x, y, z) => this.voxels.has(key(x, y, z));
    const offX = (footW * VOXELS_PER_CELL) / 2;
    const offZ = (footD * VOXELS_PER_CELL) / 2;
    const col = new THREE.Color();

    for (const v of this.voxels.values()) {
      const j = 1 + (hash3(v.x, v.y, v.z) - 0.5) * 2 * jitter;
      for (const f of FACES) {
        const [nx, ny, nz] = f.n;
        if (occ(v.x + nx, v.y + ny, v.z + nz)) continue;
        const base = positions.length / 3;
        const ao = [];
        for (const c of f.c) {
          positions.push((v.x + c[0] - offX) * scale, (v.y + c[1]) * scale, (v.z + c[2] - offZ) * scale);
          normals.push(nx, ny, nz);
          ao.push(v.glow ? 1 : vertexAO(occ, v, f.n, c));
        }
        for (let i = 0; i < 4; i++) {
          col.setHex(v.color);
          const s = v.glow ? 1.25 : j * (0.55 + 0.45 * ao[i]);
          colors.push(Math.min(1, col.r * s), Math.min(1, col.g * s), Math.min(1, col.b * s));
          glows.push(v.glow ? 1 : 0);
        }
        // AO 各向异性:按对角线 AO 和选择三角剖分,避免条纹伪影
        if (ao[0] + ao[2] > ao[1] + ao[3]) {
          indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        } else {
          indices.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    // 发光体素(窗户/灯/屏幕)标记,夜间由着色器自发光(见 engine/daynight.js)
    geo.setAttribute('aGlow', new THREE.Float32BufferAttribute(glows, 1));
    geo.setIndex(indices);
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    return geo;
  }

  /** 模型最高体素层(用于标签定位)。 */
  height() {
    let h = 0;
    for (const v of this.voxels.values()) h = Math.max(h, v.y + 1);
    return h;
  }
}

// 经典体素 AO:检查面前方层上的两个侧邻与一个角邻。
function vertexAO(occ, v, n, corner) {
  const axis = n[0] !== 0 ? 0 : n[1] !== 0 ? 1 : 2;
  const u = (axis + 1) % 3;
  const w = (axis + 2) % 3;
  const p = [v.x + n[0], v.y + n[1], v.z + n[2]];
  const du = corner[u] === 1 ? 1 : -1;
  const dw = corner[w] === 1 ? 1 : -1;
  const s1 = [...p]; s1[u] += du;
  const s2 = [...p]; s2[w] += dw;
  const cc = [...p]; cc[u] += du; cc[w] += dw;
  const a = occ(s1[0], s1[1], s1[2]) ? 1 : 0;
  const b = occ(s2[0], s2[1], s2[2]) ? 1 : 0;
  const c = occ(cc[0], cc[1], cc[2]) ? 1 : 0;
  if (a && b) return 0;
  return (3 - (a + b + c)) / 3;
}

// 共享材质:顶点色 + Lambert,全部体素模型复用,保证 draw call 状态一致。
let sharedMaterial = null;
export function voxelMaterial() {
  if (!sharedMaterial) {
    sharedMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
  }
  return sharedMaterial;
}

/** 调色板工具:把颜色变亮/变暗,供模型作者派生同色系。 */
export function shade(hex, f) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(f);
  c.r = Math.min(1, c.r); c.g = Math.min(1, c.g); c.b = Math.min(1, c.b);
  return c.getHex();
}
