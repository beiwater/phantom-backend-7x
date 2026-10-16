// 相邻协同(「可拼接」的经济意义):上下游建筑紧贴放置时,下游效率提升。
// 每个不同的协同伙伴 +10%,最多 +30%;伙伴须在占地外扩 1 格范围内且已建成。
export const SYNERGY = {
  farm: ['pump', 'foodFactory'],
  pump: ['farm', 'foodFactory', 'chemical'],
  foodFactory: ['farm', 'pump', 'market'],
  lumber: ['sawmill'],
  sawmill: ['lumber', 'machine'],
  quarry: ['cement'],
  ironMine: ['steelMill'],
  coalMine: ['steelMill', 'power', 'cement'],
  steelMill: ['ironMine', 'coalMine', 'machine', 'munitions'],
  cement: ['quarry', 'coalMine'],
  oilWell: ['refinery', 'chemical'],
  refinery: ['oilWell', 'vehicleFactory'],
  chemical: ['oilWell', 'pump', 'electronics'],
  power: ['coalMine'],
  munitions: ['steelMill', 'barracks'],
  machine: ['steelMill', 'sawmill', 'vehicleFactory'],
  electronics: ['chemical', 'lab', 'airfield'],
  academy: ['house', 'market'],
  lab: ['electronics', 'academy'],
  market: ['house', 'foodFactory'],
};

export const SYNERGY_STEP = 0.1;
export const SYNERGY_CAP = 0.3;

/** 返回 { bonus, partners: [type...] }。footprint 可为尚未放置的预览。 */
export function synergyAt(game, type, x, z, w, d, team = 'player', selfUid = 0) {
  const wants = SYNERGY[type];
  if (!wants) return { bonus: 0, partners: [] };
  const found = new Set();
  for (let zz = z - 1; zz <= z + d; zz++) {
    for (let xx = x - 1; xx <= x + w; xx++) {
      const o = game.buildingAt(xx, zz);
      if (!o || o.uid === selfUid || o.team !== team || o.state === 'construct') continue;
      if (wants.includes(o.type)) found.add(o.type);
    }
  }
  const partners = [...found];
  return { bonus: Math.min(SYNERGY_CAP, partners.length * SYNERGY_STEP), partners };
}
