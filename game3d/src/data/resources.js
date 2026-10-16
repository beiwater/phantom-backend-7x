// 资源表。price = 市场基础收购价;era = 首次出现的时代(用于 UI 分组)。
export const RESOURCES = {
  grain: { name: '谷物', icon: '🌾', price: 2, color: '#e8c252', era: 1 },
  water: { name: '净水', icon: '💧', price: 1, color: '#4aa8e8', era: 1 },
  wood: { name: '原木', icon: '🪵', price: 2, color: '#9a6a3a', era: 1 },
  stone: { name: '石料', icon: '🪨', price: 2, color: '#9aa0a8', era: 1 },
  food: { name: '食物', icon: '🍞', price: 7, color: '#e89a52', era: 1 },
  planks: { name: '木板', icon: '🪚', price: 6, color: '#c89a5a', era: 1 },
  ironOre: { name: '铁矿石', icon: '⛰️', price: 3, color: '#b0705a', era: 1 },
  coal: { name: '煤炭', icon: '⚫', price: 3, color: '#3a3a40', era: 1 },
  steel: { name: '钢材', icon: '🔩', price: 14, color: '#8aa0b8', era: 1 },
  concrete: { name: '水泥', icon: '🧱', price: 9, color: '#b8b0a0', era: 1 },
  crude: { name: '原油', icon: '🛢️', price: 5, color: '#2a2030', era: 2 },
  fuel: { name: '燃油', icon: '⛽', price: 12, color: '#e8582a', era: 2 },
  plastic: { name: '塑料', icon: '🧴', price: 12, color: '#e0e0f0', era: 2 },
  ammo: { name: '弹药', icon: '💥', price: 16, color: '#c8a030', era: 2 },
  parts: { name: '机械零件', icon: '⚙️', price: 28, color: '#a0a8b0', era: 2 },
  electronics: { name: '电子元件', icon: '🔌', price: 36, color: '#40c890', era: 3 },
};

export const RESOURCE_IDS = Object.keys(RESOURCES);

export function resIcon(id) {
  if (id === 'money') return '💰';
  if (id === 'research') return '🔬';
  return RESOURCES[id]?.icon ?? '?';
}

export function resName(id) {
  if (id === 'money') return '金币';
  if (id === 'research') return '科研点';
  return RESOURCES[id]?.name ?? id;
}
