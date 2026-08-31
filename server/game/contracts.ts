import { db } from '../db/database.ts';
import { consumeResourceExactWithTransactions, addResource, getWarehouseItemExact } from './warehouse.ts';
import { updateCompanyMoney, getCompanyById } from './company.ts';
import { getResourceDef } from './constants.ts';

export interface ContractRow {
  id: number;
  sender_company_id: number;
  recipient_company_id: number;
  kind: number;
  quality: number;
  amount: number;
  price: number;
  status: string;
  created_at: string;
}

export function formatContract(c: ContractRow) {
  const sender = getCompanyById(c.sender_company_id);
  const recipient = getCompanyById(c.recipient_company_id);
  const resDef = getResourceDef(c.kind);

  return {
    id: c.id,
    kind: c.kind,
    quality: c.quality,
    amount: c.amount,
    price: c.price,
    total: Math.round(c.amount * c.price * 100) / 100,
    created: c.created_at,
    status: c.status,
    sender: {
      id: c.sender_company_id,
      company: sender?.name || `Company #${c.sender_company_id}`,
      logo: sender?.logo || ''
    },
    recipient: {
      id: c.recipient_company_id,
      company: recipient?.name || `Company #${c.recipient_company_id}`,
      logo: recipient?.logo || ''
    },
    resource: resDef ? {
      name: `Resource #${c.kind}`,
      image: resDef.image
    } : null
  };
}

export function getIncomingContracts(companyId: number) {
  const rows = db.prepare(`
    SELECT * FROM contracts
    WHERE recipient_company_id = ? AND status = 'pending'
    ORDER BY id DESC
  `).all(companyId) as unknown as ContractRow[];

  return {
    incomingContracts: rows.map(formatContract),
    incomingContractsOtherRealms: []
  };
}

export function getOutgoingContracts(companyId: number) {
  const rows = db.prepare(`
    SELECT * FROM contracts
    WHERE sender_company_id = ? AND status = 'pending'
    ORDER BY id DESC
  `).all(companyId) as unknown as ContractRow[];

  return rows.map(formatContract);
}

export function sendContract(
  senderCompanyId: number,
  recipientCompanyId: number,
  kind: number,
  quality: number,
  amount: number,
  price: number
) {
  if (senderCompanyId === recipientCompanyId) {
    throw new Error('Cannot send contract to yourself');
  }
  if (!getCompanyById(recipientCompanyId)) {
    throw new Error('Recipient company not found');
  }
  if (!Number.isSafeInteger(kind) || kind <= 0 || !Number.isInteger(quality) || quality < 0 || quality > 12 ||
      !Number.isFinite(amount) || amount <= 0 || !Number.isFinite(price) || price < 0) {
    throw new Error('Invalid contract terms');
  }

  const stock = getWarehouseItemExact(senderCompanyId, kind, quality);
  if (!stock || stock.amount < amount) {
    throw new Error('Not enough resources in warehouse to send contract');
  }

  db.exec('BEGIN');
  try {
    const consumed = consumeResourceExactWithTransactions(senderCompanyId, kind, quality, amount);
    if (!consumed) {
      throw new Error('Not enough resources in warehouse to send contract');
    }

    const now = new Date().toISOString();
    const res = db.prepare(`
      INSERT INTO contracts (sender_company_id, recipient_company_id, kind, quality, amount, price, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
    `).run(senderCompanyId, recipientCompanyId, kind, quality, amount, price, now);

    db.exec('COMMIT');
    const contractId = Number(res.lastInsertRowid);
    const row = db.prepare('SELECT * FROM contracts WHERE id = ?').get(contractId) as unknown as ContractRow;
    return formatContract(row);
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function acceptContract(buyerCompanyId: number, contractId: number) {
  const c = db.prepare('SELECT * FROM contracts WHERE id = ?').get(contractId) as unknown as ContractRow | undefined;
  if (!c || c.status !== 'pending') {
    throw new Error('Contract is no longer available');
  }
  if (c.recipient_company_id !== buyerCompanyId) {
    throw new Error('Unauthorized to accept this contract');
  }

  const totalCost = Math.round(c.amount * c.price * 100) / 100;
  const buyer = getCompanyById(buyerCompanyId);
  if (!buyer || buyer.money < totalCost) {
    throw new Error('Not enough money to accept contract');
  }

  db.exec('BEGIN');
  try {
    const accepted = db.prepare(`
      UPDATE contracts SET status = 'accepted'
      WHERE id = ? AND recipient_company_id = ? AND status = 'pending'
    `).run(contractId, buyerCompanyId);
    if (accepted.changes !== 1) {
      throw new Error('Contract is no longer available');
    }

    const newBuyerMoney = updateCompanyMoney(buyerCompanyId, -totalCost);
    updateCompanyMoney(c.sender_company_id, totalCost);
    addResource(buyerCompanyId, c.kind, c.quality, c.amount, { market: c.price });
    db.exec('COMMIT');

    return {
      success: true,
      money: newBuyerMoney,
      moneyDelta: -totalCost,
      resource: {
        kind: c.kind,
        quality: c.quality,
        amount: c.amount
      }
    };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function rejectContract(companyId: number, contractId: number) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const c = db.prepare('SELECT * FROM contracts WHERE id = ?').get(contractId) as unknown as ContractRow | undefined;
    if (!c || c.status !== 'pending') {
      throw new Error('Contract not found');
    }
    if (c.recipient_company_id !== companyId && c.sender_company_id !== companyId) {
      throw new Error('Unauthorized');
    }

    const rejected = db.prepare(`
      UPDATE contracts SET status = 'rejected'
      WHERE id = ? AND status = 'pending'
    `).run(contractId);
    if (rejected.changes !== 1) {
      throw new Error('Contract is no longer available');
    }
    addResource(c.sender_company_id, c.kind, c.quality, c.amount);
    db.exec('COMMIT');
    return { success: true };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function cancelContract(senderCompanyId: number, contractId: number) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const c = db.prepare('SELECT * FROM contracts WHERE id = ?').get(contractId) as unknown as ContractRow | undefined;
    if (!c || c.status !== 'pending' || c.sender_company_id !== senderCompanyId) {
      throw new Error('Contract not found');
    }

    const cancelled = db.prepare(`
      UPDATE contracts SET status = 'cancelled'
      WHERE id = ? AND sender_company_id = ? AND status = 'pending'
    `).run(contractId, senderCompanyId);
    if (cancelled.changes !== 1) {
      throw new Error('Contract is no longer available');
    }
    addResource(senderCompanyId, c.kind, c.quality, c.amount);
    db.exec('COMMIT');
    return { success: true };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
