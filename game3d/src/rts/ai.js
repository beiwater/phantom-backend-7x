// 敌军 AI:开局要塞布置 + 驻军 + 定时进攻波次。波次强度随波数与玩家时代增长,由存活的敌方兵营/战车工厂出兵。
// 被摧毁的兵营/工厂/防御塔会在 REBUILD_DELAY 后、附近无我方部队时重建;敌军指挥中心随玩家时代升级。
import { ENEMY_HQ } from '../world/map.js';
import { nearestWalkable, ringCells } from './path.js';
import { orderAMove } from './units.js';

const ENEMY = 'enemy';
export const FIRST_WAVE = 300;
export const WAVE_GAP = 150;
const WARN_AHEAD = 45;
const ENEMY_CAP = 60;
const WAVE_MAX = 40;
const GARRISON = ['militia', 'militia', 'militia', 'militia', 'rifleman', 'rifleman'];
const REBUILD_DELAY = 180;
const REBUILD_TYPES = new Set(['barracks', 'vehicleFactory', 'turret']);
const REBUILD_CLEAR_R = 8;

// 要塞布局(相对 ENEMY_HQ 偏移)。城墙环 x∈[-6,7]、z∈[-5,8],西侧/南侧/西南角留 3 个缺口朝向玩家
const LAYOUT = {
  barracks: [[-4, -3], [-3, 4]],
  vehicleFactory: [[4, 3]],
  turret: [[-5, -1], [-5, 4], [-1, 7], [3, 7], [5, -3]],
};
const WALL = { x0: -6, x1: 7, z0: -5, z1: 8 };
const GAPS = [[-6, 1], [-6, 2], [0, 8], [1, 8], [-6, 7], [-6, 8], [-5, 8]];

export class EnemyAI {
  constructor(rts) {
    this.rts = rts;
    this.nextWave = rts.game.difficulty?.firstWave ?? FIRST_WAVE;
    this.wave = 0;
    this.warned = false;
    this.stopped = false;
    this.damageMult = 1;
    /** @type {Map<number, Set<number>>} 波次 → 存活单位 id */
    this.waves = new Map();
    /** @type {{type:string,x:number,z:number,at:number}[]} */
    this.rebuild = [];
    rts.game.events.on('building:remove', ({ b, destroyed }) => {
      if (destroyed && b.team === ENEMY && REBUILD_TYPES.has(b.type)) {
        this.rebuild.push({ type: b.type, x: b.x, z: b.z, at: this.game.time + REBUILD_DELAY });
      }
    });
  }

  /** 重建与时代升级;只读模拟状态(时间/单位位置),保持确定性。 */
  maintain() {
    const g = this.game;
    const hq = [...g.buildings.values()].find((b) => b.type === 'hq' && b.team === ENEMY);
    if (!hq) return;
    if (hq.level < Math.min(3, g.era)) {
      const ratio = hq.hp / hq.maxHp;
      hq.level = Math.min(3, g.era);
      hq.maxHp = 3000 * (1 + 0.25 * (hq.level - 1));
      hq.hp = hq.maxHp * ratio;
      for (const b of g.buildings.values()) if (b.team === ENEMY && b.type === 'turret' && b.level < hq.level + 1) b.level = Math.min(4, hq.level + 1);
      g.events.emit('building:change', hq);
      for (const b of g.buildings.values()) if (b.team === ENEMY && b.type === 'turret') g.events.emit('building:change', b);
    }
    for (const job of [...this.rebuild]) {
      if (g.time < job.at) continue;
      const near = this.rts.units.some((u) => u.team !== ENEMY && Math.abs(u.x - job.x) + Math.abs(u.z - job.z) < REBUILD_CLEAR_R);
      if (near) { job.at = g.time + 20; continue; }
      const r = g.placeBuilding(job.type, job.x, job.z, ENEMY, { instant: true, level: job.type === 'turret' ? hq.level : 1 });
      if (r.ok) {
        r.building.hp = r.building.maxHp * 0.6;
        this.rebuild = this.rebuild.filter((j) => j !== job);
        if (job.type !== 'turret') this.rts.ui?.toast?.(`🔨 敌军重建了${job.type === 'barracks' ? '兵营' : '战车工厂'}`, 'bad');
        if (this.stopped && job.type !== 'turret') { this.stopped = false; this.warned = false; this.nextWave = g.time + WAVE_GAP; }
      } else {
        job.at = g.time + 20;
      }
    }
  }

  get game() { return this.rts.game; }

  /** 难度参数(game.difficulty),缺省时回落到普通难度。 */
  get diff() {
    const d = this.game.difficulty ?? {};
    return { firstWave: d.firstWave ?? FIRST_WAVE, waveMult: d.waveMult ?? 1, enemyHp: d.enemyHp ?? 1 };
  }

  setupBase() {
    const g = this.game;
    const H = ENEMY_HQ;
    this.nextWave = this.diff.firstWave;
    g.placeBuilding('hq', H.x, H.z, ENEMY, { instant: true });
    for (const [type, spots] of Object.entries(LAYOUT)) {
      for (const [dx, dz] of spots) g.placeBuilding(type, H.x + dx, H.z + dz, ENEMY, { instant: true });
    }
    const gap = new Set(GAPS.map(([x, z]) => `${x},${z}`));
    for (let x = WALL.x0; x <= WALL.x1; x++) {
      for (let z = WALL.z0; z <= WALL.z1; z++) {
        const edge = x === WALL.x0 || x === WALL.x1 || z === WALL.z0 || z === WALL.z1;
        if (!edge || gap.has(`${x},${z}`)) continue;
        g.placeBuilding('wall', H.x + x, H.z + z, ENEMY, { instant: true });
      }
    }
    this.spawnGarrison(GARRISON);
  }

  spawnGarrison(types) {
    const g = this.game;
    const used = new Set();
    for (const type of types) {
      const c = nearestWalkable(g.map, ENEMY_HQ.x - 0.5, ENEMY_HQ.z + 4.5, 5, (x, z) => !used.has(`${x},${z}`));
      if (!c) continue;
      used.add(`${c.x},${c.z}`);
      const u = this.rts.spawnUnit(type, ENEMY, c.x + 0.5, c.z + 0.5, this.diff.enemyHp);
      u.guard = true;
      u.home = { x: c.x + 0.5, z: c.z + 0.5 };
    }
  }

  production() {
    return [...this.game.buildings.values()].filter((b) => b.team === ENEMY && (b.type === 'barracks' || b.type === 'vehicleFactory'));
  }

  /** 第 n 波的兵力构成:[{ type, b }]。确定性(无随机),便于预告与回放一致。 */
  plan(n) {
    const era = this.game.era;
    const wm = this.diff.waveMult;
    const sc = (k, min = 0) => Math.max(min, Math.round(k * wm));
    const list = [];
    for (const b of this.production()) {
      if (b.type === 'barracks') {
        const k = sc(2 + Math.floor(n * 0.7) + (era - 1), 1);
        for (let i = 0; i < k; i++) {
          let type = 'militia';
          if (era === 1) type = n >= 3 && i % 3 === 2 ? 'rifleman' : 'militia';
          else if (era === 2) type = i % 3 === 0 ? 'militia' : 'rifleman';
          else type = i % 4 === 0 ? 'militia' : 'rifleman';
          list.push({ type, b });
        }
      } else if (era >= 2) {
        for (let i = 0; i < sc(1 + Math.floor(n / 3), 1); i++) list.push({ type: 'tank', b });
        if (era >= 3) {
          for (let i = 0; i < sc(1 + Math.floor(n / 4), 1); i++) list.push({ type: 'artillery', b });
          for (let i = 0; i < sc(Math.floor((n + 1) / 3)); i++) list.push({ type: 'helicopter', b });
        }
      }
    }
    const alive = this.rts.units.filter((u) => u.team === ENEMY).length;
    return list.slice(0, Math.max(0, Math.min(WAVE_MAX, ENEMY_CAP - alive)));
  }

  update() {
    const g = this.game;
    this.maintain();
    if (this.stopped) return;
    const n = this.wave + 1;
    if (!this.warned && g.time >= this.nextWave - WARN_AHEAD) {
      this.warned = true;
      if (!this.production().length) { this.stop(); return; }
      const size = this.plan(n).length;
      const eta = Math.max(0, Math.round(this.nextWave - g.time));
      g.events.emit('wave:incoming', { eta, size, wave: n });
      this.rts.ui?.toast?.(`⚠️ 敌军第 ${n} 波进攻将在 ${eta} 秒后抵达!(约 ${size} 个单位)`, 'big');
    }
    if (g.time >= this.nextWave) this.launch(n);
  }

  stop() {
    this.stopped = true;
    const rebuilding = this.rebuild.some((j) => j.type !== 'turret');
    this.rts.ui?.toast?.(rebuilding ? '🏳️ 敌军生产建筑已全部摧毁,进攻暂停——但敌军会尝试重建,派兵驻守废墟!' : '🏳️ 敌军生产建筑已全部摧毁,不会再有新的进攻波次!', 'good');
    this.game.events.emit('wave:stopped', {});
  }

  launch(n) {
    const g = this.game;
    this.wave = n;
    this.nextWave = g.time + WAVE_GAP;
    this.warned = false;
    const plan = this.plan(n);
    if (!this.production().length) { this.stop(); return; }
    const hq = g.playerHQ();
    const ids = new Set();
    const used = new Map();
    // 后期波次单位更结实
    const hpMult = Math.min(1.8, 1 + 0.04 * (n - 1)) * this.diff.enemyHp;
    this.damageMult = Math.min(1.5, 1 + 0.025 * (n - 1));
    for (const { type, b } of plan) {
      const c = this.spawnCell(b, used);
      if (!c) continue;
      const u = this.rts.spawnUnit(type, ENEMY, c.x + 0.5, c.z + 0.5, hpMult);
      u.wave = n;
      ids.add(u.id);
      if (hq) orderAMove(u, hq.x + hq.w / 2, hq.z + hq.d / 2, true);
    }
    if (ids.size) this.waves.set(n, ids);
    g.events.emit('wave:start', { wave: n, size: ids.size });
    this.rts.ui?.toast?.(`⚔️ 敌军第 ${n} 波进攻开始!`, 'bad');
    // 补充驻军
    if (this.production().some((b) => b.type === 'barracks')) {
      const have = this.rts.units.filter((u) => u.team === ENEMY && u.guard).length;
      const missing = Math.min(2, GARRISON.length - have);
      if (missing > 0) this.spawnGarrison(GARRISON.slice(0, missing));
    }
  }

  /** 出兵格:建筑外圈可通行格,优先朝向西南(玩家方向),同一格最多 3 个单位。used: Map<格, 数量>。 */
  spawnCell(b, used) {
    const map = this.game.map;
    const cells = ringCells(b)
      .filter(([x, z]) => map.walkable(x, z))
      .sort((p, q) => (p[0] - p[1]) - (q[0] - q[1]));
    for (let cap = 1; cap <= 3; cap++) {
      for (const [x, z] of cells) {
        const k = x * 1000 + z;
        const c = used.get(k) ?? 0;
        if (c >= cap) continue;
        used.set(k, c + 1);
        return { x, z };
      }
    }
    return null;
  }

  onUnitDead(u) {
    if (!u.wave) return;
    const set = this.waves.get(u.wave);
    if (!set) return;
    set.delete(u.id);
    if (set.size) return;
    this.waves.delete(u.wave);
    this.game.counters.wavesSurvived++;
    this.game.events.emit('wave:cleared', { wave: u.wave });
    this.rts.ui?.toast?.(`✅ 成功击退敌军第 ${u.wave} 波进攻!`, 'good');
  }

  serialize() {
    return { nextWave: this.nextWave, wave: this.wave, warned: this.warned, stopped: this.stopped, damageMult: this.damageMult, rebuild: this.rebuild };
  }

  load(d, units) {
    this.nextWave = d?.nextWave ?? this.diff.firstWave;
    this.wave = d?.wave ?? 0;
    this.warned = !!d?.warned;
    this.stopped = !!d?.stopped;
    this.damageMult = d?.damageMult ?? 1;
    this.rebuild = d?.rebuild ?? [];
    this.waves.clear();
    for (const u of units) {
      if (!u.wave) continue;
      if (!this.waves.has(u.wave)) this.waves.set(u.wave, new Set());
      this.waves.get(u.wave).add(u.id);
    }
  }
}
