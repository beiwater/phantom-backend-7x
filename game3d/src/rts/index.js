// RTS 战争层入口:单位模拟(固定步长、确定性)、训练、命令执行、存读档,并把渲染/输入转交子模块。
// 模拟内随机一律用 game.rng();Math.random 只出现在纯视觉特效里。
import { UNITS, TEAM_COLORS } from '../data/units.js';
import { BUILDINGS } from '../data/buildings.js';
import { TECHS } from '../data/tech.js';
import { MAP_W, MAP_H } from '../world/map.js';
import {
  makeUnit, SpatialGrid, separate, unstick, orderIdle, orderMove, orderAMove, orderAttack, orderHold,
  PATHS_PER_TICK,
} from './units.js';
import { canStand, nearestWalkable, ringCells } from './path.js';
import { think, updateTurrets, updateShells, canHit, targetPos } from './combat.js';
import { EnemyAI } from './ai.js';
import { Selector } from './select.js';
import { Effects } from './effects.js';
import { UnitViews } from './unitview.js';

const QUEUE_MAX = 5;
const UNIT_CAP = 120; // 单个玩家的部队上限(含排队),保证大规模混战帧率

class RTS {
  constructor({ game, scene, rig, view, overlay }) {
    Object.assign(this, { game, scene, rig, view, overlay });
    this.ui = null;
    this.units = [];
    /** @type {Map<number, object>} */
    this.byId = new Map();
    this.selected = [];
    this.nextId = 1;
    this.shells = [];
    this.pathBudget = PATHS_PER_TICK;
    this.turretTargets = new Map();
    this.turretIdle = new Map();
    this.hpMult = 1;
    this.grid = new SpatialGrid();
    this.fx = new Effects(scene);
    this.views = new UnitViews(this, scene);
    this.ai = new EnemyAI(this);
    this.sel = new Selector(this);
    this.hitFx = new Map();
    this.fx.visibleAt = (x, z) => this.visibleAt(x, z);
    this.bindEvents();
  }

  get local() { return this.game.localPlayer ?? 'player'; }

  /** 战争迷雾只影响本地显示与拾取,绝不进入 update(模拟必须与迷雾无关)。 */
  visibleAt(x, z) {
    const fog = this.game.fog;
    return !fog || fog.visible(x, z);
  }

  seen(u) {
    return u.team === this.local || this.visibleAt(u.x, u.z);
  }

  bindEvents() {
    const ev = this.game.events;
    ev.on('building:hit', (b) => {
      if (b.hp >= b.maxHp) return; // 维修也会触发 building:hit
      const now = performance.now();
      if (now - (this.hitFx.get(b.uid) ?? 0) < 220) return;
      this.hitFx.set(b.uid, now);
      const x = b.x + Math.random() * b.w;
      const z = b.z + Math.random() * b.d;
      this.fx.explode(x, 0.6, z, 4, [0x8a8070, 0x6a5a48, TEAM_COLORS[b.team]?.primary ?? 0x888888], 1.6, 0.2);
    });
    ev.on('building:remove', ({ b, destroyed }) => {
      this.turretTargets.delete(b.uid);
      this.turretIdle.delete(b.uid);
      this.hitFx.delete(b.uid);
      if (!destroyed) return;
      const cx = b.x + b.w / 2;
      const cz = b.z + b.d / 2;
      const tc = TEAM_COLORS[b.team] ?? TEAM_COLORS.player;
      const n = Math.min(160, 24 + b.w * b.d * 14);
      this.fx.explode(cx, 0.5, cz, n, [tc.primary, tc.dark, 0x8a8478, 0x5a5048, 0xffa040], 3.2 + b.w * 0.6, b.w * 0.7);
      this.fx.flash(cx, 0.8, cz, 1.2 + b.w * 0.5, 0xffb050);
    });
  }

  // ---------- 生成 ----------
  spawnUnit(type, team, x, z, extraMult = 1) {
    const mult = (team === this.local ? this.hpMult : 1) * extraMult;
    const u = makeUnit(this.nextId++, type, team, x, z, mult, this.game.rng ?? Math.random);
    u.baseHp = Math.round(UNITS[type].hp * extraMult);
    this.units.push(u);
    this.byId.set(u.id, u);
    this.views.add(u);
    return u;
  }

  setupEnemy() {
    this.ai.setupBase();
  }

  // ---------- 训练 ----------
  trainRate(b) {
    if (b.state !== 'active' || !b.connected) return 0;
    const s = this.game.stats;
    let r = s.workerRatio;
    if (BUILDINGS[b.type].power < 0) r *= s.powerRatio;
    return r;
  }

  queueUnit(b, unitId, p = this.local) {
    const g = this.game;
    if (!b || !g.buildings.has(b.uid) || b.team !== p) return { ok: false, reason: '不是你的建筑' };
    const ud = UNITS[unitId];
    if (!ud || !BUILDINGS[b.type].trains?.includes(unitId)) return { ok: false, reason: '该建筑不能训练此单位' };
    if (b.state !== 'active') return { ok: false, reason: b.state === 'construct' ? '建筑尚未建成' : '建筑升级中' };
    if (ud.tech && !g.techs.has(ud.tech)) return { ok: false, reason: `需科技:${TECHS[ud.tech].name}` };
    if (b.trainQueue.length >= QUEUE_MAX) return { ok: false, reason: `训练队列已满(最多 ${QUEUE_MAX} 个)` };
    if (this.armySize(p) >= UNIT_CAP) return { ok: false, reason: `部队数量已达上限 ${UNIT_CAP}` };
    // 政策「全民皆兵」等折扣;实付倍率随队列项保存,退款按实付计算,防止改政策后退款套利
    const mult = Math.max(0.3, 1 + g.effect('unitCost'));
    if (!g.spend(ud.cost, mult)) return { ok: false, reason: '资源不足' };
    b.trainQueue.push(unitId);
    b.trainPaid = b.trainPaid ?? [];
    b.trainPaid.length = b.trainQueue.length - 1;
    b.trainPaid.push(mult);
    g.events.emit('train:queue', b);
    return { ok: true };
  }

  cancelUnit(b, index, p = this.local) {
    const g = this.game;
    if (!b || !g.buildings.has(b.uid) || b.team !== p) return { ok: false, reason: '不是你的建筑' };
    if (!Number.isInteger(index) || index < 0 || index >= b.trainQueue.length) return { ok: false, reason: '队列中没有该单位' };
    const [id] = b.trainQueue.splice(index, 1);
    const [paid] = b.trainPaid?.splice(index, 1) ?? [];
    if (index === 0) b.trainProgress = 0;
    g.refund(UNITS[id].cost, paid ?? 1);
    g.events.emit('train:queue', b);
    return { ok: true };
  }

  armySize(p) {
    let n = 0;
    for (const u of this.units) if (u.team === p) n++;
    for (const b of this.game.buildings.values()) if (b.team === p) n += b.trainQueue?.length ?? 0;
    return n;
  }

  trainingInfo(b) {
    const queue = [...(b?.trainQueue ?? [])];
    if (!queue.length) return { queue, progress: 0, eta: 0 };
    const rate = Math.max(this.trainRate(b), 0.01);
    return { queue, progress: b.trainProgress, eta: ((1 - b.trainProgress) * UNITS[queue[0]].time) / rate };
  }

  updateTraining(dt) {
    const g = this.game;
    for (const b of g.buildings.values()) {
      const def = BUILDINGS[b.type];
      if (!def.trains || b.team === 'enemy' || b.state !== 'active') continue;
      if (!b.trainQueue.length) {
        b.trainProgress = 0;
        b.working = false;
        b.status = b.connected ? '待命' : '未连接道路';
        continue;
      }
      const rate = this.trainRate(b);
      const type = b.trainQueue[0];
      b.working = rate > 0;
      b.status = !b.connected ? '未连接道路' : rate <= 0 ? '缺少工人' : `训练${UNITS[type].name}`;
      if (rate <= 0) continue;
      b.trainProgress = Math.min(1, b.trainProgress + (dt * rate) / UNITS[type].time);
      if (b.trainProgress < 1) continue;
      const u = this.spawnFrom(b, type);
      if (!u) { b.status = '出口被堵塞'; continue; }
      b.trainQueue.shift();
      b.trainPaid?.shift();
      b.trainProgress = 0;
      g.counters.unitsTrained++;
      g.events.emit('unit:trained', { unit: u });
    }
  }

  /** 在建筑外圈找出生格:离集结点(或东南角)最近、且单位最少的可通行格。 */
  spawnFrom(b, type) {
    const map = this.game.map;
    const goal = b.rally ?? { x: b.x + b.w + 0.5, z: b.z + b.d + 0.5 };
    let best = null;
    let bestS = Infinity;
    for (const [x, z] of ringCells(b)) {
      if (!map.walkable(x, z)) continue;
      let crowd = 0;
      this.grid.query(x + 0.5, z + 0.5, 0.75, (o) => { if (!o.air) crowd++; return false; });
      const s = Math.hypot(x + 0.5 - goal.x, z + 0.5 - goal.z) + crowd * 2.5;
      if (s < bestS) { bestS = s; best = { x, z }; }
    }
    if (!best) return null;
    const u = this.spawnUnit(type, b.team, best.x + 0.5, best.z + 0.5);
    if (b.rally) {
      // 集结点按 3×3 错开,避免新兵叠在一起
      const k = this.game.counters.unitsTrained % 9;
      orderMove(u, b.rally.x + ((k % 3) - 1) * 0.6, b.rally.z + (Math.floor(k / 3) - 1) * 0.6);
    } else {
      orderMove(u, best.x + 0.5 + (best.x >= b.x + b.w ? 0.6 : best.x < b.x ? -0.6 : 0), best.z + 0.5 + (best.z >= b.z + b.d ? 0.6 : best.z < b.z ? -0.6 : 0));
    }
    return u;
  }

  // ---------- 模拟 ----------
  update(gdt) {
    if (!(gdt > 0)) return;
    this.pathBudget = PATHS_PER_TICK;
    this.syncHp();
    this.grid.rebuild(this.units);
    this.updateTraining(gdt);
    this.ai.update(gdt);
    for (const u of this.units) if (!u.dead) think(this, u, gdt);
    separate(this, gdt);
    updateTurrets(this, gdt);
    updateShells(this, gdt);
    this.cleanup();
  }

  /** 科技(复合装甲)提升生命上限时,按比例同步现有单位。 */
  syncHp() {
    const m = 1 + this.game.effect('unitHp');
    if (m === this.hpMult) return;
    for (const u of this.units) {
      if (u.team !== this.local) continue;
      const max = Math.round(u.baseHp * m);
      u.hp = (u.hp / u.maxHp) * max;
      u.maxHp = max;
    }
    this.hpMult = m;
  }

  cleanup() {
    if (!this.units.some((u) => u.dead)) return;
    const g = this.game;
    const dead = new Set();
    const keep = [];
    for (const u of this.units) {
      if (!u.dead) { keep.push(u); continue; }
      dead.add(u.id);
      this.byId.delete(u.id);
      this.views.remove(u);
      const tc = TEAM_COLORS[u.team] ?? TEAM_COLORS.player;
      const big = u.def.size > 0.5;
      const y = u.air ? 2.1 : 0.25;
      this.fx.explode(u.x, y, u.z, big ? 34 : 12, [tc.primary, tc.dark, tc.secondary, 0x4a4a4a, big ? 0xff9a40 : tc.primary], big ? 3.4 : 2, u.r);
      if (big) this.fx.flash(u.x, y + 0.2, u.z, 0.9, 0xffa040);
      if (u.team !== this.local) g.counters.enemyKilled++;
      g.events.emit('unit:killed', { unit: u });
      this.ai.onUnitDead(u);
    }
    this.units = keep;
    this.sel.prune(dead);
  }

  groundUnitAt(x, z) {
    for (const u of this.units) {
      if (!u.air && !u.dead && Math.floor(u.x) === x && Math.floor(u.z) === z) return true;
    }
    return false;
  }

  // ---------- 命令(经 game.dispatch → net/commands.js 路由到这里)----------
  owned(ids, p) {
    if (!Array.isArray(ids)) return [];
    const out = [];
    const seen = new Set();
    for (const id of ids) {
      const u = this.byId.get(id);
      if (!u || u.dead || u.team !== p || seen.has(id)) continue;
      seen.add(id);
      out.push(u);
    }
    return out;
  }

  resolveTarget(t) {
    if (!t || typeof t !== 'object') return null;
    if (t.kind === 'unit') { const u = this.byId.get(t.id); return u && !u.dead ? u : null; }
    if (t.kind === 'building') return this.game.buildings.get(t.id) ?? null;
    return null;
  }

  applyCommand(cmd) {
    if (!cmd || typeof cmd !== 'object' || typeof cmd.p !== 'string') return { ok: false, reason: '无效命令' };
    const p = cmd.p;
    const g = this.game;
    switch (cmd.type) {
      case 'move': {
        const us = this.owned(cmd.ids, p);
        if (!us.length) return { ok: false, reason: '没有可指挥的单位' };
        if (!Number.isFinite(cmd.x) || !Number.isFinite(cmd.z)) return { ok: false, reason: '坐标无效' };
        const x = Math.min(MAP_W - 0.3, Math.max(0.3, cmd.x));
        const z = Math.min(MAP_H - 0.3, Math.max(0.3, cmd.z));
        const slots = this.formation(us, x, z);
        us.forEach((u, i) => (cmd.attackMove ? orderAMove(u, slots[i][0], slots[i][1]) : orderMove(u, slots[i][0], slots[i][1])));
        return { ok: true, n: us.length };
      }
      case 'attack': {
        const us = this.owned(cmd.ids, p);
        if (!us.length) return { ok: false, reason: '没有可指挥的单位' };
        const t = this.resolveTarget(cmd.target);
        if (!t || t.team === p) return { ok: false, reason: '目标不存在' };
        // 打不到该目标的单位(如步兵对直升机)改为跟进到目标附近
        const cant = [];
        for (const u of us) if (canHit(u, t)) orderAttack(u, t); else cant.push(u);
        if (cant.length) {
          const c = targetPos(t);
          const slots = this.formation(cant, c.x, c.z);
          cant.forEach((u, i) => orderAMove(u, slots[i][0], slots[i][1]));
        }
        return { ok: true, n: us.length };
      }
      case 'stop': {
        const us = this.owned(cmd.ids, p);
        if (!us.length) return { ok: false, reason: '没有可指挥的单位' };
        for (const u of us) (cmd.hold ? orderHold : orderIdle)(u);
        return { ok: true, n: us.length };
      }
      case 'rally': {
        const b = g.buildings.get(cmd.uid);
        if (!b || b.team !== p || !BUILDINGS[b.type].trains) return { ok: false, reason: '不是你的军事建筑' };
        if (!Number.isFinite(cmd.x) || !Number.isFinite(cmd.z)) return { ok: false, reason: '坐标无效' };
        b.rally = { x: Math.min(MAP_W - 0.3, Math.max(0.3, cmd.x)), z: Math.min(MAP_H - 0.3, Math.max(0.3, cmd.z)) };
        return { ok: true };
      }
      case 'train':
        return this.queueUnit(g.buildings.get(cmd.uid), cmd.unit, p);
      case 'cancelTrain':
        return this.cancelUnit(g.buildings.get(cmd.uid), cmd.i, p);
      default:
        return { ok: false, reason: `未知命令 ${cmd.type}` };
    }
  }

  /**
   * 编队站位:以点击点为中心、朝行进方向排成方阵;地面单位的站位落在不可站立处时就近挪到空闲格。
   * 只依赖单位顺序与位置(确定性),各端重放结果一致。
   */
  formation(units, x, z) {
    const n = units.length;
    if (n === 1) return [[x, z]];
    const map = this.game.map;
    const cx = units.reduce((s, u) => s + u.x, 0) / n;
    const cz = units.reduce((s, u) => s + u.z, 0) / n;
    const ang = Math.atan2(x - cx, z - cz);
    const fx = Math.sin(ang);
    const fz = Math.cos(ang);
    const sp = Math.max(...units.map((u) => u.r * 2)) + 0.3;
    const cols = Math.ceil(Math.sqrt(n * 1.6));
    const rows = Math.ceil(n / cols);
    const slots = [];
    const used = new Set();
    const allAir = units.every((u) => u.air);
    for (let i = 0; i < n; i++) {
      const lx = ((i % cols) - (cols - 1) / 2) * sp;
      const lz = ((rows - 1) / 2 - Math.floor(i / cols)) * sp;
      let sx = x + fz * lx + fx * lz;
      let sz = z - fx * lx + fz * lz;
      if (!allAir && !canStand(map, sx, sz, 0.2)) {
        const c = nearestWalkable(map, sx, sz, 5, (gx, gz) => !used.has(gx * 1000 + gz));
        if (c) { sx = c.x + 0.5; sz = c.z + 0.5; used.add(c.x * 1000 + c.z); }
      }
      slots.push([sx, sz]);
    }
    // 贪心分配:按单位顺序各取最近的空位
    const taken = new Array(n).fill(false);
    return units.map((u) => {
      let bi = 0;
      let bd = Infinity;
      for (let i = 0; i < n; i++) {
        if (taken[i]) continue;
        const d = (slots[i][0] - u.x) ** 2 + (slots[i][1] - u.z) ** 2;
        if (d < bd) { bd = d; bi = i; }
      }
      taken[bi] = true;
      return slots[bi];
    });
  }

  // ---------- 渲染 ----------
  render(dt) {
    const g = this.game;
    const edt = g.over ? dt : g.paused ? 0 : dt * g.speed;
    this.views.render(dt, this.rig.camera);
    this.fx.update(dt, edt);
  }

  // ---------- 输入(本地 UI 状态)----------
  pointerDown(e, cell) { return this.sel.pointerDown(e, cell); }
  pointerMove(e, cell, down) { return this.sel.pointerMove(e, cell, down); }
  pointerUp(e, cell, down) { return this.sel.pointerUp(e, cell, down); }
  command(e, cell) { this.sel.command(e, cell); }
  key(e) { this.sel.key(e); }
  clearSelection() { this.sel.clear(); }

  // ---------- 存读档(敌方建筑由 save.js 随 game.buildings 保存,这里只存单位与波次)----------
  serialize() {
    const r3 = (v) => Math.round(v * 1000) / 1000;
    return {
      v: 1,
      nextId: this.nextId,
      units: this.units.filter((u) => !u.dead).map((u) => ({
        id: u.id, type: u.type, team: u.team, x: r3(u.x), z: r3(u.z), hp: r3(u.hp), baseHp: u.baseHp,
        heading: r3(u.heading), order: saveOrder(u.order), guard: u.guard || undefined,
        home: u.home ?? undefined, wave: u.wave ?? undefined,
      })),
      ai: this.ai.serialize(),
    };
  }

  load(data) {
    this.views.clear();
    this.units = [];
    this.byId.clear();
    this.shells = [];
    this.turretTargets.clear();
    this.turretIdle.clear();
    this.selected = [];
    this.sel.groups.clear();
    this.hpMult = 1 + this.game.effect('unitHp');
    let maxId = 0;
    const map = this.game.map;
    for (const s of data?.units ?? []) {
      if (!UNITS[s.type] || !Number.isFinite(s.x) || !Number.isFinite(s.z)) continue;
      const base = s.baseHp ?? UNITS[s.type].hp;
      const mult = (s.team === this.local ? this.hpMult : 1) * (base / UNITS[s.type].hp);
      const u = makeUnit(s.id, s.type, s.team, s.x, s.z, mult, this.game.rng ?? Math.random);
      u.baseHp = base;
      u.hp = Math.min(u.maxHp, s.hp ?? u.maxHp);
      u.heading = s.heading ?? u.heading;
      u.guard = !!s.guard;
      u.home = s.home ?? null;
      u.wave = s.wave ?? null;
      unstick(map, u);
      this.restoreOrder(u, s.order);
      this.units.push(u);
      this.byId.set(u.id, u);
      this.views.add(u);
      maxId = Math.max(maxId, u.id);
    }
    for (const u of this.units) {
      if (u.pendingTarget === undefined) continue;
      const t = this.byId.get(u.pendingTarget);
      if (t && t.team !== u.team) orderAttack(u, t);
      delete u.pendingTarget;
    }
    this.nextId = Math.max(data?.nextId ?? 1, maxId + 1);
    this.ai.load(data?.ai, this.units);
    this.game.events.emit('selection', this.selected);
  }

  restoreOrder(u, o) {
    if (!o) return;
    if (o.kind === 'move' && Number.isFinite(o.x)) orderMove(u, o.x, o.z);
    else if (o.kind === 'amove' && Number.isFinite(o.x)) orderAMove(u, o.x, o.z, !!o.hq);
    else if (o.kind === 'hold') orderHold(u);
    else if (o.kind === 'attack') {
      // 建筑已由 save.js 先行恢复;单位目标若在本次读入顺序之后则先待命
      const t = this.resolveTarget(o.target);
      if (t) orderAttack(u, t);
      else if (o.target?.kind === 'unit') u.pendingTarget = o.target.id;
    }
  }
}

function saveOrder(o) {
  if (o.kind === 'move' || o.kind === 'amove') return { kind: o.kind, x: o.x, z: o.z, hq: o.hq || undefined };
  if (o.kind === 'attack') return { kind: 'attack', target: o.t?.kind === 'unit' ? { kind: 'unit', id: o.t.id } : { kind: 'building', id: o.t?.uid } };
  return { kind: o.kind };
}

export function createRTS(opts) {
  return new RTS(opts);
}
