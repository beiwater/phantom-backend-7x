import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson } from './utils.ts';
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
  // Incoming contracts
  const incomingMatch = pathname.match(/^\/api\/v3\/contracts-incoming\/(\d+)\/(\d+|me)\/$/);
  if (incomingMatch) {
    const effectiveCompanyId = currentCompanyId || 4259175;
    sendJson(res, getIncomingContracts(effectiveCompanyId));
    return true;
  }

  // Outgoing contracts
  const outgoingMatch = pathname.match(/^\/api\/v3\/contracts-outgoing\/(\d+)\/(\d+|me)\/$/);
  if (outgoingMatch) {
    const effectiveCompanyId = currentCompanyId || 4259175;
    sendJson(res, getOutgoingContracts(effectiveCompanyId));
    return true;
  }

  // Send new contract
  const sendContractMatch = pathname.match(/^\/api\/v3\/contracts\/(\d+|me)\/$/);
  if (sendContractMatch && method === 'POST') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
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

  // Accept contract
  const acceptMatch = pathname.match(/^\/api\/v3\/contracts\/(\d+)\/accept\/$/);
  if (acceptMatch && method === 'POST') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
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

  // Reject contract
  const rejectMatch = pathname.match(/^\/api\/v3\/contracts\/(\d+)\/reject\/$/);
  if (rejectMatch && method === 'POST') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
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

  // Cancel contract
  const cancelMatch = pathname.match(/^\/api\/v3\/contracts\/(\d+)\/$/);
  if (cancelMatch && method === 'DELETE') {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return true;
    }
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
