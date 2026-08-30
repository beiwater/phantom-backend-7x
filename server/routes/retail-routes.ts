import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson } from './utils.ts';
import { db } from '../db/database.ts';
import { updateCompanyMoney, getCompanyById } from '../game/company.ts';
import { getWarehouseItem, consumeResource } from '../game/warehouse.ts';

export interface RetailDbRow {
  id: number;
  building_id: number;
  company_id: number;
  resource_kind: number;
  units: number;
  selling_price: number;
  cost_total: number;
  finished_at: string;
  created_at: string;
}

export async function handleRetailRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  currentCompanyId: number | null
): Promise<boolean> {
  // 1. Retail / Sales orders list or create
  if (pathname === '/api/v1/sales-orders/' || pathname === '/api/v2/sales-orders/') {
    if (method === 'GET') {
      const companyId = currentCompanyId || 4259175;
      const orders = db.prepare(`
        SELECT * FROM retail_orders WHERE company_id = ? ORDER BY id DESC
      `).all(companyId) as unknown as RetailDbRow[];

      sendJson(res, orders.map(o => ({
        id: o.id,
        building: o.building_id,
        resource: { kind: o.resource_kind },
        units: o.units,
        sellingPrice: o.selling_price,
        costTotal: o.cost_total,
        finishedAt: o.finished_at,
        createdAt: o.created_at
      })));
      return true;
    }

    if (method === 'POST') {
      if (!currentCompanyId) {
        sendJson(res, { error: 'Unauthorized' }, 401);
        return true;
      }
      const body = await readJsonBody<{
        building: number;
        resource: number;
        units: number;
        sellingPrice?: number;
      }>(req);

      const item = getWarehouseItem(currentCompanyId, body.resource);
      if (!item || item.amount < body.units) {
        sendJson(res, { error: 'Insufficient stock in warehouse to retail' }, 400);
        return true;
      }

      const retailPrice = body.sellingPrice || 2.5;
      const costTotal = body.units * 1.5;
      const finishedAt = new Date(Date.now() + 5000).toISOString();

      const stmt = db.prepare(`
        INSERT INTO retail_orders (building_id, company_id, resource_kind, units, selling_price, cost_total, finished_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      const result = stmt.run(
        body.building,
        currentCompanyId,
        body.resource,
        body.units,
        retailPrice,
        costTotal,
        finishedAt
      );

      sendJson(res, {
        id: Number(result.lastInsertRowid),
        building: body.building,
        resource: { kind: body.resource },
        units: body.units,
        sellingPrice: retailPrice,
        costTotal,
        finishedAt,
        createdAt: new Date().toISOString()
      });
      return true;
    }
  }

  // 2. Individual sales order operations (PUT / DELETE)
  const singleSalesOrderMatch = pathname.match(/^\/api\/v[12]\/sales-orders\/(\d+)\/$/);
  if (singleSalesOrderMatch) {
    const orderId = Number(singleSalesOrderMatch[1]);
    const order = db.prepare('SELECT * FROM retail_orders WHERE id = ?').get(orderId) as RetailDbRow | undefined;

    if (!order) {
      sendJson(res, { error: 'Order not found' }, 404);
      return true;
    }

    if (method === 'PUT') {
      if (!currentCompanyId || order.company_id !== currentCompanyId) {
        sendJson(res, { error: 'Unauthorized' }, 401);
        return true;
      }

      const comp = getCompanyById(currentCompanyId);
      if (!comp) {
        sendJson(res, { error: 'Company not found' }, 404);
        return true;
      }

      const revenue = order.units * order.selling_price;
      const newMoney = comp.money + revenue;

      db.exec('BEGIN');
      try {
        consumeResource(currentCompanyId, order.resource_kind, 0, order.units);
        updateCompanyMoney(currentCompanyId, newMoney);
        db.prepare('DELETE FROM retail_orders WHERE id = ?').run(orderId);
        db.exec('COMMIT');

        sendJson(res, {
          success: true,
          revenue,
          money: newMoney,
          resource: {
            kind: order.resource_kind,
            units: -order.units
          }
        });
        return true;
      } catch (err: unknown) {
        db.exec('ROLLBACK');
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, { error: msg }, 400);
        return true;
      }
    }

    if (method === 'DELETE') {
      db.prepare('DELETE FROM retail_orders WHERE id = ?').run(orderId);
      sendJson(res, { success: true });
      return true;
    }
  }

  // 3. Restaurant endpoints
  if (pathname.includes('/restaurant-properties/')) {
    sendJson(res, {
      rating: 4.5,
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
