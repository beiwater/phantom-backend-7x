// 天气视觉:镜头周围的雨线(InstancedMesh 循环下落)、雷暴闪电、雾天压暗。纯视觉。
import * as THREE from 'three';

const DROPS = 900;

export class WeatherView {
  constructor(scene, stage, game, rig) {
    this.stage = stage;
    this.game = game;
    this.rig = rig;
    this.rain = new THREE.InstancedMesh(new THREE.BoxGeometry(0.02, 0.45, 0.02), new THREE.MeshBasicMaterial({ color: 0xbcd4ff, transparent: true, opacity: 0.55 }), DROPS);
    this.rain.frustumCulled = false;
    this.rain.count = 0;
    scene.add(this.rain);
    this.drops = Array.from({ length: DROPS }, () => ({ x: Math.random(), y: Math.random() * 12, z: Math.random(), s: 9 + Math.random() * 4 }));
    this.flash = 0;
    this.m = new THREE.Matrix4();
  }

  update(dt) {
    const id = this.game.weather?.id ?? 'clear';
    const wet = id === 'rain' || id === 'storm';
    const n = wet ? (id === 'storm' ? DROPS : DROPS * 0.6) | 0 : 0;
    this.rain.count = n;
    if (n) {
      const span = this.rig.view * 3;
      const cx = this.rig.target.x;
      const cz = this.rig.target.z;
      for (let i = 0; i < n; i++) {
        const d = this.drops[i];
        d.y -= d.s * dt;
        if (d.y < 0) { d.y += 12; d.x = Math.random(); d.z = Math.random(); }
        this.m.makeTranslation(cx + (d.x - 0.5) * span, d.y, cz + (d.z - 0.5) * span);
        this.rain.setMatrixAt(i, this.m);
      }
      this.rain.instanceMatrix.needsUpdate = true;
    }
    // 雷暴:随机闪电提亮天光
    if (id === 'storm' && Math.random() < dt * 0.25) this.flash = 1;
    this.flash = Math.max(0, this.flash - dt * 4);
    const dim = wet ? 0.72 : id === 'fog' ? 0.85 : id === 'drought' ? 1.08 : 1;
    const { sun, hemi } = this.stage;
    sun.intensity *= dim;
    hemi.intensity = hemi.intensity * dim + this.flash * 2.5;
    if (id === 'fog') this.stage.scene.background.lerp(new THREE.Color(0xc8ccd0), 0.5);
    if (id === 'drought') sun.color.lerp(new THREE.Color(0xffc080), 0.3);
  }
}
