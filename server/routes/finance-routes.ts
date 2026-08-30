import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson } from './utils.ts';
import { getCompanyById } from '../game/company.ts';

export async function handleFinanceRoutes(
  _req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  _method: string,
  currentCompanyId: number | null
): Promise<boolean> {
  if (pathname.includes('/balance-sheet/')) {
    const comp = currentCompanyId ? getCompanyById(currentCompanyId) : null;
    sendJson(res, {
      money: comp ? comp.money : 100000,
      inventory: 25000,
      buildings: 35000,
      bonds: 0,
      totalAssets: (comp ? comp.money : 100000) + 60000,
      liabilities: 0,
      equity: (comp ? comp.money : 100000) + 60000
    });
    return true;
  }

  if (pathname.includes('/income-statement/')) {
    sendJson(res, {
      revenue: 125000,
      cogs: 82000,
      wages: 15000,
      adminOverhead: 2000,
      netProfit: 26000
    });
    return true;
  }

  if (pathname.includes('/cashflow-statement/') || pathname.includes('/cashflow/')) {
    sendJson(res, {
      operatingCashflow: 26000,
      investingCashflow: -17250,
      financingCashflow: 0,
      netCashChange: 8750
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

  if (pathname.includes('/executives/')) {
    sendJson(res, { executives: [], offers: [], achievements: [] });
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
