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
import { updateCompanyMoney, getCompanyById } from '../game/company.ts';
import { getResourceDef, calculateProductionTime } from '../game/constants.ts';

const RETAIL_PRODUCTS: Record<string, number[]> = {
  G: [3, 4, 119, 7, 8, 9, 62],
  S: [11, 12, 60, 61],
  E: [24, 25, 40, 80],
  T: [19, 20, 21, 22],
  C: [50, 51, 52, 53],
  H: [102, 103, 104]
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
  // v1 Busy / Start Production endpoint: /api/v1/buildings/:id/busy/ or /api/v1/busy/:id/
  const v1BusyMatch = pathname.match(/^\/api\/v1\/buildings\/(\d+)\/busy\/$/) ||
                      pathname.match(/^\/api\/v1\/busy\/(\d+)\/$/);
  if (v1BusyMatch && method === 'POST') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    const buildingId = Number(v1BusyMatch[1]);

    try {
      const body = await readJsonBody<{
        kind?: number;
        amount?: number;
        limitQuality?: number | null;
      }>(req);

      if (!body.kind || !body.amount) {
        sendJson(res, { error: 'kind and amount are required' }, 400);
        return true;
      }

      const result = queueProduction(currentCompanyId, buildingId, body.kind, body.amount);
      sendJson(res, {
        message: "Production started successfully",
        money: 0,
        building: result.building,
        followerErrors: [],
        simboostsDelta: 0
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: msg }, 400);
    }
    return true;
  }

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
          ...result.building,
          cost: result.cost,
          resourcesConsumed: []
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
      const body = await readJsonBody<{ size?: number }>(req);
      try {
        const targetSize = body.size || 2;
        const result = upgradeBuilding(currentCompanyId, buildingId, targetSize);
        sendJson(res, {
          ...result.building,
          cost: result.cost,
          resourcesConsumed: []
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, { error: msg }, 400);
      }
      return true;
    }

    if (method === 'DELETE') {
      try {
        const result = demolishBuilding(currentCompanyId, buildingId);
        sendJson(res, result.building);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, { error: msg }, 400);
      }
      return true;
    }
  }

  // Building info by ID
  const buildingGetMatch = pathname.match(/^\/api\/v2\/companies\/buildings\/(\d+)\/$/);
  if (buildingGetMatch) {
    const buildingId = Number(buildingGetMatch[1]);
    const b = getBuildingById(buildingId);
    if (!b) {
      sendJson(res, { error: 'Building not found' }, 404);
      return true;
    }
    resolveFinishedProduction(b.company_id);
    sendJson(res, formatBuilding(b));
    return true;
  }

  // Building abundance
  const abundanceMatch = pathname.match(/^\/api\/v2\/companies\/buildings\/(\d+)\/abundance\/$/);
  if (abundanceMatch) {
    sendJson(res, { abundance: 100, originalAbundance: 100 });
    return true;
  }

  // Building robots install / uninstall
  const robotsMatch = pathname.match(/^\/api\/v2\/companies\/buildings\/(\d+)\/robots\/$/);
  if (robotsMatch) {
    if (method === 'POST') {
      return sendJson(res, { robotsInstalled: true, wageDiscount: 0.03 });
    }
    if (method === 'DELETE') {
      return sendJson(res, { robotsInstalled: false, wageDiscount: 0 });
    }
  }

  // PA Quests
  if (pathname.includes('/pa/quests/') || pathname.includes('/objectives/')) {
    return sendJson(res, {
      quests: [
        { id: 1, title: '初创公司启航', description: '在农场排产苹果与种子，并在生鲜超市出售。', completed: true, reward: 500 }
      ]
    });
  }

  // Building production queue
  const queueMatch = pathname.match(/^\/api\/v2\/companies\/buildings\/(\d+)\/queue\/$/);
  if (queueMatch) {
    const buildingId = Number(queueMatch[1]);
    const building = getBuildingById(buildingId);
    const effectiveCompanyId = building ? building.company_id : (currentCompanyId || 4259175);

    if (method === 'GET') {
      resolveFinishedProduction(effectiveCompanyId);
      sendJson(res, getBuildingQueue(effectiveCompanyId, buildingId));
      return true;
    }
    if (method === 'POST') {
      if (!currentCompanyId) {
        sendJson(res, { error: 'Unauthorized' }, 401);
        return true;
      }
      const body = await readJsonBody<{
        kind: number;
        amount: number;
        duration?: number;
        quality?: number;
      }>(req);

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

  // Cancel production queue item
  const cancelQueueMatch = pathname.match(/^\/api\/v2\/companies\/buildings\/(\d+)\/queue\/(\d+)\/$/);
  if (cancelQueueMatch && method === 'DELETE') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    const buildingId = Number(cancelQueueMatch[1]);
    const queueId = Number(cancelQueueMatch[2]);
    try {
      const result = cancelQueueItem(currentCompanyId, buildingId, queueId);
      sendJson(res, result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: msg }, 400);
    }
    return true;
  }

  // Take finished production order
  const takeOrderMatch = pathname.match(/^\/api\/v2\/order\/take\/(\d+)\/$/);
  if (takeOrderMatch && method === 'POST') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    const queueId = Number(takeOrderMatch[1]);
    const item = db.prepare('SELECT * FROM production_queues WHERE id = ?').get(queueId) as { id: number; company_id: number; kind: number; quality: number; amount: number; finishes_at: string; resolved: number } | undefined;
    if (!item || item.company_id !== currentCompanyId) {
      sendJson(res, { error: 'Order not found' }, 400);
      return true;
    }
    if (new Date(item.finishes_at).getTime() > Date.now()) {
      sendJson(res, { error: 'Production not finished yet' }, 400);
      return true;
    }
    if (item.resolved === 1) {
      sendJson(res, { error: 'Order already claimed' }, 400);
      return true;
    }

    db.exec('BEGIN');
    try {
      // Delete-first guard: only one request can claim the order
      const del = db.prepare('DELETE FROM production_queues WHERE id = ? AND resolved = 0').run(queueId);
      if (del.changes === 0) {
        throw new Error('Order already claimed');
      }
      addResource(item.company_id, item.kind, item.quality ?? 0, item.amount);
      db.exec('COMMIT');
    } catch (err: unknown) {
      db.exec('ROLLBACK');
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: msg }, 400);
      return true;
    }

    sendJson(res, {
      success: true,
      resource: {
        kind: item.kind,
        quality: item.quality ?? 0,
        amount: item.amount
      }
    });
    return true;
  }

  // Retail sales orders
  const salesOrdersMatch = pathname.match(/^\/api\/v2\/companies\/buildings\/(\d+)\/sales-orders\/$/);
  if (salesOrdersMatch) {
    const buildingId = Number(salesOrdersMatch[1]);
    const building = getBuildingById(buildingId);
    if (building?.kind === 'B') {
      // Sales Office uses Aerospace sales orders in encyclopedia-routes
      return false;
    }
    let orders = db.prepare('SELECT * FROM retail_orders WHERE building_id = ?').all(buildingId) as unknown as RetailDbRow[];

    if (orders.length === 0 && building && RETAIL_PRODUCTS[building.kind]) {
      const allowedKinds = RETAIL_PRODUCTS[building.kind];
      const randomKind = allowedKinds[Math.floor(Math.random() * allowedKinds.length)];
      const resDef = getResourceDef(randomKind);
      const units = 100;
      const unitPrice = resDef ? Math.round((resDef.cost || 2.0) * 1.35 * 100) / 100 : 2.5;
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO retail_orders (building_id, company_id, resource_kind, units, unit_price, cost, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(buildingId, building.company_id, randomKind, units, unitPrice, units * unitPrice, now);

      orders = db.prepare('SELECT * FROM retail_orders WHERE building_id = ?').all(buildingId) as unknown as RetailDbRow[];
    }

    if (method === 'GET') {
      return sendJson(res, orders.map(o => ({
        id: o.id,
        kind: o.resource_kind,
        units: o.units,
        unitPrice: o.unit_price,
        cost: o.cost,
        quality: 0
      })));
    }

    if (method === 'POST') {
      const allowedKinds = (building && RETAIL_PRODUCTS[building.kind]) || [3, 4, 119];
      const randomKind = allowedKinds[Math.floor(Math.random() * allowedKinds.length)];
      const resDef = getResourceDef(randomKind);
      const units = 100;
      const unitPrice = resDef ? Math.round((resDef.cost || 2.0) * 1.35 * 100) / 100 : 2.5;
      const now = new Date().toISOString();

      const insertRes = db.prepare(`
        INSERT INTO retail_orders (building_id, company_id, resource_kind, units, unit_price, cost, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(buildingId, building?.company_id || currentCompanyId, randomKind, units, unitPrice, units * unitPrice, now);

      return sendJson(res, {
        salesOrder: {
          id: Number(insertRes.lastInsertRowid),
          kind: randomKind,
          units,
          unitPrice,
          cost: units * unitPrice,
          quality: 0
        },
        money: 0
      });
    }
  }

  // Fulfill or Reject Retail Sales Order
  const singleSalesOrderMatch = pathname.match(/^\/api\/v2\/companies\/buildings\/(\d+)\/sales-orders\/(\d+)\/$/);
  if (singleSalesOrderMatch) {
    const buildingId = Number(singleSalesOrderMatch[1]);
    const orderId = Number(singleSalesOrderMatch[2]);
    const building = getBuildingById(buildingId);
    if (building?.kind === 'B') {
      return false;
    }
    const order = db.prepare('SELECT * FROM retail_orders WHERE id = ?').get(orderId) as { id: number; building_id: number; resource_kind: number; units: number; unit_price: number } | undefined;

    if (method === 'PUT') {
      if (!currentCompanyId) {
        sendJson(res, { error: 'Unauthorized' }, 401);
        return true;
      }
      if (!order || order.building_id !== buildingId) {
        sendJson(res, { error: 'Sales order not found' }, 400);
        return true;
      }
      const building = getBuildingById(buildingId);
      if (!building || building.company_id !== currentCompanyId) {
        sendJson(res, { error: 'Sales order not found' }, 400);
        return true;
      }

      db.exec('BEGIN');
      try {
        if (!consumeResource(currentCompanyId, order.resource_kind, 0, order.units)) {
          throw new Error('Insufficient resources in warehouse');
        }
        const revenue = Math.round(order.units * order.unit_price * 100) / 100;
        const newMoney = updateCompanyMoney(currentCompanyId, revenue);
        db.prepare('DELETE FROM retail_orders WHERE id = ?').run(orderId);
        db.exec('COMMIT');

        return sendJson(res, {
          success: true,
          revenue,
          money: newMoney,
          resource: {
            kind: order.resource_kind,
            units: -order.units
          }
        });
      } catch (err: unknown) {
        db.exec('ROLLBACK');
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, { error: msg }, 400);
        return true;
      }
    }


    if (method === 'DELETE') {
      db.prepare('DELETE FROM retail_orders WHERE id = ?').run(orderId);
      return sendJson(res, { success: true });
    }
  }


  return false;
}
