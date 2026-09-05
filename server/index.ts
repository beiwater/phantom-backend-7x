import http from 'node:http';
import { CONFIG } from './config.ts';
import { validateEnvironment } from './core/env-validator.ts';
import { logger } from './core/logger.ts';
import { handleRequest } from './router.ts';
import { RequestBodyError, sendJson } from './routes/utils.ts';
import { setupWebSocket } from './ws/websocket.ts';
import { startExpiredSessionCleanup } from './auth/session.ts';
import { startScheduler, stopScheduler } from './scheduler/timetable.ts';
import { wireGameNotifications } from './application/notifications.ts';
import { startNpcMarketRestocker, stopNpcMarketRestocker } from './services/npc-market-service.ts';
import { db } from './db/database.ts';
import './scheduler/scheduler-routes.ts';

// Validate environment & configuration on startup (Issue #147 / #149)
validateEnvironment();

// Issue #17: purge expired sessions at startup and every hour thereafter.
startExpiredSessionCleanup();

// Issue #98: daily UTC timetable engine. Persists scheduler_state so restarts never double-fire.
startScheduler();

// NPC market restocker engine with time acceleration support
startNpcMarketRestocker();
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

wireGameNotifications();

server.listen(CONFIG.PORT, CONFIG.HOST, () => {
  logger.info(`===================================================`);
  logger.info(` SimCompanies Private Server is LIVE!`);
  logger.info(` URL: http://${CONFIG.HOST}:${CONFIG.PORT}/zh-cn/`);
  logger.info(` Speed Multiplier: ${CONFIG.PRODUCTION_SPEED_MULTIPLIER}x`);
  logger.info(`===================================================`);
});

// Graceful shutdown handler (Issue #147)
let isShuttingDown = false;
async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info(`Received ${signal}. Initiating graceful shutdown...`);

  server.close(err => {
    if (err) logger.error('Error closing HTTP server:', err);
    else logger.info('HTTP server closed.');
  });

  try {
    stopScheduler();
    logger.info('Timetable scheduler stopped.');
  } catch (err) {
    logger.error('Error stopping scheduler:', err);
  }

  try {
    stopNpcMarketRestocker();
    logger.info('NPC market restocker stopped.');
  } catch (err) {
    logger.error('Error stopping NPC market restocker:', err);
  }

  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    logger.info('SQLite WAL checkpoint flushed.');
  } catch (err) {
    logger.error('Error flushing SQLite WAL:', err);
  }

  logger.info('Graceful shutdown completed. Exiting.');
  process.exit(0);
}

process.on('SIGTERM', () => { gracefulShutdown('SIGTERM'); });
process.on('SIGINT', () => { gracefulShutdown('SIGINT'); });
