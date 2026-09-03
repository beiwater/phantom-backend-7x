import type { IncomingMessage, ServerResponse } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from './config.ts';
import { serveOrFetchAsset } from './proxy/asset-fetcher.ts';
import { sendJson } from './routes/utils.ts';
import { extractSessionToken, getSession, buildSessionCookie } from './auth/session.ts';
import { globalRouteRegistry } from './http/route-registry.ts';
import './events/subscribers.ts';
import './routes/building-routes.ts';
import { handleAuthRoutes } from './routes/auth-routes.ts';
// Building routes self-register with the declarative registry.
import { handleWarehouseRoutes } from './routes/warehouse-routes.ts';
import { handleMarketRoutes } from './routes/market-routes.ts';
import { handleEncyclopediaRoutes } from './routes/encyclopedia-routes.ts';
import { handleSocialRoutes } from './routes/social-routes.ts';
import { handleFinanceRoutes } from './routes/finance-routes.ts';
import { handleContractRoutes } from './routes/contract-routes.ts';
import { handleBondRoutes } from './routes/bond-routes.ts';
import { handleExecutiveRoutes } from './routes/executive-routes.ts';
import { handleResearchRoutes } from './routes/research-routes.ts';
import { handleAchievementRoutes } from './routes/achievement-routes.ts';
import { handleSimboostRoutes } from './routes/simboost-routes.ts';
import { handleRetailRoutes } from './routes/retail-routes.ts';
import { handleRestaurantRoutes } from './routes/restaurant-routes.ts';
import { handlePageRoutes } from './routes/page-routes.ts';
import { handleAuditRoutes } from './routes/audit-routes.ts';
import { handleGovernmentRoutes } from './routes/government-routes.ts';
import { handleAerospaceRoutes } from './routes/aerospace-routes.ts';
import { handleBuildingAuctionRoutes } from './routes/building-auction-routes.ts';
import { handleCollectibleRoutes } from './routes/collectible-routes.ts';
import { handleNewspaperRoutes } from './routes/newspaper-routes.ts';
import { virtualClock } from './core/virtual-clock.ts';
import { handleDebugRoutes } from './routes/debug-routes.ts';
import './routes/health-routes.ts';
import './routes/economy-routes.ts';
import { logger } from './core/logger.ts';

// Issue #178: all route modules have self-registered by import; surface any
// ambiguous ownership loudly at startup. Existing overlaps resolve
// deterministically via specificity and are locked by the ownership test.
globalRouteRegistry.reportOverlaps();

// Issue #178: the manifest is the explicit exception ledger for endpoints
// NOT yet owned by the declarative registry (server/http/route-registry.ts).
// It provides 405/Allow for legacy paths only and must never conflict with a
// registry-owned route — tests/test-route-ownership.test.ts enforces that
// boundary. New API routes must register in the registry, not here.
export const methodManifest: Array<{ pattern: RegExp; methods: string[]; owner: string }> = [
  { pattern: /^\/api\/time\/$/, methods: ['GET'], owner: 'legacy:time' },
  { pattern: /^\/api\/v2\/auth\/email\/(?:auth|connect|reset)\/$/, methods: ['POST'], owner: 'legacy:auth' },
  { pattern: /^\/api\/v2\/auth\/device\/(?:auth|connect)\/$/, methods: ['POST'], owner: 'legacy:auth' },
  { pattern: /^\/api\/v2\/companies\/me\/buildings\/$/, methods: ['GET', 'POST'], owner: 'legacy:buildings' },
  { pattern: /^\/api\/v2\/market-order\/(?:take\/)?$/, methods: ['POST'], owner: 'legacy:market' },
  { pattern: /^\/api\/v4\/executives\/$/, methods: ['GET'], owner: 'legacy:executives' },
  { pattern: /^\/api\/v4\/executives\/candidates\/$/, methods: ['GET'], owner: 'legacy:executives' },
  { pattern: /^\/api\/v4\/executives\/hire\/$/, methods: ['POST'], owner: 'legacy:executives' },
  { pattern: /^\/api\/v2\/market\/bonds\/$/, methods: ['GET'], owner: 'legacy:bonds' },
  { pattern: /^\/api\/v2\/bonds\/sell\/$/, methods: ['POST'], owner: 'legacy:bonds' },
  { pattern: /^\/api\/v2\/bonds\/\d+\/buy\/$/, methods: ['POST'], owner: 'legacy:bonds' },
  { pattern: /^\/api\/v2\/bonds\/\d+\/call\/$/, methods: ['POST'], owner: 'legacy:bonds' },
  { pattern: /^\/api\/v3\/companies\/auth-data\/$/, methods: ['GET'], owner: 'legacy:auth' },
  { pattern: /^\/api\/v2\/constants\/resources\/$/, methods: ['GET'], owner: 'legacy:encyclopedia' }
];

export async function handleRequest(req: IncomingMessage, res: ServerResponse) {
  const startMs = Date.now();
  const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;
  const method = req.method || 'GET';
  const requestId = (req.headers['x-request-id'] as string) || logger.generateRequestId();

  res.setHeader('X-Request-Id', requestId);

  res.on('finish', () => {
    const durationMs = Date.now() - startMs;
    logger.info(`${method} ${pathname} ${res.statusCode} (${durationMs}ms)`, {
      method,
      path: pathname,
      statusCode: res.statusCode,
      durationMs,
      ip: req.socket.remoteAddress
    }, requestId);
  });
  const requestOrigin = req.headers.origin;
  const requestHost = req.headers.host;
  const allowedOrigin = requestOrigin === undefined
    ? '*'
    : (requestOrigin === CONFIG.BASE_URL ||
       requestOrigin === `http://${requestHost}` ||
       requestOrigin === `https://${requestHost}`)
      ? requestOrigin
      : '';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  if (allowedOrigin && allowedOrigin !== '*') {
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }

  if (method === 'OPTIONS') {
    const headers: Record<string, string> = {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-CSRFToken'
    };
    if (allowedOrigin && allowedOrigin !== '*') {
      headers['Access-Control-Allow-Credentials'] = 'true';
    }
    res.writeHead(204, headers);
    res.end();
    return;
  }

  const methodEntry = methodManifest.find(entry => entry.pattern.test(pathname));
  if (methodEntry && !methodEntry.methods.includes(method)) {
    sendJson(res, {
      error: 'Method not allowed',
      code: 'METHOD_NOT_ALLOWED',
      method,
      path: pathname
    }, 405, { Allow: methodEntry.methods.join(', ') });
    return;
  }

  // 1. Static Assets
  if (
    pathname.startsWith('/static/') ||
    pathname.startsWith('/images/') ||
    pathname.startsWith('/chat-icon/') ||
    pathname === '/manifest.json' ||
    pathname === '/favicon.ico'
  ) {
    const served = await serveOrFetchAsset(pathname, res);
    if (!served) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Asset Not Found');
    }
    return;
  }
  // Health endpoints self-register in the declarative registry.

  // System version and time endpoints
  if (pathname === '/version/' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('dd7ff2122fa75facbc8862ed32ddd282df300a6b\n');
    return;
  }
  if (pathname === '/api/time/' && method === 'GET') {
    sendJson(res, virtualClock.nowMs());
    return;
  }

  // 2. Resolve User Session
  const sessionToken = extractSessionToken(req);
  const session = sessionToken ? getSession(sessionToken) : null;
  const currentPlayerId = session ? session.playerId : null;
  const currentCompanyId = session ? session.companyId : null;

  // 3. Dispatch to Declarative Route Registry first (strangler fig pattern)
  if (await globalRouteRegistry.dispatch(req, res, pathname, method, session ? { playerId: session.playerId, companyId: session.companyId } : null)) {
    return;
  }

  // Debug & Test Fixture Routes (Time Warp, Scenarios, Fast-Forward)
  if (await handleDebugRoutes(req, res, pathname, method, currentPlayerId, currentCompanyId)) {
    return;
  }
  // 4. Dispatch to Legacy Route Handlers. The chain order is a single named
  // constant (see runLegacyChain below); tests/test-route-ownership.test.ts
  // permutes it and asserts endpoint ownership does not move (#178).
  if (await runLegacyChain(req, res, pathname, method, { sessionToken, currentPlayerId, currentCompanyId })) {
    return;
  }

  // 5. Fallback for unhandled API requests
  if (pathname.startsWith('/api/')) {
    console.warn(`[API Not Found] ${method} ${pathname}`);
    return sendJson(res, {
      error: 'API route not found',
      code: 'API_NOT_FOUND',
      method,
      path: pathname
    }, 404);
  }
  const htmlPath = path.join(CONFIG.HTML_DIR, 'index.html');
  if (fs.existsSync(htmlPath)) {
    const htmlContent = fs.readFileSync(htmlPath, 'utf-8');
    const setCookieHeaders = (session && sessionToken) ? [
      buildSessionCookie(sessionToken),
      'django_language=zh-cn; Path=/; SameSite=Lax'
    ] : [
      'django_language=zh-cn; Path=/; SameSite=Lax'
    ];

    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Set-Cookie': setCookieHeaders
    });
    res.end(htmlContent);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
}

// ---------------------------------------------------------------------------
// Legacy handler chain (#178)
//
// The historical shadowing constraints (newspaper-before-social #83,
// bond-before-finance #42, auction-before-achievement #95) are encoded here
// as ONE canonical named order. tests/test-route-ownership.test.ts permutes
// the order and asserts endpoint ownership is stable: a future handler broad
// enough to capture a neighbour's endpoint fails the test instead of
// silently changing live behavior.

interface LegacyDeps {
  sessionToken: string | null;
  currentPlayerId: number | null;
  currentCompanyId: number | null;
}

interface LegacyHandlerSpec {
  name: string;
  make: (
    pathname: string,
    method: string,
    deps: LegacyDeps
  ) => (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;
}

const legacyHandlerFactories: LegacyHandlerSpec[] = [
  {
    name: 'auth',
    make: (p, m, d) => (req, res) => handleAuthRoutes(req, res, p, m, d.sessionToken, d.currentPlayerId, d.currentCompanyId)
  },
  {
    name: 'simboost',
    make: (p, m, d) => (req, res) => handleSimboostRoutes(req, res, p, m, d.currentPlayerId, d.currentCompanyId)
  },
  {
    name: 'newspaper',
    make: (p, m, d) => (req, res) => handleNewspaperRoutes(req, res, p, m, d.currentPlayerId, d.currentCompanyId)
  },
  {
    name: 'retail',
    make: (p, m, d) => (req, res) => handleRetailRoutes(req, res, p, m, d.currentCompanyId)
  },
  {
    name: 'restaurant',
    make: (p, m, d) => (req, res) => handleRestaurantRoutes(req, res, p, m, d.currentCompanyId)
  },
  {
    name: 'warehouse',
    make: (p, m, d) => (req, res) => handleWarehouseRoutes(req, res, p, m, d.currentCompanyId)
  },
  {
    name: 'market',
    make: (p, m, d) => (req, res) => handleMarketRoutes(req, res, p, m, d.currentCompanyId)
  },
  {
    name: 'government',
    make: (p, m, d) => (req, res) => handleGovernmentRoutes(req, res, p, m, d.currentCompanyId)
  },
  {
    name: 'encyclopedia',
    make: (p, m, d) => (req, res) => handleEncyclopediaRoutes(req, res, p, m, d.currentCompanyId)
  },
  {
    name: 'social',
    make: (p, m, d) => (req, res) => handleSocialRoutes(req, res, p, m, d.currentCompanyId)
  },
  {
    name: 'bonds',
    make: (p, m, d) => (req, res) => handleBondRoutes(req, res, p, m, d.currentCompanyId)
  },
  {
    name: 'finance',
    make: (p, m, d) => (req, res) => handleFinanceRoutes(req, res, p, m, d.currentCompanyId)
  },
  {
    name: 'contracts',
    make: (p, m, d) => (req, res) => handleContractRoutes(req, res, p, m, d.currentCompanyId)
  },
  {
    name: 'executives',
    make: (p, m, d) => (req, res) => handleExecutiveRoutes(req, res, p, m, d.currentCompanyId)
  },
  {
    name: 'research',
    make: (p, m, d) => (req, res) => handleResearchRoutes(req, res, p, m, d.currentCompanyId)
  },
  {
    name: 'aerospace',
    make: (p, m, d) => (req, res) => handleAerospaceRoutes(req, res, p, m, d.currentCompanyId)
  },
  {
    name: 'building-auctions',
    make: (p, m, d) => (req, res) => handleBuildingAuctionRoutes(req, res, p, m, d.currentCompanyId)
  },
  {
    name: 'pages',
    make: (p, m, d) => (req, res) => handlePageRoutes(req, res, p, m, d.currentPlayerId)
  },
  {
    name: 'achievements',
    make: (p, m, d) => (req, res) => handleAchievementRoutes(req, res, p, m, d.currentCompanyId)
  },
  {
    name: 'audit',
    make: (p, m, d) => (req, res) => handleAuditRoutes(req, res, p, m, d.currentPlayerId, d.currentCompanyId)
  },
  {
    name: 'collectibles',
    make: (p, m, d) => (req, res) => handleCollectibleRoutes(req, res, p, m, d.currentCompanyId)
  }
];

const CANONICAL_LEGACY_ORDER: string[] = legacyHandlerFactories.map(h => h.name);
let legacyOrderForTests: string[] | null = null;

export function getCanonicalLegacyOrder(): string[] {
  return [...CANONICAL_LEGACY_ORDER];
}

/** Test hook: pin the legacy chain to a custom order (ownership tests). */
export function setLegacyHandlerOrderForTests(names: string[] | null): void {
  legacyOrderForTests = names;
}

async function runLegacyChain(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  deps: LegacyDeps
): Promise<boolean> {
  const order = legacyOrderForTests ?? CANONICAL_LEGACY_ORDER;
  const byName = new Map(legacyHandlerFactories.map(h => [h.name, h]));
  for (const name of order) {
    const spec = byName.get(name);
    if (!spec) throw new Error(`Unknown legacy handler: ${name}`);
    if (await spec.make(pathname, method, deps)(req, res)) {
      return true;
    }
  }
  return false;
}

/** Minimal response surface the ownership probe needs to observe. */
interface ProbeResponseLike {
  statusCode: number | null;
  writeHead(code: number, headers?: Record<string, string>): unknown;
  end(body?: unknown): unknown;
  setHeader(name: string, value: string): unknown;
}

/**
 * Test helper: which legacy handler claims (method, pathname) under the given
 * chain order? Runs the real handlers against a probe request/response with
 * a null session, so auth-guarded endpoints claim as 401 — deterministic and
 * side-effect free for ownership purposes.
 */
export async function resolveLegacyOwnerForTests(
  pathname: string,
  method: string,
  names: string[] | null = null
): Promise<{ owner: string | null; status: number | null }> {
  const { EventEmitter } = await import('node:events');
  const req = new EventEmitter() as IncomingMessage;
  Object.assign(req, {
    url: pathname,
    method,
    headers: { 'content-length': '0' } as Record<string, string>,
    resume: () => req
  });
  queueMicrotask(() => req.emit('end'));

  const probe: ProbeResponseLike = {
    statusCode: null,
    writeHead(code) {
      probe.statusCode = code;
      return probe;
    },
    end() {
      return probe;
    },
    setHeader() {
      return probe;
    },
    getHeader() {
      return undefined;
    }
  };
  const res = probe as unknown as ServerResponse; // structural probe, handlers only use this surface

  const order = names ?? CANONICAL_LEGACY_ORDER;
  const byName = new Map(legacyHandlerFactories.map(h => [h.name, h]));
  const deps: LegacyDeps = { sessionToken: null, currentPlayerId: null, currentCompanyId: null };
  for (const name of order) {
    const spec = byName.get(name);
    if (!spec) throw new Error(`Unknown legacy handler: ${name}`);
    if (await spec.make(pathname, method, deps)(req, res)) {
      return { owner: name, status: probe.statusCode };
    }
  }
  return { owner: null, status: null };
}
