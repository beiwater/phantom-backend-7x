// 天气(模拟状态,确定性):晴 / 雨 / 雷暴 / 干旱 / 大雾,每 90–180 秒按种子随机切换。
// 效果通过 game.effect() 汇总(见 state.effect),视觉见 world/weather-view.js。
export const WEATHERS = {
  clear: { name: '晴朗', icon: '☀️', effects: {}, weight: 5 },
  rain: { name: '降雨', icon: '🌧️', effects: { farm: 0.2 }, weight: 3, desc: '农场 +20%' },
  storm: { name: '雷暴', icon: '⛈️', effects: { farm: 0.1, happy: -4 }, weight: 1, desc: '农场 +10%,民心 -4' },
  drought: { name: '干旱', icon: '🔥', effects: { farm: -0.25, pump: -0.3 }, weight: 1, desc: '农场 -25%,水泵 -30%' },
  fog: { name: '大雾', icon: '🌫️', effects: { sight: -0.35 }, weight: 1, desc: '视野 -35%' },
};
const IDS = Object.keys(WEATHERS);

export class Weather {
  constructor(game) {
    this.game = game;
    this.id = 'clear';
    this.t = 120;
  }

  get current() { return WEATHERS[this.id]; }

  step(gdt) {
    const g = this.game;
    this.t -= gdt;
    if (this.t > 0) return;
    this.t = 90 + g.rng() * 90;
    const total = IDS.reduce((s, k) => s + WEATHERS[k].weight, 0);
    let r = g.rng() * total;
    let next = 'clear';
    for (const k of IDS) { r -= WEATHERS[k].weight; if (r <= 0) { next = k; break; } }
    if (next === this.id) return;
    this.id = next;
    g.events.emit('weather', next);
  }

  serialize() { return { id: this.id, t: this.t }; }
  load(d) { if (d && WEATHERS[d.id]) { this.id = d.id; this.t = d.t ?? 120; } }
}
