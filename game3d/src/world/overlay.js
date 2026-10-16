// 数据叠加层(城市规划视图):污染范围 / 物流连通。64×64 DataTexture 贴在地面上方,纯视觉。
import * as THREE from 'three';
import { MAP_W, MAP_H, OWNER } from './map.js';
import { POLLUTERS } from '../sim/society.js';

export const OVERLAYS = [null, 'pollution', 'logistics'];
export const OVERLAY_NAMES = { pollution: '🏭 污染范围', logistics: '🛣️ 物流连通' };

export class Overlay {
  constructor(scene, game, economy) {
    this.game = game;
    this.economy = economy;
    this.mode = null;
    this.data = new Uint8Array(MAP_W * MAP_H * 4);
    this.tex = new THREE.DataTexture(this.data, MAP_W, MAP_H, THREE.RGBAFormat);
    this.tex.magFilter = THREE.NearestFilter;
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(MAP_W, MAP_H),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false }),
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(MAP_W / 2, 0.035, MAP_H / 2);
    plane.renderOrder = 2;
    plane.visible = false;
    // PlaneGeometry 旋转后 v 轴朝 -z,翻转纹理行使第 z 行对应世界 z
    this.tex.flipY = true;
    scene.add(plane);
    this.plane = plane;
    this.t = 0;
  }

  cycle() {
    const i = OVERLAYS.indexOf(this.mode);
    this.mode = OVERLAYS[(i + 1) % OVERLAYS.length];
    this.plane.visible = !!this.mode;
    this.t = 0;
    return this.mode;
  }

  paint(i, r, g, b, a) {
    const k = i * 4;
    this.data[k] = r; this.data[k + 1] = g; this.data[k + 2] = b; this.data[k + 3] = a;
  }

  update(dt) {
    if (!this.mode) return;
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.5;
    this.data.fill(0);
    const g = this.game;
    const m = g.map;
    if (this.mode === 'pollution') {
      const heat = new Uint8Array(MAP_W * MAP_H);
      for (const b of g.buildings.values()) {
        if (b.team !== g.localPlayer || !POLLUTERS.has(b.type) || b.module === 'eco' || b.state === 'construct') continue;
        for (let z = b.z - 3; z < b.z + b.d + 3; z++) {
          for (let x = b.x - 3; x < b.x + b.w + 3; x++) if (m.inside(x, z)) heat[m.idx(x, z)]++;
        }
      }
      for (let i = 0; i < heat.length; i++) if (heat[i]) this.paint(i, 230, 60, 40, Math.min(200, 70 + heat[i] * 45));
      for (const b of g.buildings.values()) {
        if (b.team !== g.localPlayer || b.type !== 'house') continue;
        const i = m.idx(b.x, b.z);
        this.paint(i, heat[i] ? 255 : 80, heat[i] ? 200 : 220, 60, 230);
      }
    } else if (this.mode === 'logistics') {
      const dist = this.economy.roadDist;
      for (let i = 0; i < dist.length; i++) {
        if (m.road[i]) this.paint(i, dist[i] >= 0 ? 60 : 240, dist[i] >= 0 ? 220 : 70, 80, 200);
      }
      for (const b of g.buildings.values()) {
        if (b.team !== g.localPlayer || b.type === 'wall' || b.type === 'turret' || b.type === 'house') continue;
        for (let z = b.z; z < b.z + b.d; z++) {
          for (let x = b.x; x < b.x + b.w; x++) this.paint(m.idx(x, z), b.connected ? 60 : 240, b.connected ? 160 : 60, b.connected ? 255 : 60, 120);
        }
      }
      for (let i = 0; i < dist.length; i++) {
        const x = i % MAP_W;
        const z = (i - x) / MAP_W;
        if (m.ownerAt(x, z) !== OWNER.player && !this.data[i * 4 + 3]) this.paint(i, 0, 0, 0, 60);
      }
    }
    this.tex.needsUpdate = true;
  }
}
