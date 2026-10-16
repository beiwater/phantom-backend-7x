// 百科:按分类列出 28 种建筑的配方、成本、要求与解锁科技,并给出每种货物的上下游。
import { BUILDINGS, BUILDING_IDS, CATEGORIES } from '../data/buildings.js';
import { RESOURCES, RESOURCE_IDS, resIcon } from '../data/resources.js';
import { TECHS } from '../data/tech.js';
import { SYNERGY } from '../sim/synergy.js';
import { BUILDING_ICONS } from './toolbar.js';

const chip = (obj) => Object.entries(obj).map(([k, v]) => `${resIcon(k)}${v}`).join(' ') || '—';
const TERRAIN = { rock: '岩石', ore: '铁矿脉', coal: '煤层', oil: '油田', forest: '森林', water: '水域' };

export class Codex {
  constructor(game) {
    this.game = game;
    this.tab = 'buildings';
  }

  html() {
    const tabs = `<div class="btns" style="margin-bottom:10px">
      <button class="btn${this.tab === 'buildings' ? ' primary' : ''}" data-codex="buildings">🏗️ 建筑</button>
      <button class="btn${this.tab === 'goods' ? ' primary' : ''}" data-codex="goods">📦 货物与产业链</button></div>`;
    return `<div class="dialog" data-modal="codex" style="max-width:980px">
      <h2><span>📖 百科</span><button class="btn" data-close>关闭 Esc</button></h2>${tabs}
      ${this.tab === 'buildings' ? this.buildings() : this.goods()}</div>`;
  }

  buildings() {
    const g = this.game;
    return CATEGORIES.map((c) => {
      const rows = BUILDING_IDS.filter((id) => BUILDINGS[id].category === c.id).map((id) => {
        const d = BUILDINGS[id];
        const recipe = d.recipe ? `${chip(d.recipe.in)} ➜ ${chip(d.recipe.out) === '—' ? `⚡${d.power}` : chip(d.recipe.out)} / ${d.recipe.time}s` : d.trains ? `训练:${d.trains.length} 种单位` : d.market ? '自动出售货物' : d.storage ? `仓储 +${d.storage}/级` : d.housing ? `住户 ${d.housing}/级` : d.turret ? `射程 ${d.turret.range} 伤害 ${d.turret.damage}` : '—';
        const req = [d.terrain ? `覆盖${TERRAIN[d.terrain]}` : '', d.near ? `靠近${TERRAIN[d.near]}` : '', d.power < 0 ? `耗电 ${-d.power}` : ''].filter(Boolean).join(' · ') || '—';
        const syn = SYNERGY[id] ? SYNERGY[id].map((t) => BUILDINGS[t].name).join('、') : '—';
        const lock = d.tech ? (g.techs.has(d.tech) ? `✅ ${TECHS[d.tech].name}` : `🔒 ${TECHS[d.tech].name}`) : '初始';
        return `<tr><td>${BUILDING_ICONS[id]} <b>${d.name}</b><div class="desc">${d.size[0]}×${d.size[1]} · ${d.maxLevel} 级</div></td>
          <td>${recipe}</td><td>${chip(d.cost)}</td><td>${req}</td><td>${syn}</td><td>${lock}</td></tr>`;
      }).join('');
      return `<h3 class="sub">${c.icon} ${c.name}</h3><table class="stats-table"><thead><tr><th>建筑</th><th>配方</th><th>建造成本</th><th>要求</th><th>协同伙伴</th><th>解锁</th></tr></thead><tbody>${rows}</tbody></table>`;
    }).join('');
  }

  goods() {
    const rows = RESOURCE_IDS.map((k) => {
      const r = RESOURCES[k];
      const makers = BUILDING_IDS.filter((id) => BUILDINGS[id].recipe?.out[k]).map((id) => BUILDINGS[id].name);
      const users = BUILDING_IDS.filter((id) => BUILDINGS[id].recipe?.in[k]).map((id) => BUILDINGS[id].name);
      const builds = BUILDING_IDS.filter((id) => BUILDINGS[id].cost[k]).map((id) => BUILDINGS[id].name);
      return `<tr><td>${r.icon} <b>${r.name}</b></td><td>${r.price}</td><td>${makers.join('、') || '—'}</td><td>${users.join('、') || '—'}</td><td>${builds.join('、') || '—'}</td></tr>`;
    }).join('');
    return `<table class="stats-table"><thead><tr><th>货物</th><th>基准价</th><th>生产于</th><th>加工原料于</th><th>用于建造</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  onClick(e) {
    const t = e.target.closest('[data-codex]');
    if (!t) return false;
    this.tab = t.dataset.codex;
    return true;
  }
}
