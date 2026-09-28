import type { IncomingMessage, ServerResponse } from 'node:http';
import { setPreparsedBody } from './utils.ts';
import { RouteRegistry, globalRouteRegistry, type HttpMethod } from '../http/route-registry.ts';
import { extractSessionToken } from '../auth/session.ts';
import { handleSessionSubroutes } from './auth/session-subroutes.ts';
import { handlePlayerSubroutes } from './auth/player-subroutes.ts';
import { handleCompanyLifecycleSubroutes } from './auth/company-lifecycle-subroutes.ts';
import { SUPPORTED_LANGUAGE_PATTERN } from './supported-locales.ts';

export async function handleAuthRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  sessionToken: string | null,
  currentPlayerId: number | null,
  currentCompanyId: number | null
): Promise<boolean> {
  if (await handleSessionSubroutes(req, res, pathname, method, sessionToken, currentPlayerId)) {
    return true;
  }
  if (await handlePlayerSubroutes(req, res, pathname, method, currentPlayerId, currentCompanyId)) {
    return true;
  }
  if (await handleCompanyLifecycleSubroutes(req, res, pathname, method, sessionToken, currentPlayerId, currentCompanyId)) {
    return true;
  }
  return false;
}

export function registerAuthRoutes(registry: RouteRegistry = globalRouteRegistry): void {
  const register = (method: HttpMethod, pattern: string): void => {
    registry.register({
      method,
      pattern,
      owner: 'auth',
      handler: async (req, res, ctx, _params, body) => {
        if (method === 'POST' || method === 'PATCH' || method === 'PUT') {
          setPreparsedBody(req, body);
        }
        const pathname = new URL(req.url || '/', 'http://localhost').pathname;
        await handleAuthRoutes(
          req,
          res,
          pathname,
          method,
          extractSessionToken(req),
          ctx?.playerId ?? null,
          ctx?.companyId ?? null
        );
      }
    });
  };

  register('GET', '/signout/');
  register('GET', '/zh-cn/signout/');
  register('GET', '/logout/');
  register('GET', `/:locale(${SUPPORTED_LANGUAGE_PATTERN})/signout/`);
  register('GET', '/tutorial/');
  register('POST', '/tutorial/');
  register('GET', `/:locale(${SUPPORTED_LANGUAGE_PATTERN})/tutorial/`);
  register('POST', `/:locale(${SUPPORTED_LANGUAGE_PATTERN})/tutorial/`);
  register('GET', `/:locale(${SUPPORTED_LANGUAGE_PATTERN})/tutorial/:step/`);
  register('POST', `/:locale(${SUPPORTED_LANGUAGE_PATTERN})/tutorial/:step/`);
  register('POST', '/api/v2/auth/email/auth/');
  register('POST', '/api/v2/auth/email/connect/');
  register('POST', '/api/v2/auth/email/reset/');
  register('POST', '/api/v2/auth/device/auth/');
  register('POST', '/api/v2/auth/device/connect/');
  register('GET', '/api/v2/players/push-devices/');
  register('POST', '/api/v2/players/push-devices/');
  register('GET', '/api/v3/players/push-devices/');
  register('POST', '/api/v3/players/push-devices/');
  register('GET', '/api/v2/companies/:companyId(\\d+)/push-devices/');
  register('POST', '/api/v2/companies/:companyId(\\d+)/push-devices/');
  register('GET', '/api/v3/companies/auth-data/');
  register('GET', '/api/v2/players/:playerId/companies/');
  register('GET', '/api/v2/players/:playerId/personal-data/');
  register('POST', '/api/v2/player-preferences/');
  register('POST', '/api/v2/players/:playerId/preferences/');
  register('POST', '/api/v2/players/language/');
  register('GET', '/api/v2/companies/:companyId(me|\\d+)/referral/');
  register('GET', '/api/v2/referral/');
  register('GET', '/api/v2/companies/:companyId(me|\\d+)/tags/');
  register('POST', '/api/v2/companies/:companyId(me|\\d+)/tags/');
  register('PATCH', '/api/v2/companies/:companyId(me|\\d+)/tags/');
  register('DELETE', '/api/v2/companies/tags/:tagId/');
  register('POST', '/api/v1/realm/:realmId/switch/');
  register('POST', '/api/v1/realm-create-company/:realmId/');
  register('GET', '/api/v1/realm/:realmId/sync/');
  register('GET', '/api/v3/companies-by-company/:realmId/:name/');
  register('GET', '/api/v2/company-lookup/:companyId/:realmId/:name/');
  register('GET', '/api/v2/companies/:companyId(me|\\d+)/');
  register('PATCH', '/api/v2/companies/:companyId(me|\\d+)/');
  register('GET', '/api/v3/companies/:companyId(me|\\d+)/');
  register('PATCH', '/api/v3/companies/:companyId(me|\\d+)/');
  register('GET', '/api/v2/companies/:companyId(me|\\d+)/administration-overhead/');
  register('GET', '/api/v2/companies/:companyId(me|\\d+)/administration-overhead/plus-one/');
  register('POST', '/api/v2/companies/create/');
  register('POST', '/api/v2/companies/migrate/:companyId/realm0/');
  register('POST', '/api/v2/companies/switch/:companyId(\\d+)/');
}
registerAuthRoutes(globalRouteRegistry);
