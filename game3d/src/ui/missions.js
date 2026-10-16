// 主线任务追踪:完成即发奖励并推进;进度条实时刷新。
import { MISSIONS } from '../data/missions.js';
import { resIcon } from '../data/resources.js';

export class Missions {
  constructor(game, ui) {
    this.game = game;
    this.ui = ui;
    this.el = document.getElementById('missions');
    this.t = 0;
    this.el.addEventListener('click', (e) => {
      if (e.target.closest('[data-toggle]')) this.el.classList.toggle('collapsed');
    });
  }

  update(dt) {
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.4;
    const g = this.game;
    const m = MISSIONS[g.mission];
    if (m && m.progress(g) >= 1) {
      for (const [k, v] of Object.entries(m.reward)) if (v) g.addRes(k, v);
      const rw = Object.entries(m.reward).filter(([, v]) => v).map(([k, v]) => `${resIcon(k)}${v}`).join(' ');
      this.ui.toast(`🎯 目标完成:${m.title}${rw ? ` 奖励 ${rw}` : ''}`, 'good');
      g.mission++;
    }
    this.render();
  }

  render() {
    const g = this.game;
    const m = MISSIONS[g.mission];
    const head = `<h3><span>📜 目标 ${Math.min(g.mission + 1, MISSIONS.length)}/${MISSIONS.length}</span><button class="btn" data-toggle style="padding:0 6px">–</button></h3>`;
    if (!m) {
      this.el.innerHTML = `${head}<div class="body"><div class="goal">🏆 全部完成</div></div>`;
      return;
    }
    const p = m.progress(g);
    const rw = Object.entries(m.reward).filter(([, v]) => v).map(([k, v]) => `${resIcon(k)}${v}`).join(' ');
    const html = `${head}<div class="body"><div class="goal">${m.title}:${m.goal}</div>
      <div class="hint">${m.hint}</div>
      <div class="bar"><i style="width:${p * 100}%"></i></div>
      ${rw ? `<div class="reward">奖励 ${rw}</div>` : ''}</div>`;
    if (html !== this.last) {
      this.last = html;
      this.el.innerHTML = html;
    }
  }
}
