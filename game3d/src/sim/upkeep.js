// 军队补给:每 30 秒结算一次。步兵消耗食物,载具/直升机消耗燃油。
// 补给不足时 game.supply[类别] = false,战斗中该类单位伤害 -30%(见 rts/combat.js fire)。
const PERIOD = 30;
export const UPKEEP = {
  militia: { food: 1 }, scout: { food: 1 }, rifleman: { food: 1 },
  tank: { fuel: 1 }, artillery: { fuel: 1 }, helicopter: { fuel: 2 },
};
export const SUPPLY_PENALTY = 0.7;

export class Upkeep {
  constructor(game) {
    this.game = game;
    this.t = PERIOD;
    game.supply = { food: true, fuel: true };
    this.last = { food: 0, fuel: 0 };
  }

  /** 当前每周期需求(供 HUD 显示)。 */
  demand() {
    const g = this.game;
    const need = { food: 0, fuel: 0 };
    for (const u of g.unitSystem?.units ?? []) {
      if (u.team !== g.localPlayer) continue;
      for (const [k, v] of Object.entries(UPKEEP[u.type] ?? {})) need[k] += v;
    }
    return need;
  }

  step(gdt) {
    this.t -= gdt;
    if (this.t > 0) return;
    this.t = PERIOD;
    const g = this.game;
    const need = this.demand();
    for (const k of ['food', 'fuel']) {
      const n = need[k];
      this.last[k] = n;
      if (n <= 0) { g.supply[k] = true; continue; }
      const was = g.supply[k];
      if (g.res[k] >= n) {
        g.res[k] -= n;
        g.econStats?.used(k, n);
        g.supply[k] = true;
      } else {
        g.res[k] = 0;
        g.supply[k] = false;
      }
      if (was !== g.supply[k]) g.events.emit('supply', { res: k, ok: g.supply[k] });
    }
  }

  serialize() { return { t: this.t, supply: this.game.supply }; }
  load(d) { if (d) { this.t = d.t ?? PERIOD; Object.assign(this.game.supply, d.supply ?? {}); } }
}

/** 单位当前是否补给充足。 */
export function supplied(game, u) {
  if (u.team !== game.localPlayer) return true;
  return Object.keys(UPKEEP[u.type] ?? {}).every((k) => game.supply?.[k] !== false);
}
