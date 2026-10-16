// 小地图:地形底图(地形变化时重绘)+ 建筑/单位点 + 镜头视野框;点击跳转镜头。
import { MAP_W, MAP_H, T, OWNER } from '../world/map.js';

const COLORS = {
  [T.grass]: [128, 196, 90], [T.forest]: [70, 140, 60], [T.rock]: [150, 150, 140], [T.ore]: [176, 112, 80],
  [T.coal]: [70, 70, 76], [T.oil]: [110, 90, 100], [T.water]: [60, 130, 190], [T.sand]: [226, 208, 150],
};

export class Minimap {
  constructor(game, rig) {
    this.game = game;
    this.rig = rig;
    this.canvas = document.getElementById('minimap');
    this.ctx = this.canvas.getContext('2d');
    this.base = document.createElement('canvas');
    this.base.width = MAP_W;
    this.base.height = MAP_H;
    this.baseVersion = -1;
    this.pings = [];
    this.t = 0;
    const jump = (e) => {
      const r = this.canvas.getBoundingClientRect();
      rig.lookAt(((e.clientX - r.left) / r.width) * MAP_W, ((e.clientY - r.top) / r.height) * MAP_H);
    };
    this.canvas.addEventListener('pointerdown', (e) => { this.drag = true; jump(e); });
    window.addEventListener('pointermove', (e) => { if (this.drag) jump(e); });
    window.addEventListener('pointerup', () => { this.drag = false; });
  }

  /** 警报位置在小地图上闪烁 6 秒。 */
  ping(loc, color) {
    this.pings.push({ x: loc.x, z: loc.z, color, t: performance.now() });
    if (this.pings.length > 6) this.pings.shift();
  }

  drawBase() {
    const m = this.game.map;
    const ctx = this.base.getContext('2d');
    const img = ctx.createImageData(MAP_W, MAP_H);
    for (let z = 0; z < MAP_H; z++) {
      for (let x = 0; x < MAP_W; x++) {
        const i = m.idx(x, z);
        let [r, g, b] = COLORS[m.terrain[i]];
        if (m.road[i]) [r, g, b] = [90, 90, 96];
        const o = m.ownerAt(x, z);
        if (o === OWNER.none) { r *= 0.6; g *= 0.6; b *= 0.6; }
        const k = i * 4;
        img.data[k] = r; img.data[k + 1] = g; img.data[k + 2] = b; img.data[k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    this.baseVersion = m.version;
  }

  update(dt) {
    this.t -= dt;
    if (this.t > 0) return;
    this.t = this.pings.length ? 0.08 : 0.2;
    if (this.baseVersion !== this.game.map.version) this.drawBase();
    const ctx = this.ctx;
    const W = this.canvas.width;
    const s = W / MAP_W;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.base, 0, 0, W, W);
    const fog = this.game.fog;
    if (fog?.enabled) {
      for (let z = 0; z < MAP_H; z++) {
        for (let x = 0; x < MAP_W; x++) {
          const i = z * MAP_W + x;
          if (fog.visibleNow[i]) continue;
          ctx.fillStyle = fog.explored[i] ? 'rgba(10,14,20,0.45)' : '#0b0f15';
          ctx.fillRect(x * s, z * s, s + 0.5, s + 0.5);
        }
      }
    }
    for (const b of this.game.buildings.values()) {
      if (fog && b.team !== this.game.localPlayer && !fog.isExplored(b.x, b.z)) continue;
      ctx.fillStyle = b.team === 'player' ? '#f4f4f4' : '#e04030';
      ctx.fillRect(b.x * s, b.z * s, b.w * s, b.d * s);
    }
    for (const u of this.game.unitSystem?.units ?? []) {
      if (fog && u.team !== this.game.localPlayer && !fog.visible(u.x, u.z)) continue;
      ctx.fillStyle = u.team === 'player' ? '#3a8bff' : '#ff3020';
      ctx.fillRect(u.x * s - 1.5, u.z * s - 1.5, 3, 3);
    }
    const now = performance.now();
    this.pings = this.pings.filter((p) => now - p.t < 6000);
    for (const p of this.pings) {
      const k = ((now - p.t) % 1000) / 1000;
      ctx.strokeStyle = p.color;
      ctx.globalAlpha = 1 - k;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x * s, p.z * s, 3 + k * 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // 镜头视野:四角投射到地面
    const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => {
      const r = this.rig.dom.getBoundingClientRect();
      return this.rig.groundAt(r.left + ((x + 1) / 2) * r.width, r.top + ((y + 1) / 2) * r.height);
    });
    if (pts.every(Boolean)) {
      ctx.strokeStyle = '#ffe066';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x * s, p.z * s) : ctx.moveTo(p.x * s, p.z * s)));
      ctx.closePath();
      ctx.stroke();
    }
  }
}
