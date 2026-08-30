import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson } from './utils.ts';
import {
  CONSTANTS_CORE,
  CONSTANTS_BUILDINGS,
  CONSTANTS_RESOURCES
} from '../game/constants.ts';
import {
  getResourceEncyclopediaDetail,
  getResourceHistory,
  getResourceTransactionsSummary,
  getResourceTransactions,
  getEvaRankings,
  getExistingResourceQualities,
  getResourcesRetailInfo,
  getRetailDemand
} from '../game/encyclopedia.ts';
import {
  getRestaurantProperties,
  updateRestaurantProperties,
  getRestaurantRuns,
  executeRestaurantRun,
  getRestaurantMenuGuide,
  getRestaurantRatings,
  type RestaurantMenuItem
} from '../game/restaurant.ts';
import {
  getGovernmentTier,
  getGovernmentOrders,
  getGovernmentBids,
  getGovernmentBidBySecret,
  createGovernmentBid,
  joinGovernmentBid,
  leaveOrRemoveContractor,
  getBlockedCompanies,
  blockCompany,
  unblockCompany,
  getCompanyGovernmentApplications,
  getCompanyGovernmentBids,
  fulfillGovernmentOrder
} from '../game/government-orders.ts';
import {
  getRocketLaunchStats,
  getAerospaceSalesOrders,
  generateNewSalesOrder,
  fulfillAerospaceSalesOrder
} from '../game/aerospace.ts';

export async function handleEncyclopediaRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  currentCompanyId: number | null
): Promise<boolean> {
  // 1. Core Constants & Meta
  if (pathname === '/api/v2/constants/core/') {
    sendJson(res, CONSTANTS_CORE);
    return true;
  }
  if (pathname === '/api/v2/constants/buildings/') {
    sendJson(res, CONSTANTS_BUILDINGS);
    return true;
  }
  if (pathname === '/api/v2/constants/resources/') {
    sendJson(res, CONSTANTS_RESOURCES);
    return true;
  }
  if (pathname === '/api/v2/time-millis/' || pathname === '/api/time/') {
    sendJson(res, Date.now());
    return true;
  }
  if (pathname === '/api/csrf/') {
    sendJson(res, { csrfToken: 'mock-csrf-token' });
    return true;
  }
  if (pathname.includes('/production-modifiers/')) {
    sendJson(res, { resourceProductionModifiers: [] });
    return true;
  }

  // 2. Resources Retail Info & Demand
  if (pathname.includes('/resources-retail-info/')) {
    const realmMatch = pathname.match(/\/api\/v4\/(\d+)\/resources-retail-info\//);
    const realmId = realmMatch ? Number(realmMatch[1]) : 0;
    sendJson(res, getResourcesRetailInfo(realmId));
    return true;
  }
  if (pathname === '/api/v2/retail/demand/' || pathname === '/api/v4/retail/' || pathname.startsWith('/api/v2/retail/')) {
    sendJson(res, getRetailDemand());
    return true;
  }

  // 3. Historical Resource Prices & Volume Time-Series Charts
  const encResMatch = pathname.match(/^\/api\/v4\/(\d+)\/\d+\/encyclopedia\/resources\/(\d+)\/(\d+)\/$/) ||
                      pathname.match(/^\/api\/v4\/(\d+)\/\d+\/encyclopedia\/resources\/(\d+)\/$/);
  if (encResMatch) {
    const realmId = Number(encResMatch[1]);
    const kind = Number(encResMatch[2]);
    const quality = encResMatch[3] ? Number(encResMatch[3]) : 0;
    sendJson(res, getResourceEncyclopediaDetail(realmId, kind, quality));
    return true;
  }

  const historyMatch = pathname.match(/^\/api\/v2\/resources\/history\/(\d+)\/$/);
  if (historyMatch) {
    const kind = Number(historyMatch[1]);
    sendJson(res, getResourceHistory(kind, 30, 0));
    return true;
  }

  const txSummaryMatch = pathname.match(/^\/api\/v2\/resources-transactions-summary\/(\d+)\/(\d+)\/$/);
  if (txSummaryMatch) {
    const realmId = Number(txSummaryMatch[1]);
    const kind = Number(txSummaryMatch[2]);
    sendJson(res, getResourceTransactionsSummary(realmId, kind));
    return true;
  }

  const txMatch = pathname.match(/^\/api\/v2\/resources-transactions\/(\d+)\/(\d+)\/$/);
  if (txMatch) {
    const realmId = Number(txMatch[1]);
    const kind = Number(txMatch[2]);
    sendJson(res, getResourceTransactions(realmId, kind));
    return true;
  }

  // 4. Existing Resource Quality in the Economy
  if (pathname.includes('/encyclopedia/existing-resource-quality/')) {
    sendJson(res, getExistingResourceQualities(0));
    return true;
  }

  // 5. EVA Rankings & Company Value Rankings
  const evaMatch = pathname.match(/^\/api\/v4\/encyclopedia\/eva-ranking\/(\d+)\/(\d+)\/$/) ||
                   pathname.match(/^\/api\/v4\/encyclopedia\/eva-ranking\/(\d+)\/$/) ||
                   pathname.match(/^\/api\/v2\/encyclopedia\/eva-ranking\/$/);
  if (evaMatch) {
    const realmId = evaMatch[1] ? Number(evaMatch[1]) : 0;
    const blob = evaMatch[2] ? Number(evaMatch[2]) : 0;
    sendJson(res, getEvaRankings(realmId, blob));
    return true;
  }

  const genRankingMatch = pathname.match(/^\/api\/v4\/encyclopedia\/ranking\/(\d+)\/(\d+)\/$/) ||
                          pathname.match(/^\/api\/v4\/encyclopedia\/ranking\/(\d+)\/$/);
  if (genRankingMatch) {
    const realmId = Number(genRankingMatch[1]);
    const blob = genRankingMatch[2] ? Number(genRankingMatch[2]) : 0;
    sendJson(res, getEvaRankings(realmId, blob));
    return true;
  }

  // 6. Restaurant Subsystem
  if (pathname === '/api/v1/restaurant-menu/' && method === 'GET') {
    sendJson(res, getRestaurantMenuGuide());
    return true;
  }
  if (pathname === '/api/v1/restaurant-rating/' && method === 'GET') {
    sendJson(res, getRestaurantRatings());
    return true;
  }

  const restPropsMatch = pathname.match(/^\/api\/v2\/companies\/buildings\/(\d+)\/restaurant-properties\/$/);
  if (restPropsMatch) {
    const buildingId = Number(restPropsMatch[1]);
    if (method === 'GET') {
      sendJson(res, getRestaurantProperties(buildingId, currentCompanyId));
      return true;
    }
    if (method === 'PATCH' || method === 'POST') {
      const body = await readJsonBody(req) as Partial<{
        goodService: boolean;
        isLuxury: boolean;
        keepOpen: boolean;
        menu: RestaurantMenuItem[];
      }>;
      const result = updateRestaurantProperties(buildingId, currentCompanyId || 1, body);
      sendJson(res, result);
      return true;
    }
  }

  const restRunsMatch = pathname.match(/^\/api\/v2\/companies\/buildings\/(\d+)\/restaurant-runs\/$/);
  if (restRunsMatch) {
    const buildingId = Number(restRunsMatch[1]);
    if (method === 'GET') {
      sendJson(res, getRestaurantRuns(buildingId, currentCompanyId));
      return true;
    }
    if (method === 'POST') {
      if (!currentCompanyId) {
        sendJson(res, { error: 'Unauthorized' }, 401);
        return true;
      }
      const result = executeRestaurantRun(buildingId, currentCompanyId);
      sendJson(res, result);
      return true;
    }
  }

  // 7. Government Orders Subsystem
  if (pathname === '/api/v3/government-orders/tier/' && method === 'GET') {
    sendJson(res, getGovernmentTier(currentCompanyId));
    return true;
  }
  if (pathname === '/api/v1/government-orders/' && method === 'GET') {
    sendJson(res, getGovernmentOrders(0));
    return true;
  }

  const govOrdersMatch = pathname.match(/^\/api\/v3\/government-orders\/realm\/(\d+)\/$/) ||
                         pathname.match(/^\/api\/v3\/government-orders\/(\d+)\/$/);
  if (govOrdersMatch && method === 'GET') {
    const realmId = Number(govOrdersMatch[1]);
    sendJson(res, getGovernmentOrders(realmId));
    return true;
  }

  const govBidsRealmMatch = pathname.match(/^\/api\/v3\/government-orders\/realm\/(\d+)\/bids\/$/);
  if (govBidsRealmMatch) {
    const realmId = Number(govBidsRealmMatch[1]);
    if (method === 'GET') {
      sendJson(res, getGovernmentBids(realmId));
      return true;
    }
    if (method === 'POST') {
      if (!currentCompanyId) {
        sendJson(res, { error: 'Unauthorized' }, 401);
        return true;
      }
      const body = await readJsonBody(req) as {
        templateId: number;
        maxContractorCount?: number;
        isPublic?: boolean;
        minimumRequiredTierIndex?: number;
        resourcePriceBreakdown?: Record<string, number>;
        note?: string;
      };
      const created = createGovernmentBid(currentCompanyId, realmId, body);
      sendJson(res, created, 201);
      return true;
    }
  }

  const govBidSecretContractorsMatch = pathname.match(/^\/api\/v3\/government-orders\/bids\/([^/]+)\/contractors\/$/);
  if (govBidSecretContractorsMatch && method === 'POST') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    const secret = govBidSecretContractorsMatch[1];
    const updated = joinGovernmentBid(secret, currentCompanyId);
    sendJson(res, updated || { error: 'Could not join bid' });
    return true;
  }

  const govBidContractorIdMatch = pathname.match(/^\/api\/v3\/government-orders\/bids\/([^/]+)\/contractors\/(\d+)\/$/);
  if (govBidContractorIdMatch) {
    const secret = govBidContractorIdMatch[1];
    const contractorId = Number(govBidContractorIdMatch[2]);
    if (method === 'DELETE') {
      const updated = leaveOrRemoveContractor(secret, currentCompanyId || 1, contractorId);
      sendJson(res, updated || { success: true });
      return true;
    }
    if (method === 'PATCH') {
      fulfillGovernmentOrder(secret, currentCompanyId || 1, contractorId);
      const updated = getGovernmentBidBySecret(secret);
      sendJson(res, updated);
      return true;
    }
  }

  const govBidBlockedMatch = pathname.match(/^\/api\/v3\/government-orders\/bids\/([^/]+)\/blocked-companies\/$/);
  if (govBidBlockedMatch) {
    const secret = govBidBlockedMatch[1];
    if (method === 'GET') {
      sendJson(res, getBlockedCompanies(secret));
      return true;
    }
    if (method === 'POST') {
      const body = await readJsonBody(req) as { companyId?: number };
      if (body?.companyId) {
        blockCompany(secret, body.companyId);
      }
      sendJson(res, getBlockedCompanies(secret));
      return true;
    }
  }

  const govBidBlockedSingleMatch = pathname.match(/^\/api\/v3\/government-orders\/bids\/([^/]+)\/blocked-companies\/(\d+)\/$/);
  if (govBidBlockedSingleMatch && method === 'DELETE') {
    const secret = govBidBlockedSingleMatch[1];
    const blockedCompId = Number(govBidBlockedSingleMatch[2]);
    unblockCompany(secret, blockedCompId);
    sendJson(res, getBlockedCompanies(secret));
    return true;
  }

  const govCompanyAppsMatch = pathname.match(/^\/api\/v3\/government-orders\/company\/(\d+)\/$/);
  if (govCompanyAppsMatch && method === 'GET') {
    const compId = Number(govCompanyAppsMatch[1]);
    sendJson(res, getCompanyGovernmentApplications(compId));
    return true;
  }

  const govCompanyBidsMatch = pathname.match(/^\/api\/v3\/government-orders\/company\/(\d+)\/bids\/$/);
  if (govCompanyBidsMatch && method === 'GET') {
    const compId = Number(govCompanyBidsMatch[1]);
    sendJson(res, getCompanyGovernmentBids(compId));
    return true;
  }

  const govBidSingleMatch = pathname.match(/^\/api\/v3\/government-orders\/bids\/([^/]+)\/$/);
  if (govBidSingleMatch) {
    const secret = govBidSingleMatch[1];
    if (method === 'GET') {
      const bid = getGovernmentBidBySecret(secret);
      if (!bid) {
        sendJson(res, { error: 'Bid not found' }, 404);
        return true;
      }
      sendJson(res, bid);
      return true;
    }
    if (method === 'PATCH') {
      const bid = getGovernmentBidBySecret(secret);
      sendJson(res, bid);
      return true;
    }
    if (method === 'DELETE') {
      sendJson(res, { success: true });
      return true;
    }
  }

  // 8. Aerospace & Rocket Launches Subsystem
  const rocketLaunchesMatch = pathname.match(/^\/api\/v3\/rocket-launches\/(\d+)\/([^/]+)\/$/);
  if (rocketLaunchesMatch && method === 'GET') {
    const realmId = Number(rocketLaunchesMatch[1]);
    const who = rocketLaunchesMatch[2];
    const isMe = who === 'me';
    sendJson(res, getRocketLaunchStats(realmId, currentCompanyId, isMe));
    return true;
  }

  if (pathname === '/api/v1/aerospace-launches/' && method === 'GET') {
    sendJson(res, getRocketLaunchStats(0, currentCompanyId, false));
    return true;
  }

  // Sales office aerospace orders
  const aeroSalesMatch = pathname.match(/^\/api\/v2\/companies\/buildings\/(\d+)\/sales-orders\/$/);
  if (aeroSalesMatch) {
    const buildingId = Number(aeroSalesMatch[1]);
    if (method === 'GET') {
      sendJson(res, getAerospaceSalesOrders(buildingId, currentCompanyId || 1));
      return true;
    }
    if (method === 'POST') {
      if (!currentCompanyId) {
        sendJson(res, { error: 'Unauthorized' }, 401);
        return true;
      }
      const newOrder = generateNewSalesOrder(buildingId, currentCompanyId, true);
      sendJson(res, newOrder, 201);
      return true;
    }
  }

  const aeroSalesSingleMatch = pathname.match(/^\/api\/v2\/companies\/buildings\/(\d+)\/sales-orders\/(\d+)\/$/);
  if (aeroSalesSingleMatch) {
    const buildingId = Number(aeroSalesSingleMatch[1]);
    const orderId = Number(aeroSalesSingleMatch[2]);
    if (method === 'PUT') {
      if (!currentCompanyId) {
        sendJson(res, { error: 'Unauthorized' }, 401);
        return true;
      }
      const result = fulfillAerospaceSalesOrder(buildingId, orderId, currentCompanyId);
      if (!result.success) {
        sendJson(res, { error: result.error }, 400);
        return true;
      }
      sendJson(res, result);
      return true;
    }
    if (method === 'DELETE') {
      sendJson(res, { success: true });
      return true;
    }
  }

  // 9. Documentation Pages, Events, Supporters
  const pagesMatch = pathname.match(/^\/api\/v3\/pages\/[^/]+\/([^/]+)\/$/);
  if (pagesMatch) {
    const pageKey = pagesMatch[1];
    return sendJson(res, {
      title: pageKey.toUpperCase(),
      content: `<h2>Sim Companies 指南: ${pageKey}</h2><p>文库与机制文档已全面在线。</p>`
    });
  }

  if (pathname.includes('/encyclopedia/events/')) {
    return sendJson(res, { events: [] });
  }

  if (pathname.includes('/encyclopedia/supporters/')) {
    return sendJson(res, { supporters: [] });
  }

  return false;
}
