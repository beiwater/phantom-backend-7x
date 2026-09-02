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
      // #161: the original client's axios catch renders `data.message`
      // verbatim and only falls back to "An unexpected error occurred"
      // when `message` is missing. `error` stays for our own tooling.
      message: error.message,
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
    message: msg,
    error: msg,
    code: statusCode === 413 ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST'
  }, statusCode);
}
