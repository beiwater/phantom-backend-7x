// 政务弹窗:政策槽(随时代解锁)与贸易合同列表。所有操作经 game.dispatch。
import { POLICIES, POLICY_IDS, POLICY_SWITCH_COST, policySlots } from '../data/policies.js';
import { ERAS } from '../data/tech.js';
import { RESOURCES, resIcon } from '../data/resources.js';
import { fmtTime } from '../engine/util.js';
import { VICTORIES } from '../sim/victory.js';
import { GREAT } from '../sim/greatpeople.js';

export class GovPanel {
  constructor(game, ui) {
    this.game = game;
    this.ui = ui;
    this.pickSlot = null;
  }

  sig() {
    const g = this.game;
    const c = g.contracts;
    return [g.great?.ready.join(), ...Object.keys(GREAT).map((k) => Math.floor((g.great?.points(k) ?? 0) / 10)), g.unitSystem?.ai?.wave, g.unitSystem?.ai?.tributedWave, Math.floor(((g.unitSystem?.ai?.nextWave ?? 0) - g.time) / 5), g.era, g.techs.size, Math.floor(g.res.money / 1000), g.policies.join(), this.pickSlot, c.offers.map((o) => `${o.id}:${g.res[o.res] >= o.qty}`).join(), c.reputation, Math.floor(g.res.money / 150)].join('|');
  }

  html() {
    const g = this.game;
    const slots = policySlots(g.era);
    const slotHtml = [];
    for (let i = 0; i < 3; i++) {
      const id = g.policies[i];
      const locked = i >= slots;
      slotHtml.push(`<button class="slot${locked ? ' locked' : ''}${this.pickSlot === i ? ' on' : ''}" data-slot="${i}" ${locked ? 'disabled' : ''}>
        <div class="tn">${locked ? `🔒 ${ERAS[i].name}解锁` : id ? `📜 ${POLICIES[id].name}` : '➕ 空政策槽'}</div>
        <div class="td">${id ? POLICIES[id].desc : locked ? '' : '点击选择政策'}</div></button>`);
    }
    let picker = '';
    if (this.pickSlot !== null) {
      const cur = g.policies[this.pickSlot];
      const cooling = cur && g.time < g.policyReadyAt;
      picker = `<div class="desc" style="margin:8px 0">为第 ${this.pickSlot + 1} 槽选择政策${cur ? `(替换需 💰${POLICY_SWITCH_COST}${cooling ? `,冷却 ${Math.ceil(g.policyReadyAt - g.time)} 秒` : ''})` : '(首次采纳免费)'}:</div>
        <div class="policy-grid">${POLICY_IDS.map((id) => {
          const p = POLICIES[id];
          const used = g.policies.includes(id);
          const lock = p.era > g.era;
          return `<button class="policy${used ? ' used' : ''}" data-policy="${id}" ${lock || used ? 'disabled' : ''}>
            <b>${p.name}</b>${lock ? ` <small>🔒${ERAS[p.era - 1].name}</small>` : ''}<span>${p.desc}</span></button>`;
        }).join('')}
        ${cur ? '<button class="policy" data-policy="__none"><b>撤销政策</b><span>清空此槽</span></button>' : ''}</div>`;
    }
    const c = g.contracts;
    const offers = c.offers.map((o) => {
      const have = Math.floor(g.res[o.res]);
      const ok = have >= o.qty;
      const rw = Object.entries(o.reward).map(([k, v]) => `${resIcon(k)}${v}`).join(' ');
      return `<div class="contract"><div><b>${o.client}</b> 求购 ${RESOURCES[o.res].icon} ${RESOURCES[o.res].name} ×${o.qty}
        <div class="desc">库存 ${have}/${o.qty} · 报酬 ${rw}(约集市 ${((o.reward.money / (o.qty * RESOURCES[o.res].price))).toFixed(1)} 倍)· 剩余 ${fmtTime(o.expires - g.time)}</div></div>
        <button class="btn ${ok ? 'primary' : ''}" data-deliver="${o.id}" ${ok ? '' : 'disabled'}>交付</button></div>`;
    }).join('') || '<div class="desc">暂无订单。城邦会不定期发布新合同。</div>';
    const vic = Object.values(VICTORIES).map((v) => {
      const p = v.progress(g);
      return `<div class="victory"><b>${v.icon} ${v.name}</b> <span class="desc">${v.desc}</span><div class="pbar"><i style="width:${p * 100}%"></i></div><small>${Math.floor(p * 100)}%</small></div>`;
    }).join('');
    return `<div class="dialog" data-modal="gov" style="max-width:760px">
      <h2><span>🏛️ 政务</span><button class="btn" data-close>关闭 Esc</button></h2>
      <h3 class="sub">胜利进度</h3><div class="victories">${vic}</div>
      ${this.greatHtml()}
      ${this.diplomacy()}
      <h3 class="sub">政策(每个时代多一个槽)</h3>
      <div class="slots">${slotHtml.join('')}</div>${picker}
      <h3 class="sub">贸易合同 <small>声望 ${c.reputation >= 0 ? '+' : ''}${c.reputation}(声望越高报价越好;合同过期会损失声望)</small></h3>
      ${offers}
    </div>`;
  }

  greatHtml() {
    const gp = this.game.great;
    if (!gp) return '';
    const ready = gp.ready.map((k, i) => `<button class="btn primary" data-great="${i}" title="${GREAT[k].desc}">${GREAT[k].icon} 使用${GREAT[k].name}</button>`).join('');
    const bars = Object.entries(GREAT).map(([k, v]) => {
      const need = gp.threshold(k);
      const prev = gp.earned[k] ? gp.threshold(k) - Math.round(100 * 1.8 ** gp.earned[k]) : 0;
      const p = Math.max(0, Math.min(1, (gp.points(k) - prev) / (need - prev)));
      return `<div class="victory"><b>${v.icon} ${v.name}</b><span class="desc">${v.source} → ${v.desc}</span><div class="pbar"><i style="width:${p * 100}%"></i></div><small>${Math.floor(gp.points(k))}/${need}</small></div>`;
    }).join('');
    return `<h3 class="sub">伟人</h3>${ready ? `<div class="btns" style="margin-bottom:8px">${ready}</div>` : ''}<div class="victories four">${bars}</div>`;
  }

  diplomacy() {
    const g = this.game;
    const ai = g.unitSystem?.ai;
    if (!ai) return '';
    if (g.difficulty?.peaceful) return '<h3 class="sub">外交 · 铁锈军团</h3><div class="desc">和平沙盒:双方签有永久停战协定。</div>';
    const eta = Math.max(0, Math.round(ai.nextWave - g.time));
    const used = ai.tributedWave === ai.wave + 1;
    const cost = ai.tributeCost();
    return `<h3 class="sub">外交 · 铁锈军团</h3>
      <div class="contract"><div>${ai.stopped ? '敌军暂时失去进攻能力' : `下一波(第 ${ai.wave + 1} 波)约 ${fmtTime(eta)} 后抵达`}
        <div class="desc">进贡 💰${cost} 可让敌军推迟 2 分钟进攻(每波限一次,价格随波次与时代上涨)</div></div>
        <button class="btn" data-tribute ${ai.stopped || used || g.res.money < cost ? 'disabled' : ''}>${used ? '已进贡' : '进贡'}</button></div>`;
  }

  /** 处理弹窗内点击;返回 true 表示需要重绘。 */
  onClick(e) {
    const g = this.game;
    const slot = e.target.closest('[data-slot]');
    if (slot) {
      const i = Number(slot.dataset.slot);
      this.pickSlot = this.pickSlot === i ? null : i;
      return true;
    }
    const pol = e.target.closest('[data-policy]');
    if (pol && this.pickSlot !== null) {
      const id = pol.dataset.policy === '__none' ? null : pol.dataset.policy;
      const r = g.dispatch({ type: 'policy', slot: this.pickSlot, id });
      if (!r.ok) this.ui.toast(r.reason, 'bad');
      else { this.ui.toast(id ? `📜 采纳政策「${POLICIES[id].name}」` : '已撤销政策', 'good'); this.pickSlot = null; }
      return true;
    }
    const gb = e.target.closest('[data-great]');
    if (gb) {
      const r = g.dispatch({ type: 'useGreat', i: Number(gb.dataset.great) });
      if (!r.ok) this.ui.toast(r.reason, 'bad');
      else this.ui.toast(`${GREAT[r.kind].icon} ${GREAT[r.kind].name}发挥了作用!`, 'good');
      return true;
    }
    if (e.target.closest('[data-tribute]')) {
      const r = g.dispatch({ type: 'tribute' });
      if (!r.ok) this.ui.toast(r.reason, 'bad');
      return true;
    }
    const d = e.target.closest('[data-deliver]');
    if (d) {
      const r = g.dispatch({ type: 'deliver', id: Number(d.dataset.deliver) });
      if (!r.ok) this.ui.toast(r.reason, 'bad');
      return true;
    }
    return false;
  }
}
