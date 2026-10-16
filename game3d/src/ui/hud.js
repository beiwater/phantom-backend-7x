// 顶栏(时代/金币/科研/工人/电力/仓储/时钟/倍速)与资源条。
import { RESOURCES, RESOURCE_IDS } from '../data/resources.js';
import { ERAS } from '../data/tech.js';
import { fmtNum, fmtTime } from '../engine/util.js';

export class Hud {
  constructor(game) {
    this.game = game;
    this.stats = document.getElementById('stats');
    this.resbar = document.getElementById('resbar');
    this.clock = document.getElementById('clock');
    this.era = document.getElementById('era-badge');
    this.speed = document.getElementById('speed');
    this.seen = new Set(['wood', 'stone', 'food', 'planks']);
    this.prev = {};
    this.speed.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      this.setSpeed(Number(btn.dataset.speed));
    });
    this.t = 0;
  }

  setSpeed(s) {
    const g = this.game;
    if (g.over) return;
    if (s === 0) g.paused = !g.paused;
    else { g.speed = s; g.paused = false; }
    this.renderSpeed();
  }

  renderSpeed() {
    for (const b of this.speed.querySelectorAll('button')) {
      const s = Number(b.dataset.speed);
      b.classList.toggle('on', this.game.paused ? s === 0 : s === this.game.speed);
    }
  }

  update(dt) {
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.25;
    const g = this.game;
    const s = g.stats;
    const era = ERAS[g.era - 1];
    this.era.textContent = era.name;
    this.era.style.background = era.color;
    const workersUsed = Math.min(s.workersNeeded, s.housing);
    const items = [
      ['💰', fmtNum(g.res.money), '金币', false],
      ['🔬', fmtNum(g.res.research), '科研点', false],
      ['👷', `${workersUsed}/${s.housing}`, `工人(需求 ${s.workersNeeded})`, s.workersNeeded > s.housing],
      ['⚡', `${s.powerDemand}/${s.powerSupply}`, '耗电/发电', s.powerDemand > s.powerSupply],
      ['📦', fmtNum(s.storageCap), '每种货物仓储上限', false],
      ['⚔️', `${g.unitSystem?.units.filter((u) => u.team === g.localPlayer).length ?? 0}`, '我方部队', false],
    ];
    const soc = g.society;
    if (soc) {
      const h = Math.round(soc.happiness);
      const face = h >= 75 ? '😄' : h >= 50 ? '🙂' : h >= 30 ? '😐' : '😠';
      const parts = Object.entries(soc.parts).map(([k, v]) => `${({ base: '基础', food: '口粮', pollution: '污染', services: '服务', education: '教育', war: '战争', events: '事件' })[k]} ${v >= 0 ? '+' : ''}${v}`).join('\n');
      items.push([face, `${h}`, `民心(税收 ×${soc.taxMult().toFixed(2)})\n${parts}`, h < 30]);
    }
    for (const b of g.buffs) items.push(['✨', `${b.name} ${Math.ceil(b.until - g.time)}s`, '临时事件', !!b.effects.prod && b.effects.prod < 0]);
    this.stats.innerHTML = items.map(([i, v, t, w]) => `<span class="stat${w ? ' warn' : ''}" title="${t}">${i}<b>${v}</b></span>`).join('');
    this.clock.textContent = `⏱ ${fmtTime(g.time)}`;
    this.renderSpeed();

    for (const k of RESOURCE_IDS) if (g.res[k] > 0) this.seen.add(k);
    const parts = [];
    for (const k of RESOURCE_IDS) {
      if (!this.seen.has(k)) continue;
      const r = RESOURCES[k];
      const v = Math.floor(g.res[k]);
      const flash = this.prev[k] !== undefined && v > this.prev[k];
      this.prev[k] = v;
      const full = v >= s.storageCap;
      parts.push(`<span class="res${full ? ' full' : ''}${flash ? ' flash' : ''}" title="${r.name}${full ? '(仓库已满)' : ''}">${r.icon}<b>${v}</b></span>`);
    }
    this.resbar.innerHTML = parts.join('');
  }
}
