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
  // Take a loan
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

  // Repay a loan (partial payments allowed; closes at 0)
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

  // List loans for this company
  const loanListMatch = pathname.match(/^\/api\/v2\/companies\/(\d+|me)\/loans\/$/);
  if (loanListMatch) {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    sendJson(res, getActiveLoans(currentCompanyId));
    return true;
  }

  if (pathname.includes('/balance-sheet/')) {
    if (currentCompanyId) settleDueLoans(currentCompanyId); // settle overdue loans before valuing
    const comp = currentCompanyId ? getCompanyById(currentCompanyId) : null;
    const companyId = currentCompanyId || 0;

    // derived from warehouse stock valued at market cost
    const invRow = db.prepare(
      'SELECT COALESCE(SUM(amount * cost_market), 0) AS total FROM warehouse WHERE company_id = ?'
    ).get(companyId) as { total: number | null };
    const inventory = Number(invRow?.total) || 0;

    // derived from building purchase cost
    const bldRow = db.prepare(
      'SELECT COALESCE(SUM(cost), 0) AS total FROM buildings WHERE company_id = ?'
    ).get(companyId) as { total: number | null };
    const buildings = Number(bldRow?.total) || 0;

    // derived from active bonds held (bonds table)
    const bondRow = db.prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM bonds WHERE buyer_company_id = ? AND status = 'active'`
    ).get(companyId) as { total: number | null };
    const bondsHeld = Number(bondRow?.total) || 0;

    // derived from active loan remaining balances
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

  if (pathname.includes('/income-statement/')) {
    // No ledger table exists yet, so realized figures cannot be derived.
    sendJson(res, {
      revenue: 125000, // placeholder pending ledger
      cogs: 82000, // placeholder pending ledger
      wages: 15000, // placeholder pending ledger (executives salaries not accrued over time)
      adminOverhead: 2000, // placeholder pending ledger
      netProfit: 26000 // placeholder pending ledger
    });
    return true;
  }

  if (pathname.includes('/cashflow-statement/') || pathname.includes('/cashflow/')) {
    // No cash ledger exists yet; loan financing events are not tracked over time.
    sendJson(res, {
      operatingCashflow: 26000, // placeholder pending ledger
      investingCashflow: -17250, // placeholder pending ledger
      financingCashflow: 0, // placeholder pending ledger
      netCashChange: 8750 // placeholder pending ledger
    });
    return true;
  }

  if (pathname.includes('/past-finances/')) {
    sendJson(res, []);
    return true;
  }

  if (pathname.includes('/bonds/')) {
    sendJson(res, []);
    return true;
  }

  if (pathname.includes('/achievements/')) {
    sendJson(res, []);
    return true;
  }

  if (pathname.includes('/display-case/')) {
    sendJson(res, []);
    return true;
  }


  if (pathname.includes('/certificates/')) {
    sendJson(res, []);
    return true;
  }

  if (pathname.includes('/tags/')) {
    sendJson(res, []);
    return true;
  }

  if (pathname.includes('/government-orders/tier/')) {
    sendJson(res, { tier: 0 });
    return true;
  }

  if (pathname.includes('/government-orders/')) {
    sendJson(res, { governmentOrders: [] });
    return true;
  }

  return false;
}
