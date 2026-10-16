// 鼠标/键盘交互:按当前工具分发。select 模式下单位操作交给 RTS,点击建筑则选中建筑。
// 工具:build(放置建筑,城墙可拖拽)、road(拖拽 L 形铺路)、demolish、expand(购买地块)。
import * as THREE from 'three';
import { BUILDINGS } from '../data/buildings.js';
import { resIcon } from '../data/resources.js';
import { CHUNK, OWNER } from '../world/map.js';
import { buildingGeo } from '../models/cache.js';
import { Game } from '../sim/state.js';
import { synergyAt, SYNERGY } from '../sim/synergy.js';
import { ring } from '../sim/economy.js';
import { planRoad } from '../sim/autoroad.js';

const CLICK_PX = 6;

export class Input {
  constructor({ game, rig, scene, rts, ui, view, dom }) {
    Object.assign(this, { game, rig, scene, rts, ui, view, dom });
    this.mode = { kind: 'select' };
    this.autoRoad = true;
    this.hover = null; // {x, z}
    this.down = null;
    this.tip = document.getElementById('cursor-tip');
    this.initGhost();
    this.bind();
  }

  setMode(mode) {
    this.mode = mode;
    this.dragPath = null;
    this.ghost.visible = false;
    this.preview.clear();
    this.ui.onModeChange?.(mode);
    this.refreshGhost();
  }

  initGhost() {
    this.ghost = new THREE.Group();
    this.ghostMesh = new THREE.Mesh(undefined, new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.6 }));
    this.ghostPad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x55ff77, transparent: true, opacity: 0.35, depthWrite: false }));
    this.ghostPad.rotation.x = -Math.PI / 2;
    this.ghostPad.position.y = 0.03;
    this.ghost.add(this.ghostMesh, this.ghostPad);
    this.ghost.visible = false;
    this.scene.add(this.ghost);
    // 拖拽预览(道路/城墙)与拆除/扩地高亮
    this.preview = new THREE.Group();
    this.scene.add(this.preview);
    this.padGeo = new THREE.PlaneGeometry(0.94, 0.94).rotateX(-Math.PI / 2);
    this.okMat = new THREE.MeshBasicMaterial({ color: 0x55ff77, transparent: true, opacity: 0.45, depthWrite: false });
    this.badMat = new THREE.MeshBasicMaterial({ color: 0xff5544, transparent: true, opacity: 0.45, depthWrite: false });
  }

  nearOwnUnit(sx, sy) {
    const me = this.game.localPlayer;
    return (this.rts?.units ?? []).some((u) => {
      if (u.team !== me) return false;
      const p = this.rig.toScreen(new THREE.Vector3(u.x, 0.3, u.z));
      return Math.hypot(p.x - sx, p.y - sy) < 26;
    });
  }

  /** 双指手势开始:放弃当前单指的点击/框选/拖拽铺路。 */
  cancelPointer() {
    this.down = null;
    this.dragPath = null;
    this.preview.clear();
    if (this.rts?.sel) this.rts.sel.box = null;
    const box = document.getElementById('dragbox');
    if (box) box.style.display = 'none';
  }

  bind() {
    const d = this.dom;
    this.rig.onGestureStart = () => this.cancelPointer();
    d.addEventListener('contextmenu', (e) => e.preventDefault());
    d.addEventListener('pointerdown', (e) => this.onDown(e));
    window.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  cellAt(e) {
    const p = this.rig.groundAt(e.clientX, e.clientY);
    return p ? { x: Math.floor(p.x), z: Math.floor(p.z), wx: p.x, wz: p.z } : null;
  }

  /** 建筑放置的左上角:让光标位于占地中心。 */
  anchor(type, c) {
    const [w, d] = BUILDINGS[type].size;
    return { x: Math.floor(c.wx - w / 2 + 0.5), z: Math.floor(c.wz - d / 2 + 0.5) };
  }

  onDown(e) {
    if (this.rig.dragging || this.rig.gesturing || e.button === 1) return;
    const c = this.cellAt(e);
    this.down = { x: e.clientX, y: e.clientY, button: e.button, cell: c, moved: false, touch: e.pointerType === 'touch', hadSel: (this.rts?.selected?.length ?? 0) > 0 };
    const k = this.mode.kind;
    if (e.button === 2) {
      if (k !== 'select') { this.setMode({ kind: 'select' }); this.down = null; return; }
      this.rts?.command?.(e, c);
      this.down = null;
      return;
    }
    if (e.button !== 0 || !c) return;
    if (k === 'road' || (k === 'build' && BUILDINGS[this.mode.type].drag)) {
      this.dragPath = { from: { x: c.x, z: c.z }, to: { x: c.x, z: c.z } };
      this.refreshDrag();
      return;
    }
    if (k === 'select') this.rts?.pointerDown?.(e, c);
  }

  onMove(e) {
    if (this.rig.gesturing) return;
    if (e.target !== this.rig.dom && !this.down && !this.dragPath) {
      this.tip.style.display = 'none';
      return;
    }
    const c = this.cellAt(e);
    if (this.down && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > CLICK_PX) this.down.moved = true;
    this.hover = c;
    this.mouse = { x: e.clientX, y: e.clientY };
    if (this.dragPath && c) {
      this.dragPath.to = { x: c.x, z: c.z };
      this.refreshDrag();
    } else if (this.mode.kind === 'select' && this.down?.button === 0) {
      this.rts?.pointerMove?.(e, c, this.down);
    }
    this.refreshGhost();
  }

  onUp(e) {
    if (this.rig.gesturing) return;
    const down = this.down;
    this.down = null;
    if (this.dragPath) {
      this.commitDrag();
      return;
    }
    if (!down || down.button !== 0) return;
    const c = this.cellAt(e);
    const k = this.mode.kind;
    if (k === 'select') {
      // 触屏没有右键:已选中部队时轻点地面/敌人即下达命令,轻点己方单位仍为选择
      if (down.touch && down.hadSel && !down.moved && c && !this.nearOwnUnit(e.clientX, e.clientY)) {
        this.rts?.command?.(e, c);
        return;
      }
      const handled = this.rts?.pointerUp?.(e, c, down);
      if (!handled && !down.moved && c) {
        const b = this.game.buildingAt(c.x, c.z);
        this.ui.select(b ? { building: b } : null);
      }
      return;
    }
    if (!c || down.moved) return;
    if (k === 'build') this.tryBuild(c, e.shiftKey);
    else if (k === 'demolish') this.tryDemolish(c);
    else if (k === 'expand') this.tryExpand(c);
  }

  onKey(e) {
    if (e.target instanceof HTMLInputElement) return;
    if (e.code === 'Escape') {
      if (this.ui.closeModal()) return;
      if (this.mode.kind !== 'select') this.setMode({ kind: 'select' });
      else { this.ui.select(null); this.rts?.clearSelection?.(); }
    }
    this.ui.hotkey?.(e, this);
    this.rts?.key?.(e);
  }

  tryBuild(c, keep) {
    const type = this.mode.type;
    const a = this.anchor(type, c);
    const r = this.game.dispatch({ type: 'build', building: type, x: a.x, z: a.z, autoRoad: this.autoRoad });
    if (!r.ok) { this.ui.toast(r.reason, 'bad'); return; }
    this.ui.sound?.('place');
    // Shift 连续放置;资源不足时自动退出
    if (!keep || !this.game.canAfford(BUILDINGS[type].cost)) this.setMode({ kind: 'select' });
    this.ui.select({ building: r.building });
  }

  tryDemolish(c) {
    const b = this.game.buildingAt(c.x, c.z);
    if (b) {
      const r = this.game.dispatch({ type: 'demolish', uid: b.uid });
      if (!r.ok) this.ui.toast(r.reason, 'bad');
      else this.ui.select(null);
      return;
    }
    if (this.game.dispatch({ type: 'removeRoad', x: c.x, z: c.z }).ok) return;
    this.ui.toast('这里没有可拆除的东西', 'bad');
  }

  tryExpand(c) {
    const cx = Math.floor(c.x / CHUNK);
    const cz = Math.floor(c.z / CHUNK);
    const r = this.game.dispatch({ type: 'buyChunk', cx, cz });
    if (!r.ok) this.ui.toast(r.reason, 'bad');
    else this.ui.toast('🗺️ 领地扩张!', 'good');
  }

  // ---------- 拖拽铺设(道路 / 城墙)----------
  dragCells() {
    const { from, to } = this.dragPath;
    const cells = [];
    const sx = Math.sign(to.x - from.x) || 1;
    const sz = Math.sign(to.z - from.z) || 1;
    // L 形:先沿 x 再沿 z
    for (let x = from.x; x !== to.x + sx; x += sx) cells.push([x, from.z]);
    for (let z = from.z + sz; z !== to.z + sz; z += sz) if (to.z !== from.z) cells.push([to.x, z]);
    return cells.slice(0, 60);
  }

  refreshDrag() {
    this.preview.clear();
    const isRoad = this.mode.kind === 'road';
    const left = { ...this.game.res };
    const total = {};
    let n = 0;
    for (const [x, z] of this.dragCells()) {
      const cost = isRoad ? this.game.roadCost(x, z) : BUILDINGS.wall.cost;
      const ok = isRoad ? this.game.canRoad(x, z).ok : this.game.canPlace('wall', x, z).ok;
      const afford = Object.entries(cost).every(([k, v]) => (left[k] ?? 0) >= v);
      const good = ok && afford;
      if (good) {
        for (const [k, v] of Object.entries(cost)) { left[k] -= v; total[k] = (total[k] ?? 0) + v; }
        n++;
      }
      const m = new THREE.Mesh(this.padGeo, good ? this.okMat : this.badMat);
      m.position.set(x + 0.5, 0.04, z + 0.5);
      this.preview.add(m);
    }
    const costText = Object.entries(total).map(([k, v]) => `${resIcon(k)}${v}`).join(' ');
    this.showTip(`${isRoad ? '道路/桥梁' : '城墙'} ×${n}  ${costText}`, n === 0);
  }

  commitDrag() {
    const isRoad = this.mode.kind === 'road';
    const r = this.game.dispatch({ type: isRoad ? 'roads' : 'walls', cells: this.dragCells() });
    if (!r.ok) this.ui.toast(r.reason, 'bad');
    this.dragPath = null;
    this.preview.clear();
  }

  // ---------- 悬停预览 ----------
  refreshGhost() {
    const k = this.mode.kind;
    const c = this.hover;
    if (!c || this.dragPath) {
      if (!this.dragPath) this.tip.style.display = 'none';
      this.ghost.visible = false;
      return;
    }
    if (k === 'build') {
      this.preview.clear();
      const type = this.mode.type;
      const def = BUILDINGS[type];
      const a = this.anchor(type, c);
      const [w, d] = def.size;
      this.ghostMesh.geometry = buildingGeo(type, 1, 'player').geo;
      this.ghost.position.set(a.x + w / 2, 0, a.z + d / 2);
      this.ghostPad.scale.set(w, d, 1);
      const chk = this.game.canPlace(type, a.x, a.z);
      this.ghostPad.material.color.set(chk.ok ? 0x55ff77 : 0xff5544);
      this.ghost.visible = true;
      let extra = '';
      if (chk.ok && SYNERGY[type]) {
        const syn = synergyAt(this.game, type, a.x, a.z, w, d);
        extra = syn.bonus ? ` · 🔗 协同 +${Math.round(syn.bonus * 100)}%` : ' · 🔗 紧贴上下游可获协同加成';
      }
      if (chk.ok && (def.recipe || def.market || def.trains || def.storage) && !this.touchesNetwork(a.x, a.z, w, d)) {
        const plan = this.autoRoad ? planRoad(this.game, { x: a.x, z: a.z, w, d }) : null;
        if (plan?.length) {
          extra += ` · 🛣️ 自动铺路 ${plan.length} 格(💰${plan.length * Game.ROAD_COST.money} 🪨${plan.length * Game.ROAD_COST.stone})`;
          for (const [x, z] of plan) {
            const mm = new THREE.Mesh(this.padGeo, this.okMat);
            mm.position.set(x + 0.5, 0.05, z + 0.5);
            this.preview.add(mm);
          }
        } else extra += ' · ⚠️ 未邻接连通道路,建成后无法运转';
      }
      if (chk.ok && type === 'house') {
        const pol = this.game.society?.pollutionAt(a.x, a.z) ?? 0;
        if (pol) extra += ` · 🏭 ${pol} 处污染`;
      }
      this.showTip(chk.ok ? `${def.name}${extra} · 左键放置${def.drag ? '(可拖拽)' : ''} · Shift 连续 · 右键取消` : chk.reason, !chk.ok);
      return;
    }
    this.ghost.visible = false;
    if (k === 'road') {
      const chk = this.game.canRoad(c.x, c.z);
      const water = this.game.map.t(c.x, c.z) === 6;
      this.showTip(chk.ok ? (water ? '桥梁 · 💰30 🔩2 · 地面单位(含敌军)可通行' : '道路 · 按住拖拽铺设 · 💰5 🪨1') : chk.reason, !chk.ok);
      this.highlightCells([[c.x, c.z]], chk.ok);
    } else if (k === 'demolish') {
      const b = this.game.buildingAt(c.x, c.z);
      const road = this.game.map.inside(c.x, c.z) && this.game.map.road[this.game.map.idx(c.x, c.z)];
      if (b && b.team === 'player') {
        const cells = [];
        for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) cells.push([x, z]);
        this.highlightCells(cells, false);
        this.showTip(`拆除 ${BUILDINGS[b.type].name}(返还 50%)`, true);
      } else if (road) {
        this.highlightCells([[c.x, c.z]], false);
        this.showTip('拆除道路', true);
      } else {
        this.preview.clear();
        this.showTip('选择要拆除的建筑或道路', true);
      }
    } else if (k === 'expand') {
      const cx = Math.floor(c.x / CHUNK);
      const cz = Math.floor(c.z / CHUNK);
      const m = this.game.map;
      const ok = m.canBuyChunk(cx, cz);
      const cells = [];
      for (let z = cz * CHUNK; z < (cz + 1) * CHUNK; z++) for (let x = cx * CHUNK; x < (cx + 1) * CHUNK; x++) cells.push([x, z]);
      this.highlightCells(cells, ok);
      const owner = m.inside(c.x, c.z) ? m.chunkOwnerAt(cx, cz) : -1;
      const msg = owner === OWNER.player ? '已是你的领地' : owner === OWNER.enemy ? '敌军领地' : ok ? `购买地块 💰${m.chunkPrice()}` : '只能购买与领地相邻的地块';
      this.showTip(msg, !ok);
    } else if (k === 'select' && !this.down) {
      this.hoverTip(c);
    } else {
      this.tip.style.display = 'none';
    }
  }

  /** 选择模式悬停提示:建筑名称/等级/状态/耐久,遗迹,地形。 */
  hoverTip(c) {
    const g = this.game;
    this.preview.clear();
    const b = g.buildingAt(c.x, c.z);
    if (b && (b.team === g.localPlayer || !g.fog || g.fog.isExplored(c.x, c.z))) {
      const def = BUILDINGS[b.type];
      const mine = b.team === g.localPlayer;
      const hp = b.hp < b.maxHp ? ` · ❤️${Math.ceil((b.hp / b.maxHp) * 100)}%` : '';
      this.showTip(`${def.name} Lv${b.level}${mine ? ` · ${b.status || '待机'}` : ' · 敌方'}${hp}`, mine && /缺|未|满|不足/.test(b.status ?? ''));
      return;
    }
    if (g.ruins.at(c.x, c.z) && (!g.fog || g.fog.isExplored(c.x, c.z))) {
      this.showTip('🏛️ 古代遗迹 · 派任意单位靠近探索', false);
      return;
    }
    this.tip.style.display = 'none';
  }

  /** 预览位置是否紧贴已连通指挥中心的道路(或直接贴着指挥中心)。 */
  touchesNetwork(x, z, w, d) {
    const m = this.game.map;
    const dist = this.ui.economy.roadDist;
    const hq = this.game.playerHQ();
    return ring({ x, z, w, d }).some(([rx, rz]) => {
      if (!m.inside(rx, rz)) return false;
      const i = m.idx(rx, rz);
      return (m.road[i] && dist[i] >= 0) || (hq && m.building[i] === hq.uid);
    });
  }

  highlightCells(cells, ok) {
    this.preview.clear();
    for (const [x, z] of cells) {
      const m = new THREE.Mesh(this.padGeo, ok ? this.okMat : this.badMat);
      m.position.set(x + 0.5, 0.05, z + 0.5);
      this.preview.add(m);
    }
  }

  showTip(text, bad) {
    if (!this.mouse) return;
    this.tip.textContent = text;
    this.tip.className = bad ? 'bad' : '';
    this.tip.style.display = 'block';
    this.tip.style.left = `${this.mouse.x}px`;
    this.tip.style.top = `${this.mouse.y}px`;
  }
}
