import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson } from './utils.ts';
import {
  getRestaurantProperties,
  updateRestaurantProperties,
  getRestaurantRuns,
  executeRestaurantRun,
  getRestaurantRatings,
  getRestaurantMenuGuide,
  RESTAURANT_DISHES,
  type RestaurantMenuItem
} from '../game/restaurant.ts';
import { getCompanyBuildings, getBuildingById } from '../game/buildings.ts';

/**
 * Issue #92: restaurant subsystem routes.
 *
 *  - /api/v2/restaurants/...          per-company restaurant management
 *  - /api/v2/restaurant-menu/...      restaurant guide (dish catalog)
 *
 * Reads and mutations are scoped to the authenticated company's own buildings.
 */
export async function handleRestaurantRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  currentCompanyId: number | null
): Promise<boolean> {
  const isMenuPath = pathname === '/api/v2/restaurant-menu/' || pathname.startsWith('/api/v2/restaurant-menu/');
  const isRestaurantPath = pathname === '/api/v2/restaurants/' || pathname.startsWith('/api/v2/restaurants/');
  if (!isMenuPath && !isRestaurantPath) {
    return false;
  }

  // GET /api/v2/restaurant-menu/ — dish catalog for the restaurant guide.
  if (pathname === '/api/v2/restaurant-menu/') {
    if (method !== 'GET') {
      sendJson(res, { error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'GET' });
      return true;
    }
    sendJson(res, { dishes: getRestaurantMenuGuide() });
    return true;
  }

  if (!currentCompanyId) {
    sendJson(res, { error: 'Authentication required', code: 'UNAUTHORIZED' }, 401);
    return true;
  }

  // GET /api/v2/restaurants/ — all restaurants owned by the company.
  if (pathname === '/api/v2/restaurants/') {
    if (method !== 'GET') {
      sendJson(res, { error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'GET' });
      return true;
    }
    const restaurants = getCompanyBuildings(currentCompanyId)
      .filter(b => b.kind === 'r')
      .map(b => {
        const properties = getRestaurantProperties(b.id, currentCompanyId);
        return {
          buildingId: b.id,
          position: b.position,
          name: b.name,
          level: b.size,
          restaurantProperties: properties
        };
      });
    sendJson(res, { restaurants });
    return true;
  }

  // Everything below addresses a single restaurant building.
  const buildingMatch = pathname.match(/^\/api\/v2\/restaurants\/(\d+)\/$/);
  const runsMatch = pathname.match(/^\/api\/v2\/restaurants\/(\d+)\/runs\/$/);
  const ratingsMatch = pathname.match(/^\/api\/v2\/restaurants\/(\d+)\/ratings\/$/);

  const buildingId = runsMatch ? Number(runsMatch[1])
    : ratingsMatch ? Number(ratingsMatch[1])
    : buildingMatch ? Number(buildingMatch[1])
    : null;

  if (buildingId === null) {
    sendJson(res, { error: 'API route not found', code: 'API_NOT_FOUND', method, path: pathname }, 404);
    return true;
  }

  const building = getBuildingById(buildingId);
  if (!building || building.company_id !== currentCompanyId) {
    sendJson(res, { error: 'Building not found', code: 'NOT_FOUND' }, 404);
    return true;
  }

  if (runsMatch) {
    if (method === 'GET') {
      sendJson(res, { runs: getRestaurantRuns(buildingId, currentCompanyId) });
      return true;
    }
    if (method === 'POST') {
      try {
        const result = await executeRestaurantRun(buildingId, currentCompanyId);
        sendJson(res, result);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, { error: msg }, 400);
      }
      return true;
    }
    sendJson(res, { error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'GET, POST' });
    return true;
  }

  if (ratingsMatch) {
    if (method !== 'GET') {
      sendJson(res, { error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'GET' });
      return true;
    }
    sendJson(res, getRestaurantRatings(buildingId));
    return true;
  }

  if (buildingMatch) {
    if (method === 'GET') {
      sendJson(res, {
        building,
        restaurantProperties: getRestaurantProperties(buildingId, currentCompanyId)
      });
      return true;
    }
    if (method === 'PUT' || method === 'PATCH' || method === 'POST') {
      try {
        const body = await readJsonBody<Record<string, unknown>>(req);
        const updates: Partial<{
          goodService: boolean;
          isLuxury: boolean;
          professionalStaff: boolean;
          keepOpen: boolean;
          menu: RestaurantMenuItem[];
        }> = {};
        if (body.goodService !== undefined) updates.goodService = Boolean(body.goodService);
        if (body.isLuxury !== undefined) updates.isLuxury = Boolean(body.isLuxury);
        if (body.professionalStaff !== undefined) updates.professionalStaff = Boolean(body.professionalStaff);
        if (body.keepOpen !== undefined) updates.keepOpen = Boolean(body.keepOpen);
        if (body.menu !== undefined) updates.menu = parseMenu(body.menu);
        const result = updateRestaurantProperties(buildingId, currentCompanyId, updates);
        sendJson(res, result);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, { error: msg }, 400);
      }
      return true;
    }
    sendJson(res, { error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'GET, PUT, PATCH, POST' });
    return true;
  }

  return false;
}

/** Validate a menu payload: known dishes, numeric quality/price, no duplicates. */
function parseMenu(raw: unknown): RestaurantMenuItem[] {
  if (!Array.isArray(raw)) {
    throw new Error('Menu must be an array of menu items');
  }
  if (raw.length > RESTAURANT_DISHES.length) {
    throw new Error(`Menu cannot contain more than ${RESTAURANT_DISHES.length} dishes`);
  }
  const seen = new Set<number>();
  return raw.map(entry => {
    const item = entry as Record<string, unknown>;
    const resource = Number(item.resource);
    if (!Number.isInteger(resource) || !RESTAURANT_DISHES.includes(resource)) {
      throw new Error(`Menu item resource #${String(item.resource)} is not a restaurant dish`);
    }
    if (seen.has(resource)) {
      throw new Error(`Menu contains duplicate dish #${resource}`);
    }
    seen.add(resource);
    const quality = Number(item.quality) || 0;
    if (!Number.isInteger(quality) || quality < 0) {
      throw new Error(`Menu item #${resource} has an invalid quality`);
    }
    const price = Number(item.price);
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error(`Menu item #${resource} has an invalid price`);
    }
    return { resource, quality, price: Math.round(price * 100) / 100 };
  });
}
