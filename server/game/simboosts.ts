import { db } from '../db/database.ts';
import { runInTransaction } from '../db/transaction.ts';
import { getCompanyById, updateCompanyMoney, updateCompanySimBoosts } from './company.ts';
import { getBuildingById, formatBuilding } from './buildings.ts';
import { getBuildingQueue } from './production.ts';
import { addResource } from './warehouse.ts';

export interface PaymentPackage {
  sku: string;
  simBoosts: number;
  price: string;
  currency: string;
  starting: boolean;
  isSupporter: boolean;
  supporter: boolean;
  supporterOnly: boolean;
  image: string;
  hq: number | null;
  wideFrame: boolean;
  approximateCurrency?: {
    code: string;
    value: number;
  };
}

export const PAYMENT_PACKAGES: PaymentPackage[] = [
  {
    sku: "simboosts_small",
    simBoosts: 50,
    price: "4.95",
    currency: "USD",
    starting: false,
    isSupporter: false,
    supporter: false,
    supporterOnly: false,
    image: "images/packages/small.png",
    hq: null,
    wideFrame: false,
    approximateCurrency: { code: "USD", value: 4.95 }
  },
  {
    sku: "simboosts_medium",
    simBoosts: 120,
    price: "9.95",
    currency: "USD",
    starting: false,
    isSupporter: false,
    supporter: false,
    supporterOnly: false,
    image: "images/packages/medium.png",
    hq: null,
    wideFrame: false,
    approximateCurrency: { code: "USD", value: 9.95 }
  },
  {
    sku: "simboosts_large",
    simBoosts: 275,
    price: "19.95",
    currency: "USD",
    starting: false,
    isSupporter: false,
    supporter: false,
    supporterOnly: false,
    image: "images/packages/large.png",
    hq: null,
    wideFrame: false,
    approximateCurrency: { code: "USD", value: 19.95 }
  },
  {
    sku: "simboosts_xlarge",
    simBoosts: 750,
    price: "49.95",
    currency: "USD",
    starting: false,
    isSupporter: false,
    supporter: false,
    supporterOnly: false,
    image: "images/packages/xlarge.png",
    hq: null,
    wideFrame: false,
    approximateCurrency: { code: "USD", value: 49.95 }
  },
  {
    sku: "simboosts_xxlarge",
    simBoosts: 1600,
    price: "99.95",
    currency: "USD",
    starting: false,
    isSupporter: false,
    supporter: false,
    supporterOnly: false,
    image: "images/packages/xxlarge.png",
    hq: null,
    wideFrame: false,
    approximateCurrency: { code: "USD", value: 99.95 }
  }
];

export function getPaymentPackagesList(platformType: string = 'web') {
  return {
    packages: PAYMENT_PACKAGES,
    filter: []
  };
}
export function canPurchasePaymentPackage(sku: string) {
  const pkg = PAYMENT_PACKAGES.find(p => p.sku === sku);
  return {
    canBuy: true,
    canPurchase: true,
    available: true,
    limit: null,
    message: null,
    package: pkg || null
  };
}

export async function purchasePaymentPackage(companyId: number, sku: string) {
  const pkg = PAYMENT_PACKAGES.find(p => p.sku === sku) || PAYMENT_PACKAGES[0];
  return runInTransaction(async () => {
    const newSimBoosts = updateCompanySimBoosts(companyId, pkg.simBoosts);
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
      starting: pkg.starting
    };
  }, { immediate: true });
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

    const cashAmount = amount * 100;
    updateCompanySimBoosts(companyId, -amount);
    const newMoney = updateCompanyMoney(companyId, cashAmount);

    const updatedComp = getCompanyById(companyId);
    return {
      success: true,
      simBoosts: updatedComp?.simboosts ?? 0,
      money: newMoney,
      moneyAdded: cashAmount,
      simBoostsDeducted: amount,
      message: `Exchanged ${amount} SimBoosts for $${cashAmount.toLocaleString()}`
    };
  }, { immediate: true });
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
