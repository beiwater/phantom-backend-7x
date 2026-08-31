import type { GameContext } from '../../context/game-context.ts';
import { buildingRepository } from '../../repositories/building-repository.ts';
import { productionRepository, type ProductionQueueEntity } from '../../repositories/production-repository.ts';
import { NotFoundError, ForbiddenError } from '../../errors/domain-error.ts';

export async function getProductionQueueUseCase(
  ctx: GameContext,
  buildingId: number
): Promise<ProductionQueueEntity[]> {
  const building = buildingRepository.findById(buildingId);
  if (!building) {
    throw new NotFoundError(`Building ${buildingId} not found`);
  }
  if (building.companyId !== ctx.companyId) {
    throw new ForbiddenError('You do not own this building');
  }

  return productionRepository.findActiveByBuilding(buildingId, ctx.companyId);
}
