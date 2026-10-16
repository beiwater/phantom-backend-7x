// 体素模型统一入口。所有构建函数返回 VoxelModel(或单位的 {body, top?, topY?})。
// 元数据约定:
//   building.smoke  = [[x,y,z], ...] 烟口体素坐标(居中前的模型空间),cache.js 在其上方 1 格发烟
//   building.labelY = 体素高度(楼顶 + 2)
//   turret head      原点 = 旋转轴,pivotY = 塔身上的安装高度(体素)
//   unit/truck body  footW = footD = N/8,以 scale 1/16 构建;top 原点即旋转轴
import { BUILDINGS } from '../data/buildings.js';
import { hq, house, market, warehouse, academy, lab } from './buildings-core.js';
import { farm, lumber, quarry, pump, ironMine, coalMine, oilWell } from './buildings-raw.js';
import { foodFactory, sawmill, steelMill, cement, power } from './buildings-industry.js';
import { refinery, chemical, munitions, machine, electronics } from './buildings-industry2.js';
import { barracks, vehicleFactory, airfield, turret, turretHead } from './buildings-military.js';
import { road, wall } from './infra.js';
import { unit, truck } from './units.js';
import { tree, rock, deposit, scaffold, rubble } from './props.js';

const BUILDERS = {
  hq, house, farm, lumber, quarry, pump, ironMine, coalMine, oilWell,
  foodFactory, sawmill, steelMill, cement, power, refinery, chemical, munitions, machine, electronics,
  market, warehouse, academy, lab, barracks, vehicleFactory, airfield, turret,
  wall: (level, team) => wall(0, level, team),
};

function clampLevel(id, level) {
  const max = BUILDINGS[id]?.maxLevel ?? 1;
  return Math.max(1, Math.min(max, Math.floor(level) || 1));
}

export function buildBuildingModel(id, level, team = 'player') {
  const make = BUILDERS[id];
  if (!make) throw new Error(`unknown building id: ${id}`);
  return make(clampLevel(id, level), team);
}

export function buildTurretHeadModel(level, team = 'player') {
  return turretHead(clampLevel('turret', level), team);
}

export function buildRoadModel(mask) {
  return road(mask & 15);
}

export function buildWallModel(mask, level, team = 'player') {
  return wall(mask & 15, clampLevel('wall', level), team);
}

// 以下构建函数签名与游戏 API 一致,直接按名导出
export {
  unit as buildUnitModel, truck as buildTruckModel,
  tree as buildTreeModel, rock as buildRockModel, deposit as buildDepositModel,
  scaffold as buildScaffoldModel, rubble as buildRubbleModel,
};
