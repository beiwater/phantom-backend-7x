import { db } from '../db/database.ts';
import { virtualClock } from '../core/virtual-clock.ts';
import { runInTransaction } from '../db/transaction.ts';
import { getBuildingById, type BuildingDbRow } from './buildings.ts';
import { buildingRepository } from '../repositories/building-repository.ts';
import { restaurantRepository } from '../repositories/restaurant-repository.ts';
import { warehouseRepository } from '../repositories/warehouse-repository.ts';
import { updateCompanyMoney } from './company.ts';
import { getResourceDef } from './constants.ts';
import { getCompanyBoostSettings } from './simboost-settings.ts';
import { CONFIG } from '../config.ts';

// The legacy database shipped before the restaurant guide was implemented in
// full. Keep migrations here so an existing local database can be upgraded in
// place instead of silently losing restaurant state.
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

function ensureRestaurantColumns(): void {
  const propertyCols = new Set(
    (db.prepare('PRAGMA table_info(restaurant_properties)').all() as Array<{ name: string }>).map(c => c.name)
  );
  const propertyMigrations: Array<[string, string]> = [
    ['menu_price', 'REAL DEFAULT 60'],
    ['professional_staff', 'INTEGER DEFAULT 0'],
    ['last_cycle_at', 'TEXT'],
    ['reconstruction_started_at', 'TEXT'],
    ['reconstruction_until', 'TEXT'],
    ['rating_penalty_applied', 'INTEGER DEFAULT 0']
  ];
  for (const [name, definition] of propertyMigrations) {
    if (!propertyCols.has(name)) db.exec(`ALTER TABLE restaurant_properties ADD COLUMN ${name} ${definition}`);
  }

  const runCols = new Set(
    (db.prepare('PRAGMA table_info(restaurant_runs)').all() as Array<{ name: string }>).map(c => c.name)
  );
  const runMigrations: Array<[string, string]> = [
    ['new_rating', 'REAL'],
    ['rating_before', 'REAL'],
    ['rating_after', 'REAL'],
    ['rating_delta', 'REAL'],
    ['occupancy', 'REAL'],
    ['menu_price', 'REAL'],
    ['review', 'TEXT'],
    ['menu_json', 'TEXT'],
    ['good_service', 'INTEGER'],
    ['is_luxury', 'INTEGER'],
    ['cycle_start', 'TEXT'],
    ['cycle_end', 'TEXT'],
    ['prepared', 'INTEGER DEFAULT 0'],
    ['served', 'INTEGER'],
    ['spoiled', 'INTEGER'],
    ['food_cost', 'REAL DEFAULT 0'],
    ['wages', 'REAL DEFAULT 0']
  ];
  for (const [name, definition] of runMigrations) {
    if (!runCols.has(name)) db.exec(`ALTER TABLE restaurant_runs ADD COLUMN ${name} ${definition}`);
  }
}
ensureRestaurantColumns();

export const BASE_RESTAURANT_CYCLE_SECONDS = 43200;
export function getRestaurantCycleSeconds(): number {
  const multiplier = Number(CONFIG.PRODUCTION_SPEED_MULTIPLIER) || 1;
  return Math.max(3, Math.round(BASE_RESTAURANT_CYCLE_SECONDS / multiplier));
}
export const RESTAURANT_CYCLE_SECONDS = getRestaurantCycleSeconds();
export const RESTAURANT_CYCLE_MS = RESTAURANT_CYCLE_SECONDS * 1000;
export const RESTAURANT_MENU_PRICE_MIN = 60;
export const RESTAURANT_MENU_PRICE_MAX = 350;
export const ECONOMY_SEATS_PER_LEVEL = 1000;
export const LUXURY_SEATS_PER_LEVEL = 500;
export const RESTAURANT_RECONSTRUCTION_SECONDS = 10800;
export const RESTAURANT_COST_UNITS = 26;
export const AVERAGE_SALARY = 345;
export const RESTAURANT_SALARY_MODIFIER = 1.7;
export const PROFESSIONAL_STAFF_WAGE_MULTIPLIER = 5;
// Retained for callers that used the old boolean-only helper. New cycle wages
// use the official 345 x 1.7 x building-size formula below.
export const RESTAURANT_BASE_WAGES_PER_CYCLE = 200;
export const RESTAURANT_RATING_MAX = 10;

export type RestaurantQualityMode = 'low' | 'high' | 'exact';

export interface RestaurantMenuItem {
  resource: number;
  quality: number;
  qualityMode?: RestaurantQualityMode;
  /** Compatibility only. Restaurant pricing is one common menu price. */
  price?: number;
}

export interface RestaurantProperties {
  buildingId: number;
  goodService: boolean;
  isLuxury: boolean;
  professionalStaff: boolean;
  keepOpen: boolean;
  menu: RestaurantMenuItem[];
  menuPrice: number;
  rating: number;
  occupancy: number;
  seats: number;
  lastCycleAt: string | null;
  reconstructionUntil: string | null;
}

export interface RestaurantRun {
  id: number;
  buildingId: number;
  datetime: string;
  rating: number;
  newRating: number | null;
  occupied: number | null;
  capacity: number;
  occupancy: number | null;
  revenue: number | null;
  cost: number;
  profit: number | null;
  menuPrice: number;
  review: string;
  resolved: boolean;
  cycleStart: string;
  cycleEnd: string;
  prepared: number;
  served: number | null;
  spoiled: number | null;
  foodCost: number;
  wages: number;
}

// These values are the food coefficients and variety modifiers used by the
// bundled Sim Companies restaurant client. Each dish belongs to exactly one
// group, and its requirement is rounded up per dish.
export const RESTAURANT_FOOD_CONSUMPTION: Record<number, number> = {
  117: 288,
  121: 24.89,
  134: 92.6,
  122: 38.196,
  119: 96.312,
  123: 16.667,
  129: 3.608,
  130: 4.073,
  131: 3.505,
  142: 9.402,
  143: 10.093,
  149: 9.2,
  132: 4.04,
  124: 144,
  125: 128.955,
  126: 113.984
};

export const RESTAURANT_VARIETY_FACTORS = [2.1, 1, 0.9, 0.8, 0.8, 0.8];
export const RESTAURANT_SALAD_BAR = [117, 121, 134, 122, 119, 123];
export const RESTAURANT_MAINS = [129, 130, 131, 142, 143, 149];
export const RESTAURANT_DRINKS = [132, 124, 125, 126];
export const RESTAURANT_DISHES = [117, 121, 134, 122, 119, 123, 129, 130, 131, 142, 143, 132, 124, 125, 126, 149];

const RESTAURANT_DISH_NAMES: Record<number, string> = {
  117: 'Milk',
  119: 'Coffee',
  121: 'Bread',
  122: 'Cheese',
  123: 'Apple pie',
  124: 'Orange juice',
  125: 'Apple cider',
  126: 'Ginger beer',
  129: 'Hamburger',
  130: 'Lasagna',
  131: 'Meatballs',
  132: 'Cocktails',
  134: 'Butter',
  142: 'Salad',
  143: 'Samosas',
  149: 'Pumpkin soup'
};

export interface LegacyRestaurantMenuItem {
  kind: number;
  serving: 'TOP' | 'BOTTOM' | 'NONE';
  quality: number;
  price: number;
}

export interface LegacyRestaurantProperties {
  isLuxury: boolean;
  goodService: boolean;
  saladBar: LegacyRestaurantMenuItem[];
  mains: LegacyRestaurantMenuItem[];
  drinks: LegacyRestaurantMenuItem[];
  menuPrice: number;
  keepOpen: boolean;
  rating: number;
  occupancy: number;
  seats: number;
  professionalStaff: boolean;
  lastCycleAt: string | null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizedQualityMode(item: RestaurantMenuItem): RestaurantQualityMode {
  const mode = String(item.qualityMode || 'low').toLowerCase();
  if (mode === 'high' || mode === 'top') return 'high';
  if (mode === 'exact') return 'exact';
  return 'low';
}

function categoryForDish(kind: number): 'saladBar' | 'mains' | 'drinks' | null {
  if (RESTAURANT_SALAD_BAR.includes(kind)) return 'saladBar';
  if (RESTAURANT_MAINS.includes(kind)) return 'mains';
  if (RESTAURANT_DRINKS.includes(kind)) return 'drinks';
  return null;
}

export function validateRestaurantMenu(menu: RestaurantMenuItem[]): void {
  if (!Array.isArray(menu)) throw new Error('Menu must be an array of menu items');
  if (menu.length > RESTAURANT_DISHES.length) {
    throw new Error(`Menu cannot contain more than ${RESTAURANT_DISHES.length} dishes`);
  }
  const seen = new Set<number>();
  for (const item of menu) {
    if (!Number.isInteger(item.resource) || !RESTAURANT_DISHES.includes(item.resource)) {
      throw new Error(`Menu item resource #${String(item.resource)} is not a restaurant dish`);
    }
    if (seen.has(item.resource)) throw new Error(`Menu contains duplicate dish #${item.resource}`);
    seen.add(item.resource);
    if (!Number.isInteger(item.quality) || item.quality < 0 || item.quality > 12) {
      throw new Error(`Menu item #${item.resource} has an invalid quality`);
    }
    const mode = normalizedQualityMode(item);
    if (mode === 'exact' && !Number.isInteger(item.quality)) {
      throw new Error(`Menu item #${item.resource} needs an exact quality`);
    }
  }
}

export function validateRestaurantMenuForCycle(menu: RestaurantMenuItem[]): void {
  validateRestaurantMenu(menu);
  for (const category of ['saladBar', 'mains', 'drinks'] as const) {
    if (!menu.some(item => categoryForDish(item.resource) === category)) {
      throw new Error(`Restaurant menu needs at least one ${category} dish`);
    }
  }
}

export function validateRestaurantMenuPrice(value: unknown): number {
  const price = Number(value);
  if (!Number.isFinite(price) || price < RESTAURANT_MENU_PRICE_MIN || price > RESTAURANT_MENU_PRICE_MAX) {
    throw new Error(`menuPrice must be between ${RESTAURANT_MENU_PRICE_MIN} and ${RESTAURANT_MENU_PRICE_MAX}`);
  }
  return round2(price);
}

export function getRestaurantSeats(size: number, isLuxury: boolean): number {
  const level = Math.max(1, Math.floor(Number(size) || 1));
  return level * (isLuxury ? LUXURY_SEATS_PER_LEVEL : ECONOMY_SEATS_PER_LEVEL);
}

/** Compatibility overload for the old public helper. */
export function computeRestaurantWages(professionalStaff: boolean): number;
export function computeRestaurantWages(input: {
  size: number;
  isLuxury: boolean;
  goodService?: boolean;
  professionalStaff?: boolean;
  administrationOverhead?: number;
}): number;
export function computeRestaurantWages(
  input: boolean | { size: number; isLuxury: boolean; goodService?: boolean; professionalStaff?: boolean; administrationOverhead?: number }
): number {
  if (typeof input === 'boolean') {
    return RESTAURANT_BASE_WAGES_PER_CYCLE * (input ? PROFESSIONAL_STAFF_WAGE_MULTIPLIER : 1);
  }
  const size = Math.max(1, Math.floor(Number(input.size) || 1));
  const styleMultiplier = input.isLuxury ? 0.5 : 1;
  const overhead = Number.isFinite(input.administrationOverhead) ? Math.max(1, Number(input.administrationOverhead)) : 1;
  const staffMultiplier = input.goodService || input.professionalStaff ? PROFESSIONAL_STAFF_WAGE_MULTIPLIER : 1;
  return Math.ceil(AVERAGE_SALARY * RESTAURANT_SALARY_MODIFIER * styleMultiplier * size * overhead * 12 * staffMultiplier);
}

function getCooManagement(companyId: number): number {
  return clamp(restaurantRepository.getCooManagement(companyId), 0, 100);
}

function getCmoCommunication(companyId: number): number {
  return clamp(restaurantRepository.getCmoCommunication(companyId), 0, 100);
}

function getAdministrationOverhead(companyId: number): number {
  // The local auth/economy implementation currently reports a neutral
  // administration overhead. Preserve the official COO reduction shape so a
  // future non-neutral overhead can be enabled without changing restaurant
  // formulas.
  const administrationOverhead = 1;
  const cooSkill = getCooManagement(companyId);
  return Math.max(1, administrationOverhead - (administrationOverhead - 1) * cooSkill / 100);
}

export function getRestaurantFoodRequirement(
  resource: number,
  size: number,
  selectedInCategory: number,
  isLuxury: boolean
): number {
  const coefficient = RESTAURANT_FOOD_CONSUMPTION[resource];
  if (!coefficient) throw new Error(`Resource #${resource} is not a restaurant dish`);
  const varietyIndex = clamp(Math.floor(selectedInCategory) - 1, 0, RESTAURANT_VARIETY_FACTORS.length - 1);
  const variety = RESTAURANT_VARIETY_FACTORS[varietyIndex];
  const seatsPerLevel = isLuxury ? LUXURY_SEATS_PER_LEVEL : ECONOMY_SEATS_PER_LEVEL;
  return Math.ceil(Math.max(1, Math.floor(Number(size) || 1)) * coefficient * variety * seatsPerLevel / ECONOMY_SEATS_PER_LEVEL);
}

export function getRestaurantFoodRequirements(menu: RestaurantMenuItem[], size: number, isLuxury: boolean): Array<{ item: RestaurantMenuItem; amount: number }> {
  const counts = new Map<string, number>();
  for (const item of menu) {
    const category = categoryForDish(item.resource);
    if (category) counts.set(category, (counts.get(category) || 0) + 1);
  }
  return menu.map(item => {
    const category = categoryForDish(item.resource);
    return {
      item,
      amount: getRestaurantFoodRequirement(item.resource, size, category ? counts.get(category) || 1 : 1, isLuxury)
    };
  });
}

export function computeRestaurantRating(input: {
  goodService: boolean;
  professionalStaff?: boolean;
  isLuxury?: boolean;
  menu: RestaurantMenuItem[];
  menuPrice?: number;
  cmoCommunicationPoints?: number;
  salesModifier?: number;
}): number {
  const menu = Array.isArray(input.menu) ? input.menu : [];
  const categoryCount = new Set(menu.map(item => categoryForDish(item.resource)).filter(Boolean)).size;
  if (menu.length === 0 || categoryCount < 3) return 0;
  const averageQuality = menu.reduce((sum, item) => sum + clamp(Number(item.quality) || 0, 0, 12), 0) / menu.length;
  const varietyScore = clamp(menu.length / RESTAURANT_DISHES.length, 0, 1) * 1.5;
  const qualityScore = clamp(averageQuality / 12, 0, 1) * 3;
  const serviceScore = input.goodService ? 2.5 : 1.25;
  const luxuryScore = input.isLuxury ? 0.5 : 0;
  const price = Number(input.menuPrice) || RESTAURANT_MENU_PRICE_MIN;
  const priceScore = price <= 96 ? 0.5 : clamp(0.5 - (price - 96) / 508, 0, 0.5);
  const communication = clamp(Number(input.cmoCommunicationPoints) || 0, 0, 100) * 0.01;
  const sales = Number(input.salesModifier) || 0;
  return round2(clamp(qualityScore + varietyScore + serviceScore + luxuryScore + priceScore + communication + sales, 0, RESTAURANT_RATING_MAX));
}

/** Numeric overload retains the old deterministic helper; object form models price and competition. */
export function computeRestaurantOccupancy(rating: number): number;
export function computeRestaurantOccupancy(input: {
  rating: number;
  menuPrice: number;
  marketGuests?: number;
  activeRestaurantSeats?: number;
  capacity?: number;
}): number;
export function computeRestaurantOccupancy(input: number | {
  rating: number;
  menuPrice: number;
  marketGuests?: number;
  activeRestaurantSeats?: number;
  capacity?: number;
}): number {
  if (typeof input === 'number') return round2(0.5 + clamp(input, 0, RESTAURANT_RATING_MAX) / RESTAURANT_RATING_MAX * 0.45);
  const rating = clamp(Number(input.rating) || 0, 0, RESTAURANT_RATING_MAX);
  const price = Number(input.menuPrice) || RESTAURANT_MENU_PRICE_MIN;
  if (price < RESTAURANT_MENU_PRICE_MIN || price > RESTAURANT_MENU_PRICE_MAX) return 0;
  const pricePenalty = Math.max(0, price - 96) / 500;
  const competition = input.activeRestaurantSeats && input.marketGuests
    ? clamp(input.activeRestaurantSeats / Math.max(1, input.marketGuests), 0, 0.55)
    : 0;
  return round2(clamp(0.08 + rating / RESTAURANT_RATING_MAX * 0.82 - pricePenalty - competition * 0.25, 0, 1));
}

function getRestaurantMarket(companyId: number, currentBuildingId: number): { marketGuests: number; activeRestaurantSeats: number } {
  const market = restaurantRepository.getRestaurantMarket(companyId, currentBuildingId);
  const activeRestaurantSeats = market.activeRestaurants.reduce((sum, b) => {
    const properties = getRestaurantProperties(b.id);
    return sum + (properties.keepOpen && properties.menu.length > 0 ? properties.seats : 0);
  }, 0);
  return {
    marketGuests: market.marketGuests,
    activeRestaurantSeats
  };
}

function getDefaultProperties(buildingId: number, size: number): RestaurantProperties {
  return {
    buildingId,
    goodService: false,
    isLuxury: false,
    professionalStaff: false,
    keepOpen: true,
    menu: [],
    menuPrice: RESTAURANT_MENU_PRICE_MIN,
    rating: 0,
    occupancy: 0,
    seats: getRestaurantSeats(size, false),
    lastCycleAt: null,
    reconstructionUntil: null
  };
}

export function getRestaurantProperties(buildingId: number, companyId?: number | null): RestaurantProperties {
  const row = restaurantRepository.findPropertyRow(buildingId, companyId);
  const building = getBuildingById(buildingId);
  const size = building?.size || 1;
  if (!row) return getDefaultProperties(buildingId, size);
  let menu: RestaurantMenuItem[] = [];
  try {
    menu = JSON.parse(row.menuJson || '[]');
  } catch {
    menu = [];
  }
  const menuPrice = row.menuPrice >= RESTAURANT_MENU_PRICE_MIN
    ? validateRestaurantMenuPrice(row.menuPrice)
    : RESTAURANT_MENU_PRICE_MIN;
  const goodService = row.goodService;
  return {
    buildingId,
    goodService,
    isLuxury: row.isLuxury,
    professionalStaff: row.professionalStaff || goodService,
    keepOpen: row.keepOpen,
    menu,
    menuPrice,
    rating: clamp(row.rating, 0, RESTAURANT_RATING_MAX),
    occupancy: clamp(row.occupancy, 0, 1),
    seats: getRestaurantSeats(size, row.isLuxury),
    lastCycleAt: row.lastCycleAt,
    reconstructionUntil: row.reconstructionUntil
  };
}

function getActiveRestaurantRunRow(buildingId: number, companyId?: number | null): RestaurantRunDbRow | undefined {
  return restaurantRepository.getActiveRunRow(buildingId, companyId) as RestaurantRunDbRow | undefined;
}

export function getRestaurantBusy(buildingId: number): Record<string, unknown> | null {
  const property = restaurantRepository.findReconstructionWindow(buildingId);
  const now = virtualClock.nowMs();
  if (property?.until && new Date(property.until).getTime() > now) {
    const started = property.startedAt || new Date(now).toISOString();
    const duration = Math.max(1, Math.round((new Date(property.until).getTime() - new Date(started).getTime()) / 1000));
    return {
      id: buildingId,
      started,
      duration,
      accelerationFactor: 1,
      category: 'b',
      expanding: true,
      reconstruction: true,
      canFetch: false
    };
  }
  const run = getActiveRestaurantRunRow(buildingId);
  if (run && run.cycle_end && new Date(run.cycle_end).getTime() > now) {
    return {
      id: run.id,
      started: run.cycle_start || run.datetime,
      duration: getRestaurantCycleSeconds(),
      accelerationFactor: 1,
      category: 'o',
      manualResolve: false,
      restaurant_open: true
    };
  }
  return null;
}

function toLegacyMenuItem(item: RestaurantMenuItem, menuPrice: number): LegacyRestaurantMenuItem {
  return {
    kind: item.resource,
    serving: normalizedQualityMode(item) === 'high' ? 'TOP' : 'BOTTOM',
    quality: item.quality,
    price: menuPrice
  };
}

function projectLegacyGroup(menu: RestaurantMenuItem[], kinds: number[], menuPrice: number): LegacyRestaurantMenuItem[] {
  return kinds
    .map(kind => menu.find(item => item.resource === kind))
    .filter((item): item is RestaurantMenuItem => item !== undefined)
    .map(item => toLegacyMenuItem(item, menuPrice));
}

export function getLegacyRestaurantProperties(buildingId: number, companyId?: number | null): LegacyRestaurantProperties {
  const props = getRestaurantProperties(buildingId, companyId);
  return {
    isLuxury: props.isLuxury,
    goodService: props.goodService,
    saladBar: projectLegacyGroup(props.menu, RESTAURANT_SALAD_BAR, props.menuPrice),
    mains: projectLegacyGroup(props.menu, RESTAURANT_MAINS, props.menuPrice),
    drinks: projectLegacyGroup(props.menu, RESTAURANT_DRINKS, props.menuPrice),
    menuPrice: props.menuPrice,
    keepOpen: props.keepOpen,
    rating: props.rating,
    occupancy: props.occupancy,
    seats: props.seats,
    professionalStaff: props.professionalStaff,
    lastCycleAt: props.lastCycleAt
  };
}

export function getLegacyRestaurantRun(run: RestaurantRun, properties: LegacyRestaurantProperties): Record<string, unknown> {
  return {
    id: run.id,
    datetime: run.datetime,
    rating: run.rating,
    newRating: run.newRating,
    occupied: run.occupied,
    capacity: run.capacity,
    occupancy: run.occupancy,
    revenue: run.revenue,
    wages: run.wages,
    cogs: run.foodCost,
    profit: run.profit,
    menuPrice: run.menuPrice || properties.menuPrice,
    review: run.review,
    resolved: run.resolved,
    cycleStart: run.cycleStart,
    cycleEnd: run.cycleEnd,
    prepared: run.prepared,
    served: run.served,
    spoiled: run.spoiled,
    foodCost: run.foodCost
  };
}

interface RestaurantRunDbRow {
  id: number;
  building_id: number;
  company_id: number;
  datetime: string;
  rating: number;
  new_rating: number | null;
  rating_before: number | null;
  rating_after: number | null;
  rating_delta: number | null;
  occupied: number | null;
  capacity: number;
  occupancy: number | null;
  revenue: number | null;
  cost: number;
  profit: number | null;
  menu_price: number | null;
  review: string | null;
  menu_json: string | null;
  good_service: number | null;
  is_luxury: number | null;
  resolved: number;
  cycle_start: string | null;
  cycle_end: string | null;
  prepared: number | null;
  served: number | null;
  spoiled: number | null;
  food_cost: number | null;
  wages: number | null;
}

function mapRunRow(row: RestaurantRunDbRow): RestaurantRun {
  const cycleStart = row.cycle_start || row.datetime;
  const cycleDurationMs = getRestaurantCycleSeconds() * 1000;
  const cycleEnd = row.cycle_end || new Date(new Date(cycleStart).getTime() + cycleDurationMs).toISOString();
  return {
    id: row.id,
    buildingId: row.building_id,
    datetime: row.datetime,
    rating: Number(row.rating) || 0,
    newRating: row.new_rating === null || row.new_rating === undefined ? null : Number(row.new_rating),
    occupied: row.occupied === null || row.occupied === undefined ? null : Number(row.occupied),
    capacity: Number(row.capacity) || 0,
    occupancy: row.occupancy === null || row.occupancy === undefined ? null : Number(row.occupancy),
    revenue: row.revenue === null || row.revenue === undefined ? null : Number(row.revenue),
    cost: Number(row.cost) || 0,
    profit: row.profit === null || row.profit === undefined ? null : Number(row.profit),
    menuPrice: Number(row.menu_price) || RESTAURANT_MENU_PRICE_MIN,
    review: row.review || '',
    resolved: Boolean(row.resolved),
    cycleStart,
    cycleEnd,
    prepared: Number(row.prepared) || 0,
    served: row.served === null || row.served === undefined ? null : Number(row.served),
    spoiled: row.spoiled === null || row.spoiled === undefined ? null : Number(row.spoiled),
    foodCost: Number(row.food_cost) || 0,
    wages: Number(row.wages) || 0
  };
}

function getAvailableAmount(companyId: number, kind: number, mode: RestaurantQualityMode, quality: number): number {
  return warehouseRepository.getAvailableAmount(companyId, kind, mode === 'exact' ? 'exact' : 'range', quality);
}

function consumeRestaurantResource(
  companyId: number,
  item: RestaurantMenuItem,
  amount: number
): { transactions: Array<{ kind: number; quality: number; amount: number; cost: number }>; totalCost: number } | null {
  const mode = normalizedQualityMode(item);
  const rows = warehouseRepository.listBatchesForConsumption(companyId, item.resource, mode, item.quality);
  const available = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  if (available + 1e-9 < amount) return null;
  let remaining = amount;
  let totalCost = 0;
  const transactions: Array<{ kind: number; quality: number; amount: number; cost: number }> = [];
  for (const row of rows) {
    if (remaining <= 0) break;
    const consumed = Math.min(remaining, Number(row.amount) || 0);
    const unitCost = Number(row.cost_workers || 0) + Number(row.cost_admin || 0) + Number(row.cost_material1 || 0) + Number(row.cost_material2 || 0) + Number(row.cost_market || 0);
    warehouseRepository.debitBatch(Number(row.id), consumed);
    transactions.push({ kind: item.resource, quality: Number(row.quality) || 0, amount: -consumed, cost: unitCost });
    totalCost += consumed * unitCost;
    remaining -= consumed;
  }
  return { transactions, totalCost: round2(totalCost) };
}

function computeCurrentRating(companyId: number, input: {
  goodService: boolean;
  isLuxury: boolean;
  menu: RestaurantMenuItem[];
  menuPrice: number;
}): number {
  const boost = getCompanyBoostSettings(companyId);
  return computeRestaurantRating({
    ...input,
    professionalStaff: input.goodService,
    cmoCommunicationPoints: getCmoCommunication(companyId),
    salesModifier: boost.salesModifier > 0 ? 0.02 : 0
  });
}

function canStartRestaurantCycle(buildingId: number, companyId: number): boolean {
  const building = getBuildingById(buildingId);
  if (!building || building.kind !== 'r' || building.company_id !== companyId) return false;
  if (building.busy_until && new Date(building.busy_until).getTime() > virtualClock.nowMs()) return false;
  const properties = getRestaurantProperties(buildingId, companyId);
  if (!properties.keepOpen) return false;
  if (getActiveRestaurantRunRow(buildingId, companyId)) return false;
  try {
    validateRestaurantMenuForCycle(properties.menu);
  } catch {
    return false;
  }
  return true;
}

interface StartCycleResult {
  building: BuildingDbRow | null;
  run: RestaurantRun;
  resourceTransactions: Array<{ kind: number; quality: number; amount: number }>;
  moneyUpdate: number;
}

function startRestaurantCycleInTransaction(buildingId: number, companyId: number, startAt: Date = virtualClock.now()): StartCycleResult {
  const building = getBuildingById(buildingId);
  if (!building || building.kind !== 'r' || building.company_id !== companyId) throw new Error('Restaurant not found');
  if (building.busy_until && new Date(building.busy_until).getTime() > virtualClock.nowMs()) throw new Error('Restaurant is busy');
  const properties = getRestaurantProperties(buildingId, companyId);
  if (!properties.keepOpen) throw new Error('Restaurant is closed and cannot start a new cycle');
  if (getActiveRestaurantRunRow(buildingId, companyId)) throw new Error('Restaurant already has an active cycle');
  validateRestaurantMenuForCycle(properties.menu);

  const requirements = getRestaurantFoodRequirements(properties.menu, building.size, properties.isLuxury);
  for (const requirement of requirements) {
    const mode = normalizedQualityMode(requirement.item);
    if (getAvailableAmount(companyId, requirement.item.resource, mode, requirement.item.quality) < requirement.amount) {
      throw new Error(`Insufficient restaurant food: need ${requirement.amount} of resource #${requirement.item.resource}`);
    }
  }

  const resourceTransactions: Array<{ kind: number; quality: number; amount: number }> = [];
  let foodCost = 0;
  let prepared = 0;
  for (const requirement of requirements) {
    const result = consumeRestaurantResource(companyId, requirement.item, requirement.amount);
    if (!result) throw new Error(`Restaurant food changed while loading resource #${requirement.item.resource}`);
    foodCost += result.totalCost;
    prepared += requirement.amount;
    const grouped = new Map<number, number>();
    for (const transaction of result.transactions) grouped.set(transaction.quality, (grouped.get(transaction.quality) || 0) + Math.abs(transaction.amount));
    for (const [quality, amount] of grouped) resourceTransactions.push({ kind: requirement.item.resource, quality, amount: -amount });
  }
  foodCost = round2(foodCost);
  const wages = computeRestaurantWages({
    size: building.size,
    isLuxury: properties.isLuxury,
    goodService: properties.goodService,
    administrationOverhead: getAdministrationOverhead(companyId)
  });
  const cost = round2(foodCost + wages);
  updateCompanyMoney(companyId, -cost);

  const cycleStart = startAt.toISOString();
  const cycleDurationMs = getRestaurantCycleSeconds() * 1000;
  const cycleEnd = new Date(startAt.getTime() + cycleDurationMs).toISOString();
  const runId = restaurantRepository.insertRun([
    buildingId,
    companyId,
    cycleStart,
    properties.rating,
    properties.rating,
    properties.seats,
    cost,
    properties.menuPrice,
    JSON.stringify(properties.menu),
    properties.goodService ? 1 : 0,
    properties.isLuxury ? 1 : 0,
    cycleStart,
    cycleEnd,
    prepared,
    foodCost,
    wages
  ]);
  restaurantRepository.touchLastCycle(buildingId, cycleStart);
  const run = mapRunRow(restaurantRepository.findRunRow(runId) as RestaurantRunDbRow);
  return { building: getBuildingById(buildingId), run, resourceTransactions, moneyUpdate: -cost };
}

function settleRestaurantRunInTransaction(runId: number, now: Date): { run: RestaurantRun; nextCycle: RestaurantRun | null; moneyUpdate: number } {
  const row = restaurantRepository.findRunRow(runId) as RestaurantRunDbRow | undefined;
  if (!row) throw new Error('Restaurant run not found');
  if (row.resolved) return { run: mapRunRow(row), nextCycle: null, moneyUpdate: 0 };
  const end = new Date(row.cycle_end || row.datetime).getTime();
  if (end > now.getTime()) throw new Error('Restaurant cycle has not ended');
  let menu: RestaurantMenuItem[] = [];
  try {
    menu = JSON.parse(row.menu_json || '[]');
  } catch {
    menu = [];
  }
  const building = getBuildingById(row.building_id);
  const properties = getRestaurantProperties(row.building_id, row.company_id);
  const market = getRestaurantMarket(row.company_id, row.building_id);
  const demandOccupancy = computeRestaurantOccupancy({
    rating: row.rating,
    menuPrice: Number(row.menu_price) || properties.menuPrice,
    marketGuests: market.marketGuests,
    activeRestaurantSeats: market.activeRestaurantSeats
  });
  const capacity = Number(row.capacity) || properties.seats;
  const prepared = Number(row.prepared) || 0;
  const served = Math.min(prepared, Math.floor(capacity * demandOccupancy));
  const spoiled = prepared - served;
  const menuPrice = Number(row.menu_price) || properties.menuPrice;
  const revenue = round2(served * menuPrice);
  const cost = Number(row.cost) || 0;
  const profit = round2(revenue - cost);
  let newRating = computeCurrentRating(row.company_id, {
    goodService: row.good_service === null ? properties.goodService : Boolean(row.good_service),
    isLuxury: row.is_luxury === null ? properties.isLuxury : Boolean(row.is_luxury),
    menu,
    menuPrice
  });
  if (!properties.keepOpen && newRating > 0) {
    newRating = round2(newRating * 0.875);
  }
  const ratingDelta = round2(newRating - Number(row.rating || 0));
  restaurantRepository.resolveRun(runId, {
    ratingBefore: Number(row.rating),
    ratingAfter: newRating,
    ratingDelta,
    newRating,
    served,
    occupancy: demandOccupancy,
    revenue,
    profit,
    spoiled,
    review: `Restaurant served ${served} guests`
  });
  if (revenue !== 0) updateCompanyMoney(row.company_id, revenue);
  restaurantRepository.updateRatingOccupancy(row.building_id, newRating, demandOccupancy);
  const resolved = mapRunRow(restaurantRepository.findRunRow(runId) as RestaurantRunDbRow);
  let nextCycle: RestaurantRun | null = null;
  if (properties.keepOpen && canStartRestaurantCycle(row.building_id, row.company_id)) {
    try {
      nextCycle = startRestaurantCycleInTransaction(row.building_id, row.company_id, new Date(end));
    } catch {
      // A cycle can settle successfully even if the warehouse cannot fund the
      // following cycle. The restaurant remains open for a later retry.
    }
  }
  return { run: resolved, nextCycle, moneyUpdate: revenue };
}

export async function resolveRestaurantRun(runId: number, now: Date = virtualClock.now()): Promise<{ run: RestaurantRun; nextCycle: RestaurantRun | null; moneyUpdate: number }> {
  return runInTransaction(() => settleRestaurantRunInTransaction(runId, now), { immediate: true });
}

export function resolveDueRestaurantRunsSync(buildingId?: number, companyId?: number | null, now: Date = virtualClock.now()): void {
  runInTransaction(() => {
    for (const runId of restaurantRepository.listDueRunIds(now.toISOString(), buildingId, companyId)) {
      settleRestaurantRunInTransaction(runId, now);
    }
  }, { immediate: true });
}

export async function resolveDueRestaurantRuns(buildingId?: number, companyId?: number | null, now: Date = virtualClock.now()): Promise<void> {
  resolveDueRestaurantRunsSync(buildingId, companyId, now);
}
export async function getRestaurantRuns(buildingId: number, companyId?: number | null): Promise<RestaurantRun[]> {
  await resolveDueRestaurantRuns(buildingId, companyId);
  const rows = restaurantRepository.listRecentRunRows(buildingId, companyId) as RestaurantRunDbRow[];
  return rows.map(mapRunRow);
}

export async function executeRestaurantRun(buildingId: number, companyId: number): Promise<StartCycleResult> {
  await resolveDueRestaurantRuns(buildingId, companyId);
  return runInTransaction(() => startRestaurantCycleInTransaction(buildingId, companyId), { immediate: true });
}

export async function updateRestaurantProperties(
  buildingId: number,
  companyId: number,
  updates: Partial<{
    goodService: boolean;
    isLuxury: boolean;
    professionalStaff: boolean;
    keepOpen: boolean;
    menu: RestaurantMenuItem[];
    menuPrice: number;
  }>
): Promise<{
  building: BuildingDbRow | null;
  restaurantProperties: RestaurantProperties;
  moneyUpdate: number;
  cycle: RestaurantRun | null;
  resourceTransactions: Array<{ kind: number; quality: number; amount: number }>;
}> {
  return runInTransaction(() => {
    const building = getBuildingById(buildingId);
    if (!building || building.kind !== 'r' || building.company_id !== companyId) throw new Error('Restaurant not found');
    const current = getRestaurantProperties(buildingId, companyId);
    const goodService = updates.goodService !== undefined
      ? Boolean(updates.goodService)
      : updates.professionalStaff !== undefined ? Boolean(updates.professionalStaff) : current.goodService;
    const isLuxury = updates.isLuxury !== undefined ? Boolean(updates.isLuxury) : current.isLuxury;
    const keepOpen = updates.keepOpen !== undefined ? Boolean(updates.keepOpen) : current.keepOpen;
    const menu = updates.menu !== undefined ? updates.menu : current.menu;
    const menuPrice = updates.menuPrice !== undefined ? validateRestaurantMenuPrice(updates.menuPrice) : current.menuPrice;
    validateRestaurantMenu(menu);

    const styleChanged = isLuxury !== current.isLuxury;
    const busy = getRestaurantBusy(buildingId);
    if (styleChanged && busy) throw new Error('Restaurant cannot change style while it is busy or operating');
    let moneyUpdate = 0;
    let reconstructionStartedAt = current.reconstructionUntil && new Date(current.reconstructionUntil).getTime() > virtualClock.nowMs()
      ? virtualClock.nowIso()
      : null;
    let reconstructionUntil = current.reconstructionUntil && new Date(current.reconstructionUntil).getTime() > virtualClock.nowMs()
      ? current.reconstructionUntil
      : null;
    if (styleChanged) {
      const reconstructionCost = Math.ceil(RESTAURANT_COST_UNITS * 10 * AVERAGE_SALARY * building.size / 2);
      updateCompanyMoney(companyId, -reconstructionCost);
      moneyUpdate -= reconstructionCost;
      reconstructionStartedAt = virtualClock.nowIso();
      reconstructionUntil = new Date(virtualClock.nowMs() + building.size * RESTAURANT_RECONSTRUCTION_SECONDS * 1000).toISOString();
      buildingRepository.updateBusyUntil(buildingId, companyId, reconstructionUntil);
    }
    const activeRun = getActiveRestaurantRunRow(buildingId, companyId);
    const rating = current.rating;
    restaurantRepository.upsertProperties({
      buildingId,
      companyId,
      goodService,
      isLuxury,
      keepOpen,
      menuJson: JSON.stringify(menu),
      menuPrice,
      rating,
      occupancy: current.occupancy,
      professionalStaff: goodService,
      lastCycleAt: current.lastCycleAt,
      reconstructionStartedAt,
      reconstructionUntil,
      ratingPenaltyApplied: false
    });
    let cycle: RestaurantRun | null = null;
    let resourceTransactions: Array<{ kind: number; quality: number; amount: number }> = [];
    // The official PATCH endpoint starts a cycle only when keepOpen=true is
    // explicitly sent. Saving a menu or changing price alone is side-effect free.
    // The official PATCH endpoint starts a cycle when keepOpen=true is
    // explicitly sent and no cycle is already in progress.
    // If a cycle is already active, keepOpen=true cancels the scheduled closure
    // and resumes continuous operation without attempting a redundant second cycle.
    if (updates.keepOpen === true && !styleChanged && !activeRun) {
      try {
        const started = startRestaurantCycleInTransaction(buildingId, companyId);
        cycle = started.run;
        resourceTransactions = started.resourceTransactions;
        moneyUpdate += started.moneyUpdate;
      } catch (error) {
        // An explicit keepOpen=true is an instruction to begin the next
        // cycle; surface stock/validation errors instead of claiming success.
        throw error;
      }
    }
    return {
      building: getBuildingById(buildingId),
      restaurantProperties: getRestaurantProperties(buildingId, companyId),
      moneyUpdate,
      cycle,
      resourceTransactions
    };
  }, { immediate: true });
}

export function getRestaurantMenuGuide(): Array<{ kind: number; name: string; category: string; suggestedPrice: number; image: string }> {
  return RESTAURANT_DISHES.map(kind => {
    const def = getResourceDef(kind);
    const category = categoryForDish(kind) === 'saladBar' ? 'Salad bar' : categoryForDish(kind) === 'mains' ? 'Mains' : 'Drinks';
    return {
      kind,
      name: RESTAURANT_DISH_NAMES[kind] || def?.name || `Dish #${kind}`,
      category,
      suggestedPrice: RESTAURANT_MENU_PRICE_MIN,
      image: def?.image || 'images/resources/hamburger.png'
    };
  });
}

export function getRestaurantRatings(buildingId?: number): {
  overallRating: number;
  foodRating: number;
  serviceRating: number;
  ambianceRating: number;
  totalReviews: number;
} {
  const props = buildingId ? getRestaurantProperties(buildingId) : null;
  const rating = props?.rating || 0;
  const totalReviews = buildingId ? restaurantRepository.countResolvedRuns(buildingId) : 0;
  return {
    overallRating: rating,
    foodRating: round2(rating),
    serviceRating: props ? (props.goodService ? 10 : 5) : 0,
    ambianceRating: props ? (props.isLuxury ? 10 : 7) : 0,
    totalReviews
  };
}
