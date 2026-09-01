import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson, requireCapability } from './utils.ts';
import {
  getIncomingContracts,
  getOutgoingContracts,
  sendContract,
  acceptContract,
  rejectContract,
  cancelContract
} from '../game/contracts.ts';

export async function handleContractRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  currentCompanyId: number | null
): Promise<boolean> {

  // 1. Incoming contracts (v2 & v3)
  if (
    pathname === '/api/v2/contracts-incoming/' ||
    pathname.match(/^\/api\/v3\/contracts-incoming\/(?:(?:\d+\/)?(?:\d+|me)|me)\/$/)
  ) {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    sendJson(res, getIncomingContracts(currentCompanyId));
    return true;
  }

  // 2. Outgoing contracts (v2 & v3)
  if (
    pathname === '/api/v2/contracts-outgoing/' ||
    pathname.match(/^\/api\/v3\/contracts-outgoing\/(?:(?:\d+\/)?(?:\d+|me)|me)\/$/)
  ) {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
    sendJson(res, getOutgoingContracts(currentCompanyId));
    return true;
  }

  // 3. Contracts history incoming / outgoing
  if (pathname === '/api/v2/contracts-history-incoming/' || pathname === '/api/v2/contracts-history-outgoing/') {
    sendJson(res, []);
    return true;
  }

  // 4. Warehouse contracts summary: /api/v2/warehouse-contracts-summary/:realm/:kindOrDirection/
  const contractsSummaryMatch = pathname.match(/^\/api\/v2\/warehouse-contracts-summary\/(\d+)\/([^/]+)\/$/);
  if (contractsSummaryMatch) {
    const rawParam = contractsSummaryMatch[2];
    if (rawParam === 'i' || rawParam === 'o' || rawParam === 'incoming' || rawParam === 'outgoing') {
      sendJson(res, []);
      return true;
    }
    const kind = Number(rawParam) || 1;
    sendJson(res, {
      resourceKind: kind,
      totalVolumeDaily: 50000,
      averageDiscountPrice: 1.15,
      activePartnersCount: 3
    });
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
      const contract = sendContract(
        currentCompanyId,
        body.recipient,
        body.kind,
        body.quality || 0,
        body.amount,
        body.price
      );
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
      const result = acceptContract(currentCompanyId, contractId);
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
      const result = rejectContract(currentCompanyId, contractId);
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
      const result = cancelContract(currentCompanyId, contractId);
      sendJson(res, result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: msg }, 400);
    }
    return true;
  }

  return false;
}
