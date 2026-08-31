import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson, readJsonBody } from './utils.ts';
import { db } from '../db/database.ts';
import { getCompanyById } from '../game/company.ts';
import { takeLoan, repayLoan, getActiveLoans } from '../game/loans.ts';

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

  // 6. Balance Sheet
  if (pathname.startsWith('/api/') && pathname.includes('/balance-sheet/')) {
    const companyId = authorizeRequestedCompany();
    if (companyId === null) return true;
    const comp = getCompanyById(companyId);

    const invRow = db.prepare(
      'SELECT COALESCE(SUM(amount * cost_market), 0) AS total FROM warehouse WHERE company_id = ?'
    ).get(companyId) as { total: number | null };
    const inventory = Number(invRow?.total) || 0;

    const bldRow = db.prepare(
      'SELECT COALESCE(SUM(cost), 0) AS total FROM buildings WHERE company_id = ?'
    ).get(companyId) as { total: number | null };
    const buildings = Number(bldRow?.total) || 0;

    const bondRow = db.prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM bonds WHERE buyer_company_id = ? AND status = 'active'`
    ).get(companyId) as { total: number | null };
    const bondsHeld = Number(bondRow?.total) || 0;

    const liabRow = db.prepare(
      `SELECT COALESCE(SUM(remaining), 0) AS total FROM loans WHERE company_id = ? AND status = 'active'`
    ).get(companyId) as { total: number | null };
    const liabilities = Number(liabRow?.total) || 0;

    const money = comp ? Number(comp.money) || 0 : 0;
    const realTotalAssets = money + inventory + buildings + bondsHeld;
    const date = new Date().toISOString();
    const nowFrom = new Date(Date.now() - 86400000).toISOString();
    sendJson(res, {
      date,
      dateFrom: nowFrom,
      cash: money,
      cashReservedForOrders: 0,
      accountsReceivable: 0,
      materials: inventory,
      research: 0,
      workInProcess: 0,
      finishedGoods: inventory,
      valuationAllowance: 0,
      deposits: 0,
      investmentInBonds: bondsHeld,
      buildings,
      patents: 0,
      bondsPayable: liabilities,
      contributedCapital: 100000,
      retainedEarnings: Math.max(0, realTotalAssets - liabilities - 100000),
      money,
      inventory,
      bonds: bondsHeld,
      totalAssets: realTotalAssets,
      liabilities,
      equity: realTotalAssets - liabilities
    });
    return true;
  }

  // 7. Income Statement
  // Historical revenue is not reconstructible from the current schema without
  // a journal. Do not expose synthetic percentages as accounting data.
  if (pathname.startsWith('/api/') && pathname.includes('/income-statement/')) {
    if (authorizeRequestedCompany() === null) return true;
    sendJson(res, {
      error: 'Income statement ledger is not available',
      code: 'API_NOT_IMPLEMENTED'
    }, 501);
    return true;
  }

  // 8. Cashflow Statement
  if (pathname.startsWith('/api/') && (pathname.includes('/cashflow-statement/') || pathname.includes('/cashflow/'))) {
    if (authorizeRequestedCompany() === null) return true;
    sendJson(res, {
      error: 'Cashflow ledger is not available',
      code: 'API_NOT_IMPLEMENTED'
    }, 501);
    return true;
  }
  // 9. Past Finances & Overview: /api/v2/companies/:id/past-finances/, /api/v2/companies/:id/past-finances-overview/
  if (pathname.startsWith('/api/') && (pathname.includes('/past-finances/') || pathname.includes('/past-finances-overview/'))) {
    if (authorizeRequestedCompany() === null) return true;
    sendJson(res, {
      error: 'Historical finance ledger is not available',
      code: 'API_NOT_IMPLEMENTED'
    }, 501);
    return true;
  }


  return false;
}
