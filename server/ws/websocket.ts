import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import { extractSessionToken, getSession } from '../auth/session.ts';

interface WSMessage {
  routing?: string;
  data?: unknown;
}

let activeWss: WebSocketServer | null = null;
const identities = new WeakMap<WebSocket, { token: string; companyId: number }>();

export function setupWebSocket(server: Server) {
  // The original browser client uses new WebSocket(url); its session cookie
  // accompanies the upgrade, rather than an application-level login message.
  const wss = new WebSocketServer({
    server,
    path: '/ws',
    verifyClient: ({ req }) => {
      const token = extractSessionToken(req);
      return token !== null && getSession(token) !== null;
    }
  });
  activeWss = wss;

  wss.on('connection', (ws, req) => {
    const token = extractSessionToken(req);
    const session = token ? getSession(token) : null;
    if (!token || !session) {
      ws.close(1008, 'Unauthorized');
      return;
    }
    identities.set(ws, { token, companyId: session.companyId });
    ws.on('message', raw => {
      if (authenticatedCompany(ws) === null) return;
      try {
        const msg = JSON.parse(raw.toString()) as WSMessage;
        const routing = (msg.routing || '').toUpperCase();

        if (routing === 'RESYNC_AFTER_RECONNECT' || routing === 'UNREAD_MESSAGES') {
          ws.send(JSON.stringify({
            routing: 'UNREAD_MESSAGES',
            data: {
              contacts: [],
              unreadMessagesOtherRealms: []
            }
          }));
        } else if (routing === 'PING') {
          ws.send(JSON.stringify({
            routing: 'PONG',
            data: { time: Date.now() }
          }));
        }
      } catch {
        // Invalid JSON ignored
      }
    });

    ws.on('error', () => {});
  });

  return wss;
}

function authenticatedCompany(client: WebSocket): number | null {
  const identity = identities.get(client);
  const session = identity ? getSession(identity.token) : null;
  if (!identity || !session || session.companyId !== identity.companyId) {
    client.close(1008, 'Session changed or expired');
    return null;
  }
  return identity.companyId;
}

export function broadcastToCompany(companyId: number, data: unknown): void {
  broadcastToCompanies([companyId], 'COMPANY_UPDATE', data, companyId);
}

/** Private events retain the frontend's routing, but reach only participants. */
export function broadcastToCompanies(companyIds: readonly number[], routing: string, data: unknown, companyId?: number): void {
  if (!activeWss) return;
  const payload = JSON.stringify({ routing, ...(companyId === undefined ? {} : { companyId }), data });
  for (const client of activeWss.clients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    const recipient = authenticatedCompany(client);
    if (recipient !== null && companyIds.includes(recipient)) client.send(payload);
  }
}

/** Public room events are shared with all authenticated connections. */
export function broadcastAll(routing: string, data: unknown): void {
  if (!activeWss) return;
  const payload = JSON.stringify({ routing, data });
  for (const client of activeWss.clients) {
    if (client.readyState === WebSocket.OPEN && authenticatedCompany(client) !== null) {
      client.send(payload);
    }
  }
}
