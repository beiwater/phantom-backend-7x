import { db, initializeDatabaseSchema } from './connection.ts';
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

// 1. Initialize core tables & indices
initializeDatabaseSchema(db);

// 2. Run schema & data migrations
runMigrations(db);

// 3. Seed initial game data if needed
seedInitialDatabase(db);

// Re-export symbols for backward compatibility across existing modules
export {
  db,
  initializeDatabaseSchema,
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
