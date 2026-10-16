// 经济统计弹窗:每种资源的库存、每分钟产出/消耗/净流量、市场价格与价格走势(SVG 折线)、民心构成。
import { RESOURCES, RESOURCE_IDS } from '../data/resources.js';
import { BUILDINGS } from '../data/buildings.js';
import { fmtNum } from '../engine/util.js';
import { civScore } from '../sim/score.js';

function spark(values, w = 90, h = 22, color = '#5aa8ff', center = null) {
  if (values.length < 2) return '<span style="color:var(--muted)">—</span>';
  const lo = Math.min(...values, center ?? Infinity);
  const hi = Math.max(...values, center ?? -Infinity);
  const span = hi - lo || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - ((v - lo) / span) * h).toFixed(1)}`).join(' ');
  const mid = center === null ? '' : `<line x1="0" x2="${w}" y1="${h - ((center - lo) / span) * h}" y2="${h - ((center - lo) / span) * h}" stroke="rgba(255,255,255,.2)" stroke-dasharray="2 2"/>`;
  return `<svg width="${w}" height="${h}" style="vertical-align:middle">${mid}<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.6"/></svg>`;
}

export class StatsPanel {
  constructor(game, economy) {
    this.game = game;
    this.economy = economy;
    /** 发展曲线:每 20 游戏秒采样一次(本地视图数据,不进存档) */
    this.history = [];
    this.nextSample = 0;
  }

  sample() {
    const g = this.game;
    if (g.time < this.nextSample) return;
    this.nextSample = g.time + 20;
    this.history.push({
      t: g.time,
      score: civScore(g).total,
      money: g.res.money,
      army: (g.unitSystem?.units ?? []).filter((u) => u.team === g.localPlayer).length,
      pop: g.stats.housing,
    });
    if (this.history.length > 360) this.history.shift();
  }

  curves() {
    const h = this.history;
    if (h.length < 2) return '<div class="desc">游戏进行一段时间后显示发展曲线。</div>';
    const row = (name, key, color) => `<div class="row"><span>${name} ${fmtNum(h[h.length - 1][key])}</span>${spark(h.map((p) => p[key]), 260, 26, color)}</div>`;
    return `<div class="curves">${row('🏅 评分', 'score', '#ffd34d')}${row('💰 金币', 'money', '#e8c252')}${row('👷 人口', 'pop', '#6fd36f')}${row('⚔️ 部队', 'army', '#5aa8ff')}</div>`;
  }

  html() {
    const g = this.game;
    const st = this.economy.stats;
    const mk = this.economy.market;
    const rows = RESOURCE_IDS.filter((k) => RESOURCES[k].era <= g.era || g.res[k] > 0).map((k) => {
      const r = RESOURCES[k];
      const pm = st.perMinute(k);
      const net = pm.made - pm.used;
      const netColor = net > 0.05 ? 'var(--good)' : net < -0.05 ? 'var(--bad)' : 'var(--muted)';
      return `<tr><td>${r.icon} ${r.name}</td><td>${Math.floor(g.res[k])}</td>
        <td>${pm.made.toFixed(1)}</td><td>${pm.used.toFixed(1)}</td>
        <td style="color:${netColor}">${net >= 0 ? '+' : ''}${net.toFixed(1)}</td>
        <td>${spark(st.series(k), 90, 22, '#6fd36f', 0)}</td>
        <td>${mk.price(k).toFixed(1)}</td><td>${spark(mk.history[k], 70, 22, '#ffd34d', 1)}</td></tr>`;
    }).join('');
    const money = st.perMinute('money');
    const soc = g.society;
    const partNames = { base: '基础', food: '口粮', pollution: '污染', services: '服务(集市)', education: '教育', war: '战争威胁', events: '事件' };
    const parts = Object.entries(soc.parts).map(([k, v]) => `<span class="chip" style="color:${v >= 0 ? 'var(--good)' : 'var(--bad)'}">${partNames[k]} ${v >= 0 ? '+' : ''}${v}</span>`).join(' ');
    const counts = new Map();
    for (const b of g.buildings.values()) if (b.team === g.localPlayer) counts.set(b.type, (counts.get(b.type) ?? 0) + 1);
    const blds = [...counts].map(([t, n]) => `<span class="chip">${BUILDINGS[t].name} ×${n}</span>`).join(' ');
    return `<div class="dialog" data-modal="stats" style="min-width:min(820px,94vw)">
      <h2><span>📊 经济统计 <small style="font-size:13px;color:var(--muted)">近 1 分钟 · 金币 +${fmtNum(money.made)}/分</small></span><button class="btn" data-close>关闭 Esc</button></h2>
      <table class="stats-table">
        <thead><tr><th>货物</th><th>库存</th><th>产出/分</th><th>消耗/分</th><th>净流量</th><th>净流量走势</th><th>市价</th><th>价格走势</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <h3 style="margin:14px 0 6px;font-size:14px">发展曲线</h3>${this.curves()}
      <h3 style="margin:14px 0 6px;font-size:14px">民心 ${Math.round(soc.happiness)} · 税收 ×${soc.taxMult().toFixed(2)} · 生产 ×${soc.productivity().toFixed(2)}</h3>
      <div>${parts}</div>
      <h3 style="margin:14px 0 6px;font-size:14px">建筑(${[...counts.values()].reduce((s, n) => s + n, 0)})</h3>
      <div style="display:flex;flex-wrap:wrap;gap:4px">${blds}</div>
    </div>`;
  }
}
