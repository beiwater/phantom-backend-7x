// 成就追踪:每 2 秒检查一次,解锁写入 localStorage(读写失败时只在本局内记录)。
import { ACHIEVEMENTS } from '../data/achievements.js';

const KEY = 'voxel-era-achievements';

export class Achievements {
  constructor(game, ui) {
    this.game = game;
    this.ui = ui;
    this.t = 2;
    try { this.unlocked = new Set(JSON.parse(localStorage.getItem(KEY) ?? '[]')); } catch { this.unlocked = new Set(); }
  }

  update(dt) {
    this.t -= dt;
    if (this.t > 0 || this.game.replay) return;
    this.t = 2;
    let changed = false;
    for (const a of ACHIEVEMENTS) {
      if (this.unlocked.has(a.id) || !a.test(this.game)) continue;
      this.unlocked.add(a.id);
      changed = true;
      this.ui.toast(`🏆 成就解锁:${a.name} —— ${a.desc}`, 'good');
      this.ui.audio?.play('tech');
    }
    if (changed) {
      try { localStorage.setItem(KEY, JSON.stringify([...this.unlocked])); } catch { /* 存储不可用 */ }
    }
  }

  html() {
    const rows = ACHIEVEMENTS.map((a) => {
      const ok = this.unlocked.has(a.id);
      return `<div class="ach${ok ? ' ok' : ''}"><b>${ok ? '🏆' : '🔒'} ${a.name}</b><span>${a.desc}</span></div>`;
    }).join('');
    return `<div class="dialog" style="max-width:720px"><h2><span>🏆 成就 ${this.unlocked.size}/${ACHIEVEMENTS.length}</span><button class="btn" data-close>关闭 Esc</button></h2>
      <div class="ach-grid">${rows}</div></div>`;
  }
}
