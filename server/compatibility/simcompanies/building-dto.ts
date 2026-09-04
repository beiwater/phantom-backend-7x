import type { BuildingEntity } from '../../repositories/building-repository.ts';
import { virtualClock } from '../../core/virtual-clock.ts';
import { productionRepository } from '../../repositories/production-repository.ts';
import { accumulatorRepository } from '../../repositories/accumulator-repository.ts';
import { retailRepository } from '../../repositories/retail-repository.ts';
import type { AccumulatorResourceState } from '../../game-data/accumulator.ts';
import { accumulatorStateDTO } from '../../game-data/accumulator.ts';
import { getBuildingMeta } from '../../game-data/buildings.ts';
import { getResourceDef, getResourceName } from '../../game-data/resources.ts';
import { finiteOr, computeFallbackUnitCost } from './production-dto.ts';
import { RECREATION_UPKEEP_DURATION_SECONDS } from '../../application/buildings/start-recreation-upkeep.ts';
import { calculateConstructionDurationSeconds } from '../../domain/buildings/building-rules.ts';
import { FixtureService } from '../../services/fixture-service.ts';
import {
  ROBOTICS_WAGE_MULTIPLIER,
  effectiveWageMultiplier,
  hasRobotsInstalled,
  requiredRobotCount,
  requiredRobotQuality
} from '../../game/robotics.ts';
import { rocketKindForLaunchRequest } from '../../game/aerospace.ts';
import {
  getLegacyRestaurantProperties,
  getRestaurantBusy,
  resolveDueRestaurantRunsSync,
  type LegacyRestaurantProperties
} from '../../application/restaurant/restaurant-use-cases.ts';

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
  /** Issue #200: Forest Nursery progress and source-cost state. */
  productionAccumulator?: AccumulatorResourceState;
  /** Compatibility payload consumed by the bundled restaurant detail view. */
  restaurantProperties?: LegacyRestaurantProperties;
}
export function toSimCompaniesBuildingDTO(
  building: BuildingEntity,
  companyName: string = 'Private Co',
  companyLogo: string = ''
): SimCompaniesBuildingDTO {
  const meta = getBuildingMeta(building.kind);
  const busyUntilMs = building.busyUntil ? new Date(building.busyUntil).getTime() : 0;
  const isConstructingOrUpgrading = busyUntilMs > virtualClock.nowMs();

  let busyObj: Record<string, unknown> | null = null;
  const activeQueue = productionRepository.findLatestActiveByBuilding(building.id, building.companyId);

  if (activeQueue) {
    const launchRocketKind = building.kind === 'l' && activeQueue.kind === 100
      ? rocketKindForLaunchRequest(activeQueue.kind, Number(activeQueue.amount))
      : null;
    const displayKind = launchRocketKind ?? activeQueue.kind;
    const displayResource = getResourceDef(displayKind);
    // Launch busy markers use kind 100 so the original client recognizes the
    // aerospace-specific busy panel; the queue card derives the rocket from
    // the research amount and its nested resource metadata.
    const busyKind = launchRocketKind === null ? displayKind : activeQueue.kind;
    const busyResource = launchRocketKind === null ? displayResource : getResourceDef(busyKind);
    const displayAmount = launchRocketKind === null ? Number(activeQueue.amount) || 0 : 1;
    const canFetch = new Date(activeQueue.finishesAt).getTime() <= virtualClock.nowMs();
    const isSales = building.category === 'sales';
    const isAccumulatorQueue = building.kind === 'v' && activeQueue.kind === 150;
    const accumulatorState = isAccumulatorQueue
      ? accumulatorRepository.findByBuilding(building.id, building.companyId)
      : null;
    busyObj = {
      id: activeQueue.id,
      started: activeQueue.startedAt,
      resource: {
        kind: busyKind,
        name: getResourceName(busyKind),
        quality: Math.max(0, Math.floor(Number(activeQueue.quality) || 0)),
        unitCost: finiteOr(
          activeQueue.cost,
          computeFallbackUnitCost(activeQueue)
        ),
        amount: displayAmount,
        amountAvailableNow: isSales || launchRocketKind !== null
          ? 0
          : (canFetch ? displayAmount : 0),
        image: busyResource?.image || ''
      },
      economyPhase: activeQueue.economyPhase,
      economyPhaseStartedAt: activeQueue.economyPhaseStartedAt,
      economySource: activeQueue.economySource,
      productionModifier: activeQueue.productionModifier,
      productionOutputMultiplier: activeQueue.productionOutputMultiplier,
      ...(isAccumulatorQueue
        ? {
            category: 'nurturing',
            accumulator: {
              value: Number(activeQueue.amount) || 0,
              unitCost: finiteOr(activeQueue.cost, 0)
            }
          }
        : {})
    };
  } else if (building.kind === 'r') {
    resolveDueRestaurantRunsSync(building.id, building.companyId);
    const restaurantBusy = getRestaurantBusy(building.id);
    if (restaurantBusy) busyObj = restaurantBusy;
  } else if ((building.category === 'sales' || building.category === 'seasonal') && building.kind !== 'B') {
    const retailOrders = retailRepository.findByCompanyAndBuilding(building.companyId, building.id);
    const latestOrder = retailOrders[0];
    if (latestOrder) {
      const finishedAtMs = latestOrder.finishedAt ? new Date(latestOrder.finishedAt).getTime() : 0;
      const canFetch = finishedAtMs > 0 && finishedAtMs <= virtualClock.nowMs();
      const resDef = getResourceDef(latestOrder.resourceKind);
      const revenue = Math.round(latestOrder.units * latestOrder.unitPrice * 100) / 100;
      const startedMs = new Date(latestOrder.createdAt).getTime();
      const durationSeconds = finishedAtMs > 0
        ? Math.max(1, Math.round((finishedAtMs - startedMs) / 1000))
        : 0;
      busyObj = {
        id: latestOrder.id,
        started: latestOrder.createdAt,
        duration: durationSeconds,
        category: 's',
        canFetch,
        sales_order: {
          id: latestOrder.id,
          image: resDef?.image || '',
          name: resDef?.name || `Resource #${latestOrder.resourceKind}`,
          amount: latestOrder.units,
          price: latestOrder.unitPrice,
          quality: latestOrder.quality || 0,
          remainingProfit: revenue,
          profitAvailableNow: canFetch ? revenue : 0
        }
      };
    } else if (isConstructingOrUpgrading) {
      const mode = FixtureService.getActiveConstructionTimeMode();
      const speedMultiplier = FixtureService.getConstructionSpeedMultiplier();
      const isRealistic = mode === 'realistic' || (busyUntilMs - virtualClock.nowMs() > 15000);
      const duration = isRealistic
        ? calculateConstructionDurationSeconds(building.kind, building.size || 1, 'realistic', speedMultiplier)
        : 10;
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
  } else if (isConstructingOrUpgrading && building.upkeepActive) {
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
    const mode = FixtureService.getActiveConstructionTimeMode();
    const speedMultiplier = FixtureService.getConstructionSpeedMultiplier();
    const isRealistic = mode === 'realistic' || (busyUntilMs - virtualClock.nowMs() > 15000);
    const duration = isRealistic
      ? calculateConstructionDurationSeconds(building.kind, building.size || 1, 'realistic', speedMultiplier)
      : 10;
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

  const accumulatorState = building.kind === 'v'
    ? accumulatorRepository.findByBuilding(building.id, building.companyId)
    : null;
  const dto: SimCompaniesBuildingDTO = {
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
    created: building.createdAt || virtualClock.nowIso(),
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
    productionAccumulator: building.kind === 'v'
      ? accumulatorStateDTO(150, accumulatorState?.value ?? 0, accumulatorState?.costTotal ?? 0)
      : undefined,
    workers: (building.size || 1) * 10
  };

  if (building.kind === 'r') {
    dto.restaurantProperties = getLegacyRestaurantProperties(building.id, building.companyId);
  }
  return dto;
}

export function toSimCompaniesBuildingsListDTO(
  buildings: BuildingEntity[],
  companyName: string = 'Private Co',
  companyLogo: string = ''
): SimCompaniesBuildingDTO[] {
  return buildings.map(b => toSimCompaniesBuildingDTO(b, companyName, companyLogo));
}
