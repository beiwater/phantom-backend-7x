import type { GameContext } from '../../context/game-context.ts';
import { buildingRepository, type BuildingEntity } from '../../repositories/building-repository.ts';
import { NotFoundError, ForbiddenError, ValidationError } from '../../errors/domain-error.ts';

export async function renameBuildingUseCase(
  ctx: GameContext,
  buildingId: number,
  newName: string
): Promise<BuildingEntity> {
  const cleanName = String(newName || '').trim();
  if (!cleanName) {
    throw new ValidationError('Building name cannot be empty');
  }

  const building = buildingRepository.findById(buildingId);
  if (!building) {
    throw new NotFoundError(`Building with id ${buildingId} not found`);
  }
  if (building.companyId !== ctx.companyId) {
    throw new ForbiddenError('You do not own this building');
  }

  return buildingRepository.updateName(buildingId, ctx.companyId, cleanName);
}
