import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson, readJsonBody } from './utils.ts';
import { db } from '../db/database.ts';
import { getCompanyById } from '../game/company.ts';
import { takeLoan, repayLoan, getActiveLoans } from '../game/loans.ts';
import {
  getRecentCashLedger,
  readStatementWindow,
  getDailyFinanceSnapshots,
  formatSnapshotDate,
  sumPositive,
  sumNegative
} from '../game/cash-ledger.ts';

function inventoryValue(companyId: number): number {
  const row = db.prepare(
    'SELECT COALESCE(SUM(amount * cost_market), 0) AS total FROM warehouse WHERE company_id = ?'
  ).get(companyId) as { total: number | null };
  return Number(row?.total) || 0;
}

function buildingsValue(companyId: number): number {
  const row = db.prepare(
    'SELECT COALESCE(SUM(cost), 0) AS total FROM buildings WHERE company_id = ?'
  ).get(companyId) as { total: number | null };
  return Number(row?.total) || 0;
}

function bondsHeldValue(companyId: number): number {
  const row = db.prepare(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM bonds WHERE buyer_company_id = ? AND status = 'active'`
  ).get(companyId) as { total: number | null };
  return Number(row?.total) || 0;
}

function loansOutstanding(companyId: number): number {
  const row = db.prepare(
    `SELECT COALESCE(SUM(remaining), 0) AS total FROM loans WHERE company_id = ? AND status = 'active'`
  ).get(companyId) as { total: number | null };
  return Number(row?.total) || 0;
}

function safeParseDetails(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function employeeCount(companyId: number): number {
  const row = db.prepare(
    `SELECT COALESCE(SUM(size), 0) AS total FROM buildings WHERE company_id = ?`
  ).get(companyId) as { total: number | null };
  const bldCount = Number(row?.total) || 0;
  return Math.floor(bldCount * 100 * (1 + (bldCount - 1) / 170)) || 0;
}

export async function handleFinanceRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  currentCompanyId: number | null
): Promise<boolean> {
  const requestedCompanyMatch = pathname.match(/\/companies\/(\d+|me)\//);
  const authorizeRequestedCompany = (): number | null => {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return null;
    }
    if (requestedCompanyMatch && requestedCompanyMatch[1] !== 'me' && Number(requestedCompanyMatch[1]) !== currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return null;
    }
    return currentCompanyId;
  };

  // 1. Custom Reports (FPA): /api/v2/fpa/custom-reports/
  if (pathname === '/api/v2/fpa/custom-reports/') {
    if (!authorizeRequestedCompany()) return true;
    sendJson(res, {
      reports: [],
      categories: ['Production', 'Retail', 'Financial', 'Warehouse', 'Market'],
      canCreate: true
    });
    return true;
  }

  // 2. Administration Overhead: /api/v2/companies/:id/administration-overhead/
  const adminOverheadMatch = pathname.match(/^\/api\/v2\/companies\/(\d+|me)\/administration-overhead\/$/);
  if (adminOverheadMatch) {
    const companyId = authorizeRequestedCompany();
    if (companyId === null) return true;
    const bldRow = db.prepare('SELECT COUNT(*) AS count FROM buildings WHERE company_id = ?').get(companyId) as { count?: number } | undefined;
    const bldCount = Number(bldRow?.count) || 0;
    const overhead = Math.max(0, (bldCount - 1) * 0.035);
    sendJson(res, {
      administrationOverhead: overhead,
      recreationBonus: 0,
      workers: bldCount * 100,
      adminCostDaily: Math.round(overhead * 1000)
    });
    return true;
  }

  const loanTakeMatch = pathname.match(/^\/api\/v2\/companies\/(\d+|me)\/loans\/$/);
  const loanRepayMatch = pathname.match(/^\/api\/v2\/companies\/(\d+|me)\/loans\/(\d+)\/repay\/$/);
  const loanListMatch = pathname.match(/^\/api\/v2\/companies\/(\d+|me)\/loans\/$/);

  if (loanTakeMatch && method === 'POST') {
    const companyId = authorizeRequestedCompany();
    if (companyId === null) return true;
    const body = await readJsonBody<{ amount: number }>(req);
    try {
      sendJson(res, takeLoan(companyId, Number(body.amount)));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: msg }, 400);
    }
    return true;
  }

  if (loanRepayMatch && method === 'POST') {
    const companyId = authorizeRequestedCompany();
    if (companyId === null) return true;
    const body = await readJsonBody<{ amount: number }>(req);
    try {
      sendJson(res, repayLoan(companyId, Number(loanRepayMatch[2]), Number(body.amount)));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: msg }, 400);
    }
    return true;
  }
  if (loanListMatch && method === 'GET') {
    const companyId = authorizeRequestedCompany();
    if (companyId === null) return true;
    sendJson(res, getActiveLoans(companyId));
    return true;
  }

  // 6. Balance Sheet — official camelCase schema (HAR-verified).
  if (pathname.startsWith('/api/') && pathname.includes('/balance-sheet/')) {
    const companyId = authorizeRequestedCompany();
    if (companyId === null) return true;
    const comp = getCompanyById(companyId);
    const money = comp ? round2(Number(comp.money) || 0) : 0;
    const inventory = round2(inventoryValue(companyId));
    const buildings = round2(buildingsValue(companyId));
    const bondsHeld = round2(bondsHeldValue(companyId));
    const liabilities = round2(loansOutstanding(companyId));
    const date = new Date().toISOString().replace('Z', '+00:00');
    sendJson(res, {
      date,
      cash: money,
      cashReservedForOrders: 0,
      accountsReceivable: 0,
      workInProcess: 0,
      materials: inventory,
      research: 0,
      finishedGoods: inventory,
      investmentInBonds: bondsHeld,
      buildings,
      constructionInProgress: 0,
      patents: 0,
      bondsPayable: liabilities,
      contributedCapital: 100000,
      retainedEarnings: round2(Math.max(0, money + inventory + buildings + bondsHeld - liabilities - 100000)),
      valuationAllowance: 0,
      deposits: 0,
      employees: employeeCount(companyId)
    });
    return true;
  }

  // 7. Income Statement — computed from the cash ledger journal (last 24h).
  // Real amounts come from persisted ledger entries; unavailable components are 0.
  if (pathname.startsWith('/api/') && pathname.includes('/income-statement/')) {
    const companyId = authorizeRequestedCompany();
    if (companyId === null) return true;
    const w = readStatementWindow(companyId);
    const byCat = w.aggregate.byCategory;
    const cat = (c: string): number => Math.round((byCat[c] || 0) * 100) / 100;
    const sales = cat('s') > 0 ? cat('s') : 0;
    // Expenses are negative per the official API.
    const payload = {
      date: w.date,
      dateFrom: w.dateFrom,
      sales,
      cogs: Math.min(0, cat('p') + cat('o')),
      freightOut: 0,
      constructionCosts: Math.min(0, cat('c')),
      marketFees: Math.min(0, cat('f') + cat('q')),
      salariesCosts: Math.min(0, cat('e') + cat('o') + cat('t')),
      trainingCosts: Math.min(0, cat('h')),
      poachingCosts: Math.min(0, cat('j')),
      gameIncome: cat('g') > 0 ? cat('g') : 0,
      executiveRoyalties: Math.max(0, cat('e')),
      gainOnSale: Math.max(0, cat('u')),
      patentConversion: 0,
      bondDefaults: 0,
      bondWriteoffs: 0,
      accountingOverhead: Math.min(0, cat('a')),
      bondInterestExpense: 0,
      bondInterestIncome: Math.max(0, cat('i') + cat('n') + cat('b')),
      donations: 0,
      otherComprehensiveIncome: 0,
      netIncome: 0,
      economicValueAdded: 0,
      cashAllExpenses: sumNegative(w.rows),
      isComputed: true
    };
    // netIncome = sum of all components (exactly what the client recomputes).
    const components = payload.sales + payload.cogs + payload.freightOut
      + payload.constructionCosts + payload.marketFees + payload.salariesCosts
      + payload.trainingCosts + payload.poachingCosts + payload.gameIncome
      + payload.executiveRoyalties + payload.gainOnSale + payload.patentConversion
      + payload.accountingOverhead + payload.bondInterestExpense
      + payload.bondInterestIncome + payload.bondDefaults + payload.bondWriteoffs
      + payload.donations;
    payload.netIncome = Math.round(components * 100) / 100;
    // EVA: net income minus 1.5% capital charge on non-cash assets (official rate 0.0015).
    payload.economicValueAdded = Math.round((payload.netIncome - 0.0015 * (buildingsValue(companyId) + inventoryValue(companyId))) * 100) / 100;
    sendJson(res, payload);
    return true;
  }

  // 8. Cashflow Statement + Recent Cashflow — from the cash ledger journal.
  const cashflowRecentMatch = pathname.match(/^\/api\/v2\/companies\/(\d+|me)\/cashflow\/(recent|all)\//);
  if (cashflowRecentMatch) {
    const companyId = authorizeRequestedCompany();
    if (companyId === null) return true;
    const entries = getRecentCashLedger(companyId, 30);
    const comp = getCompanyById(companyId);
    const data = entries.map(e => ({
      id: e.id,
      datetime: e.created_at,
      money: Math.round((Number(e.amount) || 0) * 100) / 100,
      category: e.category,
      description: e.description,
      descriptionKey: e.description_key,
      details: safeParseDetails(e.details)
    }));
    sendJson(res, {
      data,
      oldestPulled: false,
      money: comp ? Math.round((Number(comp.money) || 0) * 100) / 100 : 0
    });
    return true;
  }

  if (pathname.startsWith('/api/') && pathname.includes('/cashflow-statement/')) {
    const companyId = authorizeRequestedCompany();
    if (companyId === null) return true;
    const w = readStatementWindow(companyId);
    const byCat = w.aggregate.byCategory;
    const pos = (c: string): number => Math.round((byCat[c] || 0) * 100) / 100;
    const fromRetail = Math.max(0, pos('s'));
    const fromExchange = Math.max(0, pos('u'));
    const fromInterest = Math.max(0, pos('i') + pos('n') + pos('b'));
    const fromRoyalties = Math.max(0, pos('e'));
    const toEmployees = Math.min(0, pos('e'));

    const payload = {
      date: w.date,
      dateFrom: w.dateFrom,
      fromRetail,
      fromCustomers: 0,
      fromExchange,
      fromInterest,
      fromPoaching: 0,
      fromGame: 0,
      fromEmployees: 0,
      fromRoyalties,
      toGame: 0,
      toSuppliers: Math.min(0, pos('m') + pos('b') + pos('u')),
      toExchange: 0,
      toEmployees,
      toExecutives: Math.min(0, pos('e') + pos('h')),
      forInterest: 0,
      forFees: Math.min(0, pos('f') + pos('q')),
      forAccounting: Math.min(0, pos('a')),
      investmentInBonds: 0,
      bonds: 0,
      gameIncome: 0,
      cashAllIncome: sumPositive(w.rows),
      cashAllExpenses: sumNegative(w.rows),
      isComputed: true
    };
    sendJson(res, payload);
    return true;
  }

  // 9. Past Finances Overview (v2) — daily snapshot rows for the chart.
  const overviewMatch = pathname.match(/^\/api\/v2\/companies\/(\d+|me)\/past-finances-overview\/$/);
  if (overviewMatch) {
    const companyId = authorizeRequestedCompany();
    if (companyId === null) return true;
    const rows = getDailyFinanceSnapshots(companyId);
    sendJson(res, rows.map(r => ({
      total: r.total,
      currentAssets: r.current_assets,
      nonCurrentAssets: r.non_current_assets,
      liabilities: r.liabilities,
      economicValueAdded: r.economic_value_added,
      evaProfit: r.eva_profit,
      evaRank: r.eva_rank,
      rank: r.rank,
      date: formatSnapshotDate(r.created_at, r.snapshot_date)
    })));
    return true;
  }

  // 9b. Past Finances (v3) — richer snapshot rows for the finance history chart.
  const pastFinancesMatch = pathname.match(/^\/api\/v3\/companies\/(\d+|me)\/past-finances\/$/);
  if (pastFinancesMatch) {
    const companyId = authorizeRequestedCompany();
    if (companyId === null) return true;
    const rows = getDailyFinanceSnapshots(companyId);
    sendJson(res, rows.map(r => ({
      total: r.total,
      currentAssets: r.current_assets,
      cashAndReceivables: r.cash_and_receivables,
      inventory: r.inventory,
      nonCurrentAssets: r.non_current_assets,
      buildings: r.buildings,
      patents: r.patents,
      investmentInBonds: r.investment_in_bonds,
      deposits: r.deposits,
      liabilities: r.liabilities,
      rank: r.rank,
      date: formatSnapshotDate(r.created_at, r.snapshot_date)
    })));
    return true;
  }


  return false;
}
