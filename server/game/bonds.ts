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
  const rows = db.prepare(`
    SELECT * FROM bonds
    WHERE buyer_company_id = ? AND status = 'active'
    ORDER BY id DESC
  `).all(companyId) as unknown as BondRow[];

  return rows.map(formatBond);
}

export function getBondsSold(companyId: number) {
  const rows = db.prepare(`
    SELECT * FROM bonds
    WHERE seller_company_id = ? AND status = 'active'
    ORDER BY id DESC
  `).all(companyId) as unknown as BondRow[];

  return rows.map(formatBond);
}

function seedBondMarketListings() {
  const countRow = db.prepare(`
    SELECT COUNT(*) AS count FROM bonds
    WHERE buyer_company_id IS NULL AND status = 'active'
  `).get() as { count?: number } | undefined;
  if (Number(countRow?.count) > 0) return;

  const now = new Date().toISOString();
  const seedBonds = [
    { seller: 999901, amount: 50000, rate: 0.005 },
    { seller: 999902, amount: 100000, rate: 0.0055 },
    { seller: 999903, amount: 25000, rate: 0.0045 }
  ];
  const insert = db.prepare(`
    INSERT INTO bonds (seller_company_id, buyer_company_id, interest_rate, amount, status, created_at)
    VALUES (?, NULL, ?, ?, 'active', ?)
  `);
  for (const bond of seedBonds) {
    insert.run(bond.seller, bond.rate, bond.amount, now);
  }
}

seedBondMarketListings();

export function getBondMarketListings() {
  const rows = db.prepare(`
    SELECT * FROM bonds
    WHERE buyer_company_id IS NULL AND status = 'active'
    ORDER BY interest_rate DESC LIMIT 50
  `).all() as unknown as BondRow[];

  return rows.map(formatBond);
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
    // Each settlement keeps money and the bond status in one transaction.
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
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Bond amount must be greater than zero');
  }
  if (!Number.isFinite(interestRate) || interestRate < 0 || interestRate > 1) {
    throw new Error('Bond interest rate must be between 0 and 1');
  }

  const now = new Date().toISOString();
  const maturityDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  db.exec('BEGIN');
  try {
    const res = db.prepare(`
      INSERT INTO bonds (seller_company_id, buyer_company_id, interest_rate, amount, status, created_at, maturity_date)
      VALUES (?, NULL, ?, ?, 'active', ?, ?)
    `).run(sellerCompanyId, interestRate, amount, now, maturityDate);
    db.exec('COMMIT');

    const bondId = Number(res.lastInsertRowid);
    const row = db.prepare('SELECT * FROM bonds WHERE id = ?').get(bondId) as unknown as BondRow;
    return {
      bond: formatBond(row),
      // Issuing a bond creates a liability; it does not mint seller cash.
      money: comp.money,
      moneyDelta: 0
    };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function buyBonds(buyerCompanyId: number, bondId: number) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const bond = db.prepare('SELECT * FROM bonds WHERE id = ?').get(bondId) as unknown as BondRow | undefined;
    if (!bond || bond.status !== 'active' || bond.buyer_company_id !== null) {
      throw new Error('Bond is no longer available');
    }

    const buyer = getCompanyById(buyerCompanyId);
    if (!buyer || !Number.isFinite(Number(buyer.money)) || Number(buyer.money) < bond.amount) {
      throw new Error('Not enough money to buy bond');
    }

    const claimed = db.prepare(`
      UPDATE bonds SET buyer_company_id = ?
      WHERE id = ? AND status = 'active' AND buyer_company_id IS NULL
    `).run(buyerCompanyId, bondId);
    if (claimed.changes !== 1) {
      throw new Error('Bond is no longer available');
    }

    const newMoney = updateCompanyMoney(buyerCompanyId, -bond.amount);
    // Seeded NPC listings have no company ledger. Real issuers receive the
    // face value only when a buyer actually purchases the bond.
    if (bond.seller_company_id !== 999900 && getCompanyById(bond.seller_company_id)) {
      updateCompanyMoney(bond.seller_company_id, bond.amount);
    }
    db.exec('COMMIT');

    const updated = db.prepare('SELECT * FROM bonds WHERE id = ?').get(bondId) as unknown as BondRow;
    return {
      bond: formatBond(updated),
      money: newMoney,
      moneyDelta: -bond.amount
    };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function callBonds(sellerCompanyId: number, bondId: number) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const bond = db.prepare('SELECT * FROM bonds WHERE id = ?').get(bondId) as unknown as BondRow | undefined;
    if (!bond || bond.status !== 'active' || bond.seller_company_id !== sellerCompanyId) {
      throw new Error('Bond not found');
    }
    if (bond.maturity_date && bond.maturity_date <= new Date().toISOString()) {
      throw new Error('Bond has matured and can no longer be called early');
    }

    const seller = getCompanyById(sellerCompanyId);
    if (!seller) {
      throw new Error('Company not found');
    }

    let newSellerMoney = Number(seller.money) || 0;
    if (bond.buyer_company_id) {
      if (newSellerMoney < bond.amount) {
        throw new Error('Not enough money to call bond early');
      }
      newSellerMoney = updateCompanyMoney(sellerCompanyId, -bond.amount);
      updateCompanyMoney(bond.buyer_company_id, bond.amount);
    }
    const updated = db.prepare(`
      UPDATE bonds SET status = 'called'
      WHERE id = ? AND seller_company_id = ? AND status = 'active'
    `).run(bondId, sellerCompanyId);
    if (updated.changes !== 1) {
      throw new Error('Bond is no longer active');
    }
    db.exec('COMMIT');

    return {
      success: true,
      money: newSellerMoney,
      moneyDelta: -bond.amount
    };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
