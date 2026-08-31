import type { GameContext } from '../../context/game-context.ts';
import { buildingRepository, type BuildingEntity } from '../../repositories/building-repository.ts';

export async function getCompanyBuildingsUseCase(
  ctx: GameContext
): Promise<BuildingEntity[]> {
  return buildingRepository.findByCompany(ctx.companyId);
}
