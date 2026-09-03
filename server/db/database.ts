import { db } from './connection.ts';
import { runMigrations, hashPassword, verifyPassword } from './migrations/index.ts';
import {
  seedDefaultDisplayCase,
  seedMarketOrders,
  seedInitialDatabase,
  registerPlayer,
  authenticatePlayer,
  registerOrAuthenticatePlayer,
  type PlayerDbRow
} from './seed/index.ts';

// 1. Run versioned schema migrations — the single schema authority (#177).
runMigrations(db);
// 2. Seed initial game data if needed
seedInitialDatabase(db);


// Re-export symbols for backward compatibility across existing modules
export {
  db,
  runMigrations,
  hashPassword,
  verifyPassword,
  seedDefaultDisplayCase,
  seedMarketOrders,
  seedInitialDatabase,
  registerPlayer,
  authenticatePlayer,
  registerOrAuthenticatePlayer,
  type PlayerDbRow
};
