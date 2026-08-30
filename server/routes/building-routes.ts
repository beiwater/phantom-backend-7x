import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson } from './utils.ts';
import { db } from '../db/database.ts';
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
import { consumeResource, addResource, getWarehouseItem } from '../game/warehouse.ts';
import { updateCompanyMoney } from '../game/company.ts';
import { getResourceDef } from '../game/constants.ts';

const RETAIL_PRODUCTS: Record<string, number[]> = {
  'G': [3, 4, 121, 117, 119, 9],
  'S': [11, 12],
  'L': [24, 25, 26, 28],
  'F': [40, 41, 42, 46, 47],
  'C': [50, 51, 52, 53],
  'H': [102, 103, 108, 109, 110]
};

export interface RetailDbRow {
  id: number;
  building_id: number;
  company_id: number;
  resource_kind: number;
  units: number;
  unit_price: number;
  cost: number;
  created_at: string;
}

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

  // Building sub-routes
  if (pathname.includes('/abundance/')) {
    sendJson(res, { abundance: 100 });
    return true;
  }
  if (pathname.includes('/history/')) {
    sendJson(res, []);
    return true;
  }
  if (pathname.includes('/followers/')) {
    sendJson(res, { linking: null });
    return true;
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

  // Sales orders (Retail stores)
  const salesOrdersMatch = pathname.match(/^\/api\/v2\/companies\/buildings\/(\d+)\/sales-orders\/$/);
  if (salesOrdersMatch) {
    if (!currentCompanyId) {
      sendJson(res, []);
      return true;
    }
    const buildingId = Number(salesOrdersMatch[1]);
    const building = getBuildingById(buildingId);

    if (method === 'GET') {
      let orders = db.prepare('SELECT * FROM retail_orders WHERE building_id = ?').all(buildingId) as unknown as RetailDbRow[];
      if (orders.length === 0 && building) {
        const availableKinds = RETAIL_PRODUCTS[building.kind] || [3, 4];
        const kind = availableKinds[Math.floor(Math.random() * availableKinds.length)];
        const resDef = getResourceDef(kind);
        const units = 100 * building.size;
        const basePrice = (resDef?.unitsSoldAnHour && resDef.unitsSoldAnHour > 0) ? (100 / resDef.unitsSoldAnHour) : 3.5;
        const retailPrice = Math.round(basePrice * 1.35 * 100) / 100;
        const now = new Date().toISOString();

        const inserted = db.prepare(`
          INSERT INTO retail_orders (building_id, company_id, resource_kind, units, unit_price, cost, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(buildingId, currentCompanyId, kind, units, retailPrice, basePrice, now);

        orders = [{
          id: Number(inserted.lastInsertRowid),
          building_id: buildingId,
          company_id: currentCompanyId,
          resource_kind: kind,
          units,
          unit_price: retailPrice,
          cost: basePrice,
          created_at: now
        }];
      }

      sendJson(res, orders.map(o => {
        const rDef = getResourceDef(o.resource_kind);
        return {
          id: o.id,
          resource: { kind: o.resource_kind, name: `Resource #${o.resource_kind}`, image: rDef?.image || '' },
          units: o.units,
          price: o.unit_price,
          cost: o.cost,
          secondsRemaining: 0
        };
      }));
      return true;
    }

    if (method === 'POST') {
      const availableKinds = (building && RETAIL_PRODUCTS[building.kind]) ? RETAIL_PRODUCTS[building.kind] : [3];
      const kind = availableKinds[Math.floor(Math.random() * availableKinds.length)];
      const resDef = getResourceDef(kind);
      const units = 100 * (building ? building.size : 1);
      const basePrice = (resDef?.unitsSoldAnHour && resDef.unitsSoldAnHour > 0) ? (100 / resDef.unitsSoldAnHour) : 3.5;
      const retailPrice = Math.round(basePrice * 1.35 * 100) / 100;
      const now = new Date().toISOString();

      const inserted = db.prepare(`
        INSERT INTO retail_orders (building_id, company_id, resource_kind, units, unit_price, cost, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(buildingId, currentCompanyId, kind, units, retailPrice, basePrice, now);

      sendJson(res, {
        salesOrder: {
          id: Number(inserted.lastInsertRowid),
          resource: { kind, name: `Resource #${kind}`, image: resDef?.image || '' },
          units,
          price: retailPrice,
          cost: basePrice
        },
        money: 0
      });
      return true;
    }
  }

  // Fulfill or Reject Retail Sales Order
  const singleSalesOrderMatch = pathname.match(/^\/api\/v2\/companies\/buildings\/(\d+)\/sales-orders\/(\d+)\/$/);
  if (singleSalesOrderMatch) {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    const orderId = Number(singleSalesOrderMatch[2]);

    if (method === 'PUT') {
      const order = db.prepare('SELECT * FROM retail_orders WHERE id = ?').get(orderId) as RetailDbRow | undefined;
      if (!order) {
        sendJson(res, { error: 'Order not found' }, 404);
        return true;
      }

      const stock = getWarehouseItem(currentCompanyId, order.resource_kind, 0);
      if (!stock || stock.amount < order.units) {
        addResource(currentCompanyId, order.resource_kind, 0, order.units);
      }

      consumeResource(currentCompanyId, order.resource_kind, 0, order.units);
      const revenue = Math.round(order.units * order.unit_price * 100) / 100;
      const newMoney = updateCompanyMoney(currentCompanyId, revenue);

      db.prepare('DELETE FROM retail_orders WHERE id = ?').run(orderId);

      sendJson(res, {
        money: newMoney,
        resourceTransactions: [
          { dbLetter: order.resource_kind, quality: 0, delta: -order.units }
        ]
      });
      return true;
    }

    if (method === 'DELETE') {
      db.prepare('DELETE FROM retail_orders WHERE id = ?').run(orderId);
      sendJson(res, { status: 'ok' });
      return true;
    }
  }

  // Restaurant properties & runs
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
