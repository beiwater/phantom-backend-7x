// 右侧信息面板:选中建筑(配方/状态/升级/集市/训练)或选中部队。
// 结构按签名重建,进度/状态/血量每帧原地更新,避免按钮在点击过程中被替换。
import { BUILDINGS, upgradeCost, levelSpeed, storageOf, housingOf } from '../data/buildings.js';
import { RESOURCES, RESOURCE_IDS, resIcon, resName } from '../data/resources.js';
import { UNITS, COUNTERS, CLASS_NAMES } from '../data/units.js';
import { TECHS } from '../data/tech.js';
import { workersOf, powerOf, MARKET_RESERVE, rushCost } from '../sim/economy.js';
import { fmtTime } from '../engine/util.js';
import { BUILDING_ICONS } from './toolbar.js';
import { SYNERGY } from '../sim/synergy.js';
import { MODULES, MODULE_MIN_LEVEL } from '../data/modules.js';

const UNIT_ICONS = { militia: '🗡️', scout: '🔭', rifleman: '🔫', tank: '🛡️', artillery: '💣', helicopter: '🚁' };

function chips(cost, game, mult = 1) {
  return Object.entries(cost).filter(([, v]) => v > 0)
    .map(([k, raw]) => {
      const v = Math.ceil(raw * mult);
      return `<span class="chip${game && (game.res[k] ?? 0) < v ? ' lack' : ''}" title="${resName(k)}">${resIcon(k)} ${v}</span>`;
    }).join(' ');
}

/** 与 rts.upgradeUnits 扣费公式一致:每名 ceil(价格 × 0.5 × 政策倍率),再乘人数。 */
function upgradeTotal(g, n) {
  const mult = 0.5 * g.unitCostMult();
  return Object.fromEntries(Object.entries(UNITS.rifleman.cost).map(([k, v]) => [k, Math.ceil(v * mult) * n]));
}

function counterText(u) {
  const c = Object.entries(COUNTERS[u] ?? {});
  const strong = c.filter(([, v]) => v > 1).map(([k]) => CLASS_NAMES[k]).join('、');
  const weak = c.filter(([, v]) => v < 1).map(([k]) => CLASS_NAMES[k]).join('、');
  return `${strong ? `克制 ${strong}` : ''}${strong && weak ? ' · ' : ''}${weak ? `不擅长 ${weak}` : ''}`;
}

export class Panel {
  constructor(game, ui) {
    this.game = game;
    this.ui = ui;
    this.el = document.getElementById('panel');
    this.sel = null;
    this.sig = '';
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.el.addEventListener('change', (e) => this.onChange(e));
  }

  show(sel) {
    this.sel = sel;
    this.sig = '';
    this.update(true);
  }

  onClick(e) {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const g = this.game;
    const b = this.sel?.building;
    const act = t.dataset.act;
    let r = { ok: true };
    if (act === 'close') { this.ui.select(null); return; }
    if (act === 'upgrade') r = g.dispatch({ type: 'upgrade', uid: b.uid });
    if (act === 'repair') r = g.dispatch({ type: 'repair', uid: b.uid });
    if (act === 'pause') r = g.dispatch({ type: 'togglePause', uid: b.uid });
    if (act === 'rush') r = g.dispatch({ type: 'rush', uid: b.uid });
    if (act === 'reserve') r = g.dispatch({ type: 'setReserve', uid: b.uid, n: Number(t.dataset.n) });
    if (act === 'upgradeUnits') r = g.dispatch({ type: 'upgradeUnits', ids: (this.sel?.units ?? []).map((u) => u.id) });
    if (act === 'module') r = g.dispatch({ type: 'setModule', uid: b.uid, module: t.dataset.module });
    if (act === 'demolish') {
      r = g.dispatch({ type: 'demolish', uid: b.uid });
      if (r.ok) { this.ui.select(null); return; }
    }
    if (act === 'train') r = g.dispatch({ type: 'train', uid: b.uid, unit: t.dataset.unit });
    if (act === 'cancel') r = g.dispatch({ type: 'cancelTrain', uid: b.uid, i: Number(t.dataset.i) });
    if (act === 'focus' && b) this.ui.rig.lookAt(b.x + b.w / 2, b.z + b.d / 2);
    if (!r.ok) this.ui.toast(r.reason, 'bad');
    this.sig = '';
    this.update(true);
  }

  onChange(e) {
    const t = e.target;
    const b = this.sel?.building;
    if (!b || !t.dataset.sell) return;
    this.game.dispatch({ type: 'setSell', uid: b.uid, res: t.dataset.sell, on: t.checked });
  }

  update(force = false) {
    const sel = this.sel;
    if (!sel) { this.el.hidden = true; return; }
    if (sel.building && !this.game.buildings.has(sel.building.uid)) { this.ui.select(null); return; }
    if ((sel.units && sel.units.length === 0) || (!sel.building && !sel.units)) { this.ui.select(null); return; }
    this.el.hidden = false;
    const sig = sel.building ? this.buildingSig(sel.building) : this.unitsSig(sel.units);
    if (force || sig !== this.sig) {
      this.sig = sig;
      this.el.innerHTML = sel.building ? this.buildingHTML(sel.building) : this.unitsHTML(sel.units);
    }
    if (sel.building) this.live(sel.building);
  }

  buildingSig(b) {
    const g = this.game;
    const def = BUILDINGS[b.type];
    const parts = [b.uid, b.level, b.state, b.trainQueue.join(','), g.era, [...g.techs].length, b.paused, Math.ceil(b.hp / 20), b.module, ...Object.values(MODULES).map((m) => g.canAfford(m.cost))];
    if (b.level < def.maxLevel) parts.push(g.canAfford(upgradeCost(b.type, b.level + 1)));
    for (const u of def.trains ?? []) parts.push(g.canAfford(UNITS[u].cost, g.unitCostMult()));
    if (def.market) parts.push(RESOURCE_IDS.filter((k) => g.res[k] > 0 || b.sell.has(k)).join(), RESOURCE_IDS.map((k) => g.market.price(k).toFixed(1)).join());
    parts.push(b.synergy?.bonus, b.pollution, b.reserve);
    return parts.join('|');
  }

  unitsSig(units) {
    return `u|${units.map((u) => u.id).join(',')}`;
  }

  buildingHTML(b) {
    const g = this.game;
    const def = BUILDINGS[b.type];
    const mine = b.team === 'player';
    const h = [];
    h.push('<button class="close" data-act="close">✕</button>');
    h.push(`<h2>${BUILDING_ICONS[b.type]} ${def.name} <small>Lv ${b.level}/${def.maxLevel}${mine ? '' : ' · 敌方'}</small></h2>`);
    h.push(`<div class="desc">${def.desc}</div>`);
    h.push(`<div class="row"><span>耐久</span><span data-k="hp"></span></div><div class="hpbar"><i data-k="hpbar"></i></div>`);
    if (!mine) return h.join('');
    h.push('<div class="status" data-k="status"></div><div class="pbar"><i data-k="pbar"></i></div>');

    if (def.recipe) {
      const r = def.recipe;
      const ins = Object.keys(r.in).length ? chips(r.in) : '<span class="chip">无需原料</span>';
      const outs = Object.keys(r.out).length ? chips(r.out) : `<span class="chip">⚡ +${powerOf(def, b.level)} 电力</span>`;
      h.push(`<div class="recipe">${ins} ➜ ${outs} <span class="chip">⏱ ${(r.time / levelSpeed(b.level)).toFixed(1)}s</span></div>`);
    }
    const info = [];
    if (def.recipe || def.market) info.push([def.market ? '💰 累计收入' : '📈 累计产出', `<span data-k="made">${Math.floor(b.made ?? 0)}</span>`]);
    if (def.workers) info.push(['👷 工人', workersOf(def, b.level)]);
    if (def.power < 0) info.push(['⚡ 耗电', -powerOf(def, b.level)]);
    if (def.power > 0) info.push(['⚡ 发电', powerOf(def, b.level)]);
    if (def.storage) info.push(['📦 仓储', `+${storageOf(b.type, b.level)}`]);
    if (def.housing) info.push(['🏠 住户', housingOf(b.type, b.level)]);
    if (def.upkeep) info.push(['🍞 口粮', `${def.upkeep.food * b.level}/${def.upkeep.time}s`]);
    if (def.turret) info.push(['🎯 射程/伤害', `${def.turret.range} / ${Math.round(def.turret.damage * (1 + 0.25 * (b.level - 1)))}`]);
    for (const [k, v] of info) h.push(`<div class="row"><span>${k}</span><b>${v}</b></div>`);
    if (SYNERGY[b.type]) {
      const syn = b.synergy ?? { bonus: 0, partners: [] };
      const names = (list) => list.map((t) => BUILDINGS[t].name).join('、');
      h.push(`<div class="row"><span>🔗 相邻协同</span><b style="color:${syn.bonus ? 'var(--good)' : 'var(--muted)'}">+${Math.round(syn.bonus * 100)}%</b></div>`);
      h.push(`<div class="desc" style="margin:0 0 4px">紧贴:${names(SYNERGY[b.type])}(每种 +10%,最多 +30%)${syn.partners.length ? `<br>已连接:${names(syn.partners)}` : ''}</div>`);
    }
    if ((def.recipe || def.market) && b.state === 'active') {
      if (b.level >= MODULE_MIN_LEVEL) {
        h.push(`<div class="row" style="margin-top:6px"><span>🧩 专精模块</span><b>${b.module ? `${MODULES[b.module].icon} ${MODULES[b.module].name}` : '未安装'}</b></div><div class="btns">`);
        for (const [id, m] of Object.entries(MODULES)) {
          h.push(`<button class="btn${b.module === id ? ' primary' : ''}" data-act="module" data-module="${id}" title="${m.desc}" ${b.module === id || !g.canAfford(m.cost) ? 'disabled' : ''}>${m.icon} ${m.name} ${chips(m.cost)}</button>`);
        }
        h.push('</div>');
      } else {
        h.push(`<div class="desc">🧩 ${MODULE_MIN_LEVEL} 级后可安装专精模块(效率 / 环保 / 仓储)。</div>`);
      }
    }
    if (b.type === 'house' && b.pollution) h.push(`<div class="status bad">🏭 附近有 ${b.pollution} 处污染源,降低民心</div>`);

    if (def.market) {
      const seen = RESOURCE_IDS.filter((k) => g.res[k] > 0 || b.sell.has(k));
      h.push(`<div class="row" style="margin-top:8px"><span>自动出售(每次 ${def.market.perCycle * b.level} 件 · 价格 ×${(0.8 + 0.1 * b.level).toFixed(1)})</span></div>`);
      const mk = g.market;
      h.push(`<div class="sellgrid">${seen.map((k) => {
        const m = mk.mult[k];
        const arrow = mk.trend[k] > 0.05 ? '↑' : mk.trend[k] < -0.05 ? '↓' : '';
        return `<label title="当前单价 ${mk.price(k).toFixed(1)}(基准 ${RESOURCES[k].price})"><input type="checkbox" data-sell="${k}" ${b.sell.has(k) ? 'checked' : ''}>${RESOURCES[k].icon}<span style="color:${m >= 1 ? 'var(--good)' : 'var(--bad)'}">${mk.price(k).toFixed(1)}${arrow}</span></label>`;
      }).join('') || '<span class="desc">仓库里还没有货物</span>'}</div>`);
      const rsv = b.reserve ?? MARKET_RESERVE;
      h.push(`<div class="row" style="margin-top:6px"><span>每种货物保留</span><span class="btns" style="margin:0">${[20, 50, 100, 200].map((n) => `<button class="btn${n === rsv ? ' primary' : ''}" data-act="reserve" data-n="${n}">${n}</button>`).join('')}</span></div>`);
      h.push('<div class="desc">库存高于保留量的部分才会出售。大量抛售会压低价格,价格会随时间回升;留意商队与需求波动。</div>');
    }

    if (def.trains && b.state === 'active') {
      h.push('<div class="unitgrid">');
      for (const u of def.trains) {
        const ud = UNITS[u];
        const unlocked = g.techs.has(ud.tech);
        h.push(`<div class="unitcard"><div class="top"><b>${UNIT_ICONS[u]} ${ud.name}</b>
          <button class="btn primary" data-act="train" data-unit="${u}" ${unlocked && g.canAfford(ud.cost, g.unitCostMult()) ? '' : 'disabled'}>训练</button></div>
          <div class="desc" style="margin:3px 0">${unlocked ? `${ud.desc} 生命 ${ud.hp} · 伤害 ${ud.damage} · 射程 ${ud.range}<br>${counterText(u)}` : `🔒 需要科技「${TECHS[ud.tech].name}」`}</div>
          <div>${chips(ud.cost, g, g.unitCostMult())} <span class="chip">⏱ ${ud.time}s</span></div></div>`);
      }
      h.push('</div>');
      if (b.trainQueue.length) {
        h.push(`<div class="queue">${b.trainQueue.map((u, i) => `<button class="btn" data-act="cancel" data-i="${i}" title="取消并退款">${UNIT_ICONS[u]} ✕</button>`).join('')}</div>`);
      }
      h.push('<div class="desc">选中兵营后右键地面设置集结点。</div>');
    }

    h.push('<div class="btns">');
    if (b.state === 'construct' || b.state === 'upgrade') h.push(`<button class="btn primary" data-act="rush">⚡ 立即完成 💰<span data-k="rush">${rushCost(b)}</span></button>`);
    if (b.level < def.maxLevel) {
      const cost = upgradeCost(b.type, b.level + 1);
      const eraBlock = b.type === 'hq' && b.level + 1 > g.era;
      h.push(`<button class="btn primary" data-act="upgrade" ${b.state === 'active' && !eraBlock && g.canAfford(cost) ? '' : 'disabled'}>⬆ 升级 ${chips(cost)}</button>`);
      if (eraBlock) h.push('<div class="desc">需先通过科技进入下一时代。</div>');
    }
    if (def.recipe || def.market || def.trains) h.push(`<button class="btn" data-act="pause">${b.paused ? '▶ 恢复生产' : '⏸ 暂停生产'}</button>`);
    h.push(`<button class="btn" data-act="repair" ${b.hp < b.maxHp ? '' : 'disabled'}>🔧 维修 💰${Math.ceil((b.maxHp - b.hp) * 0.3)}</button>`);
    h.push('<button class="btn" data-act="focus">🎯 定位</button>');
    if (b.type !== 'hq') h.push('<button class="btn danger" data-act="demolish">🔨 拆除</button>');
    h.push('</div>');
    return h.join('');
  }

  live(b) {
    const q = (k) => this.el.querySelector(`[data-k="${k}"]`);
    const made = q('made');
    if (made) made.textContent = Math.floor(b.made ?? 0);
    const rush = q('rush');
    if (rush && (b.state === 'construct' || b.state === 'upgrade')) rush.textContent = rushCost(b);
    const hp = q('hp');
    if (hp) hp.textContent = `${Math.ceil(b.hp)} / ${Math.ceil(b.maxHp)}`;
    const hpbar = q('hpbar');
    if (hpbar) hpbar.style.width = `${(b.hp / b.maxHp) * 100}%`;
    const st = q('status');
    if (!st) return;
    const def = BUILDINGS[b.type];
    let p = b.cycle;
    let text = b.status || '待机';
    if (b.state !== 'active') p = b.progress;
    if (def.trains && b.state === 'active') {
      const info = this.game.unitSystem?.trainingInfo?.(b);
      if (info?.queue.length) {
        p = info.progress;
        text = `训练 ${UNITS[info.queue[0]].name} · ${fmtTime(info.eta)}`;
      } else text = b.connected ? '待命' : '未连接道路';
    } else if (b.eta && b.working && b.state === 'active') text += ` · ${fmtTime(b.eta)}`;
    const bad = /缺|未|满|不足|无/.test(text);
    st.className = `status ${bad ? 'bad' : b.working ? 'good' : ''}`;
    st.textContent = text;
    q('pbar').style.width = `${Math.min(1, p) * 100}%`;
  }

  unitsHTML(units) {
    const by = new Map();
    for (const u of units) by.set(u.type, (by.get(u.type) ?? 0) + 1);
    const vets = units.filter((u) => u.rank).length;
    const hp = units.reduce((s, u) => s + u.hp, 0);
    const max = units.reduce((s, u) => s + u.maxHp, 0);
    return `<button class="close" data-act="close">✕</button>
      <h2>⚔️ 部队 <small>${units.length} 个单位</small></h2>
      ${by.get('militia') && this.game.techs.has('gunpowder') ? `<div class="btns"><button class="btn primary" data-act="upgradeUnits">⬆ 民兵升级为步枪兵(兵营附近)${chips(upgradeTotal(this.game, by.get('militia')), this.game)}</button></div>` : ''}
      <div class="hpbar"><i style="width:${(hp / max) * 100}%"></i></div>
      <div class="sellgrid">${[...by].map(([t, n]) => `<span class="chip">${UNIT_ICONS[t]} ${UNITS[t].name} ×${n}</span>`).join('')}</div>
      ${vets ? `<div class="desc">🎖️ 老兵 ${vets} 名(每颗星伤害 +15%):${units.filter((u) => u.rank).slice(0, 8).map((u) => `${UNITS[u.type].name}${'★'.repeat(u.rank)}`).join(' ')}</div>` : ''}
      <div class="desc">补给:步兵每 30 秒 1 食物,坦克/火炮 1 燃油,直升机 2 燃油;不足时伤害 -30%。脱战后在指挥中心/兵营/工厂附近会自动休整回血。</div>
      <div class="desc" style="margin-top:10px">右键地面:移动 · 右键敌人:攻击<br>A + 点击:攻击移动 · H:停止<br>Ctrl+数字:编队 · 数字:选择编队 · F:全选部队</div>`;
  }
}
