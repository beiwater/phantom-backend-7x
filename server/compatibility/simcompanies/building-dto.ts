import type { BuildingEntity } from '../../repositories/building-repository.ts';
import { productionRepository } from '../../repositories/production-repository.ts';
import { getBuildingMeta } from '../../game-data/buildings.ts';
import { getResourceDef } from '../../game-data/resources.ts';
import { finiteOr, computeFallbackUnitCost } from './production-dto.ts';
import { RECREATION_UPKEEP_DURATION_SECONDS } from '../../application/buildings/start-recreation-upkeep.ts';
import {
  ROBOTICS_WAGE_MULTIPLIER,
  effectiveWageMultiplier,
  hasRobotsInstalled,
  requiredRobotCount,
  requiredRobotQuality
} from '../../game/robotics.ts';

export interface SimCompaniesBuildingDTO {
  id: number;
  busy: Record<string, unknown> | null;
  category: string;
  company: {
    id: number;
    name: string;
    logo: string;
  };
  cost: number;
  costUnits: number;
  country: string;
  created: string;
  isUnderConstruction: boolean;
  kind: string;
  level: number;
  name: string;
  position: string;
  realm: number;
  size: number;
  workers: number;
  /** Issue #96: robotics state; null while the building is not robotized. */
  robotics: {
    installed: boolean;
    installedRobots: number;
    installedQuality: number;
    requiredRobots: number;
    requiredQuality: number;
    lockedProduct: number | null;
    wageMultiplier: number;
  } | null;
}

export function toSimCompaniesBuildingDTO(
  building: BuildingEntity,
  companyName: string = 'Private Co',
  companyLogo: string = ''
): SimCompaniesBuildingDTO {
  const meta = getBuildingMeta(building.kind);
  const busyUntilMs = building.busyUntil ? new Date(building.busyUntil).getTime() : 0;
  const isConstructingOrUpgrading = busyUntilMs > Date.now();

  let busyObj: Record<string, unknown> | null = null;
  const activeQueue = productionRepository.findLatestActiveByBuilding(building.id, building.companyId);

  if (activeQueue) {
    const resource = getResourceDef(activeQueue.kind);
    const canFetch = new Date(activeQueue.finishesAt).getTime() <= Date.now();
    const isSales = building.category === 'sales';
    busyObj = {
      id: activeQueue.id,
      started: activeQueue.startedAt,
      duration: Number(activeQueue.durationSeconds) || 0,
      accelerationFactor: 1,
      category: isSales ? 's' : 'r',
      canFetch: isSales ? false : canFetch,
      manualResolve: false,
      resource: {
        kind: activeQueue.kind,
        name: resource?.name || `Resource #${activeQueue.kind}`,
        quality: Math.max(0, Math.floor(Number(activeQueue.quality) || 0)),
        unitCost: finiteOr(
          activeQueue.cost,
          computeFallbackUnitCost(activeQueue)
        ),
        amount: Number(activeQueue.amount) || 0,
        amountAvailableNow: isSales ? 0 : (canFetch ? Number(activeQueue.amount) || 0 : 0),
        image: resource?.image || ''
      }
    };
  } else if (isConstructingOrUpgrading && building.upkeepActive) {
    // P1-09: active recreation upkeep. The client derives the +1%/size
    // production & sales speed bonus from busy.upkeep being truthy and
    // renders "funds last until started + duration" from these fields.
    busyObj = {
      id: building.id,
      started: new Date(busyUntilMs - RECREATION_UPKEEP_DURATION_SECONDS * 1000).toISOString(),
      duration: RECREATION_UPKEEP_DURATION_SECONDS,
      accelerationFactor: 1,
      category: 'u',
      upkeep: true,
      canFetch: false
    };
  } else if (isConstructingOrUpgrading) {
    const duration = 10;
    const startedMs = busyUntilMs - duration * 1000;
    busyObj = {
      id: building.id,
      started: new Date(startedMs).toISOString(),
      duration,
      category: 'b',
      expanding: true,
      canFetch: false
    };
  }

  return {
    id: building.id,
    busy: busyObj,
    category: building.category || meta.category || 'production',
    company: {
      id: building.companyId,
      name: companyName,
      logo: companyLogo
    },
    cost: building.cost || meta.cost || 6900,
    costUnits: 2,
    country: 'AU',
    created: building.createdAt || new Date().toISOString(),
    isUnderConstruction: isConstructingOrUpgrading,
    kind: building.kind,
    level: building.size || 1,
    name: building.name || meta.name || 'Building',
    position: String(building.position),
    realm: 0,
    size: building.size || 1,
    robotics: hasRobotsInstalled(building)
      ? {
          installed: true,
          installedRobots: Number(building.robotsInstalled) || 0,
          installedQuality: Number(building.robotsQuality) || 0,
          requiredRobots: requiredRobotCount(building.kind, building.size || 1),
          requiredQuality: requiredRobotQuality(building.size || 1),
          lockedProduct: building.lockedProduct,
          wageMultiplier: effectiveWageMultiplier(building)
        }
      : {
          installed: false,
          installedRobots: 0,
          installedQuality: 0,
          requiredRobots: requiredRobotCount(building.kind, building.size || 1),
          requiredQuality: requiredRobotQuality(building.size || 1),
          lockedProduct: null,
          wageMultiplier: 1
        },
    workers: (building.size || 1) * 10
  };
}

export function toSimCompaniesBuildingsListDTO(
  buildings: BuildingEntity[],
  companyName: string = 'Private Co',
  companyLogo: string = ''
): SimCompaniesBuildingDTO[] {
  return buildings.map(b => toSimCompaniesBuildingDTO(b, companyName, companyLogo));
}
