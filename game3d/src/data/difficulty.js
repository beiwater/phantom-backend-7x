// 难度:影响起始资源、敌军首波时间、每波规模与敌军单位生命。
export const DIFFICULTIES = {
  peace: { name: '和平沙盒', startMult: 1.5, firstWave: Infinity, waveMult: 0, enemyHp: 1, peaceful: true, desc: '敌军不进攻也不扩张,专心经营,追求科技或经济胜利。' },
  easy: { name: '和平建设', startMult: 1.5, firstWave: 480, waveMult: 0.6, enemyHp: 0.8, desc: '敌军来得晚、规模小,专注经营。' },
  normal: { name: '标准', startMult: 1, firstWave: 300, waveMult: 1, enemyHp: 1, desc: '均衡的经营与战争节奏。' },
  hard: { name: '铁血', startMult: 0.8, firstWave: 210, waveMult: 1.5, enemyHp: 1.25, desc: '敌军更早、更多、更硬。' },
};
