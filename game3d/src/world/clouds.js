// 体素云:随风缓慢漂移并投下阴影,雨天更多更暗。纯视觉。
import * as THREE from 'three';
import { VoxelModel } from '../engine/voxel.js';
import { MAP_W, MAP_H } from './map.js';
import { mulberry32 } from '../engine/util.js';

const COUNT = 12;
const WIND = { x: 0.35, z: 0.12 };

function cloudGeo(seed) {
  const rnd = mulberry32(seed);
  const m = new VoxelModel();
  const blobs = 3 + Math.floor(rnd() * 3);
  for (let i = 0; i < blobs; i++) {
    const cx = 8 + rnd() * 16;
    const cz = 6 + rnd() * 8;
    const r = 3 + rnd() * 3;
    m.sphere(cx, 2, cz, r, 0xffffff);
  }
  // 压扁底部,形成平底积云
  for (const v of [...m.voxels.values()]) if (v.y > 4) m.remove(v.x, v.y, v.z);
  return m.toGeometry({ footW: 4, footD: 2.5, jitter: 0.03, scale: 1 / 4 });
}

export class Clouds {
  constructor(scene, game, rig) {
    this.game = game;
    this.rig = rig;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.88 });
    const geos = [1, 2, 3, 4].map(cloudGeo);
    const rnd = mulberry32(99);
    this.items = [];
    for (let i = 0; i < COUNT; i++) {
      const mesh = new THREE.Mesh(geos[i % geos.length], this.mat);
      mesh.castShadow = true;
      mesh.position.set(rnd() * (MAP_W + 20) - 10, 9 + rnd() * 3, rnd() * (MAP_H + 20) - 10);
      mesh.rotation.y = rnd() * Math.PI;
      this.group.add(mesh);
      this.items.push({ mesh, rain: i >= COUNT * 0.6 });
    }
  }

  update(dt) {
    const w = this.game.weather?.id ?? 'clear';
    const wet = w === 'rain' || w === 'storm';
    const k = this.game.paused ? 0 : dt * this.game.speed;
    for (const it of this.items) {
      const p = it.mesh.position;
      p.x += WIND.x * k;
      p.z += WIND.z * k;
      if (p.x > MAP_W + 12) p.x = -12;
      if (p.z > MAP_H + 12) p.z = -12;
      it.mesh.visible = !it.rain || wet || w === 'fog';
    }
    const target = wet ? 0.55 : 1;
    this.mat.color.setScalar(this.mat.color.r + (target - this.mat.color.r) * Math.min(1, dt));
    // 拉近镜头时云层淡出,避免遮挡城市细节
    const fade = Math.min(1, Math.max(0, (this.rig.view - 7) / 10));
    this.mat.opacity = 0.15 + 0.6 * fade;
  }
}
