// 选择与指令输入。选择/编队/镜头是本地 UI 状态;所有改变单位的操作都组装成纯 JSON 命令经 game.dispatch 下发,
// 便于后续锁步联机(同一命令流在各端重放得到相同结果)。
import * as THREE from 'three';
import { BUILDINGS } from '../data/buildings.js';

const DBL_MS = 350;
const tmp = new THREE.Vector3();

export class Selector {
  constructor(rts) {
    this.rts = rts;
    /** @type {Map<number, number[]>} 编队号 → 单位 id */
    this.groups = new Map();
    this.armed = null; // 'attack' = 按了 A,等待点击目标
    this.box = null;
    this.swallowUp = false;
    this.lastClick = { t: 0, id: -1 };
    this.lastDigit = { d: -1, t: 0 };
  }

  get game() { return this.rts.game; }

  dispatch(cmd) {
    const g = this.game;
    return g.dispatch ? g.dispatch(cmd) : this.rts.applyCommand(cmd);
  }

  set(list) {
    this.rts.selected = list;
    this.game.events.emit('selection', list);
  }

  mine(u) { return u.team === this.rts.local && !u.dead; }

  screenOf(u) {
    return this.rts.rig.toScreen(this.rts.views.visualPos(u, tmp));
  }

  onScreen(s) {
    const d = this.rts.rig.dom;
    return s.visible && s.x >= 0 && s.y >= 0 && s.x <= d.clientWidth && s.y <= d.clientHeight;
  }

  /** 屏幕空间拾取:离光标最近、且在其像素半径内的单位。 */
  pick(cx, cy, filter) {
    const rig = this.rts.rig;
    const pxPerUnit = rig.dom.clientHeight / (2 * rig.view);
    let best = null;
    let bestD = Infinity;
    for (const u of this.rts.units) {
      if (u.dead || (filter && !filter(u))) continue;
      const s = this.screenOf(u);
      const rad = Math.max(12, (u.r + 0.2) * pxPerUnit * 1.3);
      const d = Math.hypot(s.x - cx, s.y - cy);
      if (d < rad && d < bestD) { best = u; bestD = d; }
    }
    return best;
  }

  // ---------- 指针 ----------
  pointerDown(e, cell) {
    this.swallowUp = false;
    if (this.armed === 'attack' && e.button === 0) {
      this.swallowUp = true;
      this.attackMoveAt(e, cell);
      return true;
    }
    return false;
  }

  pointerMove(e, cell, down) {
    if (this.swallowUp || !down.moved) return false;
    this.box = { x0: down.x, y0: down.y, x1: e.clientX, y1: e.clientY };
    const o = this.rts.overlay;
    if (o) {
      Object.assign(o.style, {
        display: 'block',
        left: `${Math.min(this.box.x0, this.box.x1)}px`,
        top: `${Math.min(this.box.y0, this.box.y1)}px`,
        width: `${Math.abs(this.box.x1 - this.box.x0)}px`,
        height: `${Math.abs(this.box.y1 - this.box.y0)}px`,
      });
    }
    return true;
  }

  pointerUp(e, cell, down) {
    if (this.swallowUp) { this.swallowUp = false; return true; }
    if (this.box) {
      const b = this.box;
      this.box = null;
      if (this.rts.overlay) this.rts.overlay.style.display = 'none';
      const x0 = Math.min(b.x0, e.clientX);
      const x1 = Math.max(b.x0, e.clientX);
      const y0 = Math.min(b.y0, e.clientY);
      const y1 = Math.max(b.y0, e.clientY);
      const inside = this.rts.units.filter((u) => {
        if (!this.mine(u)) return false;
        const s = this.screenOf(u);
        return s.visible && s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1;
      });
      if (e.shiftKey) this.set([...new Set([...this.rts.selected, ...inside])]);
      else if (inside.length || this.rts.selected.length) this.set(inside);
      return true;
    }
    if (down?.moved) return false;
    const u = this.pick(e.clientX, e.clientY);
    if (!u) {
      if (!e.shiftKey && this.rts.selected.length) this.set([]);
      return false;
    }
    if (!this.mine(u)) return true; // 点到敌军单位:不当作点击建筑
    const now = performance.now();
    if (now - this.lastClick.t < DBL_MS && this.lastClick.id === u.id) {
      // 双击:选中屏幕内所有同类单位
      this.set(this.rts.units.filter((o) => this.mine(o) && o.type === u.type && this.onScreen(this.screenOf(o))));
    } else if (e.shiftKey) {
      const sel = this.rts.selected;
      this.set(sel.includes(u) ? sel.filter((o) => o !== u) : [...sel, u]);
    } else {
      this.set([u]);
    }
    this.lastClick = { t: now, id: u.id };
    return true;
  }

  // ---------- 右键指令 ----------
  command(e, cell) {
    const rts = this.rts;
    if (this.armed === 'attack') { this.attackMoveAt(e, cell); return; }
    const sel = rts.selected.filter((u) => this.mine(u));
    if (!sel.length) { this.setRally(cell); return; }
    const ids = sel.map((u) => u.id);
    const eu = this.pick(e.clientX, e.clientY, (u) => u.team !== rts.local);
    if (eu) {
      this.dispatch({ type: 'attack', p: rts.local, ids, target: { kind: 'unit', id: eu.id } });
      rts.fx.marker(eu.x, eu.z, 0xff4a3a);
      return;
    }
    if (!cell) return;
    const b = this.game.buildingAt(cell.x, cell.z);
    if (b && b.team !== rts.local) {
      this.dispatch({ type: 'attack', p: rts.local, ids, target: { kind: 'building', id: b.uid } });
      rts.fx.marker(b.x + b.w / 2, b.z + b.d / 2, 0xff4a3a);
      return;
    }
    this.dispatch({ type: 'move', p: rts.local, ids, x: cell.wx, z: cell.wz, attackMove: false });
    rts.fx.marker(cell.wx, cell.wz, 0x55ff77);
  }

  attackMoveAt(e, cell) {
    this.disarm();
    const rts = this.rts;
    const sel = rts.selected.filter((u) => this.mine(u));
    if (!sel.length || !cell) return;
    const ids = sel.map((u) => u.id);
    // A + 点在敌军单位/建筑上 = 直接攻击该目标
    const eu = this.pick(e.clientX, e.clientY, (u) => u.team !== rts.local);
    const b = this.game.buildingAt(cell.x, cell.z);
    if (eu) this.dispatch({ type: 'attack', p: rts.local, ids, target: { kind: 'unit', id: eu.id } });
    else if (b && b.team !== rts.local) this.dispatch({ type: 'attack', p: rts.local, ids, target: { kind: 'building', id: b.uid } });
    else this.dispatch({ type: 'move', p: rts.local, ids, x: cell.wx, z: cell.wz, attackMove: true });
    rts.fx.marker(cell.wx, cell.wz, 0xff4a3a);
  }

  setRally(cell) {
    const b = this.rts.ui?.selection?.building;
    if (!cell || !b || b.team !== this.rts.local || !BUILDINGS[b.type].trains) return;
    const r = this.dispatch({ type: 'rally', p: this.rts.local, uid: b.uid, x: cell.wx, z: cell.wz });
    if (r && r.ok === false) return;
    this.rts.fx.marker(cell.wx, cell.wz, 0x55ff77);
    this.rts.ui?.toast?.('已设置集结点', 'good');
  }

  disarm() {
    this.armed = null;
    this.rts.rig.dom.style.cursor = '';
  }

  clear() {
    this.disarm();
    if (this.rts.selected.length) this.set([]);
  }

  // ---------- 键盘 ----------
  key(e) {
    if (e.target instanceof HTMLInputElement) return;
    const rts = this.rts;
    const mod = e.ctrlKey || e.metaKey;
    const sel = rts.selected.filter((u) => this.mine(u));
    if (e.code === 'KeyA' && !mod && sel.length) {
      this.armed = 'attack';
      rts.rig.dom.style.cursor = 'crosshair';
      return;
    }
    if (e.code === 'KeyH' && !mod && sel.length) {
      this.dispatch({ type: 'stop', p: rts.local, ids: sel.map((u) => u.id) });
      return;
    }
    if (e.code === 'KeyF' && !mod && !e.repeat) {
      this.set(rts.units.filter((u) => this.mine(u)));
      return;
    }
    const m = /^Digit(\d)$/.exec(e.code);
    if (!m || e.repeat) return;
    const d = Number(m[1]);
    if (mod) {
      e.preventDefault();
      if (!sel.length) { this.groups.delete(d); return; }
      this.groups.set(d, sel.map((u) => u.id));
      rts.ui?.toast?.(`已编为第 ${d} 队(${sel.length} 个单位)`);
      return;
    }
    const ids = this.groups.get(d);
    if (!ids) return;
    const idSet = new Set(ids);
    const us = rts.units.filter((u) => idSet.has(u.id) && this.mine(u));
    if (!us.length) return;
    const now = performance.now();
    if (this.lastDigit.d === d && now - this.lastDigit.t < DBL_MS) {
      const cx = us.reduce((s, u) => s + u.x, 0) / us.length;
      const cz = us.reduce((s, u) => s + u.z, 0) / us.length;
      rts.rig.lookAt(cx, cz);
    }
    this.lastDigit = { d, t: now };
    this.set(us);
  }

  /** 单位死亡后从选择与编队中移除。 */
  prune(deadIds) {
    const sel = this.rts.selected;
    if (sel.some((u) => deadIds.has(u.id))) this.set(sel.filter((u) => !deadIds.has(u.id)));
    for (const [d, ids] of this.groups) {
      const left = ids.filter((id) => !deadIds.has(id));
      if (left.length) this.groups.set(d, left);
      else this.groups.delete(d);
    }
  }
}
