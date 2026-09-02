import type { IncomingMessage, ServerResponse } from 'node:http';
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
      const contract = sendContractCommand(contractCtx(), {
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
      const result = acceptContractCommand(contractCtx(), contractId);
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
      const result = rejectContractCommand(contractCtx(), contractId);
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
      const result = cancelContractCommand(contractCtx(), contractId);
      sendJson(res, result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: msg }, 400);
    }
    return true;
  }

  return false;
}
