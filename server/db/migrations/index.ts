import type { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';

const PASSWORD_HASH_PREFIX = 'scrypt$';

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `${PASSWORD_HASH_PREFIX}${salt.toString('hex')}$${derivedKey.toString('hex')}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  if (storedHash.startsWith(PASSWORD_HASH_PREFIX)) {
    const [, saltHex, digestHex] = storedHash.split('$');
    if (!saltHex || !digestHex || !/^[0-9a-f]+$/i.test(saltHex) || !/^[0-9a-f]+$/i.test(digestHex)) return false;
    const expected = Buffer.from(digestHex, 'hex');
    const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  }

  // One-time compatibility for databases created before the scrypt migration.
  const legacyHash = crypto.createHash('sha256').update(password).digest('hex');
  return storedHash === legacyHash;
}

export function runMigrations(db: DatabaseSync): void {
  // 1. Session token migration
  const sessionColumns = db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>;
  if (!sessionColumns.some(column => column.name === 'session_token') && sessionColumns.some(column => column.name === 'token')) {
    db.exec('ALTER TABLE sessions RENAME COLUMN token TO session_token');
  }

  // 2. Production queue quality column (#39)
  const pqColumns = db.prepare('PRAGMA table_info(production_queues)').all() as Array<{ name: string }>;
  if (!pqColumns.some(c => c.name === 'quality')) {
    db.exec('ALTER TABLE production_queues ADD COLUMN quality INTEGER DEFAULT 0');
  }

  // 2b. Production queue cost basis column (P0-02): persisted input-cost
  // snapshot so the frontend can render cost per unit without NaN.
  if (!pqColumns.some(c => c.name === 'cost')) {
    db.exec('ALTER TABLE production_queues ADD COLUMN cost REAL');
  }

  // 3. Bond maturity and settled columns (#42)
  const bondCols = (db.prepare('PRAGMA table_info(bonds)').all() as { name: string }[]).map(c => c.name);
  if (!bondCols.includes('maturity_date')) db.exec('ALTER TABLE bonds ADD COLUMN maturity_date TEXT');
  if (!bondCols.includes('settled')) db.exec('ALTER TABLE bonds ADD COLUMN settled INTEGER DEFAULT 0');

  // 4. Company slots columns
  const companyCols = (db.prepare('PRAGMA table_info(companies)').all() as { name: string }[]).map(c => c.name);
  if (!companyCols.includes('extra_building_slots')) db.exec('ALTER TABLE companies ADD COLUMN extra_building_slots INTEGER DEFAULT 0');
  if (!companyCols.includes('extra_executive_slots')) db.exec('ALTER TABLE companies ADD COLUMN extra_executive_slots INTEGER DEFAULT 0');
  if (!companyCols.includes('display_case_slots')) db.exec('ALTER TABLE companies ADD COLUMN display_case_slots INTEGER DEFAULT 1');
  if (!companyCols.includes('max_tags')) db.exec('ALTER TABLE companies ADD COLUMN max_tags INTEGER DEFAULT 1');
  // P1-06: account-settings display flags on companies
  if (!companyCols.includes('show_online_indicator')) db.exec('ALTER TABLE companies ADD COLUMN show_online_indicator INTEGER DEFAULT 1');
  if (!companyCols.includes('moderator_sign')) db.exec('ALTER TABLE companies ADD COLUMN moderator_sign INTEGER DEFAULT 0');

  // Issue #97: supporter package state (Supporters guide). supporter_until is
  // the ISO UTC datetime the purchased supporter term ends;
  // supporter_certificates counts the supporter certificates awarded by
  // supporter package purchases (one per purchase, shown in the display case).
  if (!companyCols.includes('supporter_until')) db.exec('ALTER TABLE companies ADD COLUMN supporter_until TEXT');
  if (!companyCols.includes('supporter_certificates')) db.exec('ALTER TABLE companies ADD COLUMN supporter_certificates INTEGER DEFAULT 0');

  // P1-06: persisted notification preferences
  db.exec(`
    CREATE TABLE IF NOT EXISTS notification_preferences (
      company_id INTEGER PRIMARY KEY,
      email_json TEXT DEFAULT '{}',
      popup_json TEXT DEFAULT '{}',
      push_json TEXT DEFAULT '{}',
      updated_at TEXT
    );
  `);

  // 5. Retail orders quality and finished_at columns
  const retailCols = (db.prepare('PRAGMA table_info(retail_orders)').all() as { name: string }[]).map(c => c.name);
  if (!retailCols.includes('quality')) db.exec('ALTER TABLE retail_orders ADD COLUMN quality INTEGER DEFAULT 0');
  if (!retailCols.includes('finished_at')) db.exec('ALTER TABLE retail_orders ADD COLUMN finished_at TEXT');

  // 6. Plaintext password migration to scrypt
  const plaintextPlayers = db.prepare(`
    SELECT id, password FROM players
    WHERE password IS NOT NULL AND password <> ''
  `).all() as Array<{ id: number; password: string }>;
  for (const player of plaintextPlayers) {
    db.prepare('UPDATE players SET password_hash = ?, password = NULL WHERE id = ?')
      .run(hashPassword(player.password), player.id);
  }

  // 7. Admin password security check
  const adminPlayer = db.prepare(`
    SELECT id, password_hash FROM players WHERE email = 'admin@simcompanies.local'
  `).get() as { id: number; password_hash?: string } | undefined;
  if (adminPlayer?.password_hash && verifyPassword('admin123', adminPlayer.password_hash)) {
    const adminPass = process.env.ADMIN_PASSWORD || crypto.randomBytes(32).toString('base64url');
    db.prepare('UPDATE players SET password_hash = ?, password = NULL WHERE id = ?')
      .run(hashPassword(adminPass), adminPlayer.id);
    if (!process.env.ADMIN_PASSWORD) {
      console.warn('Rotated the insecure default admin password; set ADMIN_PASSWORD before the next fresh bootstrap.');
    }
  }

  // 8. Enable foreign key enforcement
  db.exec('PRAGMA foreign_keys = ON');

  // 9. Add UNIQUE constraints to prevent duplicate rows (#22)
  // First deduplicate existing data by merging amounts and keeping the latest row.
  const hasUqWarehouse = (db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='uq_warehouse_company_kind_quality'").get() as unknown);
  if (!hasUqWarehouse) {
    // Merge duplicate warehouse rows: sum amounts, keep max id
    db.exec(`
      DELETE FROM warehouse WHERE id NOT IN (
        SELECT MAX(id) FROM warehouse GROUP BY company_id, kind, quality
      );
      UPDATE warehouse SET amount = (
        SELECT total FROM (
          SELECT company_id AS cid, kind AS k, quality AS q, SUM(amount) AS total
          FROM warehouse GROUP BY company_id, kind, quality
        ) sub WHERE sub.cid = warehouse.company_id AND sub.k = warehouse.kind AND sub.q = warehouse.quality
      ) WHERE 1=1;
    `);
  }

  const hasUqBuildings = (db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='uq_buildings_company_position'").get() as unknown);
  if (!hasUqBuildings) {
    // Remove duplicate buildings at same position, keep latest
    db.exec(`
      DELETE FROM buildings WHERE id NOT IN (
        SELECT MAX(id) FROM buildings GROUP BY company_id, position
      );
    `);
  }

  const hasUqResearch = (db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='uq_research_company_discipline'").get() as unknown);
  if (!hasUqResearch) {
    db.exec(`
      DELETE FROM research WHERE id NOT IN (
        SELECT MAX(id) FROM research GROUP BY company_id, discipline
      );
    `);
  }

  const hasUqDisplay = (db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='uq_display_case_company_slot'").get() as unknown);
  if (!hasUqDisplay) {
    db.exec(`
      DELETE FROM display_case WHERE id NOT IN (
        SELECT MAX(id) FROM display_case GROUP BY company_id, slot
      );
    `);
  }

  // P1-09: recreation upkeep flag. busy_until alone cannot distinguish an
  // active upkeep from construction/upgrades, so persist an explicit marker.
  const buildingCols = (db.prepare('PRAGMA table_info(buildings)').all() as { name: string }[]).map(c => c.name);
  if (!buildingCols.includes('upkeep_active')) db.exec('ALTER TABLE buildings ADD COLUMN upkeep_active INTEGER DEFAULT 0');

  // Issue #96: robotics installation state. robots_installed/robots_quality
  // record the robotization of a production building; locked_product pins the
  // single specialized product the robotized building may produce.
  if (!buildingCols.includes('robots_installed')) db.exec('ALTER TABLE buildings ADD COLUMN robots_installed INTEGER DEFAULT 0');
  if (!buildingCols.includes('robots_quality')) db.exec('ALTER TABLE buildings ADD COLUMN robots_quality INTEGER DEFAULT 0');
  if (!buildingCols.includes('locked_product')) db.exec('ALTER TABLE buildings ADD COLUMN locked_product INTEGER');

  // Issue #93: natural resource abundance. Extractor buildings (Mine 'M',
  // Quarry 'Q', Oil Rig 'O') roll a deposit richness at construction time;
  // every building carries the current and the original abundance (defaults
  // keep pre-existing / non-extractor buildings at a fully rich 100%).
  if (!buildingCols.includes('abundance')) db.exec('ALTER TABLE buildings ADD COLUMN abundance REAL DEFAULT 100.0');
  if (!buildingCols.includes('original_abundance')) db.exec('ALTER TABLE buildings ADD COLUMN original_abundance REAL DEFAULT 100.0');

  // Issue #85: market_orders unit cost basis columns for escrow preservation
  const marketCols = (db.prepare('PRAGMA table_info(market_orders)').all() as { name: string }[]).map(c => c.name);
  if (!marketCols.includes('cost_workers')) db.exec('ALTER TABLE market_orders ADD COLUMN cost_workers REAL DEFAULT 0');
  if (!marketCols.includes('cost_admin')) db.exec('ALTER TABLE market_orders ADD COLUMN cost_admin REAL DEFAULT 0');
  if (!marketCols.includes('cost_material1')) db.exec('ALTER TABLE market_orders ADD COLUMN cost_material1 REAL DEFAULT 0');
  if (!marketCols.includes('cost_material2')) db.exec('ALTER TABLE market_orders ADD COLUMN cost_material2 REAL DEFAULT 0');
  if (!marketCols.includes('cost_market')) db.exec('ALTER TABLE market_orders ADD COLUMN cost_market REAL DEFAULT 0');

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_buildings_company_position
      ON buildings(company_id, position);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_warehouse_company_kind_quality
      ON warehouse(company_id, kind, quality);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_research_company_discipline
      ON research(company_id, discipline);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_display_case_company_slot
      ON display_case(company_id, slot);
  `);

  // Issue #95: building auctions. building_auctions escrows a listed building
  // (the buildings row is deleted while the auction runs; the auction row
  // snapshots kind/size/cost/name/category, abundance and robotics state so
  // the building can be re-created for the winner). building_auction_bids
  // holds the hidden sealed bids with their escrowed cash amounts — one active
  // bid per company per auction (re-bidding updates it).
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

    CREATE INDEX IF NOT EXISTS idx_building_auctions_status
      ON building_auctions(status, closes_at);
    CREATE INDEX IF NOT EXISTS idx_building_auctions_seller
      ON building_auctions(seller_id, status);
    CREATE INDEX IF NOT EXISTS idx_building_auction_bids_auction
      ON building_auction_bids(auction_id, status);
  `);
  // Issue #100: market trade ledger for VWAP reference prices. Every exchange
  // fill (market take) appends one row — resource kind, quality, executed unit
  // price, filled amount, seller-side exchange fee, both parties and UTC
  // timestamps. Daily VWAP per resource+quality is computed from this ledger
  // (vwap = Σ(price × amount) / Σ(amount) grouped by kind, quality, UTC day).
  db.exec(`
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
    CREATE INDEX IF NOT EXISTS idx_market_trades_kind_quality_date
      ON market_trades(kind, quality, trade_date);
  `);

  // ==========================================================================
  // Issue #82: Collectible Exchange (NFT trading).
  //
  // nft_assets    — unique collectibles; current_owner_id NULL = exchange
  //                 treasury (seed stock with no player owner).
  // nft_listings  — exchange listings; at most ONE active listing per asset
  //                 (partial unique index). seller_id NULL = treasury listing.
  // nft_trades    — provenance chain: one row per completed sale.
  // Idempotent: CREATE IF NOT EXISTS + seed guarded by the definition_id
  // unique index and an active-listing existence check.
  // ==========================================================================
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

    CREATE TABLE IF NOT EXISTS nft_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nft_id INTEGER NOT NULL,
      listing_id INTEGER,
      seller_id INTEGER,
      buyer_id INTEGER NOT NULL,
      price_simboosts INTEGER NOT NULL,
      datetime TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS uq_nft_assets_definition
      ON nft_assets(definition_id);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_nft_listings_active_asset
      ON nft_listings(nft_id) WHERE status = 'active';
    CREATE INDEX IF NOT EXISTS idx_nft_listings_status_price
      ON nft_listings(status, price_simboosts);
    CREATE INDEX IF NOT EXISTS idx_nft_trades_asset
      ON nft_trades(nft_id, id);
    CREATE INDEX IF NOT EXISTS idx_nft_assets_owner
      ON nft_assets(current_owner_id);
  `);

  // Seed 8 unique collectibles (decompiled eggTypes entries, all four rarity
  // tiers) so the exchange is browsable on a fresh database. Assets go to the
  // treasury (current_owner_id NULL) and are listed for SimBoosts at
  // rarity-scaled prices; images are the decompile-verbatim paths.
  const nftSeed: Array<{ definitionId: string; name: string; image: string; rarity: string; price: number; description: string }> = [
    { definitionId: 'EGG_COLOR_WHITE',          name: 'White Egg',          image: 'images/eggs/egg_color_white.png',          rarity: 'COMMON',  price: 25,  description: 'Most common egg, drops frequently from building activity' },
    { definitionId: 'EGG_SCALES_RAINBOW',       name: 'Rainbow Scales Egg', image: 'images/eggs/egg_scales_rainbow.png',       rarity: 'COMMON',  price: 40,  description: 'Common egg with distinct rainbow scales' },
    { definitionId: 'EGG_MATERIAL_WOOD',        name: 'Wooden Egg',         image: 'images/eggs/egg_material_wood.png',        rarity: 'RARE',    price: 75,  description: 'Uncommon egg with distinct wood materials' },
    { definitionId: 'EGG_NIGHT_SKY',            name: 'Night Sky Egg',      image: 'images/eggs/egg_night_sky.png',            rarity: 'RARE',    price: 90,  description: 'Uncommon egg painted with the night sky' },
    { definitionId: 'EGG_INDUSTRY_AEROSPACE',   name: 'Aerospace Egg',      image: 'images/eggs/egg_industry_aerospace.png',   rarity: 'SPECIAL', price: 150, description: 'Industry-themed egg, harder to find' },
    { definitionId: 'EGG_INDUSTRY_ELECTRONICS', name: 'Electronics Egg',    image: 'images/eggs/egg_industry_electronics.png', rarity: 'SPECIAL', price: 180, description: 'Industry-themed egg, harder to find' },
    { definitionId: 'EGG_ROYAL_GOLD',           name: 'Royal Gold Egg',     image: 'images/eggs/egg_royal_gold.png',           rarity: 'MYTHIC',  price: 320, description: 'Royal gold egg — extremely rare drop' },
    { definitionId: 'EGG_ROYAL_DIAMOND',        name: 'Royal Diamond Egg',  image: 'images/eggs/egg_royal_diamond.png',        rarity: 'MYTHIC',  price: 450, description: 'Royal diamond egg — extremely rare drop' }
  ];
  const nftSeedInsertAsset = db.prepare(`
    INSERT INTO nft_assets (definition_id, name, image, realm, rarity, description, current_owner_id, minted_at)
    VALUES (?, ?, ?, 0, ?, ?, NULL, ?)
    ON CONFLICT(definition_id) DO NOTHING
  `);
  const nftSeedInsertListing = db.prepare(`
    INSERT INTO nft_listings (nft_id, seller_id, price_simboosts, status, created_at, updated_at)
    SELECT id, NULL, ?, 'active', ?, ? FROM nft_assets
    WHERE definition_id = ?
      AND current_owner_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM nft_listings WHERE nft_id = nft_assets.id AND status = 'active')
  `);
  const nftSeedTime = new Date().toISOString();
  for (const seed of nftSeed) {
    nftSeedInsertAsset.run(seed.definitionId, seed.name, seed.image, seed.rarity, seed.description, nftSeedTime);
    nftSeedInsertListing.run(seed.price, nftSeedTime, nftSeedTime, seed.definitionId);
  }

  // Issue #83: newspaper domain tables — issues, articles, sponsors (11 ad
  // slots per issue) and reactions (free THUMBS_UP + 5-SimBoost REWARD tips).
  // Mirrors the schema the game module creates at import time so the tables
  // exist no matter which module initialises first.
  db.exec(`
    CREATE TABLE IF NOT EXISTS newspaper_issues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      issue_id INTEGER,
      realm_id INTEGER DEFAULT 0,
      published TEXT,
      created_at TEXT
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

    CREATE TABLE IF NOT EXISTS newspaper_reactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      newspaper_id INTEGER,
      article_id INTEGER,
      company_id INTEGER,
      reaction TEXT,
      created_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_newspaper_articles_issue
      ON newspaper_articles(newspaper_id, position);
    CREATE INDEX IF NOT EXISTS idx_newspaper_reactions_article
      ON newspaper_reactions(article_id, company_id, reaction);
  `);

  // One sponsor per issue slot (§3): dedupe historical rows, then enforce.
  const hasUqNewspaperSponsors = (db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='uq_newspaper_sponsors_issue_position'").get() as unknown);
  if (!hasUqNewspaperSponsors) {
    db.exec(`
      DELETE FROM newspaper_sponsors WHERE id NOT IN (
        SELECT MAX(id) FROM newspaper_sponsors GROUP BY newspaper_id, position
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_newspaper_sponsors_issue_position
        ON newspaper_sponsors(newspaper_id, position);
    `);
  }
}
