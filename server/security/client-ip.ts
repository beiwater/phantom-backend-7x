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

/**
 * Extracts the ISO 3166-1 alpha-2 country code reported by Cloudflare.
 */
export function getClientCountry(req: IncomingMessage): string | null {
  const cfCountry = req.headers['cf-ipcountry'];
  if (typeof cfCountry === 'string' && cfCountry.trim()) {
    return cfCountry.trim().toUpperCase();
  }
  return null;
}

/**
 * Validates request against GEOIP_WHITELIST.
 * - If whitelist is empty, all regions are allowed.
 * - Healthcheck probes (/health/...) are always allowed.
 * - Local/private IP addresses without cf-ipcountry (e.g. docker internal probes) are allowed.
 * - If cf-ipcountry header is present, it must be in the whitelist.
 */
export function isGeoAllowed(req: IncomingMessage, pathname: string): boolean {
  if (!CONFIG.GEOIP_WHITELIST || CONFIG.GEOIP_WHITELIST.length === 0) {
    return true;
  }
  if (pathname.startsWith('/health/')) {
    return true;
  }
  const country = getClientCountry(req);
  if (country) {
    return CONFIG.GEOIP_WHITELIST.includes(country);
  }
  const ip = req.socket?.remoteAddress || '';
  if (
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip === 'localhost' ||
    ip.startsWith('10.') ||
    ip.startsWith('192.168.') ||
    ip.startsWith('172.') ||
    ip.startsWith('::ffff:127.') ||
    ip.startsWith('::ffff:10.') ||
    ip.startsWith('::ffff:192.168.') ||
    ip.startsWith('::ffff:172.')
  ) {
    return true;
  }
  return false;
}
