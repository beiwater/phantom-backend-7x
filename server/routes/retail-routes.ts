/**
 * Retail routes (Issue #105 Phase 4 / Issue #104 Stage 3).
 * Protocol layer only: parse HTTP, resolve auth + GameContext, dispatch to
 * application/retail use cases, map repository entities to frontend DTOs.
 * No SQL, no business rules here.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson, setPreparsedBody } from './utils.ts';
import { createGameContext } from '../context/game-context.ts';
import { buildingRepository } from '../repositories/building-repository.ts';
import { companyRepository } from '../repositories/company-repository.ts';
import { retailRepository } from '../repositories/retail-repository.ts';
import {
  formatRetailOrder,
  formatSalesOfficeOrder,
  getSalesOfficeSearchFee,
  startRetailOrderUseCase,
  collectRetailOrderUseCase,
  cancelRetailOrderUseCase,
  findSalesOfficeCustomerUseCase
} from '../application/retail/retail-use-cases.ts';
import { RouteRegistry, globalRouteRegistry, type HttpMethod } from '../http/route-registry.ts';

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
    const scopedBuilding = buildingId === undefined ? null : buildingRepository.findById(buildingId);

    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }

    const companyRealmId = companyRepository.findById(currentCompanyId)?.realmId ?? 0;

    if (buildingId !== undefined) {
      if (!scopedBuilding || scopedBuilding.companyId !== currentCompanyId) {
        sendJson(res, { error: 'Unauthorized' }, 401);
        return true;
      }
    }

    if (method === 'GET') {
      if (orderId !== undefined) {
        const order = retailRepository.findById(orderId);
        if (!order) {
          sendJson(res, { error: 'Order not found' }, 404);
          return true;
        }
        if (order.companyId !== currentCompanyId || (buildingId !== undefined && order.buildingId !== buildingId)) {
          sendJson(res, { error: 'Unauthorized' }, 401);
          return true;
        }
        sendJson(res, scopedBuilding?.kind === 'B'
          ? formatSalesOfficeOrder(order, getSalesOfficeSearchFee(scopedBuilding.size))
          : formatRetailOrder(order));
        return true;
      }

      const orders: RetailOrderEntity[] = buildingId === undefined
        ? retailRepository.findByCompany(currentCompanyId)
        : retailRepository.findByCompanyAndBuilding(currentCompanyId, buildingId);
      sendJson(res, orders.map(order => {
        const orderBuilding = scopedBuilding ?? buildingRepository.findById(order.buildingId);
        return orderBuilding?.kind === 'B'
          ? formatSalesOfficeOrder(order, getSalesOfficeSearchFee(orderBuilding.size))
          : formatRetailOrder(order);
      }));
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
      try {
        const ctx = createGameContext(currentCompanyId, currentCompanyId, companyRealmId);
        const targetBuildingId = buildingId ?? body.building;
        // #153: a Sales Office has no retail products — POSTing here is the
        // original "look for customer" flow: charge the search fee and open
        // an unfinished aerospace contract.
        if (targetBuildingId !== undefined) {
          const b = buildingRepository.findById(Number(targetBuildingId));
          if (b && b.kind === 'B') {
            const found = await findSalesOfficeCustomerUseCase(ctx, b.id);
            sendJson(res, { ...found.salesOrder, salesOrder: found.salesOrder, money: found.money });
            return true;
          }
        }
        const result = await startRetailOrderUseCase(ctx, {
          buildingId: targetBuildingId !== undefined ? Number(targetBuildingId) : undefined,
          resource: body.resource,
          quality: body.quality,
          units: body.units,
          sellingPrice: body.sellingPrice
        });
        sendJson(res, {
          ...result.salesOrder,
          salesOrder: result.salesOrder,
          // Creating a retail order does not change the cash balance.
          money: result.money
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, { error: msg }, 400);
      }
      return true;
    }

    if ((method === 'PUT' || method === 'DELETE') && orderId !== undefined) {
      const order = retailRepository.findById(orderId);
      if (!order) {
        sendJson(res, { error: 'Order not found' }, 404);
        return true;
      }
      if (order.companyId !== currentCompanyId || (buildingId !== undefined && order.buildingId !== buildingId)) {
        sendJson(res, { error: 'Unauthorized' }, 401);
        return true;
      }

      const ctx = createGameContext(currentCompanyId, currentCompanyId, companyRealmId);
      try {
        if (method === 'PUT') {
          const body = req.headers['content-type']?.includes('application/json')
            ? await readJsonBody<Record<string, unknown>>(req).catch(() => ({}))
            : {};
          const result = await collectRetailOrderUseCase(ctx, orderId, {
            lowestQualityFirst: typeof body?.lowestQualityFirst === 'boolean' ? body.lowestQualityFirst : undefined,
            highestQualityFirst: typeof body?.highestQualityFirst === 'boolean' ? body.highestQualityFirst : undefined
          });
          sendJson(res, result);
        } else {
          await cancelRetailOrderUseCase(ctx, orderId);
          sendJson(res, { success: true });
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        const status = msg.includes('not found') || msg.includes('no longer available') ? 404 : 400;
        sendJson(res, { error: msg }, status);
      }
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
    const order = retailRepository.findById(orderId);
    if (!order) {
      sendJson(res, { error: 'Order not found' }, 404);
      return true;
    }
    if (order.companyId !== currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    if (method === 'GET') {
      sendJson(res, formatRetailOrder(order));
      return true;
    }
    const companyRealmId = companyRepository.findById(currentCompanyId)?.realmId ?? 0;
    const ctx = createGameContext(currentCompanyId, currentCompanyId, companyRealmId);
    try {
      if (method === 'PUT') {
        const body = req.headers['content-type']?.includes('application/json')
          ? await readJsonBody<Record<string, unknown>>(req).catch(() => ({}))
          : {};
        const result = await collectRetailOrderUseCase(ctx, orderId, {
          lowestQualityFirst: typeof body?.lowestQualityFirst === 'boolean' ? body.lowestQualityFirst : undefined,
          highestQualityFirst: typeof body?.highestQualityFirst === 'boolean' ? body.highestQualityFirst : undefined
        });
        sendJson(res, result);
      } else {
        await cancelRetailOrderUseCase(ctx, orderId);
        sendJson(res, { success: true });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = msg.includes('not found') || msg.includes('no longer available') ? 404 : 400;
      sendJson(res, { error: msg }, status);
    }
    return true;
  }

  return false;
}

export function registerRetailRoutes(registry: RouteRegistry = globalRouteRegistry): void {
  const register = (method: HttpMethod, pattern: string): void => {
    registry.register({
      method,
      pattern,
      owner: 'retail',
      handler: async (req, res, ctx, _params, body) => {
        if (method === 'POST' || method === 'PATCH' || method === 'PUT') {
          setPreparsedBody(req, body);
        }
        const pathname = new URL(req.url || '/', 'http://localhost').pathname;
        await handleRetailRoutes(req, res, pathname, method, ctx?.companyId ?? null);
      }
    });
  };

  register('GET', '/api/v1/sales-orders/');
  register('POST', '/api/v1/sales-orders/');
  register('GET', '/api/v2/sales-orders/');
  register('POST', '/api/v2/sales-orders/');
  register('GET', '/api/v1/sales-orders/:orderId/');
  register('PUT', '/api/v1/sales-orders/:orderId/');
  register('DELETE', '/api/v1/sales-orders/:orderId/');
  register('GET', '/api/v2/sales-orders/:orderId/');
  register('PUT', '/api/v2/sales-orders/:orderId/');
  register('DELETE', '/api/v2/sales-orders/:orderId/');
  register('GET', '/api/v2/companies/buildings/:buildingId/sales-orders/');
  register('POST', '/api/v2/companies/buildings/:buildingId/sales-orders/');
  register('GET', '/api/v2/companies/buildings/:buildingId/sales-orders/:orderId/');
  register('PUT', '/api/v2/companies/buildings/:buildingId/sales-orders/:orderId/');
  register('DELETE', '/api/v2/companies/buildings/:buildingId/sales-orders/:orderId/');
}

registerRetailRoutes(globalRouteRegistry);
