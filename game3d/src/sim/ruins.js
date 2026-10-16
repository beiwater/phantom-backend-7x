// 古代遗迹(文明式「部落村庄」):地图生成时按种子散布;任一我方单位靠近即探索,
// 随机奖励金币/科研/物资/雇佣兵/地图情报。纯模拟逻辑,使用 game.rng 保持确定性。
import { mulberry32 } from '../engine/util.js';
import { MAP_W, MAP_H, T, OWNER } from '../world/map.js';
import { RESOURCES } from '../data/resources.js';

const COUNT = 9;
const CLAIM_R = 1.3;

export class Ruins {
  constructor(game) {
    this.game = game;
    /** @type {{id:number,x:number,z:number,claimed:boolean}[]} */
    this.list = [];
    this.generate();
  }

  generate() {
    const m = this.game.map;
    const rnd = mulberry32(m.seed * 31 + 9);
    let tries = 0;
    while (this.list.length < COUNT && tries++ < 4000) {
      const x = Math.floor(rnd() * MAP_W);
      const z = Math.floor(rnd() * MAP_H);
      const t = m.t(x, z);
      if (t !== T.grass && t !== T.sand) continue;
      if (m.ownerAt(x, z) !== OWNER.none) continue;
      if (this.list.some((r) => Math.abs(r.x - x) + Math.abs(r.z - z) < 10)) continue;
      this.list.push({ id: this.list.length + 1, x, z, claimed: false });
    }
  }

  /** 遗迹格不可建造(放置校验调用)。 */
  at(x, z) {
    return this.list.find((r) => !r.claimed && r.x === x && r.z === z) ?? null;
  }

  step() {
    const g = this.game;
    const units = g.unitSystem?.units;
    if (!units) return;
    for (const r of this.list) {
      if (r.claimed) continue;
      const u = units.find((v) => v.team === g.localPlayer && Math.abs(v.x - (r.x + 0.5)) < CLAIM_R && Math.abs(v.z - (r.z + 0.5)) < CLAIM_R);
      if (u) this.claim(r);
    }
  }

  claim(r) {
    const g = this.game;
    r.claimed = true;
    const roll = g.rng();
    let msg;
    if (roll < 0.25) {
      const n = 200 + Math.floor(g.rng() * 300) * g.era;
      g.addRes('money', n);
      msg = `💰 遗迹中发现古代宝藏:${n} 金币`;
    } else if (roll < 0.45) {
      const n = 20 + Math.floor(g.rng() * 20) * g.era;
      g.addRes('research', n);
      msg = `📜 破译古代典籍:${n} 科研点`;
    } else if (roll < 0.65) {
      const pool = Object.keys(RESOURCES).filter((k) => RESOURCES[k].era <= g.era && !['water', 'grain'].includes(k));
      const k = pool[Math.floor(g.rng() * pool.length)];
      const got = g.addRes(k, 25 + Math.floor(g.rng() * 25));
      msg = `📦 遗迹仓库:${got} ${RESOURCES[k].name}`;
    } else if (roll < 0.85 && g.unitSystem?.spawnUnit) {
      const type = g.era >= 2 ? 'rifleman' : 'militia';
      for (let i = 0; i < 2; i++) g.unitSystem.spawnUnit(type, g.localPlayer, r.x + 0.5 + i * 0.4, r.z + 0.5);
      msg = '🛡️ 遗迹中的流浪战士加入了你的军队(×2)';
    } else {
      g.events.emit('ruins:map', { x: r.x, z: r.z, radius: 12 });
      msg = '🗺️ 发现古代地图,周边地区已揭示';
    }
    g.counters.ruins = (g.counters.ruins ?? 0) + 1;
    g.events.emit('ruins:claim', { ruin: r, msg });
  }

  serialize() { return this.list.filter((r) => r.claimed).map((r) => r.id); }
  load(ids) {
    if (!Array.isArray(ids)) return;
    for (const r of this.list) r.claimed = ids.includes(r.id);
  }
}
