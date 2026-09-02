import { db } from '../db/database.ts';
import {
  CONSTANTS_BUILDINGS,
  CONSTRUCTION_MATERIALS,
  DEMOLITION_REFUND_RATE,
  getResourceDef
} from './constants.ts';
import { getWarehouseItemExact, consumeResourceExactWithTransactions } from './warehouse.ts';
import { updateCompanyMoney, getCompanyById } from './company.ts';
import { extraSlotIndex } from '../domain/buildings/building-rules.ts';

export interface BuildingRow {
  id: number;
  company_id: number;
  position: string;
  kind: string;
  size: number;
  name: string;
  cost: number;
  category: string;
  created_at: string;
  busy_until: string | null;
  abundance?: number | null;
  original_abundance?: number | null;
}

interface ProductionQueueBusyRow {
  id: number;
  kind: number;
  quality: number;
  amount: number;
  duration_seconds: number;
  started_at: string;
  finishes_at: string;
}

function getProductionBusy(buildingId: number) {
  const queue = db.prepare(`
    SELECT id, kind, quality, amount, duration_seconds, started_at, finishes_at
    FROM production_queues
    WHERE building_id = ? AND resolved = 0
    ORDER BY id DESC
    LIMIT 1
  `).get(buildingId) as ProductionQueueBusyRow | undefined;

  if (!queue) return null;

  const resource = getResourceDef(queue.kind);
  const canFetch = new Date(queue.finishes_at).getTime() <= Date.now();

  return {
    id: queue.id,
    started: queue.started_at,
    duration: Number(queue.duration_seconds),
    accelerationFactor: 1,
    category: 'r',
    canFetch,
    manualResolve: false,
    resource: {
      kind: queue.kind,
      quality: Number(queue.quality) || 0,
      amount: Number(queue.amount),
      amountAvailableNow: canFetch ? Number(queue.amount) : 0,
      image: resource?.image || ''
    }
  };
}

interface RetailOrderBusyRow {
  id: number;
  resource_kind: number;
  quality: number;
  units: number;
  unit_price: number;
  finished_at: string | null;
  created_at: string;
}

/**
 * Issue #142: an in-flight retail sale occupies the building's busy_until
 * window just like construction/production, but the original frontend reads
 * busy.category === 's' (Ai.SELLING) plus busy.sales_order to render the
 * "selling" state. Without this mapper the backend fell through to the
 * EXPANDING ("b") object and the UI mislabeled a selling store as
 * "upgrading", locking normal building actions.
 */
function getRetailBusy(buildingId: number) {
  const row = db.prepare(`
    SELECT id, resource_kind, quality, units, unit_price, finished_at, created_at
    FROM retail_orders
    WHERE building_id = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(buildingId) as RetailOrderBusyRow | undefined;

  if (!row) return null;

  const finishedAtMs = row.finished_at ? new Date(row.finished_at).getTime() : 0;
  const canFetch = finishedAtMs > 0 && finishedAtMs <= Date.now();
  const resource = getResourceDef(Number(row.resource_kind));
  const revenue = Math.round(Number(row.units) * Number(row.unit_price) * 100) / 100;
  const startedMs = new Date(row.created_at).getTime();
  const durationSeconds = finishedAtMs > 0
    ? Math.max(1, Math.round((finishedAtMs - startedMs) / 1000))
    : 0;

  return {
    id: Number(row.id),
    started: row.created_at,
    duration: durationSeconds,
    category: 's',
    canFetch,
    sales_order: {
      id: Number(row.id),
      image: resource?.image || '',
      name: resource?.name || `Resource #${row.resource_kind}`,
      amount: Number(row.units),
      price: Number(row.unit_price),
      quality: Number(row.quality) || 0,
      remainingProfit: revenue,
      profitAvailableNow: canFetch ? revenue : 0
    }
  };
}

const BUILDING_NAMES: Record<string, string> = {
  P: 'Farm',
  G: 'Grocery store',
  E: 'Power plant',
  W: 'Water reservoir',
  M: 'Mine',
  Q: 'Quarry',
  F: 'Plantation',
  '6': 'Beverage factory',
  T: 'Fashion factory',
  v: 'Forest nursery',
  e: 'Slaughterhouse',
  i: 'Mill',
  j: 'Bakery',
  Y: 'Materials processing',
  g: 'General contractor',
  '8': 'Shipping depot',
  '1': 'Concrete plant',
  O: 'Oil rig',
  R: 'Refinery',
  S: 'Gas station',
  C: 'Car dealership',
  H: 'Hardware store'
};

export function getBuildingMeta(kind: string) {
  const b = CONSTANTS_BUILDINGS[kind] as { name?: string; costUnits?: number; category?: string } | undefined;
  const name = b?.name || BUILDING_NAMES[kind] || 'Building';
  const cost = b ? ((b.costUnits || 2) * 3450) : 6900;
  const category = b?.category || 'production';
  return { name, cost, category };
}

export function formatBuilding(b: BuildingRow) {
  const meta = getBuildingMeta(b.kind);
  const busyUntilMs = b.busy_until ? new Date(b.busy_until).getTime() : 0;
  const isConstructingOrUpgrading = busyUntilMs > Date.now();

  // Issue #142: prefer the production queue, then an active retail sale
  // (SELLING state), and only fall back to the EXPANDING object when the
  // busy window is genuinely a construction/upgrade.
  let busyObj: Record<string, unknown> | null = getProductionBusy(b.id);
  if (!busyObj && isConstructingOrUpgrading) {
    busyObj = getRetailBusy(b.id);
  }
  if (!busyObj && isConstructingOrUpgrading) {
    const duration = 10;
    const startedMs = busyUntilMs - duration * 1000;
    busyObj = {
      id: b.id,
      started: new Date(startedMs).toISOString(),
      duration,
      category: 'b',
      expanding: true,
      canFetch: false
    };
  }

  return {
    id: b.id,
    busy: busyObj,
    category: b.category || meta.category || 'production',
    company: {
      id: b.company_id,
      name: "Private Co",
      logo: ""
    },
    cost: b.cost || meta.cost || 6900,
    costUnits: 2,
    country: "AU",
    created: b.created_at || new Date().toISOString(),
    isUnderConstruction: isConstructingOrUpgrading,
    kind: b.kind,
    level: b.size || 1,
    name: b.name || meta.name || 'Building',
    position: String(b.position),
    realm: 0,
    size: b.size || 1,
    workers: (b.size || 1) * 10
  };
}

export function getCompanyBuildings(companyId: number) {
  const rows = db.prepare(`
    SELECT * FROM buildings WHERE company_id = ? ORDER BY CAST(position AS INTEGER) ASC
  `).all(companyId) as unknown as BuildingRow[];

  return rows.map(formatBuilding);
}

export function getBuildingById(buildingId: number): BuildingRow | null {
  const row = db.prepare(`
    SELECT * FROM buildings WHERE id = ?
  `).get(buildingId) as unknown as BuildingRow | undefined;
  return row || null;
}

export function getConstructionMaterials(sizeUnits: number): Array<{ kind: number; amount: number }> {
  return CONSTRUCTION_MATERIALS.map(m => ({ kind: m.kind, amount: m.perUnit * sizeUnits }));
}
function validateConstructionMaterials(companyId: number, sizeUnits: number) {
  const materials = getConstructionMaterials(sizeUnits);
  for (const req of materials) {
    const stock = getWarehouseItemExact(companyId, req.kind, 0);
    if (!stock || Number(stock.amount) < req.amount) {
      throw new Error(`Insufficient construction materials: need ${req.amount} of resource #${req.kind}`);
    }
  }
  return materials;
}
// ---------------------------------------------------------------------------
// Issue #93: natural resource abundance
//
// Extractor buildings (Mine 'M', Quarry 'Q', Oil Rig 'O') sit on a natural
// resource deposit whose richness ("abundance", stored as a percentage) is
// rolled once at construction time from a clamped Gaussian and then decays
// slowly as the deposit is worked.
// ---------------------------------------------------------------------------

/** Building kinds that extract natural resources and therefore carry abundance. */
export const ABUNDANCE_EXTRACTOR_KINDS: Record<string, true> = { M: true, Q: true, O: true };

const ABUNDANCE_ROLL_MEAN = 0.85;
const ABUNDANCE_ROLL_STD_DEV = 0.15;
const ABUNDANCE_FRACTION_MIN = 0.5;
const ABUNDANCE_FRACTION_MAX = 1.0;
/** 0.032% of the current abundance lost per completed production cycle (day). */
export const ABUNDANCE_DECAY_PER_CYCLE = 0.00032;

export function isAbundanceExtractorKind(kind: string): boolean {
  return Boolean(ABUNDANCE_EXTRACTOR_KINDS[kind]);
}

function gaussianRandom(mean: number, stdDev: number): number {
  let u1 = Math.random();
  while (u1 <= Number.EPSILON) {
    u1 = Math.random(); // log(0) is undefined; resample
  }
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + stdDev * z;
}

/**
 * One abundance roll: clamp(Gaussian(0.85, 0.15), 0.5, 1.0) * 100, rounded to
 * two decimals for clean storage. Always within [50, 100].
 */
export function rollAbundancePercent(): number {
  const fraction = Math.min(
    ABUNDANCE_FRACTION_MAX,
    Math.max(ABUNDANCE_FRACTION_MIN, gaussianRandom(ABUNDANCE_ROLL_MEAN, ABUNDANCE_ROLL_STD_DEV))
  );
  return Math.round(fraction * 100 * 100) / 100;
}

export interface AbundanceValues {
  abundance: number;
  originalAbundance: number;
}

/** Initial abundance pair for a new building: a fresh roll for extractors, a fully rich deposit otherwise. */
export function initialAbundanceForKind(kind: string): AbundanceValues {
  if (!isAbundanceExtractorKind(kind)) {
    return { abundance: 100, originalAbundance: 100 };
  }
  const rolled = rollAbundancePercent();
  return { abundance: rolled, originalAbundance: rolled };
}

/** Linear output scaling for natural resource extractors. */
export function scaleExtractorOutput(baseAmount: number, abundance: number): number {
  return Math.round(baseAmount * abundance / 100);
}

/** Multiplicative decay: abundance *= (1 - 0.032%)^cycles, floored at 0. */
export function decayAbundance(abundance: number, cycles: number = 1): number {
  if (!Number.isFinite(abundance) || abundance <= 0) return 0;
  return Math.max(0, abundance * Math.pow(1 - ABUNDANCE_DECAY_PER_CYCLE, cycles));
}

export function getBuildingAbundance(buildingId: number): AbundanceValues | null {
  const row = db.prepare(
    'SELECT abundance, original_abundance FROM buildings WHERE id = ?'
  ).get(buildingId) as { abundance: number | null; original_abundance: number | null } | undefined;
  if (!row) return null;
  const abundance = row.abundance === null || row.abundance === undefined ? 100 : Number(row.abundance);
  const original = row.original_abundance === null || row.original_abundance === undefined ? abundance : Number(row.original_abundance);
  return { abundance, originalAbundance: original };
}

/**
 * Re-prospect a deposit: roll a fresh abundance and reset the original
 * abundance to the same value. Single UPDATE — atomic on its own.
 */
export function prospectBuildingAbundance(buildingId: number): AbundanceValues {
  const rolled = rollAbundancePercent();
  db.prepare(
    'UPDATE buildings SET abundance = ?, original_abundance = ? WHERE id = ?'
  ).run(rolled, rolled, buildingId);
  return { abundance: rolled, originalAbundance: rolled };
}

/**
 * Apply one production-cycle (day) of decay to a natural resource extractor's
 * deposit and persist it. Non-extractor buildings and missing buildings are
 * no-ops (returns null). Returns the new abundance otherwise.
 */
export function applyAbundanceCycleDecay(buildingId: number): number | null {
  const row = db.prepare(
    'SELECT kind, abundance FROM buildings WHERE id = ?'
  ).get(buildingId) as { kind: string; abundance: number | null } | undefined;
  if (!row || !isAbundanceExtractorKind(String(row.kind))) return null;
  const decayed = decayAbundance(row.abundance === null || row.abundance === undefined ? 100 : Number(row.abundance));
  db.prepare('UPDATE buildings SET abundance = ? WHERE id = ?').run(decayed, buildingId);
  return decayed;
}


export function constructBuilding(companyId: number, kind: string, position: string, replaceExisting = false) {
  const meta = getBuildingMeta(kind);
  if (!BUILDING_NAMES[kind] && !CONSTANTS_BUILDINGS[kind]) {
    throw new Error(`Unknown building kind: ${kind}`);
  }
  const comp = getCompanyById(companyId);
  if (!comp || comp.money < meta.cost) {
    throw new Error('Not enough money to construct building');
  }

  const baseSlots = Math.min(14, 4 + Math.floor((Number(comp.level) || 0) / 3));
  const maxSlots = baseSlots + (Number(comp.extra_building_slots) || 0);
  // P0-07: "B<n>" lots are star-unlocked slots, unlocked when n < extra_building_slots.
  const extraIndex = extraSlotIndex(String(position));
  if (extraIndex !== null) {
    if (extraIndex >= (Number(comp.extra_building_slots) || 0)) {
      throw new Error(`Position ${position} is locked. You currently have ${maxSlots} slots unlocked. Unlock more building slots with SimBoosts.`);
    }
  } else {
    const posNum = Number(String(position));
    if (Number.isInteger(posNum) && posNum >= maxSlots) {
      throw new Error(`Position ${position} is locked. You currently have ${maxSlots} slots unlocked. Unlock more building slots with SimBoosts.`);
    }
  }

  const currentCount = (db.prepare('SELECT COUNT(*) as count FROM buildings WHERE company_id = ?').get(companyId) as { count: number }).count;
  const existing = db.prepare(`
    SELECT id, busy_until FROM buildings WHERE company_id = ? AND position = ?
  `).get(companyId, String(position)) as { id: number; busy_until: string | null } | undefined;

  if (!existing && currentCount >= maxSlots) {
    throw new Error(`Building slot limit reached (${currentCount}/${maxSlots}). Unlock more building slots with SimBoosts.`);
  }

  const materials = validateConstructionMaterials(companyId, 1);
  if (existing) {
    if (!replaceExisting) {
      throw new Error('Building position is already occupied');
    }
    const pending = db.prepare(`
      SELECT COUNT(*) AS count FROM production_queues
      WHERE building_id = ? AND company_id = ? AND resolved = 0
    `).get(existing.id, companyId) as { count: number };
    const retailOrders = db.prepare(`
      SELECT COUNT(*) AS count FROM retail_orders
      WHERE building_id = ? AND company_id = ?
    `).get(existing.id, companyId) as { count: number };
    if (pending.count > 0 || retailOrders.count > 0) {
      throw new Error('Position has active building work');
    }
    if (existing.busy_until && new Date(existing.busy_until).getTime() > Date.now()) {
      throw new Error('Building is still under construction or upgrade');
    }
  }

  const consumedMaterials: Array<{ db_letter: number; quality: number; amount: number }> = [];
  let newMoney = comp.money;
  const now = new Date().toISOString();
  const busyUntil = new Date(Date.now() + 10000).toISOString();

  db.exec('BEGIN');
  try {
    for (const req of materials) {
      const transactions = consumeResourceExactWithTransactions(companyId, req.kind, 0, req.amount);
      if (!transactions) {
        throw new Error(`Insufficient construction materials: need ${req.amount} of resource #${req.kind}`);
      }
      consumedMaterials.push({ db_letter: req.kind, quality: 0, amount: req.amount });
    }

    newMoney = updateCompanyMoney(companyId, -meta.cost);
    if (existing && replaceExisting) {
      db.prepare('DELETE FROM production_queues WHERE building_id = ? AND company_id = ?')
        .run(existing.id, companyId);
      db.prepare('DELETE FROM retail_orders WHERE building_id = ? AND company_id = ?')
        .run(existing.id, companyId);
      db.prepare('DELETE FROM buildings WHERE id = ? AND company_id = ?')
        .run(existing.id, companyId);
    }

    const abundance = initialAbundanceForKind(String(kind));
    const result = db.prepare(`
      INSERT INTO buildings (company_id, position, kind, size, name, cost, category, busy_until, created_at, abundance, original_abundance)
      VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
    `).run(companyId, String(position), String(kind), String(meta.name), Number(meta.cost), String(meta.category), busyUntil, now, abundance.abundance, abundance.originalAbundance);

    db.exec('COMMIT');
    const newId = Number(result.lastInsertRowid);
    const building = getBuildingById(newId);

    return {
      building: building ? formatBuilding(building) : null,
      cost: meta.cost,
      moneyUpdate: newMoney,
      resourcesConsumed: consumedMaterials
    };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function upgradeBuilding(companyId: number, buildingId: number, sizeDelta: number) {
  if (!Number.isSafeInteger(sizeDelta) || sizeDelta <= 0) {
    throw new Error('Building size change must be a positive integer');
  }

  const building = getBuildingById(buildingId);
  if (!building || building.company_id !== companyId) {
    throw new Error('Building not found');
  }
  if (building.busy_until && new Date(building.busy_until).getTime() > Date.now()) {
    throw new Error('Building is still under construction or upgrade');
  }

  const meta = getBuildingMeta(building.kind);
  const newSize = building.size + sizeDelta;
  const maxSize = 15;
  if (!Number.isSafeInteger(building.size) || newSize > maxSize) {
    throw new Error(`Building level must be between 1 and ${maxSize}`);
  }

  const cost = (meta.cost || 6900) * sizeDelta;
  const comp = getCompanyById(companyId);
  if (!comp || comp.money < cost) {
    throw new Error('Not enough money to upgrade building');
  }

  const materials = validateConstructionMaterials(companyId, sizeDelta);
  const consumedMaterials: Array<{ db_letter: number; quality: number; amount: number }> = [];
  const busyUntil = new Date(Date.now() + 10000).toISOString();
  let newMoney = comp.money;

  db.exec('BEGIN');
  try {
    for (const req of materials) {
      const transactions = consumeResourceExactWithTransactions(companyId, req.kind, 0, req.amount);
      if (!transactions) {
        throw new Error(`Insufficient construction materials: need ${req.amount} of resource #${req.kind}`);
      }
      consumedMaterials.push({ db_letter: req.kind, quality: 0, amount: req.amount });
    }

    newMoney = updateCompanyMoney(companyId, -cost);
    const updated = db.prepare(`
      UPDATE buildings SET size = ?, busy_until = ?
      WHERE id = ? AND company_id = ?
    `).run(newSize, busyUntil, buildingId, companyId);
    if (updated.changes !== 1) throw new Error('Building not found');
    db.exec('COMMIT');

    const latest = getBuildingById(buildingId);
    return {
      building: latest ? formatBuilding(latest) : null,
      cost,
      moneyUpdate: newMoney,
      resourcesConsumed: consumedMaterials
    };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}


export function demolishBuilding(companyId: number, buildingId: number) {
  const building = getBuildingById(buildingId);
  if (!building || building.company_id !== companyId) {
    throw new Error('Building not found');
  }

  const refund = Math.round(building.cost * DEMOLITION_REFUND_RATE);
  db.exec('BEGIN IMMEDIATE');
  try {
    const deleted = db.prepare('DELETE FROM buildings WHERE id = ? AND company_id = ?')
      .run(buildingId, companyId);
    if (deleted.changes !== 1) {
      throw new Error('Building not found');
    }
    db.prepare('DELETE FROM production_queues WHERE building_id = ? AND company_id = ?')
      .run(buildingId, companyId);
    db.prepare('DELETE FROM retail_orders WHERE building_id = ? AND company_id = ?')
      .run(buildingId, companyId);
    const moneyUpdate = updateCompanyMoney(companyId, refund);
    db.exec('COMMIT');

    return {
      success: true,
      moneyUpdate,
      building: {
        id: building.id,
        position: String(building.position),
        size: 0
      }
    };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
