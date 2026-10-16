// 敌军 AI:开局要塞布置 + 驻军 + 定时进攻波次。波次强度随波数与玩家时代增长,由存活的敌方兵营/战车工厂出兵。
// 被摧毁的兵营/工厂/防御塔会在 REBUILD_DELAY 后、附近无我方部队时重建;敌军指挥中心随玩家时代升级。
import { ENEMY_HQ, PLAYER_HQ, ENEMY_CHUNKS, CHUNK, CHUNKS_X, CHUNKS_Z, OWNER } from '../world/map.js';
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
const ENEMY_ECON = ['farm', 'farm', 'lumber', 'ironMine'];
const REBUILD_TYPES = new Set(['barracks', 'vehicleFactory', 'turret', 'farm', 'lumber', 'ironMine']);
const REBUILD_CLEAR_R = 8;
const EXPAND_FIRST = 480;
const EXPAND_GAP = 300;
const MAX_OUTPOSTS = 4;
// 河道浅滩附近的三条路线(x=z 对角线上 along = -18/0/+18 处)
const WAVE_ROUTES = [{ x: 14.5, z: 14.5, name: '北' }, { x: 32.5, z: 32.5, name: '中' }, { x: 50.5, z: 50.5, name: '南' }];
const isBaseChunk = (cx, cz) => ENEMY_CHUNKS.some(([a, b]) => a === cx && b === cz);

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
      // 只重建要塞内的建筑;前哨被拔除后不再重建,地块随之回归中立(见 expand/reclaim)
      const [cx, cz] = this.game.map.chunkOf(b.x, b.z);
      if (destroyed && b.team === ENEMY && REBUILD_TYPES.has(b.type) && isBaseChunk(cx, cz)) {
        this.rebuild.push({ type: b.type, x: b.x, z: b.z, at: this.game.time + REBUILD_DELAY });
      }
    });
  }

  /** 领土扩张:在与敌方领地相邻、离玩家最近的中立地块建立前哨(兵营 + 防御塔)。 */
  expand() {
    const g = this.game;
    const m = g.map;
    if (this.game.difficulty?.peaceful) return;
    if (this.expandAt === undefined) this.expandAt = EXPAND_FIRST;
    if (g.time < this.expandAt) return;
    this.expandAt = g.time + EXPAND_GAP;
    let outposts = 0;
    for (let cz = 0; cz < CHUNKS_Z; cz++) for (let cx = 0; cx < CHUNKS_X; cx++) if (m.chunkOwnerAt(cx, cz) === OWNER.enemy && !isBaseChunk(cx, cz)) outposts++;
    if (outposts >= MAX_OUTPOSTS) return;
    const cands = [];
    for (let cz = 0; cz < CHUNKS_Z; cz++) {
      for (let cx = 0; cx < CHUNKS_X; cx++) {
        if (m.chunkOwnerAt(cx, cz) !== OWNER.none) continue;
        const adj = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => {
          const nx = cx + dx;
          const nz = cz + dz;
          return nx >= 0 && nz >= 0 && nx < CHUNKS_X && nz < CHUNKS_Z && m.chunkOwnerAt(nx, nz) === OWNER.enemy;
        });
        if (!adj) continue;
        const d = Math.abs(cx * CHUNK + 4 - PLAYER_HQ.x) + Math.abs(cz * CHUNK + 4 - PLAYER_HQ.z);
        cands.push({ cx, cz, d });
      }
    }
    cands.sort((a, b) => a.d - b.d || a.cx - b.cx || a.cz - b.cz);
    for (const c of cands) {
      const spots = this.outpostSpots(c.cx, c.cz);
      if (!spots) continue;
      for (const [type, x, z] of spots) {
        const r = g.placeBuilding(type, x, z, ENEMY, { instant: true, level: type === 'turret' ? Math.min(4, g.era + 1) : 1 });
        if (r.ok) r.building.outpost = true;
      }
      m.setChunkOwner(c.cx, c.cz, OWNER.enemy);
      g.events.emit('chunk', { cx: c.cx, cz: c.cz });
      this.rts.ui?.toast?.('🚩 铁锈军团建立了新的前哨基地,领土向你逼近!', 'bad', { x: c.cx * CHUNK + 4, z: c.cz * CHUNK + 4 });
      return;
    }
  }

  /** 在地块内找兵营(2×2)与防御塔(1×1)的位置;放不下返回 null。 */
  outpostSpots(cx, cz) {
    const g = this.game;
    const x0 = cx * CHUNK;
    const z0 = cz * CHUNK;
    let bar = null;
    for (let z = z0 + 2; z < z0 + 6 && !bar; z++) for (let x = x0 + 2; x < x0 + 6 && !bar; x++) if (g.canPlace('barracks', x, z, ENEMY).ok) bar = [x, z];
    if (!bar) return null;
    let tur = null;
    for (const [dx, dz] of [[-1, -1], [2, -1], [-1, 2], [2, 2], [3, 0], [0, 3]]) {
      const x = bar[0] + dx;
      const z = bar[1] + dz;
      if (!tur && x >= x0 && z >= z0 && x < x0 + CHUNK && z < z0 + CHUNK && g.canPlace('turret', x, z, ENEMY).ok) tur = [x, z];
    }
    return tur ? [['barracks', bar[0], bar[1]], ['turret', tur[0], tur[1]]] : [['barracks', bar[0], bar[1]]];
  }

  /** 前哨地块内已无敌方建筑 → 回归中立,玩家可购买。 */
  reclaim() {
    const g = this.game;
    const m = g.map;
    for (let cz = 0; cz < CHUNKS_Z; cz++) {
      for (let cx = 0; cx < CHUNKS_X; cx++) {
        if (m.chunkOwnerAt(cx, cz) !== OWNER.enemy || isBaseChunk(cx, cz)) continue;
        let any = false;
        for (let z = cz * CHUNK; z < (cz + 1) * CHUNK && !any; z++) {
          for (let x = cx * CHUNK; x < (cx + 1) * CHUNK && !any; x++) {
            const b = g.buildingAt(x, z);
            if (b && b.team === ENEMY) any = true;
          }
        }
        if (any) continue;
        m.setChunkOwner(cx, cz, OWNER.none);
        g.events.emit('chunk', { cx, cz });
        this.rts.ui?.toast?.('🏳️ 敌军前哨已被拔除,该地块恢复中立,可以购买', 'good');
      }
    }
  }

  /** 重建与时代升级;只读模拟状态(时间/单位位置),保持确定性。 */
  maintain() {
    const g = this.game;
    this.expand();
    this.reclaim();
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
    this.guardRuins();
    this.placeEconomy();
  }

  /** 敌军经济:要塞地块内的农场/伐木场/矿场。被摧毁会削弱波次规模(见 econFactor),可被重建。 */
  placeEconomy() {
    const g = this.game;
    for (const type of ENEMY_ECON) {
      let done = false;
      for (const [cx, cz] of ENEMY_CHUNKS) {
        for (let z = cz * CHUNK; z < (cz + 1) * CHUNK - 1 && !done; z++) {
          for (let x = cx * CHUNK; x < (cx + 1) * CHUNK - 1 && !done; x++) {
            if (g.canPlace(type, x, z, ENEMY).ok && g.placeBuilding(type, x, z, ENEMY, { instant: true }).ok) done = true;
          }
        }
        if (done) break;
      }
    }
  }

  /** 存活经济建筑比例 → 波次规模倍率 0.6–1。 */
  econFactor() {
    const alive = [...this.game.buildings.values()].filter((b) => b.team === ENEMY && ENEMY_ECON.includes(b.type)).length;
    return 0.6 + 0.4 * Math.min(1, alive / ENEMY_ECON.length);
  }

  /** 部分遗迹有敌军哨兵驻守(偶数序号遗迹 2 名民兵,站岗不出击),探索需要一定兵力。 */
  guardRuins() {
    const g = this.game;
    for (const r of g.ruins?.list ?? []) {
      // 离玩家指挥中心太近的遗迹不设哨(否则会常驻「敌军压境」民心惩罚)
      if (r.id % 2 !== 0 || Math.abs(r.x - PLAYER_HQ.x) + Math.abs(r.z - PLAYER_HQ.z) < 22) continue;
      for (const [dx, dz] of [[-1, 0], [1, 1]]) {
        const c = nearestWalkable(g.map, r.x + dx + 0.5, r.z + dz + 0.5, 2, () => true);
        if (!c) continue;
        const u = this.rts.spawnUnit('militia', ENEMY, c.x + 0.5, c.z + 0.5, this.diff.enemyHp);
        u.guard = true;
        u.home = { x: c.x + 0.5, z: c.z + 0.5 };
      }
    }
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
    const wm = this.diff.waveMult * this.econFactor();
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
      // 路线在预警时决定并告知玩家,给出布防时间
      this.route = n >= 2 ? Math.floor(g.rng() * WAVE_ROUTES.length) : null;
      const r = this.route === null ? null : WAVE_ROUTES[this.route];
      g.events.emit('wave:incoming', { eta, size, wave: n, route: r?.name });
      this.rts.ui?.toast?.(`⚠️ 敌军第 ${n} 波进攻将在 ${eta} 秒后抵达!(约 ${size} 个单位${r ? `,侦察显示走${r.name}路渡口` : ''})`, 'big', r ? { x: r.x, z: r.z } : null);
    }
    if (g.time >= this.nextWave) this.launch(n);
  }

  /** 外交:进贡推迟下一波。价格随波次与时代上涨,每波只能进贡一次。 */
  tributeCost() {
    return Math.round(250 * (this.wave + 1) * this.game.era);
  }

  tribute() {
    const g = this.game;
    if (g.difficulty?.peaceful) return { ok: false, reason: '和平沙盒中敌军不会进攻' };
    if (this.stopped) return { ok: false, reason: '敌军目前没有进攻能力' };
    if (this.tributedWave === this.wave + 1) return { ok: false, reason: '本波已进贡过,敌军不再接受' };
    if (this.nextWave - g.time < 10) return { ok: false, reason: '敌军已在进军途中' };
    const cost = this.tributeCost();
    if (!g.spend({ money: cost })) return { ok: false, reason: `需要 ${cost} 金币` };
    this.tributedWave = this.wave + 1;
    this.nextWave += 120;
    this.warned = false;
    g.events.emit('tribute', { wave: this.wave + 1, delay: 120, cost });
    return { ok: true };
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
    // 第 2 波起随机选择进攻路线(北/中/南三处渡口),让单点防守不再万无一失
    const via = n >= 2 ? WAVE_ROUTES[this.route ?? 1] : null;
    this.route = null;
    this.damageMult = Math.min(1.5, 1 + 0.025 * (n - 1));
    for (const { type, b } of plan) {
      const c = this.spawnCell(b, used);
      if (!c) continue;
      const u = this.rts.spawnUnit(type, ENEMY, c.x + 0.5, c.z + 0.5, hpMult);
      u.wave = n;
      ids.add(u.id);
      if (hq) {
        orderAMove(u, hq.x + hq.w / 2, hq.z + hq.d / 2, true);
        if (via && !u.air) u.order.via = { x: via.x + (g.rng() - 0.5) * 2, z: via.z + (g.rng() - 0.5) * 2 };
      }
    }
    if (ids.size) this.waves.set(n, ids);
    // 提示由 UI 监听 wave:start 发出(带位置,可点击跳转)
    g.events.emit('wave:start', { wave: n, size: ids.size });
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
    return { nextWave: this.nextWave, wave: this.wave, warned: this.warned, stopped: this.stopped, damageMult: this.damageMult, rebuild: this.rebuild, tributedWave: this.tributedWave ?? 0, expandAt: this.expandAt, route: this.route ?? null };
  }

  load(d, units) {
    this.nextWave = d?.nextWave ?? this.diff.firstWave;
    this.wave = d?.wave ?? 0;
    this.warned = !!d?.warned;
    this.stopped = !!d?.stopped;
    this.damageMult = d?.damageMult ?? 1;
    this.rebuild = d?.rebuild ?? [];
    this.tributedWave = d?.tributedWave ?? 0;
    this.expandAt = d?.expandAt;
    this.route = d?.route ?? null;
    this.waves.clear();
    for (const u of units) {
      if (!u.wave) continue;
      if (!this.waves.has(u.wave)) this.waves.set(u.wave, new Set());
      this.waves.get(u.wave).add(u.id);
    }
  }
}
