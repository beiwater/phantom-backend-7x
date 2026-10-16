// 单位可视化:每单位一个 Group(车身 + 可转动的炮塔/旋翼),选中圈与血条用 InstancedMesh 批量绘制。
// 模拟以固定 20Hz 步进,渲染端用指数平滑把网格追向模拟位置,避免逐 tick 跳动。
import * as THREE from 'three';
import { unitGeos } from '../models/cache.js';
import { voxelMaterial } from '../engine/voxel.js';
import { AIR_Y } from './units.js';

const RING_MAX = 200;
const BAR_MAX = 400;
const TOP_AIM = new Set(['tank', 'artillery']);

const m4 = new THREE.Matrix4();
const pos = new THREE.Vector3();
const scl = new THREE.Vector3();
const qId = new THREE.Quaternion();
const right = new THREE.Vector3();
const col = new THREE.Color();

function lerpAngle(a, b, k) {
  let d = b - a;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return a + d * k;
}

export class UnitViews {
  constructor(rts, scene) {
    this.rts = rts;
    this.root = new THREE.Group();
    scene.add(this.root);
    /** @type {Map<number, object>} */
    this.views = new Map();
    this.t = 0;

    const ringGeo = new THREE.RingGeometry(0.82, 1, 28).rotateX(-Math.PI / 2);
    this.rings = new THREE.InstancedMesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.9, depthWrite: false }), RING_MAX);
    this.rings.frustumCulled = false;
    this.rings.count = 0;
    this.rings.renderOrder = 3;

    const plane = new THREE.PlaneGeometry(1, 1);
    const barMat = () => new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false, transparent: true, toneMapped: false });
    this.barBg = new THREE.InstancedMesh(plane, barMat(), BAR_MAX);
    this.barFg = new THREE.InstancedMesh(plane, barMat(), BAR_MAX);
    this.barBg.material.color.set(0x15181c);
    this.barBg.material.opacity = 0.75;
    this.barFg.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(BAR_MAX * 3), 3);
    for (const b of [this.barBg, this.barFg]) { b.frustumCulled = false; b.count = 0; }
    this.barBg.renderOrder = 10;
    this.barFg.renderOrder = 11;

    // 集结点旗标(选中可训练建筑时显示)
    this.rally = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.9, 0.05), new THREE.MeshBasicMaterial({ color: 0xe8eef8 }));
    pole.position.y = 0.45;
    const flag = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.2, 0.03), new THREE.MeshBasicMaterial({ color: 0x55ff77 }));
    flag.position.set(0.17, 0.78, 0);
    const pad = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.3, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x55ff77, transparent: true, opacity: 0.8, depthWrite: false }));
    pad.position.y = 0.05;
    this.rally.add(pole, flag, pad);
    this.rally.visible = false;
    this.rallyLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineDashedMaterial({ color: 0x55ff77, dashSize: 0.25, gapSize: 0.15 }));
    this.rallyLine.visible = false;
    this.rallyLine.frustumCulled = false;

    this.root.add(this.rings, this.barBg, this.barFg, this.rally, this.rallyLine);
  }

  add(u) {
    const geos = unitGeos(u.type, u.team);
    const group = new THREE.Group();
    const body = new THREE.Mesh(geos.body, voxelMaterial());
    body.castShadow = true;
    group.add(body);
    let top = null;
    if (geos.top) {
      top = new THREE.Mesh(geos.top, voxelMaterial());
      top.castShadow = true;
      top.position.y = geos.topY;
      body.add(top);
    }
    const y = u.air ? AIR_Y - geos.height * 0.5 : 0;
    group.position.set(u.x, y, u.z);
    body.rotation.y = u.heading;
    this.root.add(group);
    this.views.set(u.id, {
      group, body, top, height: geos.height, yaw: u.heading, topYaw: 0, phase: (u.id * 1.37) % 6.28,
      lx: u.x, lz: u.z, walk: 0,
    });
  }

  remove(u) {
    const v = this.views.get(u.id);
    if (!v) return;
    this.root.remove(v.group);
    this.views.delete(u.id);
  }

  clear() {
    for (const v of this.views.values()) this.root.remove(v.group);
    this.views.clear();
  }

  /** 单位视觉中心(拾取/血条/特效用)。 */
  visualPos(u, out) {
    const v = this.views.get(u.id);
    if (!v) return out.set(u.x, u.air ? AIR_Y : 0.3, u.z);
    return out.set(v.group.position.x, v.group.position.y + v.height * 0.5, v.group.position.z);
  }

  render(dt, camera) {
    const rts = this.rts;
    this.t += dt;
    const t = this.t;
    const kPos = 1 - Math.exp(-dt * 22);
    const kYaw = 1 - Math.exp(-dt * 9);
    const selected = new Set(rts.selected);
    let nr = 0;
    let nb = 0;
    right.set(1, 0, 0).applyQuaternion(camera.quaternion);

    for (const u of rts.units) {
      const v = this.views.get(u.id);
      if (!v) continue;
      const g = v.group;
      let x = g.position.x;
      let z = g.position.z;
      if (Math.hypot(u.x - x, u.z - z) > 2) { x = u.x; z = u.z; } // 读档/瞬移时直接对齐
      else { x += (u.x - x) * kPos; z += (u.z - z) * kPos; }
      const sp = dt > 0 ? Math.hypot(x - v.lx, z - v.lz) / dt : 0;
      v.walk += ((sp > 0.25 ? 1 : 0) - v.walk) * Math.min(1, dt * 8);
      v.lx = x;
      v.lz = z;
      let y = 0;
      if (u.air) {
        y = AIR_Y - v.height * 0.5 + Math.sin(t * 1.8 + v.phase) * 0.08;
        v.body.rotation.z = Math.sin(t * 1.3 + v.phase) * 0.05;
        if (v.top) v.top.rotation.y += dt * 28;
      } else if (u.type === 'tank' || u.type === 'artillery') {
        y = Math.sin(t * 18 + v.phase) * 0.012 * v.walk;
      } else {
        y = Math.abs(Math.sin(t * 11 + v.phase)) * 0.045 * v.walk;
      }
      // 开火后坐
      const since = rts.game.time - u.fireT;
      const kick = since >= 0 && since < 0.12 ? (1 - since / 0.12) * 0.05 : 0;
      v.yaw = lerpAngle(v.yaw, u.heading, kYaw);
      g.position.set(x - Math.sin(v.yaw) * kick, y, z - Math.cos(v.yaw) * kick);
      v.body.rotation.y = v.yaw;
      if (v.top && TOP_AIM.has(u.type)) {
        const want = u.aimYaw !== null && u.target ? u.aimYaw - v.yaw : 0;
        v.topYaw = lerpAngle(v.topYaw, want, Math.min(1, dt * 6));
        v.top.rotation.y = v.topYaw;
      }

      const sel = selected.has(u);
      if (sel && nr < RING_MAX) {
        const r = Math.max(0.3, u.r * 1.35);
        pos.set(x, 0.05, z);
        scl.set(r, 1, r);
        m4.compose(pos, qId, scl);
        this.rings.setMatrixAt(nr++, m4);
      }
      if ((sel || u.hp < u.maxHp) && nb < BAR_MAX) {
        nb = this.bar(nb, x, y + v.height + 0.22, z, Math.max(0.5, u.r * 2.2), u.hp / u.maxHp, camera);
      }
    }

    // 受损建筑血条
    for (const b of rts.game.buildings.values()) {
      if (b.hp >= b.maxHp || nb >= BAR_MAX) continue;
      const info = rts.view?.bviews?.get(b.uid)?.info;
      const h = b.type === 'wall' ? 1.1 : (info?.labelY ?? 1.4) + 0.1;
      nb = this.bar(nb, b.x + b.w / 2, h, b.z + b.d / 2, Math.min(2.4, 0.6 + b.w * 0.45), b.hp / b.maxHp, camera);
    }

    this.rings.count = nr;
    this.rings.instanceMatrix.needsUpdate = true;
    this.barBg.count = nb;
    this.barFg.count = nb;
    this.barBg.instanceMatrix.needsUpdate = true;
    this.barFg.instanceMatrix.needsUpdate = true;
    if (nb) this.barFg.instanceColor.needsUpdate = true;
    this.renderRally();
  }

  bar(n, x, y, z, w, frac, camera) {
    const h = 0.085;
    pos.set(x, y, z);
    scl.set(w + 0.04, h + 0.04, 1);
    m4.compose(pos, camera.quaternion, scl);
    this.barBg.setMatrixAt(n, m4);
    const f = Math.max(0, Math.min(1, frac));
    pos.addScaledVector(right, -(w - w * f) / 2);
    scl.set(Math.max(0.001, w * f), h, 1);
    m4.compose(pos, camera.quaternion, scl);
    this.barFg.setMatrixAt(n, m4);
    this.barFg.setColorAt(n, col.setHex(f > 0.6 ? 0x5ad65a : f > 0.3 ? 0xf0c040 : 0xe85040));
    return n + 1;
  }

  renderRally() {
    const b = this.rts.ui?.selection?.building;
    const show = !!(b && b.rally && b.team === this.rts.local && this.rts.game.buildings.has(b.uid));
    this.rally.visible = show;
    this.rallyLine.visible = show;
    if (!show) return;
    this.rally.position.set(b.rally.x, 0, b.rally.z);
    const p = this.rallyLine.geometry.attributes.position;
    p.setXYZ(0, b.x + b.w / 2, 0.08, b.z + b.d / 2);
    p.setXYZ(1, b.rally.x, 0.08, b.rally.z);
    p.needsUpdate = true;
    this.rallyLine.computeLineDistances();
  }
}
