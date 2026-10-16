// 建筑专精模块(「模块化组合」的决策层):生产/集市建筑达到 3 级后可选择一个模块,可付费更换。
export const MODULES = {
  speed: { name: '效率模块', icon: '⚙️', color: 0xec8a2a, desc: '生产速度 +25%', cost: { money: 300, parts: 4 } },
  eco: { name: '环保模块', icon: '🌿', color: 0x3fae5a, desc: '不再污染民居,所需工人 -30%', cost: { money: 250, concrete: 6 } },
  storage: { name: '仓储模块', icon: '📦', color: 0x3a7bd5, desc: '全局仓储上限 +150', cost: { money: 200, planks: 10 } },
};
export const MODULE_MIN_LEVEL = 3;
