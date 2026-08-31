import type { BuildingEntity } from '../../repositories/building-repository.ts';
import { productionRepository } from '../../repositories/production-repository.ts';
import { getBuildingMeta } from '../../game-data/buildings.ts';
import { getResourceDef } from '../../game-data/resources.ts';
import { finiteOr, computeFallbackUnitCost } from './production-dto.ts';

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
    busyObj = {
      id: activeQueue.id,
      started: activeQueue.startedAt,
      duration: Number(activeQueue.durationSeconds) || 0,
      accelerationFactor: 1,
      category: 'r',
      canFetch,
      manualResolve: false,
      resource: {
        kind: activeQueue.kind,
        name: `Resource #${activeQueue.kind}`,
        // P0-02: quality/cost must always be finite numbers. Legacy rows
        // persisted without a cost basis fall back to on-the-fly computation
        // from current warehouse data instead of null/undefined ($NaN).
        quality: Math.max(0, Math.floor(Number(activeQueue.quality) || 0)),
        unitCost: finiteOr(
          activeQueue.cost,
          computeFallbackUnitCost(activeQueue)
        ),
        amount: Number(activeQueue.amount) || 0,
        amountAvailableNow: canFetch ? Number(activeQueue.amount) || 0 : 0,
        image: resource?.image || ''
      }
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
