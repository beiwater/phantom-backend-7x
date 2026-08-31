import type { GameContext } from '../../context/game-context.ts';
import { buildingRepository, type BuildingEntity } from '../../repositories/building-repository.ts';
import { NotFoundError, ForbiddenError, ValidationError } from '../../errors/domain-error.ts';

export async function renameBuildingUseCase(
  ctx: GameContext,
  buildingId: number,
  newName: string
): Promise<BuildingEntity> {
  // C-20: reject empty and oversized names before any persistence. Official
  // client caps building names well below 64 chars; 64 is the server-side hard cap.
  const cleanName = String(newName ?? '').trim();
  if (!cleanName) {
    throw new ValidationError('Building name cannot be empty');
  }
  if (cleanName.length > 64) {
    throw new ValidationError('Building name must be at most 64 characters');
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
