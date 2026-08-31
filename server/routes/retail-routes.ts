import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson } from './utils.ts';
import { db } from '../db/database.ts';
import { getBuildingById, type BuildingRow } from '../game/buildings.ts';
import { updateCompanyMoney } from '../game/company.ts';
import {
  getWarehouseItem,
  getWarehouseItemExact,
  consumeResourceExactWithTransactions
} from '../game/warehouse.ts';

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
  quality: number;
  units: number;
  unit_price: number;
  cost: number;
  finished_at: string | null;
  created_at: string;
}

function formatRetailOrder(o: RetailDbRow) {
  const finishedAt = o.finished_at || o.created_at;
  return {
    id: o.id,
    building: o.building_id,
    resource: { kind: o.resource_kind, quality: Number(o.quality) || 0 },
    units: Number(o.units),
    sellingPrice: Number(o.unit_price),
    costTotal: Number(o.cost),
    finishedAt,
    createdAt: o.created_at
  };
}

function getOwnedBuilding(companyId: number, buildingId: number) {
  const building = getBuildingById(buildingId);
  return building && building.company_id === companyId ? building : null;
}

function getDefaultRetailProduct(companyId: number, buildingKind: string) {
  const productKinds = RETAIL_PRODUCTS[buildingKind] || [];
  for (const kind of productKinds) {
    const item = getWarehouseItem(companyId, kind, 0);
    if (item && Number(item.amount) > 0) {
      return { kind, quality: Number(item.quality) || 0 };
    }
  }
  return null;
}

function fulfillRetailOrder(companyId: number, order: RetailDbRow) {
  const revenue = Math.round(Number(order.units) * Number(order.unit_price) * 100) / 100;
  db.exec('BEGIN');
  try {
    const resourceTransactions = consumeResourceExactWithTransactions(
      companyId,
      order.resource_kind,
      Number(order.quality) || 0,
      Number(order.units)
    );
    if (!resourceTransactions) {
      throw new Error('Insufficient stock to fulfill retail order');
    }

    const newMoney = updateCompanyMoney(companyId, revenue);
    const deleted = db.prepare(`
      DELETE FROM retail_orders WHERE id = ? AND company_id = ?
    `).run(order.id, companyId);
    if (deleted.changes !== 1) {
      throw new Error('Retail order is no longer available');
    }
    db.exec('COMMIT');

    return {
      success: true,
      revenue,
      // The frontend applies this field as a money delta.
      money: revenue,
      moneyBalance: newMoney,
      resource: {
        kind: order.resource_kind,
        quality: Number(order.quality) || 0,
        units: -Number(order.units)
      },
      resourceTransactions
    };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export async function handleRetailRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  currentCompanyId: number | null
): Promise<boolean> {
  // Retail / sales-order collection and building-scoped collection.
  const buildingSalesOrdersMatch = pathname.match(/^\/api\/v2\/companies\/buildings\/(\d+)\/sales-orders\/(?:(\d+)\/)?$/);
  if (pathname === '/api/v1/sales-orders/' || pathname === '/api/v2/sales-orders/' || buildingSalesOrdersMatch) {
    const buildingId = buildingSalesOrdersMatch ? Number(buildingSalesOrdersMatch[1]) : undefined;
    const orderId = buildingSalesOrdersMatch && buildingSalesOrdersMatch[2]
      ? Number(buildingSalesOrdersMatch[2])
      : undefined;

    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }

    if (buildingId !== undefined && !getOwnedBuilding(currentCompanyId, buildingId)) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }

    if (method === 'GET') {
      if (orderId !== undefined) {
        const order = db.prepare('SELECT * FROM retail_orders WHERE id = ?').get(orderId) as RetailDbRow | undefined;
        if (!order) {
          sendJson(res, { error: 'Order not found' }, 404);
          return true;
        }
        if (order.company_id !== currentCompanyId || (buildingId !== undefined && order.building_id !== buildingId)) {
          sendJson(res, { error: 'Unauthorized' }, 401);
          return true;
        }
        sendJson(res, formatRetailOrder(order));
        return true;
      }

      const orders = buildingId === undefined
        ? db.prepare('SELECT * FROM retail_orders WHERE company_id = ? ORDER BY id DESC').all(currentCompanyId)
        : db.prepare(`
            SELECT * FROM retail_orders
            WHERE company_id = ? AND building_id = ?
            ORDER BY id DESC
          `).all(currentCompanyId, buildingId);
      sendJson(res, (orders as unknown as RetailDbRow[]).map(formatRetailOrder));
      return true;
    }

    if (method === 'POST') {
      const body = await readJsonBody<{
        building?: number;
        resource?: number;
        quality?: number;
        units?: number;
        sellingPrice?: number;
      }>(req);

      const targetBuildingId = buildingId ?? (body.building !== undefined ? Number(body.building) : undefined);
      const targetBuilding = targetBuildingId !== undefined
        ? getOwnedBuilding(currentCompanyId, targetBuildingId)
        : db.prepare(`
            SELECT * FROM buildings
            WHERE company_id = ? AND category = 'sales'
            ORDER BY id ASC
            LIMIT 1
          `).get(currentCompanyId) as BuildingRow | undefined;
      if (!targetBuilding) {
        sendJson(res, { error: 'Owned retail building is required' }, 400);
        return true;
      }
      const defaultProduct = getDefaultRetailProduct(currentCompanyId, targetBuilding.kind);
      const resourceKind = body.resource !== undefined ? Number(body.resource) : defaultProduct?.kind;
      const units = body.units === undefined ? 1 : Number(body.units);
      const sellingPrice = body.sellingPrice === undefined ? 2.5 : Number(body.sellingPrice);
      if (!Number.isSafeInteger(resourceKind) || resourceKind <= 0 ||
          !Number.isFinite(units) || units <= 0 ||
          !Number.isFinite(sellingPrice) || sellingPrice <= 0) {
        sendJson(res, { error: 'Invalid resource, units, or selling price' }, 400);
        return true;
      }

      const requestedQuality = body.quality === undefined
        ? (defaultProduct?.kind === resourceKind ? defaultProduct.quality : 0)
        : Number(body.quality);
      if (!Number.isInteger(requestedQuality) || requestedQuality < 0 || requestedQuality > 12) {
        sendJson(res, { error: 'Invalid resource quality' }, 400);
        return true;
      }

      const item = getWarehouseItemExact(currentCompanyId, resourceKind, requestedQuality);
      if (!item || Number(item.amount) < units) {
        sendJson(res, { error: 'Insufficient stock in warehouse to retail' }, 400);
        return true;
      }

      const costTotal = Math.round(units * 1.5 * 100) / 100;
      const createdAt = new Date().toISOString();
      const finishedAt = new Date(Date.now() + 5000).toISOString();
      const result = db.prepare(`
        INSERT INTO retail_orders
          (building_id, company_id, resource_kind, quality, units, unit_price, cost, finished_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        targetBuilding.id,
        currentCompanyId,
        resourceKind,
        requestedQuality,
        units,
        sellingPrice,
        costTotal,
        finishedAt,
        createdAt
      );
      const order = db.prepare('SELECT * FROM retail_orders WHERE id = ?')
        .get(Number(result.lastInsertRowid)) as RetailDbRow;
      const salesOrder = formatRetailOrder(order);
      sendJson(res, {
        ...salesOrder,
        salesOrder,
        // Creating a retail order does not change the cash balance.
        money: 0
      });
      return true;
    }

    if ((method === 'PUT' || method === 'DELETE') && orderId !== undefined) {
      const order = db.prepare('SELECT * FROM retail_orders WHERE id = ?').get(orderId) as RetailDbRow | undefined;
      if (!order) {
        sendJson(res, { error: 'Order not found' }, 404);
        return true;
      }
      if (order.company_id !== currentCompanyId || (buildingId !== undefined && order.building_id !== buildingId)) {
        sendJson(res, { error: 'Unauthorized' }, 401);
        return true;
      }

      if (method === 'PUT') {
        try {
          sendJson(res, fulfillRetailOrder(currentCompanyId, order));
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          sendJson(res, { error: msg }, 400);
        }
        return true;
      }

      const deleted = db.prepare('DELETE FROM retail_orders WHERE id = ? AND company_id = ?')
        .run(orderId, currentCompanyId);
      if (deleted.changes !== 1) {
        sendJson(res, { error: 'Order is no longer available' }, 404);
        return true;
      }
      sendJson(res, { success: true });
      return true;
    }
  }

  // Individual sales-order operations for legacy v1/v2 paths.
  const singleSalesOrderMatch = pathname.match(/^\/api\/v[12]\/sales-orders\/(\d+)\/$/);
  if (singleSalesOrderMatch && (method === 'GET' || method === 'PUT' || method === 'DELETE')) {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    const orderId = Number(singleSalesOrderMatch[1]);
    const order = db.prepare('SELECT * FROM retail_orders WHERE id = ?').get(orderId) as RetailDbRow | undefined;
    if (!order) {
      sendJson(res, { error: 'Order not found' }, 404);
      return true;
    }
    if (order.company_id !== currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    if (method === 'GET') {
      sendJson(res, formatRetailOrder(order));
      return true;
    }
    if (method === 'PUT') {
      try {
        sendJson(res, fulfillRetailOrder(currentCompanyId, order));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, { error: msg }, 400);
      }
      return true;
    }
    const deleted = db.prepare('DELETE FROM retail_orders WHERE id = ? AND company_id = ?')
      .run(orderId, currentCompanyId);
    if (deleted.changes !== 1) {
      sendJson(res, { error: 'Order is no longer available' }, 404);
      return true;
    }
    sendJson(res, { success: true });
    return true;
  }

  // Restaurant endpoints are not implemented; report that explicitly instead
  // of returning fake business data.
  if (pathname.startsWith('/api/') && pathname.includes('/restaurant-properties/')) {
    sendJson(res, { error: 'Restaurant properties are not implemented', code: 'API_NOT_IMPLEMENTED' }, 501);
    return true;
  }
  if (pathname.startsWith('/api/') && pathname.includes('/restaurant-runs/')) {
    sendJson(res, { error: 'Restaurant runs are not implemented', code: 'API_NOT_IMPLEMENTED' }, 501);
    return true;
  }
  return false;
}
