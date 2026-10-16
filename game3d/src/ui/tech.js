// 科技树弹窗:按时代分列,连线表示前置关系;点击可研究节点开始研究。
import { TECHS, TECH_IDS, ERAS } from '../data/tech.js';
import { BUILDINGS } from '../data/buildings.js';
import { UNITS } from '../data/units.js';
import { researchDuration } from '../sim/economy.js';

const CW = 168;
const RH = 96;

function unlocksOf(id) {
  const b = Object.entries(BUILDINGS).filter(([, d]) => d.tech === id).map(([, d]) => d.name);
  const u = Object.entries(UNITS).filter(([, d]) => d.tech === id).map(([, d]) => d.name);
  return [...b, ...u];
}

export class TechTree {
  constructor(game, ui) {
    this.game = game;
    this.ui = ui;
  }

  sig() {
    const g = this.game;
    return [[...g.techs].join(), g.researching?.id, ...TECH_IDS.map((id) => g.canResearch(id).ok)].join('|');
  }

  html() {
    const g = this.game;
    const cols = Math.max(...TECH_IDS.map((id) => TECHS[id].col)) + 1;
    const rows = Math.max(...TECH_IDS.map((id) => TECHS[id].row)) + 1;
    const W = cols * CW;
    const H = rows * RH + 24;
    const lines = [];
    for (const id of TECH_IDS) {
      const t = TECHS[id];
      for (const r of t.req) {
        const a = TECHS[r];
        const x1 = a.col * CW + 140;
        const y1 = a.row * RH + 24 + 37;
        const x2 = t.col * CW;
        const y2 = t.row * RH + 24 + 37;
        const done = g.techs.has(r);
        lines.push(`<path d="M${x1} ${y1} C ${x1 + 20} ${y1}, ${x2 - 20} ${y2}, ${x2} ${y2}" stroke="${done ? '#6fd36f' : '#4a5a70'}" stroke-width="2" fill="none"/>`);
      }
    }
    const eraHeads = ERAS.map((e) => {
      const c = Math.min(...TECH_IDS.filter((id) => TECHS[id].era === e.id).map((id) => TECHS[id].col));
      return `<div class="erahead" style="left:${c * CW}px;color:${e.color}">${e.name}</div>`;
    }).join('');
    const nodes = TECH_IDS.map((id) => {
      const t = TECHS[id];
      const done = g.techs.has(id);
      const active = g.researching?.id === id;
      const reqOk = t.req.every((r) => g.techs.has(r));
      const can = g.canResearch(id).ok;
      const cls = done ? 'done' : active ? 'active' : can ? 'avail' : reqOk ? '' : 'locked';
      const un = unlocksOf(id);
      return `<button class="tech ${cls}" data-tech="${id}" style="left:${t.col * CW}px;top:${t.row * RH + 24}px" title="${t.desc}${un.length ? `\n解锁:${un.join('、')}` : ''}">
        <div class="tn"><span>${t.name}</span><span>${done ? '✅' : `🔬${t.cost}`}</span></div>
        <div class="td">${t.desc}</div>
        ${active ? `<div class="pbar"><i style="width:${g.researching.progress * 100}%"></i></div>` : ''}
      </button>`;
    }).join('');
    const r = g.researching;
    return `<div class="dialog" data-modal="tech">
      <h2><span>🔬 科技树 <small style="font-size:13px;color:var(--muted)">科研点 ${Math.floor(g.res.research)}${r ? ` · 正在研究「${TECHS[r.id].name}」` : ''}</small></span><button class="btn" data-close>关闭 Esc</button></h2>
      <div class="techgrid" style="width:${W}px;height:${H}px">
        <svg width="${W}" height="${H}">${lines.join('')}</svg>${eraHeads}${nodes}
      </div>
      <p>学院(食物+木板)与研究所(电子元件)产出科研点。开始研究时一次性扣除科研点,研究约需 ${researchDuration('mining').toFixed(0)}–${researchDuration('precision').toFixed(0)} 秒。</p>
    </div>`;
  }

  onClick(e) {
    const n = e.target.closest('[data-tech]');
    if (!n) return false;
    const r = this.game.startResearch(n.dataset.tech);
    if (!r.ok) this.ui.toast(r.reason, 'bad');
    else this.ui.toast(`开始研究「${TECHS[n.dataset.tech].name}」`, 'good');
    return true;
  }
}
