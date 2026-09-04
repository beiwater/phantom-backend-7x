/**
 * Retail use cases (Issue #105 Phase 4 / Issue #104 Stage 3).
 * Single authoritative implementations of the retail order lifecycle:
 * start-retail (queue a sales order), collect-retail (fulfil: consume stock
 * + credit money atomically), cancel-retail (delete a resting order).
 * Pure pricing/duration rules live in game-data/retail.ts (zero IO).
 */
import type { GameContext } from '../../context/game-context.ts';
import { virtualClock } from '../../core/virtual-clock.ts';
import { runInTransaction, type TransactionContext } from '../../db/transaction.ts';
import { recordCashLedger } from '../../game/cash-ledger.ts';
import { eventBus } from '../../events/event-bus.ts';
import { ValidationError, NotFoundError, ConflictError } from '../../errors/domain-error.ts';
import {
  RETAIL_PRODUCTS,
  getAuthoritativeRetailPrice,
  calculateRetailDuration
} from '../../game-data/retail.ts';
import { getResourceDef } from '../../game-data/resources.ts';
import { retailRepository, type RetailOrderEntity } from '../../repositories/retail-repository.ts';
import { buildingRepository } from '../../repositories/building-repository.ts';
import { warehouseRepository } from '../../repositories/warehouse-repository.ts';
import { companyRepository } from '../../repositories/company-repository.ts';
import { getEconomyPhase } from '../scheduler/daily-jobs.ts';
import { CONFIG } from '../../config.ts';

// --- Compatibility DTO (original frontend shape) ----------------------------

export interface RetailOrderDTO {
  id: number;
  building: number;
  resource: { kind: number; quality: number };
  units: number;
  sellingPrice: number;
  costTotal: number;
  finishedAt: string;
  createdAt: string;
}

export function formatRetailOrder(order: RetailOrderEntity): RetailOrderDTO {
  return {
    id: order.id,
    building: order.buildingId,
    resource: { kind: order.resourceKind, quality: order.quality },
    units: order.units,
    sellingPrice: order.unitPrice,
    costTotal: order.cost,
    finishedAt: order.finishedAt || order.createdAt,
    createdAt: order.createdAt
  };
}

interface SalesOfficeResourceRequirement {
  kind: number;
  amount: number;
  price: number;
}

export interface SalesOfficeOrderDTO extends RetailOrderDTO {
  datetime: string;
  resources: SalesOfficeResourceRequirement[];
  qualityBonus: number;
  searchCost: number;
}

export function formatSalesOfficeOrder(order: RetailOrderEntity, searchCost: number): SalesOfficeOrderDTO {
  const resDef = typeof getResourceDef === 'function' ? getResourceDef(order.resourceKind) : null;
  // The original client calculates:
  //   l = Date.parse(order.datetime)
  //   endTime = new Date(l + 47 * 3600 * 1000)
  //   if (l > now - 47h) => still searching (shows countdown to endTime)
  //   else => search completed, contract ready to fulfill!
  // Under speed multiplier, finishedAt is scaled down. To make the client's
  // unscaled (l + 47h) arithmetic land exactly on finishedAt (or immediately complete
  // when finishedAt <= now), we project datetime = finishedAt - 47h:
  const finishedAtMs = order.finishedAt ? new Date(order.finishedAt).getTime() : new Date(order.createdAt).getTime();
  const effectiveDatetime = new Date(finishedAtMs - 47 * 3600 * 1000).toISOString();
  return {
    ...formatRetailOrder(order),
    datetime: effectiveDatetime,
    resources: [{
      kind: order.resourceKind,
      amount: order.units,
      price: order.unitPrice
    }],
    resourceId: order.resourceKind,
    resourceName: resDef?.name || `Resource #${order.resourceKind}`,
    amount: order.units,
    price: order.unitPrice,
    quality: order.quality,
    qualityBonus: order.qualityBonus || 0,
    searchCost
  } as SalesOfficeOrderDTO;
}

// --- StartRetail ------------------------------------------------------------

export interface StartRetailInput {
  buildingId?: number;
  resource?: number;
  quality?: number;
  units?: number;
  sellingPrice?: number;
}

export interface StartRetailResult {
  salesOrder: RetailOrderDTO;
  money: number;
}

export async function startRetailOrderUseCase(ctx: GameContext, input: StartRetailInput): Promise<StartRetailResult> {
  const targetBuilding = input.buildingId !== undefined
    ? buildingRepository.findById(input.buildingId)
    : null;
  const resolvedBuilding = targetBuilding && targetBuilding.companyId === ctx.companyId
    ? targetBuilding
    : (input.buildingId !== undefined ? null : retailRepository.findFirstSalesBuilding(ctx.companyId));

  if (!resolvedBuilding) {
    throw new ValidationError('Owned retail building is required');
  }

  // Default product: first retail product the company actually has in stock.
  let resourceKind = input.resource !== undefined ? Number(input.resource) : undefined;
  let requestedQuality = input.quality === undefined ? undefined : Number(input.quality);
  if (resourceKind === undefined || requestedQuality === undefined) {
    const productKinds = RETAIL_PRODUCTS[resolvedBuilding.kind] || [];
    for (const kind of productKinds) {
      const item = warehouseRepository.findByCompanyAndResource(ctx.companyId, kind, 0);
      if (item && item.amount > 0) {
        if (resourceKind === undefined) resourceKind = kind;
        if (requestedQuality === undefined && resourceKind === kind) requestedQuality = item.quality;
        break;
      }
    }
  }
  if (requestedQuality === undefined) requestedQuality = 0;
  if (resourceKind === undefined) {
    throw new ValidationError('Resource is required');
  }

  if (!Number.isInteger(requestedQuality) || requestedQuality < 0 || requestedQuality > 12) {
    throw new ValidationError('Invalid resource quality');
  }

  const economy = getEconomyPhase(ctx.realmId);
  const economyState = economy.state;
  const pricing = getAuthoritativeRetailPrice(resourceKind, requestedQuality, input.sellingPrice, 0.5, economyState);
  const sellingPrice = pricing.unitPrice;

  const units = input.units === undefined ? 1 : Number(input.units);
  if (!Number.isSafeInteger(resourceKind) || resourceKind <= 0 ||
      !Number.isFinite(units) || units <= 0) {
    throw new ValidationError('Invalid resource or units');
  }

  const allowedProducts = RETAIL_PRODUCTS[resolvedBuilding.kind] || [];
  if (!allowedProducts.includes(resourceKind)) {
    throw new ValidationError(`Resource #${resourceKind} cannot be sold in retail building of type '${resolvedBuilding.kind}'`);
  }

  const item = warehouseRepository.findByCompanyAndResource(ctx.companyId, resourceKind, requestedQuality);
  if (!item || item.amount < units) {
    throw new ValidationError('Insufficient stock in warehouse to retail');
  }

  const costTotal = Math.round(units * 1.5 * 100) / 100;
  const createdAt = virtualClock.nowIso();
  const durationSeconds = calculateRetailDuration(resourceKind, units, resolvedBuilding.size || 1, { economyState });
  const finishedAt = new Date(virtualClock.nowMs() + durationSeconds * 1000).toISOString();

  const order = retailRepository.insert({
    buildingId: resolvedBuilding.id,
    companyId: ctx.companyId,
    resourceKind,
    quality: requestedQuality,
    units,
    unitPrice: sellingPrice,
    cost: costTotal,
    economyPhase: economy.state,
    economyPhaseStartedAt: economy.startAt,
    economySource: economy.source,
    finishedAt,
    createdAt
  });

  return {
    salesOrder: formatRetailOrder(order),
    money: 0 // creating a retail order does not change the cash balance
  };
}

// --- CollectRetail (fulfil) --------------------------------------------------

export interface CollectRetailResult {
  success: true;
  revenue: number;
  money: number;
  moneyBalance: number;
  resource: { kind: number; quality: number; units: number };
  resourceTransactions: Array<{
    id: number;
    kind: number;
    db_letter: number;
    dbLetter: number;
    quality: number;
    amount: number;
    delta: number;
    cost: number;
    datetime: string;
    category: string;
  }>;
}
export interface CollectRetailOrderOptions {
  lowestQualityFirst?: boolean;
  highestQualityFirst?: boolean;
}

export async function collectRetailOrderUseCase(
  ctx: GameContext,
  orderId: number,
  options: CollectRetailOrderOptions = {}
): Promise<CollectRetailResult> {
  const order = retailRepository.findById(orderId);
  if (!order) {
    throw new NotFoundError('Order not found');
  }
  if (order.companyId !== ctx.companyId) {
    throw new NotFoundError('Order not found');
  }

  if (order.finishedAt && new Date(order.finishedAt).getTime() > virtualClock.nowMs()) {
    throw new ValidationError('Retail order is still in progress and cannot be fulfilled prematurely');
  }

  const building = buildingRepository.findById(order.buildingId);
  const isSalesOffice = building?.kind === SALES_OFFICE_KIND;
  const preferHighestQuality = options.highestQualityFirst ?? (options.lowestQualityFirst === false);

  return runInTransaction(async (tx: TransactionContext): Promise<CollectRetailResult> => {
    // If sales office, consume from warehouse with flexible quality (>= order.quality)
    // matching player's lowestQualityFirst / highestQualityFirst preference.
    let consumed: Array<{ kind: number; quality: number; amount: number; cost: number }>;
    if (isSalesOffice) {
      consumed = warehouseRepository.consumeWithTransactions(
        ctx.companyId,
        order.resourceKind,
        order.quality,
        order.units,
        preferHighestQuality
      );
    } else {
      consumed = warehouseRepository.consumeExact(
        ctx.companyId,
        order.resourceKind,
        order.quality,
        order.units
      );
    }

    const deliveredQuality = consumed.length > 0
      ? consumed.reduce((min, c) => Math.min(min, c.quality), consumed[0].quality)
      : order.quality;

    // Calculate revenue including qualityBonus:
    // revenue = baseRevenue + baseRevenue * quality * qualityBonus / 100
    const { maxPrice } = getAuthoritativeRetailPrice(order.resourceKind, deliveredQuality, undefined, 0.5, getEconomyPhase(ctx.realmId).state);
    const effectivePrice = Math.min(order.unitPrice, maxPrice);
    const baseRevenue = Math.round(order.units * effectivePrice * 100) / 100;
    const qualityMultiplierBonus = (deliveredQuality * (order.qualityBonus || 0)) / 100;
    const bonusRevenue = Math.round(baseRevenue * qualityMultiplierBonus * 100) / 100;
    const revenue = Math.round((baseRevenue + bonusRevenue) * 100) / 100;

    const consumedCost = consumed.reduce((total, transaction) => total + transaction.cost * transaction.amount, 0);
    const transactionAmount = -order.units;
    const transactionCost = consumedCost || order.cost;

    const moneyBalance = companyRepository.creditMoney(ctx.companyId, revenue);
    const resDef = typeof getResourceDef === 'function' ? getResourceDef(order.resourceKind) : null;
    const resName = resDef?.name || `Resource #${order.resourceKind}`;
    recordCashLedger({
      companyId: ctx.companyId,
      amount: revenue,
      category: isSalesOffice ? 't' : 's',
      description: isSalesOffice ? `Sales order fulfilled: ${order.units}x ${resName}` : `Retail sales: ${resName}`,
      descriptionKey: isSalesOffice ? '1-sofull' : `retail-${order.resourceKind}`,
      details: {
        buildingId: order.buildingId,
        orderId: order.id,
        resourceKind: order.resourceKind,
        resourceName: resName,
        quality: deliveredQuality,
        qualityBonus: order.qualityBonus || 0,
        bonusRevenue,
        baseRevenue,
        units: order.units,
        unitPrice: effectivePrice
      }
    });
    retailRepository.recordSale({
      realmId: ctx.realmId ?? 0,
      companyId: ctx.companyId,
      resourceKind: order.resourceKind,
      quality: order.quality,
      units: order.units,
      unitPrice: effectivePrice,
      revenue,
      soldAt: order.finishedAt || virtualClock.nowIso()
    });


    if (!retailRepository.deleteOwned(order.id, ctx.companyId)) {
      throw new ConflictError('Retail order is no longer available');
    }

    tx.addAfterCommitHook(() => {
      eventBus.emit('RetailSaleCompleted', {
        companyId: ctx.companyId,
        buildingId: order.buildingId,
        resourceKind: order.resourceKind,
        quality: order.quality,
        units: order.units,
        revenue
      });
    });

    return {
      success: true,
      revenue,
      money: revenue,
      moneyBalance,
      resource: {
        kind: order.resourceKind,
        quality: order.quality,
        units: transactionAmount
      },
      resourceTransactions: [{
        id: order.id,
        kind: order.resourceKind,
        db_letter: order.resourceKind,
        dbLetter: order.resourceKind,
        quality: order.quality,
        amount: transactionAmount,
        delta: transactionAmount,
        cost: transactionCost,
        datetime: virtualClock.nowIso(),
        category: 's'
      }]
    };
  }, { immediate: true });
}

// --- CancelRetail ------------------------------------------------------------

export interface CancelRetailResult {
  success: true;
}

export async function cancelRetailOrderUseCase(ctx: GameContext, orderId: number): Promise<CancelRetailResult> {
  const order = retailRepository.findById(orderId);
  if (!order) {
    throw new NotFoundError('Order not found');
  }
  if (order.companyId !== ctx.companyId) {
    throw new NotFoundError('Order not found');
  }
  if (!retailRepository.deleteOwned(orderId, ctx.companyId)) {
    throw new NotFoundError('Order is no longer available');
  }
  return { success: true };
}

// --- FindSalesOfficeCustomer (#153) ------------------------------------------

/** Aerospace end products (BFR 94, Sub-orbital rocket 91, Jumbo jet 95, Luxury jet 96, Single engine 97, Quadcopter 98, Satellite 99). */
const AEROSPACE_PRODUCTS = [91, 94, 95, 96, 97, 98, 99];
const SALES_OFFICE_KIND = 'B';
/**
 * Original panel fee shape: AVERAGE_SALARY(345) × salesOffice.salaryModifier
 * (1.7, decompile buildings.json) × 47h, per building level. Executive
 * discounts are 0 without the matching skills.
 */
const CUSTOMER_SEARCH_FEE_PER_LEVEL = Math.floor(345 * 1.7 * 47);
export const BASE_CUSTOMER_SEARCH_DURATION_SECONDS = 47 * 3600;
export function getCustomerSearchDurationSeconds(): number {
  const multiplier = Number(CONFIG.PRODUCTION_SPEED_MULTIPLIER) || 1;
  return Math.max(3, Math.round(BASE_CUSTOMER_SEARCH_DURATION_SECONDS / multiplier));
}
export const CUSTOMER_SEARCH_DURATION_SECONDS = getCustomerSearchDurationSeconds();

export function getSalesOfficeSearchFee(buildingSize: number): number {
  return CUSTOMER_SEARCH_FEE_PER_LEVEL * Math.max(1, Math.floor(buildingSize || 1));
}

export interface FindSalesOfficeCustomerResult {
  salesOrder: SalesOfficeOrderDTO;
  /** Negative delta — the original client feeds it straight to addMoney(). */
  money: number;
}

export async function findSalesOfficeCustomerUseCase(
  ctx: GameContext,
  buildingId: number
): Promise<FindSalesOfficeCustomerResult> {
  const building = buildingRepository.findById(buildingId);
  if (!building || building.companyId !== ctx.companyId) {
    throw new NotFoundError('Building not found');
  }
  if (building.kind !== SALES_OFFICE_KIND) {
    throw new ValidationError('Building is not a Sales Office');
  }
  if (building.busyUntil && new Date(building.busyUntil).getTime() > virtualClock.nowMs()) {
    throw new ValidationError('Building is currently busy');
  }
  // Prefer an aerospace product the company stocks so the contract is
  // immediately deliverable; otherwise pick one of the canonical aerospace end products.
  let resourceKind: number | undefined;
  for (const kind of AEROSPACE_PRODUCTS) {
    const item = warehouseRepository.findByCompanyAndResource(ctx.companyId, kind, 0);
    if (item && item.amount > 0) {
      resourceKind = kind;
      break;
    }
  }
  if (!resourceKind) {
    const idx = Math.floor(Math.random() * AEROSPACE_PRODUCTS.length);
    resourceKind = AEROSPACE_PRODUCTS[idx];
  }

  const { unitPrice } = getAuthoritativeRetailPrice(resourceKind, 0, undefined, 0.5, getEconomyPhase(ctx.realmId).state);
  const fee = getSalesOfficeSearchFee(building.size || 1);
  const finishedAt = new Date(virtualClock.nowMs() + getCustomerSearchDurationSeconds() * 1000).toISOString();
  const createdAt = virtualClock.nowIso();

  return runInTransaction(async (): Promise<FindSalesOfficeCustomerResult> => {
    // debitMoney fails the whole search when the balance cannot cover the fee.
    companyRepository.debitMoney(ctx.companyId, fee);
    recordCashLedger({
      companyId: ctx.companyId,
      amount: -fee,
      category: 't', // CONTRACT
      description: 'Customer search',
      descriptionKey: '1-sosearch'
    });
    // Generate qualityBonus between 0.8% and 2.0% (rounded to 2 decimal places, e.g. 1.25)
    const qualityBonus = Math.round((0.8 + Math.random() * (2.0 - 0.8)) * 100) / 100;

    const order = retailRepository.insert({
      buildingId: building.id,
      companyId: ctx.companyId,
      resourceKind,
      quality: 0,
      qualityBonus,
      units: 1,
      unitPrice,
      cost: 0,
      finishedAt,
      createdAt
    });
    return { salesOrder: formatSalesOfficeOrder(order, fee), money: -fee };
  }, { immediate: true });
}
