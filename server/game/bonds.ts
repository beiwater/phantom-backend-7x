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

export function getBondMarketListings() {
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

export function issueBonds(sellerCompanyId: number, amount: number, interestRate: number = 0.005) {
  const comp = getCompanyById(sellerCompanyId);
  if (!comp) throw new Error('Company not found');

  const now = new Date().toISOString();
  // Seller receives cash immediately upon issuing
  const newMoney = updateCompanyMoney(sellerCompanyId, amount);

  const res = db.prepare(`
    INSERT INTO bonds (seller_company_id, buyer_company_id, interest_rate, amount, status, created_at)
    VALUES (?, NULL, ?, ?, 'active', ?)
  `).run(sellerCompanyId, interestRate, amount, now);

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
