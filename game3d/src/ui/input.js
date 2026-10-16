// 鼠标/键盘交互:按当前工具分发。select 模式下单位操作交给 RTS,点击建筑则选中建筑。
// 工具:build(放置建筑,城墙可拖拽)、road(拖拽 L 形铺路)、demolish、expand(购买地块)。
import * as THREE from 'three';
import { BUILDINGS } from '../data/buildings.js';
import { CHUNK, OWNER } from '../world/map.js';
import { buildingGeo } from '../models/cache.js';
import { Game } from '../sim/state.js';

const CLICK_PX = 6;

export class Input {
  constructor({ game, rig, scene, rts, ui, view, dom }) {
    Object.assign(this, { game, rig, scene, rts, ui, view, dom });
    this.mode = { kind: 'select' };
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

  bind() {
    const d = this.dom;
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
    if (this.rig.dragging || e.button === 1) return;
    const c = this.cellAt(e);
    this.down = { x: e.clientX, y: e.clientY, button: e.button, cell: c, moved: false };
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
    const r = this.game.placeBuilding(type, a.x, a.z);
    if (!r.ok) { this.ui.toast(r.reason, 'bad'); return; }
    this.ui.sound?.('place');
    // Shift 连续放置;资源不足时自动退出
    if (!keep || !this.game.canAfford(BUILDINGS[type].cost)) this.setMode({ kind: 'select' });
    this.ui.select({ building: r.building });
  }

  tryDemolish(c) {
    const b = this.game.buildingAt(c.x, c.z);
    if (b) {
      const r = this.game.demolish(b.uid);
      if (!r.ok) this.ui.toast(r.reason, 'bad');
      else this.ui.select(null);
      return;
    }
    if (this.game.removeRoad(c.x, c.z).ok) return;
    this.ui.toast('这里没有可拆除的东西', 'bad');
  }

  tryExpand(c) {
    const cx = Math.floor(c.x / CHUNK);
    const cz = Math.floor(c.z / CHUNK);
    const r = this.game.buyChunk(cx, cz);
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
    let money = this.game.res.money;
    let stone = this.game.res.stone;
    const cost = isRoad ? Game.ROAD_COST : BUILDINGS.wall.cost;
    let n = 0;
    for (const [x, z] of this.dragCells()) {
      const ok = isRoad ? this.game.canRoad(x, z).ok : this.game.canPlace('wall', x, z).ok;
      const afford = money >= cost.money && stone >= cost.stone;
      const good = ok && afford;
      if (good) { money -= cost.money; stone -= cost.stone; n++; }
      const m = new THREE.Mesh(this.padGeo, good ? this.okMat : this.badMat);
      m.position.set(x + 0.5, 0.04, z + 0.5);
      this.preview.add(m);
    }
    this.showTip(`${isRoad ? '道路' : '城墙'} ×${n}  💰${n * cost.money} 🪨${n * cost.stone}`, n === 0);
  }

  commitDrag() {
    const isRoad = this.mode.kind === 'road';
    let n = 0;
    for (const [x, z] of this.dragCells()) {
      const r = isRoad ? this.game.placeRoad(x, z) : this.game.placeBuilding('wall', x, z);
      if (r.ok) n++;
    }
    if (n === 0) this.ui.toast(isRoad ? '无法在此铺路' : '无法在此建墙', 'bad');
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
      this.showTip(chk.ok ? `${def.name} · 左键放置${def.drag ? '(可拖拽)' : ''} · Shift 连续 · 右键取消` : chk.reason, !chk.ok);
      return;
    }
    this.ghost.visible = false;
    if (k === 'road') {
      const chk = this.game.canRoad(c.x, c.z);
      this.showTip(chk.ok ? '道路 · 按住拖拽铺设 · 💰5 🪨1' : chk.reason, !chk.ok);
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
    } else {
      this.tip.style.display = 'none';
    }
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
