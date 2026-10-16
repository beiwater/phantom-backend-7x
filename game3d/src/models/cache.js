// 体素模型 → 几何体缓存。同一 (类型, 等级, 阵营) 只构建一次,所有实例共享几何体。
import { BUILDINGS } from '../data/buildings.js';
import {
  buildBuildingModel, buildTurretHeadModel, buildRoadModel, buildWallModel, buildUnitModel,
  buildTreeModel, buildRockModel, buildDepositModel, buildTruckModel, buildScaffoldModel, buildRubbleModel,
} from './index.js';

const cache = new Map();

function memo(key, make) {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
}

export function buildingGeo(type, level, team) {
  return memo(`b:${type}:${level}:${team}`, () => {
    const [w, d] = BUILDINGS[type].size;
    const m = buildBuildingModel(type, level, team);
    const offX = (w * 8) / 2;
    const offZ = (d * 8) / 2;
    return {
      geo: m.toGeometry({ footW: w, footD: d }),
      // 烟囱点转换为以占地中心为原点的世界单位
      smoke: (m.smoke ?? []).map(([x, y, z]) => [(x + 0.5 - offX) / 8, (y + 1) / 8, (z + 0.5 - offZ) / 8]),
      labelY: (m.labelY ?? m.height() + 2) / 8,
    };
  });
}

export function turretHeadGeo(level, team) {
  return memo(`th:${level}:${team}`, () => {
    const m = buildTurretHeadModel(level, team);
    return { geo: m.toGeometry({ footW: 0, footD: 0 }), pivotY: (m.pivotY ?? 8) / 8 };
  });
}

export function roadGeo(mask) {
  return memo(`r:${mask}`, () => buildRoadModel(mask).toGeometry({ footW: 1, footD: 1, jitter: 0.03 }));
}

export function wallGeo(mask, level, team) {
  return memo(`w:${mask}:${level}:${team}`, () => buildWallModel(mask, level, team).toGeometry({ footW: 1, footD: 1 }));
}

function unitScaleGeo(m) {
  return m.toGeometry({ footW: m.footW ?? 1, footD: m.footD ?? 1, scale: 1 / 16 });
}

export function unitGeos(unitId, team) {
  return memo(`u:${unitId}:${team}`, () => {
    const parts = buildUnitModel(unitId, team);
    return {
      body: unitScaleGeo(parts.body),
      top: parts.top ? parts.top.toGeometry({ footW: 0, footD: 0, scale: 1 / 16 }) : null,
      topY: (parts.topY ?? 0) / 16,
      height: parts.body.height() / 16,
    };
  });
}

export function truckGeo(team = 'player') {
  return memo(`truck:${team}`, () => unitScaleGeo(buildTruckModel(team)));
}

export function treeGeo(v) { return memo(`tree:${v}`, () => buildTreeModel(v).toGeometry({ footW: 1, footD: 1, jitter: 0.08 })); }
export function rockGeo(v) { return memo(`rock:${v}`, () => buildRockModel(v).toGeometry({ footW: 1, footD: 1 })); }
export function depositGeo(kind) { return memo(`dep:${kind}`, () => buildDepositModel(kind).toGeometry({ footW: 1, footD: 1 })); }
export function scaffoldGeo(w, d) { return memo(`sc:${w}:${d}`, () => buildScaffoldModel(w, d).toGeometry({ footW: w, footD: d })); }
export function rubbleGeo(w, d) { return memo(`rb:${w}:${d}`, () => buildRubbleModel(w, d).toGeometry({ footW: w, footD: d })); }
