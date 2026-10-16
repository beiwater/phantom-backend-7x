// 伟人(文明式):四类伟人点数来自累计成就,达到阈值诞生一位,由玩家择机使用(命令 'useGreat')。
// 点数来源均为模拟内计数器,结果确定。
export const GREAT = {
  scientist: { name: '伟大科学家', icon: '🧪', source: '累计科研产出', desc: '立即完成当前研究;若未在研究则获得 60×时代 科研点' },
  merchant: { name: '伟大商人', icon: '💼', source: '集市收入与合同', desc: '获得 800×时代 金币,贸易声望 +2' },
  general: { name: '伟大将军', icon: '🎖️', source: '歼灭敌军', desc: '90 秒内全军伤害 +30%' },
  engineer: { name: '伟大工程师', icon: '🛠️', source: '建成建筑数', desc: '立即完成所有建造与升级中的建筑' },
};
const RATE = { scientist: 1, merchant: 0.1, general: 6, engineer: 8 };
const BASE = 100;

export class GreatPeople {
  constructor(game) {
    this.game = game;
    this.earned = { scientist: 0, merchant: 0, general: 0, engineer: 0 };
    this.ready = [];
    this.t = 1;
  }

  points(kind) {
    const c = this.game.counters;
    const raw = { scientist: c.researchMade ?? 0, merchant: c.marketMoney ?? 0, general: c.enemyKilled ?? 0, engineer: c.built ?? 0 }[kind];
    return raw * RATE[kind];
  }

  /** 第 n+1 位该类伟人所需累计点数(递增 ×1.8)。 */
  threshold(kind) {
    let s = 0;
    for (let i = 0; i <= this.earned[kind]; i++) s += BASE * 1.8 ** i;
    return Math.round(s);
  }

  step(gdt) {
    this.t -= gdt;
    if (this.t > 0) return;
    this.t = 1;
    for (const kind of Object.keys(GREAT)) {
      if (this.points(kind) >= this.threshold(kind)) {
        this.earned[kind]++;
        this.ready.push(kind);
        this.game.events.emit('great:born', kind);
      }
    }
  }

  use(i) {
    const g = this.game;
    if (!Number.isInteger(i) || i < 0 || i >= this.ready.length) return { ok: false, reason: '没有这位伟人' };
    const kind = this.ready[i];
    if (kind === 'scientist') {
      if (g.researching) g.finishTech(g.researching.id);
      else g.addRes('research', 60 * g.era);
    } else if (kind === 'merchant') {
      g.addRes('money', 800 * g.era);
      if (g.contracts) g.contracts.reputation = Math.min(20, g.contracts.reputation + 2);
    } else if (kind === 'general') {
      g.buffs = g.buffs.filter((b) => b.id !== 'general');
      g.buffs.push({ id: 'general', name: '将军鼓舞', until: g.time + 90, effects: { unitDamage: 0.3 } });
    } else if (kind === 'engineer') {
      for (const b of g.buildings.values()) if (b.team === g.localPlayer && (b.state === 'construct' || b.state === 'upgrade')) b.progress = 1;
    }
    this.ready.splice(i, 1);
    g.events.emit('great:used', kind);
    return { ok: true, kind };
  }

  serialize() { return { earned: this.earned, ready: this.ready }; }
  load(d) { if (d) { Object.assign(this.earned, d.earned ?? {}); this.ready = d.ready ?? []; } }
}
