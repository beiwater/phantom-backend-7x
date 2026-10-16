// 国家工程(文明奇观的经济版):分批投入材料,完工后永久生效。太空计划完工直接取得科技胜利。
// 投入走命令 'fund':按需求上限扣除玩家现有材料(只扣实际投入的部分),完工判定在模拟内,结果确定。
export const PROJECTS = {
  granary: { name: '大粮仓', icon: '🌾', era: 1, need: { food: 150, planks: 100, money: 800 }, effects: { housing: 0.1, happy: 5 }, desc: '住户 +10%,民心 +5' },
  canal: { name: '大运河', icon: '🚢', era: 2, need: { stone: 300, concrete: 150, money: 2000 }, effects: { raw: 0.15, process: 0.1 }, desc: '采集 +15%,加工 +10%' },
  railway: { name: '国家铁路网', icon: '🚂', era: 2, need: { steel: 200, planks: 150, money: 2500 }, effects: { storage: 0.5, marketPrice: 0.1 }, desc: '仓储 +50%,集市售价 +10%' },
  spaceport: { name: '太空计划', icon: '🚀', era: 3, need: { electronics: 120, steel: 300, fuel: 150, money: 6000 }, effects: {}, desc: '完工即取得科技胜利' },
};

export class Projects {
  constructor(game) {
    this.game = game;
    /** @type {Record<string, Record<string, number>>} 已投入量 */
    this.paid = Object.fromEntries(Object.keys(PROJECTS).map((id) => [id, {}]));
    this.done = new Set();
  }

  progress(id) {
    const need = PROJECTS[id].need;
    const total = Object.values(need).reduce((s, v) => s + v, 0);
    const got = Object.entries(need).reduce((s, [k, v]) => s + Math.min(v, this.paid[id][k] ?? 0), 0);
    return got / total;
  }

  fund(id) {
    const g = this.game;
    if (!Object.hasOwn(PROJECTS, id)) return { ok: false, reason: '未知工程' };
    const p = PROJECTS[id];
    if (this.done.has(id)) return { ok: false, reason: '工程已完工' };
    if (p.era > g.era) return { ok: false, reason: '时代不足' };
    let any = false;
    for (const [k, v] of Object.entries(p.need)) {
      const want = v - (this.paid[id][k] ?? 0);
      const give = Math.min(want, Math.floor(g.res[k] ?? 0));
      if (give <= 0) continue;
      g.res[k] -= give;
      g.econStats?.used(k, give);
      this.paid[id][k] = (this.paid[id][k] ?? 0) + give;
      any = true;
    }
    if (!any) return { ok: false, reason: '没有可投入的材料' };
    if (this.progress(id) >= 1) {
      this.done.add(id);
      g.events.emit('project:done', id);
      if (id === 'spaceport') g.endGame('win', 'science');
    }
    g.events.emit('res');
    return { ok: true, done: this.done.has(id) };
  }

  effect(key) {
    let v = 0;
    for (const id of this.done) v += PROJECTS[id].effects[key] ?? 0;
    return v;
  }

  serialize() { return { paid: this.paid, done: [...this.done] }; }
  load(d) {
    if (!d) return;
    for (const id of Object.keys(PROJECTS)) this.paid[id] = d.paid?.[id] ?? {};
    this.done = new Set((d.done ?? []).filter((id) => Object.hasOwn(PROJECTS, id)));
  }
}
