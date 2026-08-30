import crypto from 'node:crypto';
import { db } from '../db/database.ts';
import { getCompanyById, updateCompanyMoney } from './company.ts';
import { consumeResource } from './warehouse.ts';

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

export interface GovernmentRequiredResource {
  id: number;
  kind: number;
  quality: number;
  amountBase: number;
}

export interface GovernmentOrderTemplate {
  id: number;
  realm: number;
  projectKey: string;
  agency: string;
  estimatedBaseValue: number;
  daysToFulfill: number;
  resourceMultiplierAwarded: number | null;
  created: string;
  governmentorderrequiredresourceSet: GovernmentRequiredResource[];
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
}

export interface GovernmentBidApplication {
  secret: string;
  templateId: number;
  maxContractorCount: number;
  isPublic: boolean;
  minimumRequiredTierIndex: number;
  resourcePriceBreakdown: string;
  note: string;
  governmentorderbidderSet: GovernmentBidder[];
}

// Seed standard government projects
function ensureSeededProjects(realmId: number) {
  const count = db.prepare('SELECT COUNT(*) as count FROM government_orders WHERE realm_id = ?').get(realmId) as { count: number };
  if (count.count > 0) return;

  const now = new Date().toISOString();
  const projects = [
    {
      key: 'FIRE_TRUCK_FLEET',
      agency: 'FIRE_DEPARTMENT',
      value: 260000,
      days: 7,
      resources: [
        { id: 1, kind: 18, quality: 1, amountBase: 350 }, // Steel
        { id: 2, kind: 48, quality: 1, amountBase: 180 }, // Electric components
        { id: 3, kind: 72, quality: 0, amountBase: 600 }  // Diesel
      ]
    },
    {
      key: 'EMERGENCY_PROVISIONS',
      agency: 'NATURAL_DISASTER_RELIEF_AGENCY',
      value: 190000,
      days: 5,
      resources: [
        { id: 4, kind: 1, quality: 0, amountBase: 2500 }, // Water
        { id: 5, kind: 3, quality: 0, amountBase: 1200 }, // Apples
        { id: 6, kind: 118, quality: 0, amountBase: 600 } // Bread
      ]
    },
    {
      key: 'SATELLITE_NETWORK',
      agency: 'SPACE_EXPLORATION_AGENCY',
      value: 720000,
      days: 10,
      resources: [
        { id: 7, kind: 80, quality: 2, amountBase: 25 },  // Flight computer
        { id: 8, kind: 79, quality: 2, amountBase: 50 },  // High-grade E-components
        { id: 9, kind: 85, quality: 1, amountBase: 15 }   // Solid rocket
      ]
    },
    {
      key: 'GRID_REINFORCEMENT',
      agency: 'ENERGY_DEPARTMENT',
      value: 480000,
      days: 7,
      resources: [
        { id: 10, kind: 2, quality: 0, amountBase: 60000 }, // Power
        { id: 11, kind: 22, quality: 1, amountBase: 450 },  // Reinforced concrete
        { id: 12, kind: 42, quality: 1, amountBase: 250 }   // Silicon
      ]
    }
  ];

  for (const p of projects) {
    db.prepare(`
      INSERT INTO government_orders (realm_id, project_key, agency, estimated_base_value, days_to_fulfill, resource_multiplier_awarded, required_resources_json, created_at)
      VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
    `).run(realmId, p.key, p.agency, p.value, p.days, JSON.stringify(p.resources), now);
  }
}

export function getGovernmentTier(companyId?: number | null): { tier: { tierIndex: number; resourceMultiplicator: number } } {
  if (!companyId) {
    return { tier: { tierIndex: 1, resourceMultiplicator: 1.0 } };
  }
  const comp = getCompanyById(companyId);
  const level = comp?.level || 1;
  const tierIndex = Math.min(10, Math.max(1, Math.floor(level / 5)));
  const resourceMultiplicator = Math.round((1.0 + (tierIndex - 1) * 0.25) * 100) / 100;
  return {
    tier: {
      tierIndex,
      resourceMultiplicator
    }
  };
}

export function getGovernmentOrders(realmId: number): GovernmentOrderTemplate[] {
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
    created_at: string;
  }>;

  return rows.map(r => {
    let resources: GovernmentRequiredResource[] = [];
    try {
      resources = JSON.parse(r.required_resources_json || '[]');
    } catch {
      resources = [];
    }
    return {
      id: r.id,
      realm: r.realm_id,
      projectKey: r.project_key,
      agency: r.agency,
      estimatedBaseValue: r.estimated_base_value,
      daysToFulfill: r.days_to_fulfill,
      resourceMultiplierAwarded: r.resource_multiplier_awarded,
      created: r.created_at,
      governmentorderrequiredresourceSet: resources
    };
  });
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
}

function buildBidApplication(bidRow: GovernmentBidDbRow): GovernmentBidApplication {
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

  const bidderSet: GovernmentBidder[] = contractors.map(c => ({
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

  return {
    secret: bidRow.secret,
    templateId: bidRow.template_id,
    maxContractorCount: bidRow.max_contractors,
    isPublic: Boolean(bidRow.is_public),
    minimumRequiredTierIndex: bidRow.min_tier_index,
    resourcePriceBreakdown: bidRow.price_breakdown_json || '{}',
    note: bidRow.note || '',
    governmentorderbidderSet: bidderSet
  };
}

export function getGovernmentBids(realmId: number): GovernmentBidApplication[] {
  ensureSeededProjects(realmId);
  let bids = db.prepare('SELECT * FROM government_bids WHERE realm_id = ? AND is_public = 1').all(realmId) as unknown as GovernmentBidDbRow[];
  if (bids.length === 0) {
    const orders = getGovernmentOrders(realmId);
    if (orders.length > 0) {
      createGovernmentBid(1, realmId, {
        templateId: orders[0].id,
        maxContractorCount: 5,
        isPublic: true,
        minimumRequiredTierIndex: 1,
        note: 'Seeking reliable subcontractors for municipal department order'
      });
      bids = db.prepare('SELECT * FROM government_bids WHERE realm_id = ? AND is_public = 1').all(realmId) as unknown as GovernmentBidDbRow[];
    }
  }
  return bids.map(buildBidApplication);
}

export function getGovernmentBidBySecret(secret: string): GovernmentBidApplication | null {
  const bid = db.prepare('SELECT * FROM government_bids WHERE secret = ?').get(secret) as GovernmentBidDbRow | undefined;
  if (!bid) return null;
  return buildBidApplication(bid);
}

export function createGovernmentBid(
  companyId: number,
  realmId: number,
  data: {
    templateId: number;
    maxContractorCount?: number;
    isPublic?: boolean;
    minimumRequiredTierIndex?: number;
    resourcePriceBreakdown?: Record<string, number> | string;
    note?: string;
  }
): GovernmentBidApplication {
  const secret = `bid-${crypto.randomBytes(6).toString('hex')}`;
  const now = new Date().toISOString();
  const tierInfo = getGovernmentTier(companyId);
  const priceBreakdown = typeof data.resourcePriceBreakdown === 'string'
    ? data.resourcePriceBreakdown
    : JSON.stringify(data.resourcePriceBreakdown || {});

  db.prepare(`
    INSERT INTO government_bids (secret, template_id, realm_id, creator_company_id, max_contractors, is_public, min_tier_index, price_breakdown_json, note, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    secret,
    data.templateId,
    realmId,
    companyId,
    data.maxContractorCount || 5,
    data.isPublic === false ? 0 : 1,
    data.minimumRequiredTierIndex || 1,
    priceBreakdown,
    data.note || '',
    now
  );

  // Add creator as main contractor
  db.prepare(`
    INSERT INTO government_bid_contractors (bid_secret, company_id, is_main, tier_index, tier_multiplier, deposit_paid, fulfilled, joined_at)
    VALUES (?, ?, 1, ?, ?, 0, 0, ?)
  `).run(secret, companyId, tierInfo.tier.tierIndex, tierInfo.tier.resourceMultiplicator, now);

  return getGovernmentBidBySecret(secret)!;
}

export function joinGovernmentBid(secret: string, companyId: number): GovernmentBidApplication | null {
  const bid = getGovernmentBidBySecret(secret);
  if (!bid) return null;
  if (bid.governmentorderbidderSet.some(b => b.companyId === companyId)) {
    return bid;
  }
  if (bid.governmentorderbidderSet.length >= bid.maxContractorCount) {
    return bid;
  }

  const tierInfo = getGovernmentTier(companyId);
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO government_bid_contractors (bid_secret, company_id, is_main, tier_index, tier_multiplier, deposit_paid, fulfilled, joined_at)
    VALUES (?, ?, 0, ?, ?, 0, 0, ?)
  `).run(secret, companyId, tierInfo.tier.tierIndex, tierInfo.tier.resourceMultiplicator, now);

  return getGovernmentBidBySecret(secret);
}

export function leaveOrRemoveContractor(secret: string, companyId: number, contractorId?: number): GovernmentBidApplication | null {
  if (contractorId) {
    db.prepare('DELETE FROM government_bid_contractors WHERE bid_secret = ? AND id = ?').run(secret, contractorId);
  } else {
    db.prepare('DELETE FROM government_bid_contractors WHERE bid_secret = ? AND company_id = ?').run(secret, companyId);
  }
  return getGovernmentBidBySecret(secret);
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

export function fulfillGovernmentOrder(secret: string, companyId: number, resourceKind?: number): boolean {
  const bid = getGovernmentBidBySecret(secret);
  if (!bid) return false;

  const orders = db.prepare('SELECT * FROM government_orders WHERE id = ?').get(bid.templateId) as { estimated_base_value: number } | undefined;
  if (!orders) return false;

  // Reward payout
  const reward = Math.round(orders.estimated_base_value * 0.35);
  updateCompanyMoney(companyId, reward);

  db.prepare('UPDATE government_bid_contractors SET fulfilled = 1 WHERE bid_secret = ? AND company_id = ?').run(secret, companyId);
  return true;
}
