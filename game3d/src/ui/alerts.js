// 问题提醒:把状态异常的建筑按原因聚合(未连接道路 / 缺原料 / 仓库满 / 断粮…),点击循环定位。
const RULES = [
  { key: 'road', icon: '🛣️', label: '未连接道路', test: (s) => s === '未连接道路' },
  { key: 'input', icon: '📦', label: '缺少原料', test: (s) => s.startsWith('缺少') && s !== '缺少工人' && s !== '缺少食物' },
  { key: 'full', icon: '🏚️', label: '仓库已满', test: (s) => s === '仓库已满' },
  { key: 'food', icon: '🍞', label: '民居断粮', test: (s) => s === '缺少食物' },
  { key: 'workers', icon: '👷', label: '工人不足', test: (s) => s.includes('工人') },
  { key: 'power', icon: '⚡', label: '电力不足', test: (s) => s.includes('电力') },
  { key: 'market', icon: '🏪', label: '集市未选货', test: (s) => s === '未选择出售货物' },
  { key: 'damaged', icon: '🔧', label: '严重受损', test: (s, b) => b.hp < b.maxHp * 0.5 },
];

export class Alerts {
  constructor(game, ui) {
    this.game = game;
    this.ui = ui;
    this.el = document.createElement('div');
    this.el.id = 'alerts';
    document.getElementById('app').appendChild(this.el);
    this.cursor = {};
    this.groups = new Map();
    this.t = 0;
    this.el.addEventListener('click', (e) => {
      const k = e.target.closest('[data-alert]')?.dataset.alert;
      if (k) this.focusNext(k);
    });
  }

  focusNext(key) {
    const list = this.groups.get(key);
    if (!list?.length) return;
    const i = (this.cursor[key] = ((this.cursor[key] ?? -1) + 1) % list.length);
    const b = list[i];
    this.ui.rig.lookAt(b.x + b.w / 2, b.z + b.d / 2);
    this.ui.select({ building: b });
  }

  update(dt) {
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.6;
    const g = this.game;
    this.groups = new Map();
    for (const b of g.buildings.values()) {
      if (b.team !== g.localPlayer || b.state !== 'active') continue;
      const s = b.status ?? '';
      for (const r of RULES) {
        if (r.test(s, b)) {
          if (!this.groups.has(r.key)) this.groups.set(r.key, []);
          this.groups.get(r.key).push(b);
          break;
        }
      }
    }
    const html = RULES.filter((r) => this.groups.get(r.key)?.length)
      .map((r) => `<button class="alert" data-alert="${r.key}" title="点击依次定位">${r.icon} ${r.label} ×${this.groups.get(r.key).length}</button>`).join('');
    if (html !== this.last) {
      this.last = html;
      this.el.innerHTML = html;
    }
  }
}
