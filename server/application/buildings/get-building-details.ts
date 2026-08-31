import type { GameContext } from '../../context/game-context.ts';
import { buildingRepository, type BuildingEntity } from '../../repositories/building-repository.ts';
import { NotFoundError } from '../../errors/domain-error.ts';

export async function getBuildingDetailsUseCase(
  _ctx: GameContext,
  buildingId: number
): Promise<BuildingEntity> {
  const building = buildingRepository.findById(buildingId);
  if (!building) {
    throw new NotFoundError(`Building ${buildingId} not found`);
  }
  return building;
}
