import crypto from 'node:crypto';
import { virtualClock } from '../core/virtual-clock.ts';
import { db } from '../db/database.ts';
import { getCompanyById, updateCompanyMoney } from './company.ts';
import { consumeResourceExactWithTransactions, getWarehouseItemExact } from './warehouse.ts';
import { governmentOrdersRepository } from '../repositories/government-orders-repository.ts';
import { getResourceName } from '../game-data/resources.ts';


export interface GovernmentRequiredResource {
  id: number;
  kind: number;
  name: string;
  quality: number;
  amountBase: number;
  amount?: number;
  targetAmount?: number;
  unitCompensationPrice?: number;
  unitPrice?: number;
}
export interface GovernmentOrderTemplate {
  id: number;
  realm: number;
  realmId?: number;
  projectKey: string;
  name: string;
  projectName: string;
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
  computedResourcesNeeded?: Record<string, { kind: number; name: string; amount: number; quality: number }>;
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


export function ensureSeededProjects(realmId: number = 0): void {
  governmentOrdersRepository.ensureSeededProjects(realmId);
}
function mapGovernmentResources(resources: GovernmentRequiredResource[]): GovernmentRequiredResource[] {
  return resources.map(resource => ({
    ...resource,
    name: getResourceName(resource.kind),
    amount: resource.targetAmount ?? resource.amountBase
  }));
}

function governmentProjectName(projectKey: string): string {
  return governmentOrdersRepository.projectDefinition(projectKey)?.name || projectKey;
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

type GovernmentOrderDbRow = {
  id: number;
  realm_id: number;
  project_key: string;
  agency: string;
  estimated_base_value: number;
  days_to_fulfill: number;
  resource_multiplier_awarded: number | null;
  required_resources_json: string | null;
  unit_compensation_price?: number;
  start_date?: string | null;
  deadline?: string | null;
  created_at: string | null;
};

function mapGovernmentOrderRow(row: GovernmentOrderDbRow): GovernmentOrderTemplate {
  let resources: GovernmentRequiredResource[] = [];
  try {
    resources = JSON.parse(row.required_resources_json || '[]') as GovernmentRequiredResource[];
  } catch {
    resources = [];
  }
  const created = row.created_at || virtualClock.nowIso();
  const startDate = row.start_date || created;
  const daysToFulfill = Number(row.days_to_fulfill) || 0;
  const deadline = row.deadline || new Date(
    Date.parse(startDate) + daysToFulfill * 24 * 60 * 60 * 1000
  ).toISOString();
  const name = governmentProjectName(row.project_key);
  return {
    id: row.id,
    realm: row.realm_id,
    realmId: row.realm_id,
    projectKey: row.project_key,
    name,
    projectName: name,
    agency: row.agency,
    estimatedBaseValue: row.estimated_base_value,
    daysToFulfill,
    resourceMultiplierAwarded: row.resource_multiplier_awarded,
    created,
    startDate,
    deadline,
    unitCompensationPrice: row.unit_compensation_price || 0,
    governmentorderrequiredresourceSet: mapGovernmentResources(resources)
  };
}

export function getGovernmentOrders(realmId: number = 0): GovernmentOrderTemplate[] {
  ensureSeededProjects(realmId);
  const rows = db.prepare('SELECT * FROM government_orders WHERE realm_id = ? ORDER BY id ASC').all(realmId) as GovernmentOrderDbRow[];
  return rows.map(mapGovernmentOrderRow);
}

export function getGovernmentOrderById(id: number): GovernmentOrderTemplate | null {
  const row = db.prepare('SELECT * FROM government_orders WHERE id = ?').get(id) as GovernmentOrderDbRow | undefined;
  return row ? mapGovernmentOrderRow(row) : null;
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
  const sorted = [...contractors].sort((a, b) => a.tier_multiplier - b.tier_multiplier);
  const highestMultiplier = sorted.length > 0 ? Math.max(...sorted.map(c => c.tier_multiplier)) : 1.0;

  let sumMultipliers = 0;
  for (const c of sorted) {
    sumMultipliers += c.tier_multiplier;
  }
  const unfilledSlots = Math.max(0, totalSlots - sorted.length);
  sumMultipliers += unfilledSlots * highestMultiplier;
  if (sumMultipliers <= 0) sumMultipliers = 1.0;

  return sorted.map(c => {
    const share = Math.round((c.tier_multiplier / sumMultipliers) * 10000) / 10000;
    const computedResources: Record<string, { kind: number; name: string; amount: number; quality: number }> = {};

    for (const res of template.governmentorderrequiredresourceSet) {
      const computedMultiplicator = (c.tier_multiplier / sumMultipliers) * totalSlots;
      const amount = Math.max(1, Math.ceil(res.amountBase * computedMultiplicator));
      computedResources[String(res.kind)] = {
        kind: res.kind,
        name: getResourceName(res.kind),
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
  if (!template || template.realm !== realmId) {
    throw new Error('Government order project template not found in this realm');
  }

  // Validate deadline
  if (template.deadline && virtualClock.nowMs() > Date.parse(template.deadline)) {
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
  const now = virtualClock.nowIso();
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
    const now = virtualClock.nowIso();
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
  const now = virtualClock.nowIso();
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
  if (template.deadline && virtualClock.nowMs() > Date.parse(template.deadline)) {
    throw new Error('Project fulfillment deadline has passed');
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
      lastTransactionId: virtualClock.nowMs(),
      application: updatedBid
    };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
