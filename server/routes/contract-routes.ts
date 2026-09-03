import type { IncomingMessage, ServerResponse } from 'node:http';
import { RouteRegistry, globalRouteRegistry } from '../http/route-registry.ts';
import { readJsonBody, sendJson, requireCapability } from './utils.ts';
import {
  getIncomingContractsQuery,
  getOutgoingContractsQuery,
  getContractHistoryQuery,
  getWarehouseContractsSummaryQuery,
  sendContractCommand,
  acceptContractCommand,
  rejectContractCommand,
  cancelContractCommand
} from '../application/finance/finance-use-cases.ts';
import { getContractHistoryDetail } from '../application/finance/contract-use-cases.ts';
import { createGameContext, type GameContext } from '../context/game-context.ts';

// Contract commands require an authenticated company; bound at handler entry.
let _contractCompanyId: number | null = null;
function contractCtx(): GameContext {
  return createGameContext(_contractCompanyId as number, _contractCompanyId as number, 0);
}

export async function handleContractRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  currentCompanyId: number | null
): Promise<boolean> {
  _contractCompanyId = currentCompanyId;

  // 1. Incoming contracts (v2 & v3)
  if (
    pathname === '/api/v2/contracts-incoming/' ||
    pathname.match(/^\/api\/v3\/contracts-incoming\/(?:(?:\d+|me)\/)?(?:\d+|me)\/$/) ||
    pathname.match(/^\/api\/v3\/contracts-incoming\/(\d+|me)\/$/)
  ) {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    sendJson(res, getIncomingContractsQuery(currentCompanyId), 200, { 'x-timestamp': new Date().toISOString() });
    return true;
  }

  // 2. Outgoing contracts (v2 & v3)
  if (
    pathname === '/api/v2/contracts-outgoing/' ||
    pathname.match(/^\/api\/v3\/contracts-outgoing\/(?:(?:\d+|me)\/)?(?:\d+|me)\/$/) ||
    pathname.match(/^\/api\/v3\/contracts-outgoing\/(\d+|me)\/$/)
  ) {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    sendJson(res, getOutgoingContractsQuery(currentCompanyId), 200, { 'x-timestamp': new Date().toISOString() });
    return true;
  }

  // Contract history detail: :id is a settled direct-sale contract id.
  // The application query hides records where the caller owns neither side.
  const contractHistoryMatch = pathname.match(/^\/api\/v2\/contracts-history\/(\d+|me)\/?$/);
  if (contractHistoryMatch && method === 'GET') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    const contractId = Number(contractHistoryMatch[1]);
    if (!Number.isSafeInteger(contractId) || contractId <= 0) {
      sendJson(res, { error: 'Invalid contract id' }, 400);
      return true;
    }
    const contract = getContractHistoryDetail(currentCompanyId, contractId);
    if (!contract) {
      sendJson(res, { error: 'Contract history not found' }, 404);
      return true;
    }
    sendJson(res, contract, 200, {
      'x-timestamp': new Date().toISOString()
    });
    return true;
  }

  // 3. Contracts history incoming / outgoing
  if (
    pathname === '/api/v2/contracts-history-incoming/' ||
    pathname === '/api/v2/contracts-history-outgoing/' ||
    pathname.match(/^\/api\/v2\/contracts-history-(?:incoming|outgoing)\/(?:\d+|me)\/$/)
  ) {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    const direction = pathname.includes('history-incoming') ? 'incoming' : 'outgoing';
    const history = getContractHistoryQuery(currentCompanyId, direction);
    sendJson(res, history, 200, { 'x-timestamp': new Date().toISOString() });
    return true;
  }

  // 4. Warehouse contracts summary: /api/v2/warehouse-contracts-summary/:realm/:kindOrDirection/
  const contractsSummaryMatch = pathname.match(/^\/api\/v2\/warehouse-contracts-summary\/(\d+|me)\/([^/]+)\/$/);
  if (contractsSummaryMatch) {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    sendJson(res, { summary: getWarehouseContractsSummaryQuery(currentCompanyId) }, 200, { 'x-timestamp': new Date().toISOString() });
    return true;
  }

  // 5. Send new contract
  const sendContractMatch = pathname.match(/^\/api\/v3\/contracts\/(\d+|me)\/$/) || pathname === '/api/v2/contracts/';
  if (sendContractMatch && method === 'POST') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    // Issue #71: contracts capability gate (canonical tier table).
    if (requireCapability(res, currentCompanyId, 'contracts', 'send contract')) return true;
    const body = await readJsonBody<{
      recipient: number;
      kind: number;
      quality?: number;
      amount: number;
      price: number;
    }>(req);

    try {
      const contract = await sendContractCommand(contractCtx(), {
        buyerCompanyId: Number(body.recipient),
        resourceKind: Number(body.kind),
        quality: Number(body.quality || 0),
        amount: Number(body.amount),
        price: Number(body.price)
      });
      sendJson(res, contract);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: msg }, 400);
    }
    return true;
  }

  // 6. Accept contract
  const acceptMatch = pathname.match(/^\/api\/v3\/contracts\/(\d+)\/accept\/$/) ||
                      pathname.match(/^\/api\/v2\/contracts\/(\d+)\/accept\/$/);
  if (acceptMatch && method === 'POST') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    // Issue #71: contracts capability gate (canonical tier table).
    if (requireCapability(res, currentCompanyId, 'contracts', 'accept contract')) return true;
    const contractId = Number(acceptMatch[1]);
    try {
      const result = await acceptContractCommand(contractCtx(), contractId);
      sendJson(res, result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: msg }, 400);
    }
    return true;
  }

  // 7. Reject contract
  const rejectMatch = pathname.match(/^\/api\/v3\/contracts\/(\d+)\/reject\/$/) ||
                      pathname.match(/^\/api\/v2\/contracts\/(\d+)\/reject\/$/);
  if (rejectMatch && method === 'POST') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    // Issue #71: contracts capability gate (canonical tier table).
    if (requireCapability(res, currentCompanyId, 'contracts', 'reject contract')) return true;
    const contractId = Number(rejectMatch[1]);
    try {
      const result = await rejectContractCommand(contractCtx(), contractId);
      sendJson(res, result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: msg }, 400);
    }
    return true;
  }

  // 8. Cancel contract
  const cancelMatch = pathname.match(/^\/api\/v3\/contracts\/(\d+)\/$/) ||
                      pathname.match(/^\/api\/v2\/contracts\/(\d+)\/$/);
  if (cancelMatch && method === 'DELETE') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    // Issue #71: contracts capability gate (canonical tier table).
    if (requireCapability(res, currentCompanyId, 'contracts', 'cancel contract')) return true;
    const contractId = Number(cancelMatch[1]);
    try {
      const result = await cancelContractCommand(contractCtx(), contractId);
      sendJson(res, result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: msg }, 400);
    }
    return true;
  }

  return false;
}
export function registerContractRoutes(registry: RouteRegistry = globalRouteRegistry): void {
  const bodyField = (body: unknown, field: string): unknown => {
    if (!body || typeof body !== 'object' || !(field in body)) return undefined;
    return Reflect.get(body, field);
  };
  const timestamp = (): Record<string, string> => ({ 'x-timestamp': new Date().toISOString() });
  const companyRequired = (ctx: GameContext | null, res: ServerResponse): number | null => {
    const companyId = ctx?.companyId ?? null;
    if (!companyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return null;
    }
    return companyId;
  };
  const commandError = (err: unknown): { error: string } => ({
    error: err instanceof Error ? err.message : String(err)
  });
  const listIncoming = (_req: IncomingMessage, res: ServerResponse, ctx: GameContext | null): void => {
    const companyId = companyRequired(ctx, res);
    if (companyId !== null) sendJson(res, getIncomingContractsQuery(companyId), 200, timestamp());
  };
  const listOutgoing = (_req: IncomingMessage, res: ServerResponse, ctx: GameContext | null): void => {
    const companyId = companyRequired(ctx, res);
    if (companyId !== null) sendJson(res, getOutgoingContractsQuery(companyId), 200, timestamp());
  };
  const listHistory = (_req: IncomingMessage, res: ServerResponse, ctx: GameContext | null, direction: 'incoming' | 'outgoing'): void => {
    const companyId = companyRequired(ctx, res);
    if (companyId !== null) sendJson(res, getContractHistoryQuery(companyId, direction), 200, timestamp());
  };

  registry
    .register({ method: 'GET', pattern: '/api/v2/contracts-incoming/', owner: 'contracts', handler: async (req, res, ctx) => listIncoming(req, res, ctx) })
    .register({ method: 'GET', pattern: '/api/v3/contracts-incoming/:companyId/', owner: 'contracts', handler: async (req, res, ctx) => listIncoming(req, res, ctx) })
    .register({ method: 'GET', pattern: '/api/v3/contracts-incoming/:realm/:companyId/', owner: 'contracts', handler: async (req, res, ctx) => listIncoming(req, res, ctx) })
    .register({ method: 'GET', pattern: '/api/v2/contracts-outgoing/', owner: 'contracts', handler: async (req, res, ctx) => listOutgoing(req, res, ctx) })
    .register({ method: 'GET', pattern: '/api/v3/contracts-outgoing/:companyId/', owner: 'contracts', handler: async (req, res, ctx) => listOutgoing(req, res, ctx) })
    .register({ method: 'GET', pattern: '/api/v3/contracts-outgoing/:realm/:companyId/', owner: 'contracts', handler: async (req, res, ctx) => listOutgoing(req, res, ctx) })
    .register({
      method: 'GET', pattern: '/api/v2/contracts-history/:contractId/', owner: 'contracts',
      handler: async (req, res, ctx) => {
        const pathname = new URL(req.url || '/', 'http://localhost').pathname;
        await handleContractRoutes(req, res, pathname, 'GET', ctx?.companyId ?? null);
      }
    })
    .register({ method: 'GET', pattern: '/api/v2/contracts-history-incoming/', owner: 'contracts', handler: async (_req, res, ctx) => listHistory(_req, res, ctx, 'incoming') })
    .register({ method: 'GET', pattern: '/api/v2/contracts-history-outgoing/', owner: 'contracts', handler: async (_req, res, ctx) => listHistory(_req, res, ctx, 'outgoing') })
    .register({ method: 'GET', pattern: '/api/v2/contracts-history-incoming/:companyId/', owner: 'contracts', handler: async (_req, res, ctx) => listHistory(_req, res, ctx, 'incoming') })
    .register({ method: 'GET', pattern: '/api/v2/contracts-history-outgoing/:companyId/', owner: 'contracts', handler: async (_req, res, ctx) => listHistory(_req, res, ctx, 'outgoing') })
    .register({
      method: 'POST', pattern: '/api/v3/contracts/:recipient/', owner: 'contracts',
      handler: async (_req, res, ctx, _params, body) => {
        const companyId = companyRequired(ctx, res);
        if (!companyId) return;
        if (requireCapability(res, companyId, 'contracts', 'send contract')) return;
        try {
          sendJson(res, await sendContractCommand(ctx!, {
            buyerCompanyId: Number(bodyField(body, 'recipient')),
            resourceKind: Number(bodyField(body, 'kind')),
            quality: Number(bodyField(body, 'quality') || 0),
            amount: Number(bodyField(body, 'amount')),
            price: Number(bodyField(body, 'price'))
          }));
        } catch (err: unknown) { sendJson(res, commandError(err), 400); }
      }
    })
    .register({
      method: 'POST', pattern: '/api/v2/contracts/', owner: 'contracts',
      handler: async (_req, res, ctx, _params, body) => {
        const companyId = companyRequired(ctx, res);
        if (!companyId) return;
        if (requireCapability(res, companyId, 'contracts', 'send contract')) return;
        try {
          sendJson(res, await sendContractCommand(ctx!, {
            buyerCompanyId: Number(bodyField(body, 'recipient')),
            resourceKind: Number(bodyField(body, 'kind')),
            quality: Number(bodyField(body, 'quality') || 0),
            amount: Number(bodyField(body, 'amount')),
            price: Number(bodyField(body, 'price'))
          }));
        } catch (err: unknown) { sendJson(res, commandError(err), 400); }
      }
    })
    .register({
      method: 'POST', pattern: '/api/v3/contracts/:contractId/accept/', owner: 'contracts',
      handler: async (_req, res, ctx, params) => {
        const companyId = companyRequired(ctx, res);
        if (!companyId) return;
        if (requireCapability(res, companyId, 'contracts', 'accept contract')) return;
        try { sendJson(res, await acceptContractCommand(ctx!, Number(params.contractId))); }
        catch (err: unknown) { sendJson(res, commandError(err), 400); }
      }
    })
    .register({
      method: 'POST', pattern: '/api/v2/contracts/:contractId/accept/', owner: 'contracts',
      handler: async (_req, res, ctx, params) => {
        const companyId = companyRequired(ctx, res);
        if (!companyId) return;
        if (requireCapability(res, companyId, 'contracts', 'accept contract')) return;
        try { sendJson(res, await acceptContractCommand(ctx!, Number(params.contractId))); }
        catch (err: unknown) { sendJson(res, commandError(err), 400); }
      }
    })
    .register({
      method: 'POST', pattern: '/api/v3/contracts/:contractId/reject/', owner: 'contracts',
      handler: async (_req, res, ctx, params) => {
        const companyId = companyRequired(ctx, res);
        if (!companyId) return;
        if (requireCapability(res, companyId, 'contracts', 'reject contract')) return;
        try { sendJson(res, await rejectContractCommand(ctx!, Number(params.contractId))); }
        catch (err: unknown) { sendJson(res, commandError(err), 400); }
      }
    })
    .register({
      method: 'POST', pattern: '/api/v2/contracts/:contractId/reject/', owner: 'contracts',
      handler: async (_req, res, ctx, params) => {
        const companyId = companyRequired(ctx, res);
        if (!companyId) return;
        if (requireCapability(res, companyId, 'contracts', 'reject contract')) return;
        try { sendJson(res, await rejectContractCommand(ctx!, Number(params.contractId))); }
        catch (err: unknown) { sendJson(res, commandError(err), 400); }
      }
    })
    .register({
      method: 'DELETE', pattern: '/api/v3/contracts/:contractId/', owner: 'contracts',
      handler: async (_req, res, ctx, params) => {
        const companyId = companyRequired(ctx, res);
        if (!companyId) return;
        if (requireCapability(res, companyId, 'contracts', 'cancel contract')) return;
        try { sendJson(res, await cancelContractCommand(ctx!, Number(params.contractId))); }
        catch (err: unknown) { sendJson(res, commandError(err), 400); }
      }
    })
    .register({
      method: 'DELETE', pattern: '/api/v2/contracts/:contractId/', owner: 'contracts',
      handler: async (_req, res, ctx, params) => {
        const companyId = companyRequired(ctx, res);
        if (!companyId) return;
        if (requireCapability(res, companyId, 'contracts', 'cancel contract')) return;
        try { sendJson(res, await cancelContractCommand(ctx!, Number(params.contractId))); }
        catch (err: unknown) { sendJson(res, commandError(err), 400); }
      }
    });
}

registerContractRoutes(globalRouteRegistry);
