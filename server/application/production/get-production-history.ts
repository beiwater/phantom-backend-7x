import type { GameContext } from '../../context/game-context.ts';
import { buildingRepository } from '../../repositories/building-repository.ts';
import { productionRepository, type ProductionQueueEntity } from '../../repositories/production-repository.ts';
import { NotFoundError } from '../../errors/domain-error.ts';

export async function getProductionHistoryUseCase(
  _ctx: GameContext,
  buildingId: number,
  limit: number = 20
): Promise<ProductionQueueEntity[]> {
  const building = buildingRepository.findById(buildingId);
  if (!building) {
    throw new NotFoundError(`Building ${buildingId} not found`);
  }

  return productionRepository.findHistoryByBuilding(buildingId, limit);
}
