// 贸易合同:NPC 城邦发布限时订单(交付 N 件货物换金币/科研/声望)。
// 报价随时代变化,价格明显高于集市,但需要提前备货;过期未交付扣声望。
// 生成使用 game.rng(确定性)。交付走命令 'deliver'(全量预检后一次性扣货,幂等:合同交付后即移除)。
import { RESOURCES } from '../data/resources.js';

const CLIENTS = ['河谷城邦', '北境商会', '沙海联盟', '群岛共和国', '高原公国', '铁炉矿业'];
const MAX_OFFERS = 3;

export class Contracts {
  constructor(game) {
    this.game = game;
    this.offers = [];
    this.nextId = 1;
    this.spawnT = 20;
    this.reputation = 0;
  }

  generate() {
    const g = this.game;
    const pool = Object.keys(RESOURCES).filter((k) => RESOURCES[k].era <= g.era && !['water', 'grain', 'wood', 'stone'].includes(k));
    const res = pool[Math.floor(g.rng() * pool.length)];
    const base = RESOURCES[res].price;
    const qty = Math.max(5, Math.round((60 / base) * (0.6 + g.rng()) * (1 + g.era * 0.5)));
    const premium = 1.6 + g.rng() * 0.8 + this.reputation * 0.02;
    const reward = { money: Math.round(qty * base * premium) };
    if (g.rng() < 0.35) reward.research = Math.round(qty * base * 0.1);
    return {
      id: this.nextId++,
      client: CLIENTS[Math.floor(g.rng() * CLIENTS.length)],
      res, qty, reward,
      expires: g.time + 240 + Math.round(g.rng() * 180),
    };
  }

  step(gdt) {
    const g = this.game;
    for (const o of this.offers) {
      if (o.expires <= g.time) {
        this.reputation = Math.max(-10, this.reputation - 1);
        g.events.emit('contract:expired', o);
      }
    }
    this.offers = this.offers.filter((o) => o.expires > g.time);
    this.spawnT -= gdt;
    if (this.spawnT <= 0) {
      this.spawnT = 60 + g.rng() * 60;
      if (this.offers.length < MAX_OFFERS) {
        const o = this.generate();
        this.offers.push(o);
        g.events.emit('contract:new', o);
      }
    }
  }

  deliver(id) {
    const g = this.game;
    const o = this.offers.find((c) => c.id === id);
    if (!o) return { ok: false, reason: '合同不存在或已过期' };
    if (!g.spend({ [o.res]: o.qty })) return { ok: false, reason: `需要 ${o.qty} ${RESOURCES[o.res].name}` };
    this.offers = this.offers.filter((c) => c !== o);
    for (const [k, v] of Object.entries(o.reward)) g.addRes(k, v);
    g.econStats?.used(o.res, o.qty);
    g.econStats?.made('money', o.reward.money);
    this.reputation = Math.min(20, this.reputation + 1);
    g.counters.contracts = (g.counters.contracts ?? 0) + 1;
    g.events.emit('contract:done', o);
    return { ok: true };
  }

  serialize() { return { offers: this.offers, nextId: this.nextId, spawnT: this.spawnT, reputation: this.reputation }; }
  load(d) {
    if (!d) return;
    this.offers = d.offers ?? [];
    this.nextId = d.nextId ?? 1;
    this.spawnT = d.spawnT ?? 20;
    this.reputation = d.reputation ?? 0;
  }
}
