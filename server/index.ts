import http from 'node:http';
import { CONFIG } from './config.ts';
import { handleRequest } from './router.ts';
import { RequestBodyError, sendJson } from './routes/utils.ts';
import { setupWebSocket } from './ws/websocket.ts';
import { startExpiredSessionCleanup } from './auth/session.ts';
import { startScheduler } from './scheduler/timetable.ts';
import './scheduler/scheduler-routes.ts';

// Issue #17: purge expired sessions at startup and every hour thereafter.
startExpiredSessionCleanup();

// Issue #98: daily UTC timetable engine (bond interest + accounting overhead,
// executive salaries, government orders publish/award, economy phase roll,
// retail saturation). Persists scheduler_state so restarts never double-fire.
startScheduler();

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
