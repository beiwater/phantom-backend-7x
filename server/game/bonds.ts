import { db } from '../db/database.ts';
import { updateCompanyMoney, getCompanyById } from './company.ts';

export interface BondRow {
  id: number;
  seller_company_id: number;
  buyer_company_id: number | null;
  interest_rate: number;
  amount: number;
  status: string;
  created_at: string;
  maturity_date: string | null;
  settled: number;
}

export function formatBond(b: BondRow) {
  const seller = getCompanyById(b.seller_company_id);
  const buyer = b.buyer_company_id ? getCompanyById(b.buyer_company_id) : null;

  return {
    id: b.id,
    seller: {
      id: b.seller_company_id,
      company: seller?.name || `Company #${b.seller_company_id}`,
      rating: seller?.rating || 'BBB',
      logo: seller?.logo || ''
    },
    buyer: buyer ? {
      id: buyer.company_id,
      company: buyer.name,
      logo: buyer.logo || ''
    } : null,
    interest: b.interest_rate,
    amount: b.amount,
    status: b.status,
    created: b.created_at,
    dailyInterest: Math.round(b.amount * b.interest_rate * 100) / 100
  };
}

export function getBondsOwned(companyId: number) {
  settleMaturedBonds();
  const rows = db.prepare(`
    SELECT * FROM bonds
    WHERE buyer_company_id = ? AND status = 'active'
    ORDER BY id DESC
  `).all(companyId) as unknown as BondRow[];

  return rows.map(formatBond);
}

export function getBondsSold(companyId: number) {
  settleMaturedBonds();
  const rows = db.prepare(`
    SELECT * FROM bonds
    WHERE seller_company_id = ? AND status = 'active'
    ORDER BY id DESC
  `).all(companyId) as unknown as BondRow[];

  return rows.map(formatBond);
}

export function getBondMarketListings() {
  settleMaturedBonds();
  const rows = db.prepare(`
    SELECT * FROM bonds
    WHERE buyer_company_id IS NULL AND status = 'active'
    ORDER BY interest_rate DESC LIMIT 50
  `).all() as unknown as BondRow[];

  if (rows.length === 0) {
    const now = new Date().toISOString();
    const seedBonds = [
      { seller: 999901, amount: 50000, rate: 0.005 },
      { seller: 999902, amount: 100000, rate: 0.0055 },
      { seller: 999903, amount: 25000, rate: 0.0045 }
    ];
    for (const sb of seedBonds) {
      db.prepare(`
        INSERT INTO bonds (seller_company_id, buyer_company_id, interest_rate, amount, status, created_at)
        VALUES (?, NULL, ?, ?, 'active', ?)
      `).run(sb.seller, sb.rate, sb.amount, now);
    }
  }

  const current = db.prepare(`
    SELECT * FROM bonds
    WHERE buyer_company_id IS NULL AND status = 'active'
    ORDER BY interest_rate DESC LIMIT 50
  `).all() as unknown as BondRow[];

  return current.map(formatBond);
}
export function settleMaturedBonds() {
  const now = new Date().toISOString();
  const due = db.prepare(`
    SELECT * FROM bonds
    WHERE status = 'active' AND buyer_company_id IS NOT NULL AND settled = 0
      AND maturity_date IS NOT NULL AND maturity_date <= ?
  `).all(now) as unknown as BondRow[];
  if (due.length === 0) return;

  for (const b of due) {
    // Lazy settlement on read; per-bond transaction keeps money + bond row consistent (issue #42)
    db.exec('BEGIN');
    try {
      const payout = Math.round(b.amount * (1 + b.interest_rate) * 100) / 100;
      const sellerRow = db.prepare('SELECT money FROM companies WHERE company_id = ?').get(b.seller_company_id) as { money: number } | undefined;
      const sellerMoney = Math.max(0, Number(sellerRow?.money) || 0);
      const paid = Math.min(sellerMoney, payout);
      const defaulted = sellerMoney < payout;

      if (paid > 0) updateCompanyMoney(b.seller_company_id, -paid);
      if (b.buyer_company_id) updateCompanyMoney(b.buyer_company_id, paid);
      db.prepare('UPDATE bonds SET settled = 1, status = ? WHERE id = ?').run(defaulted ? 'defaulted' : 'matured', b.id);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      console.error(`Failed to settle bond #${b.id}:`, err);
    }
  }
}

export function issueBonds(sellerCompanyId: number, amount: number, interestRate: number = 0.005) {
  const comp = getCompanyById(sellerCompanyId);
  if (!comp) throw new Error('Company not found');

  const now = new Date().toISOString();
  const maturityDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  // Seller receives cash immediately upon issuing — free money on issue is issue #23's problem, out of scope here
  const newMoney = updateCompanyMoney(sellerCompanyId, amount);

  const res = db.prepare(`
    INSERT INTO bonds (seller_company_id, buyer_company_id, interest_rate, amount, status, created_at, maturity_date)
    VALUES (?, NULL, ?, ?, 'active', ?, ?)
  `).run(sellerCompanyId, interestRate, amount, now, maturityDate);

  const bondId = Number(res.lastInsertRowid);
  const row = db.prepare('SELECT * FROM bonds WHERE id = ?').get(bondId) as unknown as BondRow;
  return {
    bond: formatBond(row),
    money: newMoney
  };
}

export function buyBonds(buyerCompanyId: number, bondId: number) {
  const b = db.prepare('SELECT * FROM bonds WHERE id = ?').get(bondId) as unknown as BondRow | undefined;
  if (!b || b.status !== 'active' || b.buyer_company_id !== null) {
    throw new Error('Bond is no longer available');
  }

  const buyer = getCompanyById(buyerCompanyId);
  if (!buyer || buyer.money < b.amount) {
    throw new Error('Not enough money to buy bond');
  }

  const newMoney = updateCompanyMoney(buyerCompanyId, -b.amount);
  db.prepare(`UPDATE bonds SET buyer_company_id = ? WHERE id = ?`).run(buyerCompanyId, bondId);

  const updated = db.prepare('SELECT * FROM bonds WHERE id = ?').get(bondId) as unknown as BondRow;
  return {
    bond: formatBond(updated),
    money: newMoney
  };
}

export function callBonds(sellerCompanyId: number, bondId: number) {
  const b = db.prepare('SELECT * FROM bonds WHERE id = ?').get(bondId) as unknown as BondRow | undefined;
  if (!b || b.status !== 'active' || b.seller_company_id !== sellerCompanyId) {
    throw new Error('Bond not found');
  }
  // Early call only before maturity; matured/defaulted bonds settle via settleMaturedBonds (issue #42)
  if (b.maturity_date && b.maturity_date <= new Date().toISOString()) {
    throw new Error('Bond has matured and can no longer be called early');
  }

  const seller = getCompanyById(sellerCompanyId);
  if (!seller || seller.money < b.amount) {
    throw new Error('Not enough money to call bond early');
  }

  // Deduct face value from seller, return to buyer if held
  const newSellerMoney = updateCompanyMoney(sellerCompanyId, -b.amount);
  if (b.buyer_company_id) {
    updateCompanyMoney(b.buyer_company_id, b.amount);
  }

  db.prepare(`UPDATE bonds SET status = 'called' WHERE id = ?`).run(bondId);

  return {
    success: true,
    money: newSellerMoney
  };
}
