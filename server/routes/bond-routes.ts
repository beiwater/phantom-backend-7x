import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson, requireCapability } from './utils.ts';
import { RouteRegistry, globalRouteRegistry } from '../http/route-registry.ts';
import {
  getBondsOwnedQuery,
  getBondsSoldQuery,
  getBondMarketListingsQuery,
  issueBondsCommand,
  buyBondsCommand,
  callBondsCommand
} from '../application/finance/finance-use-cases.ts';
import { createGameContext, type GameContext } from '../context/game-context.ts';

// Bond commands require an authenticated company; bound at handler entry.
let _bondCompanyId: number | null = null;
function bondCtx(): GameContext {
  return createGameContext(_bondCompanyId as number, _bondCompanyId as number, 0);
}

export async function handleBondRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  currentCompanyId: number | null
): Promise<boolean> {
  _bondCompanyId = currentCompanyId;
  // Bonds owned
  const ownedMatch = pathname.match(/^\/api\/v2\/companies\/(\d+|me)\/bonds\/owned\/$/);
  if (ownedMatch) {
    const companyId = ownedMatch[1] === 'me' ? currentCompanyId : Number(ownedMatch[1]);
    if (!currentCompanyId || !companyId || companyId !== currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    sendJson(res, getBondsOwnedQuery(companyId));
    return true;
  }

  // Bonds sold
  const soldMatch = pathname.match(/^\/api\/v2\/companies\/(\d+|me)\/bonds\/sold\/$/);
  if (soldMatch) {
    const companyId = soldMatch[1] === 'me' ? currentCompanyId : Number(soldMatch[1]);
    if (!currentCompanyId || !companyId || companyId !== currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    sendJson(res, getBondsSoldQuery(companyId));
    return true;
  }

  // Company's own bond offering on the market: GET /api/bonds/, PATCH /api/bonds/
  if (pathname === '/api/bonds/') {
    if (method === 'PATCH') {
      if (!currentCompanyId) {
        sendJson(res, { error: 'Unauthorized' }, 401);
        return true;
      }
      // Issue #71: bonds capability gate (canonical tier table).
      if (requireCapability(res, currentCompanyId, 'bonds', 'issue bonds')) return true;
      const body = await readJsonBody<{ amount?: number; interest?: number }>(req);
      try {
        const result = await issueBondsCommand(bondCtx(), Number(body.amount), Number(body.interest ?? 0.005));
        sendJson(res, result);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, { error: msg }, 400);
      }
      return true;
    }
    if (method === 'GET') {
      if (!currentCompanyId) {
        sendJson(res, { error: 'Unauthorized' }, 401);
        return true;
      }
      sendJson(res, { amount: 0, interest: 0.5 });
      return true;
    }
  }

  // Bonds market list by rating or all: /api/bonds/rating/:rating/, /api/v2/market/bonds/
  const bondRatingMatch = pathname.match(/^\/api\/bonds\/rating\/([^/]+)\/$/);
  if (pathname === '/api/v2/market/bonds/' || bondRatingMatch) {
    sendJson(res, getBondMarketListingsQuery());
    return true;
  }

  // Single bond details, buy, or call: /api/bonds/:id/, /api/v2/bonds/:id/buy/, /api/v2/bonds/:id/call/
  const singleBondMatch = pathname.match(/^\/api\/bonds\/(\d+)\/$/);
  if (singleBondMatch) {
    const bondId = Number(singleBondMatch[1]);
    if (method === 'PATCH' || method === 'PUT') {
      if (!currentCompanyId) {
        sendJson(res, { error: 'Unauthorized' }, 401);
        return true;
      }
      // Issue #71: bonds capability gate (canonical tier table).
      const capErr = method === 'PATCH' ? 'buy bond' : 'call bond';
      if (requireCapability(res, currentCompanyId, 'bonds', capErr)) return true;
      try {
        const result = await (method === 'PATCH'
          ? buyBondsCommand(bondCtx(), bondId)
          : callBondsCommand(bondCtx(), bondId));
        sendJson(res, result);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, { error: msg }, 400);
      }
      return true;
    }
    const bond = getBondMarketListingsQuery().find(item => item.id === bondId);
    if (!bond) {
      sendJson(res, { error: 'Bond not found' }, 404);
      return true;
    }
    sendJson(res, bond);
    return true;
  }

  // Issue bonds: /api/v2/bonds/sell/
  if (pathname === '/api/v2/bonds/sell/' && method === 'POST') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    if (requireCapability(res, currentCompanyId, 'bonds', 'issue bonds')) return true;
    const body = await readJsonBody<{ amount?: number; interest?: number }>(req);
    try {
      const result = await issueBondsCommand(bondCtx(), Number(body.amount), Number(body.interest ?? 0.005));
      sendJson(res, result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: msg }, 400);
    }
    return true;
  }

  // Buy bond: /api/v2/bonds/:id/buy/
  const buyMatch = pathname.match(/^\/api\/v2\/bonds\/(\d+)\/buy\/$/);
  if (buyMatch && method === 'POST') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    // Issue #71: bonds capability gate (canonical tier table).
    if (requireCapability(res, currentCompanyId, 'bonds', 'buy bond')) return true;
    const bondId = Number(buyMatch[1]);
    try {
      sendJson(res, await buyBondsCommand(bondCtx(), bondId));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: msg }, 400);
    }
    return true;
  }

  // Call bond early: /api/v2/bonds/:id/call/
  const callMatch = pathname.match(/^\/api\/v2\/bonds\/(\d+)\/call\/$/);
  if (callMatch && method === 'POST') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    // Issue #71: bonds capability gate (canonical tier table).
    if (requireCapability(res, currentCompanyId, 'bonds', 'call bond')) return true;
    const bondId = Number(callMatch[1]);
    try {
      sendJson(res, await callBondsCommand(bondCtx(), bondId));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: msg }, 400);
    }
    return true;
  }

  return false;
}
export function registerBondRoutes(registry: RouteRegistry = globalRouteRegistry): void {
  const companyRequired = (ctx: GameContext | null, res: ServerResponse): number | null => {
    const companyId = ctx?.companyId ?? null;
    if (!companyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return null;
    }
    return companyId;
  };
  const bodyField = (body: unknown, field: string): unknown => {
    if (!body || typeof body !== 'object' || !(field in body)) return undefined;
    return Reflect.get(body, field);
  };
  const commandError = (err: unknown): { error: string } => ({
    error: err instanceof Error ? err.message : String(err)
  });

  registry
    .register({
      method: 'GET',
      pattern: '/api/v2/companies/:companyId/bonds/owned/',
      owner: 'bonds',
      handler: async (req, res, ctx, params) => {
        const companyId = params.companyId === 'me' ? ctx?.companyId ?? null : Number(params.companyId);
        if (!ctx?.companyId || !companyId || companyId !== ctx.companyId) {
          sendJson(res, { error: 'Unauthorized' }, 401);
          return;
        }
        sendJson(res, getBondsOwnedQuery(companyId));
      }
    })
    .register({
      method: 'GET',
      pattern: '/api/v2/companies/:companyId/bonds/sold/',
      owner: 'bonds',
      handler: async (_req, res, ctx, params) => {
        const companyId = params.companyId === 'me' ? ctx?.companyId ?? null : Number(params.companyId);
        if (!ctx?.companyId || !companyId || companyId !== ctx.companyId) {
          sendJson(res, { error: 'Unauthorized' }, 401);
          return;
        }
        sendJson(res, getBondsSoldQuery(companyId));
      }
    })
    .register({
      method: 'GET',
      pattern: '/api/bonds/',
      owner: 'bonds',
      handler: async (_req, res, ctx) => {
        if (!companyRequired(ctx, res)) return;
        sendJson(res, { amount: 0, interest: 0.5 });
      }
    })
    .register({
      method: 'PATCH',
      pattern: '/api/bonds/',
      owner: 'bonds',
      handler: async (_req, res, ctx, _params, body) => {
        if (!companyRequired(ctx, res)) return;
        if (requireCapability(res, ctx!.companyId, 'bonds', 'issue bonds')) return;
        try {
          const result = await issueBondsCommand(ctx!, Number(bodyField(body, 'amount')), Number(bodyField(body, 'interest') ?? 0.005));
          sendJson(res, result);
        } catch (err: unknown) {
          sendJson(res, commandError(err), 400);
        }
      }
    })
    .register({
      method: 'GET',
      pattern: '/api/v2/market/bonds/',
      owner: 'bonds',
      handler: async (_req, res) => { sendJson(res, getBondMarketListingsQuery()); }
    })
    .register({
      method: 'GET',
      pattern: '/api/bonds/rating/:rating/',
      owner: 'bonds',
      handler: async (_req, res) => { sendJson(res, getBondMarketListingsQuery()); }
    })
    .register({
      method: 'GET',
      pattern: '/api/bonds/:bondId/',
      owner: 'bonds',
      handler: async (_req, res, _ctx, params) => {
        const bond = getBondMarketListingsQuery().find(item => item.id === Number(params.bondId));
        if (!bond) {
          sendJson(res, { error: 'Bond not found' }, 404);
          return;
        }
        sendJson(res, bond);
      }
    })
    .register({
      method: 'PATCH',
      pattern: '/api/bonds/:bondId/',
      owner: 'bonds',
      handler: async (_req, res, ctx, params) => {
        if (!companyRequired(ctx, res)) return;
        if (requireCapability(res, ctx!.companyId, 'bonds', 'buy bond')) return;
        try {
          sendJson(res, await buyBondsCommand(ctx!, Number(params.bondId)));
        } catch (err: unknown) {
          sendJson(res, commandError(err), 400);
        }
      }
    })
    .register({
      method: 'PUT',
      pattern: '/api/bonds/:bondId/',
      owner: 'bonds',
      handler: async (_req, res, ctx, params) => {
        if (!companyRequired(ctx, res)) return;
        if (requireCapability(res, ctx!.companyId, 'bonds', 'call bond')) return;
        try {
          sendJson(res, await callBondsCommand(ctx!, Number(params.bondId)));
        } catch (err: unknown) {
          sendJson(res, commandError(err), 400);
        }
      }
    })
    .register({
      method: 'POST',
      pattern: '/api/v2/bonds/sell/',
      owner: 'bonds',
      handler: async (_req, res, ctx, _params, body) => {
        if (!companyRequired(ctx, res)) return;
        if (requireCapability(res, ctx!.companyId, 'bonds', 'issue bonds')) return;
        try {
          sendJson(res, await issueBondsCommand(ctx!, Number(bodyField(body, 'amount')), Number(bodyField(body, 'interest') ?? 0.005)));
        } catch (err: unknown) {
          sendJson(res, commandError(err), 400);
        }
      }
    })
    .register({
      method: 'POST',
      pattern: '/api/v2/bonds/:bondId/buy/',
      owner: 'bonds',
      handler: async (_req, res, ctx, params) => {
        if (!companyRequired(ctx, res)) return;
        if (requireCapability(res, ctx!.companyId, 'bonds', 'buy bond')) return;
        try {
          sendJson(res, await buyBondsCommand(ctx!, Number(params.bondId)));
        } catch (err: unknown) {
          sendJson(res, commandError(err), 400);
        }
      }
    })
    .register({
      method: 'POST',
      pattern: '/api/v2/bonds/:bondId/call/',
      owner: 'bonds',
      handler: async (_req, res, ctx, params) => {
        if (!companyRequired(ctx, res)) return;
        if (requireCapability(res, ctx!.companyId, 'bonds', 'call bond')) return;
        try {
          sendJson(res, await callBondsCommand(ctx!, Number(params.bondId)));
        } catch (err: unknown) {
          sendJson(res, commandError(err), 400);
        }
      }
    });
}

registerBondRoutes(globalRouteRegistry);
