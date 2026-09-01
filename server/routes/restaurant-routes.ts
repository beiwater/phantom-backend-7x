import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson } from './utils.ts';
import {
  getRestaurantProperties,
  updateRestaurantProperties,
  getRestaurantRuns,
  executeRestaurantRun,
  getRestaurantRatings,
  getRestaurantMenuGuide,
  getLegacyRestaurantProperties,
  getLegacyRestaurantRun,
  RESTAURANT_DISHES,
  type RestaurantMenuItem,
  type LegacyRestaurantProperties
} from '../game/restaurant.ts';
import { getCompanyBuildings, getBuildingById } from '../game/buildings.ts';
import { buildingRepository } from '../repositories/building-repository.ts';
import { toSimCompaniesBuildingDTO } from '../compatibility/simcompanies/building-dto.ts';

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
  const legacyPropertiesMatch = pathname.match(/^\/api\/v2\/companies\/buildings\/(\d+)\/restaurant-properties\/$/);
  const legacyRunsMatch = pathname.match(/^\/api\/v2\/companies\/buildings\/(\d+)\/restaurant-runs\/$/);
  if (!isMenuPath && !isRestaurantPath && !legacyPropertiesMatch && !legacyRunsMatch) {
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

  // The shipped client still calls these legacy building-scoped endpoints.
  // Adapt them to the Issue #92 restaurant domain instead of returning the
  // former placeholder payloads.
  if (legacyPropertiesMatch || legacyRunsMatch) {
    const buildingId = Number((legacyPropertiesMatch || legacyRunsMatch)![1]);
    const building = buildingRepository.findById(buildingId);
    if (!building || building.companyId !== currentCompanyId || building.kind !== 'r') {
      sendJson(res, { error: 'Building not found', code: 'NOT_FOUND' }, 404);
      return true;
    }

    const properties = getLegacyRestaurantProperties(buildingId, currentCompanyId);
    if (legacyPropertiesMatch) {
      if (method === 'GET') {
        sendJson(res, properties);
        return true;
      }
      if (method === 'PATCH' || method === 'PUT' || method === 'POST') {
        try {
          const body = await readJsonBody<Record<string, unknown>>(req);
          const updates = legacyUpdatesToDomain(body, properties);
          const result = updateRestaurantProperties(buildingId, currentCompanyId, updates);
          const updatedProperties = getLegacyRestaurantProperties(buildingId, currentCompanyId);
          const updatedBuilding = buildingRepository.findById(buildingId);
          sendJson(res, {
            building: updatedBuilding
              ? { ...toSimCompaniesBuildingDTO(updatedBuilding), restaurantProperties: updatedProperties }
              : null,
            moneyUpdate: 0
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          sendJson(res, { error: msg }, 400);
        }
        return true;
      }
      sendJson(res, { error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'GET, PUT, PATCH, POST' });
      return true;
    }

    if (method === 'GET') {
      const runs = getRestaurantRuns(buildingId, currentCompanyId)
        .map(run => getLegacyRestaurantRun(run, properties));
      sendJson(res, runs);
      return true;
    }
    if (method === 'POST') {
      try {
        const result = await executeRestaurantRun(buildingId, currentCompanyId);
        const updatedProperties = getLegacyRestaurantProperties(buildingId, currentCompanyId);
        const updatedBuilding = buildingRepository.findById(buildingId);
        sendJson(res, {
          building: updatedBuilding
            ? { ...toSimCompaniesBuildingDTO(updatedBuilding), restaurantProperties: updatedProperties }
            : null,
          run: getLegacyRestaurantRun(result.run, updatedProperties),
          resourceTransactions: result.resourceTransactions,
          moneyUpdate: result.moneyUpdate
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, { error: msg }, 400);
      }
      return true;
    }
    sendJson(res, { error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'GET, POST' });
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

const LEGACY_MENU_GROUPS = ['saladBar', 'mains', 'drinks'] as const;

function legacyUpdatesToDomain(
  body: Record<string, unknown>,
  current: LegacyRestaurantProperties
): Partial<{
  goodService: boolean;
  isLuxury: boolean;
  professionalStaff: boolean;
  keepOpen: boolean;
  menu: RestaurantMenuItem[];
}> {
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

  const hasLegacyMenu = LEGACY_MENU_GROUPS.some(key => Object.prototype.hasOwnProperty.call(body, key));
  const rawMenu = body.menu;
  if (rawMenu !== undefined) {
    updates.menu = parseMenu(rawMenu);
  } else if (hasLegacyMenu) {
    const entries: unknown[] = [];
    for (const key of LEGACY_MENU_GROUPS) {
      const value = body[key];
      if (value !== undefined && !Array.isArray(value)) {
        throw new Error(`${key} must be an array`);
      }
      if (Array.isArray(value)) entries.push(...value);
    }
    updates.menu = parseLegacyMenu(entries, body.menuPrice, current);
  } else if (body.menuPrice !== undefined) {
    const menuPrice = positiveNumber(body.menuPrice);
    if (menuPrice === null) throw new Error('menuPrice must be a positive number');
    updates.menu = current.saladBar.concat(current.mains, current.drinks).map(item => ({
      resource: item.kind,
      quality: item.quality,
      price: menuPrice
    }));
  }
  return updates;
}

function parseLegacyMenu(
  entries: unknown[],
  rawMenuPrice: unknown,
  current: LegacyRestaurantProperties
): RestaurantMenuItem[] {
  const fallbackPrice = positiveNumber(rawMenuPrice) ?? current.menuPrice;
  const seen = new Set<number>();
  const menu: RestaurantMenuItem[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') throw new Error('Menu item must be an object');
    const item = entry as Record<string, unknown>;
    const serving = item.serving === undefined ? 'BOTTOM' : String(item.serving);
    if (serving === 'NONE') continue;
    const resource = Number(item.resource ?? item.kind);
    if (!Number.isInteger(resource) || !RESTAURANT_DISHES.includes(resource)) {
      throw new Error(`Menu item resource #${String(item.resource ?? item.kind)} is not a restaurant dish`);
    }
    if (seen.has(resource)) throw new Error(`Menu contains duplicate dish #${resource}`);
    seen.add(resource);
    const quality = Number(item.quality) || 0;
    if (!Number.isInteger(quality) || quality < 0) {
      throw new Error(`Menu item #${resource} has an invalid quality`);
    }
    const price = positiveNumber(item.price) ?? fallbackPrice;
    if (price === null) throw new Error(`Menu item #${resource} has an invalid price`);
    menu.push({ resource, quality, price: Math.round(price * 100) / 100 });
  }
  return menu;
}

function positiveNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}
