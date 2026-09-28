import type { GameContext } from '../../context/game-context.ts';
import { buildingRepository, type BuildingEntity } from '../../repositories/building-repository.ts';
import { NotFoundError } from '../../errors/domain-error.ts';
import { resolveDueRestaurantRuns } from '../restaurant/restaurant-use-cases.ts';
import { resolveDueAccumulatorGrowth } from '../production/collect-accumulator.ts';

export async function getBuildingDetailsUseCase(
  _ctx: GameContext,
  buildingId: number
): Promise<BuildingEntity> {
  const building = buildingRepository.findById(buildingId);
  if (!building) {
    throw new NotFoundError(`Building ${buildingId} not found`);
  }
  if (building.kind === 'r') {
    await resolveDueRestaurantRuns(buildingId, building.companyId);
    const settled = buildingRepository.findById(buildingId);
    if (!settled) throw new NotFoundError(`Building ${buildingId} not found`);
    return settled;
  }
  if (building.kind === 'v') {
    await resolveDueAccumulatorGrowth(buildingId, building.companyId);
    return buildingRepository.findById(buildingId)!;
  }
  return building;
}
