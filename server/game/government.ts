import crypto from 'node:crypto';
import { db } from '../db/database.ts';
import { getCompanyById, updateCompanyMoney } from './company.ts';
import { consumeResourceExactWithTransactions, getWarehouseItemExact } from './warehouse.ts';

// Initialize Government Orders tables
db.exec(`
  CREATE TABLE IF NOT EXISTS government_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    realm_id INTEGER DEFAULT 0,
    project_key TEXT,
    agency TEXT,
    estimated_base_value REAL,
    days_to_fulfill INTEGER,
    resource_multiplier_awarded REAL,
    required_resources_json TEXT,
    unit_compensation_price REAL DEFAULT 0,
    start_date TEXT,
    deadline TEXT,
    created_at TEXT
  );

  CREATE TABLE IF NOT EXISTS government_bids (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    secret TEXT UNIQUE,
    template_id INTEGER,
    realm_id INTEGER DEFAULT 0,
    creator_company_id INTEGER,
    max_contractors INTEGER DEFAULT 5,
    is_public INTEGER DEFAULT 1,
    min_tier_index INTEGER DEFAULT 1,
    price_breakdown_json TEXT,
    note TEXT,
    status TEXT DEFAULT 'OPEN',
    created_at TEXT
  );

  CREATE TABLE IF NOT EXISTS government_bid_contractors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bid_secret TEXT,
    company_id INTEGER,
    is_main INTEGER DEFAULT 0,
    tier_index INTEGER DEFAULT 1,
    tier_multiplier REAL DEFAULT 1.0,
    deposit_paid REAL DEFAULT 0,
    fulfilled INTEGER DEFAULT 0,
    joined_at TEXT
  );

  CREATE TABLE IF NOT EXISTS government_bid_blocked_companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bid_secret TEXT,
    company_id INTEGER,
    blocked_at TEXT
  );
`);

// Older databases may predate later columns; ALTER defensively (no-op if present).
for (const [table, column, ddl] of [
  ['government_orders', 'unit_compensation_price', 'ALTER TABLE government_orders ADD COLUMN unit_compensation_price REAL DEFAULT 0'],
  ['government_orders', 'start_date', 'ALTER TABLE government_orders ADD COLUMN start_date TEXT'],
  ['government_orders', 'deadline', 'ALTER TABLE government_orders ADD COLUMN deadline TEXT']
] as const) {
  const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(c => c.name);
  if (!cols.includes(column)) db.exec(ddl);
}

export interface GovernmentRequiredResource {
  id: number;
  kind: number;
  quality: number;
  amountBase: number;
  targetAmount?: number;
  unitCompensationPrice?: number;
  unitPrice?: number;
}

export interface GovernmentOrderTemplate {
  id: number;
  realm: number;
  realmId?: number;
  projectKey: string;
  agency: string;
  estimatedBaseValue: number;
  daysToFulfill: number;
  resourceMultiplierAwarded: number | null;
  created: string;
  startDate?: string;
  deadline?: string;
  unitCompensationPrice?: number;
  governmentorderrequiredresourceSet: GovernmentRequiredResource[];
  governmentOrders?: GovernmentOrderTemplate[];
}

export interface GovernmentBidder {
  id: number;
  companyId: number;
  isMainContractor: boolean;
  tierIndex: number;
  tierResourceMultiplicator: number;
  fulfilled: boolean;
  depositPaid: number;
  company: {
    id: number;
    company: string;
    logo: string;
    realmId: number;
    deleted: boolean;
  };
  allocatedShare?: number;
  computedResourcesNeeded?: Record<string, { kind: number; amount: number; quality: number }>;
}

export interface GovernmentBidApplication {
  id?: number;
  secret: string;
  templateId: number;
  template?: GovernmentOrderTemplate;
  status?: string;
  maxContractorCount: number;
  isPublic: boolean;
  minimumRequiredTierIndex: number;
  resourcePriceBreakdown: string;
  note: string;
  governmentorderbidderSet: GovernmentBidder[];
  contractors?: GovernmentBidder[];
}

// 7 Standard Government Procurement Projects matching formulas_government.md & prompt specifications
const STANDARD_PROJECTS = [
  {
    key: 'FIRE_TRUCK_FLEET',
    agency: 'FIRE_DEPARTMENT',
    value: 260000,
    days: 7,
    unitCompensationPrice: 85.0,
    resources: [
      { id: 1, kind: 12, quality: 0, amountBase: 600, targetAmount: 600, unitCompensationPrice: 40.0, unitPrice: 40.0 }, // Diesel / Gasoline
      { id: 2, kind: 48, quality: 1, amountBase: 180, targetAmount: 180, unitCompensationPrice: 200.0, unitPrice: 200.0 }, // Electric components
      { id: 3, kind: 18, quality: 1, amountBase: 350, targetAmount: 350, unitCompensationPrice: 100.0, unitPrice: 100.0 }  // Steel / Aluminium
    ]
  },
  {
    key: 'SATELLITE_NETWORK',
    agency: 'SPACE_EXPLORATION_AGENCY',
    value: 720000,
    days: 10,
    unitCompensationPrice: 1250.0,
    resources: [
      { id: 4, kind: 80, quality: 2, amountBase: 25, targetAmount: 25, unitCompensationPrice: 8000.0, unitPrice: 8000.0 },   // Flight computer
      { id: 5, kind: 85, quality: 1, amountBase: 15, targetAmount: 15, unitCompensationPrice: 12000.0, unitPrice: 12000.0 }, // Solid rocket
      { id: 6, kind: 100, quality: 0, amountBase: 500, targetAmount: 500, unitCompensationPrice: 300.0, unitPrice: 300.0 }  // Aerospace Research
    ]
  },
  {
    key: 'BORDER_SECURITY_LOGISTICS',
    agency: 'DEPARTMENT_OF_DEFENSE',
    value: 550000,
    days: 8,
    unitCompensationPrice: 280.0,
    resources: [
      { id: 7, kind: 11, quality: 0, amountBase: 1500, targetAmount: 1500, unitCompensationPrice: 45.0, unitPrice: 45.0 },  // Petrol / Gasoline
      { id: 8, kind: 80, quality: 2, amountBase: 20, targetAmount: 20, unitCompensationPrice: 8000.0, unitPrice: 8000.0 },   // Flight computer
      { id: 9, kind: 100, quality: 0, amountBase: 400, targetAmount: 400, unitCompensationPrice: 300.0, unitPrice: 300.0 }  // Aerospace Research
    ]
  },
  {
    key: 'CLEAN_WATER_INITIATIVE',
    agency: 'ENVIRONMENTAL_PROTECTION_AGENCY',
    value: 310000,
    days: 6,
    unitCompensationPrice: 2.3,
    resources: [
      { id: 10, kind: 2, quality: 0, amountBase: 80000, targetAmount: 80000, unitCompensationPrice: 0.5, unitPrice: 0.5 },  // Water
      { id: 11, kind: 1, quality: 0, amountBase: 50000, targetAmount: 50000, unitCompensationPrice: 0.3, unitPrice: 0.3 },  // Power
      { id: 12, kind: 22, quality: 1, amountBase: 400, targetAmount: 400, unitCompensationPrice: 150.0, unitPrice: 150.0 }  // Batteries
    ]
  },
  {
    key: 'STRATEGIC_GRAIN_RESERVE',
    agency: 'DEPARTMENT_OF_AGRICULTURE',
    value: 210000,
    days: 5,
    unitCompensationPrice: 2.6,
    resources: [
      { id: 13, kind: 3, quality: 0, amountBase: 15000, targetAmount: 15000, unitCompensationPrice: 4.5, unitPrice: 4.5 },  // Apples
      { id: 14, kind: 2, quality: 0, amountBase: 60000, targetAmount: 60000, unitCompensationPrice: 0.5, unitPrice: 0.5 },  // Water
      { id: 15, kind: 66, quality: 0, amountBase: 5000, targetAmount: 5000, unitCompensationPrice: 8.0, unitPrice: 8.0 }   // Seeds
    ]
  },
  {
    key: 'GRID_REINFORCEMENT',
    agency: 'ENERGY_DEPARTMENT',
    value: 480000,
    days: 7,
    unitCompensationPrice: 4.0,
    resources: [
      { id: 16, kind: 1, quality: 0, amountBase: 100000, targetAmount: 100000, unitCompensationPrice: 0.3, unitPrice: 0.3 }, // Power
      { id: 17, kind: 22, quality: 1, amountBase: 600, targetAmount: 600, unitCompensationPrice: 150.0, unitPrice: 150.0 }, // Batteries
      { id: 18, kind: 18, quality: 1, amountBase: 500, targetAmount: 500, unitCompensationPrice: 100.0, unitPrice: 100.0 }  // Aluminium
    ]
  },
  {
    key: 'EMERGENCY_MEDICAL_SUPPLY',
    agency: 'PUBLIC_HEALTH_DEPARTMENT',
    value: 350000,
    days: 5,
    unitCompensationPrice: 7.2,
    resources: [
      { id: 19, kind: 2, quality: 1, amountBase: 40000, targetAmount: 40000, unitCompensationPrice: 0.8, unitPrice: 0.8 },  // Water
      { id: 20, kind: 3, quality: 1, amountBase: 8000, targetAmount: 8000, unitCompensationPrice: 6.0, unitPrice: 6.0 },    // Apples
      { id: 21, kind: 22, quality: 1, amountBase: 500, targetAmount: 500, unitCompensationPrice: 150.0, unitPrice: 150.0 }  // Batteries
    ]
  }
];

export function ensureSeededProjects(realmId: number = 0) {
  const count = db.prepare('SELECT COUNT(*) as count FROM government_orders WHERE realm_id = ?').get(realmId) as { count: number };
  if (count.count >= STANDARD_PROJECTS.length) return;

  const now = new Date();
  const nowIso = now.toISOString();
  const deadlineIso = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString();

  // If table exists with old projects count, clean up or insert missing
  if (count.count > 0 && count.count < STANDARD_PROJECTS.length) {
    db.prepare('DELETE FROM government_orders WHERE realm_id = ?').run(realmId);
  }

  for (const p of STANDARD_PROJECTS) {
    db.prepare(`
      INSERT INTO government_orders (
        realm_id, project_key, agency, estimated_base_value, days_to_fulfill,
        resource_multiplier_awarded, required_resources_json, unit_compensation_price,
        start_date, deadline, created_at
      ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)
    `).run(
      realmId,
      p.key,
      p.agency,
      p.value,
      p.days,
      JSON.stringify(p.resources),
      p.unitCompensationPrice,
      nowIso,
      deadlineIso,
      nowIso
    );
  }
}

export function getGovernmentTier(companyId?: number | null): {
  tier: { tierIndex: number; resourceMultiplicator: number };
  tierIndex: number;
  resourceMultiplicator: number;
} {
  if (!companyId) {
    return {
      tier: { tierIndex: 1, resourceMultiplicator: 1.0 },
      tierIndex: 1,
      resourceMultiplicator: 1.0
    };
  }
  const comp = getCompanyById(companyId);
  const level = comp?.level || 1;
  // Tier index 1..10 based on company level
  const tierIndex = Math.min(10, Math.max(1, Math.floor((level - 1) / 5) + 1));
  const resourceMultiplicator = Math.round((1.0 + (tierIndex - 1) * 0.25) * 100) / 100;
  return {
    tier: {
      tierIndex,
      resourceMultiplicator
    },
    tierIndex,
    resourceMultiplicator
  };
}

export function getGovernmentOrders(realmId: number = 0): GovernmentOrderTemplate[] {
  ensureSeededProjects(realmId);
  const rows = db.prepare('SELECT * FROM government_orders WHERE realm_id = ?').all(realmId) as Array<{
    id: number;
    realm_id: number;
    project_key: string;
    agency: string;
    estimated_base_value: number;
    days_to_fulfill: number;
    resource_multiplier_awarded: number | null;
    required_resources_json: string;
    unit_compensation_price?: number;
    start_date?: string;
    deadline?: string;
    created_at: string;
  }>;

  return rows.map(r => {
    let resources: GovernmentRequiredResource[] = [];
    try {
      resources = JSON.parse(r.required_resources_json || '[]');
    } catch {
      resources = [];
    }
    const created = r.created_at || new Date().toISOString();
    const deadline = r.deadline || new Date(Date.parse(created) + 5 * 24 * 60 * 60 * 1000).toISOString();
    return {
      id: r.id,
      realm: r.realm_id,
      realmId: r.realm_id,
      projectKey: r.project_key,
      agency: r.agency,
      estimatedBaseValue: r.estimated_base_value,
      daysToFulfill: r.days_to_fulfill,
      resourceMultiplierAwarded: r.resource_multiplier_awarded,
      created,
      startDate: r.start_date || created,
      deadline,
      unitCompensationPrice: r.unit_compensation_price || 0,
      governmentorderrequiredresourceSet: resources
    };
  });
}

export function getGovernmentOrderById(id: number): GovernmentOrderTemplate | null {
  const r = db.prepare('SELECT * FROM government_orders WHERE id = ?').get(id) as {
    id: number;
    realm_id: number;
    project_key: string;
    agency: string;
    estimated_base_value: number;
    days_to_fulfill: number;
    resource_multiplier_awarded: number | null;
    required_resources_json: string;
    unit_compensation_price?: number;
    start_date?: string;
    deadline?: string;
    created_at: string;
  } | undefined;

  if (!r) return null;

  let resources: GovernmentRequiredResource[] = [];
  try {
    resources = JSON.parse(r.required_resources_json || '[]');
  } catch {
    resources = [];
  }
  const created = r.created_at || new Date().toISOString();
  const deadline = r.deadline || new Date(Date.parse(created) + 5 * 24 * 60 * 60 * 1000).toISOString();

  return {
    id: r.id,
    realm: r.realm_id,
    realmId: r.realm_id,
    projectKey: r.project_key,
    agency: r.agency,
    estimatedBaseValue: r.estimated_base_value,
    daysToFulfill: r.days_to_fulfill,
    resourceMultiplierAwarded: r.resource_multiplier_awarded,
    created,
    startDate: r.start_date || created,
    deadline,
    unitCompensationPrice: r.unit_compensation_price || 0,
    governmentorderrequiredresourceSet: resources
  };
}

interface GovernmentBidDbRow {
  id: number;
  secret: string;
  template_id: number;
  realm_id: number;
  creator_company_id: number;
  max_contractors: number;
  is_public: number;
  min_tier_index: number;
  price_breakdown_json: string;
  note: string;
  status: string;
  created_at: string;
}

function computeBidAllocations(template: GovernmentOrderTemplate, maxContractors: number, contractors: Array<{
  id: number;
  company_id: number;
  is_main: number;
  tier_index: number;
  tier_multiplier: number;
  deposit_paid: number;
  fulfilled: number;
  company_name: string | null;
  company_logo: string | null;
  company_realm: number | null;
}>): GovernmentBidder[] {
  const totalSlots = Math.max(3, maxContractors);
  // Sort contractors by tier multiplier ascending
  const sorted = [...contractors].sort((a, b) => a.tier_multiplier - b.tier_multiplier);
  const highestMultiplier = sorted.length > 0 ? Math.max(...sorted.map(c => c.tier_multiplier)) : 1.0;

  // Calculate sum of multipliers including placeholder pretend bidders for unfilled slots
  let sumMultipliers = 0;
  for (const c of sorted) {
    sumMultipliers += c.tier_multiplier;
  }
  const unfilledSlots = Math.max(0, totalSlots - sorted.length);
  sumMultipliers += unfilledSlots * highestMultiplier;
  if (sumMultipliers <= 0) sumMultipliers = 1.0;

  return sorted.map(c => {
    const share = Math.round((c.tier_multiplier / sumMultipliers) * 10000) / 10000;
    const computedResources: Record<string, { kind: number; amount: number; quality: number }> = {};

    for (const res of template.governmentorderrequiredresourceSet) {
      // Proportional resource share calculation according to decompiled Rzi formula
      const computedMultiplicator = (c.tier_multiplier / sumMultipliers) * totalSlots;
      const amount = Math.max(1, Math.ceil(res.amountBase * computedMultiplicator));
      computedResources[String(res.kind)] = {
        kind: res.kind,
        amount,
        quality: res.quality
      };
    }

    return {
      id: c.id,
      companyId: c.company_id,
      isMainContractor: Boolean(c.is_main),
      tierIndex: c.tier_index,
      tierResourceMultiplicator: c.tier_multiplier,
      fulfilled: Boolean(c.fulfilled),
      depositPaid: c.deposit_paid,
      company: {
        id: c.company_id,
        company: c.company_name || `Company #${c.company_id}`,
        logo: c.company_logo || '',
        realmId: c.company_realm ?? template.realm,
        deleted: false
      },
      allocatedShare: share,
      computedResourcesNeeded: computedResources
    };
  });
}

function buildBidApplication(bidRow: GovernmentBidDbRow): GovernmentBidApplication {
  const template = getGovernmentOrderById(bidRow.template_id);
  const contractors = db.prepare(`
    SELECT c.*, comp.name as company_name, comp.logo as company_logo, comp.realm_id as company_realm
    FROM government_bid_contractors c
    LEFT JOIN companies comp ON c.company_id = comp.company_id
    WHERE c.bid_secret = ?
  `).all(bidRow.secret) as Array<{
    id: number;
    company_id: number;
    is_main: number;
    tier_index: number;
    tier_multiplier: number;
    deposit_paid: number;
    fulfilled: number;
    company_name: string | null;
    company_logo: string | null;
    company_realm: number | null;
  }>;

  const bidderSet = template
    ? computeBidAllocations(template, bidRow.max_contractors, contractors)
    : contractors.map(c => ({
        id: c.id,
        companyId: c.company_id,
        isMainContractor: Boolean(c.is_main),
        tierIndex: c.tier_index,
        tierResourceMultiplicator: c.tier_multiplier,
        fulfilled: Boolean(c.fulfilled),
        depositPaid: c.deposit_paid,
        company: {
          id: c.company_id,
          company: c.company_name || `Company #${c.company_id}`,
          logo: c.company_logo || '',
          realmId: c.company_realm ?? bidRow.realm_id,
          deleted: false
        }
      }));

  const allFulfilled = bidderSet.length >= bidRow.maxContractorCount && bidderSet.every(b => b.fulfilled);
  const status = allFulfilled ? 'FULFILLED' : (bidRow.status || 'OPEN');

  return {
    id: bidRow.id,
    secret: bidRow.secret,
    templateId: bidRow.template_id,
    template: template || undefined,
    status,
    maxContractorCount: bidRow.max_contractors,
    isPublic: Boolean(bidRow.is_public),
    minimumRequiredTierIndex: bidRow.min_tier_index,
    resourcePriceBreakdown: bidRow.price_breakdown_json || '{}',
    note: bidRow.note || '',
    governmentorderbidderSet: bidderSet,
    contractors: bidderSet
  };
}

export function getGovernmentBids(realmId: number = 0): GovernmentBidApplication[] {
  ensureSeededProjects(realmId);
  const bids = db.prepare('SELECT * FROM government_bids WHERE realm_id = ? AND is_public = 1').all(realmId) as unknown as GovernmentBidDbRow[];
  return bids.map(buildBidApplication);
}

export function getGovernmentBidByIdOrSecret(idOrSecret: string | number): GovernmentBidApplication | null {
  let bid: GovernmentBidDbRow | undefined;
  if (typeof idOrSecret === 'number' || /^\d+$/.test(String(idOrSecret))) {
    bid = db.prepare('SELECT * FROM government_bids WHERE id = ? OR secret = ?').get(Number(idOrSecret), String(idOrSecret)) as GovernmentBidDbRow | undefined;
  } else {
    bid = db.prepare('SELECT * FROM government_bids WHERE secret = ?').get(idOrSecret) as GovernmentBidDbRow | undefined;
  }
  if (!bid) return null;
  return buildBidApplication(bid);
}

export function createGovernmentBid(
  companyId: number,
  realmId: number,
  data: {
    templateId: number;
    maxContractorCount?: number;
    contractors?: number[] | Array<{ companyId: number }>;
    isPublic?: boolean;
    minimumRequiredTierIndex?: number;
    resourcePriceBreakdown?: Record<string, number> | string;
    note?: string;
  }
): GovernmentBidApplication {
  ensureSeededProjects(realmId);
  const template = getGovernmentOrderById(data.templateId);
  if (!template) {
    throw new Error('Government order project template not found');
  }

  // Validate deadline
  if (template.deadline && Date.now() > Date.parse(template.deadline)) {
    throw new Error('Project bidding deadline has passed');
  }

  // Validate max contractors (3 to 7)
  const maxContractors = data.maxContractorCount !== undefined ? Number(data.maxContractorCount) : 5;
  if (maxContractors < 3 || maxContractors > 7) {
    throw new Error('Contractors count must be between 3 and 7');
  }

  // Validate initial contractors if provided
  const rawContractors = data.contractors || [];
  const contractorIds: number[] = rawContractors.map(c => (typeof c === 'number' ? c : c.companyId));
  if (contractorIds.length > 0 && (contractorIds.length < 3 || contractorIds.length > 7)) {
    throw new Error('Contractors count must be between 3 and 7');
  }

  const creatorTier = getGovernmentTier(companyId);
  const minTier = data.minimumRequiredTierIndex || 1;
  if (creatorTier.tierIndex < minTier) {
    throw new Error(`Company tier T${creatorTier.tierIndex} does not meet minimum requirement T${minTier}`);
  }

  // Calculate 10% security deposit
  const deposit = Math.floor(template.estimatedBaseValue * creatorTier.resourceMultiplicator * 0.1);

  // Check creator funds
  const creator = getCompanyById(companyId);
  if (!creator || creator.money < deposit) {
    throw new Error(`Insufficient funds for security deposit (Required: $${deposit}, Balance: $${creator?.money || 0})`);
  }

  const secret = `bid-${crypto.randomBytes(6).toString('hex')}`;
  const now = new Date().toISOString();
  const priceBreakdown = typeof data.resourcePriceBreakdown === 'string'
    ? data.resourcePriceBreakdown
    : JSON.stringify(data.resourcePriceBreakdown || {});

  // Atomic database transaction
  db.exec('BEGIN TRANSACTION');
  try {
    // 1. Deduct security deposit
    updateCompanyMoney(companyId, -deposit);

    // 2. Insert bid
    db.prepare(`
      INSERT INTO government_bids (
        secret, template_id, realm_id, creator_company_id, max_contractors,
        is_public, min_tier_index, price_breakdown_json, note, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?)
    `).run(
      secret,
      data.templateId,
      realmId,
      companyId,
      maxContractors,
      data.isPublic === false ? 0 : 1,
      minTier,
      priceBreakdown,
      data.note || '',
      now
    );

    // 3. Add creator as main contractor
    db.prepare(`
      INSERT INTO government_bid_contractors (
        bid_secret, company_id, is_main, tier_index, tier_multiplier,
        deposit_paid, fulfilled, joined_at
      ) VALUES (?, ?, 1, ?, ?, ?, 0, ?)
    `).run(
      secret,
      companyId,
      creatorTier.tierIndex,
      creatorTier.resourceMultiplicator,
      deposit,
      now
    );

    // 4. Add additional contractors if submitted
    for (const cId of contractorIds) {
      if (cId === companyId) continue;
      const subTier = getGovernmentTier(cId);
      const subDeposit = Math.floor(template.estimatedBaseValue * subTier.resourceMultiplicator * 0.1);
      const subComp = getCompanyById(cId);
      let paid = 0;
      if (subComp && subComp.money >= subDeposit) {
        try {
          updateCompanyMoney(cId, -subDeposit);
          paid = subDeposit;
        } catch {
          paid = 0;
        }
      }

      db.prepare(`
        INSERT INTO government_bid_contractors (
          bid_secret, company_id, is_main, tier_index, tier_multiplier,
          deposit_paid, fulfilled, joined_at
        ) VALUES (?, ?, 0, ?, ?, ?, 0, ?)
      `).run(
        secret,
        cId,
        subTier.tierIndex,
        subTier.resourceMultiplicator,
        paid,
        now
      );
    }

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return getGovernmentBidByIdOrSecret(secret)!;
}

export function updateGovernmentBid(
  secret: string,
  companyId: number,
  data: {
    maxContractorCount?: number;
    isPublic?: boolean;
    minimumRequiredTierIndex?: number;
    resourcePriceBreakdown?: Record<string, number> | string;
    note?: string;
  }
): GovernmentBidApplication {
  const bid = getGovernmentBidByIdOrSecret(secret);
  if (!bid) {
    throw new Error('Bid not found');
  }

  const isMain = bid.governmentorderbidderSet.some(b => b.companyId === companyId && b.isMainContractor);
  if (!isMain) {
    throw new Error('Only the main contractor can edit bid parameters');
  }

  const updates: string[] = [];
  const params: (string | number | null)[] = [];

  if (data.note !== undefined) {
    updates.push('note = ?');
    params.push(data.note.slice(0, 1024));
  }
  if (data.maxContractorCount !== undefined) {
    const count = Number(data.maxContractorCount);
    if (count < 3 || count > 7) {
      throw new Error('Contractors count must be between 3 and 7');
    }
    updates.push('max_contractors = ?');
    params.push(count);
  }
  if (data.isPublic !== undefined) {
    updates.push('is_public = ?');
    params.push(data.isPublic ? 1 : 0);
  }
  if (data.minimumRequiredTierIndex !== undefined) {
    updates.push('min_tier_index = ?');
    params.push(Number(data.minimumRequiredTierIndex));
  }
  if (data.resourcePriceBreakdown !== undefined) {
    const priceStr = typeof data.resourcePriceBreakdown === 'string'
      ? data.resourcePriceBreakdown
      : JSON.stringify(data.resourcePriceBreakdown);
    updates.push('price_breakdown_json = ?');
    params.push(priceStr);
  }

  if (updates.length > 0) {
    params.push(secret);
    db.prepare(`UPDATE government_bids SET ${updates.join(', ')} WHERE secret = ?`).run(...params);
  }

  return getGovernmentBidByIdOrSecret(secret)!;
}

export function deleteGovernmentBid(secret: string, companyId: number): boolean {
  const bid = getGovernmentBidByIdOrSecret(secret);
  if (!bid) return false;

  const isMain = bid.governmentorderbidderSet.some(b => b.companyId === companyId && b.isMainContractor);
  if (!isMain) {
    throw new Error('Only the main contractor can delete the bid');
  }

  db.exec('BEGIN TRANSACTION');
  try {
    // Refund deposits to contractors who paid
    for (const b of bid.governmentorderbidderSet) {
      if (b.depositPaid > 0) {
        updateCompanyMoney(b.companyId, b.depositPaid);
      }
    }
    db.prepare('DELETE FROM government_bid_contractors WHERE bid_secret = ?').run(secret);
    db.prepare('DELETE FROM government_bid_blocked_companies WHERE bid_secret = ?').run(secret);
    db.prepare('DELETE FROM government_bids WHERE secret = ?').run(secret);
    db.exec('COMMIT');
    return true;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function joinGovernmentBid(secret: string, companyId: number): GovernmentBidApplication {
  const bid = getGovernmentBidByIdOrSecret(secret);
  if (!bid) {
    throw new Error('Bid not found');
  }

  // Check if company is blocked
  const blocked = getBlockedCompanies(secret);
  if (blocked.blockedCompanies.includes(companyId)) {
    throw new Error('Company is blocked from joining this bid');
  }

  if (bid.governmentorderbidderSet.some(b => b.companyId === companyId)) {
    return bid;
  }

  if (bid.governmentorderbidderSet.length >= bid.maxContractorCount) {
    throw new Error(`Bid has reached maximum contractor capacity of ${bid.maxContractorCount}`);
  }

  const tier = getGovernmentTier(companyId);
  if (tier.tierIndex < bid.minimumRequiredTierIndex) {
    throw new Error(`Company tier T${tier.tierIndex} is lower than required T${bid.minimumRequiredTierIndex}`);
  }

  const template = getGovernmentOrderById(bid.templateId);
  const deposit = template ? Math.floor(template.estimatedBaseValue * tier.resourceMultiplicator * 0.1) : 0;
  const company = getCompanyById(companyId);
  if (deposit > 0 && (!company || company.money < deposit)) {
    throw new Error(`Insufficient funds for security deposit (Required: $${deposit})`);
  }

  db.exec('BEGIN TRANSACTION');
  try {
    if (deposit > 0) {
      updateCompanyMoney(companyId, -deposit);
    }
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO government_bid_contractors (
        bid_secret, company_id, is_main, tier_index, tier_multiplier,
        deposit_paid, fulfilled, joined_at
      ) VALUES (?, ?, 0, ?, ?, ?, 0, ?)
    `).run(
      secret,
      companyId,
      tier.tierIndex,
      tier.resourceMultiplicator,
      deposit,
      now
    );
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return getGovernmentBidByIdOrSecret(secret)!;
}

export function leaveOrRemoveContractor(secret: string, companyId: number, targetCompanyId?: number): GovernmentBidApplication {
  const bid = getGovernmentBidByIdOrSecret(secret);
  if (!bid) {
    throw new Error('Bid not found');
  }

  const contractorToKick = targetCompanyId || companyId;
  const bidder = bid.governmentorderbidderSet.find(b => b.companyId === contractorToKick);
  if (!bidder) {
    return bid;
  }

  const isMain = bid.governmentorderbidderSet.some(b => b.companyId === companyId && b.isMainContractor);
  if (contractorToKick !== companyId && !isMain) {
    throw new Error('Only the main contractor can remove other contractors');
  }

  db.exec('BEGIN TRANSACTION');
  try {
    // Refund deposit
    if (bidder.depositPaid > 0) {
      updateCompanyMoney(contractorToKick, bidder.depositPaid);
    }
    db.prepare('DELETE FROM government_bid_contractors WHERE bid_secret = ? AND company_id = ?').run(secret, contractorToKick);

    // If kicked by main contractor, block them
    if (contractorToKick !== companyId && isMain) {
      blockCompany(secret, contractorToKick);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return getGovernmentBidByIdOrSecret(secret)!;
}

export function getBlockedCompanies(secret: string): { blockedCompanies: number[] } {
  const rows = db.prepare('SELECT company_id FROM government_bid_blocked_companies WHERE bid_secret = ?').all(secret) as Array<{ company_id: number }>;
  return { blockedCompanies: rows.map(r => r.company_id) };
}

export function blockCompany(secret: string, companyId: number): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT OR IGNORE INTO government_bid_blocked_companies (bid_secret, company_id, blocked_at)
    VALUES (?, ?, ?)
  `).run(secret, companyId, now);
}

export function unblockCompany(secret: string, companyId: number): void {
  db.prepare('DELETE FROM government_bid_blocked_companies WHERE bid_secret = ? AND company_id = ?').run(secret, companyId);
}

export function getCompanyGovernmentApplications(companyId: number): { applications: GovernmentBidApplication[] } {
  const rows = db.prepare(`
    SELECT DISTINCT b.*
    FROM government_bids b
    INNER JOIN government_bid_contractors c ON b.secret = c.bid_secret
    WHERE c.company_id = ?
  `).all(companyId) as unknown as GovernmentBidDbRow[];

  return {
    applications: rows.map(buildBidApplication)
  };
}

export function getCompanyGovernmentBids(companyId: number): { bids: GovernmentBidApplication[] } {
  const rows = db.prepare('SELECT * FROM government_bids WHERE creator_company_id = ?').all(companyId) as unknown as GovernmentBidDbRow[];
  return {
    bids: rows.map(buildBidApplication)
  };
}

export function fulfillGovernmentOrderContractor(
  secret: string,
  operatorCompanyId: number,
  targetCompanyId: number
): {
  moneyDelta: number;
  money: number;
  resourceTransactions: Array<{ kind: number; quality: number; amount: number }>;
  lastTransactionId: number;
  application: GovernmentBidApplication;
} {
  const bid = getGovernmentBidByIdOrSecret(secret);
  if (!bid) {
    throw new Error('Bid not found');
  }

  const contractor = bid.governmentorderbidderSet.find(b => b.companyId === targetCompanyId);
  if (!contractor) {
    throw new Error('Contractor not participating in this bid');
  }

  if (contractor.fulfilled) {
    throw new Error('Contractor share already fulfilled');
  }

  const isMain = bid.governmentorderbidderSet.some(b => b.companyId === operatorCompanyId && b.isMainContractor);
  if (operatorCompanyId !== targetCompanyId && !isMain) {
    throw new Error('Unauthorized to fulfill for this contractor');
  }

  const template = bid.template;
  if (!template) {
    throw new Error('Order template not found');
  }

  // Parse price breakdown
  let prices: Record<string, number> = {};
  try {
    prices = JSON.parse(bid.resourcePriceBreakdown || '{}');
  } catch {
    prices = {};
  }

  const needed = contractor.computedResourcesNeeded || {};
  const resourceTransactions: Array<{ kind: number; quality: number; amount: number }> = [];
  let rewardPayout = 0;

  db.exec('BEGIN TRANSACTION');
  try {
    for (const [kindStr, item] of Object.entries(needed)) {
      const kind = Number(kindStr);
      const neededAmount = item.amount;
      const neededQuality = item.quality;
      const unitPrice = prices[kindStr] !== undefined ? Number(prices[kindStr]) : (template.unitCompensationPrice || 50.0);

      // Check warehouse stock
      const warehouseItem = getWarehouseItemExact(targetCompanyId, kind, neededQuality);
      if (!warehouseItem || warehouseItem.amount < neededAmount) {
        throw new Error(`Insufficient warehouse resources for kind ${kind} (Need: ${neededAmount}, Quality >= ${neededQuality})`);
      }

      // Consume resources
      consumeResourceExactWithTransactions(targetCompanyId, kind, neededQuality, neededAmount);
      resourceTransactions.push({ kind, quality: neededQuality, amount: neededAmount });
      rewardPayout += Math.floor(neededAmount * unitPrice);
    }

    // Return deposit + pay compensation reward
    const totalPayout = rewardPayout + contractor.depositPaid;
    const newMoney = updateCompanyMoney(targetCompanyId, totalPayout);

    // Mark contractor as fulfilled
    db.prepare('UPDATE government_bid_contractors SET fulfilled = 1 WHERE bid_secret = ? AND company_id = ?').run(secret, targetCompanyId);

    db.exec('COMMIT');

    const updatedBid = getGovernmentBidByIdOrSecret(secret)!;
    return {
      moneyDelta: totalPayout,
      money: newMoney,
      resourceTransactions,
      lastTransactionId: Date.now(),
      application: updatedBid
    };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
