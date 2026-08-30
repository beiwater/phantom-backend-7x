import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson } from './utils.ts';
import {
  getCompanyBuildings,
  constructBuilding,
  upgradeBuilding,
  demolishBuilding,
  formatBuilding,
  getBuildingById
} from '../game/buildings.ts';
import {
  getBuildingQueue,
  queueProduction,
  cancelQueueItem,
  resolveFinishedProduction
} from '../game/production.ts';

export async function handleBuildingRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  currentCompanyId: number | null
): Promise<boolean> {
  // Buildings list & construct
  if (pathname === '/api/v2/companies/me/buildings/') {
    if (!currentCompanyId) {
      sendJson(res, []);
      return true;
    }
    if (method === 'GET') {
      sendJson(res, getCompanyBuildings(currentCompanyId));
      return true;
    }
    if (method === 'POST') {
      const body = await readJsonBody<{ kind: string; position: string }>(req);
      try {
        const result = constructBuilding(currentCompanyId, body.kind, body.position);
        sendJson(res, {
          building: result.building,
          cost: result.cost,
          moneyUpdate: result.moneyUpdate
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, { error: msg }, 400);
      }
      return true;
    }
  }

  // Building single upgrade & demolish
  const buildingActionMatch = pathname.match(/^\/api\/v2\/companies\/me\/buildings\/(\d+)\/$/);
  if (buildingActionMatch) {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    const buildingId = Number(buildingActionMatch[1]);
    if (method === 'PATCH') {
      const body = await readJsonBody<{ size?: number; position?: string; name?: string }>(req);
      try {
        if (body.size !== undefined) {
          const result = upgradeBuilding(currentCompanyId, buildingId, body.size);
          sendJson(res, {
            building: result.building,
            money: result.money,
            resourcesConsumed: []
          });
          return true;
        }
        const b = getBuildingById(buildingId);
        sendJson(res, { building: b ? formatBuilding(b) : null });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, { error: msg }, 400);
      }
      return true;
    }
    if (method === 'DELETE') {
      try {
        const result = demolishBuilding(currentCompanyId, buildingId);
        sendJson(res, { buildingId: result.buildingId, money: result.money, resources: [] });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, { error: msg }, 400);
      }
      return true;
    }
  }

  // Production Queues
  const queueMatch = pathname.match(/^\/api\/v2\/companies\/buildings\/(\d+)\/queue\/$/);
  if (queueMatch) {
    if (!currentCompanyId) {
      sendJson(res, []);
      return true;
    }
    const buildingId = Number(queueMatch[1]);
    if (method === 'GET') {
      sendJson(res, getBuildingQueue(currentCompanyId, buildingId));
      return true;
    }
    if (method === 'POST') {
      const body = await readJsonBody<{ kind: number; amount: number }>(req);
      try {
        const result = queueProduction(currentCompanyId, buildingId, body.kind, body.amount);
        sendJson(res, result.queue);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, { error: msg }, 400);
      }
      return true;
    }
  }

  // Cancel Queue
  const cancelQueueMatch = pathname.match(/^\/api\/v2\/companies\/buildings\/(\d+)\/queue\/(\d+)\/$/);
  if (cancelQueueMatch && method === 'DELETE') {
    if (!currentCompanyId) {
      sendJson(res, []);
      return true;
    }
    const buildingId = Number(cancelQueueMatch[1]);
    const queueId = Number(cancelQueueMatch[2]);
    try {
      const queue = cancelQueueItem(currentCompanyId, buildingId, queueId);
      sendJson(res, queue);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: msg }, 400);
    }
    return true;
  }

  // Order take / harvest
  const takeOrderMatch = pathname.match(/^\/api\/v2\/order\/take\/(\d+)\/$/);
  if (takeOrderMatch && method === 'POST') {
    if (currentCompanyId) resolveFinishedProduction(currentCompanyId);
    sendJson(res, { amountAvailableNow: 0, profitAvailableNow: 0 });
    return true;
  }

  // Sales orders (Retail)
  const salesOrdersMatch = pathname.match(/^\/api\/v2\/companies\/buildings\/(\d+)\/sales-orders\/$/);
  if (salesOrdersMatch) {
    if (method === 'GET') {
      sendJson(res, []);
      return true;
    }
    if (method === 'POST') {
      sendJson(res, {
        salesOrder: { id: Date.now(), resource: { kind: 3, name: 'Apples' }, units: 100, price: 3.5, cost: 2.1 },
        money: 0
      });
      return true;
    }
  }

  // Restaurant properties
  const restaurantPropsMatch = pathname.match(/^\/api\/v2\/companies\/buildings\/(\d+)\/restaurant-properties\/$/);
  if (restaurantPropsMatch) {
    const buildingId = Number(restaurantPropsMatch[1]);
    const b = getBuildingById(buildingId);
    sendJson(res, {
      building: b ? formatBuilding(b) : null,
      saladBar: [],
      mains: [],
      drinks: [],
      menuPrice: 25,
      goodService: true,
      isLuxury: false
    });
    return true;
  }

  if (pathname.includes('/restaurant-runs/')) {
    sendJson(res, []);
    return true;
  }

  return false;
}
