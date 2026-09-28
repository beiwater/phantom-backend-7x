import type { GameContext } from '../../context/game-context.ts';
import { buildingRepository, type BuildingEntity } from '../../repositories/building-repository.ts';
import { resolveDueRestaurantRuns } from '../restaurant/restaurant-use-cases.ts';
import { resolveDueAccumulatorGrowth } from '../production/collect-accumulator.ts';

export async function getCompanyBuildingsUseCase(
  ctx: GameContext
): Promise<BuildingEntity[]> {
  const buildings = buildingRepository.findByCompany(ctx.companyId);
  for (const building of buildings.filter(item => item.kind === 'v')) {
    await resolveDueAccumulatorGrowth(building.id, ctx.companyId);
  }
  if (buildings.some(building => building.kind === 'r')) {
    await resolveDueRestaurantRuns(undefined, ctx.companyId);
    return buildingRepository.findByCompany(ctx.companyId);
  }
  return buildings.some(building => building.kind === 'v')
    ? buildingRepository.findByCompany(ctx.companyId)
    : buildings;
}
