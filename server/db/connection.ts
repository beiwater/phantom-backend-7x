import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { CONFIG } from '../config.ts';

fs.mkdirSync(CONFIG.DATA_DIR, { recursive: true });
const dbPath = path.join(CONFIG.DATA_DIR, 'simcompanies.sqlite');
export const db = new DatabaseSync(dbPath);
db.exec('PRAGMA busy_timeout = 10000;');
db.exec('PRAGMA journal_mode = WAL;');
// Enable foreign key enforcement at connection level. Business schema DDL
// lives exclusively in the versioned migrations (server/db/migrations/runner.ts,
// Issue #177) — never re-introduce CREATE TABLE into runtime modules.
db.exec('PRAGMA foreign_keys = ON;');
