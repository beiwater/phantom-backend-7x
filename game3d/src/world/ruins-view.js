// 遗迹可视化:未探索遗迹显示体素模型 + 缓慢上下浮动的光点;被探索后移除。
import * as THREE from 'three';
import { voxelMaterial } from '../engine/voxel.js';
import { buildRuinModel } from '../models/ruins.js';

export class RuinsView {
  constructor(scene, game) {
    this.game = game;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.geos = [0, 1].map((v) => buildRuinModel(v).toGeometry({ footW: 1, footD: 1 }));
    this.sparkGeo = new THREE.OctahedronGeometry(0.12);
    this.sparkMat = new THREE.MeshBasicMaterial({ color: 0xffe066 });
    this.meshes = new Map();
    this.sync();
    game.events.on('ruins:claim', () => this.sync());
  }

  sync() {
    for (const r of this.game.ruins.list) {
      const have = this.meshes.get(r.id);
      if (r.claimed && have) {
        this.group.remove(have);
        this.meshes.delete(r.id);
      } else if (!r.claimed && !have) {
        const g = new THREE.Group();
        const body = new THREE.Mesh(this.geos[r.id % 2], voxelMaterial());
        body.castShadow = true;
        body.receiveShadow = true;
        const spark = new THREE.Mesh(this.sparkGeo, this.sparkMat);
        spark.position.y = 1.1;
        g.add(body, spark);
        g.position.set(r.x + 0.5, 0, r.z + 0.5);
        g.userData.spark = spark;
        this.group.add(g);
        this.meshes.set(r.id, g);
      }
    }
  }

  update(t) {
    for (const [id, g] of this.meshes) {
      const s = g.userData.spark;
      s.position.y = 1.1 + Math.sin(t * 2 + id) * 0.12;
      s.rotation.y = t * 1.5;
      // 迷雾中的未探索区域只显示光点,提示可探索
      s.visible = true;
    }
  }
}
