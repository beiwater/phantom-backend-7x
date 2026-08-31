import type { IncomingMessage, ServerResponse } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from './config.ts';
import { serveOrFetchAsset } from './proxy/asset-fetcher.ts';
import { sendJson } from './routes/utils.ts';
import { extractSessionToken, getSession } from './auth/session.ts';
import { handleAuthRoutes } from './routes/auth-routes.ts';
import { handleBuildingRoutes } from './routes/building-routes.ts';
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
// A small compatibility manifest keeps method errors distinct from unknown routes.
const methodManifest: Array<{ pattern: RegExp; methods: string[] }> = [
  { pattern: /^\/api\/v2\/time-millis\/$/, methods: ['GET'] },
  { pattern: /^\/api\/time\/$/, methods: ['GET'] },
  { pattern: /^\/api\/v2\/auth\/email\/(?:auth|connect|reset)\/$/, methods: ['POST'] },
  { pattern: /^\/api\/v2\/auth\/device\/(?:auth|connect)\/$/, methods: ['POST'] },
  { pattern: /^\/api\/v2\/companies\/me\/buildings\/$/, methods: ['GET', 'POST'] },
  { pattern: /^\/api\/v2\/market-order\/(?:take\/)?$/, methods: ['POST'] }
];

export async function handleRequest(req: IncomingMessage, res: ServerResponse) {
  const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;
  const method = req.method || 'GET';

  // Handle CORS preflight without combining wildcard origins and credentials.
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

  // System version and time endpoints
  if (pathname === '/version/' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('dd7ff2122fa75facbc8862ed32ddd282df300a6b\n');
    return;
  }
  if ((pathname === '/api/v2/time-millis/' || pathname === '/api/time/') && method === 'GET') {
    sendJson(res, Date.now());
    return;
  }

  // 2. Resolve User Session
  const sessionToken = extractSessionToken(req);
  const session = sessionToken ? getSession(sessionToken) : null;
  const currentPlayerId = session ? session.playerId : null;
  const currentCompanyId = session ? session.companyId : null;

  // 3. Dispatch to Modular Route Handlers
  if (await handleAuthRoutes(req, res, pathname, method, sessionToken, currentPlayerId, currentCompanyId)) {
    return;
  }
  if (await handleSimboostRoutes(req, res, pathname, method, currentPlayerId, currentCompanyId)) {
    return;
  }
  if (await handleBuildingRoutes(req, res, pathname, method, currentCompanyId)) {
    return;
  }
  if (await handleRetailRoutes(req, res, pathname, method, currentCompanyId)) {
    return;
  }
  if (await handleWarehouseRoutes(req, res, pathname, method, currentCompanyId)) {
    return;
  }
  if (await handleMarketRoutes(req, res, pathname, method, currentCompanyId)) {
    return;
  }
  if (await handleEncyclopediaRoutes(req, res, pathname, method, currentCompanyId)) {
    return;
  }
  if (await handleSocialRoutes(req, res, pathname, method, currentCompanyId)) {
    return;
  }
  // Bond routes must dispatch BEFORE finance routes: finance's '/bonds/' stub would otherwise shadow every real bond endpoint (issue #42)
  if (await handleBondRoutes(req, res, pathname, method, currentCompanyId)) {
    return;
  }
  if (await handleFinanceRoutes(req, res, pathname, method, currentCompanyId)) {
    return;
  }
  if (await handleContractRoutes(req, res, pathname, method, currentCompanyId)) {
    return;
  }
  if (await handleExecutiveRoutes(req, res, pathname, method, currentCompanyId)) {
    return;
  }
  if (await handleResearchRoutes(req, res, pathname, method, currentCompanyId)) {
    return;
  }
  if (await handleAchievementRoutes(req, res, pathname, method, currentCompanyId)) {
    return;
  }

  // 4. Fallback for unhandled API requests
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
    const setCookieHeaders = sessionToken ? [
      `sessionid=${sessionToken}; Path=/; HttpOnly; SameSite=Lax`,
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
