// 建筑头顶浮动标签(仿等距经营游戏的「生产中 00:12」)与产出飘字。
// DOM 节点按建筑复用,每帧只改 transform/文本。
import * as THREE from 'three';
import { BUILDINGS } from '../data/buildings.js';
import { resIcon } from '../data/resources.js';
import { fmtTime } from '../engine/util.js';

const MAX_FLOATERS = 30;

export class Labels {
  constructor(game, rig, view) {
    this.game = game;
    this.rig = rig;
    this.view = view;
    this.root = document.getElementById('labels');
    /** @type {Map<number, {el: HTMLElement, t: HTMLElement, bar: HTMLElement, last: string}>} */
    this.nodes = new Map();
    this.enabled = true;
    this.tmp = new THREE.Vector3();
    game.events.on('building:remove', ({ b }) => this.drop(b.uid));
    game.events.on('produce', ({ b, out }) => this.floatOut(b, out));
  }

  drop(uid) {
    const n = this.nodes.get(uid);
    if (n) { n.el.remove(); this.nodes.delete(uid); }
  }

  node(uid) {
    let n = this.nodes.get(uid);
    if (!n) {
      const el = document.createElement('div');
      el.className = 'blabel';
      el.innerHTML = '<div class="t"></div><div class="mini"><i></i></div>';
      this.root.appendChild(el);
      n = { el, t: el.firstChild, bar: el.lastChild.firstChild, mini: el.lastChild, last: '' };
      this.nodes.set(uid, n);
    }
    return n;
  }

  text(b, def) {
    if (b.team !== this.game.localPlayer) {
      if (this.game.fog && !this.game.fog.isExplored(b.x + b.w / 2, b.z + b.d / 2)) return null;
      return { s: def.name, cls: 'enemy', p: b.hp / b.maxHp, hp: true };
    }
    if (b.state === 'construct') return { s: `🏗️ 建造中 ${fmtTime((1 - b.progress) * def.buildTime)}`, p: b.progress };
    if (b.state === 'upgrade') return { s: `⬆ 升级至 ${b.level + 1} 级`, p: b.progress };
    if (b.hp < b.maxHp * 0.999) return { s: `${def.name} ${Math.ceil((b.hp / b.maxHp) * 100)}%`, cls: b.hp < b.maxHp * 0.4 ? 'bad' : '', p: b.hp / b.maxHp, hp: true };
    if (def.recipe || def.market) {
      const icon = Object.keys(def.recipe?.out ?? {}).map(resIcon)[0] ?? (def.market ? '💰' : '⚡');
      if (!b.working) return { s: `${icon} ${b.status}`, cls: 'bad', p: b.cycle };
      return { s: `${icon} ${def.market ? '交易中' : '生产中'} <span class="eta">${fmtTime(b.eta ?? 0)}</span>`, p: b.cycle };
    }
    if (def.trains) {
      const info = this.game.unitSystem?.trainingInfo?.(b);
      if (info?.queue.length) return { s: `🎖️ 训练中 <span class="eta">${fmtTime(info.eta)}</span>`, p: info.progress };
      return { s: def.name, p: -1, quiet: true };
    }
    if (b.type === 'house' && !b.fed) return { s: '🍞 缺少食物', cls: 'bad', p: -1 };
    if (b.type === 'hq') return { s: `🏛️ ${def.name} Lv${b.level}`, p: -1 };
    return null;
  }

  update() {
    const zoomOk = this.rig.view < 22;
    for (const [uid, v] of this.view.bviews) {
      const b = this.game.buildings.get(uid);
      if (!b) continue;
      const def = BUILDINGS[b.type];
      const info = this.enabled && zoomOk && b.type !== 'wall' ? this.text(b, def) : null;
      if (!info || (info.quiet && this.rig.view > 12)) { this.hide(uid); continue; }
      this.tmp.set(v.group.position.x, (v.info?.labelY ?? 2) * (b.state === 'construct' ? Math.max(0.3, b.progress) : 1) + 0.2, v.group.position.z);
      const p = this.rig.toScreen(this.tmp);
      const n = this.node(uid);
      n.el.style.display = '';
      n.el.style.left = `${p.x.toFixed(1)}px`;
      n.el.style.top = `${p.y.toFixed(1)}px`;
      const key = `${info.s}|${info.cls}`;
      if (key !== n.last) {
        n.last = key;
        n.t.innerHTML = info.s;
        n.t.className = `t ${info.cls ?? ''}`;
      }
      n.mini.style.display = info.p < 0 ? 'none' : '';
      n.mini.classList.toggle('hp', !!info.hp);
      if (info.p >= 0) n.bar.style.width = `${Math.min(1, info.p) * 100}%`;
    }
  }

  hide(uid) {
    const n = this.nodes.get(uid);
    if (n) n.el.style.display = 'none';
  }

  floatOut(b, out) {
    if (this.root.querySelectorAll('.floater').length >= MAX_FLOATERS) return;
    const entries = Object.entries(out).filter(([, v]) => v > 0);
    if (!entries.length) return;
    const v = this.view.bviews.get(b.uid);
    if (!v || this.rig.view > 24) return;
    this.tmp.set(v.group.position.x, (v.info?.labelY ?? 2) * 0.8, v.group.position.z);
    const p = this.rig.toScreen(this.tmp);
    const el = document.createElement('div');
    el.className = `floater${out.money ? ' money' : ''}`;
    el.textContent = entries.map(([k, n]) => `+${n}${resIcon(k)}`).join(' ');
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y - 18}px`;
    this.root.appendChild(el);
    setTimeout(() => el.remove(), 1400);
  }
}
