import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson } from '../routes/utils.ts';
import { createGameContext, type GameContext } from '../context/game-context.ts';
import { DomainError, UnauthorizedError } from '../errors/domain-error.ts';
import { sendDomainError } from '../compatibility/simcompanies/response-helpers.ts';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS';
export type AuthRequirement = 'none' | 'player' | 'company';

export interface RouteParams {
  [key: string]: string;
}

export type RouteHandler<TBody = unknown> = (
  req: IncomingMessage,
  res: ServerResponse,
  ctx: GameContext | null,
  params: RouteParams,
  body: TBody
) => Promise<void>;

export interface RouteDefinition<TBody = unknown> {
  method: HttpMethod;
  pattern: string;
  auth?: AuthRequirement;
  handler: RouteHandler<TBody>;
}

interface CompiledRoute {
  method: HttpMethod;
  pattern: string;
  regex: RegExp;
  paramNames: string[];
  specificity: number;
  auth: AuthRequirement;
  handler: RouteHandler<any>;
}

function compilePattern(pattern: string): { regex: RegExp; paramNames: string[]; specificity: number } {
  // Normalize trailing slash
  const normalized = pattern.endsWith('/') ? pattern : `${pattern}/`;
  const segments = normalized.split('/').filter(Boolean);
  const paramNames: string[] = [];
  let specificity = 0;

  const regexParts = segments.map((seg, idx) => {
    if (seg.startsWith(':')) {
      paramNames.push(seg.slice(1));
      specificity += 10; // Parameter segment
      return '([^/]+)';
    }
    specificity += 100; // Static segment (higher priority)
    return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  });

  const regexString = `^/${regexParts.join('/')}/?$`;
  return {
    regex: new RegExp(regexString),
    paramNames,
    specificity
  };
}

export class RouteRegistry {
  private routes: CompiledRoute[] = [];

  register<TBody = unknown>(route: RouteDefinition<TBody>): this {
    const { regex, paramNames, specificity } = compilePattern(route.pattern);

    // Conflict detection: prevent registering duplicate routes for the exact same method and normalized pattern
    const existing = this.routes.find(
      r => r.method === route.method && r.pattern === route.pattern
    );
    if (existing) {
      throw new Error(
        `Route conflict: ${route.method} ${route.pattern} has already been registered`
      );
    }

    this.routes.push({
      method: route.method,
      pattern: route.pattern,
      regex,
      paramNames,
      specificity,
      auth: route.auth || 'none',
      handler: route.handler
    });

    // Sort by specificity descending so more specific static routes match before parameter wildcard routes
    this.routes.sort((a, b) => b.specificity - a.specificity);
    return this;
  }

  async dispatch(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
    method: string,
    session: { playerId: number; companyId: number } | null
  ): Promise<boolean> {
    const normalizedPath = pathname.endsWith('/') ? pathname : `${pathname}/`;

    // 1. Find matching routes across all HTTP methods for the path
    const pathMatches = this.routes.filter(r => r.regex.test(normalizedPath));
    if (pathMatches.length === 0) {
      return false; // Not handled by this registry
    }

    // 2. Find matching route for the requested HTTP method
    const route = pathMatches.find(r => r.method === method);
    if (!route) {
      // Path exists but method does not match -> return 405 Method Not Allowed
      const allowed = Array.from(new Set(pathMatches.map(r => r.method)));
      sendJson(res, {
        error: 'Method not allowed',
        code: 'METHOD_NOT_ALLOWED',
        method,
        path: pathname
      }, 405, { Allow: allowed.join(', ') });
      return true;
    }

    // 3. Extract path parameters
    const match = normalizedPath.match(route.regex);
    const params: RouteParams = {};
    if (match) {
      route.paramNames.forEach((name, index) => {
        params[name] = match[index + 1];
      });
    }

    // 4. Resolve and validate authentication context
    let ctx: GameContext | null = null;
    if (session) {
      ctx = createGameContext(session.companyId, session.playerId, 0);
    }

    if (route.auth === 'company' && (!ctx || !ctx.companyId)) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }

    if (route.auth === 'player' && (!ctx || !ctx.playerId)) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }

    // 5. Parse body if applicable
    let body: unknown = undefined;
    if (method === 'POST' || method === 'PATCH' || method === 'PUT') {
      try {
        body = await readJsonBody(req);
      } catch (err: unknown) {
        sendDomainError(res, err);
        return true;
      }
    }

    // 6. Execute route handler with structured domain error mapping
    try {
      await route.handler(req, res, ctx, params, body);
    } catch (err: unknown) {
      sendDomainError(res, err);
    }

    return true;
  }

  getRegisteredRoutes(): Array<{ method: string; pattern: string; auth: string }> {
    return this.routes.map(r => ({
      method: r.method,
      pattern: r.pattern,
      auth: r.auth
    }));
  }

  clear(): void {
    this.routes = [];
  }
}

export const globalRouteRegistry = new RouteRegistry();
