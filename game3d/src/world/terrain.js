// 地形渲染:每格 2×2 个子体素柱(InstancedMesh),未拥有地块压暗;水面为整图半透明平面(陆地顶面会遮住它)。
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
    const count = MAP_W * MAP_H * 4;
    const box = new THREE.BoxGeometry(0.5, 1, 0.5);
    box.translate(0, -0.5, 0);
    this.tiles = new THREE.InstancedMesh(box, new THREE.MeshLambertMaterial(), count);
    this.tiles.receiveShadow = true;
    this.tiles.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    scene.add(this.tiles);

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

  rebuildTiles() {
    const m = this.map;
    const mat = new THREE.Matrix4();
    const col = new THREE.Color();
    const grey = new THREE.Color(0x9a9a92);
    let n = 0;
    for (let z = 0; z < MAP_H; z++) {
      for (let x = 0; x < MAP_W; x++) {
        const t = m.terrain[m.idx(x, z)];
        const owner = m.ownerAt(x, z);
        for (let s = 0; s < 4; s++) {
          const sx = x + 0.25 + (s & 1) * 0.5;
          const sz = z + 0.25 + (s >> 1) * 0.5;
          const hv = hash(x * 2 + (s & 1), z * 2 + (s >> 1));
          const palette = TOP[t];
          col.setHex(palette[Math.floor(hv * palette.length)]);
          col.multiplyScalar(0.94 + hv * 0.1);
          let top = 0;
          let h = 0.6;
          if (t === T.water) { top = -0.28; h = 0.32; }
          else if (t === T.rock) top = hv > 0.5 ? 1 / 16 : 0;
          else if (t === T.grass && hv > 0.85) top = 1 / 32;
          if (owner === OWNER.none) col.lerp(grey, 0.42).multiplyScalar(0.82);
          else if (owner === OWNER.enemy) col.lerp(new THREE.Color(0x8a5a50), 0.25);
          mat.makeScale(1, h, 1);
          mat.setPosition(sx, top, sz);
          this.tiles.setMatrixAt(n, mat);
          this.tiles.setColorAt(n, col);
          n++;
        }
      }
    }
    this.tiles.instanceMatrix.needsUpdate = true;
    this.tiles.instanceColor.needsUpdate = true;
  }

  rebuildProps() {
    for (const c of [...this.props.children]) {
      this.props.remove(c);
      c.dispose?.();
    }
    const m = this.map;
    const buckets = new Map();
    const add = (key, geoFn, x, z, rot, scale = 1) => {
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
