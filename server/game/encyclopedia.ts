import { db } from '../db/database.ts';
import { virtualClock } from '../core/virtual-clock.ts';
import { CONSTANTS_RESOURCES, getResourceDef } from './constants.ts';

// Deterministic pseudo-random number generator for consistent historical data
function seededRandom(seed: number): () => number {
  let s = Math.abs(seed) || 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export interface ResourceHistoryPoint {
  date: string;
  price: number;
  volume: number;
  quality: number;
  high: number;
  low: number;
  vwap: number;
}

export interface ResourceRetailDataPoint {
  date: string;
  saturation: number;
  averagePrice: number;
}

export interface ResourceEncyclopediaDetail {
  dbLetter: number;
  name: string;
  producedAt: string;
  producedFrom: Record<string, number>;
  producedPerHourRaw: number;
  image: string;
  transportation: number;
  isExchangeTradable: boolean;
  unitsSoldAnHour: number;
  decay: number;
  quality: number;
  productionCost: number;
  retailModel: { saturation: number; averagePrice: number };
  retailData: ResourceRetailDataPoint[];
  history: ResourceHistoryPoint[];
  market: { price: number; quality: number; volume: number };
}

export interface RankingEntry {
  id: number;
  rank: number;
  company: string;
  logo: string;
  realmId: number;
  year: number;
  value: number;
  eva: number;
}

export interface ExistingResourceQualityEntry {
  kind: number;
  quality: number;
  itemsAvailable: number;
}

// Generate authentic historical price & volume time-series data for a resource
export function getResourceHistory(kind: number, days: number = 30, quality: number = 0): ResourceHistoryPoint[] {
  const def = getResourceDef(kind);
  const baseCost = def ? (def.cost || 2.5) : 2.5;
  const qualityMultiplier = 1 + quality * 0.12;
  const targetBasePrice = Math.round(baseCost * 1.28 * qualityMultiplier * 100) / 100;
  
  const history: ResourceHistoryPoint[] = [];
  const now = virtualClock.now();
  const rng = seededRandom(kind * 1000 + quality * 100);

  let currentPrice = targetBasePrice;
  for (let i = days; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000);
    const dateStr = d.toISOString().split('T')[0];
    
    // Price fluctuation around mean
    const delta = (rng() - 0.48) * (targetBasePrice * 0.08);
    currentPrice = Math.max(0.1, Math.round((currentPrice + delta) * 100) / 100);
    
    const high = Math.round((currentPrice * (1 + rng() * 0.04)) * 100) / 100;
    const low = Math.round((currentPrice * (1 - rng() * 0.04)) * 100) / 100;
    const volume = Math.floor(5000 + rng() * 45000 * (def?.transportation ? (1 / def.transportation) : 1));
    const vwap = Math.round(((high + low + currentPrice * 2) / 4) * 100) / 100;

    history.push({
      date: dateStr,
      price: currentPrice,
      volume,
      quality,
      high,
      low,
      vwap
    });
  }

  return history;
}

// Generate complete encyclopedia resource detail payload
export function getResourceEncyclopediaDetail(
  _realmId: number,
  kind: number,
  quality: number = 0
): ResourceEncyclopediaDetail {
  const def = getResourceDef(kind);
  const baseCost = def ? (def.cost || 2.5) : 2.5;
  const history = getResourceHistory(kind, 30, quality);
  const latestPoint = history[history.length - 1];

  const now = virtualClock.now();
  const rng = seededRandom(kind * 777);
  const retailData: ResourceRetailDataPoint[] = [];
  for (let i = 30; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000);
    const dateStr = d.toISOString().split('T')[0];
    const saturation = Math.round((0.35 + rng() * 0.4) * 100) / 100;
    const avgPrice = Math.round((baseCost * (1.3 + rng() * 0.2)) * 100) / 100;
    retailData.push({
      date: dateStr,
      saturation,
      averagePrice: def?.unitsSoldAnHour ? avgPrice : 0
    });
  }

  return {
    dbLetter: kind,
    name: def?.name || `Resource #${kind}`,
    producedAt: def?.producedAt || 'P',
    producedFrom: def?.producedFrom || {},
    producedPerHourRaw: def?.producedPerHourRaw || 200,
    image: def?.image || 'images/resources/apples.png',
    transportation: def?.transportation || 1,
    isExchangeTradable: def?.isExchangeTradable ?? true,
    unitsSoldAnHour: def?.unitsSoldAnHour || 0,
    decay: def?.decay || 0,
    quality,
    productionCost: Math.round(baseCost * 100) / 100,
    retailModel: {
      saturation: retailData[retailData.length - 1].saturation,
      averagePrice: retailData[retailData.length - 1].averagePrice
    },
    retailData,
    history,
    market: {
      price: latestPoint.price,
      quality,
      volume: latestPoint.volume
    }
  };
}

// Transaction summary categories for resource detail view
export function getResourceTransactionsSummary(_realmId: number, kind: number): Array<{ category: string; amount: number }> {
  const rng = seededRandom(kind * 999);
  return [
    { category: 'EXCHANGE', amount: Math.floor(10000 + rng() * 90000) },
    { category: 'CONTRACTS', amount: Math.floor(15000 + rng() * 120000) },
    { category: 'RETAIL', amount: Math.floor(8000 + rng() * 60000) },
    { category: 'PRODUCTION', amount: Math.floor(25000 + rng() * 200000) },
    { category: 'TRANSIT', amount: Math.floor(2000 + rng() * 15000) }
  ];
}

// Recent transaction log for resource
export function getResourceTransactions(_realmId: number, kind: number): Array<{
  id: number;
  datetime: string;
  category: string;
  amount: number;
  price: number;
  quality: number;
}> {
  const def = getResourceDef(kind);
  const baseCost = def ? (def.cost || 2.5) : 2.5;
  const rng = seededRandom(kind * 555);
  const categories = ['EXCHANGE', 'CONTRACTS', 'RETAIL', 'PRODUCTION'];
  const transactions = [];
  const now = virtualClock.nowMs();

  for (let i = 0; i < 20; i++) {
    const timeOffset = i * 3600 * 1000 * (1 + rng() * 2);
    const cat = categories[Math.floor(rng() * categories.length)];
    const price = Math.round((baseCost * (1.1 + rng() * 0.4)) * 100) / 100;
    const amount = Math.floor(100 + rng() * 2500);
    const quality = Math.floor(rng() * 3);

    transactions.push({
      id: 100000 + i,
      datetime: new Date(now - timeOffset).toISOString(),
      category: cat,
      amount,
      price,
      quality
    });
  }

  return transactions;
}

// Procedural leaderboard names for ranking population
const CORP_NAMES = [
  'AeroTech Dynamic', 'Solaris Quantum Energy', 'Titan Heavy Industries', 'Apex BioAgriculture',
  'Nexus Microelectronics', 'Vanguard Aerospace', 'Starlight Chemical Corp', 'Horizon Logistics',
  'Pinnacle Mining Syndicate', 'Aegis Defence Dynamics', 'OmniCorp Global', 'Crestline Automotive',
  'Orion Orbital Systems', 'Zenith Foods Group', 'Hyperion Power & Light', 'Terra Resources Ltd',
  'Eclipse SemiConductors', 'Summit Civil Engineering', 'Atlas Freight Interstellar', 'Prism Glassworks'
];

// Dynamic Company Rankings (CV & EVA)
export function getCompanyRankings(realmId: number, blobIndex: number = 0, variant: 'cv' | 'eva' = 'cv'): RankingEntry[] {
  const startRank = blobIndex * 400;

  // Fetch all real companies in realm with calculated company value
  const dbCompanies = db.prepare(`
    SELECT 
      c.company_id as id,
      c.name as company,
      COALESCE(c.logo, '') as logo,
      COALESCE(c.realm_id, 0) as realmId,
      COALESCE(c.level, 0) as level,
      c.money,
      c.created_at,
      COALESCE((SELECT SUM(b.cost * b.size) FROM buildings b WHERE b.company_id = c.id), 0) as buildings_value,
      COALESCE((SELECT SUM(w.amount * (w.cost_workers + w.cost_admin + w.cost_material1 + w.cost_material2 + w.cost_market)) FROM warehouse w WHERE w.company_id = c.id), 0) as warehouse_value
    FROM companies c
    WHERE c.realm_id = ?
  `).all(realmId) as Array<{
    id: number;
    company: string;
    logo: string;
    realmId: number;
    level: number;
    money: number;
    created_at: string;
    buildings_value: number;
    warehouse_value: number;
  }>;

  const now = virtualClock.nowMs();
  const calculatedCompanies = dbCompanies.map(c => {
    const totalValue = Math.round((c.money + c.buildings_value + c.warehouse_value) * 100) / 100;
    const createdTime = c.created_at ? new Date(c.created_at).getTime() : now;
    const age = Math.max(1, Math.floor((now - createdTime) / (1000 * 60 * 60 * 24)));
    const year = c.created_at ? new Date(c.created_at).getFullYear() : 2026;
    const eva = variant === 'eva'
      ? Math.round(((totalValue - 100000) / age) * 100) / 100
      : Math.round(totalValue * 0.15);

    return {
      id: c.id,
      company: c.company,
      logo: c.logo,
      realmId: c.realmId,
      year,
      value: variant === 'eva' ? eva : totalValue,
      eva
    };
  });

  // Sort by calculated value descending
  calculatedCompanies.sort((a, b) => b.value - a.value);

  // Assign 0-indexed rank
  const result: RankingEntry[] = calculatedCompanies.map((c, idx) => ({
    ...c,
    rank: idx
  }));

  // Return the requested page slice
  return result.slice(startRank, startRank + 400);
}

export function getEvaRankings(realmId: number, blobIndex: number = 0): RankingEntry[] {
  return getCompanyRankings(realmId, blobIndex, 'eva');
}
// Existing resource quality array for encyclopedia
export function getExistingResourceQualities(_realmId: number): ExistingResourceQualityEntry[] {
  // Query actual warehouse items
  const warehouseRows = db.prepare(`
    SELECT kind, quality, SUM(amount) as total
    FROM warehouse
    GROUP BY kind, quality
  `).all() as Array<{ kind: number; quality: number; total: number }>;

  const qualityMap = new Map<string, number>();
  for (const row of warehouseRows) {
    if (row.total > 0) {
      qualityMap.set(`${row.kind}-${row.quality}`, row.total);
    }
  }

  const entries: ExistingResourceQualityEntry[] = [];
  const rng = seededRandom(8888);

  for (const [k, _def] of Object.entries(CONSTANTS_RESOURCES)) {
    const kind = Number(k);
    // Base circulating qualities in the economy (Q0 to Q3)
    const maxQuality = kind > 100 ? 3 : 5;
    for (let q = 0; q <= maxQuality; q++) {
      const key = `${kind}-${q}`;
      const actualAmount = qualityMap.get(key) || 0;
      const simulatedAmount = Math.floor(500 * Math.pow(0.5, q) + rng() * 200);
      entries.push({
        kind,
        quality: q,
        itemsAvailable: Math.max(1, actualAmount + simulatedAmount)
      });
    }
  }

  return entries;
}

// Resources retail info for all retailable goods
export function getResourcesRetailInfo(_realmId: number): Array<{
  dbLetter: number;
  saturation: number;
  averagePrice: number;
  retailData: ResourceRetailDataPoint[];
}> {
  const result = [];
  const now = virtualClock.now();

  for (const [k, def] of Object.entries(CONSTANTS_RESOURCES)) {
    const kind = Number(k);
    const rng = seededRandom(kind * 1234);
    const baseCost = def.cost || 2.5;
    const isRetailable = Boolean(def.unitsSoldAnHour && def.unitsSoldAnHour > 0);

    const retailData: ResourceRetailDataPoint[] = [];
    for (let i = 30; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86400000);
      const dateStr = d.toISOString().split('T')[0];
      const sat = Math.round((0.4 + rng() * 0.35) * 100) / 100;
      const price = Math.round((baseCost * (1.3 + rng() * 0.25)) * 100) / 100;
      retailData.push({
        date: dateStr,
        saturation: isRetailable ? sat : 0.5,
        averagePrice: isRetailable ? price : 0
      });
    }

    const latest = retailData[retailData.length - 1];
    result.push({
      dbLetter: kind,
      saturation: latest.saturation,
      averagePrice: latest.averagePrice,
      retailData
    });
  }

  return result;
}

// Retail demand summary endpoint
export function getRetailDemand(_realmId?: number): {
  products: Array<{
    kind: number;
    name: string;
    saturation: number;
    demand: number;
    averagePrice: number;
    retailSpeed: number;
  }>;
} {
  const products = [];
  for (const [k, def] of Object.entries(CONSTANTS_RESOURCES)) {
    const kind = Number(k);
    if (def.unitsSoldAnHour && def.unitsSoldAnHour > 0) {
      const rng = seededRandom(kind * 3333);
      const saturation = Math.round((0.4 + rng() * 0.35) * 100) / 100;
      const demand = Math.round((1.0 / (saturation + 0.2)) * 100) / 100;
      const avgPrice = Math.round(((def.cost || 2.5) * 1.35) * 100) / 100;
      products.push({
        kind,
        name: def.name,
        saturation,
        demand,
        averagePrice: avgPrice,
        retailSpeed: def.unitsSoldAnHour
      });
    }
  }
  return { products };
}
