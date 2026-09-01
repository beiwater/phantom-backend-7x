import { db } from '../db/database.ts';
import { runInTransaction } from '../db/transaction.ts';
import { getBuildingById, type BuildingDbRow } from './buildings.ts';
import { updateCompanyMoney } from './company.ts';
import { consumeResourceWithTransactions } from './warehouse.ts';
import { getResourceDef } from './constants.ts';

// Initialize Restaurant tables
db.exec(`
  CREATE TABLE IF NOT EXISTS restaurant_properties (
    building_id INTEGER PRIMARY KEY,
    company_id INTEGER,
    good_service INTEGER DEFAULT 1,
    is_luxury INTEGER DEFAULT 0,
    keep_open INTEGER DEFAULT 1,
    menu_json TEXT,
    rating REAL DEFAULT 4.2,
    occupancy REAL DEFAULT 0.85,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS restaurant_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    building_id INTEGER,
    company_id INTEGER,
    datetime TEXT,
    rating REAL,
    occupied INTEGER,
    capacity INTEGER,
    revenue REAL,
    cost REAL,
    profit REAL,
    resolved INTEGER DEFAULT 1
  );
`);

// Issue #92: restaurant schema evolution. Columns added after the initial
// release are appended with PRAGMA-guarded ALTER TABLE statements so existing
// databases migrate in place (same pattern as company_boost_settings).
function ensureRestaurantColumns(): void {
  const propertyCols = (db.prepare('PRAGMA table_info(restaurant_properties)').all() as Array<{ name: string }>).map(c => c.name);
  if (!propertyCols.includes('professional_staff')) {
    db.exec('ALTER TABLE restaurant_properties ADD COLUMN professional_staff INTEGER DEFAULT 0');
  }
  if (!propertyCols.includes('last_cycle_at')) {
    db.exec('ALTER TABLE restaurant_properties ADD COLUMN last_cycle_at TEXT');
  }

  const runCols = (db.prepare('PRAGMA table_info(restaurant_runs)').all() as Array<{ name: string }>).map(c => c.name);
  if (!runCols.includes('cycle_start')) db.exec('ALTER TABLE restaurant_runs ADD COLUMN cycle_start TEXT');
  if (!runCols.includes('cycle_end')) db.exec('ALTER TABLE restaurant_runs ADD COLUMN cycle_end TEXT');
  if (!runCols.includes('prepared')) db.exec('ALTER TABLE restaurant_runs ADD COLUMN prepared INTEGER DEFAULT 0');
  if (!runCols.includes('served')) db.exec('ALTER TABLE restaurant_runs ADD COLUMN served INTEGER DEFAULT 0');
  if (!runCols.includes('spoiled')) db.exec('ALTER TABLE restaurant_runs ADD COLUMN spoiled INTEGER DEFAULT 0');
  if (!runCols.includes('food_cost')) db.exec('ALTER TABLE restaurant_runs ADD COLUMN food_cost REAL DEFAULT 0');
  if (!runCols.includes('wages')) db.exec('ALTER TABLE restaurant_runs ADD COLUMN wages REAL DEFAULT 0');
}
ensureRestaurantColumns();

// ---------------------------------------------------------------------------
// Issue #92 domain constants
// ---------------------------------------------------------------------------

/** A restaurant operates in fixed 12-hour cycles; every cycle resolves as a run. */
export const RESTAURANT_CYCLE_MS = 12 * 60 * 60 * 1000;

/** Economy format seats per building level. */
export const ECONOMY_SEATS_PER_LEVEL = 1000;

/** Luxury format seats per building level (smaller, more exclusive dining room). */
export const LUXURY_SEATS_PER_LEVEL = 500;

/** Professional staff wages are 5x the basic staff wages per cycle. */
export const PROFESSIONAL_STAFF_WAGE_MULTIPLIER = 5;

/** Basic staff wages for one 12-hour cycle. */
export const RESTAURANT_BASE_WAGES_PER_CYCLE = 200;

/** Restaurant ratings use a 0.0 - 10.0 star scale. */
export const RESTAURANT_RATING_MAX = 10;

export interface RestaurantMenuItem {
  resource: number;
  quality: number;
  price: number;
}

export interface RestaurantProperties {
  buildingId: number;
  goodService: boolean;
  isLuxury: boolean;
  professionalStaff: boolean;
  keepOpen: boolean;
  menu: RestaurantMenuItem[];
  rating: number;
  occupancy: number;
  seats: number;
  lastCycleAt: string | null;
}

export interface RestaurantRun {
  id: number;
  buildingId: number;
  datetime: string;
  rating: number;
  occupied: number;
  capacity: number;
  revenue: number;
  cost: number;
  profit: number;
  resolved: boolean;
  cycleStart: string;
  cycleEnd: string;
  prepared: number;
  served: number;
  spoiled: number;
  foodCost: number;
  wages: number;
}

export const RESTAURANT_DISHES = [
  117, // Samosa
  119, // Hamburger
  121, // Lasagna
  122, // Pizza
  123, // Pasta
  124, // Cocktail
  125, // Wine
  126, // Beer
  129, // Salad
  130, // Steak with potatoes
  131, // Sushi
  132, // Coffee
  134, // Ice Cream
  142, // Orange Juice
  143, // Apple Pie
  149  // Cheesecake
];

const RESTAURANT_DISH_NAMES: Record<number, string> = {
  117: 'Samosa',
  119: 'Hamburger',
  121: 'Lasagna',
  122: 'Pizza',
  123: 'Pasta',
  124: 'Cocktail',
  125: 'Wine',
  126: 'Beer',
  129: 'Salad',
  130: 'Steak with potatoes',
  131: 'Sushi',
  132: 'Coffee',
  134: 'Ice Cream',
  142: 'Orange Juice',
  143: 'Apple Pie',
  149: 'Cheesecake'
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}


// ---------------------------------------------------------------------------
// Issue #92: seating capacity, wages and the 10-star rating scale
// ---------------------------------------------------------------------------

/** Economy format = 1,000 seats per building level; luxury format = 500. */
export function getRestaurantSeats(size: number, isLuxury: boolean): number {
  const level = Math.max(1, Math.floor(Number(size) || 1));
  return level * (isLuxury ? LUXURY_SEATS_PER_LEVEL : ECONOMY_SEATS_PER_LEVEL);
}

/** Professional staff wages cost 5x the basic staff wages for a cycle. */
export function computeRestaurantWages(professionalStaff: boolean): number {
  return RESTAURANT_BASE_WAGES_PER_CYCLE * (professionalStaff ? PROFESSIONAL_STAFF_WAGE_MULTIPLIER : 1);
}

/**
 * 10-star rating (0.0 - 10.0) built from three balanced components:
 *  - food quality:   average menu item quality, up to 4.0 stars
 *  - service:        good service + professional staff, up to 3.0 stars
 *  - menu balance:   menu diversity (dish count), up to 3.0 stars
 */
export function computeRestaurantRating(input: {
  goodService: boolean;
  professionalStaff: boolean;
  menu: RestaurantMenuItem[];
}): number {
  const menu = Array.isArray(input.menu) ? input.menu : [];
  const avgQuality = menu.length > 0
    ? menu.reduce((acc, item) => acc + (Number(item.quality) || 0), 0) / menu.length
    : 0;
  const qualityScore = Math.min(4, Math.max(0, avgQuality) * 2);
  const serviceScore = (input.goodService ? 1.2 : 0) + (input.professionalStaff ? 1.8 : 0);
  const menuBalanceScore = Math.min(3, menu.length * 0.375);
  return Math.round(Math.min(RESTAURANT_RATING_MAX, Math.max(0, qualityScore + serviceScore + menuBalanceScore)) * 10) / 10;
}

/** Expected guest occupancy is derived from the 10-star rating. */
export function computeRestaurantOccupancy(rating: number): number {
  const clamped = Math.min(RESTAURANT_RATING_MAX, Math.max(0, rating));
  return round2(0.5 + (clamped / RESTAURANT_RATING_MAX) * 0.45);
}

const DEFAULT_MENU: RestaurantMenuItem[] = [
  { resource: 119, quality: 0, price: 18.5 }, // Hamburger
  { resource: 129, quality: 0, price: 12.0 }, // Salad
  { resource: 132, quality: 0, price: 6.5 },  // Coffee
  { resource: 142, quality: 0, price: 8.0 }   // Orange Juice
];

export function getRestaurantProperties(buildingId: number, companyId?: number | null): RestaurantProperties {
  const row = db.prepare('SELECT * FROM restaurant_properties WHERE building_id = ?').get(buildingId) as {
    building_id: number;
    company_id: number;
    good_service: number;
    is_luxury: number;
    professional_staff: number;
    keep_open: number;
    menu_json: string;
    rating: number;
    occupancy: number;
    last_cycle_at: string | null;
  } | undefined;

  const building = getBuildingById(buildingId);
  const size = building?.size || 1;
  const isLuxury = Boolean(row ? row.is_luxury : 0);
  const professionalStaff = Boolean(row ? row.professional_staff : 0);
  const seats = getRestaurantSeats(size, isLuxury);

  if (row) {
    let menu: RestaurantMenuItem[] = [];
    try {
      menu = JSON.parse(row.menu_json || '[]');
    } catch {
      menu = [];
    }
    return {
      buildingId,
      goodService: Boolean(row.good_service),
      isLuxury,
      professionalStaff,
      keepOpen: Boolean(row.keep_open),
      menu,
      rating: row.rating,
      occupancy: row.occupancy,
      seats,
      lastCycleAt: row.last_cycle_at || null
    };
  }

  // Default restaurant: good basic service, default menu, basic staff.
  const rating = computeRestaurantRating({
    goodService: true,
    professionalStaff: false,
    menu: DEFAULT_MENU
  });

  return {
    buildingId,
    goodService: true,
    isLuxury: false,
    professionalStaff: false,
    keepOpen: true,
    menu: DEFAULT_MENU,
    rating,
    occupancy: computeRestaurantOccupancy(rating),
    seats,
    lastCycleAt: null
  };
}

export function updateRestaurantProperties(
  buildingId: number,
  companyId: number,
  updates: Partial<{
    goodService: boolean;
    isLuxury: boolean;
    professionalStaff: boolean;
    keepOpen: boolean;
    menu: RestaurantMenuItem[];
  }>
): { building: BuildingDbRow | null; restaurantProperties: RestaurantProperties } {
  const current = getRestaurantProperties(buildingId, companyId);
  const goodService = updates.goodService !== undefined ? updates.goodService : current.goodService;
  const isLuxury = updates.isLuxury !== undefined ? updates.isLuxury : current.isLuxury;
  const professionalStaff = updates.professionalStaff !== undefined ? updates.professionalStaff : current.professionalStaff;
  const keepOpen = updates.keepOpen !== undefined ? updates.keepOpen : current.keepOpen;
  const menu = updates.menu !== undefined ? updates.menu : current.menu;

  // Rating on the 0.0 - 10.0 scale from quality / service / menu balance.
  const rating = computeRestaurantRating({ goodService, professionalStaff, menu });
  const occupancy = computeRestaurantOccupancy(rating);

  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO restaurant_properties (building_id, company_id, good_service, is_luxury, professional_staff, keep_open, menu_json, rating, occupancy, last_cycle_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(building_id) DO UPDATE SET
      good_service = excluded.good_service,
      is_luxury = excluded.is_luxury,
      professional_staff = excluded.professional_staff,
      keep_open = excluded.keep_open,
      menu_json = excluded.menu_json,
      rating = excluded.rating,
      occupancy = excluded.occupancy,
      last_cycle_at = excluded.last_cycle_at,
      updated_at = excluded.updated_at
  `).run(
    buildingId,
    companyId,
    goodService ? 1 : 0,
    isLuxury ? 1 : 0,
    professionalStaff ? 1 : 0,
    keepOpen ? 1 : 0,
    JSON.stringify(menu),
    rating,
    occupancy,
    current.lastCycleAt,
    now
  );

  const building = getBuildingById(buildingId);
  const updatedProps = getRestaurantProperties(buildingId, companyId);

  return {
    building,
    restaurantProperties: updatedProps
  };
}

function mapRunRow(r: {
  id: number;
  building_id: number;
  datetime: string;
  rating: number;
  occupied: number;
  capacity: number;
  revenue: number;
  cost: number;
  profit: number;
  resolved: number;
  cycle_start: string | null;
  cycle_end: string | null;
  prepared: number | null;
  served: number | null;
  spoiled: number | null;
  food_cost: number | null;
  wages: number | null;
}): RestaurantRun {
  return {
    id: r.id,
    buildingId: r.building_id,
    datetime: r.datetime,
    rating: r.rating,
    occupied: r.occupied,
    capacity: r.capacity,
    revenue: r.revenue,
    cost: r.cost,
    profit: r.profit,
    resolved: Boolean(r.resolved),
    cycleStart: r.cycle_start || r.datetime,
    cycleEnd: r.cycle_end || new Date(new Date(r.datetime).getTime() + RESTAURANT_CYCLE_MS).toISOString(),
    prepared: r.prepared ?? 0,
    served: r.served ?? r.occupied,
    spoiled: r.spoiled ?? 0,
    foodCost: r.food_cost ?? 0,
    wages: r.wages ?? 0
  };
}

export function getRestaurantRuns(buildingId: number, companyId?: number | null): RestaurantRun[] {
  let rows = db.prepare(`
    SELECT * FROM restaurant_runs
    WHERE building_id = ?
    ORDER BY id DESC
    LIMIT 30
  `).all(buildingId) as Array<{
    id: number;
    building_id: number;
    datetime: string;
    rating: number;
    occupied: number;
    capacity: number;
    revenue: number;
    cost: number;
    profit: number;
    resolved: number;
    cycle_start: string | null;
    cycle_end: string | null;
    prepared: number | null;
    served: number | null;
    spoiled: number | null;
    food_cost: number | null;
    wages: number | null;
  }>;

  // Seed sample historic runs if empty so the restaurant page shows history.
  if (rows.length === 0) {
    const props = getRestaurantProperties(buildingId, companyId);
    const capacity = props.seats;
    const wages = computeRestaurantWages(props.professionalStaff);
    const now = Date.now();

    for (let i = 5; i >= 1; i--) {
      const cycleEnd = new Date(now - i * RESTAURANT_CYCLE_MS).toISOString();
      const cycleStart = new Date(now - (i + 1) * RESTAURANT_CYCLE_MS).toISOString();
      const occupied = Math.floor(capacity * (props.occupancy - 0.05 + Math.random() * 0.1));
      const avgCheck = props.isLuxury ? 48 : 22;
      const revenue = round2(occupied * avgCheck);
      const prepared = capacity;
      const served = Math.min(occupied, prepared);
      const spoiled = Math.max(0, prepared - served);
      const foodCost = round2(revenue * 0.38);
      const cost = round2(foodCost + wages);
      const profit = round2(revenue - cost);

      db.prepare(`
        INSERT INTO restaurant_runs (building_id, company_id, datetime, rating, occupied, capacity, revenue, cost, profit, resolved, cycle_start, cycle_end, prepared, served, spoiled, food_cost, wages)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
      `).run(buildingId, companyId || 1, cycleEnd, props.rating, occupied, capacity, revenue, cost, profit, cycleStart, cycleEnd, prepared, served, spoiled, foodCost, wages);
    }

    rows = db.prepare(`
      SELECT * FROM restaurant_runs
      WHERE building_id = ?
      ORDER BY id DESC
      LIMIT 30
    `).all(buildingId) as typeof rows;
  }

  return rows.map(mapRunRow);
}

/** Total units of a resource across every quality tier in the warehouse. */
function getAvailableAmount(companyId: number, kind: number): number {
  const row = db.prepare(
    'SELECT COALESCE(SUM(amount), 0) AS total FROM warehouse WHERE company_id = ? AND kind = ? AND amount > 0'
  ).get(companyId, kind) as { total: number | bigint };
  return Number(row.total) || 0;
}

/**
 * Resolve one fixed 12-hour restaurant operating cycle (Issue #92).
 *
 * Lifecycle:
 *  1. The cycle opens at `cycleStart` and closes exactly 12 hours later at
 *     `cycleEnd` (RESTAURANT_CYCLE_MS), independent of sales.
 *  2. The restaurant loads one dish per seat for the cycle from the warehouse,
 *     split evenly across the menu. Partial loads are allowed; sales cannot
 *     exceed the loaded food.
 *  3. At the end of the cycle every loaded-but-unsold dish spoils and its cost
 *     is borne regardless of sales (`spoiled = prepared - served`).
 *
 * The whole cycle resolution (warehouse consumption, money update, run insert,
 * cycle bookkeeping) is one atomic transaction.
 */
export function executeRestaurantRun(
  buildingId: number,
  companyId: number
): Promise<{
  building: BuildingDbRow | null;
  run: RestaurantRun;
  resourceTransactions: Array<{ kind: number; quality: number; amount: number }>;
  moneyUpdate: number;
}> {
  return runInTransaction(() => {
    const props = getRestaurantProperties(buildingId, companyId);
    if (!props.keepOpen) {
      throw new Error('Restaurant is closed and cannot start a new cycle');
    }
    const capacity = props.seats;
    const occupied = Math.floor(capacity * (0.8 + Math.random() * 0.18));

    const cycleStart = new Date();
    const cycleEnd = new Date(cycleStart.getTime() + RESTAURANT_CYCLE_MS);

    // Food load: one dish per seat per 12h cycle, split evenly across the menu.
    const preparedPerDish = props.menu.length > 0 ? Math.ceil(capacity / props.menu.length) : 0;
    const resourceTransactions: Array<{ kind: number; quality: number; amount: number }> = [];
    let prepared = 0;
    let foodCost = 0;

    for (const item of props.menu) {
      if (preparedPerDish <= 0) break;
      const desired = Math.min(preparedPerDish, capacity - prepared);
      if (desired <= 0) break;
      const available = getAvailableAmount(companyId, item.resource);
      const load = Math.min(desired, available);
      if (load <= 0) continue;

      const transactions = consumeResourceWithTransactions(companyId, item.resource, item.quality, load);
      if (!transactions) continue; // raced with another consumer; leave this dish unloaded

      prepared += load;
      for (const tx of transactions) {
        const units = Math.abs(tx.amount);
        foodCost += (Number(tx.cost) || 0) * units;
      }
      resourceTransactions.push({ kind: item.resource, quality: item.quality, amount: -load });
    }
    foodCost = round2(foodCost);

    // Guests can only be served the food that was actually loaded; the rest of
    // the loaded food spoils at the end of the 12h cycle regardless of sales.
    const served = Math.min(occupied, prepared);
    const spoiled = prepared - served;

    let avgDishPrice = 20;
    if (props.menu.length > 0) {
      avgDishPrice = props.menu.reduce((acc, item) => acc + (item.price || 20), 0) / props.menu.length;
    }
    if (props.isLuxury) avgDishPrice *= 1.5;

    const revenue = round2(served * avgDishPrice);
    const wages = computeRestaurantWages(props.professionalStaff);
    const cost = round2(foodCost + wages);
    const profit = round2(revenue - cost);

    // Money update is skipped when profit is exactly zero (no-ledger noise).
    let moneyUpdate = 0;
    if (profit !== 0) {
      updateCompanyMoney(companyId, profit);
      moneyUpdate = profit;
    }

    const cycleStartIso = cycleStart.toISOString();
    const cycleEndIso = cycleEnd.toISOString();
    const insertRes = db.prepare(`
      INSERT INTO restaurant_runs (building_id, company_id, datetime, rating, occupied, capacity, revenue, cost, profit, resolved, cycle_start, cycle_end, prepared, served, spoiled, food_cost, wages)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      buildingId,
      companyId,
      cycleStartIso,
      props.rating,
      occupied,
      capacity,
      revenue,
      cost,
      profit,
      cycleStartIso,
      cycleEndIso,
      prepared,
      served,
      spoiled,
      foodCost,
      wages
    );

    db.prepare('UPDATE restaurant_properties SET last_cycle_at = ? WHERE building_id = ?')
      .run(cycleStartIso, buildingId);

    const run: RestaurantRun = {
      id: Number(insertRes.lastInsertRowid),
      buildingId,
      datetime: cycleStartIso,
      rating: props.rating,
      occupied,
      capacity,
      revenue,
      cost,
      profit,
      resolved: true,
      cycleStart: cycleStartIso,
      cycleEnd: cycleEndIso,
      prepared,
      served,
      spoiled,
      foodCost,
      wages
    };

    const building = getBuildingById(buildingId);

    return {
      building,
      run,
      resourceTransactions,
      moneyUpdate
    };
  }, { immediate: true });
}

export function getRestaurantMenuGuide(): Array<{
  kind: number;
  name: string;
  category: string;
  suggestedPrice: number;
  image: string;
}> {
  return RESTAURANT_DISHES.map(kind => {
    const def = getResourceDef(kind);
    return {
      kind,
      name: RESTAURANT_DISH_NAMES[kind] || def?.name || `Dish #${kind}`,
      category: kind >= 124 && kind <= 126 ? 'Drinks' : (kind >= 142 ? 'Desserts & Juices' : 'Main Courses'),
      suggestedPrice: round2((def?.cost || 10) * 1.6),
      image: def?.image || 'images/resources/hamburger.png'
    };
  });
}

/** Rating breakdown on the 0.0 - 10.0 star scale. */
export function getRestaurantRatings(buildingId?: number): {
  overallRating: number;
  foodRating: number;
  serviceRating: number;
  ambianceRating: number;
  totalReviews: number;
} {
  const props = buildingId ? getRestaurantProperties(buildingId) : null;
  const rating = props ? props.rating : computeRestaurantRating({ goodService: true, professionalStaff: false, menu: DEFAULT_MENU });
  return {
    overallRating: rating,
    foodRating: Math.min(RESTAURANT_RATING_MAX, Math.round((rating + 0.4) * 10) / 10),
    serviceRating: props?.goodService ? (props.professionalStaff ? 9.2 : 7.8) : 4.6,
    ambianceRating: props?.isLuxury ? 9.0 : 7.2,
    totalReviews: 128
  };
}
