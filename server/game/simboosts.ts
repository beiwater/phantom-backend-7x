 import { db } from '../db/database.ts';
 import { runInTransaction } from '../db/transaction.ts';
 import { getCompanyById, updateCompanyMoney, updateCompanySimBoosts } from './company.ts';
 import { getBuildingById, formatBuilding } from './buildings.ts';
 import { getBuildingQueue } from './production.ts';
 import { addResource } from './warehouse.ts';
 import {
   ensureBoostSettingsTable,
   getCompanyBoostSettings,
   getExchangedToday,
   realignCompanyBonus,
  recordExchange,
  exchangeMoneyForSimboosts,
  getPurchasesToday,
  recordPurchase,
  DAILY_PURCHASE_LIMIT,
  EXCHANGE_CASH_PER_SIMBOOST,
  EXCHANGE_DAILY_LIMIT
 } from './simboost-settings.ts';

// Create the persisted settings table on module load (idempotent DDL).
ensureBoostSettingsTable(db);

export interface PaymentPackage {
  sku: string;
  simBoosts: number;
  price: string;
  currency: string;
  starting: boolean;
  isSupporter: boolean;
  supporterOnly: boolean;
  image: string;
  wideFrame: boolean;
  googleSku?: string;
  appleSku?: string;
  steamSku?: string;
  hq?: number;
  limit?: number;
  certificate?: number;
  approximateCurrency?: {
    code: string;
    value: string;
  };
}

/**
 * Real package catalog captured from the official server's
 * GET /api/v4/payment-packages/unknown/ response (see local://har-schemas.md).
 * Prices are USD; approximateCurrency kept in the official AUD estimate shape.
 */
export const PAYMENT_PACKAGES: PaymentPackage[] = [
  { sku: "sb-sb150", simBoosts: 150, price: "5.89", currency: "USD", starting: false, isSupporter: false, supporterOnly: false, image: "images/sb-stacks/small-stack-dark.png", wideFrame: false, googleSku: "simcompanies.simboosts.low.1", appleSku: "simcompanies.simboosts.low.1", steamSku: "101500", approximateCurrency: { code: "AUD", value: "8.22" } },
  { sku: "sb-sb330", simBoosts: 330, price: "10.45", currency: "USD", starting: false, isSupporter: false, supporterOnly: false, image: "images/sb-stacks/medium-stack-dark.png", wideFrame: false, googleSku: "simcompanies.simboosts.smallmedium.1", appleSku: "simcompanies.simboosts.smallmedium.1", steamSku: "103300", approximateCurrency: { code: "AUD", value: "14.58" } },
  { sku: "sp2", simBoosts: 250, price: "3.25", currency: "USD", starting: true, isSupporter: false, supporterOnly: false, image: "images/sb-stacks/starter-pack.png", wideFrame: true, googleSku: "simcompanies.simboosts.starting.2", appleSku: "simcompanies.simboosts.starting.2", steamSku: "102502", approximateCurrency: { code: "AUD", value: "4.54" } },
  { sku: "sb-sb850", simBoosts: 850, price: "23.45", currency: "USD", starting: false, isSupporter: false, supporterOnly: false, image: "images/sb-stacks/medium2-stack-dark.png", wideFrame: false, googleSku: "simcompanies.simboosts.medium.1", appleSku: "simcompanies.simboosts.medium.1", steamSku: "108500", approximateCurrency: { code: "AUD", value: "32.72" } },
  { sku: "sb-sb1900", simBoosts: 1900, price: "46.95", currency: "USD", starting: false, isSupporter: false, supporterOnly: false, image: "images/sb-stacks/large-stack-dark.png", wideFrame: false, googleSku: "simcompanies.simboosts.large.1", appleSku: "simcompanies.simboosts.large.1", steamSku: "119000", approximateCurrency: { code: "AUD", value: "65.52" } },
  { sku: "supporter", simBoosts: 0, price: "59.45", currency: "USD", starting: false, isSupporter: true, supporterOnly: false, image: "images/sb-stacks/executive-stack-dark.png", wideFrame: true, googleSku: "simcompanies.simboosts.supporter.1", appleSku: "simcompanies.simboosts.supporter.2", steamSku: "100000", approximateCurrency: { code: "AUD", value: "82.96" } },
  { sku: "sb-s-sp2", simBoosts: 250, price: "2.89", currency: "USD", starting: true, isSupporter: false, supporterOnly: true, image: "images/sb-stacks/starter-pack.png", wideFrame: true, googleSku: "simcompanies.simboosts.starting.discounted.2", appleSku: "simcompanies.simboosts.starting.discounted.2", steamSku: "102503", approximateCurrency: { code: "AUD", value: "4.03" } },
  { sku: "sb-s-sb150", simBoosts: 150, price: "5.25", currency: "USD", starting: false, isSupporter: false, supporterOnly: true, image: "images/sb-stacks/small-stack-dark.png", wideFrame: false, googleSku: "simcompanies.simboosts.low.discounted.1", appleSku: "simcompanies.simboosts.low.discounted.1", steamSku: "101501", approximateCurrency: { code: "AUD", value: "7.33" } },
  { sku: "sb-s-sb330", simBoosts: 330, price: "9.39", currency: "USD", starting: false, isSupporter: false, supporterOnly: true, image: "images/sb-stacks/medium-stack-dark.png", wideFrame: false, googleSku: "simcompanies.simboosts.smallmedium.discounted.1", appleSku: "simcompanies.simboosts.smallmedium.discounted.1", steamSku: "103301", approximateCurrency: { code: "AUD", value: "13.10" } },
  { sku: "sb-s-sb850", simBoosts: 850, price: "21.09", currency: "USD", starting: false, isSupporter: false, supporterOnly: true, image: "images/sb-stacks/medium2-stack-dark.png", wideFrame: false, googleSku: "simcompanies.simboosts.medium.discounted.1", appleSku: "simcompanies.simboosts.medium.discounted.1", steamSku: "108501", approximateCurrency: { code: "AUD", value: "29.43" } },
  { sku: "sb-s-sb1900", simBoosts: 1900, price: "41.95", currency: "USD", starting: false, isSupporter: false, supporterOnly: true, image: "images/sb-stacks/large-stack-dark.png", wideFrame: false, googleSku: "simcompanies.simboosts.large.discounted.1", appleSku: "simcompanies.simboosts.large.discounted.1", steamSku: "119001", approximateCurrency: { code: "AUD", value: "58.54" } },
  { sku: "sb-sb3800", simBoosts: 3800, price: "89.95", currency: "USD", starting: false, isSupporter: false, supporterOnly: false, image: "images/sb-stacks/professional-stack-dark.png", wideFrame: false, googleSku: "simcompanies.simboosts.professional.1", appleSku: "simcompanies.simboosts.professional.1", steamSku: "130000", approximateCurrency: { code: "AUD", value: "125.52" } },
  { sku: "sb-s-sb3800", simBoosts: 3800, price: "79.95", currency: "USD", starting: false, isSupporter: false, supporterOnly: true, image: "images/sb-stacks/professional-stack-dark.png", wideFrame: false, googleSku: "simcompanies.simboosts.professional.discounted.1", appleSku: "simcompanies.simboosts.professional.discounted.1", steamSku: "130001", approximateCurrency: { code: "AUD", value: "111.57" } },
  { sku: "sb-sb6300", simBoosts: 6300, price: "139.95", currency: "USD", starting: false, isSupporter: false, supporterOnly: false, image: "images/sb-stacks/executive-stack-dark.png", wideFrame: false, googleSku: "simcompanies.simboosts.executive.1", appleSku: "simcompanies.simboosts.executive.3", steamSku: "150000", approximateCurrency: { code: "AUD", value: "195.29" } },
  { sku: "sb-s-sb6300", simBoosts: 6300, price: "125.95", currency: "USD", starting: false, isSupporter: false, supporterOnly: true, image: "images/sb-stacks/executive-stack-dark.png", wideFrame: false, googleSku: "simcompanies.simboosts.executive.discounted.1", appleSku: "simcompanies.simboosts.executive.discounted.1", steamSku: "150001", approximateCurrency: { code: "AUD", value: "175.76" } }
];

export const PAYMENT_PACKAGES_PREFERRED_CURRENCY = 'USD';

/**
 * GET /api/v4/payment-packages/:type/ — top-level shape captured from the
 * official server HAR: { packages, preferredCurrency, filter }.
 */
export function getPaymentPackagesList(platformType: string = 'web') {
  void platformType;
  return {
    packages: PAYMENT_PACKAGES,
    preferredCurrency: PAYMENT_PACKAGES_PREFERRED_CURRENCY,
    filter: false
  };
}
export function canPurchasePaymentPackage(sku: string) {
  const pkg = PAYMENT_PACKAGES.find(p => p.sku === sku);
  return {
    canBuy: Boolean(pkg),
    canPurchase: Boolean(pkg),
    available: Boolean(pkg),
    limit: null,
    message: pkg ? null : 'Package not found',
    package: pkg || null
  };
}

export interface CompletedPurchase {
  payment: {
    sku: string;
    simBoosts: number;
    price: string;
    currency: string;
  };
  simBoosts: number;
  companySimboosts: number;
  supporter: boolean;
  starting: boolean;
  message?: string;
  /** C-5: purchases made today after this grant, plus the active daily cap. */
  purchasesToday?: number;
  dailyPurchaseLimit?: number;
}

const PURCHASE_IDEMPOTENCY_WINDOW_MS = 5000;

/**
 * In-memory purchase ledger for double-click idempotency (P0-03 acceptance:
 * "重复点击不会重复发放"). Keyed by companyId + sku; a repeat within the
 * window returns the original grant instead of minting SimBoosts again.
 * Single-process private server, so process memory is the correct scope.
 */
const recentPurchases = new Map<string, { at: number; result: CompletedPurchase }>();


export async function purchasePaymentPackage(companyId: number, sku: string, now: number = Date.now()) {
  const pkg = PAYMENT_PACKAGES.find(p => p.sku === sku);
  if (!pkg) {
    throw new Error('Package not found');
  }

  const ledgerKey = `${companyId}:${pkg.sku}`;
  const recent = recentPurchases.get(ledgerKey);
  if (recent && now - recent.at < PURCHASE_IDEMPOTENCY_WINDOW_MS) {
    return recent.result;
  }

  // C-5: the private server grants boosts without a real payment gateway, so
  // cap purchases per company per UTC day to close the unlimited money faucet
  // (paired with the C-9 exchange cap on the cash->boosts direction). The cap
  // check + grant + counter bump commit as one transaction; a rejected
  // request mutates nothing.
  const result = await runInTransaction(async () => {
    const purchasesToday = getPurchasesToday(companyId, new Date(now));
    if (purchasesToday >= DAILY_PURCHASE_LIMIT) {
      throw new Error(`Daily purchase limit of ${DAILY_PURCHASE_LIMIT} packages reached`);
    }
    const newSimBoosts = updateCompanySimBoosts(companyId, pkg.simBoosts);
    recordPurchase(companyId, new Date(now));
    return {
      payment: {
        sku: pkg.sku,
        simBoosts: pkg.simBoosts,
        price: pkg.price,
        currency: pkg.currency
      },
      simBoosts: pkg.simBoosts,
      companySimboosts: newSimBoosts,
      supporter: pkg.isSupporter,
      starting: pkg.starting,
      purchasesToday: purchasesToday + 1,
      dailyPurchaseLimit: DAILY_PURCHASE_LIMIT
    } satisfies CompletedPurchase & { purchasesToday: number; dailyPurchaseLimit: number };
  }, { immediate: true });

  recentPurchases.set(ledgerKey, { at: now, result });
  return result;
}

/** Test seam: clear the purchase idempotency ledger. */
export function resetPurchaseLedger(): void {
  recentPurchases.clear();
}


export function getPaymentPricingInfo(countryCode: string = 'AU') {
  return {
    countryCodeIso: countryCode,
    bonus: 0
  };
}

export function getPlayerBonusesList(playerId: number) {
  return [];
}


export async function exchangeSimBoosts(companyId: number, amount: number) {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error('Exchange amount must be a positive integer');
  }

  return runInTransaction(async () => {
    const comp = getCompanyById(companyId);
    if (!comp || comp.simboosts < amount) {
      throw new Error('Insufficient SimBoosts');
    }

    // C-9: boosts->cash exchanges share the same per-UTC-day bucket as the
    // official "fair" money->boosts exchange (simboostsExchangeLimit,
    // phase-based, capped at 10000 cash/day) so neither direction of the
    // exchange can mint cash past the daily cap.
    const cashAmount = amount * 100;
    const alreadyExchanged = getExchangedToday(companyId);
    if (alreadyExchanged + cashAmount > EXCHANGE_DAILY_LIMIT) {
      throw new Error('You cannot exchange that many simboosts today');
    }

    updateCompanySimBoosts(companyId, -amount);
    const newMoney = updateCompanyMoney(companyId, cashAmount);
    const exchangedToday = recordExchange(companyId, cashAmount);

    const updatedComp = getCompanyById(companyId);
    return {
      success: true,
      simBoosts: updatedComp?.simboosts ?? 0,
      money: newMoney,
      moneyAdded: cashAmount,
      simBoostsDeducted: amount,
      exchangedToday,
      message: `Exchanged ${amount} SimBoosts for $${cashAmount.toLocaleString()}`
    };
  }, { immediate: true });
}

/**
 * P0-04: POST /api/v2/pa-action/fair/:n/ — exchange company cash for
 * SimBoosts at the official 250:1 rate with the official daily cap.
 * Returns the exact official response shape {"done": true}.
 */
export async function exchangeCashForSimboosts(companyId: number, cash: number) {
  return exchangeMoneyForSimboosts({
    companyId,
    cash,
    getCompanyMoney: id => {
      const comp = getCompanyById(id);
      return comp ? { money: Number(comp.money), simboosts: Number(comp.simboosts) } : null;
    },
    debitMoney: (id, amount) => updateCompanyMoney(id, -amount),
    creditSimBoosts: (id, simBoosts) => updateCompanySimBoosts(id, simBoosts)
  });
}

/** Current exchanged-today counter as surfaced in authCompany (persisted, resets each UTC day). */
export function getCompanyExchangedToday(companyId: number): number {
  return getExchangedToday(companyId);
}

/**
 * P1-02: realign the production/sales bonus from the Headquarters > SimBoosts
 * screen. Debits SimBoosts and persists both modifiers atomically so a refresh
 * reads back the saved values instead of the defaults.
 */
export async function realignProductionSalesBonus(companyId: number, move: number) {
  return realignCompanyBonus(companyId, move, (id, cost) => updateCompanySimBoosts(id, -cost));
}

/** Persisted modifier pair for GET endpoints (read-only, no side effects). */
export function getCompanyBonusModifiers(companyId: number) {
  const settings = getCompanyBoostSettings(companyId);
  return {
    productionModifier: settings.productionModifier,
    salesModifier: settings.salesModifier
  };
}

export async function unlockBuildingSlot(companyId: number) {
  const costs = [50, 100, 500, 500];
  return runInTransaction(async () => {
    const comp = getCompanyById(companyId);
    if (!comp) throw new Error('Company not found');

    const row = db.prepare('SELECT extra_building_slots FROM companies WHERE company_id = ?')
      .get(companyId) as { extra_building_slots?: number } | undefined;
    const currentSlots = Math.max(0, Math.floor(Number(row?.extra_building_slots) || 0));
    if (currentSlots >= costs.length) {
      throw new Error('Maximum building slots reached');
    }
    const cost = costs[currentSlots];
    if (comp.simboosts < cost) {
      throw new Error(`Need at least ${cost} SimBoosts to unlock an additional building slot`);
    }

    updateCompanySimBoosts(companyId, -cost);
    const newSlots = currentSlots + 1;
    const updated = db.prepare(`
      UPDATE companies SET extra_building_slots = ?
      WHERE company_id = ?
    `).run(newSlots, companyId);
    if (updated.changes !== 1) throw new Error('Company not found');

    const updatedComp = getCompanyById(companyId);
    return {
      success: true,
      spent: cost,
      simBoosts: updatedComp?.simboosts ?? 0,
      extraBuildingSlots: newSlots
    };
  }, { immediate: true });
}

export async function unlockDisplayCaseSlot(companyId: number) {
  return runInTransaction(async () => {
    const comp = getCompanyById(companyId);
    if (!comp || comp.simboosts < 50) {
      throw new Error('Need at least 50 SimBoosts to unlock a display case slot');
    }

    const row = db.prepare('SELECT display_case_slots FROM companies WHERE company_id = ?')
      .get(companyId) as { display_case_slots?: number } | undefined;
    const currentSlots = Math.max(1, Math.floor(Number(row?.display_case_slots) || 1));
    if (currentSlots >= 12) {
      throw new Error('Maximum display case slots reached');
    }

    updateCompanySimBoosts(companyId, -50);
    const newSlots = currentSlots + 1;
    const updated = db.prepare(`
      UPDATE companies SET display_case_slots = ?
      WHERE company_id = ?
    `).run(newSlots, companyId);
    if (updated.changes !== 1) throw new Error('Company not found');

    const updatedComp = getCompanyById(companyId);
    return {
      success: true,
      message: "Display case slot unlocked successfully",
      simBoosts: updatedComp?.simboosts ?? 0,
      displayCaseSlots: newSlots
    };
  }, { immediate: true });
}

export async function unlockExecutiveSlot(companyId: number) {
  return runInTransaction(async () => {
    const comp = getCompanyById(companyId);
    if (!comp || comp.simboosts < 100) {
      throw new Error('Need at least 100 SimBoosts to unlock an executive slot');
    }

    const row = db.prepare('SELECT extra_executive_slots FROM companies WHERE company_id = ?')
      .get(companyId) as { extra_executive_slots?: number } | undefined;
    const currentSlots = Math.max(0, Math.floor(Number(row?.extra_executive_slots) || 0));
    if (currentSlots >= 20) {
      throw new Error('Maximum executive slots reached');
    }

    updateCompanySimBoosts(companyId, -100);
    const newSlots = currentSlots + 1;
    const updated = db.prepare(`
      UPDATE companies SET extra_executive_slots = ?
      WHERE company_id = ?
    `).run(newSlots, companyId);
    if (updated.changes !== 1) throw new Error('Company not found');

    const updatedComp = getCompanyById(companyId);
    return {
      success: true,
      message: "Executive slot unlocked successfully",
      simBoosts: updatedComp?.simboosts ?? 0,
      extraExecutiveSlots: newSlots
    };
  }, { immediate: true });
}

export async function unlockTagSlot(companyId: number) {
  return runInTransaction(async () => {
    const comp = getCompanyById(companyId);
    if (!comp || comp.simboosts < 200) {
      throw new Error('Need at least 200 SimBoosts to unlock a search tag slot');
    }

    const row = db.prepare('SELECT max_tags FROM companies WHERE company_id = ?')
      .get(companyId) as { max_tags?: number } | undefined;
    const currentTags = Math.max(1, Math.floor(Number(row?.max_tags) || 1));
    if (currentTags >= 10) {
      throw new Error('Maximum tag slots reached');
    }

    updateCompanySimBoosts(companyId, -200);
    const newTags = currentTags + 1;
    const updated = db.prepare(`
      UPDATE companies SET max_tags = ?
      WHERE company_id = ?
    `).run(newTags, companyId);
    if (updated.changes !== 1) throw new Error('Company not found');

    const updatedComp = getCompanyById(companyId);
    return {
      success: true,
      message: "Tag slot unlocked successfully",
      simBoosts: updatedComp?.simboosts ?? 0,
      maxTags: newTags
    };
  }, { immediate: true });
}

export async function rushProduction(companyId: number, buildingId: number, queueId?: number) {
  const cost = 1;
  return runInTransaction(async () => {
    const comp = getCompanyById(companyId);
    if (!comp || comp.simboosts < cost) {
      throw new Error('Need at least 1 SimBoost to rush production');
    }

    const building = getBuildingById(buildingId);
    if (!building || building.company_id !== companyId) {
      throw new Error('Building not found');
    }

    const item = queueId
      ? db.prepare(`
          SELECT id, kind, quality, amount
          FROM production_queues
          WHERE id = ? AND building_id = ? AND company_id = ? AND resolved = 0
        `).get(queueId, buildingId, companyId) as { id: number; kind: number; quality?: number; amount: number } | undefined
      : db.prepare(`
          SELECT id, kind, quality, amount
          FROM production_queues
          WHERE building_id = ? AND company_id = ? AND resolved = 0
          ORDER BY id ASC
          LIMIT 1
        `).get(buildingId, companyId) as { id: number; kind: number; quality?: number; amount: number } | undefined;
    if (!item) {
      throw new Error('No active production queue found for this building');
    }

    updateCompanySimBoosts(companyId, -cost);
    const claimed = db.prepare(`
      UPDATE production_queues SET resolved = 1, finishes_at = ?
      WHERE id = ? AND building_id = ? AND company_id = ? AND resolved = 0
    `).run(new Date().toISOString(), item.id, buildingId, companyId);
    if (claimed.changes !== 1) {
      throw new Error('Production queue is no longer active');
    }
    addResource(companyId, item.kind, item.quality ?? 0, item.amount);
    const updatedBuilding = db.prepare(`
      UPDATE buildings SET busy_until = NULL
      WHERE id = ? AND company_id = ?
    `).run(buildingId, companyId);
    if (updatedBuilding.changes !== 1) throw new Error('Building not found');

    const latestBuilding = getBuildingById(buildingId);
    const updatedComp = getCompanyById(companyId);
    return {
      success: true,
      message: "Production completed instantly!",
      simBoosts: updatedComp?.simboosts ?? 0,
      building: latestBuilding ? formatBuilding(latestBuilding) : null,
      queue: getBuildingQueue(companyId, buildingId)
    };
  }, { immediate: true });
}

export async function rushBuildingUpgradeOrConstruction(companyId: number, buildingId: number) {
  const cost = 5;
  return runInTransaction(async () => {
    const comp = getCompanyById(companyId);
    if (!comp || comp.simboosts < cost) {
      throw new Error('Need at least 5 SimBoosts to rush construction');
    }

    const building = getBuildingById(buildingId);
    if (!building || building.company_id !== companyId) {
      throw new Error('Building not found');
    }

    const busyUntilMs = building.busy_until ? new Date(building.busy_until).getTime() : 0;
    if (busyUntilMs <= Date.now()) {
      throw new Error('Building is not under construction or upgrade');
    }

    updateCompanySimBoosts(companyId, -cost);
    const updated = db.prepare(`
      UPDATE buildings SET busy_until = NULL
      WHERE id = ? AND company_id = ?
    `).run(buildingId, companyId);
    if (updated.changes !== 1) throw new Error('Building not found');

    const updatedBuilding = getBuildingById(buildingId);
    const updatedComp = getCompanyById(companyId);
    return {
      success: true,
      message: "Construction rushed successfully",
      simBoosts: updatedComp?.simboosts ?? 0,
      building: updatedBuilding ? formatBuilding(updatedBuilding) : null
    };
  }, { immediate: true });
}
