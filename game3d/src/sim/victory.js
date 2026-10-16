// 多种胜利方式(文明式):征服 / 科技 / 经济。每秒检查一次(模拟内,确定性)。
import { TECH_IDS } from '../data/tech.js';

export const VICTORIES = {
  domination: {
    name: '征服胜利', icon: '⚔️', desc: '摧毁敌军指挥中心。',
    progress(g) {
      const hq = [...g.buildings.values()].find((b) => b.type === 'hq' && b.team === 'enemy');
      return hq ? 1 - hq.hp / hq.maxHp : 1;
    },
  },
  science: {
    name: '科技胜利', icon: '🚀', desc: '研究全部 16 项科技,并拥有一座 3 级以上研究所。',
    progress(g) {
      const techs = g.techs.size / TECH_IDS.length;
      const lab = [...g.buildings.values()].some((b) => b.team === g.localPlayer && b.type === 'lab' && b.level >= 3 && b.state === 'active');
      return Math.min(1, techs * 0.85 + (lab ? 0.15 : 0));
    },
  },
  economic: {
    name: '经济胜利', icon: '💰', desc: '贸易声望达到 15,且金币储备达到 30000。',
    progress(g) {
      const rep = Math.max(0, g.contracts?.reputation ?? 0) / 15;
      return Math.min(1, Math.min(1, rep) * 0.5 + Math.min(1, g.res.money / 30000) * 0.5);
    },
  },
};

export class Victory {
  constructor(game) {
    this.game = game;
    this.t = 1;
  }

  step(gdt) {
    this.t -= gdt;
    if (this.t > 0) return;
    this.t = 1;
    const g = this.game;
    if (g.over) return;
    for (const [id, v] of Object.entries(VICTORIES)) {
      if (id !== 'domination' && v.progress(g) >= 1) {
        g.endGame('win', id);
        return;
      }
    }
  }
}
