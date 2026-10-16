// 游戏状态与所有状态变更入口。渲染/UI/RTS 只通过这里改状态,保证校验(地块归属、成本、地形)集中一处。
import { BUILDINGS, upgradeCost } from '../data/buildings.js';
import { TECHS } from '../data/tech.js';
import { DIFFICULTIES } from '../data/difficulty.js';
import { RESOURCE_IDS } from '../data/resources.js';
import { Emitter, Rng } from '../engine/util.js';
import { LocalTransport } from '../net/transport.js';
import { GameMap, OWNER, T, PLAYER_HQ } from '../world/map.js';

export const START_RES = { money: 800, research: 0, wood: 30, stone: 20, food: 24, planks: 12, grain: 0, water: 0 };

export class Game {
  constructor(seed = 7, difficulty = 'normal') {
    this.events = new Emitter();
    this.map = new GameMap(seed);
    this.localPlayer = 'player';
    this.tick = 0;
    this.random = new Rng(seed * 2654435761);
    this.rng = () => this.random.next();
    this.transport = new LocalTransport(this);
    this.time = 0;
    this.speed = 1;
    this.paused = false;
    this.res = Object.fromEntries(['money', 'research', ...RESOURCE_IDS].map((k) => [k, 0]));
    this.difficultyId = DIFFICULTIES[difficulty] ? difficulty : 'normal';
    this.difficulty = DIFFICULTIES[this.difficultyId];
    for (const [k, v] of Object.entries(START_RES)) this.res[k] = Math.round(v * this.difficulty.startMult);
    /** @type {Map<number, object>} */
    this.buildings = new Map();
    this.nextUid = 1;
    this.techs = new Set();
    this.researching = null; // { id, progress }
    this.era = 1;
    this.stats = { storageCap: 400, housing: 6, workersNeeded: 0, powerSupply: 0, powerDemand: 0, workerRatio: 1, powerRatio: 1 };
    this.produced = Object.fromEntries(RESOURCE_IDS.map((k) => [k, 0]));
    this.counters = { unitsTrained: 0, enemyKilled: 0, wavesSurvived: 0, sold: 0 };
    this.mission = 0;
    this.buffs = [];
    this.over = null; // 'win' | 'lose'
    this.unitSystem = null; // RTS 注入
  }

  /** 玩家意图的唯一入口(UI/输入/AI 都经此),见 net/commands.js。 */
  dispatch(cmd) {
    return this.transport.send({ p: this.localPlayer, ...cmd });
  }

  /** 状态校验和:锁步联机时各端定期比对以检测不同步;回放测试也用它断言一致。 */
  checksum() {
    let h = 2166136261;
    const mix = (n) => { h = Math.imul(h ^ (Math.round(n * 1000) | 0), 16777619) >>> 0; };
    mix(this.tick);
    for (const v of Object.values(this.res)) mix(v);
    for (const b of this.buildings.values()) { mix(b.uid); mix(b.x); mix(b.z); mix(b.level); mix(b.hp); mix(b.cycle); mix(b.progress); }
    for (const u of this.unitSystem?.units ?? []) { mix(u.id); mix(u.x); mix(u.z); mix(u.hp); }
    return h.toString(16);
  }

  // ---------- 资源 ----------
  canAfford(cost, mult = 1) {
    return Object.entries(cost).every(([k, v]) => (this.res[k] ?? 0) >= Math.ceil(v * mult));
  }

  missing(cost, mult = 1) {
    return Object.entries(cost).filter(([k, v]) => (this.res[k] ?? 0) < Math.ceil(v * mult)).map(([k]) => k);
  }

  /** 全量预检后一次性扣除;不足返回 false 且不改任何值。 */
  spend(cost, mult = 1) {
    if (!this.canAfford(cost, mult)) return false;
    for (const [k, v] of Object.entries(cost)) this.res[k] -= Math.ceil(v * mult);
    this.events.emit('res');
    return true;
  }

  refund(cost, ratio) {
    for (const [k, v] of Object.entries(cost)) this.res[k] = (this.res[k] ?? 0) + Math.floor(v * ratio);
    this.events.emit('res');
  }

  /** 加入资源,受仓储上限约束;返回实际入库数量。金币/科研无上限。 */
  addRes(k, n) {
    if (k === 'money' || k === 'research') {
      this.res[k] += n;
      return n;
    }
    const room = Math.max(0, this.stats.storageCap - this.res[k]);
    const got = Math.min(room, n);
    this.res[k] += got;
    if (this.produced[k] !== undefined) this.produced[k] += got;
    return got;
  }

  hasRoomFor(out) {
    return Object.entries(out).every(([k, v]) => k === 'research' || k === 'money' || this.res[k] + v <= this.stats.storageCap);
  }

  // ---------- 解锁 ----------
  isUnlocked(type) {
    const def = BUILDINGS[type];
    return !def.tech || this.techs.has(def.tech);
  }

  // ---------- 建筑放置 ----------
  /** 返回 { ok, reason }。team=enemy 时跳过地块归属与成本(由 AI 初始化使用)。 */
  canPlace(type, x, z, team = 'player') {
    const def = BUILDINGS[type];
    const [w, d] = def.size;
    const m = this.map;
    let terrainOk = !def.terrain;
    for (let zz = z; zz < z + d; zz++) {
      for (let xx = x; xx < x + w; xx++) {
        if (!m.inside(xx, zz)) return { ok: false, reason: '超出地图' };
        const i = m.idx(xx, zz);
        if (team === 'player' && m.ownerAt(xx, zz) !== OWNER.player) return { ok: false, reason: '需先购买该地块' };
        if (m.terrain[i] === T.water) return { ok: false, reason: '不能建在水上' };
        if (m.building[i]) return { ok: false, reason: '已被占用' };
        if (m.road[i]) return { ok: false, reason: '有道路' };
        if (this.unitSystem?.groundUnitAt?.(xx, zz)) return { ok: false, reason: '有单位阻挡' };
        if (def.terrain && m.terrain[i] === T[def.terrain]) terrainOk = true;
      }
    }
    if (team !== 'player') return { ok: true };
    if (!terrainOk) return { ok: false, reason: `需覆盖${({ rock: '岩石', ore: '铁矿脉', coal: '煤层', oil: '油田' })[def.terrain]}` };
    if (def.near && !m.hasNear(x, z, w, d, T[def.near])) return { ok: false, reason: def.near === 'forest' ? '需靠近森林' : '需靠近水域' };
    if (def.unique && [...this.buildings.values()].some((b) => b.type === type && b.team === 'player')) return { ok: false, reason: '只能建造一座' };
    if (!this.isUnlocked(type)) return { ok: false, reason: `需科技:${TECHS[def.tech].name}` };
    if (!this.canAfford(def.cost)) return { ok: false, reason: '资源不足' };
    return { ok: true };
  }

  placeBuilding(type, x, z, team = 'player', { instant = false, level = 1 } = {}) {
    const check = this.canPlace(type, x, z, team);
    if (!check.ok) return { ok: false, reason: check.reason };
    const def = BUILDINGS[type];
    if (team === 'player' && !instant && !this.spend(def.cost)) return { ok: false, reason: '资源不足' };
    const [w, d] = def.size;
    const uid = this.nextUid++;
    const b = {
      uid, type, x, z, w, d, team, level,
      hp: def.hp * (1 + 0.25 * (level - 1)), maxHp: def.hp * (1 + 0.25 * (level - 1)),
      state: instant || !def.buildTime ? 'active' : 'construct',
      progress: 0, // 建造/升级进度 0..1
      cycle: 0, // 生产周期进度 0..1
      working: false,
      status: '',
      connected: false,
      sell: new Set(),
      trainQueue: [],
      trainProgress: 0,
      rally: null,
      cooldown: 0,
      fed: true,
      upkeepT: 0,
    };
    for (let zz = z; zz < z + d; zz++) {
      for (let xx = x; xx < x + w; xx++) {
        const i = this.map.idx(xx, zz);
        this.map.building[i] = uid;
        // 建在森林上会清除树木(伐木场依赖的是「附近」森林)
        if (this.map.terrain[i] === T.forest) this.map.terrain[i] = T.grass;
      }
    }
    this.map.version++;
    this.buildings.set(uid, b);
    this.events.emit('building:add', b);
    return { ok: true, building: b };
  }

  removeBuilding(b, { refund = false, destroyed = false } = {}) {
    if (!this.buildings.has(b.uid)) return;
    for (let zz = b.z; zz < b.z + b.d; zz++) {
      for (let xx = b.x; xx < b.x + b.w; xx++) this.map.building[this.map.idx(xx, zz)] = 0;
    }
    this.map.version++;
    this.buildings.delete(b.uid);
    if (refund) this.refund(BUILDINGS[b.type].cost, b.state === 'construct' ? 0.9 : 0.5);
    this.events.emit('building:remove', { b, destroyed });
    if (destroyed && b.type === 'hq') this.endGame(b.team === 'player' ? 'lose' : 'win');
  }

  demolish(uid) {
    const b = this.buildings.get(uid);
    if (!b || b.team !== 'player') return { ok: false, reason: '不是你的建筑' };
    if (b.type === 'hq') return { ok: false, reason: '不能拆除指挥中心' };
    this.removeBuilding(b, { refund: true });
    return { ok: true };
  }

  upgrade(uid) {
    const b = this.buildings.get(uid);
    if (!b || b.team !== 'player') return { ok: false, reason: '不是你的建筑' };
    const def = BUILDINGS[b.type];
    if (b.state !== 'active') return { ok: false, reason: '建筑忙碌中' };
    if (b.level >= def.maxLevel) return { ok: false, reason: '已满级' };
    if (b.type === 'hq' && b.level + 1 > this.era) return { ok: false, reason: '需先进入下一时代' };
    const cost = upgradeCost(b.type, b.level + 1);
    if (!this.spend(cost)) return { ok: false, reason: '资源不足' };
    b.state = 'upgrade';
    b.progress = 0;
    this.events.emit('building:change', b);
    return { ok: true };
  }

  damageBuilding(b, amount) {
    if (!this.buildings.has(b.uid)) return;
    b.hp -= amount;
    this.events.emit('building:hit', b);
    if (b.hp <= 0) this.removeBuilding(b, { destroyed: true });
  }

  repair(uid) {
    const b = this.buildings.get(uid);
    if (!b || b.team !== 'player' || b.hp >= b.maxHp) return { ok: false, reason: '无需维修' };
    const cost = { money: Math.ceil((b.maxHp - b.hp) * 0.3) };
    if (!this.spend(cost)) return { ok: false, reason: '金币不足' };
    b.hp = b.maxHp;
    this.events.emit('building:hit', b);
    return { ok: true };
  }

  buildingAt(x, z) {
    if (!this.map.inside(x, z)) return null;
    const uid = this.map.building[this.map.idx(x, z)];
    return uid ? this.buildings.get(uid) ?? null : null;
  }

  playerHQ() {
    for (const b of this.buildings.values()) if (b.type === 'hq' && b.team === 'player') return b;
    return null;
  }

  // ---------- 道路 ----------
  static ROAD_COST = { money: 5, stone: 1 };

  canRoad(x, z) {
    const m = this.map;
    if (!m.inside(x, z)) return { ok: false, reason: '超出地图' };
    const i = m.idx(x, z);
    if (m.ownerAt(x, z) !== OWNER.player) return { ok: false, reason: '需先购买该地块' };
    if (m.road[i]) return { ok: false, reason: '已有道路' };
    if (m.building[i]) return { ok: false, reason: '已被占用' };
    if (m.terrain[i] === T.water) return { ok: false, reason: '不能建在水上' };
    if (!this.canAfford(Game.ROAD_COST)) return { ok: false, reason: '资源不足' };
    return { ok: true };
  }

  placeRoad(x, z, free = false) {
    const c = this.canRoad(x, z);
    if (!c.ok && !(free && c.reason === '资源不足')) return c;
    if (!free && !this.spend(Game.ROAD_COST)) return { ok: false, reason: '资源不足' };
    const i = this.map.idx(x, z);
    if (this.map.terrain[i] === T.forest) this.map.terrain[i] = T.grass;
    this.map.road[i] = 1;
    this.map.version++;
    this.events.emit('road', { x, z });
    return { ok: true };
  }

  removeRoad(x, z) {
    const m = this.map;
    if (!m.inside(x, z) || !m.road[m.idx(x, z)] || m.ownerAt(x, z) !== OWNER.player) return { ok: false };
    m.road[m.idx(x, z)] = 0;
    m.version++;
    this.refund(Game.ROAD_COST, 0.5);
    this.events.emit('road', { x, z });
    return { ok: true };
  }

  // ---------- 地块扩建 ----------
  buyChunk(cx, cz) {
    if (!this.map.canBuyChunk(cx, cz)) return { ok: false, reason: '只能购买与领地相邻的无主地块' };
    const price = this.map.chunkPrice();
    if (!this.spend({ money: price })) return { ok: false, reason: `需要 ${price} 金币` };
    this.map.setChunkOwner(cx, cz, OWNER.player);
    this.events.emit('chunk', { cx, cz });
    return { ok: true };
  }

  // ---------- 科研 ----------
  canResearch(id) {
    const t = TECHS[id];
    if (this.techs.has(id)) return { ok: false, reason: '已研究' };
    if (!t.req.every((r) => this.techs.has(r))) return { ok: false, reason: '前置科技未完成' };
    if (this.researching) return { ok: false, reason: '正在研究其他科技' };
    if (this.res.research < t.cost) return { ok: false, reason: `需要 ${t.cost} 科研点` };
    return { ok: true };
  }

  /** 科研点在开始时一次性扣除,随后按时长完成(见 economy.researchDuration)。 */
  startResearch(id) {
    const c = this.canResearch(id);
    if (!c.ok) return c;
    this.res.research -= TECHS[id].cost;
    this.researching = { id, progress: 0 };
    this.events.emit('tech');
    return { ok: true };
  }

  finishTech(id) {
    this.techs.add(id);
    this.researching = null;
    const t = TECHS[id];
    if (t.era_up && t.era_up > this.era) {
      this.era = t.era_up;
      this.events.emit('era', this.era);
    }
    this.events.emit('tech', id);
  }

  /** 科技永久加成 + 随机事件临时加成(society.js 的 buffs)。 */
  effect(key) {
    let v = 0;
    for (const id of this.techs) v += TECHS[id].effect?.[key] ?? 0;
    for (const b of this.buffs) v += b.effects[key] ?? 0;
    return v;
  }

  endGame(result) {
    if (this.over) return;
    this.over = result;
    this.paused = true;
    this.events.emit('gameover', result);
  }

  /** 新局初始化:玩家指挥中心 + 一小段起始道路。 */
  setupStart() {
    this.placeBuilding('hq', PLAYER_HQ.x, PLAYER_HQ.z, 'player', { instant: true });
    for (let x = PLAYER_HQ.x - 2; x <= PLAYER_HQ.x + 5; x++) this.placeRoad(x, PLAYER_HQ.z + 3, true);
    for (let z = PLAYER_HQ.z - 2; z <= PLAYER_HQ.z + 2; z++) this.placeRoad(PLAYER_HQ.x + 3, z, true);
  }
}
