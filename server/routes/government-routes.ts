import type { IncomingMessage, ServerResponse } from 'node:http';
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
          governmentOrders: getGovernmentOrders(template.realm)
        });
      } else {
        const orders = getGovernmentOrders(idOrRealm);
        sendJson(res, { governmentOrders: orders });
      }
      return true;
    }
    return false;
  }

  return false;
}
