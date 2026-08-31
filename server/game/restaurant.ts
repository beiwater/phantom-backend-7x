import { db } from '../db/database.ts';
import { getBuildingById, type BuildingDbRow } from './buildings.ts';
import { updateCompanyMoney } from './company.ts';
import { consumeResource } from './warehouse.ts';
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

export interface RestaurantMenuItem {
  resource: number;
  quality: number;
  price: number;
}

export interface RestaurantProperties {
  buildingId: number;
  goodService: boolean;
  isLuxury: boolean;
  keepOpen: boolean;
  menu: RestaurantMenuItem[];
  rating: number;
  occupancy: number;
  seats: number;
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

export function getRestaurantProperties(buildingId: number, companyId?: number | null): RestaurantProperties {
  const row = db.prepare('SELECT * FROM restaurant_properties WHERE building_id = ?').get(buildingId) as {
    building_id: number;
    company_id: number;
    good_service: number;
    is_luxury: number;
    keep_open: number;
    menu_json: string;
    rating: number;
    occupancy: number;
  } | undefined;

  const building = getBuildingById(buildingId);
  const size = building?.size || 1;
  const isLuxury = Boolean(row ? row.is_luxury : 0);
  const seats = Math.floor(size * (isLuxury ? 60 : 100));

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
      keepOpen: Boolean(row.keep_open),
      menu,
      rating: row.rating,
      occupancy: row.occupancy,
      seats
    };
  }

  // Default menu
  const defaultMenu: RestaurantMenuItem[] = [
    { resource: 119, quality: 0, price: 18.5 }, // Hamburger
    { resource: 129, quality: 0, price: 12.0 }, // Salad
    { resource: 132, quality: 0, price: 6.5 },  // Coffee
    { resource: 142, quality: 0, price: 8.0 }   // Orange Juice
  ];

  return {
    buildingId,
    goodService: true,
    isLuxury: false,
    keepOpen: true,
    menu: defaultMenu,
    rating: 4.2,
    occupancy: 0.85,
    seats
  };
}

export function updateRestaurantProperties(
  buildingId: number,
  companyId: number,
  updates: Partial<{
    goodService: boolean;
    isLuxury: boolean;
    keepOpen: boolean;
    menu: RestaurantMenuItem[];
  }>
): { building: BuildingDbRow | null; restaurantProperties: RestaurantProperties } {
  const current = getRestaurantProperties(buildingId, companyId);
  const goodService = updates.goodService !== undefined ? updates.goodService : current.goodService;
  const isLuxury = updates.isLuxury !== undefined ? updates.isLuxury : current.isLuxury;
  const keepOpen = updates.keepOpen !== undefined ? updates.keepOpen : current.keepOpen;
  const menu = updates.menu !== undefined ? updates.menu : current.menu;

  // Rating and Occupancy formula based on menu & service
  let baseRating = 3.5;
  if (goodService) baseRating += 0.8;
  if (isLuxury) baseRating += 0.4;
  if (menu.length >= 4) baseRating += 0.3;
  const rating = Math.min(5.0, Math.round(baseRating * 10) / 10);
  const occupancy = Math.min(1.0, Math.round((0.6 + (rating / 5.0) * 0.35) * 100) / 100);

  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO restaurant_properties (building_id, company_id, good_service, is_luxury, keep_open, menu_json, rating, occupancy, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(building_id) DO UPDATE SET
      good_service = excluded.good_service,
      is_luxury = excluded.is_luxury,
      keep_open = excluded.keep_open,
      menu_json = excluded.menu_json,
      rating = excluded.rating,
      occupancy = excluded.occupancy,
      updated_at = excluded.updated_at
  `).run(
    buildingId,
    companyId,
    goodService ? 1 : 0,
    isLuxury ? 1 : 0,
    keepOpen ? 1 : 0,
    JSON.stringify(menu),
    rating,
    occupancy,
    now
  );

  const building = getBuildingById(buildingId);
  const updatedProps = getRestaurantProperties(buildingId, companyId);

  return {
    building,
    restaurantProperties: updatedProps
  };
}

export function getRestaurantRuns(buildingId: number, companyId?: number | null): RestaurantRun[] {
  let runs = db.prepare(`
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
  }>;

  // Seed sample historic runs if empty
  if (runs.length === 0) {
    const props = getRestaurantProperties(buildingId, companyId);
    const capacity = props.seats;
    const now = Date.now();

    for (let i = 5; i >= 1; i--) {
      const runTime = new Date(now - i * 12 * 3600 * 1000).toISOString();
      const occupied = Math.floor(capacity * (props.occupancy - 0.05 + Math.random() * 0.1));
      const avgCheck = props.isLuxury ? 48 : 22;
      const revenue = Math.round(occupied * avgCheck * 100) / 100;
      const cost = Math.round((revenue * 0.45 + (props.goodService ? 300 : 150)) * 100) / 100;
      const profit = Math.round((revenue - cost) * 100) / 100;

      db.prepare(`
        INSERT INTO restaurant_runs (building_id, company_id, datetime, rating, occupied, capacity, revenue, cost, profit, resolved)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `).run(buildingId, companyId || 1, runTime, props.rating, occupied, capacity, revenue, cost, profit);
    }

    runs = db.prepare(`
      SELECT * FROM restaurant_runs
      WHERE building_id = ?
      ORDER BY id DESC
      LIMIT 30
    `).all(buildingId) as typeof runs;
  }

  return runs.map(r => ({
    id: r.id,
    buildingId: r.building_id,
    datetime: r.datetime,
    rating: r.rating,
    occupied: r.occupied,
    capacity: r.capacity,
    revenue: r.revenue,
    cost: r.cost,
    profit: r.profit,
    resolved: Boolean(r.resolved)
  }));
}

export function executeRestaurantRun(
  buildingId: number,
  companyId: number
): {
  building: BuildingDbRow | null;
  run: RestaurantRun;
  resourceTransactions: Array<{ kind: number; quality: number; amount: number }>;
  moneyUpdate: number;
} {
  const props = getRestaurantProperties(buildingId, companyId);
  const capacity = props.seats;
  const occupied = Math.floor(capacity * (0.8 + Math.random() * 0.18));
  
  // Calculate revenue from menu prices
  let avgDishPrice = 20;
  if (props.menu.length > 0) {
    const sum = props.menu.reduce((acc, item) => acc + (item.price || 20), 0);
    avgDishPrice = sum / props.menu.length;
  }
  if (props.isLuxury) avgDishPrice *= 1.5;

  const revenue = Math.round(occupied * avgDishPrice * 100) / 100;
  const foodCost = Math.round(revenue * 0.38 * 100) / 100;
  const staffCost = props.goodService ? 450 : 200;
  const cost = Math.round((foodCost + staffCost) * 100) / 100;
  const profit = Math.round((revenue - cost) * 100) / 100;

  // Consume a small portion of actual menu items from warehouse if available
  const resourceTransactions: Array<{ kind: number; quality: number; amount: number }> = [];
  for (const item of props.menu) {
    const needed = Math.ceil(occupied / Math.max(1, props.menu.length));
    if (consumeResource(companyId, item.resource, item.quality, needed)) {
      resourceTransactions.push({ kind: item.resource, quality: item.quality, amount: -needed });
    }
  }

  // Update company money
  updateCompanyMoney(companyId, profit);

  const now = new Date().toISOString();
  const insertRes = db.prepare(`
    INSERT INTO restaurant_runs (building_id, company_id, datetime, rating, occupied, capacity, revenue, cost, profit, resolved)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(buildingId, companyId, now, props.rating, occupied, capacity, revenue, cost, profit);

  const run: RestaurantRun = {
    id: Number(insertRes.lastInsertRowid),
    buildingId,
    datetime: now,
    rating: props.rating,
    occupied,
    capacity,
    revenue,
    cost,
    profit,
    resolved: true
  };

  const building = getBuildingById(buildingId);

  return {
    building,
    run,
    resourceTransactions,
    moneyUpdate: profit
  };
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
      name: def?.name || `Dish #${kind}`,
      category: kind >= 124 && kind <= 126 ? 'Drinks' : (kind >= 142 ? 'Desserts & Juices' : 'Main Courses'),
      suggestedPrice: Math.round(((def?.cost || 10) * 1.6) * 100) / 100,
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
  const rating = props?.rating || 4.5;
  return {
    overallRating: rating,
    foodRating: Math.min(5.0, rating + 0.2),
    serviceRating: props?.goodService ? 4.8 : 3.8,
    ambianceRating: props?.isLuxury ? 4.9 : 4.1,
    totalReviews: 128
  };
}
