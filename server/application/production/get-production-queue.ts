import type { GameContext } from '../../context/game-context.ts';
import { buildingRepository } from '../../repositories/building-repository.ts';
import { productionRepository, type ProductionQueueEntity } from '../../repositories/production-repository.ts';
import { NotFoundError, ForbiddenError } from '../../errors/domain-error.ts';
import { getResourceDef } from '../../game-data/resources.ts';
import { warehouseRepository } from '../../repositories/warehouse-repository.ts';
/**
 * Fallback cost-per-unit for queue rows persisted before the cost basis
 * column existed (P0-02). Computes the weighted input cost from the CURRENT
 * recipe and warehouse cost accounting; never returns null/NaN.
 */
export function computeFallbackUnitCost(item: ProductionQueueEntity): number {
  const def = getResourceDef(item.kind);
  if (!def?.producedFrom || !item.amount || item.amount <= 0) return 0;
  let totalCost = 0;
  for (const [ingKindStr, ratio] of Object.entries(def.producedFrom)) {
    const ingKind = Number(ingKindStr);
    const need = ratio * item.amount;
    const rows = warehouseRepository.listBatchesForConsumption(item.companyId, ingKind, 'low', 0);
    let remaining = need;
    for (const row of rows) {
      if (remaining <= 0) break;
      const take = Math.min(Number(row.amount) || 0, remaining);
      const unitCost = (Number(row.cost_workers) || 0) + (Number(row.cost_admin) || 0) +
        (Number(row.cost_material1) || 0) + (Number(row.cost_material2) || 0) +
        (Number(row.cost_market) || 0);
      totalCost += take * unitCost;
      remaining -= take;
    }
  }
  return item.amount > 0 ? totalCost / item.amount : 0;
}

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
