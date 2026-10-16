// 战斗:单位命令状态机(待命/移动/攻击/攻击移动/固守)、索敌、开火、伤害、防御塔与炮弹。
import { BUILDINGS } from '../data/buildings.js';
import { isUnit, navigate, stopNav, orderIdle, AIR_Y } from './units.js';
import { supplied, SUPPLY_PENALTY } from '../sim/upkeep.js';

const SCAN = 0.4; // 索敌间隔(秒),错峰降低开销
const HQ_GUN = { range: 6, damage: 8, cooldown: 1.2 }; // 双方指挥中心的自卫火力(较弱,随等级提升),保证新手能扛住首波
const TOP_TYPES = new Set(['tank', 'artillery']);

export function alive(rts, t) {
  if (!t) return false;
  return isUnit(t) ? !t.dead : rts.game.buildings.has(t.uid);
}

export function targetPos(t) {
  return isUnit(t) ? { x: t.x, z: t.z } : { x: t.x + t.w / 2, z: t.z + t.d / 2 };
}

function rectDist(x, z, b) {
  const dx = Math.max(b.x - x, 0, x - (b.x + b.w));
  const dz = Math.max(b.z - z, 0, z - (b.z + b.d));
  return Math.hypot(dx, dz);
}

export function distTo(u, t) {
  if (isUnit(t)) return Math.max(0, Math.hypot(t.x - u.x, t.z - u.z) - t.r);
  return rectDist(u.x, u.z, t);
}

export function canHit(u, t) {
  if (!t || t.team === u.team) return false;
  if (isUnit(t)) return t.air ? !!u.def.antiAir : true;
  return true;
}

const tooClose = (u, d) => !!u.def.minRange && d < u.def.minRange;

/**
 * 在 (ox,oz) 半径 R 内找最近的可攻击目标:优先单位;没有单位时考虑建筑(防御塔优先,
 * 城墙不主动攻击——只在被挡路或玩家明确下令时才打)。
 */
export function acquire(rts, u, R, ox = u.x, oz = u.z, withBuildings = true) {
  let best = null;
  let bestS = Infinity;
  rts.grid.query(ox, oz, R + 1, (o) => {
    if (!canHit(u, o)) return false;
    if (Math.hypot(o.x - ox, o.z - oz) - o.r > R) return false;
    const d = distTo(u, o);
    if (tooClose(u, d)) return false;
    if (d < bestS) { bestS = d; best = o; }
    return false;
  });
  if (best || !withBuildings) return best;
  for (const b of rts.game.buildings.values()) {
    if (b.team === u.team || b.type === 'wall') continue;
    if (rectDist(ox, oz, b) > R) continue;
    const d = distTo(u, b);
    if (tooClose(u, d)) continue;
    const s = d - (b.type === 'turret' ? 3 : 0);
    if (s < bestS) { bestS = s; best = b; }
  }
  return best;
}

// ---------- 单位思考 ----------
export function think(rts, u, dt) {
  u.moving = false;
  if (u.cd > 0) u.cd -= dt;
  u.scanT -= dt;
  const o = u.order;
  if (u.target && !alive(rts, u.target)) {
    // 被呼救去反击的单位打完后回到原位(驻守语义)
    if (u.alerted && o.kind === 'idle') u.returning = true;
    u.target = null;
    u.forced = false;
    u.alerted = false;
  }
  if (u.breach && !alive(rts, u.breach)) u.breach = null;
  switch (o.kind) {
    case 'move':
      if (navigate(rts, u, o.x, o.z, dt) === 'arrived') orderIdle(u);
      return;
    case 'attack':
      if (!u.target) {
        if (!alive(rts, o.t)) { orderIdle(u); return; }
        u.target = o.t;
        u.forced = true;
      }
      engage(rts, u, u.target, dt);
      return;
    case 'hold':
      if (u.scanT <= 0) { u.scanT = SCAN; if (!u.target) u.target = acquire(rts, u, u.def.range); }
      if (u.target) {
        const d = distTo(u, u.target);
        if (d <= u.def.range && !tooClose(u, d)) fireAt(rts, u, u.target);
        else u.target = null;
      }
      return;
    case 'amove':
      thinkAMove(rts, u, o, dt);
      return;
    default:
      thinkIdle(rts, u, dt);
  }
}

function thinkAMove(rts, u, o, dt) {
  const R = Math.max(u.def.range, 4) + 1.5;
  if (u.scanT <= 0) {
    u.scanT = SCAN;
    // 正在拆建筑时一旦出现可攻击单位立即转火
    if (!u.target || !isUnit(u.target)) {
      const t = acquire(rts, u, R, u.x, u.z, !u.target);
      if (t) { u.target = t; u.forced = false; }
    }
  }
  if (u.target) {
    if (!u.forced && distTo(u, u.target) > R + 4) u.target = null;
    else { engage(rts, u, u.target, dt); return; }
  }
  if (o.hq) {
    const hq = rts.game.playerHQ();
    if (!hq) { orderIdle(u); return; }
    const c = targetPos(hq);
    if (navigate(rts, u, c.x, c.z, dt, { rect: hq }) === 'arrived') {
      u.target = u.breach ?? hq;
      u.forced = true;
      u.breach = null;
    }
    return;
  }
  if (navigate(rts, u, o.x, o.z, dt) === 'arrived') orderIdle(u);
}

function thinkIdle(rts, u, dt) {
  const guard = u.guard && u.home;
  const base = guard ? u.home : u.anchor;
  if (u.scanT <= 0) {
    u.scanT = SCAN;
    if (!u.target || !isUnit(u.target)) {
      // 驻军:以家为圆心 7 格警戒;普通单位原地待命只打射程内目标
      const t = guard ? acquire(rts, u, 7, base.x, base.z) : acquire(rts, u, u.def.range + 0.3);
      if (t) { u.target = t; u.alerted = !!guard; }
    }
  }
  if (u.target) {
    const leash = guard ? 9 : Math.max(u.def.range * 1.5, 5) + 3;
    const p = targetPos(u.target);
    if (Math.hypot(p.x - base.x, p.z - base.z) > leash) {
      u.target = null;
      u.alerted = false;
      u.returning = true;
    } else if (u.alerted) {
      engage(rts, u, u.target, dt);
      return;
    } else {
      const d = distTo(u, u.target);
      if (d <= u.def.range && !tooClose(u, d)) { stopNav(u); fireAt(rts, u, u.target); return; }
      u.target = null;
    }
  }
  if (guard ? Math.hypot(u.x - base.x, u.z - base.z) > 2.5 || u.returning : u.returning) {
    if (navigate(rts, u, base.x, base.z, dt) === 'arrived') u.returning = false;
  }
}

/** 接战:射程内就地开火,否则靠近(单位目标追击,建筑目标走到占地旁;被墙挡住就拆墙)。 */
function engage(rts, u, t, dt) {
  const d = distTo(u, t);
  const p = targetPos(t);
  if (tooClose(u, d)) {
    // 火炮被贴身:向反方向后撤到最小射程外
    const dx = u.x - p.x;
    const dz = u.z - p.z;
    const l = Math.hypot(dx, dz) || 1;
    const k = u.def.minRange + 1 - l;
    navigate(rts, u, u.x + (dx / l) * k, u.z + (dz / l) * k, dt);
    return;
  }
  if (d <= u.def.range) {
    stopNav(u);
    fireAt(rts, u, t);
    return;
  }
  if (isUnit(t)) {
    navigate(rts, u, p.x, p.z, dt, { chase: true });
    return;
  }
  if (navigate(rts, u, p.x, p.z, dt, { rect: t }) === 'arrived' && u.breach) {
    u.target = u.breach;
    u.forced = true;
    u.breach = null;
  }
}

function fireAt(rts, u, t) {
  const p = targetPos(t);
  const yaw = Math.atan2(p.x - u.x, p.z - u.z);
  u.aimYaw = yaw;
  if (!TOP_TYPES.has(u.type)) u.heading = yaw;
  if (u.cd > 0) return;
  u.cd = u.def.cooldown;
  fire(rts, u, t, p);
}

export function muzzle(u) {
  const yaw = u.aimYaw ?? u.heading;
  const reach = u.r + 0.12;
  const y = u.air ? AIR_Y - 0.15 : u.type === 'tank' ? 0.42 : u.type === 'artillery' ? 0.5 : 0.32;
  return { x: u.x + Math.sin(yaw) * reach, y, z: u.z + Math.cos(yaw) * reach };
}

function hitY(t) {
  if (isUnit(t)) return t.air ? AIR_Y : 0.28;
  return t.type === 'wall' ? 0.5 : 0.7;
}

function fire(rts, u, t, p) {
  const g = rts.game;
  // 老兵军衔:每颗星 +15% 伤害(见 hurt 中的击杀计数)
  const dmg = u.def.damage * (u.team === 'player' ? 1 + g.effect('unitDamage') : rts.ai.damageMult) * (1 + 0.15 * (u.rank ?? 0))
    * (supplied(g, u) ? 1 : SUPPLY_PENALTY);
  const m = muzzle(u);
  const enemy = u.team === 'enemy';
  u.fireT = g.time;
  if (u.def.splash) {
    const dist = Math.hypot(p.x - u.x, p.z - u.z);
    const dur = 0.7 + dist * 0.07;
    rts.shells.push({ x: p.x, z: p.z, t: dur, dmg, team: u.team, splash: u.def.splash, src: u });
    rts.fx.projectile(m, { x: p.x, y: 0.1, z: p.z }, dur, 1.2 + dist * 0.22, 0xffb040, 0.14);
    rts.fx.flash(m.x, m.y, m.z, 0.5, 0xffc060);
    return;
  }
  const ty = hitY(t);
  hurt(rts, t, dmg, u);
  if (u.type === 'tank') {
    rts.fx.projectile(m, { x: p.x, y: ty, z: p.z }, 0.12, 0, 0xffe0a0, 0.1);
    rts.fx.flash(m.x, m.y, m.z, 0.45, 0xffd070);
    rts.fx.puff(p.x, ty, p.z, 6, 0x6a5a48);
  } else if (u.type === 'militia') {
    rts.fx.flash(p.x, ty + 0.1, p.z, 0.22, 0xffffff);
  } else {
    rts.fx.tracer(m, { x: p.x + (Math.random() - 0.5) * 0.2, y: ty, z: p.z + (Math.random() - 0.5) * 0.2 }, enemy ? 0xff8a6a : 0xffe890);
    rts.fx.flash(m.x, m.y, m.z, 0.22, 0xfff0a0);
  }
}

export function hurt(rts, t, dmg, src) {
  if (isUnit(t)) {
    if (t.dead) return;
    t.hp -= dmg;
    t.hitT = rts.game.time;
    t.lastAttacker = src;
    if (t.hp <= 0) {
      t.hp = 0;
      t.dead = true;
      if (src && isUnit(src) && !src.dead) promote(rts, src);
      return;
    }
  } else {
    rts.game.damageBuilding(t, dmg);
  }
  if (src && alive(rts, src)) alertAround(rts, targetPos(t), t.team, src, t);
}

const RANK_KILLS = [2, 5, 10];
export const RANK_NAMES = ['新兵', '老兵', '精锐', '王牌'];

/** 击杀计数 → 军衔(最多 3 星);晋升时回复 20% 生命。 */
function promote(rts, u) {
  u.kills = (u.kills ?? 0) + 1;
  const rank = RANK_KILLS.filter((k) => u.kills >= k).length;
  if (rank > (u.rank ?? 0)) {
    u.rank = rank;
    u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.2);
    rts.game.events.emit('unit:promoted', { unit: u, rank });
  }
}

/** 受击呼救:附近待命友军(含受击者本身)若能打到攻击者,就去反击。 */
function alertAround(rts, p, team, attacker, victim) {
  const now = rts.game.time;
  if (victim.alertT !== undefined && now - victim.alertT < 0.5) return;
  if (isUnit(victim)) victim.alertT = now;
  const ap = targetPos(attacker);
  rts.grid.query(p.x, p.z, 6, (o) => {
    if (o.team !== team || o.order.kind !== 'idle' || (o.target && isUnit(o.target)) || !canHit(o, attacker)) return false;
    const reach = Math.max(o.def.range * 1.5, 5);
    if (Math.hypot(o.x - ap.x, o.z - ap.z) > reach + 1) return false;
    o.target = attacker;
    o.alerted = true;
    return false;
  });
}

// ---------- 炮弹(火炮落地结算范围伤害,伤害随距离衰减)----------
export function updateShells(rts, dt) {
  if (!rts.shells.length) return;
  const g = rts.game;
  rts.shells = rts.shells.filter((s) => {
    s.t -= dt;
    if (s.t > 0) return true;
    const src = s.src && !s.src.dead ? s.src : null;
    const hits = [];
    rts.grid.query(s.x, s.z, s.splash + 0.5, (o) => {
      if (o.team === s.team || o.air) return false;
      const d = Math.max(0, Math.hypot(o.x - s.x, o.z - s.z) - o.r);
      if (d <= s.splash) hits.push([o, d]);
      return false;
    });
    for (const b of g.buildings.values()) {
      if (b.team === s.team) continue;
      const d = rectDist(s.x, s.z, b);
      if (d <= s.splash) hits.push([b, d]);
    }
    for (const [t, d] of hits) hurt(rts, t, s.dmg * (1 - 0.5 * (d / s.splash)), src);
    rts.fx.explode(s.x, 0.15, s.z, 14, [0x5a4a3a, 0x8a7a5a, 0xffa040], 2.6);
    rts.fx.flash(s.x, 0.4, s.z, 1.2, 0xffa040);
    return false;
  });
}

// ---------- 防御塔 + 敌军指挥中心 ----------
export function updateTurrets(rts, dt) {
  const g = rts.game;
  for (const b of g.buildings.values()) {
    const isTurret = b.type === 'turret';
    if (!isTurret && b.type !== 'hq') continue;
    if (b.state !== 'active') continue;
    const cfg = isTurret ? BUILDINGS.turret.turret : HQ_GUN;
    b.cooldown = (b.cooldown ?? 0) - dt;
    const cx = b.x + b.w / 2;
    const cz = b.z + b.d / 2;
    // 目标对象不挂在建筑上(建筑会被存档序列化),放在 rts 的 Map 里
    let t = rts.turretTargets.get(b.uid);
    if (t && (t.dead || Math.hypot(t.x - cx, t.z - cz) - t.r > cfg.range)) t = null;
    if (!t) {
      let bestD = Infinity;
      rts.grid.query(cx, cz, cfg.range + 1, (o) => {
        if (o.team === b.team) return false;
        const d = Math.hypot(o.x - cx, o.z - cz) - o.r;
        if (d <= cfg.range && d < bestD) { bestD = d; t = o; }
        return false;
      });
    }
    if (!t) {
      rts.turretTargets.delete(b.uid);
      const idle = (rts.turretIdle.get(b.uid) ?? 0) + dt;
      rts.turretIdle.set(b.uid, idle);
      if (idle > 3 && isTurret) b.aim = null;
      continue;
    }
    rts.turretTargets.set(b.uid, t);
    rts.turretIdle.set(b.uid, 0);
    const yaw = Math.atan2(t.x - cx, t.z - cz);
    if (isTurret) b.aim = yaw;
    if (b.cooldown > 0) continue;
    b.cooldown = cfg.cooldown;
    let dmg = isTurret ? cfg.damage : cfg.damage * b.level;
    let boosted = false;
    if (isTurret) {
      dmg *= 1 + 0.25 * (b.level - 1);
      if (b.team === 'player') {
        dmg *= 1 + g.effect('turretDamage');
        if ((g.res.ammo ?? 0) >= cfg.ammoPerShot) {
          g.res.ammo -= cfg.ammoPerShot;
          dmg *= 2;
          boosted = true;
        }
      }
    }
    const my = isTurret ? 1.05 : 1.6;
    const m = { x: cx + Math.sin(yaw) * 0.45, y: my, z: cz + Math.cos(yaw) * 0.45 };
    const ty = t.air ? AIR_Y : 0.3;
    hurt(rts, t, dmg, b);
    rts.fx.projectile(m, { x: t.x, y: ty, z: t.z }, 0.1, 0, b.team === 'player' ? (boosted ? 0xffe060 : 0x9fd8ff) : 0xff7050, boosted ? 0.13 : 0.09);
    rts.fx.flash(m.x, m.y, m.z, boosted ? 0.5 : 0.32, boosted ? 0xffd040 : 0xfff0c0);
  }
}
