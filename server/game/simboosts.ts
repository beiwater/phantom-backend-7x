import { db } from '../db/database.ts';
import { getCompanyById, updateCompanyMoney, updateCompanySimBoosts } from './company.ts';
import { getBuildingById, formatBuilding } from './buildings.ts';
import { resolveFinishedProduction, formatQueueItem, getBuildingQueue } from './production.ts';

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

export function getPaymentPricingInfo(countryCode: string = 'AU') {
  return {
    countryCodeIso: countryCode,
    bonus: 0
  };
}

export function getPlayerBonusesList(playerId: number) {
  return [];
}

export function processPackagePurchase(companyId: number, sku: string) {
  const pkg = PAYMENT_PACKAGES.find(p => p.sku === sku) || PAYMENT_PACKAGES[0];
  const newSimboosts = updateCompanySimBoosts(companyId, pkg.simBoosts);
  return {
    success: true,
    simBoosts: newSimboosts,
    payment: {
      sku: pkg.sku,
      amount: pkg.price,
      currency: "USD"
    },
    message: `Successfully purchased ${pkg.simBoosts} SimBoosts!`
  };
}

export function exchangeSimBoosts(companyId: number, amount: number) {
  if (amount <= 0) {
    throw new Error('Exchange amount must be positive');
  }
  const comp = getCompanyById(companyId);
  if (!comp || comp.simboosts < amount) {
    throw new Error('Insufficient SimBoosts');
  }

  // Conversion rate: $100 per 1 SimBoost
  const cashAmount = amount * 100;
  updateCompanySimBoosts(companyId, -amount);
  const newMoney = updateCompanyMoney(companyId, cashAmount);
  const updatedComp = getCompanyById(companyId);

  return {
    success: true,
    simBoosts: updatedComp ? updatedComp.simboosts : 0,
    money: newMoney,
    moneyAdded: cashAmount,
    simBoostsDeducted: amount,
    message: `Exchanged ${amount} SimBoosts for $${cashAmount.toLocaleString()}`
  };
}

export function unlockDisplayCaseSlot(companyId: number) {
  const comp = getCompanyById(companyId);
  if (!comp || comp.simboosts < 50) {
    throw new Error('Need at least 50 SimBoosts to unlock a display case slot');
  }

  const row = db.prepare('SELECT display_case_slots FROM companies WHERE company_id = ?').get(companyId) as { display_case_slots?: number } | undefined;
  const currentSlots = row?.display_case_slots ?? 1;
  if (currentSlots >= 12) {
    throw new Error('Maximum display case slots reached');
  }

  updateCompanySimBoosts(companyId, -50);
  const newSlots = currentSlots + 1;
  db.prepare('UPDATE companies SET display_case_slots = ? WHERE company_id = ?').run(newSlots, companyId);
  const updatedComp = getCompanyById(companyId);

  return {
    success: true,
    message: "Display case slot unlocked successfully",
    simBoosts: updatedComp ? updatedComp.simboosts : 0,
    displayCaseSlots: newSlots
  };
}

export function unlockExecutiveSlot(companyId: number) {
  const comp = getCompanyById(companyId);
  if (!comp || comp.simboosts < 100) {
    throw new Error('Need at least 100 SimBoosts to unlock an executive slot');
  }

  const row = db.prepare('SELECT extra_executive_slots FROM companies WHERE company_id = ?').get(companyId) as { extra_executive_slots?: number } | undefined;
  const currentSlots = row?.extra_executive_slots ?? 0;
  if (currentSlots >= 20) {
    throw new Error('Maximum executive slots reached');
  }

  updateCompanySimBoosts(companyId, -100);
  const newSlots = currentSlots + 1;
  db.prepare('UPDATE companies SET extra_executive_slots = ? WHERE company_id = ?').run(newSlots, companyId);
  const updatedComp = getCompanyById(companyId);

  return {
    success: true,
    message: "Executive slot unlocked successfully",
    simBoosts: updatedComp ? updatedComp.simboosts : 0,
    extraExecutiveSlots: newSlots
  };
}

export function unlockTagSlot(companyId: number) {
  const comp = getCompanyById(companyId);
  if (!comp || comp.simboosts < 200) {
    throw new Error('Need at least 200 SimBoosts to unlock a search tag slot');
  }

  const row = db.prepare('SELECT max_tags FROM companies WHERE company_id = ?').get(companyId) as { max_tags?: number } | undefined;
  const currentTags = row?.max_tags ?? 1;
  if (currentTags >= 10) {
    throw new Error('Maximum tag slots reached');
  }

  updateCompanySimBoosts(companyId, -200);
  const newTags = currentTags + 1;
  db.prepare('UPDATE companies SET max_tags = ? WHERE company_id = ?').run(newTags, companyId);
  const updatedComp = getCompanyById(companyId);

  return {
    success: true,
    message: "Tag slot unlocked successfully",
    simBoosts: updatedComp ? updatedComp.simboosts : 0,
    maxTags: newTags
  };
}

export function rushProduction(companyId: number, buildingId: number, queueId?: number) {
  const comp = getCompanyById(companyId);
  if (!comp || comp.simboosts < 1) {
    throw new Error('Need at least 1 SimBoost to rush production');
  }

  const building = getBuildingById(buildingId);
  if (!building || building.company_id !== companyId) {
    throw new Error('Building not found');
  }

  // Find active queue item
  let itemQuery = 'SELECT * FROM production_queues WHERE building_id = ? AND resolved = 0';
  const params: unknown[] = [buildingId];
  if (queueId) {
    itemQuery += ' AND id = ?';
    params.push(queueId);
  }
  itemQuery += ' ORDER BY id ASC LIMIT 1';

  const item = db.prepare(itemQuery).get(...params) as { id: number; finishes_at: string; quality?: number } | undefined;
  if (!item) {
    throw new Error('No active production queue found for this building');
  }

  const cost = 1; // 1 SimBoost flat per rush in private server
  updateCompanySimBoosts(companyId, -cost);

  const now = new Date(Date.now() - 1000).toISOString();
  db.prepare('UPDATE production_queues SET finishes_at = ? WHERE id = ?').run(now, item.id);
  db.prepare('UPDATE buildings SET busy_until = NULL WHERE id = ?').run(buildingId);

  // Automatically resolve finished production into warehouse
  resolveFinishedProduction(companyId);

  const updatedBuilding = getBuildingById(buildingId);
  const updatedComp = getCompanyById(companyId);

  return {
    success: true,
    message: "Production completed instantly!",
    simBoosts: updatedComp ? updatedComp.simboosts : 0,
    building: updatedBuilding ? formatBuilding(updatedBuilding) : null,
    queue: getBuildingQueue(companyId, buildingId)
  };
}

export function rushBuildingUpgradeOrConstruction(companyId: number, buildingId: number) {
  const comp = getCompanyById(companyId);
  if (!comp || comp.simboosts < 5) {
    throw new Error('Need at least 5 SimBoosts to rush construction');
  }

  const building = getBuildingById(buildingId);
  if (!building || building.company_id !== companyId) {
    throw new Error('Building not found');
  }

  updateCompanySimBoosts(companyId, -5);
  db.prepare('UPDATE buildings SET busy_until = NULL WHERE id = ?').run(buildingId);

  const updatedBuilding = getBuildingById(buildingId);
  const updatedComp = getCompanyById(companyId);

  return {
    success: true,
    message: "Construction rushed successfully",
    simBoosts: updatedComp ? updatedComp.simboosts : 0,
    building: updatedBuilding ? formatBuilding(updatedBuilding) : null
  };
}
