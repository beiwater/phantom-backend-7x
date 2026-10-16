// RTS 镜头:正交等距视角。WASD/方向键平移,滚轮缩放(朝光标),Q/E 旋转 90°,中键/空格+左键拖动平移。
import * as THREE from 'three';
import { clamp } from './util.js';

const PITCH = 0.62; // ≈35.5°,接近经典等距

export class CameraRig {
  constructor(dom, bounds) {
    this.dom = dom;
    this.bounds = bounds; // { minX, maxX, minZ, maxZ }
    this.camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 400);
    this.target = new THREE.Vector3(0, 0, 0);
    this.yaw = Math.PI / 4;
    this.yawGoal = this.yaw;
    this.view = 14; // 半高(世界单位)
    this.viewGoal = this.view;
    this.keys = new Set();
    this.drag = null;
    this.raycaster = new THREE.Raycaster();
    this.ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.bind();
    this.resize();
  }

  bind() {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      this.keys.add(e.code);
      if (e.code === 'KeyQ') this.yawGoal += Math.PI / 2;
      if (e.code === 'KeyE') this.yawGoal -= Math.PI / 2;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    this.dom.addEventListener('wheel', (e) => {
      e.preventDefault();
      const before = this.groundAt(e.clientX, e.clientY);
      this.viewGoal = clamp(this.viewGoal * (e.deltaY > 0 ? 1.12 : 1 / 1.12), 4, 36);
      this.zoomAnchor = before;
    }, { passive: false });
    this.dom.addEventListener('pointerdown', (e) => {
      if (e.button === 1 || (e.button === 0 && this.keys.has('Space'))) {
        e.preventDefault();
        this.drag = { x: e.clientX, y: e.clientY };
        this.dom.setPointerCapture(e.pointerId);
      }
    });
    this.dom.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      const dx = e.clientX - this.drag.x;
      const dy = e.clientY - this.drag.y;
      this.drag = { x: e.clientX, y: e.clientY };
      const k = (this.view * 2) / this.dom.clientHeight;
      this.panScreen(-dx * k, -dy * k / Math.sin(PITCH));
    });
    const end = () => { this.drag = null; };
    this.dom.addEventListener('pointerup', end);
    this.dom.addEventListener('pointercancel', end);
    window.addEventListener('resize', () => this.resize());
  }

  get dragging() { return !!this.drag; }

  resize() {
    const w = this.dom.clientWidth;
    const h = this.dom.clientHeight;
    this.aspect = w / Math.max(1, h);
    this.applyProjection();
  }

  applyProjection() {
    const c = this.camera;
    c.top = this.view; c.bottom = -this.view;
    c.left = -this.view * this.aspect; c.right = this.view * this.aspect;
    c.updateProjectionMatrix();
  }

  /** 屏幕方向平移:dx 向右,dz 向下(远离镜头为负)。 */
  panScreen(dx, dz) {
    const cos = Math.cos(this.yaw);
    const sin = Math.sin(this.yaw);
    // 镜头位于 target + (sin, *, cos) 方向;屏幕右 = (cos, 0, -sin),屏幕下 = (sin, 0, cos)
    this.target.x += dx * cos + dz * sin;
    this.target.z += -dx * sin + dz * cos;
    this.clampTarget();
  }

  clampTarget() {
    const b = this.bounds;
    this.target.x = clamp(this.target.x, b.minX, b.maxX);
    this.target.z = clamp(this.target.z, b.minZ, b.maxZ);
  }

  lookAt(x, z) {
    this.target.set(x, 0, z);
    this.clampTarget();
  }

  update(dt) {
    const speed = this.view * 1.4 * dt;
    let dx = 0;
    let dz = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) dz -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) dz += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) dx -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) dx += 1;
    if (dx || dz) this.panScreen(dx * speed, dz * speed);

    const k = 1 - Math.exp(-dt * 10);
    this.yaw += (this.yawGoal - this.yaw) * k;
    const prevView = this.view;
    this.view += (this.viewGoal - this.view) * k;
    if (this.zoomAnchor && Math.abs(prevView - this.view) > 1e-4) {
      // 以光标处地面为锚点缩放
      const f = 1 - this.view / prevView;
      this.target.x += (this.zoomAnchor.x - this.target.x) * f;
      this.target.z += (this.zoomAnchor.z - this.target.z) * f;
      this.clampTarget();
    }
    this.applyProjection();

    const dist = 80;
    const c = this.camera;
    c.position.set(
      this.target.x + Math.sin(this.yaw) * Math.cos(PITCH) * dist,
      this.target.y + Math.sin(PITCH) * dist,
      this.target.z + Math.cos(this.yaw) * Math.cos(PITCH) * dist,
    );
    c.lookAt(this.target);
    c.updateMatrixWorld();
  }

  ndc(clientX, clientY) {
    const r = this.dom.getBoundingClientRect();
    return new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  }

  /** 屏幕坐标 → 地面 (y=0) 世界坐标。 */
  groundAt(clientX, clientY) {
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.camera);
    const p = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.ground, p) ? p : null;
  }

  /** 世界坐标 → 屏幕像素(相对容器)。 */
  toScreen(v) {
    const p = v.clone().project(this.camera);
    return { x: (p.x + 1) / 2 * this.dom.clientWidth, y: (1 - p.y) / 2 * this.dom.clientHeight, visible: p.z < 1 && p.z > -1 };
  }
}
