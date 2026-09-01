import type { ServerResponse } from 'node:http';
import { sendJson } from '../../routes/utils.ts';
import { DomainError } from '../../errors/domain-error.ts';

export function sendDomainResponse(
  res: ServerResponse,
  data: unknown,
  status: number = 200,
  extraHeaders: Record<string, string | string[]> = {}
): void {
  sendJson(res, data, status, extraHeaders);
}

export function sendDomainError(
  res: ServerResponse,
  error: unknown
): void {
  if (error instanceof DomainError) {
    sendJson(res, {
      error: error.message,
      code: error.code,
      details: error.details
    }, error.statusCode);
    return;
  }

  const statusCode = (error && typeof error === 'object' && 'statusCode' in error && typeof (error as { statusCode?: unknown }).statusCode === 'number')
    ? (error as { statusCode: number }).statusCode
    : 400;

  const msg = error instanceof Error ? error.message : String(error);
  sendJson(res, {
    error: msg,
    code: statusCode === 413 ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST'
  }, statusCode);
}
