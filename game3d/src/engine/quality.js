// 画质档位:高(2048 阴影 + 抗锯齿像素比 2)/ 中(1024 阴影)/ 低(无阴影,像素比 1)。
// 自动模式:开局后若持续低于 24 FPS 则降一档(仅本机偏好,存 localStorage)。
const KEY = 'voxel-era-quality';
export const QUALITY = {
  high: { name: '高', shadow: 2048, ratio: 2 },
  medium: { name: '中', shadow: 1024, ratio: 1.5 },
  low: { name: '低', shadow: 0, ratio: 1 },
};
const ORDER = ['high', 'medium', 'low'];

export class Quality {
  constructor(stage, scene) {
    this.stage = stage;
    this.scene = scene;
    let saved = null;
    try { saved = localStorage.getItem(KEY); } catch { /* 存储不可用 */ }
    this.auto = !saved;
    this.level = QUALITY[saved] ? saved : 'high';
    this.samples = [];
    this.watchT = 3;
    this.apply();
  }

  set(level, manual = true) {
    this.level = level;
    if (manual) {
      this.auto = false;
      try { localStorage.setItem(KEY, level); } catch { /* 存储不可用 */ }
    }
    this.apply();
  }

  apply() {
    const q = QUALITY[this.level];
    const { renderer, sun } = this.stage;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.ratio));
    const shadows = q.shadow > 0;
    if (renderer.shadowMap.enabled !== shadows || (shadows && sun.shadow.mapSize.x !== q.shadow)) {
      renderer.shadowMap.enabled = shadows;
      sun.castShadow = shadows;
      if (shadows) {
        sun.shadow.mapSize.set(q.shadow, q.shadow);
        sun.shadow.map?.dispose();
        sun.shadow.map = null;
      }
      this.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
    }
  }

  /** 每帧调用;返回降档后的新档位名(用于提示),否则 null。 */
  watch(dt) {
    if (!this.auto) return null;
    this.watchT -= dt;
    if (this.watchT > 0) return null;
    this.samples.push(dt);
    if (this.samples.length < 90) return null;
    const avg = this.samples.reduce((s, v) => s + v, 0) / this.samples.length;
    this.samples = [];
    const i = ORDER.indexOf(this.level);
    if (1 / avg < 24 && i < ORDER.length - 1) {
      this.set(ORDER[i + 1], false);
      this.watchT = 2;
      return QUALITY[this.level].name;
    }
    if (1 / avg >= 24) this.auto = false; // 稳定后停止监测
    return null;
  }
}
