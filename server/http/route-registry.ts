import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson } from '../routes/utils.ts';
import { createGameContext, type GameContext } from '../context/game-context.ts';
import { companyRepository } from '../repositories/company-repository.ts';
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
  /** Migrating module name (#178 coverage gate attributes routes to owners). */
  owner?: string;
  handler: RouteHandler<TBody>;
}

interface CompiledRoute {
  method: HttpMethod;
  pattern: string;
  regex: RegExp;
  paramNames: string[];
  specificity: number;
  auth: AuthRequirement;
  owner: string;
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
      owner: route.owner || 'unattributed',
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
      // #181: realm policy must come from the company's persisted realm, not
      // a hardcoded 0 — Challenge Realm rules (exchange/contracts/bonds
      // disabled, purchase limits) were silently bypassed on every
      // registry-owned endpoint.
      const company = session.companyId !== null ? companyRepository.findById(session.companyId) : null;
      ctx = createGameContext(session.companyId, session.playerId, company?.realmId ?? 0);
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

  getRegisteredRoutes(): Array<{ method: string; pattern: string; auth: string; owner: string }> {
    return this.routes.map(r => ({
      method: r.method,
      pattern: r.pattern,
      auth: r.auth,
      owner: r.owner
    }));
  }

  /** Resolve the declarative owner for a concrete method/path (#178 tests). */
  getOwner(pathname: string, method: string): string | null {
    const normalizedPath = pathname.endsWith('/') ? pathname : `${pathname}/`;
    const route = this.routes.find(r => r.method === method && r.regex.test(normalizedPath));
    return route?.owner ?? null;
  }

  /**
   * Detects registered routes whose patterns can both match the same
   * concrete path (e.g. /users/me/ vs /users/:id/) for at least one shared
   * HTTP method (#178). Ambiguous ownership must be explicit: either the
   * patterns are disjoint or the registration is rejected at startup.
   */
  findOverlaps(): Array<{ a: { method: string; pattern: string }; b: { method: string; pattern: string } }> {
    const overlaps: Array<{ a: { method: string; pattern: string }; b: { method: string; pattern: string } }> = [];
    for (let i = 0; i < this.routes.length; i++) {
      for (let j = i + 1; j < this.routes.length; j++) {
        const r1 = this.routes[i];
        const r2 = this.routes[j];
        if (r1.method !== r2.method) continue;
        if (patternsCanOverlap(r1, r2)) {
          overlaps.push({
            a: { method: r1.method, pattern: r1.pattern },
            b: { method: r2.method, pattern: r2.pattern }
          });
        }
      }
    }
    return overlaps;
  }

  /**
   * Startup report for ambiguous ownership (#178). Existing registrations
   * resolve deterministically via specificity ordering, so overlaps are
   * surfaced loudly (log) instead of failing boot; the ownership test locks
   * the historical resolutions. New registrations must not add overlaps.
   */
  reportOverlaps(): void {
    const overlaps = this.findOverlaps();
    if (overlaps.length > 0) {
      const detail = overlaps
        .map(o => `${o.a.method} ${o.a.pattern} <-> ${o.b.pattern}`)
        .join('; ');
      console.warn(`[RouteRegistry] ${overlaps.length} overlapping route pair(s) resolve by specificity: ${detail}`);
    }
  }
  clear(): void {
    this.routes = [];
  }
}

export const globalRouteRegistry = new RouteRegistry();

/**
 * Structural check: can two compiled route patterns match the same concrete
 * path? Segment-wise unification — a parameter segment (:name) unifies with
 * anything; two literal segments unify only when equal. Patterns have equal
 * arity requirement (anchored regex), so length must match.
 */
function patternsCanOverlap(a: CompiledRoute, b: CompiledRoute): boolean {
  const segsA = a.pattern.endsWith('/') ? a.pattern : `${a.pattern}/`;
  const segsB = b.pattern.endsWith('/') ? b.pattern : `${b.pattern}/`;
  const partsA = segsA.split('/').filter(Boolean);
  const partsB = segsB.split('/').filter(Boolean);
  if (partsA.length !== partsB.length) return false;
  for (let i = 0; i < partsA.length; i++) {
    const pa = partsA[i];
    const pb = partsB[i];
    const isParamA = pa.startsWith(':');
    const isParamB = pb.startsWith(':');
    if (!isParamA && !isParamB && pa !== pb) return false;
  }
  return true;
}
