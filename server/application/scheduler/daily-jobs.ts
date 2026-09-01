/**
 * Scheduler business jobs (Issue #105 Phase 8 / Issue #104 Stage 7).
 *
 * The scheduler (scheduler/timetable.ts) is a PURE trigger: it decides WHEN a
 * task runs. Every business mutation (bond interest, admin overhead,
 * executive salaries, government orders publish/award, economy phase roll,
 * retail saturation refresh) lives here as an Application job so the
 * scheduler contains no formulas, no SQL, and no money movement.
 */
import { db } from '../../db/database.ts';
import { runInTransaction } from '../../db/transaction.ts';
import { getCompanyById, updateCompanyMoney } from '../../game/company.ts';
import { recordCashLedger } from '../../game/cash-ledger.ts';
import { ensureSeededProjects } from '../../game/government.ts';
import { getAllResourceDefs } from '../../game-data/resources.ts';

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// --- Scheduled task implementations (00:00 UTC: bond interest + accounting overhead) ---

/**
 * Daily bond interest. Only bonds actually held by a buyer accrue interest
 * (open offers do not). Player-issued bonds deduct the interest from the
 * issuer; an issuer who cannot cover it defaults and the holder receives
 * whatever could still be paid (decompile formulas_bonds.md §7). System-seeded
 * bonds (issuer 999900, no company row) pay the yield to the holder directly.
 */
export function chargeDailyBondInterest(): void {
  const bonds = db.prepare(`
    SELECT id, seller_company_id, buyer_company_id, amount, interest_rate
    FROM bonds
    WHERE status = 'active' AND buyer_company_id IS NOT NULL
  `).all() as Array<{
    id: number; seller_company_id: number | null; buyer_company_id: number;
    amount: number; interest_rate: number;
  }>;

  for (const bond of bonds) {
    const interest = round2(Number(bond.amount) * Number(bond.interest_rate));
    if (!(interest > 0)) continue;

    const holderId = Number(bond.buyer_company_id);
    const holder = getCompanyById(holderId);
    if (!holder) continue;

    const issuerId = bond.seller_company_id === null ? null : Number(bond.seller_company_id);
    const issuer = issuerId !== null ? getCompanyById(issuerId) : null;

    if (issuer) {
      const funds = Number(issuer.money) || 0;
      const paid = round2(Math.max(0, Math.min(funds, interest)));
      if (paid > 0) {
        recordCashLedger({
          companyId: issuerId as number,
          amount: -paid,
          category: 'i',
          description: 'Bond interest payment',
          descriptionKey: 'bondInterestPayment',
          details: { bondId: bond.id }
        });
        updateCompanyMoney(issuerId as number, -paid, true);
        recordCashLedger({
          companyId: holderId,
          amount: paid,
          category: 'i',
          description: 'Bond interest collected',
          descriptionKey: 'bondInterestCollected',
          details: { bondId: bond.id }
        });
        updateCompanyMoney(holderId, paid, true);
      }
      if (paid < interest) {
        db.prepare(`UPDATE bonds SET status = 'defaulted' WHERE id = ?`).run(bond.id);
      }
    } else {
      recordCashLedger({
        companyId: holderId,
        amount: interest,
        category: 'i',
        description: 'Bond interest collected',
        descriptionKey: 'bondInterestCollected',
        details: { bondId: bond.id }
      });
      updateCompanyMoney(holderId, interest, true);
    }
  }
}

/**
 * Daily accounting overhead charge. Follows the server's linear overhead model
 * (finance-routes: AO = 1 + (buildingCount − 1) × 0.035) combined with the
 * decompiled per-building cost `size × 100 × (AO − 1)` and the COO reduction
 * `ph(AO, cooSkill) = AO − (AO − 1) × cooSkill / 100` (formulas_admin.md).
 * Booked to cash ledger category 'a' (accounting).
 */
export function chargeDailyAccountingOverhead(): void {
  const companies = db.prepare('SELECT company_id, money FROM companies').all() as Array<{
    company_id: number; money: number;
  }>;
  for (const comp of companies) {
    const companyId = Number(comp.company_id);
    const stats = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM buildings WHERE company_id = ?) AS building_count,
        (SELECT COALESCE(SUM(size), 0) FROM buildings WHERE company_id = ?) AS total_size,
        (SELECT COALESCE(MAX(COALESCE(skill_accounting, 0)), 0) FROM executives
           WHERE company_id = ? AND status = 'employed' AND position = 'coo') AS coo_skill
    `).get(companyId, companyId, companyId) as { building_count: number; total_size: number; coo_skill: number };

    const buildingCount = Number(stats.building_count) || 0;
    if (buildingCount === 0) continue;

    const ao = 1 + Math.max(0, buildingCount - 1) * 0.035;
    const cooSkill = Math.max(0, Math.min(100, Number(stats.coo_skill) || 0));
    const effective = ao - (ao - 1) * cooSkill / 100;
    const charge = round2((Number(stats.total_size) || 0) * 100 * (effective - 1));
    if (!(charge > 0)) continue;

    const funds = Number(comp.money) || 0;
    const paid = round2(Math.max(0, Math.min(funds, charge)));
    if (!(paid > 0)) continue;

    recordCashLedger({
      companyId,
      amount: -paid,
      category: 'a',
      description: 'Daily accounting overhead',
      descriptionKey: 'accountingOverhead'
    });
    updateCompanyMoney(companyId, -paid, true);
  }
}

// --- 04:00 UTC: executive salaries ---

/**
 * Daily executive salary debit (category 'e'). Companies that cannot cover the
 * full payroll pay what they have — the same "pay what you can" convention the
 * daily loan accrual already uses (loans.ts).
 */
export function debitExecutiveSalaries(): void {
  const rows = db.prepare(`
    SELECT c.company_id AS company_id, c.money AS money,
           COALESCE((SELECT SUM(e.salary) FROM executives e
                     WHERE e.company_id = c.company_id AND e.status = 'employed'), 0) AS salaries
    FROM companies c
  `).all() as Array<{ company_id: number; money: number; salaries: number }>;

  for (const row of rows) {
    const total = round2(Number(row.salaries) || 0);
    if (!(total > 0)) continue;
    const companyId = Number(row.company_id);
    const funds = Number(row.money) || 0;
    const paid = round2(Math.max(0, Math.min(funds, total)));
    if (!(paid > 0)) continue;

    recordCashLedger({
      companyId,
      amount: -paid,
      category: 'e',
      description: 'Executive daily salaries',
      descriptionKey: 'executiveSalaries'
    });
    updateCompanyMoney(companyId, -paid, true);
  }
}

// --- 13:00 UTC Wednesday: Government Orders publication ---

/**
 * Weekly Government Orders publication: makes sure every realm has the standard
 * project pool and republishes any order whose bidding deadline already passed
 * with a fresh window starting at this occurrence.
 */
export function publishGovernmentOrders(occurrence: Date): void {
  const realmRows = db.prepare('SELECT DISTINCT realm_id FROM government_orders').all() as Array<{ realm_id: number }>;
  const realms = realmRows.length > 0 ? realmRows.map(r => Number(r.realm_id)) : [0];
  for (const realmId of realms) {
    ensureSeededProjects(realmId);
  }

  const occIso = occurrence.toISOString();
  const stale = db.prepare(`
    SELECT id, days_to_fulfill FROM government_orders
    WHERE deadline IS NULL OR deadline < ?
  `).all(occIso) as Array<{ id: number; days_to_fulfill: number }>;
  for (const order of stale) {
    const days = Math.max(1, Number(order.days_to_fulfill) || 7);
    const deadline = new Date(occurrence.getTime() + days * DAY_MS).toISOString();
    db.prepare('UPDATE government_orders SET start_date = ?, deadline = ? WHERE id = ?')
      .run(occIso, deadline, order.id);
  }
}

// --- 13:00 UTC Monday: Government Orders award fulfillment ---

export function bidTotalValue(
  bid: { price_breakdown_json: string | null },
  template: { required_resources_json: string; unit_compensation_price: number }
): number {
  let prices: Record<string, number> = {};
  try {
    prices = JSON.parse(bid.price_breakdown_json || '{}') || {};
  } catch {
    prices = {};
  }
  let required: Array<Record<string, unknown>> = [];
  try {
    required = JSON.parse(template.required_resources_json || '[]') || [];
  } catch {
    required = [];
  }
  let total = 0;
  for (const entry of required) {
    const amount = Number(entry.targetAmount ?? entry.amountBase ?? entry.amount) || 0;
    const kind = String(entry.kind);
    const price = prices[kind] !== undefined
      ? Number(prices[kind])
      : Number(template.unit_compensation_price) || 0;
    total += amount * price;
  }
  return total;
}

/**
 * Award fulfillment: for every order whose bidding deadline has passed and
 * which still has OPEN bids, the lowest total bid wins (formulas_government.md
 * "Lowest Bid Wins"). The winner is marked AWARDED and the template receives
 * its resourceMultiplierAwarded; losing bids are REJECTED and their security
 * deposits refunded (same refund behaviour as deleteGovernmentBid).
 */
export function awardGovernmentBids(occurrence: Date): void {
  const templates = db.prepare(`
    SELECT id, required_resources_json, unit_compensation_price
    FROM government_orders
    WHERE deadline IS NOT NULL AND deadline <= ? AND resource_multiplier_awarded IS NULL
  `).all(occurrence.toISOString()) as Array<{
    id: number; required_resources_json: string; unit_compensation_price: number;
  }>;

  for (const template of templates) {
    const openBids = db.prepare(`
      SELECT id, secret, price_breakdown_json FROM government_bids
      WHERE template_id = ? AND status = 'OPEN'
    `).all(template.id) as Array<{ id: number; secret: string; price_breakdown_json: string | null }>;
    if (openBids.length === 0) continue;

    let winner = openBids[0];
    let winnerValue = bidTotalValue(winner, template);
    for (const bid of openBids.slice(1)) {
      const value = bidTotalValue(bid, template);
      if (value < winnerValue) {
        winner = bid;
        winnerValue = value;
      }
    }

    for (const bid of openBids) {
      if (bid.id === winner.id) {
        db.prepare(`UPDATE government_bids SET status = 'AWARDED' WHERE id = ?`).run(bid.id);
        continue;
      }
      db.prepare(`UPDATE government_bids SET status = 'REJECTED' WHERE id = ?`).run(bid.id);
      const contractors = db.prepare(`
        SELECT company_id, deposit_paid FROM government_bid_contractors
        WHERE bid_secret = ? AND deposit_paid > 0
      `).all(bid.secret) as Array<{ company_id: number; deposit_paid: number }>;
      for (const contractor of contractors) {
        const companyId = Number(contractor.company_id);
        if (getCompanyById(companyId)) {
          updateCompanyMoney(companyId, Number(contractor.deposit_paid) || 0);
        }
        db.prepare('UPDATE government_bid_contractors SET deposit_paid = 0 WHERE bid_secret = ? AND company_id = ?')
          .run(bid.secret, contractor.company_id);
      }
    }

    const mainContractor = db.prepare(`
      SELECT tier_multiplier FROM government_bid_contractors
      WHERE bid_secret = ? AND is_main = 1
    `).get(winner.secret) as { tier_multiplier: number } | undefined;
    const multiplier = Number(mainContractor?.tier_multiplier) || 1;
    db.prepare('UPDATE government_orders SET resource_multiplier_awarded = ? WHERE id = ?')
      .run(multiplier, template.id);
  }
}

// --- 15:00 UTC Friday: economy phase roll ---

export const ECONOMY_STATE_NAMES: Record<number, string> = {
  0: 'Recession',
  1: 'Normal',
  2: 'Boom'
};

/** Markov-style transition weights per current state (decompile economy_model.json). */
const ECONOMY_TRANSITIONS: Record<number, Array<readonly [number, number]>> = {
  0: [[1, 0.5], [0, 0.25], [2, 0.25]],
  1: [[1, 0.6], [2, 0.2], [0, 0.2]],
  2: [[1, 0.5], [2, 0.25], [0, 0.25]]
};

export function getEconomyPhase(realmId: number = 0): {
  realmId: number; state: number; stateName: string; updatedAt: string | null;
} {
  const row = db.prepare('SELECT state, updated_at FROM economy_state WHERE realm_id = ?')
    .get(realmId) as { state: number; updated_at: string } | undefined;
  const state = row ? Number(row.state) : 1;
  return {
    realmId,
    state,
    stateName: ECONOMY_STATE_NAMES[state] ?? 'Normal',
    updatedAt: row?.updated_at ?? null
  };
}

export function setEconomyPhase(realmId: number, state: number, updatedAt: Date = new Date()): void {
  db.prepare(`
    INSERT INTO economy_state (realm_id, state, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(realm_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at
  `).run(realmId, state, updatedAt.toISOString());
}

export function rollEconomyPhase(occurrence: Date): void {
  const current = getEconomyPhase(0).state;
  const table = ECONOMY_TRANSITIONS[current] ?? ECONOMY_TRANSITIONS[1];
  let roll = Math.random();
  let next = table[table.length - 1][0];
  for (const [state, probability] of table) {
    if (roll < probability) {
      next = state;
      break;
    }
    roll -= probability;
  }
  setEconomyPhase(0, next, occurrence);
}

// --- 23:30 UTC: retail saturation recalculation ---

/** Same LCG family as encyclopedia.ts seededRandom so saturation values stay consistent. */
export function seededRandom(seed: number): () => number {
  let s = Math.abs(Math.floor(seed)) % 2147483647;
  if (s === 0) s = 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

/** Deterministic per (resource kind, UTC date): stable across restarts, changes daily. */
export function computeDailySaturation(kind: number, dateKey: string): number {
  const dayNumber = Number(dateKey.replaceAll('-', '')) || 0;
  const rng = seededRandom(kind * 100000 + dayNumber);
  return round2(0.35 + rng() * 0.4);
}

/** Persisted daily saturation; falls back to the deterministic computation when absent. */
export function getRetailSaturation(dateKey: string, kind: number): number {
  const row = db.prepare('SELECT saturation FROM retail_saturation WHERE date = ? AND kind = ?')
    .get(dateKey, kind) as { saturation: number } | undefined;
  return row ? Number(row.saturation) : computeDailySaturation(kind, dateKey);
}

export function recalculateRetailSaturation(occurrence: Date): void {
  const dateKey = occurrence.toISOString().slice(0, 10);
  const occIso = occurrence.toISOString();
  for (const [kindStr, def] of Object.entries(getAllResourceDefs())) {
    if (!(Number(def.unitsSoldAnHour) > 0)) continue;
    const kind = Number(kindStr);
    const saturation = computeDailySaturation(kind, dateKey);
    db.prepare(`
      INSERT INTO retail_saturation (date, kind, saturation, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(date, kind) DO UPDATE SET saturation = excluded.saturation, updated_at = excluded.updated_at
    `).run(dateKey, kind, saturation, occIso);
  }
}

