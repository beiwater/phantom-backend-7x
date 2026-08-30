import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson, readJsonBody } from './utils.ts';
import { db } from '../db/database.ts';
import { getCompanyById } from '../game/company.ts';
import { takeLoan, repayLoan, getActiveLoans, settleDueLoans } from '../game/loans.ts';

export async function handleFinanceRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  currentCompanyId: number | null
): Promise<boolean> {
  const effectiveCompanyId = currentCompanyId || 4259175;

  // 1. Custom Reports (FPA): /api/v2/fpa/custom-reports/
  if (pathname === '/api/v2/fpa/custom-reports/') {
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
    const comp = getCompanyById(effectiveCompanyId);
    const bldCount = (db.prepare('SELECT COUNT(*) as count FROM buildings WHERE company_id = ?').get(effectiveCompanyId) as { count: number })?.count || 2;
    const overhead = Math.max(0, (bldCount - 1) * 0.035);
    sendJson(res, {
      administrationOverhead: overhead,
      recreationBonus: 0,
      workers: bldCount * 100,
      adminCostDaily: Math.round(overhead * 1000)
    });
    return true;
  }

  // 3. Take a loan
  const loanTakeMatch = pathname.match(/^\/api\/v2\/companies\/(\d+|me)\/loans\/$/);
  if (loanTakeMatch && method === 'POST') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    const body = await readJsonBody<{ amount: number }>(req);
    try {
      sendJson(res, takeLoan(currentCompanyId, body.amount));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: msg }, 400);
    }
    return true;
  }

  // 4. Repay a loan
  const loanRepayMatch = pathname.match(/^\/api\/v2\/companies\/(\d+|me)\/loans\/(\d+)\/repay\/$/);
  if (loanRepayMatch && method === 'POST') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    const body = await readJsonBody<{ amount: number }>(req);
    try {
      sendJson(res, repayLoan(currentCompanyId, Number(loanRepayMatch[2]), body.amount));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: msg }, 400);
    }
    return true;
  }

  // 5. List loans for this company
  const loanListMatch = pathname.match(/^\/api\/v2\/companies\/(\d+|me)\/loans\/$/);
  if (loanListMatch && method === 'GET') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    sendJson(res, getActiveLoans(currentCompanyId));
    return true;
  }

  // 6. Balance Sheet
  if (pathname.includes('/balance-sheet/')) {
    if (currentCompanyId) settleDueLoans(currentCompanyId);
    const comp = currentCompanyId ? getCompanyById(currentCompanyId) : null;
    const companyId = currentCompanyId || 0;

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
    const totalAssets = money + inventory + buildings + bondsHeld;
    sendJson(res, {
      money,
      inventory,
      buildings,
      bonds: bondsHeld,
      totalAssets,
      liabilities,
      equity: totalAssets - liabilities
    });
    return true;
  }

  // 7. Income Statement
  if (pathname.includes('/income-statement/')) {
    const comp = getCompanyById(effectiveCompanyId);
    const money = comp ? Number(comp.money) || 0 : 100000;
    sendJson(res, {
      revenue: Math.round(money * 0.45),
      cogs: Math.round(money * 0.25),
      wages: Math.round(money * 0.08),
      adminOverhead: Math.round(money * 0.02),
      netProfit: Math.round(money * 0.10)
    });
    return true;
  }

  // 8. Cashflow Statement
  if (pathname.includes('/cashflow-statement/') || pathname.includes('/cashflow/')) {
    const comp = getCompanyById(effectiveCompanyId);
    const money = comp ? Number(comp.money) || 0 : 100000;
    sendJson(res, {
      operatingCashflow: Math.round(money * 0.12),
      investingCashflow: -Math.round(money * 0.05),
      financingCashflow: 0,
      netCashChange: Math.round(money * 0.07)
    });
    return true;
  }

  // 9. Past Finances / Financial History: /api/v2/companies/:id/past-finances/
  if (pathname.includes('/past-finances/')) {
    const comp = getCompanyById(effectiveCompanyId);
    const money = comp ? Number(comp.money) || 0 : 100000;
    const days = [];
    const now = Date.now();
    for (let i = 0; i < 14; i++) {
      const date = new Date(now - i * 86400 * 1000).toISOString().split('T')[0];
      days.push({
        date,
        money: Math.round(money * (0.85 + (i * 0.01))),
        buildings: 45000,
        inventory: 28000,
        equity: Math.round(money * (0.85 + (i * 0.01))) + 73000
      });
    }
    sendJson(res, days);
    return true;
  }

  // 10. Display Case Items: /api/v2/companies/:id/display-case/
  const displayCaseMatch = pathname.match(/^\/api\/v2\/companies\/(\d+|me)\/display-case\/(?:\d+\/)?$/);
  if (displayCaseMatch) {
    sendJson(res, [
      { id: 1, position: 0, title: "Founder Trophy", image: "images/collectibles/trophy_gold.png", description: "Awarded for founding the private enterprise." }
    ]);
    return true;
  }

  return false;
}
