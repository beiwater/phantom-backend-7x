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

export async function handleRequest(req: IncomingMessage, res: ServerResponse) {
  const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;
  const method = req.method || 'GET';

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS'
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

  // 2. Resolve User Session
  const sessionToken = extractSessionToken(req);
  const session = sessionToken ? getSession(sessionToken) : null;
  const currentPlayerId = session ? session.playerId : null;
  const currentCompanyId = session ? session.companyId : null;

  // 3. Dispatch to Modular Route Handlers
  if (await handleAuthRoutes(req, res, pathname, method, sessionToken, currentPlayerId, currentCompanyId)) {
    return;
  }
  if (await handleBuildingRoutes(req, res, pathname, method, currentCompanyId)) {
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
  if (await handleFinanceRoutes(req, res, pathname, method, currentCompanyId)) {
    return;
  }

  // 4. Fallback for unhandled API requests
  if (pathname.startsWith('/api/')) {
    console.log(`[API Fallback] Unhandled ${method} ${pathname}`);
    return sendJson(res, []);
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
