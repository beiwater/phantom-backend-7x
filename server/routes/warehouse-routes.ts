import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson } from './utils.ts';
import { getWarehouseResources } from '../game/warehouse.ts';
import { warehouseRepository } from '../repositories/warehouse-repository.ts';

export async function handleWarehouseRoutes(
  _req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  _method: string,
  currentCompanyId: number | null
): Promise<boolean> {
  // 1. Warehouse resources list: /api/v2/resources/:companyId/ or /api/v3/resources/:companyId/
  const warehouseMatch = pathname.match(/^\/api\/v[23]\/resources\/(\d+)\/$/);
  if (warehouseMatch) {
    const compId = Number(warehouseMatch[1]);
    if (!currentCompanyId || compId !== currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    sendJson(res, getWarehouseResources(currentCompanyId));
    return true;
  }

  // 2. Warehouse tags: /api/v2/companies/:id/warehouse/tags/ or /api/v2/warehouse/tags/
  if (pathname.startsWith('/api/') && (pathname.includes('/warehouse/tags/') || pathname.includes('/warehouse-tags/'))) {
    sendJson(res, []);
    return true;
  }

  // 3. Egg Collection & Egg Swaps
  if (pathname.startsWith('/api/') && (pathname.includes('/egg-collection/') || pathname.includes('/egg-swaps/'))) {
    sendJson(res, { eggs: [], swaps: [] });
    return true;
  }

  // 4. Warehouse contracts summary: /api/v2/warehouse-contracts-summary/:companyId/:type/
  const summaryMatch = pathname.match(/^\/api\/v2\/warehouse-contracts-summary\/(\d+|me)\/([^/]+)\/$/);
  if (summaryMatch) {
    sendJson(res, { summary: [] }, 200, { 'x-timestamp': new Date().toISOString() });
    return true;
  }

  // 5. Resource transactions: /api/v2/resources-transactions/:companyId/:kind/
  const resTxMatch = pathname.match(/^\/api\/v2\/resources-transactions\/(\d+|me)\/(\d+)\/$/);
  if (resTxMatch) {
    const compId = resTxMatch[1] === 'me' ? currentCompanyId : Number(resTxMatch[1]);
    if (!currentCompanyId || compId !== currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    sendJson(res, warehouseRepository.listResourceTransactions(compId, Number(resTxMatch[2])));
    return true;
  }

  // 6. Resource transactions summary: /api/v2/resources-transactions-summary/:companyId/:kind/
  const resTxSummaryMatch = pathname.match(/^\/api\/v2\/resources-transactions-summary\/(\d+|me)\/(\d+)\/$/);
  if (resTxSummaryMatch) {
    const compId = resTxSummaryMatch[1] === 'me' ? currentCompanyId : Number(resTxSummaryMatch[1]);
    if (!currentCompanyId || compId !== currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    const summary = warehouseRepository.getResourceTransactionSummary(compId, Number(resTxSummaryMatch[2]));
    sendJson(res, {
      totalBought: summary.totalBought,
      totalSold: summary.totalSold,
      totalProduced: 0,
      avgPrice: summary.totalBought > 0 ? summary.avgBuyPrice : summary.avgSellPrice
    });
    return true;
  }

  return false;
}
