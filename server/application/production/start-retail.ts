import type { GameContext } from '../../context/game-context.ts';
import { virtualClock } from '../../core/virtual-clock.ts';
import { runInTransaction } from '../../db/transaction.ts';
import { buildingRepository, type BuildingEntity } from '../../repositories/building-repository.ts';
import { companyRepository } from '../../repositories/company-repository.ts';
import { NotFoundError, ForbiddenError, ValidationError } from '../../errors/domain-error.ts';
import { recordCashLedger, refreshDailyFinanceSnapshot } from '../../game/cash-ledger.ts';
import { getResourceDef } from '../../game-data/resources.ts';
import { assertQueueDuration } from '../../domain/leveling/level-rules.ts';
import { getWarehouseItemExact, consumeResourceExactWithTransactions } from '../../game/warehouse.ts';
import { retailRepository } from '../../repositories/retail-repository.ts';
import {
  RETAIL_PRODUCTS,
  getAuthoritativeRetailPrice,
  calculateRetailDuration
} from '../../game-data/retail.ts';
import { getEconomyPhase } from '../scheduler/daily-jobs.ts';

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
  const economy = getEconomyPhase(ctx.realmId);
  const economyState = economy.state;
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
    if (building.busyUntil && new Date(building.busyUntil).getTime() > virtualClock.nowMs()) {
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
    const { maxPrice } = getAuthoritativeRetailPrice(input.kind, quality, undefined, 0.5, economy.state);
    const unitPrice = Math.min(Math.max(input.price, 0), maxPrice);

    // Issue #99: the sale's busy-window duration must fit the company tier
    // limit (2h below L5, 24h below L15, 48h at L15+). Enforced BEFORE stock
    // is consumed or revenue credited so the 400 QUEUE_DURATION_LIMIT
    // rejection is side-effect free.
    const durationSeconds = calculateRetailDuration(input.kind, input.amount, building.size || 1, {
      quality,
      price: unitPrice,
      buildingKind: building.kind,
      economyState
    });
    assertQueueDuration(
      companyRepository.findById(ctx.companyId)?.level ?? 0,
      durationSeconds,
      'Retail'
    );

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
    const newMoney = companyRepository.creditMoney(ctx.companyId, revenue);
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

    // 3. Occupy the building's busy window for the sale duration and persist in retail_orders
    // (durationSeconds was computed and validated against the tier limit
    // before stock was consumed)
    const now = virtualClock.nowIso();
    const finishesAt = new Date(virtualClock.nowMs() + durationSeconds * 1000).toISOString();
    const updatedBuilding = buildingRepository.updateBusyUntil(building.id, ctx.companyId, finishesAt);

    // Track in retail_orders table (NOT active production_queues to prevent
    // collect-production duplication exploit) — via the retail repository.
    retailRepository.insert({
      buildingId: building.id,
      companyId: ctx.companyId,
      resourceKind: input.kind,
      quality,
      units: input.amount,
      unitPrice,
      cost: revenue,
      finishedAt: finishesAt,
      createdAt: now,
      economyPhase: economy.state,
      economyPhaseStartedAt: economy.startAt,
      economySource: economy.source
    });
    // 4. Award leveling XP (1s retail = 1 XP per building size unit)
    const xpEarned = Math.max(1, Math.round(durationSeconds * (building.size || 1)));
    companyRepository.addExperience(ctx.companyId, xpEarned);

    return {
      building: updatedBuilding,
      revenue,
      newMoney,
      resourceTransactions
    };
  }, { immediate: true });
}
