/**
 * Debug and Test Ops Routes.
 *
 * Exposes endpoints for:
 * 1. POST /api/v2/debug/time-warp/  (Time manipulation and cycle resolution)
 * 2. POST /api/v2/debug/fixture/    (State generator and preset applier)
 * 3. GET  /api/v2/debug/state/      (Inspect clock offset and active state)
 * 4. GET  /api/v2/debug/presets/    (List available fixture presets)
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson, setPreparsedBody } from './utils.ts';
import { virtualClock } from '../core/virtual-clock.ts';
import { FixtureService, type ScenarioInput } from '../services/fixture-service.ts';
import { buildSessionCookie } from '../auth/session.ts';
import { RouteRegistry, globalRouteRegistry, type HttpMethod } from '../http/route-registry.ts';
import { CHATROOM_PRESETS } from './social-routes.ts';

export async function handleDebugRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  _currentPlayerId: number | null,
  currentCompanyId: number | null
): Promise<boolean> {
  if (!pathname.startsWith('/api/v2/debug/') && !pathname.startsWith('/api/debug/')) {
    return false;
  }

  // Production Security Gate (Issue #149)
  if (process.env.NODE_ENV === 'production') {
    const debugExplicitlyEnabled = process.env.ENABLE_DEBUG_ENDPOINTS === 'true';
    if (!debugExplicitlyEnabled) {
      sendJson(res, { error: 'Debug endpoints are disabled in production mode.' }, 403);
      return true;
    }

    const adminPassword = process.env.ADMIN_PASSWORD;
    const headerPassword = req.headers['x-admin-password'];
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

    const isAuthorized = Boolean(
      adminPassword &&
      (headerPassword === adminPassword || bearerToken === adminPassword)
    );

    if (!isAuthorized) {
      sendJson(res, { error: 'Unauthorized: Valid admin password required for debug endpoints in production mode.' }, 401);
      return true;
    }
  }
  // 1. GET /api/v2/debug/state/
  if (pathname === '/api/v2/debug/state/' || pathname === '/api/debug/state/') {
    if (method !== 'GET') {
      sendJson(res, { error: 'Method not allowed' }, 405);
      return true;
    }
    sendJson(res, {
      virtualNow: virtualClock.nowIso(),
      virtualNowMs: virtualClock.nowMs(),
      realNow: new Date().toISOString(),
      offsetMs: virtualClock.getOffsetMs(),
      offsetHours: virtualClock.getOffsetHours(),
      availablePresets: Object.keys(FixtureService.PRESETS)
    });
    return true;
  }

  // 2. GET /api/v2/debug/presets/
  if (pathname === '/api/v2/debug/presets/' || pathname === '/api/debug/presets/') {
    if (method !== 'GET') {
      sendJson(res, { error: 'Method not allowed' }, 405);
      return true;
    }
    sendJson(res, {
      presets: FixtureService.PRESETS
    });
    return true;
  }
  // 2.1. GET & POST /api/v2/debug/market-mode/
  if (pathname === '/api/v2/debug/market-mode/' || pathname === '/api/debug/market-mode/') {
    if (method === 'GET') {
      sendJson(res, FixtureService.getMarketPricingMode());
      return true;
    }
    if (method === 'POST') {
      try {
        const body = await readJsonBody<{ mode: 'realistic' | 'test' }>(req);
        if (body.mode !== 'realistic' && body.mode !== 'test') {
          sendJson(res, { error: 'mode must be "realistic" or "test"' }, 400);
          return true;
        }
        const result = await FixtureService.setMarketPricingMode(body.mode);
        sendJson(res, { success: true, ...result });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, { error: msg }, 500);
      }
      return true;
    }
    sendJson(res, { error: 'Method not allowed' }, 405);
    return true;
  }

  // 2.2. GET & POST /api/v2/debug/construction-mode/
  if (pathname === '/api/v2/debug/construction-mode/' || pathname === '/api/debug/construction-mode/') {
    if (method === 'GET') {
      sendJson(res, FixtureService.getConstructionTimeMode());
      return true;
    }
    if (method === 'POST') {
      try {
        const body = await readJsonBody<{
          mode?: 'realistic' | 'test' | 'real' | 'fast';
          toggle?: boolean;
          speedMultiplier?: number;
        }>(req);

        let targetMode: 'realistic' | 'test';
        if (body.toggle) {
          const current = FixtureService.getConstructionTimeMode().mode;
          targetMode = current === 'realistic' ? 'test' : 'realistic';
        } else if (body.mode === 'realistic' || body.mode === 'real') {
          targetMode = 'realistic';
        } else if (body.mode === 'test' || body.mode === 'fast') {
          targetMode = 'test';
        } else {
          sendJson(res, {
            error: 'Invalid request: mode must be "realistic" ("real") or "test" ("fast"), or pass toggle: true'
          }, 400);
          return true;
        }

        const result = await FixtureService.setConstructionTimeMode(targetMode, body.speedMultiplier);
        sendJson(res, { success: true, ...result });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, { error: msg }, 500);
      }
      return true;
    }
    sendJson(res, { error: 'Method not allowed' }, 405);
    return true;
  }

  // 3. POST /api/v2/debug/time-warp/
  if (pathname === '/api/v2/debug/time-warp/' || pathname === '/api/debug/time-warp/') {
    if (method !== 'POST') {
      sendJson(res, { error: 'Method not allowed' }, 405);
      return true;
    }

    interface TimeWarpBody {
      hours?: number;
      days?: number;
      minutes?: number;
      seconds?: number;
      iso?: string;
      reset?: boolean;
      resolveCycles?: boolean;
    }

    const body = await readJsonBody<TimeWarpBody>(req);

    let warpResult;
    if (body.reset) {
      warpResult = virtualClock.reset();
    } else if (body.iso) {
      warpResult = virtualClock.setTime(body.iso);
    } else {
      warpResult = virtualClock.advance({
        hours: body.hours,
        days: body.days,
        minutes: body.minutes,
        seconds: body.seconds
      });
    }

    // By default, fast-forward and resolve overdue cycles unless explicitly disabled
    let cycleResolution = null;
    if (body.resolveCycles !== false) {
      cycleResolution = await virtualClock.resolveAllOverdue();
    }

    sendJson(res, {
      success: true,
      clock: warpResult,
      virtualNow: virtualClock.nowIso(),
      virtualNowMs: virtualClock.nowMs(),
      offsetHours: virtualClock.getOffsetHours(),
      resolvedCycles: cycleResolution
    });
    return true;
  }

  // 4. POST /api/v2/debug/fixture/
  if (pathname === '/api/v2/debug/fixture/' || pathname === '/api/debug/fixture/') {
    if (method !== 'POST') {
      sendJson(res, { error: 'Method not allowed' }, 405);
      return true;
    }

    interface FixtureBody extends ScenarioInput {
      preset?: string;
    }

    const body = await readJsonBody<FixtureBody>(req);

    try {
      let result;
      if (body.preset) {
        result = await FixtureService.applyPreset(body.preset, body);
      } else {
        result = await FixtureService.applyScenario(body);
      }

      // Return session cookie in header as well so caller can immediately adopt it
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': buildSessionCookie(result.sessionToken)
      });
      res.end(JSON.stringify({
        success: true,
        fixture: result
      }));
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: msg, code: 'FIXTURE_FAILED' }, 400);
      return true;
    }
  }

  // 5. Chatrooms configuration: GET & POST /api/v2/debug/chatrooms/
  if (pathname === '/api/v2/debug/chatrooms/' || pathname === '/api/debug/chatrooms/') {
    if (method === 'GET') {
      const chatrooms = FixtureService.getConfiguredChatrooms();
      sendJson(res, {
        count: chatrooms.length,
        chatrooms,
        availablePresets: Object.keys(CHATROOM_PRESETS)
      });
      return true;
    }

    if (method === 'POST') {
      interface ChatroomConfigBody {
        count?: number;
        preset?: string;
        rooms?: any[];
        reset?: boolean;
      }
      const body = await readJsonBody<ChatroomConfigBody>(req);
      const result = FixtureService.setConfiguredChatrooms(body);
      sendJson(res, result);
      return true;
    }

    sendJson(res, { error: 'Method not allowed' }, 405);
    return true;
  }

  // 6. Economy state customization: GET & POST /api/v2/debug/economy/
  if (pathname === '/api/v2/debug/economy/' || pathname === '/api/debug/economy/') {
    if (method === 'GET') {
      const realmParam = new URL(req.url || '/', 'http://localhost').searchParams.get('realmId');
      const realmId = realmParam ? Number(realmParam) : 0;
      sendJson(res, FixtureService.getEconomyState(realmId));
      return true;
    }

    if (method === 'POST') {
      interface EconomyConfigBody {
        state?: 'boom' | 'recession' | 'normal' | number;
        random?: boolean;
        refreshSchedule?: string;
        roll?: boolean;
        realmId?: number;
      }
      const body = await readJsonBody<EconomyConfigBody>(req);
      const realmId = body?.realmId ?? 0;
      if (body?.roll) {
        const rolled = FixtureService.rollEconomyState(realmId);
        sendJson(res, rolled);
        return true;
      }
      const updated = FixtureService.setEconomyState(body?.state ?? 'normal', {
        random: body?.random,
        refreshSchedule: body?.refreshSchedule,
        realmId
      });
      sendJson(res, updated);
      return true;
    }

    sendJson(res, { error: 'Method not allowed' }, 405);
    return true;
  }

  return false;
}

export function registerDebugRoutes(registry: RouteRegistry = globalRouteRegistry): void {
  const register = (method: HttpMethod, pattern: string): void => {
    registry.register({
      method,
      pattern,
      owner: 'debug',
      handler: async (req, res, ctx, _params, body) => {
        if (method === 'POST' || method === 'PATCH' || method === 'PUT') {
          setPreparsedBody(req, body);
        }
        const pathname = new URL(req.url || '/', 'http://localhost').pathname;
        await handleDebugRoutes(req, res, pathname, method, ctx?.playerId ?? null, ctx?.companyId ?? null);
      }
    });
  };

  for (const prefix of ['/api/v2/debug', '/api/debug']) {
    register('GET', `${prefix}/state/`);
    register('GET', `${prefix}/presets/`);
    register('GET', `${prefix}/market-mode/`);
    register('POST', `${prefix}/market-mode/`);
    register('GET', `${prefix}/construction-mode/`);
    register('POST', `${prefix}/construction-mode/`);
    register('GET', `${prefix}/chatrooms/`);
    register('POST', `${prefix}/chatrooms/`);
    register('POST', `${prefix}/time-warp/`);
    register('GET', `${prefix}/economy/`);
    register('POST', `${prefix}/economy/`);
    register('POST', `${prefix}/fixture/`);
  }
}
registerDebugRoutes(globalRouteRegistry);
