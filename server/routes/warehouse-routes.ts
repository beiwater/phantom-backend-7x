import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson } from './utils.ts';
import { getWarehouseResources } from '../game/warehouse.ts';
import { resolveFinishedProduction } from '../game/production.ts';

export async function handleWarehouseRoutes(
  _req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  _method: string
): Promise<boolean> {
  // 1. Warehouse resources list: /api/v2/resources/:companyId/ or /api/v3/resources/:companyId/
  const warehouseMatch = pathname.match(/^\/api\/v[23]\/resources\/(\d+)\/$/);
  if (warehouseMatch) {
    const compId = Number(warehouseMatch[1]);
    resolveFinishedProduction(compId);
    sendJson(res, getWarehouseResources(compId));
    return true;
  }

  // 2. Warehouse tags: /api/v2/companies/:id/warehouse/tags/ or /api/v2/warehouse/tags/
  if (pathname.includes('/warehouse/tags/') || pathname.includes('/warehouse-tags/')) {
    sendJson(res, []);
    return true;
  }

  // 3. Egg Collection & Egg Swaps
  if (pathname.includes('/egg-collection/') || pathname.includes('/egg-swaps/')) {
    sendJson(res, { eggs: [], swaps: [] });
    return true;
  }

  return false;
}
