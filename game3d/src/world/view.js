// 建筑/道路/城墙/工地/烟雾/物流卡车的可视化,订阅 Game 事件保持与状态同步。
import * as THREE from 'three';
import { MAP_W } from './map.js';
import { MODULES } from '../data/modules.js';
import { voxelMaterial } from '../engine/voxel.js';
import { buildingGeo, roadGeo, wallGeo, scaffoldGeo, turretHeadGeo, truckGeo, rubbleGeo } from '../models/cache.js';

const SMOKE_MAX = 400;
const TRUCK_MAX = 40;
const FIRE_MAX = 300;
const PIER_GEO = new THREE.BoxGeometry(0.12, 0.4, 0.5);
const PIER_MAT = new THREE.MeshLambertMaterial({ color: 0x8a8478 });

export class WorldView {
  constructor(scene, game, economy) {
    this.scene = scene;
    this.game = game;
    this.economy = economy;
    this.root = new THREE.Group();
    scene.add(this.root);
    /** @type {Map<number, {group: THREE.Group, mesh: THREE.Mesh, scaffold: THREE.Mesh|null, head: THREE.Mesh|null, info: object, key: string}>} */
    this.bviews = new Map();
    /** @type {Map<number, THREE.Mesh>} */
    this.roads = new Map();
    this.rubble = [];
    this.trucks = [];
    this.initSmoke();
    this.initFire();
    this.initSelection();

    const ev = game.events;
    ev.on('building:add', (b) => { this.addBuilding(b); this.refreshWalls(b); });
    ev.on('building:remove', ({ b, destroyed }) => { this.removeBuilding(b, destroyed); this.refreshWalls(b); });
    ev.on('building:change', (b) => this.syncBuilding(b));
    ev.on('road', ({ x, z }) => this.refreshRoadsAround(x, z));
    ev.on('produce', (p) => { if (!p.noTruck) this.spawnTruck(p.b); });
  }

  rebuildAll() {
    for (const v of this.bviews.values()) this.root.remove(v.group);
    this.bviews.clear();
    for (const r of this.roads.values()) this.root.remove(r);
    this.roads.clear();
    for (const b of this.game.buildings.values()) this.addBuilding(b);
    const m = this.game.map;
    for (let i = 0; i < m.road.length; i++) if (m.road[i]) this.refreshRoad(i % MAP_W, Math.floor(i / MAP_W));
  }

  // ---------- 建筑 ----------
  addBuilding(b) {
    const group = new THREE.Group();
    group.position.set(b.x + b.w / 2, 0, b.z + b.d / 2);
    const mesh = new THREE.Mesh(undefined, voxelMaterial());
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    const v = { group, mesh, scaffold: null, head: null, info: null, key: '' };
    group.userData.uid = b.uid;
    this.bviews.set(b.uid, v);
    this.root.add(group);
    this.syncBuilding(b);
  }

  geoKey(b) {
    if (b.type === 'wall') return `wall:${this.wallMask(b)}:${b.level}:${b.team}`;
    return `${b.type}:${b.level}:${b.team}`;
  }

  syncBuilding(b) {
    const v = this.bviews.get(b.uid);
    if (!v) return;
    const key = this.geoKey(b);
    if (key !== v.key) {
      v.key = key;
      if (b.type === 'wall') {
        v.mesh.geometry = wallGeo(this.wallMask(b), b.level, b.team);
        v.info = { smoke: [], labelY: 1.6 };
      } else {
        v.info = buildingGeo(b.type, b.level, b.team);
        v.mesh.geometry = v.info.geo;
      }
      if (b.type === 'turret') {
        if (v.head) v.group.remove(v.head);
        const h = turretHeadGeo(b.level, b.team);
        v.head = new THREE.Mesh(h.geo, voxelMaterial());
        v.head.castShadow = true;
        v.head.position.y = h.pivotY;
        v.group.add(v.head);
      }
    }
    this.syncModule(b, v);
    const building = b.state === 'construct' || b.state === 'upgrade';
    if (building && !v.scaffold) {
      v.scaffold = new THREE.Mesh(scaffoldGeo(b.w, b.d), voxelMaterial());
      v.scaffold.castShadow = true;
      v.group.add(v.scaffold);
    } else if (!building && v.scaffold) {
      v.group.remove(v.scaffold);
      v.scaffold = null;
      v.mesh.scale.y = 1;
      this.pop(v.group);
    }
  }

  /** 专精模块旗:占地右前角一根细旗杆 + 模块色旗面(不与建筑主体重叠)。 */
  syncModule(b, v) {
    if (v.moduleKey === b.module) return;
    v.moduleKey = b.module;
    if (v.flag) { v.group.remove(v.flag); v.flag = null; }
    if (!b.module) return;
    const flag = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.3, 0.05), new THREE.MeshLambertMaterial({ color: 0xdddddd }));
    pole.position.y = 0.65;
    const cloth = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.2, 0.03), new THREE.MeshLambertMaterial({ color: MODULES[b.module].color }));
    cloth.position.set(0.18, 1.18, 0);
    flag.add(pole, cloth);
    flag.position.set(b.w / 2 - 0.08, 0, b.d / 2 - 0.08);
    flag.traverse((o) => { o.castShadow = true; });
    v.flag = flag;
    v.group.add(flag);
  }

  removeBuilding(b, destroyed) {
    const v = this.bviews.get(b.uid);
    if (!v) return;
    this.root.remove(v.group);
    this.bviews.delete(b.uid);
    if (destroyed && b.type !== 'wall') {
      const r = new THREE.Mesh(rubbleGeo(b.w, b.d), voxelMaterial());
      r.position.copy(v.group.position);
      r.receiveShadow = true;
      this.root.add(r);
      this.rubble.push({ mesh: r, life: 25 });
    }
  }

  pop(group) {
    group.userData.pop = 0.35;
  }

  // ---------- 城墙自动拼接 ----------
  wallMask(b) {
    const g = this.game;
    const isWall = (x, z) => {
      const o = g.buildingAt(x, z);
      return o && o.type === 'wall' && o.team === b.team ? 1 : 0;
    };
    return isWall(b.x, b.z - 1) * 1 + isWall(b.x + 1, b.z) * 2 + isWall(b.x, b.z + 1) * 4 + isWall(b.x - 1, b.z) * 8;
  }

  refreshWalls(b) {
    if (b.type !== 'wall') return;
    for (const [dx, dz] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const o = this.game.buildingAt(b.x + dx, b.z + dz);
      if (o && o.type === 'wall') this.syncBuilding(o);
    }
  }

  // ---------- 道路自动拼接 ----------
  refreshRoadsAround(x, z) {
    for (const [dx, dz] of [[0, 0], [0, -1], [1, 0], [0, 1], [-1, 0]]) this.refreshRoad(x + dx, z + dz);
  }

  refreshRoad(x, z) {
    const m = this.game.map;
    if (!m.inside(x, z)) return;
    const i = m.idx(x, z);
    const existing = this.roads.get(i);
    if (!m.road[i]) {
      if (existing) { this.root.remove(existing); this.roads.delete(i); }
      return;
    }
    const geo = roadGeo(m.roadMask(x, z));
    if (existing) {
      existing.geometry = geo;
      return;
    }
    const mesh = new THREE.Mesh(geo, voxelMaterial());
    mesh.receiveShadow = true;
    mesh.position.set(x + 0.5, 0, z + 0.5);
    if (m.t(x, z) === 6) {
      // 桥墩:水面下的两根柱子
      for (const dx of [-0.3, 0.3]) {
        const pier = new THREE.Mesh(PIER_GEO, PIER_MAT);
        pier.position.set(dx, -0.2, 0);
        mesh.add(pier);
      }
    }
    this.root.add(mesh);
    this.roads.set(i, mesh);
  }

  // ---------- 烟雾粒子 ----------
  initSmoke() {
    const geo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
    this.smoke = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0xeeeeee, transparent: true, opacity: 0.8 }), SMOKE_MAX);
    this.smoke.count = 0;
    this.smoke.frustumCulled = false;
    this.root.add(this.smoke);
    this.smokeParts = [];
    this.smokeT = 0;
  }

  // ---------- 受损建筑起火(耐久 < 40%):橙色火苗 + 黑烟,纯视觉 ----------
  initFire() {
    const geo = new THREE.BoxGeometry(0.14, 0.14, 0.14);
    this.fire = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }), FIRE_MAX);
    this.fire.count = 0;
    this.fire.frustumCulled = false;
    this.fire.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(FIRE_MAX * 3), 3);
    this.root.add(this.fire);
    this.fireParts = [];
  }

  emitFire() {
    for (const [uid, v] of this.bviews) {
      const b = this.game.buildings.get(uid);
      if (!b || b.hp >= b.maxHp * 0.4 || b.type === 'wall') continue;
      const n = b.hp < b.maxHp * 0.2 ? 3 : 1;
      for (let i = 0; i < n && this.fireParts.length < FIRE_MAX; i++) {
        const flame = Math.random() < 0.45;
        this.fireParts.push({
          x: v.group.position.x + (Math.random() - 0.5) * b.w * 0.7,
          y: (v.info?.labelY ?? 1.5) * (0.35 + Math.random() * 0.3),
          z: v.group.position.z + (Math.random() - 0.5) * b.d * 0.7,
          life: 0, max: flame ? 0.6 : 2 + Math.random(), flame,
        });
      }
    }
  }

  updateFire(dt) {
    const mat = new THREE.Matrix4();
    const col = new THREE.Color();
    this.fireParts = this.fireParts.filter((p) => (p.life += dt) < p.max);
    let n = 0;
    for (const p of this.fireParts) {
      const k = p.life / p.max;
      const s = p.flame ? 1.1 - k : 0.8 + k * 2.4;
      mat.makeScale(s, s, s);
      mat.setPosition(p.x, p.y + p.life * (p.flame ? 0.9 : 0.6), p.z);
      this.fire.setMatrixAt(n, mat);
      if (p.flame) col.setHex(k < 0.5 ? 0xffd040 : 0xff6a20);
      else col.setRGB(0.18 + k * 0.25, 0.17 + k * 0.25, 0.17 + k * 0.25);
      this.fire.setColorAt(n, col);
      n++;
    }
    this.fire.count = n;
    this.fire.instanceMatrix.needsUpdate = true;
    this.fire.instanceColor.needsUpdate = true;
  }

  emitSmoke(dt) {
    this.smokeT += dt;
    if (this.smokeT < 0.18) return;
    this.smokeT = 0;
    this.emitFire();
    for (const [uid, v] of this.bviews) {
      const b = this.game.buildings.get(uid);
      if (!b || !b.working || b.state !== 'active' || !v.info?.smoke?.length) continue;
      for (const [sx, sy, sz] of v.info.smoke) {
        if (this.smokeParts.length >= SMOKE_MAX) return;
        this.smokeParts.push({
          x: v.group.position.x + sx + (Math.random() - 0.5) * 0.05,
          y: sy,
          z: v.group.position.z + sz + (Math.random() - 0.5) * 0.05,
          life: 0, max: 2.2 + Math.random(),
        });
      }
    }
  }

  updateSmoke(dt) {
    const mat = new THREE.Matrix4();
    const gdt = this.game.paused ? 0 : dt;
    this.emitSmoke(gdt);
    let n = 0;
    this.smokeParts = this.smokeParts.filter((p) => (p.life += gdt) < p.max);
    for (const p of this.smokeParts) {
      const k = p.life / p.max;
      const s = 0.6 + k * 2.2;
      mat.makeScale(s * (1 - k * 0.6), s * (1 - k * 0.6), s * (1 - k * 0.6));
      mat.setPosition(p.x + k * 0.6, p.y + p.life * 0.55, p.z - k * 0.3);
      this.smoke.setMatrixAt(n++, mat);
    }
    this.smoke.count = n;
    this.smoke.instanceMatrix.needsUpdate = true;
  }

  // ---------- 物流卡车 ----------
  spawnTruck(b) {
    if (this.trucks.length >= TRUCK_MAX) return;
    const path = this.economy.pathToHub(b);
    if (!path || path.length < 2) return;
    const mesh = new THREE.Mesh(truckGeo('player'), voxelMaterial());
    mesh.castShadow = true;
    this.root.add(mesh);
    this.trucks.push({ mesh, path, seg: 0, t: 0 });
  }

  updateTrucks(dt) {
    const gdt = this.game.paused ? 0 : dt * this.game.speed;
    this.trucks = this.trucks.filter((tr) => {
      tr.t += gdt * 3;
      while (tr.t >= 1 && tr.seg < tr.path.length - 1) { tr.t -= 1; tr.seg++; }
      if (tr.seg >= tr.path.length - 1) {
        this.root.remove(tr.mesh);
        return false;
      }
      const [ax, az] = tr.path[tr.seg];
      const [bx, bz] = tr.path[tr.seg + 1];
      // 靠右行驶:沿行进方向右侧偏移 0.18
      const dx = bx - ax;
      const dz = bz - az;
      const ox = -dz * 0.18;
      const oz = dx * 0.18;
      tr.mesh.position.set(ax + 0.5 + dx * tr.t + ox, 0.06, az + 0.5 + dz * tr.t + oz);
      tr.mesh.rotation.y = Math.atan2(dx, dz);
      return true;
    });
  }

  // ---------- 选中框 ----------
  initSelection() {
    this.selBox = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 0.05, 1)),
      new THREE.LineBasicMaterial({ color: 0xffe066 }),
    );
    this.selBox.visible = false;
    this.root.add(this.selBox);
  }

  showSelection(b) {
    if (!b) { this.selBox.visible = false; return; }
    this.selBox.visible = true;
    this.selBox.scale.set(b.w + 0.1, 1, b.d + 0.1);
    this.selBox.position.set(b.x + b.w / 2, 0.04, b.z + b.d / 2);
  }

  // ---------- 每帧 ----------
  update(dt) {
    for (const [uid, v] of this.bviews) {
      const b = this.game.buildings.get(uid);
      if (!b) continue;
      if (v.scaffold) {
        // 工地:建筑随进度自下而上「长」出来
        v.mesh.scale.y = b.state === 'construct' ? Math.max(0.04, b.progress) : 1;
      }
      const pop = v.group.userData.pop;
      if (pop > 0) {
        v.group.userData.pop = pop - dt;
        const s = 1 + Math.sin((pop / 0.35) * Math.PI) * 0.08;
        v.group.scale.set(s, s, s);
      } else if (v.group.scale.x !== 1) v.group.scale.set(1, 1, 1);
      if (v.head && !b.aim && b.state === 'active') v.head.rotation.y += dt * 0.3;
      if (v.head && b.aim !== undefined && b.aim !== null) v.head.rotation.y = b.aim;
    }
    this.rubble = this.rubble.filter((r) => {
      r.life -= dt;
      if (r.life <= 0) { this.root.remove(r.mesh); return false; }
      if (r.life < 2) r.mesh.position.y = -(2 - r.life) * 0.15;
      return true;
    });
    this.updateSmoke(dt);
    this.updateFire(this.game.paused ? 0 : dt);
    this.updateTrucks(dt);
  }
}
