import type { IncomingMessage, ServerResponse } from 'node:http';
import { RouteRegistry, globalRouteRegistry } from '../http/route-registry.ts';
import { sendJson, readJsonBody } from './utils.ts';
import {
  getGovernmentOrders,
  getGovernmentOrderById,
  getGovernmentTier,
  getGovernmentBids,
  getGovernmentBidByIdOrSecret,
  createGovernmentBid,
  updateGovernmentBid,
  deleteGovernmentBid,
  joinGovernmentBid,
  leaveOrRemoveContractor,
  getBlockedCompanies,
  blockCompany,
  unblockCompany,
  getCompanyGovernmentApplications,
  getCompanyGovernmentBids,
  fulfillGovernmentOrderContractor
} from '../game/government.ts';

export async function handleGovernmentRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  currentCompanyId: number | null
): Promise<boolean> {
  // Only handle government orders endpoints (ignoring page guide articles)
  if (!pathname.startsWith('/api/') || pathname.includes('/pages/') || !pathname.includes('/government-orders/')) {
    return false;
  }

  // 1. Company tier endpoint: GET /api/v3/government-orders/tier/
  if (pathname === '/api/v3/government-orders/tier/' || pathname === '/api/v3/government-orders/tier') {
    if (method === 'GET') {
      const tierInfo = getGovernmentTier(currentCompanyId);
      sendJson(res, tierInfo);
      return true;
    }
    return false;
  }

  // 2. Company bids and applications
  // GET /api/v3/government-orders/company/:companyId/bids/
  const companyBidsMatch = pathname.match(/^\/api\/v3\/government-orders\/company\/(\d+)\/bids\/?$/);
  if (companyBidsMatch) {
    if (method === 'GET') {
      const targetCompanyId = Number(companyBidsMatch[1]);
      sendJson(res, getCompanyGovernmentBids(targetCompanyId));
      return true;
    }
    return false;
  }

  // GET /api/v3/government-orders/company/:companyId/
  const companyAppsMatch = pathname.match(/^\/api\/v3\/government-orders\/company\/(\d+)\/?$/);
  if (companyAppsMatch) {
    if (method === 'GET') {
      const targetCompanyId = Number(companyAppsMatch[1]);
      sendJson(res, getCompanyGovernmentApplications(targetCompanyId));
      return true;
    }
    return false;
  }

  // 3. Blocked companies
  // DELETE /api/v3/government-orders/bids/:id/blocked-companies/:companyId/
  const unblockMatch = pathname.match(/^\/api\/v3\/government-orders\/bids\/([^/]+)\/blocked-companies\/(\d+)\/?$/);
  if (unblockMatch) {
    if (method === 'DELETE') {
      const secret = unblockMatch[1];
      const blockedCompanyId = Number(unblockMatch[2]);
      unblockCompany(secret, blockedCompanyId);
      sendJson(res, { success: true });
      return true;
    }
    return false;
  }

  // GET or POST /api/v3/government-orders/bids/:id/blocked-companies/
  const blockedListMatch = pathname.match(/^\/api\/v3\/government-orders\/bids\/([^/]+)\/blocked-companies\/?$/);
  if (blockedListMatch) {
    const secret = blockedListMatch[1];
    if (method === 'GET') {
      sendJson(res, getBlockedCompanies(secret));
      return true;
    }
    if (method === 'POST') {
      try {
        const body = await readJsonBody<{ companyId: number }>(req);
        blockCompany(secret, Number(body.companyId));
        sendJson(res, { success: true, ...getBlockedCompanies(secret) });
        return true;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        sendJson(res, { error: message }, 400);
        return true;
      }
    }
    return false;
  }

  // 4. Contractors endpoints
  // PATCH or DELETE /api/v3/government-orders/bids/:id/contractors/:contractorId/
  const contractorActionMatch = pathname.match(/^\/api\/v3\/government-orders\/bids\/([^/]+)\/contractors\/(\d+)\/?$/);
  if (contractorActionMatch) {
    const secret = contractorActionMatch[1];
    const targetCompanyId = Number(contractorActionMatch[2]);

    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }

    if (method === 'PATCH') {
      try {
        const result = fulfillGovernmentOrderContractor(secret, currentCompanyId, targetCompanyId);
        sendJson(res, result);
        return true;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        sendJson(res, { error: message }, 400);
        return true;
      }
    }

    if (method === 'DELETE') {
      try {
        const updated = leaveOrRemoveContractor(secret, currentCompanyId, targetCompanyId);
        sendJson(res, updated);
        return true;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        sendJson(res, { error: message }, 400);
        return true;
      }
    }
    return false;
  }

  // GET or POST /api/v3/government-orders/bids/:id/contractors/
  const contractorsListMatch = pathname.match(/^\/api\/v3\/government-orders\/bids\/([^/]+)\/contractors\/?$/);
  if (contractorsListMatch) {
    const secret = contractorsListMatch[1];
    const bid = getGovernmentBidByIdOrSecret(secret);
    if (!bid) {
      sendJson(res, { error: 'Bid not found' }, 404);
      return true;
    }

    if (method === 'GET') {
      sendJson(res, bid.governmentorderbidderSet);
      return true;
    }

    if (method === 'POST') {
      if (!currentCompanyId) {
        sendJson(res, { error: 'Unauthorized' }, 401);
        return true;
      }
      try {
        const updated = joinGovernmentBid(secret, currentCompanyId);
        sendJson(res, updated);
        return true;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        sendJson(res, { error: message }, 400);
        return true;
      }
    }
    return false;
  }

  // 5. Bid details, update, delete
  // GET, PATCH, DELETE /api/v3/government-orders/bids/:id/
  const singleBidMatch = pathname.match(/^\/api\/v3\/government-orders\/bids\/([^/]+)\/?$/);
  if (singleBidMatch) {
    const secret = singleBidMatch[1];
    if (method === 'GET') {
      const bid = getGovernmentBidByIdOrSecret(secret);
      if (!bid) {
        sendJson(res, { error: 'Bid not found' }, 404);
        return true;
      }
      sendJson(res, bid);
      return true;
    }

    if (method === 'PATCH') {
      if (!currentCompanyId) {
        sendJson(res, { error: 'Unauthorized' }, 401);
        return true;
      }
      try {
        const body = await readJsonBody<{
          maxContractorCount?: number;
          isPublic?: boolean;
          minimumRequiredTierIndex?: number;
          resourcePriceBreakdown?: Record<string, number> | string;
          note?: string;
        }>(req);
        const updated = updateGovernmentBid(secret, currentCompanyId, body);
        sendJson(res, updated);
        return true;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        sendJson(res, { error: message }, 400);
        return true;
      }
    }

    if (method === 'DELETE') {
      if (!currentCompanyId) {
        sendJson(res, { error: 'Unauthorized' }, 401);
        return true;
      }
      try {
        deleteGovernmentBid(secret, currentCompanyId);
        sendJson(res, { success: true });
        return true;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        sendJson(res, { error: message }, 400);
        return true;
      }
    }
    return false;
  }

  // 6. Template bids listing or create bid
  // GET or POST /api/v3/government-orders/realm/:realmId/bids/ or /api/v3/government-orders/bids/
  const realmBidsMatch = pathname.match(/^\/api\/v3\/government-orders\/(?:realm\/(\d+)\/)?bids\/?$/);
  if (realmBidsMatch) {
    const realmParam = realmBidsMatch[1] ? Number(realmBidsMatch[1]) : 0;

    if (method === 'GET') {
      const template = getGovernmentOrderById(realmParam);
      if (template) {
        const applications = getGovernmentBids(template.realm).filter(b => b.templateId === realmParam);
        sendJson(res, { applications, template });
      } else {
        const applications = getGovernmentBids(realmParam);
        sendJson(res, { applications });
      }
      return true;
    }

    if (method === 'POST') {
      if (!currentCompanyId) {
        sendJson(res, { error: 'Unauthorized' }, 401);
        return true;
      }
      try {
        const body = await readJsonBody<{
          templateId?: number;
          orderId?: number;
          template_id?: number;
          maxContractorCount?: number;
          contractors?: number[] | Array<{ companyId: number }>;
          isPublic?: boolean;
          minimumRequiredTierIndex?: number;
          resourcePriceBreakdown?: Record<string, number> | string;
          note?: string;
        }>(req);

        const templateId = body.templateId ?? body.orderId ?? body.template_id ?? (realmParam > 0 ? realmParam : 1);
        const bid = createGovernmentBid(currentCompanyId, 0, {
          ...body,
          templateId
        });
        sendJson(res, bid, 201);
        return true;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        sendJson(res, { error: message }, 400);
        return true;
      }
    }
    return false;
  }

  // 7. Orders / Projects list or template detail
  // GET /api/v3/government-orders/ or GET /api/v3/government-orders/realm/:realmId/ or GET /api/v3/government-orders/:realmId/
  const ordersMatch = pathname.match(/^\/api\/v3\/government-orders\/(?:realm\/)?(\d+)?\/?$/);
  if (ordersMatch) {
    if (method === 'GET') {
      const idOrRealm = ordersMatch[1] ? Number(ordersMatch[1]) : 0;
      const template = getGovernmentOrderById(idOrRealm);
      if (template) {
        // Return single template combined with governmentOrders list for compatibility
        sendJson(res, {
          ...template,
          governmentOrders: getGovernmentOrders(template.realm),
          orders: getGovernmentOrders(template.realm)
        });
      } else {
        const orders = getGovernmentOrders(idOrRealm);
        sendJson(res, { governmentOrders: orders, orders });
      }
      return true;
    }
    return false;
  }

  return false;
}
export function registerGovernmentRoutes(registry: RouteRegistry = globalRouteRegistry): void {
  const bodyField = (body: unknown, field: string): unknown => {
    if (!body || typeof body !== 'object' || !(field in body)) return undefined;
    return Reflect.get(body, field);
  };
  const companyRequired = (ctx: { companyId: number } | null, res: ServerResponse): number | null => {
    const companyId = ctx?.companyId ?? null;
    if (!companyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return null;
    }
    return companyId;
  };
  const commandError = (err: unknown): { error: string } => ({
    error: err instanceof Error ? err.message : 'Unknown error'
  });
  const companyIdFromContext = (ctx: { companyId: number } | null): number | null => ctx?.companyId ?? null;
  const contextRealm = (ctx: { realmId: number } | null): number => ctx?.realmId ?? 0;
  const sendProject = (res: ServerResponse, projectId: number): void => {
    const validProjectId = Number.isFinite(projectId) ? projectId : 0;
    const project = getGovernmentOrderById(validProjectId);
    const orders = project ? getGovernmentOrders(project.realm) : [];
    sendJson(
      res,
      project
        ? { ...project, governmentOrders: orders, orders }
        : { error: 'Government order project not found' },
      project ? 200 : 404
    );
  };
  const sendOrderList = (res: ServerResponse, realmId: number): void => {
    const validRealmId = Number.isFinite(realmId) ? realmId : 0;
    const orders = getGovernmentOrders(validRealmId);
    sendJson(res, { governmentOrders: orders, orders });
  };

  registry
    .register({
      method: 'GET', pattern: '/api/v3/government-orders/tier/', owner: 'government',
      handler: async (_req, res, ctx) => { sendJson(res, getGovernmentTier(companyIdFromContext(ctx))); }
    })
    .register({
      method: 'GET', pattern: '/api/v3/government-orders/company/:companyId/bids/', owner: 'government',
      handler: async (_req, res, _ctx, params) => { sendJson(res, getCompanyGovernmentBids(Number(params.companyId))); }
    })
    .register({
      method: 'GET', pattern: '/api/v3/government-orders/company/:companyId/', owner: 'government',
      handler: async (_req, res, _ctx, params) => { sendJson(res, getCompanyGovernmentApplications(Number(params.companyId))); }
    })
    .register({
      method: 'DELETE', pattern: '/api/v3/government-orders/bids/:secret/blocked-companies/:companyId/', owner: 'government',
      handler: async (_req, res, _ctx, params) => {
        unblockCompany(params.secret, Number(params.companyId));
        sendJson(res, { success: true });
      }
    })
    .register({
      method: 'GET', pattern: '/api/v3/government-orders/bids/:secret/blocked-companies/', owner: 'government',
      handler: async (_req, res, _ctx, params) => { sendJson(res, getBlockedCompanies(params.secret)); }
    })
    .register({
      method: 'POST', pattern: '/api/v3/government-orders/bids/:secret/blocked-companies/', owner: 'government',
      handler: async (_req, res, _ctx, params, body) => {
        try {
          blockCompany(params.secret, Number(bodyField(body, 'companyId')));
          sendJson(res, { success: true, ...getBlockedCompanies(params.secret) });
        } catch (err: unknown) { sendJson(res, commandError(err), 400); }
      }
    })
    .register({
      method: 'PATCH', pattern: '/api/v3/government-orders/bids/:secret/contractors/:contractorId/', owner: 'government',
      handler: async (_req, res, ctx, params) => {
        const companyId = companyRequired(ctx, res);
        if (!companyId) return;
        try { sendJson(res, fulfillGovernmentOrderContractor(params.secret, companyId, Number(params.contractorId))); }
        catch (err: unknown) { sendJson(res, commandError(err), 400); }
      }
    })
    .register({
      method: 'DELETE', pattern: '/api/v3/government-orders/bids/:secret/contractors/:contractorId/', owner: 'government',
      handler: async (_req, res, ctx, params) => {
        const companyId = companyRequired(ctx, res);
        if (!companyId) return;
        try { sendJson(res, leaveOrRemoveContractor(params.secret, companyId, Number(params.contractorId))); }
        catch (err: unknown) { sendJson(res, commandError(err), 400); }
      }
    })
    .register({
      method: 'GET', pattern: '/api/v3/government-orders/bids/:secret/contractors/', owner: 'government',
      handler: async (_req, res, _ctx, params) => {
        const bid = getGovernmentBidByIdOrSecret(params.secret);
        sendJson(res, bid ? bid.governmentorderbidderSet : { error: 'Bid not found' }, bid ? 200 : 404);
      }
    })
    .register({
      method: 'POST', pattern: '/api/v3/government-orders/bids/:secret/contractors/', owner: 'government',
      handler: async (_req, res, ctx, params) => {
        const companyId = companyRequired(ctx, res);
        if (!companyId) return;
        const bid = getGovernmentBidByIdOrSecret(params.secret);
        if (!bid) {
          sendJson(res, { error: 'Bid not found' }, 404);
          return;
        }
        try { sendJson(res, joinGovernmentBid(params.secret, companyId)); }
        catch (err: unknown) { sendJson(res, commandError(err), 400); }
      }
    })
    .register({
      method: 'GET', pattern: '/api/v3/government-orders/bids/:secret/', owner: 'government',
      handler: async (_req, res, _ctx, params) => {
        const bid = getGovernmentBidByIdOrSecret(params.secret);
        sendJson(res, bid || { error: 'Bid not found' }, bid ? 200 : 404);
      }
    })
    .register({
      method: 'PATCH', pattern: '/api/v3/government-orders/bids/:secret/', owner: 'government',
      handler: async (_req, res, ctx, params, body) => {
        const companyId = companyRequired(ctx, res);
        if (!companyId) return;
        try {
          sendJson(res, updateGovernmentBid(params.secret, companyId, {
            maxContractorCount: bodyField(body, 'maxContractorCount') as number | undefined,
            isPublic: bodyField(body, 'isPublic') as boolean | undefined,
            minimumRequiredTierIndex: bodyField(body, 'minimumRequiredTierIndex') as number | undefined,
            resourcePriceBreakdown: bodyField(body, 'resourcePriceBreakdown') as Record<string, number> | string | undefined,
            note: bodyField(body, 'note') as string | undefined
          }));
        } catch (err: unknown) { sendJson(res, commandError(err), 400); }
      }
    })
    .register({
      method: 'DELETE', pattern: '/api/v3/government-orders/bids/:secret/', owner: 'government',
      handler: async (_req, res, ctx, params) => {
        const companyId = companyRequired(ctx, res);
        if (!companyId) return;
        try { deleteGovernmentBid(params.secret, companyId); sendJson(res, { success: true }); }
        catch (err: unknown) { sendJson(res, commandError(err), 400); }
      }
    })
    .register({
      method: 'GET', pattern: '/api/v3/government-orders/bids/', owner: 'government',
      handler: async (_req, res, ctx) => {
        const realm = contextRealm(ctx);
        sendJson(res, { applications: getGovernmentBids(realm), governmentOrders: getGovernmentOrders(realm) });
      }
    })
    .register({
      method: 'POST', pattern: '/api/v3/government-orders/bids/', owner: 'government',
      handler: async (_req, res, ctx, _params, body) => {
        const companyId = companyRequired(ctx, res);
        if (!companyId) return;
        try {
          const realm = contextRealm(ctx);
          const templateId = Number(bodyField(body, 'templateId') ?? bodyField(body, 'orderId') ?? bodyField(body, 'template_id') ?? 1);
          const bid = createGovernmentBid(companyId, realm, {
            templateId,
            maxContractorCount: bodyField(body, 'maxContractorCount') as number | undefined,
            contractors: bodyField(body, 'contractors') as number[] | Array<{ companyId: number }> | undefined,
            isPublic: bodyField(body, 'isPublic') as boolean | undefined,
            minimumRequiredTierIndex: bodyField(body, 'minimumRequiredTierIndex') as number | undefined,
            resourcePriceBreakdown: bodyField(body, 'resourcePriceBreakdown') as Record<string, number> | string | undefined,
            note: bodyField(body, 'note') as string | undefined
          });
          sendJson(res, bid, 201);
        } catch (err: unknown) { sendJson(res, commandError(err), 400); }
      }
    })
    .register({
      method: 'GET', pattern: '/api/v3/government-orders/realm/:realmId/bids/', owner: 'government',
      handler: async (_req, res, _ctx, params) => {
        const realmId = Number(params.realmId);
        sendJson(res, { applications: getGovernmentBids(realmId), governmentOrders: getGovernmentOrders(realmId) });
      }
    })
    .register({
      method: 'POST', pattern: '/api/v3/government-orders/realm/:realmId/bids/', owner: 'government',
      handler: async (_req, res, ctx, params, body) => {
        const companyId = companyRequired(ctx, res);
        if (!companyId) return;
        try {
          const realmId = Number(params.realmId);
          const templateId = Number(bodyField(body, 'templateId') ?? bodyField(body, 'orderId') ?? bodyField(body, 'template_id') ?? (realmId > 0 ? realmId : 1));
          sendJson(res, createGovernmentBid(companyId, realmId, {
            templateId,
            maxContractorCount: bodyField(body, 'maxContractorCount') as number | undefined,
            contractors: bodyField(body, 'contractors') as number[] | Array<{ companyId: number }> | undefined,
            isPublic: bodyField(body, 'isPublic') as boolean | undefined,
            minimumRequiredTierIndex: bodyField(body, 'minimumRequiredTierIndex') as number | undefined,
            resourcePriceBreakdown: bodyField(body, 'resourcePriceBreakdown') as Record<string, number> | string | undefined,
            note: bodyField(body, 'note') as string | undefined
          }), 201);
        } catch (err: unknown) { sendJson(res, commandError(err), 400); }
      }
    })
    .register({
      method: 'GET', pattern: '/api/v3/government-orders/', owner: 'government',
      handler: async (_req, res, ctx) => {
        sendOrderList(res, contextRealm(ctx));
      }
    })
    .register({
      method: 'GET', pattern: '/api/v3/government-orders/projects/:projectId/', owner: 'government',
      handler: async (_req, res, _ctx, params) => { sendProject(res, Number(params.projectId)); }
    })
    .register({
      method: 'GET', pattern: '/api/v3/realms/:realmId/government-orders/', owner: 'government',
      handler: async (_req, res, _ctx, params) => {
        sendOrderList(res, Number(params.realmId));
      }
    })
    .register({
      method: 'GET', pattern: '/api/v3/government-orders/realm/:realmId/', owner: 'government',
      handler: async (_req, res, _ctx, params) => {
        const idOrRealm = Number(params.realmId);
        const template = getGovernmentOrderById(idOrRealm);
        if (template) {
          const orders = getGovernmentOrders(template.realm);
          sendJson(res, { ...template, governmentOrders: orders, orders });
          return;
        }
        sendOrderList(res, idOrRealm);
      }
    })
    .register({
      method: 'GET', pattern: '/api/v3/government-orders/:realmId/', owner: 'government',
      handler: async (_req, res, _ctx, params) => {
        sendOrderList(res, Number(params.realmId));
      }
    })
    .register({
      method: 'GET', pattern: '/api/v1/government-orders/', owner: 'government',
      handler: async (_req, res, ctx) => {
        sendOrderList(res, contextRealm(ctx));
      }
    })
    .register({
      method: 'GET', pattern: '/api/v1/realms/:realmId/government-orders/', owner: 'government',
      handler: async (_req, res, _ctx, params) => {
        sendOrderList(res, Number(params.realmId));
      }
    })
    .register({
      method: 'GET', pattern: '/api/v1/:scope/:realmId/government-orders/', owner: 'government',
      handler: async (_req, res, _ctx, params) => {
        sendOrderList(res, Number(params.realmId));
      }
    })
    .register({
      method: 'GET', pattern: '/api/v1/government-orders/realm/:realmId/', owner: 'government',
      handler: async (_req, res, _ctx, params) => {
        sendOrderList(res, Number(params.realmId));
      }
    })
    .register({
      method: 'GET', pattern: '/api/v1/government-orders/projects/:projectId/', owner: 'government',
      handler: async (_req, res, _ctx, params) => { sendProject(res, Number(params.projectId)); }
    })
    .register({
      method: 'GET', pattern: '/api/v1/government-orders/:realmId/', owner: 'government',
      handler: async (_req, res, _ctx, params) => {
        sendOrderList(res, Number(params.realmId));
      }
    });
}

registerGovernmentRoutes(globalRouteRegistry);
