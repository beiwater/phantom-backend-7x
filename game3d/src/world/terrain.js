// 地形渲染:每格 2×2 个子体素,按地块合并为网格(仅顶面 + 高差侧面),未拥有地块压暗;水面为整图半透明平面(陆地顶面会遮住它)。
// 道具(树/岩石/矿脉)按地形实例化,地形变化(建筑清林)时重建。
import * as THREE from 'three';
import { MAP_W, MAP_H, CHUNK, T, OWNER } from './map.js';
import { voxelMaterial } from '../engine/voxel.js';
import { treeGeo, rockGeo, depositGeo } from '../models/cache.js';

const TOP = {
  [T.grass]: [0x8fcf62, 0x84c45a, 0x9ad66c],
  [T.forest]: [0x5fa846, 0x6ab14e],
  [T.rock]: [0xa4a49a, 0x96968e],
  [T.ore]: [0xb5764e, 0xa86a46],
  [T.coal]: [0x4a4a4e, 0x55555a],
  [T.oil]: [0x7a6a6a, 0x6e5e66],
  [T.water]: [0x3a7fb8, 0x3577ad],
  [T.sand]: [0xe6d39a, 0xdcc88e],
};

function hash(x, z) {
  let h = (x * 73856093) ^ (z * 19349663);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

export class TerrainView {
  constructor(scene, map) {
    this.map = map;
    this.scene = scene;
    // 每个地块一个合并网格:只生成顶面与高差处的侧面,并可按地块做视锥剔除
    this.tileMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.tileMeshes = [];
    for (let i = 0; i < (MAP_W / CHUNK) * (MAP_H / CHUNK); i++) {
      const m = new THREE.Mesh(new THREE.BufferGeometry(), this.tileMaterial);
      m.receiveShadow = true;
      scene.add(m);
      this.tileMeshes.push(m);
    }

    const base = this.base = new THREE.Mesh(
      new THREE.BoxGeometry(MAP_W + 0.6, 3, MAP_H + 0.6),
      new THREE.MeshLambertMaterial({ color: 0x6b4f36 }),
    );
    base.position.set(MAP_W / 2, -2.05, MAP_H / 2);
    scene.add(base);

    this.water = new THREE.Mesh(
      new THREE.PlaneGeometry(MAP_W, MAP_H),
      new THREE.MeshLambertMaterial({ color: 0x4aa0dc, transparent: true, opacity: 0.72 }),
    );
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.set(MAP_W / 2, -0.07, MAP_H / 2);
    scene.add(this.water);

    this.borders = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }));
    this.borders.position.y = 0.02;
    scene.add(this.borders);
    this.enemyBorders = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xff5040, transparent: true, opacity: 0.8 }));
    this.enemyBorders.position.y = 0.02;
    scene.add(this.enemyBorders);

    this.props = new THREE.Group();
    scene.add(this.props);
    this.rebuild();
  }

  rebuild() {
    this.rebuildTiles();
    this.rebuildProps();
    this.rebuildBorders();
  }

  /** 子体素格(半格)顶面高度与颜色。 */
  subTile(sx, sz) {
    const m = this.map;
    const x = sx >> 1;
    const z = sz >> 1;
    if (!m.inside(x, z)) return null;
    const t = m.terrain[m.idx(x, z)];
    const hv = hash(sx, sz);
    let top = 0;
    if (t === T.water) top = -0.28;
    else if (t === T.rock) top = hv > 0.5 ? 1 / 16 : 0;
    else if (t === T.grass && hv > 0.85) top = 1 / 32;
    return { t, hv, top, owner: m.ownerAt(x, z) };
  }

  rebuildTiles() {
    const col = new THREE.Color();
    const grey = new THREE.Color(0x9a9a92);
    const enemyTint = new THREE.Color(0x8a5a50);
    const BOTTOM = -0.6;
    const per = CHUNK * 2;
    const cxN = MAP_W / CHUNK;
    for (let ci = 0; ci < this.tileMeshes.length; ci++) {
      const cx = ci % cxN;
      const cz = Math.floor(ci / cxN);
      const pos = [];
      const nor = [];
      const cols = [];
      const quad = (a, b, c, d, n, color, shade) => {
        for (const v of [a, b, c, a, c, d]) pos.push(...v);
        for (let i = 0; i < 6; i++) { nor.push(...n); cols.push(color.r * shade, color.g * shade, color.b * shade); }
      };
      for (let lz = 0; lz < per; lz++) {
        for (let lx = 0; lx < per; lx++) {
          const sx = cx * per + lx;
          const sz = cz * per + lz;
          const st = this.subTile(sx, sz);
          const palette = TOP[st.t];
          col.setHex(palette[Math.floor(st.hv * palette.length)]);
          col.multiplyScalar(0.94 + st.hv * 0.1);
          if (st.owner === OWNER.none) col.lerp(grey, 0.42).multiplyScalar(0.82);
          else if (st.owner === OWNER.enemy) col.lerp(enemyTint, 0.25);
          const x0 = sx * 0.5;
          const z0 = sz * 0.5;
          const x1 = x0 + 0.5;
          const z1 = z0 + 0.5;
          const y = st.top;
          quad([x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0], [0, 1, 0], col, 1);
          // 侧面:相邻子格更低(或地图边缘)时才需要
          const side = (nx, nz, a, b, n) => {
            const nb = this.subTile(nx, nz);
            const low = nb ? nb.top : BOTTOM;
            if (low >= y - 1e-6) return;
            quad([a[0], y, a[1]], [a[0], low, a[1]], [b[0], low, b[1]], [b[0], y, b[1]], n, col, 0.82);
          };
          side(sx, sz - 1, [x1, z0], [x0, z0], [0, 0, -1]);
          side(sx, sz + 1, [x0, z1], [x1, z1], [0, 0, 1]);
          side(sx - 1, sz, [x0, z0], [x0, z1], [-1, 0, 0]);
          side(sx + 1, sz, [x1, z1], [x1, z0], [1, 0, 0]);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
      geo.computeBoundingSphere();
      this.tileMeshes[ci].geometry.dispose();
      this.tileMeshes[ci].geometry = geo;
    }
  }

  rebuildProps() {
    for (const c of [...this.props.children]) {
      this.props.remove(c);
      c.dispose?.();
    }
    const m = this.map;
    const buckets = new Map();
    // 按 (地块, 模型) 分桶:每个 InstancedMesh 包围球紧凑,主视图与阴影都能剔除视野外的树
    const add = (kind, geoFn, x, z, rot, scale = 1) => {
      const key = `${kind}@${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
      if (!buckets.has(key)) buckets.set(key, { geoFn, list: [] });
      buckets.get(key).list.push([x, z, rot, scale]);
    };
    for (let z = 0; z < MAP_H; z++) {
      for (let x = 0; x < MAP_W; x++) {
        const i = m.idx(x, z);
        if (m.building[i] || m.road[i]) continue;
        const t = m.terrain[i];
        const h = hash(x + 911, z + 37);
        const rot = Math.floor(h * 4) * (Math.PI / 2);
        if (t === T.forest) {
          const v = Math.floor(h * 3.999);
          add(`tree${v}`, () => treeGeo(v), x + 0.5, z + 0.5, rot, 0.85 + h * 0.3);
        } else if (t === T.rock && h > 0.35) {
          const v = Math.floor(h * 2.999);
          add(`rock${v}`, () => rockGeo(v), x + 0.5, z + 0.5, rot);
        } else if (t === T.ore || t === T.coal || t === T.oil) {
          const kind = t === T.ore ? 'ore' : t === T.coal ? 'coal' : 'oil';
          add(kind, () => depositGeo(kind), x + 0.5, z + 0.5, rot);
        } else if (t === T.grass && h > 0.985) {
          add('tree3', () => treeGeo(3), x + 0.5, z + 0.5, rot, 0.8);
        }
      }
    }
    const mat = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    for (const { geoFn, list } of buckets.values()) {
      const inst = new THREE.InstancedMesh(geoFn(), voxelMaterial(), list.length);
      inst.castShadow = true;
      inst.receiveShadow = true;
      list.forEach(([x, z, rot, s], k) => {
        q.setFromAxisAngle(up, rot);
        mat.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(s, s, s));
        inst.setMatrixAt(k, mat);
      });
      inst.computeBoundingSphere();
      this.props.add(inst);
    }
  }

  /** 领地边界线:相邻地块归属不同处画线。 */
  rebuildBorders() {
    const m = this.map;
    const pts = [];
    const ept = [];
    const cx = MAP_W / CHUNK;
    const cz = MAP_H / CHUNK;
    const own = (x, z) => (x < 0 || z < 0 || x >= cx || z >= cz ? -1 : m.chunkOwnerAt(x, z));
    for (let z = 0; z < cz; z++) {
      for (let x = 0; x < cx; x++) {
        const o = own(x, z);
        if (o === OWNER.none) continue;
        const arr = o === OWNER.player ? pts : ept;
        const x0 = x * CHUNK;
        const z0 = z * CHUNK;
        if (own(x, z - 1) !== o) arr.push(x0, 0, z0, x0 + CHUNK, 0, z0);
        if (own(x, z + 1) !== o) arr.push(x0, 0, z0 + CHUNK, x0 + CHUNK, 0, z0 + CHUNK);
        if (own(x - 1, z) !== o) arr.push(x0, 0, z0, x0, 0, z0 + CHUNK);
        if (own(x + 1, z) !== o) arr.push(x0 + CHUNK, 0, z0, x0 + CHUNK, 0, z0 + CHUNK);
      }
    }
    this.borders.geometry.dispose();
    this.borders.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.enemyBorders.geometry.dispose();
    this.enemyBorders.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(ept, 3));
  }

  update(t) {
    this.water.material.opacity = 0.68 + Math.sin(t * 1.3) * 0.05;
  }
}
