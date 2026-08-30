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

export async function handleRequest(req: IncomingMessage, res: ServerResponse) {
  const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;
  const method = req.method || 'GET';

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-CSRFToken',
      'Access-Control-Allow-Credentials': 'true'
    });
    res.end();
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
  if (await handleWarehouseRoutes(req, res, pathname, method)) {
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
    console.warn(`[API Not Implemented] ${method} ${pathname}`);
    return sendJson(res, {
      error: 'API route is not implemented',
      code: 'API_NOT_IMPLEMENTED',
      method,
      path: pathname
    }, 404);
  }

  // 5. HTML Page rendering (SPA catch-all)
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
