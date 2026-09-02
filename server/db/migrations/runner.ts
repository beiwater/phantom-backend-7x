/**
 * Database Migration Runner & Schema Version Manager (Issue #145).
 *
 * Provides:
 * - Versioned schema migrations in deterministic sequential order
 * - schema_migrations tracking table with version, name, applied_at, checksum
 * - Atomic per-migration execution inside immediate transactions
 * - Startup protection: migration failure halts server bootstrap
 * - Idempotent re-runs: already applied migrations are skipped safely
 * - Schema version and migration status inspection for health checks and CLI
 */
import type { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import { db as defaultDb } from '../connection.ts';

export interface MigrationRecord {
  version: number;
  name: string;
  applied_at: string;
  checksum: string | null;
}

export interface MigrationDefinition {
  version: number;
  name: string;
  up: (db: DatabaseSync) => void;
}

export class MigrationError extends Error {
  readonly version: number;
  readonly migrationName: string;
  readonly originalError: unknown;

  constructor(version: number, migrationName: string, originalError: unknown) {
    const msg = originalError instanceof Error ? originalError.message : String(originalError);
    super(`Migration ${version} (${migrationName}) failed: ${msg}`);
    this.name = 'MigrationError';
    this.version = version;
    this.migrationName = migrationName;
    this.originalError = originalError;
  }
}

/**
 * Ordered list of versioned schema migrations.
 */
export const MIGRATIONS: MigrationDefinition[] = [
  {
    version: 1,
    name: '001_core_schema',
    up: (db: DatabaseSync) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS players (
          player_id INTEGER PRIMARY KEY AUTOINCREMENT,
          email TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          is_admin INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS companies (
          company_id INTEGER PRIMARY KEY AUTOINCREMENT,
          player_id INTEGER UNIQUE NOT NULL,
          name TEXT UNIQUE NOT NULL,
          money REAL NOT NULL DEFAULT 100000,
          simboosts INTEGER NOT NULL DEFAULT 250,
          level INTEGER NOT NULL DEFAULT 0,
          experience REAL NOT NULL DEFAULT 0,
          rating REAL NOT NULL DEFAULT 0,
          realm_id INTEGER NOT NULL DEFAULT 0,
          logo TEXT DEFAULT '',
          personal_assistant TEXT DEFAULT 'old',
          note TEXT DEFAULT '',
          extra_building_slots INTEGER DEFAULT 0,
          extra_executive_slots INTEGER DEFAULT 0,
          display_case_slots INTEGER DEFAULT 1,
          max_tags INTEGER DEFAULT 1,
          show_online_indicator INTEGER DEFAULT 1,
          moderator_sign INTEGER DEFAULT 0,
          supporter_until TEXT,
          supporter_certificates INTEGER DEFAULT 0,
          created_at TEXT NOT NULL,
          FOREIGN KEY (player_id) REFERENCES players(player_id)
        );

        CREATE TABLE IF NOT EXISTS sessions (
          session_id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_token TEXT UNIQUE NOT NULL,
          player_id INTEGER NOT NULL,
          company_id INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          FOREIGN KEY (player_id) REFERENCES players(player_id),
          FOREIGN KEY (company_id) REFERENCES companies(company_id)
        );

        CREATE TABLE IF NOT EXISTS buildings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          company_id INTEGER NOT NULL,
          kind TEXT NOT NULL,
          size INTEGER NOT NULL DEFAULT 1,
          position INTEGER NOT NULL,
          abundance REAL DEFAULT 100,
          original_abundance REAL DEFAULT 100,
          busy_until TEXT,
          created_at TEXT NOT NULL,
          upkeep_active INTEGER DEFAULT 0,
          robots_installed INTEGER DEFAULT 0,
          robots_quality INTEGER DEFAULT 0,
          locked_product INTEGER,
          FOREIGN KEY (company_id) REFERENCES companies(company_id)
        );

        CREATE TABLE IF NOT EXISTS warehouse (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          company_id INTEGER NOT NULL,
          kind INTEGER NOT NULL,
          quality INTEGER NOT NULL DEFAULT 0,
          amount REAL NOT NULL DEFAULT 0,
          cost_workers REAL DEFAULT 0,
          cost_admin REAL DEFAULT 0,
          cost_material1 REAL DEFAULT 0,
          cost_material2 REAL DEFAULT 0,
          cost_market REAL DEFAULT 0,
          FOREIGN KEY (company_id) REFERENCES companies(company_id)
        );

        CREATE TABLE IF NOT EXISTS production_queues (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          building_id INTEGER NOT NULL,
          company_id INTEGER NOT NULL,
          kind INTEGER NOT NULL,
          quality INTEGER DEFAULT 0,
          cost REAL,
          amount REAL NOT NULL,
          duration_seconds INTEGER NOT NULL,
          started_at TEXT NOT NULL,
          finished_at TEXT NOT NULL,
          completed INTEGER DEFAULT 0,
          FOREIGN KEY (building_id) REFERENCES buildings(id),
          FOREIGN KEY (company_id) REFERENCES companies(company_id)
        );

        CREATE TABLE IF NOT EXISTS market_orders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          seller_id INTEGER NOT NULL,
          kind INTEGER NOT NULL,
          quality INTEGER NOT NULL DEFAULT 0,
          quantity REAL NOT NULL,
          price REAL NOT NULL,
          fees REAL NOT NULL DEFAULT 0,
          posted_at TEXT NOT NULL,
          active INTEGER NOT NULL DEFAULT 1,
          is_npc INTEGER DEFAULT 0,
          is_buy INTEGER DEFAULT 0,
          cost_workers REAL DEFAULT 0,
          cost_admin REAL DEFAULT 0,
          cost_material1 REAL DEFAULT 0,
          cost_material2 REAL DEFAULT 0,
          cost_market REAL DEFAULT 0,
          FOREIGN KEY (seller_id) REFERENCES companies(company_id)
        );

        CREATE TABLE IF NOT EXISTS research (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          company_id INTEGER NOT NULL,
          discipline INTEGER NOT NULL,
          points REAL NOT NULL DEFAULT 0,
          FOREIGN KEY (company_id) REFERENCES companies(company_id)
        );

        CREATE TABLE IF NOT EXISTS display_case (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          company_id INTEGER NOT NULL,
          slot INTEGER NOT NULL,
          resource_kind INTEGER NOT NULL,
          quality INTEGER NOT NULL DEFAULT 0,
          title TEXT DEFAULT '',
          FOREIGN KEY (company_id) REFERENCES companies(company_id)
        );
      `);
    }
  },
  {
    version: 2,
    name: '002_social_and_notifications',
    up: (db: DatabaseSync) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS chat_messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          room TEXT NOT NULL,
          sender_company_id INTEGER NOT NULL,
          sender_player_id INTEGER NOT NULL,
          message TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS direct_messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          sender_company_id INTEGER NOT NULL,
          recipient_company_id INTEGER NOT NULL,
          message TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS game_notifications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          company_id INTEGER NOT NULL,
          kind INTEGER NOT NULL,
          title TEXT,
          body TEXT NOT NULL,
          link TEXT,
          is_read INTEGER DEFAULT 0,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS notification_preferences (
          company_id INTEGER PRIMARY KEY,
          email_json TEXT DEFAULT '{}',
          popup_json TEXT DEFAULT '{}',
          push_json TEXT DEFAULT '{}',
          updated_at TEXT
        );

        CREATE TABLE IF NOT EXISTS company_notes (
          owner_company_id INTEGER NOT NULL,
          target_company_id INTEGER NOT NULL,
          note TEXT NOT NULL DEFAULT '',
          updated_at TEXT NOT NULL,
          PRIMARY KEY (owner_company_id, target_company_id)
        );

        CREATE TABLE IF NOT EXISTS company_tags (
          company_id INTEGER NOT NULL,
          tag_text TEXT NOT NULL,
          slot INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (company_id, slot)
        );

        CREATE TABLE IF NOT EXISTS achievements (
          company_id INTEGER NOT NULL,
          achievement_id TEXT NOT NULL,
          level INTEGER NOT NULL DEFAULT 1,
          claimed INTEGER NOT NULL DEFAULT 0,
          claimed_at TEXT,
          progress REAL DEFAULT 0,
          PRIMARY KEY (company_id, achievement_id)
        );
      `);
    }
  },
  {
    version: 3,
    name: '003_finance_bonds_accounting',
    up: (db: DatabaseSync) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS bonds (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          issuer_id INTEGER NOT NULL,
          buyer_id INTEGER,
          amount REAL NOT NULL,
          interest_rate REAL NOT NULL,
          issued_at TEXT NOT NULL,
          maturity_date TEXT,
          settled INTEGER DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'offered',
          missed_payments INTEGER DEFAULT 0,
          restructure_percentage REAL DEFAULT 0,
          FOREIGN KEY (issuer_id) REFERENCES companies(company_id)
        );

        CREATE TABLE IF NOT EXISTS loans (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          company_id INTEGER NOT NULL,
          principal REAL NOT NULL,
          interest_rate REAL NOT NULL,
          start_date TEXT NOT NULL,
          term_days INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'active'
        );

        CREATE TABLE IF NOT EXISTS cash_ledger (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          company_id INTEGER NOT NULL,
          category TEXT NOT NULL,
          amount REAL NOT NULL,
          balance_after REAL NOT NULL,
          description TEXT DEFAULT '',
          reference_id INTEGER,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS balance_sheet_snapshots (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          company_id INTEGER NOT NULL,
          snapshot_date TEXT NOT NULL,
          cash REAL NOT NULL DEFAULT 0,
          inventory_value REAL NOT NULL DEFAULT 0,
          buildings_value REAL NOT NULL DEFAULT 0,
          patents_value REAL NOT NULL DEFAULT 0,
          bonds_bought_value REAL NOT NULL DEFAULT 0,
          bonds_issued_value REAL NOT NULL DEFAULT 0,
          total_assets REAL NOT NULL DEFAULT 0,
          total_liabilities REAL NOT NULL DEFAULT 0,
          equity REAL NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          UNIQUE (company_id, snapshot_date)
        );
      `);
    }
  },
  {
    version: 4,
    name: '004_contracts_and_government',
    up: (db: DatabaseSync) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS contracts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          sender_id INTEGER NOT NULL,
          receiver_id INTEGER NOT NULL,
          kind INTEGER NOT NULL,
          quality INTEGER NOT NULL DEFAULT 0,
          amount REAL NOT NULL,
          price REAL NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          created_at TEXT NOT NULL,
          updated_at TEXT,
          FOREIGN KEY (sender_id) REFERENCES companies(company_id),
          FOREIGN KEY (receiver_id) REFERENCES companies(company_id)
        );

        CREATE TABLE IF NOT EXISTS government_orders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          resource_kind INTEGER NOT NULL,
          target_quantity REAL NOT NULL,
          delivered_quantity REAL NOT NULL DEFAULT 0,
          budget_per_unit REAL NOT NULL,
          min_quality INTEGER NOT NULL DEFAULT 0,
          max_contractors INTEGER NOT NULL DEFAULT 3,
          bonus_simboosts INTEGER NOT NULL DEFAULT 20,
          status TEXT NOT NULL DEFAULT 'bidding',
          bidding_starts_at TEXT NOT NULL,
          bidding_ends_at TEXT NOT NULL,
          delivery_deadline TEXT NOT NULL,
          winner_id INTEGER,
          winning_bid_price REAL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS government_order_bids (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          order_id INTEGER NOT NULL,
          company_id INTEGER NOT NULL,
          price_per_unit REAL NOT NULL,
          deposit_amount REAL NOT NULL DEFAULT 0,
          delivered_quantity REAL NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'active',
          created_at TEXT NOT NULL,
          UNIQUE (order_id, company_id),
          FOREIGN KEY (order_id) REFERENCES government_orders(id),
          FOREIGN KEY (company_id) REFERENCES companies(company_id)
        );
      `);
    }
  },
  {
    version: 5,
    name: '005_executives_and_poaching',
    up: (db: DatabaseSync) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS executives (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          company_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          avatar TEXT DEFAULT 'images/avatars/male_01.png',
          position TEXT DEFAULT 'unassigned',
          skill_management REAL DEFAULT 0,
          skill_accounting REAL DEFAULT 0,
          skill_science REAL DEFAULT 0,
          skill_communication REAL DEFAULT 0,
          salary REAL DEFAULT 250,
          status TEXT DEFAULT 'employed',
          training_finish_at TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY (company_id) REFERENCES companies(company_id)
        );

        CREATE TABLE IF NOT EXISTS executive_offers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          poacher_company_id INTEGER NOT NULL,
          target_company_id INTEGER NOT NULL,
          target_executive_id INTEGER NOT NULL,
          slot_position TEXT DEFAULT 'unassigned',
          skill_position TEXT DEFAULT 'o',
          agency INTEGER DEFAULT 0,
          status TEXT DEFAULT 'f',
          expected_salary REAL DEFAULT 400,
          salary REAL DEFAULT NULL,
          agency_fee REAL DEFAULT 0,
          accelerated INTEGER DEFAULT 0,
          research_poacher TEXT DEFAULT NULL,
          research_employer TEXT DEFAULT NULL,
          extended_at TEXT DEFAULT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
    }
  },
  {
    version: 6,
    name: '006_auctions_and_trades',
    up: (db: DatabaseSync) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS building_auctions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          building_id INTEGER NOT NULL,
          building_kind TEXT NOT NULL,
          building_size INTEGER NOT NULL,
          building_cost REAL NOT NULL DEFAULT 0,
          building_name TEXT,
          building_category TEXT,
          realm INTEGER NOT NULL DEFAULT 0,
          seller_id INTEGER NOT NULL,
          min_bid REAL NOT NULL,
          guaranteed_return REAL NOT NULL,
          promoted INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'active',
          winner_id INTEGER,
          final_price REAL,
          seller_proceeds REAL,
          settled_at TEXT,
          robots_installed INTEGER NOT NULL DEFAULT 0,
          robots_quality INTEGER NOT NULL DEFAULT 0,
          locked_product INTEGER,
          abundance REAL,
          original_abundance REAL,
          started_at TEXT NOT NULL,
          closes_at TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS building_auction_bids (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          auction_id INTEGER NOT NULL,
          company_id INTEGER NOT NULL,
          amount REAL NOT NULL,
          escrowed REAL NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'active',
          created_at TEXT NOT NULL,
          updated_at TEXT,
          UNIQUE (auction_id, company_id)
        );

        CREATE TABLE IF NOT EXISTS market_trades (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          kind INTEGER NOT NULL,
          quality INTEGER NOT NULL DEFAULT 0,
          price REAL NOT NULL,
          amount REAL NOT NULL,
          fee REAL NOT NULL DEFAULT 0,
          buyer_id INTEGER,
          seller_id INTEGER,
          trade_date TEXT NOT NULL,
          traded_at TEXT NOT NULL
        );
      `);
    }
  },
  {
    version: 7,
    name: '007_aerospace_and_launchpad',
    up: (db: DatabaseSync) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS launchpad_flights (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          building_id INTEGER NOT NULL,
          company_id INTEGER NOT NULL,
          rocket_kind INTEGER NOT NULL,
          rocket_quality INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'queued',
          success_rate REAL NOT NULL DEFAULT 1.0,
          outcome TEXT,
          rewards_json TEXT,
          fuel_consumed REAL DEFAULT 0,
          launch_started_at TEXT NOT NULL,
          launch_completed_at TEXT NOT NULL,
          claimed_at TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY (building_id) REFERENCES buildings(id),
          FOREIGN KEY (company_id) REFERENCES companies(company_id)
        );
      `);
    }
  },
  {
    version: 8,
    name: '008_collectibles_and_newspaper',
    up: (db: DatabaseSync) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS collectibles (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          company_id INTEGER NOT NULL,
          collectible_kind INTEGER NOT NULL,
          rarity REAL NOT NULL DEFAULT 0,
          in_vault INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS collectible_trades (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          buyer_id INTEGER NOT NULL,
          seller_id INTEGER NOT NULL,
          collectible_id INTEGER NOT NULL,
          price REAL NOT NULL,
          traded_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS newspaper_issues (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          realm_id INTEGER NOT NULL DEFAULT 0,
          issue_id INTEGER NOT NULL,
          published INTEGER NOT NULL DEFAULT 0,
          publish_date TEXT,
          articles_json TEXT DEFAULT '[]',
          created_at TEXT NOT NULL,
          UNIQUE (realm_id, issue_id)
        );

        CREATE TABLE IF NOT EXISTS newspaper_sponsors (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          newspaper_id INTEGER NOT NULL,
          slot_number INTEGER NOT NULL,
          tier TEXT NOT NULL,
          company_id INTEGER,
          text TEXT,
          booked_at TEXT,
          simboosts_paid INTEGER DEFAULT 0,
          UNIQUE (newspaper_id, slot_number)
        );

        CREATE TABLE IF NOT EXISTS newspaper_article_reactions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          article_id INTEGER NOT NULL,
          company_id INTEGER NOT NULL,
          reaction_type TEXT NOT NULL,
          simboosts_amount INTEGER DEFAULT 0,
          created_at TEXT NOT NULL,
          UNIQUE (article_id, company_id, reaction_type)
        );
      `);
    }
  },
  {
    version: 9,
    name: '009_restaurants_and_properties',
    up: (db: DatabaseSync) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS restaurant_properties (
          building_id INTEGER PRIMARY KEY,
          company_id INTEGER,
          good_service INTEGER DEFAULT 0,
          is_luxury INTEGER DEFAULT 0,
          keep_open INTEGER DEFAULT 1,
          menu_json TEXT DEFAULT '[]',
          menu_price REAL DEFAULT 60,
          rating REAL DEFAULT 0,
          occupancy REAL DEFAULT 0,
          updated_at TEXT,
          professional_staff INTEGER DEFAULT 0,
          last_cycle_at TEXT,
          reconstruction_started_at TEXT,
          reconstruction_until TEXT,
          rating_penalty_applied INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS restaurant_runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          building_id INTEGER,
          company_id INTEGER,
          datetime TEXT,
          rating REAL,
          new_rating REAL,
          rating_before REAL,
          rating_after REAL,
          rating_delta REAL,
          occupied INTEGER,
          capacity INTEGER,
          occupancy REAL,
          revenue REAL,
          cost REAL,
          profit REAL,
          menu_price REAL,
          review TEXT,
          menu_json TEXT,
          good_service INTEGER,
          is_luxury INTEGER,
          resolved INTEGER DEFAULT 0,
          cycle_start TEXT,
          cycle_end TEXT,
          prepared INTEGER DEFAULT 0,
          served INTEGER,
          spoiled INTEGER,
          food_cost REAL DEFAULT 0,
          wages REAL DEFAULT 0
        );
      `);
    }
  },
  {
    version: 10,
    name: '010_scheduler_and_saturation',
    up: (db: DatabaseSync) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS scheduler_state (
          task_name TEXT PRIMARY KEY,
          last_run_utc TEXT,
          last_scheduled_for_utc TEXT,
          updated_at TEXT
        );

        CREATE TABLE IF NOT EXISTS economy_state (
          realm_id INTEGER PRIMARY KEY,
          state INTEGER NOT NULL DEFAULT 1,
          updated_at TEXT
        );

        CREATE TABLE IF NOT EXISTS retail_saturation (
          date TEXT NOT NULL,
          kind INTEGER NOT NULL,
          saturation REAL NOT NULL,
          updated_at TEXT,
          PRIMARY KEY (date, kind)
        );
      `);
    }
  },
  {
    version: 11,
    name: '011_moderation_audit_security',
    up: (db: DatabaseSync) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS audit_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          moderator_player_id INTEGER,
          target_player_id INTEGER,
          target_company_id INTEGER,
          action TEXT NOT NULL,
          details_json TEXT DEFAULT '{}',
          ip_address TEXT,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS company_settings (
          company_id INTEGER PRIMARY KEY,
          is_banned INTEGER DEFAULT 0,
          ban_reason TEXT,
          ban_expires_at TEXT,
          invisibility INTEGER DEFAULT 0,
          updated_at TEXT
        );

        CREATE TABLE IF NOT EXISTS login_attempts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ip_address TEXT NOT NULL,
          email TEXT,
          success INTEGER NOT NULL,
          attempted_at TEXT NOT NULL
        );
      `);
    }
  }
];

export class MigrationRunner {
  private database: DatabaseSync;

  constructor(database: DatabaseSync = defaultDb) {
    this.database = database;
  }

  /**
   * Initializes the schema_migrations tracking table if it doesn't exist.
   */
  ensureMigrationTable(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL,
        checksum TEXT
      );
    `);
  }

  /**
   * Retrieves all applied migration records ordered by version.
   */
  getAppliedMigrations(): MigrationRecord[] {
    this.ensureMigrationTable();
    const rows = this.database.prepare(
      'SELECT version, name, applied_at, checksum FROM schema_migrations ORDER BY version ASC'
    ).all() as Array<{ version: number; name: string; applied_at: string; checksum: string | null }>;
    return rows.map(r => ({
      version: Number(r.version),
      name: String(r.name),
      applied_at: String(r.applied_at),
      checksum: r.checksum ? String(r.checksum) : null
    }));
  }

  /**
   * Returns current database schema version (0 if fresh / unmigrated).
   */
  getLatestSchemaVersion(): number {
    this.ensureMigrationTable();
    const row = this.database.prepare('SELECT MAX(version) as max_v FROM schema_migrations').get() as { max_v: number | null };
    return Number(row?.max_v || 0);
  }

  /**
   * Runs all pending migrations sequentially inside isolated transactions.
   * If any migration fails, throws MigrationError and rolls back the failing step.
   */
  runMigrations(): { appliedCount: number; currentVersion: number; newlyApplied: MigrationRecord[] } {
    this.ensureMigrationTable();
    const applied = new Set(this.getAppliedMigrations().map(m => m.version));
    const newlyApplied: MigrationRecord[] = [];
    let appliedCount = 0;

    for (const migration of MIGRATIONS) {
      if (applied.has(migration.version)) {
        continue;
      }

      const nowIso = new Date().toISOString();
      const checksum = crypto.createHash('sha256').update(migration.name + migration.version).digest('hex').slice(0, 16);

      this.database.exec('BEGIN IMMEDIATE');
      try {
        migration.up(this.database);
        this.database.prepare(
          'INSERT INTO schema_migrations (version, name, applied_at, checksum) VALUES (?, ?, ?, ?)'
        ).run(migration.version, migration.name, nowIso, checksum);
        this.database.exec('COMMIT');

        const record: MigrationRecord = {
          version: migration.version,
          name: migration.name,
          applied_at: nowIso,
          checksum
        };
        newlyApplied.push(record);
        appliedCount++;
      } catch (err) {
        try {
          this.database.exec('ROLLBACK');
        } catch {
          // ignore rollback failure
        }
        throw new MigrationError(migration.version, migration.name, err);
      }
    }

    return {
      appliedCount,
      currentVersion: this.getLatestSchemaVersion(),
      newlyApplied
    };
  }

  /**
   * Verifies database schema integrity via PRAGMA integrity_check.
   */
  verifyIntegrity(): boolean {
    const result = this.database.prepare('PRAGMA integrity_check').get() as { integrity_check?: string } | undefined;
    return result?.integrity_check === 'ok';
  }
}
