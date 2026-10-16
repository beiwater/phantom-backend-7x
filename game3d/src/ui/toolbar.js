// 底部工具栏:工具(选择/道路/拆除/扩地)+ 建筑分类 + 建筑卡片(显示成本与解锁状态)。
import { BUILDINGS, BUILDING_IDS, CATEGORIES } from '../data/buildings.js';
import { TECHS } from '../data/tech.js';
import { resIcon } from '../data/resources.js';
import { MISSIONS } from '../data/missions.js';

export const BUILDING_ICONS = {
  hq: '🏛️', house: '🏠', farm: '🌾', lumber: '🪓', quarry: '⛏️', pump: '💧', ironMine: '⛰️', coalMine: '⚫',
  oilWell: '🛢️', foodFactory: '🍞', sawmill: '🪚', steelMill: '🔥', cement: '🧱', power: '⚡', refinery: '⛽',
  chemical: '🧪', munitions: '💥', machine: '⚙️', electronics: '🔌', market: '🏪', warehouse: '📦', academy: '📚',
  lab: '🔬', barracks: '🎖️', vehicleFactory: '🚜', airfield: '🚁', turret: '🗼', wall: '🧱',
};

const TOOLS = [
  { id: 'select', name: '🖱️ 选择', key: 'V' },
  { id: 'road', name: '🛣️ 道路', key: 'R' },
  { id: 'demolish', name: '🔨 拆除', key: 'X' },
  { id: 'expand', name: '🗺️ 扩地', key: 'G' },
];

export class Toolbar {
  constructor(game, ui) {
    this.game = game;
    this.ui = ui;
    this.cat = 'raw';
    this.tools = document.getElementById('tools');
    this.cats = document.getElementById('cats');
    this.cards = document.getElementById('cards');
    this.tools.innerHTML = TOOLS.map((t) => `<button class="tool" data-tool="${t.id}">${t.name}<kbd>${t.key}</kbd></button>`).join('');
    this.tools.addEventListener('click', (e) => {
      const b = e.target.closest('[data-tool]');
      if (b) this.ui.input.setMode({ kind: b.dataset.tool });
    });
    const cats = CATEGORIES.filter((c) => c.id !== 'core');
    this.cats.innerHTML = cats.map((c, i) => `<button class="cat" data-cat="${c.id}">${c.icon} ${c.name}<kbd>F${i + 1}</kbd></button>`).join('');
    this.catOrder = cats.map((c) => c.id);
    this.cats.addEventListener('click', (e) => {
      const b = e.target.closest('[data-cat]');
      if (b) this.setCat(b.dataset.cat);
    });
    this.cards.addEventListener('click', (e) => {
      const b = e.target.closest('[data-type]');
      if (!b) return;
      const type = b.dataset.type;
      if (!this.game.isUnlocked(type)) {
        this.ui.toast(`需要科技「${TECHS[BUILDINGS[type].tech].name}」`, 'bad');
        return;
      }
      this.ui.input.setMode({ kind: 'build', type });
    });
    this.t = 0;
    this.render();
  }

  setCat(id) {
    this.cat = id;
    this.render();
  }

  /** 只在分类/模式/解锁/可负担状态变化时重建 DOM,避免点击时元素被替换而丢失 click。 */
  render() {
    const g = this.game;
    const mode = this.ui.input?.mode ?? { kind: 'select' };
    const ids = BUILDING_IDS.filter((id) => BUILDINGS[id].category === this.cat);
    const focus = new Set(MISSIONS[g.mission]?.focus ?? []);
    for (const b of this.cats.querySelectorAll('.cat')) {
      b.classList.toggle('hint', BUILDING_IDS.some((id) => focus.has(id) && BUILDINGS[id].category === b.dataset.cat && b.dataset.cat !== this.cat));
    }
    const sig = [g.mission, this.cat, mode.kind, mode.type, ...ids.map((id) => `${g.isUnlocked(id)}${Object.entries(BUILDINGS[id].cost).map(([k, v]) => (g.res[k] ?? 0) >= v).join('')}`)].join('|');
    if (sig === this.sig) return;
    this.sig = sig;
    for (const b of this.tools.querySelectorAll('.tool')) b.classList.toggle('on', b.dataset.tool === mode.kind);
    for (const b of this.cats.querySelectorAll('.cat')) b.classList.toggle('on', b.dataset.cat === this.cat);
    this.cards.innerHTML = ids.map((id) => {
      const d = BUILDINGS[id];
      const unlocked = g.isUnlocked(id);
      const cost = Object.entries(d.cost).filter(([, v]) => v > 0)
        .map(([k, v]) => `<span class="${(g.res[k] ?? 0) < v ? 'lack' : ''}">${resIcon(k)}${v}</span>`).join('');
      const on = mode.kind === 'build' && mode.type === id;
      return `<button class="card${unlocked ? '' : ' locked'}${on ? ' on' : ''}${focus.has(id) ? ' hint' : ''}" data-type="${id}" title="${d.desc}">
        <div class="nm"><span>${BUILDING_ICONS[id]} ${d.name}</span></div>
        <div class="sz">${d.size[0]}×${d.size[1]} · 最高 ${d.maxLevel} 级</div>
        <div class="cost">${cost}</div>
        ${unlocked ? '' : `<div class="lock">🔒 ${TECHS[d.tech].name}</div>`}
      </button>`;
    }).join('');
  }

  update(dt) {
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.3;
    this.render();
  }
}
