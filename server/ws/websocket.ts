import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';

interface WSMessage {
  routing?: string;
  data?: unknown;
}

export function setupWebSocket(server: Server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws: WebSocket) => {
    ws.on('message', (raw: string | Buffer) => {
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
