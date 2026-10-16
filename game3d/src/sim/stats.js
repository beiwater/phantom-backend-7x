// 产销统计:按 10 秒分桶记录每种资源的产出与消耗,供「统计」面板计算每分钟净流量与趋势图。
import { RESOURCE_IDS } from '../data/resources.js';

const BUCKET = 10;
const KEEP = 36; // 6 分钟

const zero = () => Object.fromEntries(['money', 'research', ...RESOURCE_IDS].map((k) => [k, 0]));

export class Stats {
  constructor() {
    this.cur = { made: zero(), used: zero() };
    this.buckets = [];
    this.t = 0;
  }

  made(k, n) { if (n > 0 && this.cur.made[k] !== undefined) this.cur.made[k] += n; }
  used(k, n) { if (n > 0 && this.cur.used[k] !== undefined) this.cur.used[k] += n; }

  step(gdt) {
    this.t += gdt;
    if (this.t < BUCKET) return;
    this.t -= BUCKET;
    this.buckets.push(this.cur);
    if (this.buckets.length > KEEP) this.buckets.shift();
    this.cur = { made: zero(), used: zero() };
  }

  /** 最近 n 桶的每分钟产出/消耗。 */
  perMinute(k, n = 6) {
    const list = this.buckets.slice(-n);
    if (!list.length) return { made: 0, used: 0 };
    const made = list.reduce((s, b) => s + b.made[k], 0);
    const used = list.reduce((s, b) => s + b.used[k], 0);
    const mins = (list.length * BUCKET) / 60;
    return { made: made / mins, used: used / mins };
  }

  series(k) {
    return this.buckets.map((b) => b.made[k] - b.used[k]);
  }

  serialize() { return { buckets: this.buckets, t: this.t }; }
  load(d) { if (d) { this.buckets = d.buckets ?? []; this.t = d.t ?? 0; } }
}
