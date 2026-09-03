import type { IncomingMessage, ServerResponse } from 'node:http';
import { RouteRegistry, globalRouteRegistry } from '../http/route-registry.ts';
import { sendJson, readJsonBody } from './utils.ts';
import { getWarehouseResources } from '../game/warehouse.ts';
import { warehouseRepository } from '../repositories/warehouse-repository.ts';
import { getWarehouseContractsSummaryQuery } from '../application/finance/finance-use-cases.ts';

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
  //    GET lists; PUT { kind, tag } upserts.
  if (pathname.startsWith('/api/') && (pathname.includes('/warehouse/tags/') || pathname.includes('/warehouse-tags/'))) {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    if (_method === 'PUT' || _method === 'POST') {
      const body = await readJsonBody<{ kind?: number; tag?: string }>(_req);
      if (!Number.isSafeInteger(Number(body.kind)) || typeof body.tag !== 'string') {
        sendJson(res, { error: 'kind and tag are required' }, 400);
        return true;
      }
      warehouseRepository.setTag(currentCompanyId, Number(body.kind), body.tag.slice(0, 64));
      sendJson(res, { success: true });
      return true;
    }
    sendJson(res, warehouseRepository.listTags(currentCompanyId));
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
    const compId = summaryMatch[1] === 'me' ? currentCompanyId : Number(summaryMatch[1]);
    if (!currentCompanyId || compId !== currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    sendJson(res, { summary: getWarehouseContractsSummaryQuery(compId) }, 200, { 'x-timestamp': new Date().toISOString() });
    return true;
  }

  // 5. Resource transactions: /api/v2/resources-transactions/:kind/:fromId/ or /api/v2/resources-transactions/:companyId/:kind/
  const resTxMatch = pathname.match(/^\/api\/v2\/resources-transactions\/(\d+|me)\/(\d+)\/?$/);
  if (resTxMatch) {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    const param1 = resTxMatch[1] === 'me' ? currentCompanyId : Number(resTxMatch[1]);
    const param2 = Number(resTxMatch[2]);

    // If param1 equals currentCompanyId, param2 is kind. Otherwise param1 is kind and param2 is fromId/offset.
    const kind = param1 === currentCompanyId ? param2 : param1;
    const transactions = warehouseRepository.listResourceTransactions(currentCompanyId, kind);
    sendJson(res, transactions);
    return true;
  }

  // 6. Resource transactions summary: /api/v2/resources-transactions-summary/:companyId/:kind/ or /:kind/:days/
  const resTxSummaryMatch = pathname.match(/^\/api\/v2\/resources-transactions-summary\/(\d+|me)\/(\d+)\/?$/);
  if (resTxSummaryMatch) {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    const param1 = resTxSummaryMatch[1] === 'me' ? currentCompanyId : Number(resTxSummaryMatch[1]);
    const param2 = Number(resTxSummaryMatch[2]);
    const kind = param1 === currentCompanyId ? param2 : param1;

    const summary = warehouseRepository.getResourceTransactionSummary(currentCompanyId, kind);
    const rows: Array<{ category: string; amount: number; avgPrice: number; price: number }> = [];
    if (summary.totalBought > 0) {
      rows.push({
        category: 'bought',
        amount: summary.totalBought,
        avgPrice: summary.avgBuyPrice,
        price: summary.avgBuyPrice
      });
    }
    if (summary.totalSold > 0) {
      rows.push({
        category: 'sold',
        amount: summary.totalSold,
        avgPrice: summary.avgSellPrice,
        price: summary.avgSellPrice
      });
    }

    sendJson(res, rows);
    return true;
  }

  return false;
}
export function registerWarehouseRoutes(registry: RouteRegistry = globalRouteRegistry): void {
  const bodyField = (body: unknown, field: string): unknown => {
    if (!body || typeof body !== 'object' || !(field in body)) return undefined;
    return Reflect.get(body, field);
  };
  const companyFor = (ctx: { companyId: number } | null, raw: string): number | null => {
    const companyId = raw === 'me' ? ctx?.companyId ?? null : Number(raw);
    return ctx?.companyId && companyId === ctx.companyId ? companyId : null;
  };
  const requireCompany = (ctx: { companyId: number } | null, res: ServerResponse): number | null => {
    if (!ctx?.companyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return null;
    }
    return ctx.companyId;
  };
  const resourceTransactions = (res: ServerResponse, companyId: number, a: string, b: string): void => {
    const param1 = a === 'me' ? companyId : Number(a);
    const param2 = Number(b);
    const kind = param1 === companyId ? param2 : param1;
    sendJson(res, warehouseRepository.listResourceTransactions(companyId, kind));
  };
  const resourceSummary = (res: ServerResponse, companyId: number, a: string, b: string): void => {
    const param1 = a === 'me' ? companyId : Number(a);
    const param2 = Number(b);
    const kind = param1 === companyId ? param2 : param1;
    const summary = warehouseRepository.getResourceTransactionSummary(companyId, kind);
    const rows: Array<{ category: string; amount: number; avgPrice: number; price: number }> = [];
    if (summary.totalBought > 0) rows.push({ category: 'bought', amount: summary.totalBought, avgPrice: summary.avgBuyPrice, price: summary.avgBuyPrice });
    if (summary.totalSold > 0) rows.push({ category: 'sold', amount: summary.totalSold, avgPrice: summary.avgSellPrice, price: summary.avgSellPrice });
    sendJson(res, rows);
  };

  registry
    .register({
      method: 'GET', pattern: '/api/v2/resources/:companyId/', owner: 'warehouse',
      handler: async (_req, res, ctx, params) => {
        const companyId = companyFor(ctx, params.companyId);
        if (companyId === null) {
          sendJson(res, { error: 'Unauthorized' }, 401);
          return;
        }
        sendJson(res, getWarehouseResources(companyId));
      }
    })
    .register({
      method: 'GET', pattern: '/api/v3/resources/:companyId/', owner: 'warehouse',
      handler: async (_req, res, ctx, params) => {
        const companyId = companyFor(ctx, params.companyId);
        if (companyId === null) {
          sendJson(res, { error: 'Unauthorized' }, 401);
          return;
        }
        sendJson(res, getWarehouseResources(companyId));
      }
    })
    .register({
      method: 'GET', pattern: '/api/v2/companies/:companyId/warehouse/tags/', owner: 'warehouse',
      handler: async (_req, res, ctx) => {
        const companyId = requireCompany(ctx, res);
        if (companyId !== null) sendJson(res, warehouseRepository.listTags(companyId));
      }
    })
    .register({
      method: 'PUT', pattern: '/api/v2/companies/:companyId/warehouse/tags/', owner: 'warehouse',
      handler: async (_req, res, ctx, _params, body) => {
        const companyId = requireCompany(ctx, res);
        if (companyId === null) return;
        const kind = bodyField(body, 'kind');
        const tag = bodyField(body, 'tag');
        if (!Number.isSafeInteger(Number(kind)) || typeof tag !== 'string') {
          sendJson(res, { error: 'kind and tag are required' }, 400);
          return;
        }
        warehouseRepository.setTag(companyId, Number(kind), tag.slice(0, 64));
        sendJson(res, { success: true });
      }
    })
    .register({
      method: 'POST', pattern: '/api/v2/companies/:companyId/warehouse/tags/', owner: 'warehouse',
      handler: async (_req, res, ctx, _params, body) => {
        const companyId = requireCompany(ctx, res);
        if (companyId === null) return;
        const kind = bodyField(body, 'kind');
        const tag = bodyField(body, 'tag');
        if (!Number.isSafeInteger(Number(kind)) || typeof tag !== 'string') {
          sendJson(res, { error: 'kind and tag are required' }, 400);
          return;
        }
        warehouseRepository.setTag(companyId, Number(kind), tag.slice(0, 64));
        sendJson(res, { success: true });
      }
    })
    .register({
      method: 'GET', pattern: '/api/v2/warehouse/tags/', owner: 'warehouse',
      handler: async (_req, res, ctx) => {
        const companyId = requireCompany(ctx, res);
        if (companyId !== null) sendJson(res, warehouseRepository.listTags(companyId));
      }
    })
    .register({
      method: 'PUT', pattern: '/api/v2/warehouse/tags/', owner: 'warehouse',
      handler: async (_req, res, ctx, _params, body) => {
        const companyId = requireCompany(ctx, res);
        if (companyId === null) return;
        const kind = bodyField(body, 'kind');
        const tag = bodyField(body, 'tag');
        if (!Number.isSafeInteger(Number(kind)) || typeof tag !== 'string') {
          sendJson(res, { error: 'kind and tag are required' }, 400);
          return;
        }
        warehouseRepository.setTag(companyId, Number(kind), tag.slice(0, 64));
        sendJson(res, { success: true });
      }
    })
    .register({
      method: 'POST', pattern: '/api/v2/warehouse/tags/', owner: 'warehouse',
      handler: async (_req, res, ctx, _params, body) => {
        const companyId = requireCompany(ctx, res);
        if (companyId === null) return;
        const kind = bodyField(body, 'kind');
        const tag = bodyField(body, 'tag');
        if (!Number.isSafeInteger(Number(kind)) || typeof tag !== 'string') {
          sendJson(res, { error: 'kind and tag are required' }, 400);
          return;
        }
        warehouseRepository.setTag(companyId, Number(kind), tag.slice(0, 64));
        sendJson(res, { success: true });
      }
    })
    .register({
      method: 'GET', pattern: '/api/v2/warehouse-tags/', owner: 'warehouse',
      handler: async (_req, res, ctx) => {
        const companyId = requireCompany(ctx, res);
        if (companyId !== null) sendJson(res, warehouseRepository.listTags(companyId));
      }
    })
    .register({
      method: 'PUT', pattern: '/api/v2/warehouse-tags/', owner: 'warehouse',
      handler: async (_req, res, ctx, _params, body) => {
        const companyId = requireCompany(ctx, res);
        if (companyId === null) return;
        const kind = bodyField(body, 'kind');
        const tag = bodyField(body, 'tag');
        if (!Number.isSafeInteger(Number(kind)) || typeof tag !== 'string') {
          sendJson(res, { error: 'kind and tag are required' }, 400);
          return;
        }
        warehouseRepository.setTag(companyId, Number(kind), tag.slice(0, 64));
        sendJson(res, { success: true });
      }
    })
    .register({
      method: 'POST', pattern: '/api/v2/warehouse-tags/', owner: 'warehouse',
      handler: async (_req, res, ctx, _params, body) => {
        const companyId = requireCompany(ctx, res);
        if (companyId === null) return;
        const kind = bodyField(body, 'kind');
        const tag = bodyField(body, 'tag');
        if (!Number.isSafeInteger(Number(kind)) || typeof tag !== 'string') {
          sendJson(res, { error: 'kind and tag are required' }, 400);
          return;
        }
        warehouseRepository.setTag(companyId, Number(kind), tag.slice(0, 64));
        sendJson(res, { success: true });
      }
    })
    .register({
      method: 'GET', pattern: '/api/v2/egg-collection/', owner: 'warehouse',
      handler: async (_req, res) => { sendJson(res, { eggs: [], swaps: [] }); }
    })
    .register({
      method: 'GET', pattern: '/api/v2/egg-swaps/', owner: 'warehouse',
      handler: async (_req, res) => { sendJson(res, { eggs: [], swaps: [] }); }
    })
    .register({
      method: 'GET', pattern: '/api/v2/warehouse-contracts-summary/:companyId/:type/', owner: 'warehouse',
      handler: async (_req, res, ctx, params) => {
        const companyId = companyFor(ctx, params.companyId);
        if (companyId === null) {
          sendJson(res, { error: 'Unauthorized' }, 401);
          return;
        }
        sendJson(res, { summary: getWarehouseContractsSummaryQuery(companyId) }, 200, { 'x-timestamp': new Date().toISOString() });
      }
    })
    .register({
      method: 'GET', pattern: '/api/v2/resources-transactions/:param1/:param2/', owner: 'warehouse',
      handler: async (_req, res, ctx, params) => {
        const companyId = requireCompany(ctx, res);
        if (companyId !== null) resourceTransactions(res, companyId, params.param1, params.param2);
      }
    })
    .register({
      method: 'GET', pattern: '/api/v2/resources-transactions-summary/:param1/:param2/', owner: 'warehouse',
      handler: async (_req, res, ctx, params) => {
        const companyId = requireCompany(ctx, res);
        if (companyId !== null) resourceSummary(res, companyId, params.param1, params.param2);
      }
    });
}

registerWarehouseRoutes(globalRouteRegistry);
