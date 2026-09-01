import type { IncomingMessage, ServerResponse } from 'node:http';
import { companyRepository } from '../repositories/company-repository.ts';
import {
  assertCapability,
  CapabilityError,
  type CapabilityKey
} from '../domain/leveling/level-rules.ts';


/**
 * Issue #71: single capability gate for subsystem mutation routes.
 * Reads the company level and delegates the unlock decision to the
 * canonical leveling domain (getTierForLevel tier table). When the
 * capability is locked at the company's current level, responds 403
 * with an "unlocks at level N" reason and returns true (handled).
 * Otherwise returns false so the route continues.
 */
export function requireCapability(
  res: ServerResponse,
  companyId: number,
  capability: CapabilityKey,
  subject: string
): boolean {
  const company = companyRepository.findById(companyId);
  const level = company?.level ?? 0;
  try {
    assertCapability(level, capability, subject);
  } catch (err: unknown) {
    if (err instanceof CapabilityError) {
      sendJson(res, { error: err.message }, 403);
      return true;
    }
    throw err;
  }
  return false;
}

const MAX_REQUEST_BODY_BYTES = 1024 * 1024;

export class RequestBodyError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'RequestBodyError';
  }
}

export function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  const contentLength = Number(req.headers['content-length']);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BODY_BYTES) {
    req.resume();
    reject(new RequestBodyError('Request body is too large', 413));
    return promise;
  }

  let data = '';
  let bytesRead = 0;
  let settled = false;
  const fail = (err: unknown) => {
    if (settled) return;
    settled = true;
    reject(err);
  };

  req.on('data', chunk => {
    if (settled) return;
    const text = typeof chunk === 'string' ? chunk : chunk.toString();
    bytesRead += Buffer.byteLength(text);
    if (bytesRead > MAX_REQUEST_BODY_BYTES) {
      fail(new RequestBodyError('Request body is too large', 413));
      req.resume();
      return;
    }
    data += text;
  });
  req.on('end', () => {
    if (settled) return;
    try {
      if (!data) {
        settled = true;
        resolve({} as T);
        return;
      }
      const contentType = req.headers['content-type'] || '';
      if (contentType.includes('application/x-www-form-urlencoded')) {
        const params = new URLSearchParams(data);
        const obj: Record<string, string> = {};
        for (const [k, v] of params.entries()) {
          obj[k] = v;
        }
        settled = true;
        resolve(obj as unknown as T);
        return;
      }

      try {
        const parsed: unknown = JSON.parse(data);
        // C-7: JSON `null` / scalar bodies (`null`, `42`, `"str"`) are not
        // objects; handlers dereference fields on them. Reject with a 4xx
        // RequestBodyError (mapped to err.statusCode in index.ts) instead of
        // resolving null and crashing handlers into a 500.
        if (parsed === null || typeof parsed !== 'object') {
          fail(new RequestBodyError('Request body must be a JSON object', 400));
          return;
        }
        settled = true;
        resolve(parsed as T);
      } catch {
        fail(new RequestBodyError('Malformed JSON request body', 400));
      }
    } catch (err) {
      fail(err);
    }
  });
  req.on('error', fail);
  return promise;
}

export function sendJson(
  res: ServerResponse,
  data: unknown,
  status: number = 200,
  extraHeaders: Record<string, string | string[]> = {}
) {
  for (const [key, value] of Object.entries(extraHeaders)) {
    if (key.toLowerCase() === 'set-cookie') {
      res.setHeader('Set-Cookie', value);
    } else {
      res.setHeader(key, value);
    }
  }
  const configuredOrigin = res.getHeader('Access-Control-Allow-Origin');
  const allowOrigin = configuredOrigin === undefined ? '*' : String(configuredOrigin);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    'x-timestamp': String(Date.now()),
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-CSRFToken',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    ...(status === 501 ? { 'x-backend-stub': 'true' } : {})
  };
  if (allowOrigin && allowOrigin !== '*') {
    headers['Access-Control-Allow-Credentials'] = 'true';
  }
  res.writeHead(status, headers);
  res.end(JSON.stringify(data));
}
