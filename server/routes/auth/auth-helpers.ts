import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson } from '../utils.ts';

export const COMPANY_NAME_COLORS = ['Aero', 'Almond', 'Amaranth', 'Amber', 'Amethyst', 'Apricot', 'Auburn', 'Azure', 'Beige', 'Bistre', 'Blue', 'Brass', 'Bronze', 'Cedar', 'Cerulean', 'Cobalt', 'Copper', 'Coral', 'Crimson', 'Cyan'];
export const COMPANY_NAME_SIZES = ['Big', 'Colossal', 'Gigantic', 'Great', 'Huge', 'Immense', 'Little', 'Mighty', 'Mini', 'Vast'];
export const COMPANY_NAME_ADJECTIVES = ['Abundant', 'Excellent', 'Outstanding', 'Superb', 'Superior', 'Supreme', 'Splendid', 'Magnificent', 'Wonderful', 'Dynamic'];
export const COMPANY_NAME_TRADES = ['Aerospace', 'Agriculture', 'Agro', 'Automotive', 'Bank', 'Carbon', 'Construction', 'Design', 'Electronics', 'Energy', 'Factory', 'Farms', 'Food', 'Innovations', 'Labs', 'Materials', 'Mining', 'Motors', 'Ore', 'Trade', 'Trading'];

// RouteRegistry parameters are wildcard strings, so validate the decimal
// company-id contract before any ownership or session lookup.
export function parseCompanyId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const companyId = Number(raw);
  return Number.isSafeInteger(companyId) && companyId > 0 ? companyId : null;
}

export function isCrossOriginRequest(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (typeof origin !== 'string' || origin.trim() === '') return false;
  if (!host) return true;
  return origin !== `http://${host}` && origin !== `https://${host}`;
}

export function rejectCrossOriginRequest(req: IncomingMessage, res: ServerResponse): boolean {
  if (!isCrossOriginRequest(req)) return false;
  sendJson(res, { error: 'Cross-origin request rejected' }, 403);
  return true;
}

/**
 * P1-04: naming-flow conflict suggestions, mirroring the original
 * frontend suggestion generator (color/size/adjective/trade word pool).
 */
export function buildCompanyNameSuggestions(count = 3): string[] {
  const pick = (list: string[]): string => list[Math.floor(Math.random() * list.length)];
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const suggestion = [pick(COMPANY_NAME_ADJECTIVES), pick(COMPANY_NAME_SIZES), pick(COMPANY_NAME_TRADES)].join(' ');
    if (!out.includes(suggestion)) out.push(suggestion);
  }
  return out;
}
