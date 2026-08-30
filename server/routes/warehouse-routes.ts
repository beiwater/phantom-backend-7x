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
  const warehouseMatch = pathname.match(/^\/api\/v[23]\/resources\/(\d+)\/$/);
  if (warehouseMatch) {
    const compId = Number(warehouseMatch[1]);
    resolveFinishedProduction(compId);
    sendJson(res, getWarehouseResources(compId));
    return true;
  }

  if (pathname.includes('/contracts-incoming/')) {
    sendJson(res, { incomingContracts: [], incomingContractsOtherRealms: [] });
    return true;
  }

  if (pathname.includes('/contracts-outgoing/')) {
    sendJson(res, []);
    return true;
  }

  if (pathname.includes('/egg-collection/')) {
    sendJson(res, { eggs: [] });
    return true;
  }

  return false;
}
