// 民心与随机事件(文明式的「城市状态」层)。
// 民心 0–100:口粮、服务(集市)、教育(学院/研究所)加分;重工业污染民居、敌军压境扣分。
// 影响:税收倍率 0.5–1.5,生产效率(<30 罢工风险 / >75 +10%)。
// 随机事件使用 game.rng,在固定步长下与回放一致。
import { BUILDINGS } from '../data/buildings.js';
import { RESOURCES } from '../data/resources.js';

export const POLLUTERS = new Set(['steelMill', 'refinery', 'chemical', 'power', 'coalMine', 'cement', 'munitions', 'ironMine']);
const POLLUTION_R = 3;

export class Society {
  constructor(game) {
    this.game = game;
    this.happiness = 60;
    this.parts = {};
    this.eventT = 150;
    game.buffs = game.buffs ?? [];
  }

  /** 民居周围 3 格内污染源数量。 */
  pollutionAt(x, z, w = 1, d = 1) {
    const seen = new Set();
    for (let zz = z - POLLUTION_R; zz < z + d + POLLUTION_R; zz++) {
      for (let xx = x - POLLUTION_R; xx < x + w + POLLUTION_R; xx++) {
        const o = this.game.buildingAt(xx, zz);
        if (o && o.team === 'player' && POLLUTERS.has(o.type) && o.state !== 'construct') seen.add(o.uid);
      }
    }
    return seen.size;
  }

  recompute() {
    const g = this.game;
    const houses = [];
    let markets = 0;
    let edu = 0;
    for (const b of g.buildings.values()) {
      if (b.team !== 'player' || b.state === 'construct') continue;
      if (b.type === 'house') houses.push(b);
      if (b.type === 'market') markets += b.level;
      if (b.type === 'academy' || b.type === 'lab') edu += b.level;
    }
    const p = {};
    p.base = 55;
    if (houses.length) {
      const unfed = houses.filter((h) => !h.fed).length / houses.length;
      p.food = unfed > 0 ? -Math.round(30 * unfed) : 10;
      let pol = 0;
      for (const h of houses) {
        h.pollution = this.pollutionAt(h.x, h.z);
        pol += h.pollution;
      }
      p.pollution = -Math.min(30, Math.round((pol / houses.length) * 8));
    } else {
      p.food = 0;
      p.pollution = 0;
    }
    p.services = Math.min(15, markets * 3);
    p.education = Math.min(10, edu * 2);
    const hq = g.playerHQ();
    const threat = hq && (g.unitSystem?.units ?? []).some((u) => u.team !== g.localPlayer && Math.abs(u.x - hq.x) + Math.abs(u.z - hq.z) < 14);
    p.war = threat ? -12 : 0;
    p.events = g.buffs.reduce((s, b) => s + (b.effects.happy ?? 0), 0);
    this.parts = p;
    const target = Math.max(0, Math.min(100, Object.values(p).reduce((s, v) => s + v, 0)));
    // 民心缓慢变化,避免瞬时跳变
    this.happiness += (target - this.happiness) * 0.15;
  }

  taxMult() { return 0.5 + this.happiness / 100; }

  productivity() {
    if (this.happiness < 30) return 0.8;
    if (this.happiness > 75) return 1.1;
    return 1;
  }

  step(gdt) {
    const g = this.game;
    g.buffs = g.buffs.filter((b) => b.until > g.time);
    this.eventT -= gdt;
    if (this.eventT > 0) return;
    this.eventT = 110 + g.rng() * 90;
    this.fire();
  }

  addBuff(id, name, secs, effects) {
    const g = this.game;
    g.buffs = g.buffs.filter((b) => b.id !== id);
    g.buffs.push({ id, name, until: g.time + secs, effects });
  }

  fire() {
    const g = this.game;
    const roll = g.rng();
    const mine = [...g.buildings.values()].filter((b) => b.team === 'player' && b.state === 'active');
    const has = (t) => mine.some((b) => b.type === t);
    let msg = null;
    let kind = 'good';
    if (this.happiness < 35 && roll < 0.5) {
      this.addBuff('strike', '工人罢工', 45, { prod: -0.4, happy: 5 });
      msg = '✊ 民心低落,工人罢工!生产 -40%(45 秒)';
      kind = 'bad';
    } else if (roll < 0.18 && has('farm')) {
      this.addBuff('harvest', '大丰收', 60, { farm: 0.5, happy: 4 });
      msg = '🌾 大丰收!农场产量 +50%(60 秒)';
    } else if (roll < 0.34) {
      const pool = Object.keys(RESOURCES).filter((k) => RESOURCES[k].era <= g.era);
      const k = pool[Math.floor(g.rng() * pool.length)];
      g.market.trend[k] = 0.7;
      msg = `🐪 商队来访,高价收购${RESOURCES[k].name}!`;
    } else if (roll < 0.48 && (has('ironMine') || has('coalMine'))) {
      const k = has('ironMine') && g.rng() < 0.5 ? 'ironOre' : has('coalMine') ? 'coal' : 'ironOre';
      const got = g.addRes(k, 30);
      msg = `⛏️ 发现富矿脉!获得 ${got} ${RESOURCES[k].name}`;
    } else if (roll < 0.6) {
      this.addBuff('immigrants', '移民潮', 90, { housing: 0.25, happy: 3 });
      msg = '🧳 移民潮!住户 +25%(90 秒)';
    } else if (roll < 0.72 && mine.length > 3) {
      const candidates = mine.filter((b) => b.type !== 'hq' && b.type !== 'wall');
      const b = candidates[Math.floor(g.rng() * candidates.length)];
      if (b) {
        g.damageBuilding(b, b.maxHp * 0.3);
        msg = `🔥 ${BUILDINGS[b.type].name}发生火灾,耐久 -30%!记得维修`;
        kind = 'bad';
      }
    } else if (roll < 0.84 && (has('academy') || has('lab'))) {
      const n = 10 + Math.floor(g.era * 10 * g.rng());
      g.addRes('research', n);
      msg = `💡 科学突破!获得 ${n} 科研点`;
    } else {
      this.addBuff('festival', '丰收节', 60, { happy: 12 });
      msg = '🎉 民间节庆,民心 +12(60 秒)';
    }
    if (msg) g.events.emit('event', { msg, kind });
  }

  serialize() { return { happiness: this.happiness, eventT: this.eventT }; }
  load(d) { if (d) { this.happiness = d.happiness ?? 60; this.eventT = d.eventT ?? 150; } }
}
