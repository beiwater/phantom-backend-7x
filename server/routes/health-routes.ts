/**
 * Health Check & Observability Routes (Issue #146).
 *
 * Exposes non-mutating health probes for load balancers, orchestrators, and monitoring:
 * - GET /health/live   or /api/health/live   (Liveness probe: process is alive)
 * - GET /health/ready  or /api/health/ready  (Readiness probe: SQLite connected, schema up to date)
 * - GET /health/       or /api/health/       (Combined health overview)
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson } from './utils.ts';
import { HealthService } from '../services/health-service.ts';

export function handleHealthRoutes(
  _req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string
): boolean {
  const isHealthPath =
    pathname === '/health' ||
    pathname === '/health/' ||
    pathname === '/api/health' ||
    pathname === '/api/health/' ||
    pathname === '/health/live' ||
    pathname === '/health/live/' ||
    pathname === '/api/health/live' ||
    pathname === '/api/health/live/' ||
    pathname === '/health/ready' ||
    pathname === '/health/ready/' ||
    pathname === '/api/health/ready' ||
    pathname === '/api/health/ready/';

  if (!isHealthPath) return false;

  if (method !== 'GET') {
    sendJson(res, { error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'GET' });
    return true;
  }

  // 1. Liveness Probe (pure memory, does not touch database)
  if (pathname.includes('/live')) {
    sendJson(res, HealthService.checkLiveness());
    return true;
  }

  // 2. Readiness Probe (Checks SQLite connection and schema migration state)
  try {
    const readyResult = HealthService.checkReadiness();
    sendJson(res, readyResult);
    return true;
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    sendJson(res, { status: 'unhealthy', error: errorMsg }, 503);
    return true;
  }
}
