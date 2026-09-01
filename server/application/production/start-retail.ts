import type { GameContext } from '../../context/game-context.ts';
import { runInTransaction } from '../../db/transaction.ts';
import { buildingRepository, type BuildingEntity } from '../../repositories/building-repository.ts';
import { NotFoundError, ForbiddenError, ValidationError } from '../../errors/domain-error.ts';
import { db } from '../../db/database.ts';
import { updateCompanyMoney } from '../../game/company.ts';
import { recordCashLedger, refreshDailyFinanceSnapshot } from '../../game/cash-ledger.ts';
import { getResourceDef } from '../../game-data/resources.ts';
import { addCompanyExperience } from '../../game/company.ts';
import { getWarehouseItemExact, consumeResourceExactWithTransactions } from '../../game/warehouse.ts';
import {
  RETAIL_PRODUCTS,
  getAuthoritativeRetailPrice,
  calculateRetailDuration
} from '../../game-data/retail.ts';

export interface StartRetailInput {
  buildingId: number;
  kind: number;
  amount: number;
  price: number;
  forceQuality?: number | null;
}

export interface StartRetailResult {
  building: BuildingEntity;
  revenue: number;
  newMoney: number;
  resourceTransactions: Array<{ kind: number; quality: number; amount: number }>;
}

/**
 * P0-06: the original client's retail sell flow POSTs /api/v1/busy/:id/ with
 * { kind, amount, price, estimatedSecondsToFinish, forceQuality } on a SALES
 * building (see bundle startRetail). The units leave the warehouse immediately
 * and the cash (revenue) plus the cash_ledger entry (category 's' = SALES) are
 * written in the same transaction as the busy-state update (Issue #68).
 * The sale completes after calculateRetailDuration, when the busy window ends.
 */
export async function startRetailUseCase(
  ctx: GameContext,
  input: StartRetailInput
): Promise<StartRetailResult> {
  return runInTransaction(async txCtx => {
    const building = buildingRepository.findById(input.buildingId);
    if (!building) {
      throw new NotFoundError(`Building ${input.buildingId} not found`);
    }
    if (building.companyId !== ctx.companyId) {
      throw new ForbiddenError('You do not own this building');
    }
    if (building.category !== 'sales') {
      throw new ValidationError(
        `Resource ${input.kind} cannot be produced in building type '${building.kind}'`
      );
    }
    if (building.busyUntil && new Date(building.busyUntil).getTime() > Date.now()) {
      throw new ValidationError('Building is busy with an active sales order');
    }

    const quality = Math.max(0, Math.min(12, Math.floor(Number(input.forceQuality ?? 0)) || 0));
    const allowedProducts = RETAIL_PRODUCTS[building.kind] || [];
    if (!allowedProducts.includes(input.kind)) {
      throw new ValidationError(
        `Resource #${input.kind} cannot be sold in retail building of type '${building.kind}'`
      );
    }
    if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
      throw new ValidationError(`Retail amount must be a positive integer: ${input.amount}`);
    }

    // Stock check inside the transaction: failure aborts everything (no
    // partial sale, no cash movement).
    const item = getWarehouseItemExact(ctx.companyId, input.kind, quality);
    if (!item || Number(item.amount) < input.amount) {
      throw new ValidationError('Insufficient stock in warehouse to retail');
    }

    // Price is clamped to the authoritative maximum; the widget always sends
    // its modeled price, the server remains the pricing authority.
    const { maxPrice } = getAuthoritativeRetailPrice(input.kind, quality);
    const unitPrice = Math.min(Math.max(input.price, 0), maxPrice);

    // 1. Consume warehouse stock atomically
    const resourceTransactions = consumeResourceExactWithTransactions(
      ctx.companyId,
      input.kind,
      quality,
      input.amount
    );
    if (!resourceTransactions) {
      throw new ValidationError('Insufficient stock in warehouse to retail');
    }

    // 2. Credit the revenue and write the cash_ledger row in the same transaction (skip generic fallback)
    const revenue = Math.round(input.amount * unitPrice * 100) / 100;
    const newMoney = updateCompanyMoney(ctx.companyId, revenue, true);
    const resDef = getResourceDef(input.kind);
    const resName = resDef?.name || `Resource #${input.kind}`;
    recordCashLedger({
      companyId: ctx.companyId,
      amount: revenue,
      category: 's',
      description: `Sales of ${resName}`,
      descriptionKey: `retail-${input.kind}`,
      details: {
        version: 1,
        building: building.kind,
        quality,
        price: unitPrice,
        unit_cogs: unitPrice,
        remaining: 0,
        building_name: building.name
      }
    });
    refreshDailyFinanceSnapshot(ctx.companyId);

    // 3. Occupy the building's busy window for the sale duration and persist queue
    const durationSeconds = calculateRetailDuration(input.kind, input.amount, building.size || 1);
    const now = new Date().toISOString();
    const finishesAt = new Date(Date.now() + durationSeconds * 1000).toISOString();
    const updatedBuilding = buildingRepository.updateBusyUntil(building.id, ctx.companyId, finishesAt);

    db.prepare(`
      INSERT INTO production_queues (building_id, company_id, kind, quality, cost, amount, started_at, finishes_at, resolved)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).run(building.id, ctx.companyId, input.kind, quality, unitPrice, input.amount, now, finishesAt);

    // 4. Award leveling XP (1s retail = 1 XP per building size unit)
    const xpEarned = Math.max(1, Math.round(durationSeconds * (building.size || 1)));
    addCompanyExperience(ctx.companyId, xpEarned);

    return {
      building: updatedBuilding,
      revenue,
      newMoney,
      resourceTransactions
    };
  }, { immediate: true });
}
