import http from 'node:http';
import { CONFIG } from './config.ts';
import { handleRequest } from './router.ts';
import { setupWebSocket } from './ws/websocket.ts';
import { RequestBodyError, sendJson } from './routes/utils.ts';

const server = http.createServer(async (req, res) => {
  try {
    await handleRequest(req, res);
  } catch (err: unknown) {
    if (!res.headersSent) {
      if (err instanceof RequestBodyError) {
        sendJson(res, { error: err.message, code: 'INVALID_REQUEST_BODY' }, err.statusCode);
      } else {
        console.error('Unhandled server error:', err);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
      }
    }
  }
});

setupWebSocket(server);

server.listen(CONFIG.PORT, CONFIG.HOST, () => {
  console.log(`===================================================`);
  console.log(` SimCompanies Private Server is LIVE!`);
  console.log(` URL: http://${CONFIG.HOST}:${CONFIG.PORT}/zh-cn/`);
  console.log(` Speed Multiplier: ${CONFIG.PRODUCTION_SPEED_MULTIPLIER}x`);
  console.log(`===================================================`);
});
