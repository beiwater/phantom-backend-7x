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
    // Issue #177: versioned migrations are the SINGLE schema authority.
    // This migration defines the full core schema (the shape the runtime
    // was built against). It used to duplicate a narrower bootstrap DDL in
    // connection.ts whose CREATE TABLE IF NOT EXISTS pre-empted migration
    // shapes on fresh databases - that dual authority caused the drift
    // patched in migrations #18/#19. The DDL below is the effective
    // bootstrap shape, so fresh and migrated databases converge.
    up: (db: DatabaseSync) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS players (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          player_id INTEGER UNIQUE,
          email TEXT UNIQUE,
          password_hash TEXT,
          password TEXT,
          is_admin INTEGER DEFAULT 0,
          theme TEXT DEFAULT 'light',
          language TEXT DEFAULT 'zh-cn',
          created_at TEXT
        );

        CREATE TABLE IF NOT EXISTS sessions (
          session_token TEXT PRIMARY KEY,
          player_id INTEGER,
          active_company_id INTEGER,
          created_at TEXT,
          expires_at TEXT
        );

        CREATE TABLE IF NOT EXISTS companies (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          company_id INTEGER UNIQUE,
          player_id INTEGER,
          name TEXT,
          money REAL DEFAULT 100000,
          simboosts INTEGER DEFAULT 250,
          level INTEGER DEFAULT 0,
          rating TEXT DEFAULT 'BBB',
          experience INTEGER DEFAULT 0,
          realm_id INTEGER DEFAULT 0,
          logo TEXT DEFAULT '',
          personal_assistant TEXT DEFAULT 'old',
          note TEXT DEFAULT '',
          extra_building_slots INTEGER DEFAULT 0,
          extra_executive_slots INTEGER DEFAULT 0,
          display_case_slots INTEGER DEFAULT 1,
          max_tags INTEGER DEFAULT 1,
          show_online_indicator INTEGER DEFAULT 1,
          moderator_sign INTEGER DEFAULT 0,
          created_at TEXT
        );

        CREATE TABLE IF NOT EXISTS buildings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          company_id INTEGER,
          position TEXT,
          kind TEXT,
          size INTEGER DEFAULT 1,
          name TEXT,
          cost REAL DEFAULT 0,
          category TEXT DEFAULT 'production',
          busy_until TEXT,
          created_at TEXT
        );

        CREATE TABLE IF NOT EXISTS production_queues (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          building_id INTEGER,
          company_id INTEGER,
          kind INTEGER,
          quality INTEGER DEFAULT 0,
          cost REAL,
          amount REAL,
          duration_seconds REAL,
          started_at TEXT,
          finishes_at TEXT,
          resolved INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS retail_orders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          building_id INTEGER,
          company_id INTEGER,
          resource_kind INTEGER,
          quality INTEGER DEFAULT 0,
          units REAL,
          unit_price REAL,
          cost REAL,
          revenue_credited INTEGER NOT NULL DEFAULT 0,
          finished_at TEXT,
          created_at TEXT
        );

        CREATE TABLE IF NOT EXISTS warehouse (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          company_id INTEGER,
          kind INTEGER,
          quality INTEGER DEFAULT 0,
          amount REAL DEFAULT 0,
          cost_workers REAL DEFAULT 0,
          cost_admin REAL DEFAULT 0,
          cost_material1 REAL DEFAULT 0,
          cost_material2 REAL DEFAULT 0,
          cost_market REAL DEFAULT 0,
          updated_at TEXT
        );

        CREATE TABLE IF NOT EXISTS market_orders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          seller_id INTEGER,
          kind INTEGER,
          quality INTEGER DEFAULT 0,
          quantity REAL,
          price REAL,
          fees REAL DEFAULT 0,
          posted_at TEXT,
          active INTEGER DEFAULT 1,
          is_npc INTEGER DEFAULT 0,
          cost_workers REAL DEFAULT 0,
          cost_admin REAL DEFAULT 0,
          cost_material1 REAL DEFAULT 0,
          cost_material2 REAL DEFAULT 0,
          cost_market REAL DEFAULT 0,
          is_buy INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS contracts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          sender_company_id INTEGER,
          recipient_company_id INTEGER,
          kind INTEGER,
          quality INTEGER DEFAULT 0,
          amount REAL,
          price REAL,
          status TEXT DEFAULT 'pending',
          created_at TEXT
        );

        CREATE TABLE IF NOT EXISTS bonds (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          seller_company_id INTEGER,
          buyer_company_id INTEGER,
          interest_rate REAL DEFAULT 0.005,
          amount REAL DEFAULT 5000,
          status TEXT DEFAULT 'active',
          created_at TEXT,
          maturity_date TEXT,
          settled INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS executives (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          company_id INTEGER,
          name TEXT,
          avatar TEXT,
          position TEXT DEFAULT 'unassigned',
          skill_management INTEGER DEFAULT 5,
          skill_accounting INTEGER DEFAULT 5,
          skill_science INTEGER DEFAULT 5,
          skill_communication INTEGER DEFAULT 5,
          salary REAL DEFAULT 250,
          status TEXT DEFAULT 'employed',
          training_finish_at TEXT,
          work_history_accelerated INTEGER DEFAULT 0,
          plans_to_retire INTEGER DEFAULT 0,
          strike_until TEXT,
          created_at TEXT
        );

        CREATE TABLE IF NOT EXISTS research (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          company_id INTEGER,
          discipline INTEGER,
          points INTEGER DEFAULT 0,
          patents INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS display_case (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          company_id INTEGER,
          slot INTEGER,
          resource_kind INTEGER,
          quality INTEGER DEFAULT 0,
          title TEXT DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS achievements (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          company_id INTEGER,
          achievement_id INTEGER,
          level INTEGER DEFAULT 1,
          progress REAL DEFAULT 100,
          unlocked_at TEXT
        );

        CREATE TABLE IF NOT EXISTS chat_messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          room TEXT,
          sender_id INTEGER,
          sender_company TEXT,
          text TEXT,
          sent_at TEXT
        );

        CREATE TABLE IF NOT EXISTS loans (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          company_id INTEGER,
          principal REAL,
          interest_rate REAL DEFAULT 0.1,
          remaining REAL,
          status TEXT DEFAULT 'active',
          created_at TEXT,
          due_at TEXT
        );

        CREATE TABLE IF NOT EXISTS cash_ledger (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          company_id INTEGER NOT NULL,
          amount REAL NOT NULL,
          category TEXT NOT NULL,
          description TEXT,
          description_key TEXT,
          details TEXT DEFAULT '{}',
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS finance_daily_snapshots (
          company_id INTEGER NOT NULL,
          snapshot_date TEXT NOT NULL,
          total REAL DEFAULT 0,
          current_assets REAL DEFAULT 0,
          non_current_assets REAL DEFAULT 0,
          liabilities REAL DEFAULT 0,
          economic_value_added REAL DEFAULT 0,
          eva_profit REAL DEFAULT 0,
          eva_rank INTEGER DEFAULT 0,
          rank INTEGER DEFAULT 0,
          cash_and_receivables REAL DEFAULT 0,
          inventory REAL DEFAULT 0,
          buildings REAL DEFAULT 0,
          patents REAL DEFAULT 0,
          investment_in_bonds REAL DEFAULT 0,
          deposits REAL DEFAULT 0,
          created_at TEXT,
          PRIMARY KEY (company_id, snapshot_date)
        );

        CREATE TABLE IF NOT EXISTS player_devices (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          player_id INTEGER,
          device_uuid TEXT,
          device_name TEXT,
          last_login TEXT
        );

        CREATE TABLE IF NOT EXISTS notification_preferences (
          company_id INTEGER PRIMARY KEY,
          email_json TEXT DEFAULT '{}',
          popup_json TEXT DEFAULT '{}',
          push_json TEXT DEFAULT '{}',
          updated_at TEXT
        );

        CREATE TABLE IF NOT EXISTS company_notes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          company_id INTEGER NOT NULL,
          about_company_id INTEGER NOT NULL,
          note TEXT DEFAULT '',
          priority INTEGER DEFAULT 0,
          created_at TEXT,
          updated_at TEXT,
          UNIQUE (company_id, about_company_id)
        );
        CREATE INDEX IF NOT EXISTS idx_company_notes_owner
          ON company_notes(company_id, about_company_id);

        CREATE TABLE IF NOT EXISTS company_settings (
          company_id INTEGER NOT NULL,
          key TEXT NOT NULL,
          value TEXT,
          PRIMARY KEY (company_id, key)
        );

        CREATE INDEX IF NOT EXISTS idx_players_email ON players(email);
        CREATE INDEX IF NOT EXISTS idx_companies_player_id ON companies(player_id);
        CREATE INDEX IF NOT EXISTS idx_buildings_company_id ON buildings(company_id);
        CREATE INDEX IF NOT EXISTS idx_buildings_company_position ON buildings(company_id, position);
        CREATE INDEX IF NOT EXISTS idx_production_queues_company_id ON production_queues(company_id);
        CREATE INDEX IF NOT EXISTS idx_production_queues_company_building_resolved
          ON production_queues(company_id, building_id, resolved);
        CREATE INDEX IF NOT EXISTS idx_cash_ledger_company_created
          ON cash_ledger(company_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_finance_snapshots_company
          ON finance_daily_snapshots(company_id, snapshot_date);
        CREATE INDEX IF NOT EXISTS idx_warehouse_company_id ON warehouse(company_id);
        CREATE INDEX IF NOT EXISTS idx_warehouse_company_kind_quality
          ON warehouse(company_id, kind, quality);
        CREATE INDEX IF NOT EXISTS idx_market_orders_active ON market_orders(active);
        CREATE INDEX IF NOT EXISTS idx_market_orders_seller_id ON market_orders(seller_id);
        CREATE INDEX IF NOT EXISTS idx_market_orders_active_kind_quality_price
          ON market_orders(active, kind, quality, price);
        CREATE INDEX IF NOT EXISTS idx_contracts_sender_company_id ON contracts(sender_company_id);
        CREATE INDEX IF NOT EXISTS idx_contracts_recipient_company_id ON contracts(recipient_company_id);
        CREATE INDEX IF NOT EXISTS idx_contracts_recipient_status
          ON contracts(recipient_company_id, status);
        CREATE INDEX IF NOT EXISTS idx_bonds_status_buyer_seller
          ON bonds(status, buyer_company_id, seller_company_id);
        CREATE UNIQUE INDEX IF NOT EXISTS uq_company_notes_owner
          ON company_notes(company_id, about_company_id);
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
          type TEXT NOT NULL,
          payload_json TEXT DEFAULT '{}',
          read INTEGER DEFAULT 0,
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
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          company_id INTEGER NOT NULL,
          about_company_id INTEGER NOT NULL,
          note TEXT DEFAULT '',
          priority INTEGER DEFAULT 0,
          created_at TEXT,
          updated_at TEXT NOT NULL,
          UNIQUE (company_id, about_company_id)
        );

        CREATE TABLE IF NOT EXISTS company_tags (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          company_id INTEGER NOT NULL,
          resource_kind INTEGER NOT NULL,
          kind TEXT NOT NULL,
          buy_sell TEXT NOT NULL,
          created_at TEXT NOT NULL,
          expires_at TEXT NOT NULL
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
          work_history_accelerated INTEGER DEFAULT 0,
          plans_to_retire INTEGER DEFAULT 0,
          strike_until TEXT,
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
          -- NULL represents a draft issue; the original client distinguishes
          -- it from a published timestamp.
          published TEXT,
          publish_date TEXT,
          articles_json TEXT DEFAULT '[]',
          created_at TEXT NOT NULL,
          UNIQUE (realm_id, issue_id)
        );

        CREATE TABLE IF NOT EXISTS newspaper_sponsors (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          newspaper_id INTEGER,
          position INTEGER,
          company_id INTEGER,
          company_name TEXT,
          text TEXT,
          logo TEXT,
          created_at TEXT
        );
        CREATE UNIQUE INDEX IF NOT EXISTS uq_newspaper_sponsors_issue_position
          ON newspaper_sponsors (newspaper_id, position);

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
  },
  {
    version: 12,
    name: '012_social_schema_contracts',
    up: (db: DatabaseSync) => {
      const tagColumns = db.prepare('PRAGMA table_info(company_tags)').all() as Array<{ name: string }>;
      if (!tagColumns.some(column => column.name === 'resource_kind')) {
        // The old migration used text/slot tags even though the route contract
        // stores a resource and buy/sell mode. Preserve values that can be
        // represented before replacing that incompatible table.
        const legacyTags = db.prepare(
          'SELECT company_id, tag_text, created_at FROM company_tags'
        ).all() as Array<{ company_id: number; tag_text: string; created_at: string }>;
        db.exec(`
          ALTER TABLE company_tags RENAME TO company_tags_legacy;
          CREATE TABLE company_tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id INTEGER NOT NULL,
            resource_kind INTEGER NOT NULL,
            kind TEXT NOT NULL,
            buy_sell TEXT NOT NULL,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL
          );
        `);
        const insertTag = db.prepare(
          `INSERT INTO company_tags
            (company_id, resource_kind, kind, buy_sell, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        );
        const defaultExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        for (const row of legacyTags) {
          const match = /^(\d+)\s*([bs])$/i.exec(row.tag_text);
          if (!match) continue;
          const resourceKind = Number.parseInt(match[1], 10);
          insertTag.run(row.company_id, resourceKind, String(resourceKind), match[2].toLowerCase(), row.created_at, defaultExpiry);
        }
        db.exec('DROP TABLE company_tags_legacy');
      }

      const notificationColumns = db.prepare('PRAGMA table_info(game_notifications)').all() as Array<{ name: string }>;
      if (notificationColumns.some(column => column.name === 'read')) {
        return;
      }

      const legacyNotifications = db.prepare(
        'SELECT company_id, kind, title, body, link, is_read, created_at FROM game_notifications'
      ).all() as Array<{
        company_id: number;
        kind: number;
        title: string | null;
        body: string;
        link: string | null;
        is_read: number;
        created_at: string;
      }>;
      db.exec(`
        ALTER TABLE game_notifications RENAME TO game_notifications_legacy;
        CREATE TABLE game_notifications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          company_id INTEGER NOT NULL,
          type TEXT NOT NULL,
          payload_json TEXT DEFAULT '{}',
          read INTEGER DEFAULT 0,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_game_notifications_company
          ON game_notifications(company_id, read, created_at);
      `);
      const insertNotification = db.prepare(
        `INSERT INTO game_notifications (company_id, type, payload_json, read, created_at)
         VALUES (?, ?, ?, ?, ?)`
      );
      for (const row of legacyNotifications) {
        insertNotification.run(
          row.company_id,
          `legacy-${row.kind}`,
          JSON.stringify({ title: row.title, body: row.body, link: row.link }),
          row.is_read,
          row.created_at
        );
      }
      db.exec('DROP TABLE game_notifications_legacy');
    }
  },
  {
    version: 13,
    name: '013_newspaper_draft_contract',
    up: (db: DatabaseSync) => {
      const columns = db.prepare('PRAGMA table_info(newspaper_issues)').all() as Array<{
        name: string;
        type: string;
        notnull: number;
      }>;
      const published = columns.find(column => column.name === 'published');
      if (published?.type.toUpperCase() === 'TEXT' && published.notnull === 0) {
        return;
      }

      // Issue #163 CI exposed a mismatch with game/newspaper.ts: a NULL
      // published value means an existing draft, not a missing required value.
      const legacyIssues = db.prepare(
        'SELECT id, realm_id, issue_id, published, publish_date, articles_json, created_at FROM newspaper_issues'
      ).all() as Array<{
        id: number;
        realm_id: number;
        issue_id: number;
        published: string | number | null;
        publish_date: string | null;
        articles_json: string | null;
        created_at: string;
      }>;
      db.exec(`
        ALTER TABLE newspaper_issues RENAME TO newspaper_issues_legacy;
        CREATE TABLE newspaper_issues (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          realm_id INTEGER NOT NULL DEFAULT 0,
          issue_id INTEGER NOT NULL,
          published TEXT,
          publish_date TEXT,
          articles_json TEXT DEFAULT '[]',
          created_at TEXT NOT NULL,
          UNIQUE (realm_id, issue_id)
        );
      `);
      const insertIssue = db.prepare(
        `INSERT INTO newspaper_issues
          (id, realm_id, issue_id, published, publish_date, articles_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      for (const issue of legacyIssues) {
        insertIssue.run(
          issue.id,
          issue.realm_id,
          issue.issue_id,
          issue.published === 0 || issue.published === '0' ? null : issue.published,
          issue.publish_date,
          issue.articles_json,
          issue.created_at
        );
      }
      db.exec('DROP TABLE newspaper_issues_legacy');
    }
  },
  {
    version: 14,
    name: '014_newspaper_sponsor_contract',
    up: (db: DatabaseSync) => {
      const columns = db.prepare('PRAGMA table_info(newspaper_sponsors)').all() as Array<{ name: string }>;
      if (columns.some(column => column.name === 'position')) {
        return;
      }

      // The frontend-compatible newspaper module uses position/company_name/
      // logo, while migration 8 created a separate booking-oriented shape.
      const legacySponsors = db.prepare(
        'SELECT id, newspaper_id, slot_number, company_id, text, booked_at FROM newspaper_sponsors ORDER BY id'
      ).all() as Array<{
        id: number;
        newspaper_id: number;
        slot_number: number;
        company_id: number | null;
        text: string | null;
        booked_at: string | null;
      }>;
      db.exec(`
        ALTER TABLE newspaper_sponsors RENAME TO newspaper_sponsors_legacy;
        CREATE TABLE newspaper_sponsors (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          newspaper_id INTEGER,
          position INTEGER,
          company_id INTEGER,
          company_name TEXT,
          text TEXT,
          logo TEXT,
          created_at TEXT
        );
        CREATE UNIQUE INDEX uq_newspaper_sponsors_issue_position
          ON newspaper_sponsors (newspaper_id, position);
      `);
      const insertSponsor = db.prepare(
        `INSERT OR IGNORE INTO newspaper_sponsors
          (id, newspaper_id, position, company_id, company_name, text, logo, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const sponsor of legacySponsors) {
        insertSponsor.run(
          sponsor.id,
          sponsor.newspaper_id,
          sponsor.slot_number,
          sponsor.company_id,
          null,
          sponsor.text,
          null,
          sponsor.booked_at
        );
      }
      db.exec('DROP TABLE newspaper_sponsors_legacy');
    }
  },
  {
    version: 15,
    name: '015_simboost_use_history',
    up: (db: DatabaseSync) => {
      // SocialRepository records every successful SimBoost spend here.  This
      // table was created only by a legacy runtime path, so fresh migrated
      // databases failed as soon as a construction rush succeeded.
      db.exec(`
        CREATE TABLE IF NOT EXISTS simboost_use_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          company_id INTEGER NOT NULL,
          action TEXT NOT NULL,
          spend_simboosts INTEGER NOT NULL,
          datetime TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_simboost_use_history_company_datetime
          ON simboost_use_history (company_id, datetime DESC);
      `);
    }
  },
  {
    version: 16,
    name: '016_scheduler_state_contract',
    up: (db: DatabaseSync) => {
      const columns = new Set(
        (db.prepare('PRAGMA table_info(scheduler_state)').all() as Array<{ name: string }>)
          .map(column => column.name)
      );
      if (!columns.has('last_status')) {
        db.exec("ALTER TABLE scheduler_state ADD COLUMN last_status TEXT NOT NULL DEFAULT 'ok'");
      }
      if (!columns.has('last_error')) {
        db.exec('ALTER TABLE scheduler_state ADD COLUMN last_error TEXT');
      }
      if (!columns.has('runs')) {
        db.exec('ALTER TABLE scheduler_state ADD COLUMN runs INTEGER NOT NULL DEFAULT 0');
      }
    }
  },
  {
    version: 17,
    name: '017_building_followers_contract',
    up: (db: DatabaseSync) => {
      // Building detail responses always include their logistics followers.
      // The repository was added after the core schema, but its backing
      // relation was never migrated for clean databases.
      db.exec(`
        CREATE TABLE IF NOT EXISTS building_followers (
          building_id INTEGER NOT NULL,
          follower_building_id INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (building_id, follower_building_id),
          FOREIGN KEY (building_id) REFERENCES buildings(id),
          FOREIGN KEY (follower_building_id) REFERENCES buildings(id)
        );
        CREATE INDEX IF NOT EXISTS idx_building_followers_follower
          ON building_followers (follower_building_id);
      `);
    }
  },
  {
    version: 18,
    name: '018_building_runtime_columns',
    up: (db: DatabaseSync) => {
      // connection.ts creates the first fresh database before this runner is
      // loaded. Its historical buildings table is narrower than the runtime
      // contract, so CREATE TABLE IF NOT EXISTS in migration 1 cannot supply
      // these columns on a clean bootstrap.
      const columns = new Set(
        (db.prepare('PRAGMA table_info(buildings)').all() as Array<{ name: string }>)
          .map(column => column.name)
      );
      const addColumn = (name: string, definition: string) => {
        if (!columns.has(name)) {
          db.exec(`ALTER TABLE buildings ADD COLUMN ${definition}`);
        }
      };

      addColumn('abundance', 'abundance REAL DEFAULT 100');
      addColumn('original_abundance', 'original_abundance REAL DEFAULT 100');
      addColumn('upkeep_active', 'upkeep_active INTEGER NOT NULL DEFAULT 0');
      addColumn('robots_installed', 'robots_installed INTEGER NOT NULL DEFAULT 0');
      addColumn('robots_quality', 'robots_quality INTEGER NOT NULL DEFAULT 0');
      addColumn('locked_product', 'locked_product INTEGER');
    }
  },
  {
    version: 19,
    name: '019_universe_schema_contracts',
    up: (db: DatabaseSync) => {
      // #169/#174: the collectible exchange and HQ/PA unlock repositories
      // reference relations that only existed in ad-hoc dev databases —
      // collectibles.ts promised an "Issue #82 tail section" migration that
      // was never added, so fresh DATA_DIRs crashed with "no such table".
      // Schemas mirror the shapes the live databases already use.
      db.exec(`
        CREATE TABLE IF NOT EXISTS nft_assets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          definition_id TEXT NOT NULL,
          name TEXT NOT NULL,
          image TEXT NOT NULL,
          realm INTEGER NOT NULL DEFAULT 0,
          rarity TEXT NOT NULL DEFAULT 'COMMON',
          description TEXT NOT NULL DEFAULT '',
          current_owner_id INTEGER,
          minted_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS nft_listings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          nft_id INTEGER NOT NULL,
          seller_id INTEGER,
          price_simboosts INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'active',
          created_at TEXT NOT NULL,
          updated_at TEXT
        );
        CREATE UNIQUE INDEX IF NOT EXISTS uq_nft_listings_active_asset
          ON nft_listings (nft_id) WHERE status = 'active';

        CREATE TABLE IF NOT EXISTS nft_trades (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          nft_id INTEGER NOT NULL,
          listing_id INTEGER,
          seller_id INTEGER,
          buyer_id INTEGER NOT NULL,
          price_simboosts INTEGER NOT NULL,
          datetime TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS player_unlocked_hqs (
          company_id INTEGER NOT NULL,
          idx INTEGER NOT NULL,
          created_at TEXT,
          PRIMARY KEY (company_id, idx)
        );

        CREATE TABLE IF NOT EXISTS player_unlocked_pas (
          company_id INTEGER NOT NULL,
          kind TEXT NOT NULL,
          created_at TEXT,
          PRIMARY KEY (company_id, kind)
        );
      `);

      // #172: the migration-era government_orders shape (resource_kind /
      // bidding columns) predates the module's real contract and was never
      // writable (ensureSeededProjects inserts project_key etc. and always
      // failed against it). Replace it with the real shape; pre-realm
      // real-shape databases only get the columns they lack.
      const govColumns = new Set(
        (db.prepare('PRAGMA table_info(government_orders)').all() as Array<{ name: string }>)
          .map(column => column.name)
      );
      if (govColumns.size > 0 && govColumns.has('resource_kind')) {
        db.exec(`
          DROP TABLE government_orders;
          CREATE TABLE government_orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            realm_id INTEGER NOT NULL DEFAULT 0,
            project_key TEXT,
            agency TEXT,
            estimated_base_value REAL,
            days_to_fulfill INTEGER,
            resource_multiplier_awarded REAL,
            required_resources_json TEXT,
            unit_compensation_price REAL DEFAULT 0,
            start_date TEXT,
            deadline TEXT,
            created_at TEXT
          );
        `);
      } else {
        const govAdds: Record<string, string> = {
          realm_id: 'INTEGER NOT NULL DEFAULT 0',
          project_key: 'TEXT',
          agency: 'TEXT',
          estimated_base_value: 'REAL',
          days_to_fulfill: 'INTEGER',
          resource_multiplier_awarded: 'REAL',
          required_resources_json: 'TEXT',
          unit_compensation_price: 'REAL DEFAULT 0',
          start_date: 'TEXT',
          deadline: 'TEXT'
        };
        for (const [column, ddl] of Object.entries(govAdds)) {
          if (govColumns.size > 0 && !govColumns.has(column)) {
            db.exec(`ALTER TABLE government_orders ADD COLUMN ${column} ${ddl}`);
          }
        }
      }
    }
  },
  {
    version: 20,
    name: '020_executive_trainings',
    // #165/#177: the executive trainings lifecycle table. Previously created
    // ad-hoc in a runtime module (game/executives.ts) — schema DDL belongs
    // here only.
    up: (db: DatabaseSync) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS executive_trainings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          executive_id INTEGER NOT NULL,
          company_id INTEGER NOT NULL,
          datetime TEXT NOT NULL,
          accelerated INTEGER DEFAULT 0,
          skills_applied INTEGER DEFAULT 0,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_executive_trainings_executive
          ON executive_trainings(executive_id);
      `);

      // Pre-migration databases may carry an executives table without the
      // lifecycle columns (#167/#165). Add them defensively.
      const execColumns = new Set(
        (db.prepare('PRAGMA table_info(executives)').all() as Array<{ name: string }>)
          .map(column => column.name)
      );
      if (execColumns.size > 0) {
        const adds: Record<string, string> = {
          work_history_accelerated: 'INTEGER DEFAULT 0',
          plans_to_retire: 'INTEGER DEFAULT 0',
          strike_until: 'TEXT'
        };
        for (const [column, ddl] of Object.entries(adds)) {
          if (!execColumns.has(column)) {
            db.exec(`ALTER TABLE executives ADD COLUMN ${column} ${ddl}`);
          }
        }
      }
    }
  },
  {
    version: 21,
    name: '021_runtime_module_tables',
    // #177: runtime module tables moved into the migration chain. Previously
    // created ad-hoc in game/aerospace.ts, game/certificates.ts,
    // game/achievements.ts, game/simboost-settings.ts, game/government.ts,
    // game/newspaper.ts, repositories/audit-repository.ts,
    // repositories/fpa-reports-repository.ts and
    // repositories/referrals-repository.ts — schema DDL belongs here only.
    up: (db: DatabaseSync) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS rocket_launches (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          company_id INTEGER NOT NULL,
          realm_id INTEGER DEFAULT 0,
          building_id INTEGER,
          rocket_kind INTEGER NOT NULL,
          quality INTEGER DEFAULT 0,
          success INTEGER DEFAULT 1,
          launched_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_rocket_launches_comp_realm ON rocket_launches(realm_id, company_id);
        CREATE TABLE IF NOT EXISTS aerospace_sales_orders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          company_id INTEGER,
          building_id INTEGER,
          resources_json TEXT,
          search_cost REAL DEFAULT 750,
          payout REAL DEFAULT 15000,
          created_at TEXT,
          expires_at TEXT,
          fulfilled INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS audits (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          actor_company_id INTEGER,
          target_company_id INTEGER,
          target_player_id INTEGER,
          action TEXT NOT NULL,
          reason TEXT DEFAULT '',
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_audits_target ON audits(target_company_id, created_at);
        CREATE TABLE IF NOT EXISTS certificates (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          realm_id INTEGER DEFAULT 0,
          kind INTEGER,
          place INTEGER DEFAULT 1,
          name TEXT,
          company_id INTEGER,
          company_name TEXT,
          value REAL DEFAULT 0,
          rarity REAL DEFAULT 0.05,
          year_started INTEGER,
          resource_kind INTEGER,
          datetime TEXT
        );
        CREATE TABLE IF NOT EXISTS company_achievements (
          company_id INTEGER NOT NULL,
          achievement_id TEXT NOT NULL,
          collected_at TEXT NOT NULL,
          PRIMARY KEY (company_id, achievement_id)
        );
        CREATE TABLE IF NOT EXISTS company_boost_settings (
          company_id INTEGER PRIMARY KEY,
          production_modifier INTEGER DEFAULT 0,
          sales_modifier INTEGER DEFAULT 0,
          exchanged_today INTEGER DEFAULT 0,
          exchange_date TEXT DEFAULT '',
          purchases_today INTEGER DEFAULT 0,
          purchase_date TEXT DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS fpa_custom_reports (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          company_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          category TEXT NOT NULL DEFAULT 'Financial',
          config_json TEXT DEFAULT '{}',
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS government_bids (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          secret TEXT UNIQUE,
          template_id INTEGER,
          realm_id INTEGER DEFAULT 0,
          creator_company_id INTEGER,
          max_contractors INTEGER DEFAULT 5,
          is_public INTEGER DEFAULT 1,
          min_tier_index INTEGER DEFAULT 1,
          price_breakdown_json TEXT,
          note TEXT,
          status TEXT DEFAULT 'OPEN',
          created_at TEXT
        );
        CREATE TABLE IF NOT EXISTS government_bid_contractors (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          bid_secret TEXT,
          company_id INTEGER,
          is_main INTEGER DEFAULT 0,
          tier_index INTEGER DEFAULT 1,
          tier_multiplier REAL DEFAULT 1.0,
          deposit_paid REAL DEFAULT 0,
          fulfilled INTEGER DEFAULT 0,
          joined_at TEXT
        );
        CREATE TABLE IF NOT EXISTS government_bid_blocked_companies (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          bid_secret TEXT,
          company_id INTEGER,
          blocked_at TEXT
        );
        CREATE TABLE IF NOT EXISTS newspaper_articles (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          newspaper_id INTEGER,
          realm_id INTEGER DEFAULT 0,
          title TEXT,
          type TEXT DEFAULT 'CUSTOM',
          copy1 TEXT,
          copy2 TEXT,
          copy3 TEXT,
          author_company_id INTEGER,
          author_company_name TEXT,
          translated_by_id INTEGER,
          translated_by_name TEXT,
          position INTEGER DEFAULT 0,
          reactions_json TEXT DEFAULT '{}',
          reaction_count INTEGER DEFAULT 0,
          charts_json TEXT DEFAULT '[]',
          outdated INTEGER DEFAULT 0,
          created_at TEXT
        );
        CREATE TABLE IF NOT EXISTS newspaper_reactions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          newspaper_id INTEGER,
          article_id INTEGER,
          company_id INTEGER,
          reaction TEXT,
          created_at TEXT
        );
        CREATE TABLE IF NOT EXISTS referrals (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          referrer_company_id INTEGER NOT NULL,
          referred_company_id INTEGER UNIQUE NOT NULL,
          code TEXT NOT NULL,
          claimed_bonus INTEGER DEFAULT 0,
          rewards_paid_json TEXT DEFAULT '{}',
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_company_id);
      `);

      // Pre-migration databases may carry company_boost_settings without the
      // C-5 daily purchase cap columns. Add them defensively.
      const boostColumns = new Set(
        (db.prepare('PRAGMA table_info(company_boost_settings)').all() as Array<{ name: string }>)
          .map(column => column.name)
      );
      const boostAdds: Record<string, string> = {
        purchases_today: 'INTEGER DEFAULT 0',
        purchase_date: "TEXT DEFAULT ''"
      };
      for (const [column, ddl] of Object.entries(boostAdds)) {
        if (!boostColumns.has(column)) {
          db.exec(`ALTER TABLE company_boost_settings ADD COLUMN ${column} ${ddl}`);
        }
      }
    }
  },
  {
    version: 22,
    name: '022_economy_phase_history',
    up: (db: DatabaseSync) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS economy_phase_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          realm_id INTEGER NOT NULL,
          phase INTEGER NOT NULL CHECK (phase IN (0, 1, 2)),
          start_at TEXT NOT NULL,
          end_at TEXT,
          source TEXT NOT NULL DEFAULT 'scheduler',
          production_modifier REAL NOT NULL DEFAULT 0,
          modifier_kind TEXT NOT NULL DEFAULT 'neutral',
          modifier_seed INTEGER NOT NULL DEFAULT 0,
          generated_at TEXT NOT NULL,
          UNIQUE (realm_id, start_at)
        );
        CREATE INDEX IF NOT EXISTS idx_economy_phase_history_realm_start
          ON economy_phase_history (realm_id, start_at DESC);
        CREATE INDEX IF NOT EXISTS idx_economy_phase_history_realm_phase
          ON economy_phase_history (realm_id, phase);
      `);
      const historyColumns = new Set(
        (db.prepare('PRAGMA table_info(economy_phase_history)').all() as Array<{ name: string }>)
          .map(column => column.name)
      );
      const historyAdds: Record<string, string> = {
        production_modifier: 'REAL NOT NULL DEFAULT 0',
        modifier_kind: "TEXT NOT NULL DEFAULT 'neutral'",
        modifier_seed: 'INTEGER NOT NULL DEFAULT 0'
      };
      for (const [column, ddl] of Object.entries(historyAdds)) {
        if (!historyColumns.has(column)) {
          db.exec(`ALTER TABLE economy_phase_history ADD COLUMN ${column} ${ddl}`);
        }
      }
      const columns = new Set(
        (db.prepare('PRAGMA table_info(economy_state)').all() as Array<{ name: string }>)
          .map(column => column.name)
      );
      const additions: Record<string, string> = {
        phase_started_at: 'TEXT',
        phase_ends_at: 'TEXT',
        source: "TEXT DEFAULT 'scheduler'"
      };
      for (const [column, ddl] of Object.entries(additions)) {
        if (!columns.has(column)) {
          db.exec(`ALTER TABLE economy_state ADD COLUMN ${column} ${ddl}`);
        }
      }
      const now = new Date().toISOString();
      db.prepare(`
        INSERT OR IGNORE INTO economy_phase_history
          (realm_id, phase, start_at, end_at, source, generated_at)
        SELECT realm_id, state, COALESCE(phase_started_at, updated_at, ?), NULL,
               COALESCE(source, 'migration'), ?
        FROM economy_state
      `).run(now, now);
      db.prepare(`
        UPDATE economy_state
        SET phase_started_at = COALESCE(phase_started_at, updated_at, ?),
            source = COALESCE(source, 'migration')
      `).run(now);
      const retailColumns = new Set(
        (db.prepare('PRAGMA table_info(retail_orders)').all() as Array<{ name: string }>)
          .map(column => column.name)
      );
      const retailAdds: Record<string, string> = {
        economy_phase: 'INTEGER DEFAULT 1',
        economy_phase_started_at: 'TEXT',
        economy_source: "TEXT DEFAULT 'migration'"
      };
      for (const [column, ddl] of Object.entries(retailAdds)) {
        if (!retailColumns.has(column)) {
          db.exec(`ALTER TABLE retail_orders ADD COLUMN ${column} ${ddl}`);
        }
      }
      const productionColumns = new Set(
        (db.prepare('PRAGMA table_info(production_queues)').all() as Array<{ name: string }>)
          .map(column => column.name)
      );
      const productionAdds: Record<string, string> = {
        economy_phase: 'INTEGER DEFAULT 1',
        economy_phase_started_at: 'TEXT',
        economy_source: "TEXT DEFAULT 'migration'",
        production_modifier: 'REAL DEFAULT 0',
        production_output_multiplier: 'REAL DEFAULT 1'
      };
      for (const [column, ddl] of Object.entries(productionAdds)) {
        if (!productionColumns.has(column)) {
          db.exec(`ALTER TABLE production_queues ADD COLUMN ${column} ${ddl}`);
        }
      }
    }
  },
  {
    version: 23,
    name: '023_certificate_catalog_and_awards',
    up: (db: DatabaseSync) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS certificate_kinds (
          kind INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT NOT NULL,
          default_rarity REAL NOT NULL DEFAULT 0.05,
          award_rule TEXT NOT NULL DEFAULT 'cycle',
          period TEXT NOT NULL DEFAULT 'month',
          resource_kind INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_certificates_realm_issued
          ON certificates(realm_id, datetime DESC, id DESC);
        CREATE INDEX IF NOT EXISTS idx_certificates_realm_kind
          ON certificates(realm_id, kind, id DESC);
      `);
      const certificateColumns = new Set(
        (db.prepare('PRAGMA table_info(certificates)').all() as Array<{ name: string }>)
          .map(column => column.name)
      );
      const certificateAdds: Record<string, string> = {
        quantity: 'REAL NOT NULL DEFAULT 0',
        cycle_key: 'TEXT',
        cycle_start_at: 'TEXT',
        cycle_end_at: 'TEXT',
        rank: 'INTEGER',
        issued_at: 'TEXT'
      };
      for (const [column, ddl] of Object.entries(certificateAdds)) {
        if (!certificateColumns.has(column)) {
          db.exec(`ALTER TABLE certificates ADD COLUMN ${column} ${ddl}`);
        }
      }
      const catalog: Array<[number, string, string, number, string, string, number | null]> = [
        [1, 'All Achievements', 'Awarded for completing all available achievements.', 0.01, 'cycle', 'year', null],
        [2, 'Cash Cow', 'Awarded to the company that paid the most taxes in a month.', 0.02, 'ranking', 'month', null],
        [3, 'Contest Winner', 'Awarded to successful contest participants.', 0.03, 'contest', 'cycle', null],
        [6, 'Dumpster Chef', 'Awarded to the restaurant that wasted the most food.', 0.04, 'ranking', 'month', null],
        [7, 'Educator', 'Awarded to the company with the most executive training.', 0.03, 'ranking', 'month', null],
        [9, 'Executive Pimp', 'Awarded to the company that earned the most royalties.', 0.04, 'ranking', 'month', null],
        [10, 'Fastest Building', 'Awarded to the fastest growing company by building value.', 0.03, 'ranking', 'cycle', null],
        [11, 'Fastest Employer', 'Awarded to the fastest growing employer.', 0.03, 'ranking', 'cycle', null],
        [12, 'Fastest Value', 'Awarded to the fastest growing company by value.', 0.03, 'ranking', 'cycle', null],
        [13, 'Highest EVA', 'Awarded to the company with the highest economic value added.', 0.04, 'ranking', 'month', null],
        [14, 'Highest Patents', 'Awarded to the company with the highest patents value.', 0.04, 'ranking', 'month', null],
        [15, 'Highest Share', 'Awarded to the company with the highest share price.', 0.04, 'ranking', 'month', null],
        [16, 'Largest Building', 'Awarded to the largest company by building value.', 0.03, 'ranking', 'month', null],
        [17, 'Largest Buyer', 'Awarded to the company spending most on resources.', 0.04, 'ranking', 'month', null],
        [18, 'Largest Employer', 'Awarded to the largest employer.', 0.03, 'ranking', 'month', null],
        [20, 'Largest Seller', 'Awarded to the company earning most from exchange sales.', 0.04, 'ranking', 'month', null],
        [21, 'Largest Value', 'Awarded to the largest company by value.', 0.02, 'ranking', 'month', null],
        [22, 'Loan Shark', 'Awarded to the company collecting the most bond interest.', 0.04, 'ranking', 'month', null],
        [23, 'Mad Scientist', 'Awarded to the company producing the most research.', 0.04, 'ranking', 'month', 100],
        [25, 'Overfeeder', 'Awarded to the restaurant that fed the most people.', 0.04, 'ranking', 'month', null],
        [26, 'Procurement Parasite', 'Awarded to the company earning most government-order revenue.', 0.04, 'ranking', 'month', null],
        [27, 'Producer', 'Awarded for producing the most units of a resource.', 0.03, 'production', 'month', null],
        [28, 'Real Estate Mogul', 'Awarded for selling the most buildings at auction.', 0.04, 'ranking', 'month', null],
        [29, 'King Midas', 'Awarded to the company with the most golden bars.', 0.005, 'ranking', 'month', 69],
        [30, 'Reset', 'Awarded when resetting a company.', 0.02, 'reset', 'year', null],
        [31, 'Simicheline Star', 'Awarded to the company with the best-rated restaurant.', 0.04, 'ranking', 'month', null],
        [32, 'Supporter', 'Awarded for supporting the game.', 0.05, 'purchase', 'instant', null],
        [33, 'Veteran', 'Awarded to long-standing companies.', 0.03, 'tenure', 'year', null],
        [34, 'Wallet Wielder', 'Awarded for buying the highest-value buildings at auction.', 0.04, 'ranking', 'month', null],
        [36, 'Elon Award', 'Awarded for the most rocket explosions in a month.', 0.012, 'ranking', 'month', null],
        [39, 'Retailer of the Month', 'Awarded for selling the most units of a resource in retail.', 0.025, 'retail', 'month', null],
        [41, 'Producer of the Year', 'Awarded for producing the most units of a non-research resource.', 0.018, 'production', 'year', null]
      ];
      const insertKind = db.prepare(`
        INSERT OR IGNORE INTO certificate_kinds
          (kind, name, description, default_rarity, award_rule, period, resource_kind)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const row of catalog) insertKind.run(...row);
    }
  },
  {
    version: 24,
    name: '024_launch_product_mapping',
    up: (db: DatabaseSync) => {
      const columns = new Set(
        (db.prepare('PRAGMA table_info(production_queues)').all() as Array<{ name: string }>)
          .map(column => column.name)
      );
      if (!columns.has('launch_consumes_research')) {
        db.exec('ALTER TABLE production_queues ADD COLUMN launch_consumes_research INTEGER NOT NULL DEFAULT 1');
      }
    }
  },
  {
    version: 25,
    name: '025_retail_revenue_credit_marker',
    up: (db: DatabaseSync) => {
      const columns = new Set(
        (db.prepare('PRAGMA table_info(retail_orders)').all() as Array<{ name: string }>)
          .map(column => column.name)
      );
      if (columns.has('revenue_credited')) return;

      db.exec('ALTER TABLE retail_orders ADD COLUMN revenue_credited INTEGER NOT NULL DEFAULT 0');
      // Legacy /api/v1/busy sales credited revenue at order start and stored
      // that revenue in cost; v2 fulfilment orders store their input cost.
      db.exec(`
        UPDATE retail_orders
        SET revenue_credited = CASE
          WHEN ABS(COALESCE(cost, 0) - COALESCE(units * unit_price, 0)) < 0.005 THEN 1
          ELSE 0
        END
      `);
    }
  },
  {
    version: 26,
    name: '026_supporter_state',
    up: (db: DatabaseSync) => {
      const columns = new Set(
        (db.prepare('PRAGMA table_info(companies)').all() as Array<{ name: string }>)
          .map(column => column.name)
      );
      const additions: Record<string, string> = {
        supporter_until: 'TEXT',
        supporter_certificates: 'INTEGER NOT NULL DEFAULT 0',
        supporter_started_at: 'TEXT'
      };
      for (const [column, ddl] of Object.entries(additions)) {
        if (!columns.has(column)) {
          db.exec(`ALTER TABLE companies ADD COLUMN ${column} ${ddl}`);
        }
      }
      db.exec('CREATE INDEX IF NOT EXISTS idx_companies_supporter_until ON companies(realm_id, supporter_until)');
    }
  },
  {
    version: 27,
    name: '027_encyclopedia_resource_events',
    up: (db: DatabaseSync) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS encyclopedia_resource_events (
          id INTEGER PRIMARY KEY,
          realm_id INTEGER NOT NULL,
          kind INTEGER NOT NULL,
          speed_modifier REAL NOT NULL,
          since TEXT NOT NULL,
          until TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_encyclopedia_resource_events_active
          ON encyclopedia_resource_events(realm_id, since, until);
      `);
    }
  },
  {
    version: 28,
    name: '028_retail_sales_history',
    up: (db: DatabaseSync) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS retail_sales_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          realm_id INTEGER NOT NULL,
          company_id INTEGER NOT NULL,
          resource_kind INTEGER NOT NULL,
          quality INTEGER NOT NULL DEFAULT 0,
          units REAL NOT NULL,
          unit_price REAL NOT NULL,
          revenue REAL NOT NULL,
          sold_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_retail_sales_history_realm_date
          ON retail_sales_history(realm_id, sold_at, resource_kind);
      `);
    }
  },
  {
    version: 29,
    name: '029_gift_baskets',
    // Gift-basket persistence was previously created outside the migration
    // chain; keep the durable send/delete/claim records under schema authority.
    up: (db: DatabaseSync) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS gift_baskets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          sender_company_id INTEGER NOT NULL,
          recipient_company_id INTEGER NOT NULL,
          kind TEXT NOT NULL,
          simboosts INTEGER DEFAULT 0,
          quality INTEGER,
          collectible_id INTEGER,
          message TEXT,
          year INTEGER NOT NULL,
          sent INTEGER DEFAULT 0,
          simboosts_claimed INTEGER DEFAULT 0,
          created_at TEXT,
          sent_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_gift_baskets_recipient
          ON gift_baskets(recipient_company_id, year);
        CREATE INDEX IF NOT EXISTS idx_gift_baskets_sender
          ON gift_baskets(sender_company_id, year);

        CREATE TABLE IF NOT EXISTS gift_basket_drafts (
          company_id INTEGER NOT NULL,
          year INTEGER NOT NULL,
          draft_json TEXT,
          updated_at TEXT,
          PRIMARY KEY (company_id, year)
        );
      `);
    }
  },
  {
    version: 30,
    name: '030_accumulator_states',
    // Issue #200: accumulator progress is distinct from ordinary production
    // output; persist it by building so collect/reload can reconstruct value,
    // quality, and source-cost state without trusting an in-memory fallback.
    up: (db: DatabaseSync) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS accumulator_states (
          building_id INTEGER PRIMARY KEY,
          company_id INTEGER NOT NULL,
          resource_kind INTEGER NOT NULL,
          value REAL NOT NULL DEFAULT 0,
          cost_total REAL NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_accumulator_states_company
          ON accumulator_states(company_id, resource_kind);
      `);
      db.prepare(`
        INSERT OR IGNORE INTO accumulator_states
          (building_id, company_id, resource_kind, value, cost_total, updated_at)
        SELECT id, company_id, 150, 0, 0, COALESCE(created_at, ?)
        FROM buildings
        WHERE kind = 'v'
      `).run(new Date().toISOString());
    }
  },
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
