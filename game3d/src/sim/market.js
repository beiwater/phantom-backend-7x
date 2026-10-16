// 动态市场:每种货物有价格系数(0.35–1.8)。卖出压低价格,随时间回归 1,
// 并有基于种子随机数的需求波动(固定步长 + game.rng,回放一致)。
import { RESOURCE_IDS, RESOURCES } from '../data/resources.js';

const MIN = 0.35;
const MAX = 1.8;
const RECOVER_PER_SEC = 0.012;
const DROP_PER_UNIT = 0.006;
const HISTORY = 60; // 每 10 秒一个点,保留 10 分钟

export class Market {
  constructor(game) {
    this.game = game;
    this.mult = Object.fromEntries(RESOURCE_IDS.map((k) => [k, 1]));
    this.trend = Object.fromEntries(RESOURCE_IDS.map((k) => [k, 0]));
    this.history = Object.fromEntries(RESOURCE_IDS.map((k) => [k, []]));
    this.sampleT = 0;
    this.shockT = 60;
  }

  price(k) {
    return RESOURCES[k].price * this.mult[k];
  }

  /** 卖出 n 件,返回收入(按卖出过程中的平均价格结算)并压低价格。 */
  sell(k, n, quality = 1) {
    const before = this.mult[k];
    this.mult[k] = Math.max(MIN, before - n * DROP_PER_UNIT);
    const avg = (before + this.mult[k]) / 2;
    return Math.round(n * RESOURCES[k].price * avg * quality);
  }

  step(gdt) {
    const g = this.game;
    for (const k of RESOURCE_IDS) {
      const m = this.mult[k];
      const target = 1 + this.trend[k];
      this.mult[k] = Math.min(MAX, Math.max(MIN, m + (target - m) * RECOVER_PER_SEC * gdt * 4));
      this.trend[k] *= 1 - 0.004 * gdt;
    }
    this.shockT -= gdt;
    if (this.shockT <= 0) {
      this.shockT = 45 + g.rng() * 60;
      const k = RESOURCE_IDS[Math.floor(g.rng() * RESOURCE_IDS.length)];
      if (RESOURCES[k].era > g.era) return;
      const up = g.rng() < 0.6;
      this.trend[k] = up ? 0.3 + g.rng() * 0.5 : -(0.2 + g.rng() * 0.3);
      g.events.emit('market:shock', { res: k, up });
    }
    this.sampleT -= gdt;
    if (this.sampleT <= 0) {
      this.sampleT = 10;
      for (const k of RESOURCE_IDS) {
        const h = this.history[k];
        h.push(+this.mult[k].toFixed(3));
        if (h.length > HISTORY) h.shift();
      }
    }
  }

  serialize() {
    return { mult: this.mult, trend: this.trend, history: this.history, shockT: this.shockT };
  }

  load(d) {
    if (!d) return;
    Object.assign(this.mult, d.mult);
    Object.assign(this.trend, d.trend);
    Object.assign(this.history, d.history);
    this.shockT = d.shockT ?? 60;
  }
}
