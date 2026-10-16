// 战斗特效:全部池化(InstancedMesh / 定长 LineSegments),每帧只写矩阵,150 单位混战下保持 60fps。
// 发光体(炮口焰、弹丸)、曳光弹、体素碎片爆炸(重力 + 缩小淡出)、移动/攻击标记。
import * as THREE from 'three';

const GLOW_MAX = 500;
const DEBRIS_MAX = 1800;
const TRACER_MAX = 240;
const MARKERS = 8;

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const v = new THREE.Vector3();
const s = new THREE.Vector3();
const axis = new THREE.Vector3();
const col = new THREE.Color();

export class Effects {
  constructor(scene) {
    this.root = new THREE.Group();
    scene.add(this.root);
    const cube = new THREE.BoxGeometry(1, 1, 1);

    this.glowMesh = new THREE.InstancedMesh(cube, new THREE.MeshBasicMaterial({ toneMapped: false }), GLOW_MAX);
    this.glowMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(GLOW_MAX * 3), 3);
    this.glowMesh.frustumCulled = false;
    this.glowMesh.count = 0;
    this.glows = [];

    this.debrisMesh = new THREE.InstancedMesh(cube, new THREE.MeshLambertMaterial(), DEBRIS_MAX);
    this.debrisMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(DEBRIS_MAX * 3), 3);
    this.debrisMesh.frustumCulled = false;
    this.debrisMesh.count = 0;
    this.debris = [];

    const tg = new THREE.BufferGeometry();
    this.tPos = new Float32Array(TRACER_MAX * 6);
    this.tCol = new Float32Array(TRACER_MAX * 6);
    tg.setAttribute('position', new THREE.BufferAttribute(this.tPos, 3).setUsage(THREE.DynamicDrawUsage));
    tg.setAttribute('color', new THREE.BufferAttribute(this.tCol, 3).setUsage(THREE.DynamicDrawUsage));
    tg.setDrawRange(0, 0);
    this.tracerMesh = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }));
    this.tracerMesh.frustumCulled = false;
    this.tracers = [];

    const ring = new THREE.RingGeometry(0.32, 0.42, 24).rotateX(-Math.PI / 2);
    this.markers = Array.from({ length: MARKERS }, () => {
      const mesh = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
      mesh.visible = false;
      mesh.renderOrder = 5;
      this.root.add(mesh);
      return { mesh, life: 0 };
    });
    this.markerNext = 0;
    this.root.add(this.glowMesh, this.debrisMesh, this.tracerMesh);
  }

  // ---------- 发射接口 ----------
  flash(x, y, z, size, color) {
    if (this.glows.length >= GLOW_MAX) return;
    this.glows.push({ kind: 0, x, y, z, size, color, life: 0, max: 0.07 + size * 0.06 });
  }

  /** 弹丸:dur 秒从 a 飞到 b;arc>0 时走抛物线(火炮)。 */
  projectile(a, b, dur, arc, color, size = 0.1) {
    if (this.glows.length >= GLOW_MAX) return;
    this.glows.push({ kind: 1, ax: a.x, ay: a.y, az: a.z, bx: b.x, by: b.y, bz: b.z, arc, size, color, life: 0, max: dur });
  }

  tracer(a, b, color) {
    if (this.tracers.length >= TRACER_MAX) this.tracers.shift();
    this.tracers.push({ a: { ...a }, b: { ...b }, color, life: 0, max: 0.08 });
  }

  /** 体素碎片爆炸:n 块,colors 随机取色,power 控制初速。 */
  explode(x, y, z, n, colors, power = 3, spread = 0.3) {
    for (let i = 0; i < n; i++) {
      if (this.debris.length >= DEBRIS_MAX) this.debris.shift();
      const a = Math.random() * Math.PI * 2;
      const sp = power * (0.35 + Math.random() * 0.65);
      this.debris.push({
        x: x + (Math.random() - 0.5) * spread, y: y + Math.random() * 0.2, z: z + (Math.random() - 0.5) * spread,
        vx: Math.cos(a) * sp * 0.6, vy: sp * (0.6 + Math.random() * 0.8), vz: Math.sin(a) * sp * 0.6,
        size: 0.05 + Math.random() * 0.09, rot: Math.random() * 6, spin: (Math.random() - 0.5) * 12,
        color: colors[(Math.random() * colors.length) | 0], life: 0, max: 0.9 + Math.random() * 0.8,
      });
    }
  }

  /** 小股尘土(命中点)。 */
  puff(x, y, z, n, color) {
    this.explode(x, y, z, n, [color, 0x9a8a70], 1.2, 0.15);
  }

  marker(x, z, color) {
    const mk = this.markers[this.markerNext++ % MARKERS];
    mk.mesh.material.color.set(color);
    mk.mesh.position.set(x, 0.06, z);
    mk.mesh.visible = true;
    mk.life = 0.7;
  }

  // ---------- 每帧 ----------
  update(dt, edt) {
    this.updateGlows(edt);
    this.updateDebris(edt);
    this.updateTracers(edt);
    for (const mk of this.markers) {
      if (!mk.visible && mk.life <= 0) continue;
      mk.life -= dt;
      if (mk.life <= 0) { mk.mesh.visible = false; continue; }
      const k = mk.life / 0.7;
      mk.mesh.scale.setScalar(0.4 + k * 0.9);
      mk.mesh.material.opacity = Math.min(1, k * 1.6);
    }
  }

  updateGlows(edt) {
    let n = 0;
    const out = [];
    q.identity();
    for (const g of this.glows) {
      g.life += edt;
      if (g.life >= g.max) continue;
      out.push(g);
      const k = g.life / g.max;
      if (g.kind === 0) {
        const sz = g.size * (1 - k * 0.7);
        v.set(g.x, g.y, g.z);
        s.set(sz, sz, sz);
      } else {
        v.set(g.ax + (g.bx - g.ax) * k, g.ay + (g.by - g.ay) * k + g.arc * 4 * k * (1 - k), g.az + (g.bz - g.az) * k);
        s.set(g.size, g.size, g.size);
      }
      m4.compose(v, q, s);
      this.glowMesh.setMatrixAt(n, m4);
      this.glowMesh.setColorAt(n, col.set(g.color));
      n++;
    }
    this.glows = out;
    this.glowMesh.count = n;
    this.glowMesh.instanceMatrix.needsUpdate = true;
    if (n) this.glowMesh.instanceColor.needsUpdate = true;
  }

  updateDebris(edt) {
    let n = 0;
    const out = [];
    for (const p of this.debris) {
      p.life += edt;
      if (p.life >= p.max) continue;
      out.push(p);
      p.vy -= 9.8 * edt;
      p.x += p.vx * edt;
      p.y += p.vy * edt;
      p.z += p.vz * edt;
      if (p.y < p.size / 2) {
        // 落地反弹并摩擦减速
        p.y = p.size / 2;
        p.vy = Math.abs(p.vy) * 0.3;
        p.vx *= 0.6;
        p.vz *= 0.6;
        p.spin *= 0.6;
      }
      p.rot += p.spin * edt;
      const k = p.life / p.max;
      const sz = p.size * (k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3);
      axis.set(0.6, 1, 0.3).normalize();
      q.setFromAxisAngle(axis, p.rot);
      v.set(p.x, p.y, p.z);
      s.set(sz, sz, sz);
      m4.compose(v, q, s);
      this.debrisMesh.setMatrixAt(n, m4);
      this.debrisMesh.setColorAt(n, col.set(p.color));
      n++;
    }
    this.debris = out;
    this.debrisMesh.count = n;
    this.debrisMesh.instanceMatrix.needsUpdate = true;
    if (n) this.debrisMesh.instanceColor.needsUpdate = true;
  }

  updateTracers(edt) {
    this.tracers = this.tracers.filter((t) => (t.life += edt) < t.max);
    let n = 0;
    for (const t of this.tracers) {
      const fade = 1 - t.life / t.max;
      col.set(t.color).multiplyScalar(fade);
      const o = n * 6;
      this.tPos[o] = t.a.x; this.tPos[o + 1] = t.a.y; this.tPos[o + 2] = t.a.z;
      this.tPos[o + 3] = t.b.x; this.tPos[o + 4] = t.b.y; this.tPos[o + 5] = t.b.z;
      this.tCol[o] = col.r * 0.4; this.tCol[o + 1] = col.g * 0.4; this.tCol[o + 2] = col.b * 0.4;
      this.tCol[o + 3] = col.r; this.tCol[o + 4] = col.g; this.tCol[o + 5] = col.b;
      n++;
    }
    const geo = this.tracerMesh.geometry;
    geo.setDrawRange(0, n * 2);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  }
}
