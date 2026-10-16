// 经济模拟:建造/升级进度、物流连通、工人与电力、生产周期、集市、民居口粮、科研。
import { BUILDINGS, levelSpeed, storageOf, housingOf } from '../data/buildings.js';
import { RESOURCES } from '../data/resources.js';
import { TECHS } from '../data/tech.js';
import { MAP_W, MAP_H } from '../world/map.js';
import { synergyAt } from './synergy.js';
import { Market } from './market.js';
import { Stats } from './stats.js';
import { Society } from './society.js';
import { Contracts } from './contracts.js';
import { Victory } from './victory.js';
import { MISSIONS } from '../data/missions.js';
import { Upkeep } from './upkeep.js';
import { GreatPeople } from './greatpeople.js';

export const MARKET_RESERVE = 20;
const RAW = new Set(['farm', 'lumber', 'quarry', 'pump', 'ironMine', 'coalMine', 'oilWell']);

export function workersOf(def, level) {
  return Math.round((def.workers ?? 0) * (1 + 0.5 * (level - 1)));
}

export function powerOf(def, level) {
  if (!def.power) return 0;
  return def.power > 0 ? Math.round(def.power * levelSpeed(level)) : def.power * level;
}

export class Economy {
  constructor(game) {
    this.game = game;
    this.statT = 0;
    /** 道路到物流枢纽的 BFS 距离,-1 = 不连通。卡车沿梯度下降行驶。 */
    this.roadDist = new Int16Array(MAP_W * MAP_H).fill(-1);
    this.lastMapVersion = -1;
    this.market = new Market(game);
    this.stats = new Stats();
    this.society = new Society(game);
    this.contracts = new Contracts(game);
    game.contracts = this.contracts;
    this.victory = new Victory(game);
    this.upkeep = new Upkeep(game);
    this.great = new GreatPeople(game);
    game.great = this.great;
    game.market = this.market;
    game.society = this.society;
    game.econStats = this.stats;
  }

  /** 固定步长推进(由 sim/loop.js 以 TICK 调用)。 */
  step(gdt) {
    const g = this.game;
    this.statT -= gdt;
    if (this.statT <= 0 || this.lastMapVersion !== g.map.version) {
      this.recomputeStats();
      this.statT = 0.5;
    }
    for (const b of g.buildings.values()) {
      if (b.team !== 'player') continue;
      this.updateBuilding(b, gdt);
    }
    this.updateResearch(gdt);
    this.market.step(gdt);
    this.stats.step(gdt);
    this.society.step(gdt);
    this.contracts.step(gdt);
    this.victory.step(gdt);
    this.missionT = (this.missionT ?? 0) - gdt;
    if (this.missionT <= 0) { this.missionT = 0.5; this.checkMission(); }
    g.ruins.step(gdt);
    g.weather.step(gdt);
    this.upkeep.step(gdt);
    this.great.step(gdt);
  }

  /** 主线目标在模拟内结算(按 tick 计时),保证回放/锁步时奖励发放时机一致。 */
  checkMission() {
    const g = this.game;
    const m = MISSIONS[g.mission];
    if (!m || m.progress(g) < 1) return;
    for (const [k, v] of Object.entries(m.reward)) if (v) g.addRes(k, v);
    g.mission++;
    g.events.emit('mission:done', m);
  }

  recomputeStats() {
    const g = this.game;
    this.lastMapVersion = g.map.version;
    this.computeConnectivity();
    let storage = 0;
    let housing = 0;
    let need = 0;
    let supply = 0;
    let demand = 0;
    for (const b of g.buildings.values()) {
      if (b.team !== 'player' || b.state === 'construct') continue;
      const def = BUILDINGS[b.type];
      const lvl = b.level;
      storage += storageOf(b.type, lvl);
      housing += housingOf(b.type, lvl) * (b.fed ? 1 : 0.5);
      b.synergy = synergyAt(g, b.type, b.x, b.z, b.w, b.d, b.team, b.uid);
      if (b.module === 'storage') storage += 150;
      if (b.state !== 'active' || b.paused) continue;
      if (def.recipe || def.market || def.trains) need += Math.ceil(workersOf(def, lvl) * (b.module === 'eco' ? 0.7 : 1));
      const p = powerOf(def, lvl);
      if (p > 0 && b.working) supply += p;
      if (p < 0) demand -= p;
    }
    const s = g.stats;
    s.storageCap = Math.floor(storage * (1 + g.effect('storage')));
    s.housing = Math.floor(housing * (1 + g.effect('housing')));
    s.workersNeeded = need;
    s.powerSupply = supply;
    s.powerDemand = demand;
    s.workerRatio = need === 0 ? 1 : Math.min(1, s.housing / need);
    this.society.recompute();
    s.powerRatio = demand === 0 ? 1 : Math.min(1, supply / demand);
  }

  /** 物流网:与指挥中心相邻的道路为起点 BFS;建筑邻接已连通道路或直接贴着枢纽即算连通。 */
  computeConnectivity() {
    const g = this.game;
    const m = g.map;
    const dist = this.roadDist;
    dist.fill(-1);
    const queue = [];
    const hq = g.playerHQ();
    if (hq) {
      for (const [x, z] of ring(hq)) {
        if (m.inside(x, z) && m.road[m.idx(x, z)] && dist[m.idx(x, z)] < 0) {
          dist[m.idx(x, z)] = 0;
          queue.push(m.idx(x, z));
        }
      }
    }
    for (let qi = 0; qi < queue.length; qi++) {
      const i = queue[qi];
      const x = i % MAP_W;
      const z = (i - x) / MAP_W;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const nz = z + dz;
        if (!m.inside(nx, nz)) continue;
        const ni = m.idx(nx, nz);
        if (m.road[ni] && dist[ni] < 0) {
          dist[ni] = dist[i] + 1;
          queue.push(ni);
        }
      }
    }
    for (const b of g.buildings.values()) {
      if (b.team !== 'player') continue;
      if (b.type === 'hq') { b.connected = true; continue; }
      b.connected = ring(b).some(([x, z]) => {
        if (!m.inside(x, z)) return false;
        const i = m.idx(x, z);
        if (m.road[i] && dist[i] >= 0) return true;
        return hq && m.building[i] === hq.uid;
      });
    }
  }

  /** 建筑旁一格连通道路(卡车起点)。 */
  roadNear(b) {
    const m = this.game.map;
    let best = null;
    for (const [x, z] of ring(b)) {
      if (!m.inside(x, z)) continue;
      const d = this.roadDist[m.idx(x, z)];
      if (m.road[m.idx(x, z)] && d >= 0 && (!best || d < best.d)) best = { x, z, d };
    }
    return best;
  }

  /** 沿 BFS 距离梯度下降得到到枢纽的道路路径。 */
  pathToHub(b) {
    const start = this.roadNear(b);
    if (!start) return null;
    const m = this.game.map;
    const path = [[start.x, start.z]];
    let { x, z } = start;
    let d = start.d;
    while (d > 0) {
      let moved = false;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const nz = z + dz;
        if (!m.inside(nx, nz)) continue;
        const nd = this.roadDist[m.idx(nx, nz)];
        if (m.road[m.idx(nx, nz)] && nd === d - 1) {
          x = nx; z = nz; d = nd; moved = true;
          path.push([x, z]);
          break;
        }
      }
      if (!moved) break;
    }
    return path;
  }

  efficiency(b, def) {
    const s = this.game.stats;
    let e = s.workerRatio;
    if (def.power < 0) e *= s.powerRatio;
    if (def.recipe) {
      const g = this.game;
      const bonus = (RAW.has(b.type) ? g.effect('raw') : g.effect('process')) + g.effect(b.type) + g.effect('prod');
      e *= Math.max(0.1, 1 + bonus + (b.synergy?.bonus ?? 0) + (b.module === 'speed' ? 0.25 : 0)) * this.society.productivity();
    }
    return e * levelSpeed(b.level);
  }

  updateBuilding(b, gdt) {
    const g = this.game;
    const def = BUILDINGS[b.type];
    if (b.state === 'construct') {
      b.progress += gdt / def.buildTime;
      b.status = '建造中';
      if (b.progress >= 1) {
        b.state = 'active';
        b.progress = 0;
        g.events.emit('building:change', b);
        g.events.emit('building:done', b);
        g.counters.built = (g.counters.built ?? 0) + 1;
        this.statT = 0;
      }
      return;
    }
    if (b.state === 'upgrade') {
      b.progress += gdt / (def.buildTime * 0.6 * b.level + 4);
      b.status = '升级中';
      if (b.progress >= 1) {
        b.level++;
        const ratio = b.hp / b.maxHp;
        b.maxHp = def.hp * (1 + 0.25 * (b.level - 1));
        b.hp = b.maxHp * ratio;
        b.state = 'active';
        b.progress = 0;
        g.events.emit('building:change', b);
        g.events.emit('building:done', b);
        this.statT = 0;
      }
      return;
    }

    if (b.paused) {
      b.working = false;
      b.status = '已暂停';
      return;
    }
    if (def.upkeep) this.updateHouse(b, def, gdt);
    if (def.income) {
      b.cycle += gdt / def.income.time;
      b.working = true;
      b.status = '征税中';
      if (b.cycle >= 1) {
        b.cycle -= 1;
        const amount = Math.round((def.income.money * b.level + Math.floor(g.stats.housing / 4)) * this.society.taxMult());
        g.addRes('money', amount);
        this.stats.made('money', amount);
        g.events.emit('produce', { b, out: { money: amount }, noTruck: true });
      }
    }
    if (def.recipe) this.updateRecipe(b, def, gdt);
    else if (def.market) this.updateMarket(b, def, gdt);
    else if (!def.income && !def.upkeep) b.status = def.storage ? '仓储中' : b.status;
  }

  updateHouse(b, def, gdt) {
    const g = this.game;
    b.upkeepT += gdt;
    b.working = b.fed;
    b.status = b.fed ? '居民安居' : '缺少食物';
    if (b.upkeepT >= def.upkeep.time) {
      b.upkeepT = 0;
      const need = def.upkeep.food * b.level;
      if (g.res.food >= need) {
        g.res.food -= need;
        this.stats.used('food', need);
        b.fed = true;
      } else {
        b.fed = false;
      }
    }
  }

  updateRecipe(b, def, gdt) {
    const g = this.game;
    const r = def.recipe;
    if (!b.connected) {
      b.working = false;
      b.status = '未连接道路';
      return;
    }
    if (b.cycle <= 0) {
      if (!g.hasRoomFor(r.out)) {
        b.working = false;
        b.status = '仓库已满';
        return;
      }
      if (!g.canAfford(r.in)) {
        b.working = false;
        b.status = `缺少${g.missing(r.in).map((k) => RESOURCES[k]?.name ?? k).join('、')}`;
        return;
      }
      g.spend(r.in);
      for (const [k, v] of Object.entries(r.in)) this.stats.used(k, v);
      b.cycle = 0.0001;
    }
    const eff = this.efficiency(b, def);
    b.working = eff > 0;
    b.status = eff <= 0 ? '缺少工人' : g.stats.workerRatio < 1 ? '工人不足·减速' : def.power < 0 && g.stats.powerRatio < 1 ? '电力不足·减速' : '生产中';
    b.cycle += (gdt * eff) / r.time;
    b.eta = ((1 - b.cycle) * r.time) / Math.max(eff, 0.01);
    if (b.cycle >= 1) {
      b.cycle = 0;
      const got = {};
      for (const [k, v] of Object.entries(r.out)) {
        got[k] = g.addRes(k, k === 'research' ? Math.round(v * (1 + g.effect('research'))) : v);
        if (k === 'research') g.counters.researchMade = (g.counters.researchMade ?? 0) + got[k];
        this.stats.made(k, got[k]);
      }
      if (Object.keys(got).length) g.events.emit('produce', { b, out: got });
      g.events.emit('res');
    }
  }

  updateMarket(b, def, gdt) {
    const g = this.game;
    if (!b.connected) {
      b.working = false;
      b.status = '未连接道路';
      return;
    }
    if (b.sell.size === 0) {
      b.working = false;
      b.status = '未选择出售货物';
      return;
    }
    const eff = this.efficiency(b, def);
    b.cycle += (gdt * eff) / def.market.time;
    b.working = true;
    b.status = '交易中';
    b.eta = ((1 - b.cycle) * def.market.time) / Math.max(eff, 0.01);
    if (b.cycle < 1) return;
    b.cycle = 0;
    let earned = 0;
    const per = def.market.perCycle * b.level;
    for (const k of b.sell) {
      // 保留库存:集市不会把货卖空,避免建材/口粮被卖光(平衡机器人发现的卡死)
      const n = Math.min(per, Math.floor(g.res[k] - (b.reserve ?? MARKET_RESERVE)));
      if (n <= 0) continue;
      g.res[k] -= n;
      earned += this.market.sell(k, n, (0.8 + 0.1 * b.level) * Math.max(0.2, 1 + g.effect('marketPrice')));
      this.stats.used(k, n);
      g.counters.sold += n;
    }
    if (earned > 0) {
      g.addRes('money', earned);
      this.stats.made('money', earned);
      g.counters.marketMoney = (g.counters.marketMoney ?? 0) + earned;
      g.events.emit('produce', { b, out: { money: earned }, noTruck: true });
      g.events.emit('res');
    } else {
      b.status = '货物售罄';
    }
  }

  updateResearch(gdt) {
    const g = this.game;
    g.pumpResearchQueue();
    const r = g.researching;
    if (!r) return;
    r.progress += gdt / researchDuration(r.id);
    if (r.progress >= 1) g.finishTech(r.id);
  }
}

/** 建造/升级剩余游戏秒数(用于加速报价与标签倒计时)。 */
export function remainingBuild(b) {
  const def = BUILDINGS[b.type];
  if (b.state === 'construct') return (1 - b.progress) * def.buildTime;
  if (b.state === 'upgrade') return (1 - b.progress) * (def.buildTime * 0.6 * b.level + 4);
  return 0;
}

/** 加速报价:每剩余 1 秒 3 金币 × 等级,至少 10。 */
export function rushCost(b) {
  return Math.max(10, Math.ceil(remainingBuild(b) * 3 * b.level));
}

export function researchDuration(id) {
  return 6 + TECHS[id].cost / 10;
}

/** 建筑外围一圈格子(四邻接)。 */
export function ring(b) {
  const cells = [];
  for (let x = b.x; x < b.x + b.w; x++) cells.push([x, b.z - 1], [x, b.z + b.d]);
  for (let z = b.z; z < b.z + b.d; z++) cells.push([b.x - 1, z], [b.x + b.w, z]);
  return cells;
}
