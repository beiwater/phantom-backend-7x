import type { IncomingMessage } from 'node:http';
import { CONFIG } from '../config.ts';

/**
 * Extracts the real client IP address.
 * When TRUST_PROXY is enabled (e.g. behind Cloudflare Tunnel, Nginx, or Docker reverse proxy),
 * inspects 'cf-connecting-ip' or the client-originating IP from 'x-forwarded-for'.
 * Otherwise, falls back to req.socket.remoteAddress.
 */
export function getClientIp(req: IncomingMessage): string {
  if (CONFIG.TRUST_PROXY) {
    const cfIp = req.headers['cf-connecting-ip'];
    if (typeof cfIp === 'string' && cfIp.trim()) {
      return cfIp.trim();
    }
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) {
      // First IP in comma-separated list is the client originating IP
      const first = forwarded.split(',')[0].trim();
      if (first) {
        return first;
      }
    }
  }
  return req.socket?.remoteAddress || '127.0.0.1';
}
