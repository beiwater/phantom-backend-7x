import { virtualClock } from '../../core/virtual-clock.ts';
import { getTierForLevel } from '../../domain/leveling/level-rules.ts';
import { getRetailSaturation } from '../scheduler/daily-jobs.ts';
import { calculateOptimalRetailPrice } from '../../game-data/retail.ts';
import { schedulerStateRepository, type EconomyPhaseHistoryRow } from '../../repositories/scheduler-state-repository.ts';
import { getResourceDef, CONSTANTS_RESOURCES, type ResourceDef } from '../../game/constants.ts';
import { getResourceName } from '../../game-data/resources.ts';
import { getCompanyRankings } from '../../game/encyclopedia.ts';
import { companyRepository } from '../../repositories/company-repository.ts';
import { encyclopediaRepository } from '../../repositories/encyclopedia-repository.ts';
import { marketRepository, marketTradeRepository } from '../../repositories/market-repository.ts';
import { restaurantRepository } from '../../repositories/restaurant-repository.ts';
import { retailRepository } from '../../repositories/retail-repository.ts';

const RETAIL_HISTORY_DAYS = 28;
const DAY_MS = 24 * 60 * 60 * 1000;

type RetailHistoryEntry = {
  date: string;
  saturation: number;
  averagePrice: number;
  demand: number;
  amountSold: number;
  amountSoldRestaurant: number;
};

type ResourceDefinition = ResourceDef & { name?: string };

function roundPrice(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function dateKeyAt(nowMs: number, daysAgo: number): string {
  return new Date(nowMs - daysAgo * DAY_MS).toISOString().slice(0, 10);
}

function historyDates(nowMs: number): string[] {
  return Array.from({ length: RETAIL_HISTORY_DAYS }, (_, index) => dateKeyAt(nowMs, RETAIL_HISTORY_DAYS - index));
}

function demandFromSaturation(saturation: number): number {
  return Math.max(0, Math.min(1, (2 - saturation) / 2));
}

function menuResourceKind(item: unknown): number | null {
  if (!item || typeof item !== 'object' || !('resource' in item)) return null;
  const resource = Number(item.resource);
  return Number.isSafeInteger(resource) && resource > 0 ? resource : null;
}

function parseRestaurantSales(
  rows: Array<{ date: string; served: number; menuJson: string }>
): Map<string, Map<number, number>> {
  const sales = new Map<string, Map<number, number>>();
  for (const row of rows) {
    let menu: unknown;
    try {
      menu = JSON.parse(row.menuJson);
    } catch {
      continue;
    }
    if (!Array.isArray(menu) || row.served <= 0) continue;
    const amountByKind = sales.get(row.date) || new Map<number, number>();
    for (const item of menu) {
      if (!item || typeof item !== 'object') continue;
      const resource = menuResourceKind(item);
      if (resource === null) continue;
      amountByKind.set(resource, (amountByKind.get(resource) || 0) + row.served);
    }
    sales.set(row.date, amountByKind);
  }
  return sales;
}

function aggregateMarketHistory(kind: number, realmId: number, fromDate: string, toDate: string): Map<string, number> {
  const totals = new Map<string, { notional: number; volume: number }>();
  for (const row of marketTradeRepository.findDailyReferencePriceHistory(kind, realmId)) {
    if (row.date < fromDate || row.date > toDate) continue;
    const total = totals.get(row.date) || { notional: 0, volume: 0 };
    total.notional += row.vwap * row.volume;
    total.volume += row.volume;
    totals.set(row.date, total);
  }
  return new Map(Array.from(totals, ([date, total]) => [
    date,
    roundPrice(total.notional / total.volume)
  ] as const));
}

function economyStateForDate(
  realmId: number,
  date: string,
  history: EconomyPhaseHistoryRow[]
): number {
  const atMs = Date.parse(`${date}T12:00:00.000Z`);
  const phase = history.find(row => {
    const startMs = Date.parse(row.startAt);
    const endMs = row.endAt ? Date.parse(row.endAt) : Number.POSITIVE_INFINITY;
    return startMs <= atMs && atMs < endMs;
  });
  return phase?.phase ?? schedulerStateRepository.getEconomyPhase(realmId)?.state ?? 1;
}

function modeledRetailPrice(kind: number, saturation: number, economyState: number): number {
  // No persisted trade exists for this day; use the canonical saturation-aware model.
  return calculateOptimalRetailPrice(kind, 0, saturation, undefined, economyState);
}

function buildRetailHistory(realmId: number, kind: number, nowMs: number): RetailHistoryEntry[] {
  const dates = historyDates(nowMs);
  const fromDate = dates[0];
  const toDate = dates[dates.length - 1];
  const economyHistory = schedulerStateRepository.getEconomyPhaseHistory(realmId);
  const retailSales = new Map(
    retailRepository.findDailySalesSummary(realmId, fromDate, toDate, kind)
      .map(row => [row.date, row] as const)
  );
  const marketPrices = aggregateMarketHistory(kind, realmId, fromDate, toDate);
  const restaurantSales = parseRestaurantSales(
    restaurantRepository.findDailySalesSummary(realmId, fromDate, toDate)
  );
  return dates.map(date => {
    const saturation = getRetailSaturation(date, kind);
    const sales = retailSales.get(date);
    const averagePrice = sales && sales.units > 0
      ? roundPrice(sales.revenue / sales.units)
      : marketPrices.get(date) ?? modeledRetailPrice(
        kind,
        saturation,
        economyStateForDate(realmId, date, economyHistory)
      );
    return {
      date,
      saturation,
      averagePrice,
      demand: demandFromSaturation(saturation),
      amountSold: sales?.units || 0,
      amountSoldRestaurant: restaurantSales.get(date)?.get(kind) || 0
    };
  });
}

function isRetailResource(definition: ResourceDef): boolean {
  return Number(definition.unitsSoldAnHour) > 0;
}

export function getEncyclopediaRetailInfo(realmId: number): Array<{
  quality: null;
  dbLetter: number;
  saturation: number;
  averagePrice: number;
  retailData: RetailHistoryEntry[];
}> {
  const nowMs = virtualClock.nowMs();
  return Object.entries(CONSTANTS_RESOURCES)
    .filter(([, definition]) => isRetailResource(definition))
    .map(([kindValue]) => {
      const kind = Number(kindValue);
      const retailData = buildRetailHistory(realmId, kind, nowMs);
      const latest = retailData[retailData.length - 1];
      return {
        quality: null,
        dbLetter: kind,
        saturation: latest.saturation,
        averagePrice: latest.averagePrice,
        retailData
      };
    })
    .sort((a, b) => a.dbLetter - b.dbLetter);
}

function currentMarket(kind: number, quality: number, realmId: number): { price: number; quality: number } | null {
  const activeOrder = marketRepository.findActiveSellOrdersForBook(realmId, kind, 1)[0];
  if (activeOrder) return { price: activeOrder.price, quality: activeOrder.quality };
  const references = marketTradeRepository.findDailyReferencePrices(realmId)
    .filter(reference => reference.kind === kind)
    .sort((a, b) => b.date.localeCompare(a.date) || b.quality - a.quality);
  const reference = references.find(candidate => candidate.quality === quality) ?? references[0];
  return reference ? { price: reference.vwap, quality: reference.quality } : null;
}

export function getEncyclopediaResourceDetail(
  realmId: number,
  kind: number,
  quality: number
): Record<string, unknown> | null {
  const definition = getResourceDef(kind);
  if (!definition) return null;
  const typedDefinition = definition as ResourceDefinition;
  const retailData = isRetailResource(definition) ? buildRetailHistory(realmId, kind, virtualClock.nowMs()) : [];
  const latestRetail = retailData[retailData.length - 1] as RetailHistoryEntry | undefined;
  return {
    dbLetter: kind,
    name: getResourceName(kind),
    producedAt: typedDefinition.producedAt ?? null,
    producedFrom: typedDefinition.producedFrom ?? {},
    producedPerHourRaw: typedDefinition.producedPerHourRaw ?? null,
    image: typedDefinition.image,
    transportation: typedDefinition.transportation,
    isExchangeTradable: typedDefinition.isExchangeTradable,
    unitsSoldAnHour: typedDefinition.unitsSoldAnHour ?? 0,
    decay: typedDefinition.decay ?? 0,
    quality,
    retailModel: latestRetail
      ? { saturation: latestRetail.saturation, averagePrice: latestRetail.averagePrice }
      : { saturation: null, averagePrice: null },
    retailData,
    market: currentMarket(kind, quality, realmId)
  };
}

export function getEncyclopediaProductionModifiers(realmId: number) {
  return encyclopediaRepository.listActiveResourceProductionModifiers(realmId, virtualClock.nowIso());
}

export function getEncyclopediaEvents(realmId: number) {
  return encyclopediaRepository.listEvents(realmId);
}

export function getEncyclopediaSupporters(realmId: number) {
  const rankByCompany = new Map(
    getCompanyRankings(realmId, 0, 'cv').map(company => [company.id, company.rank])
  );
  return companyRepository.listSupporters(realmId).map(company => ({
    id: company.companyId,
    company: company.name,
    realmId: company.realmId,
    logo: company.logo,
    level: company.level,
    levelName: getTierForLevel(company.level).name,
    note: company.note,
    rank: rankByCompany.get(company.companyId) ?? null,
    rating: company.rating,
    dateJoined: company.dateJoined
  }));
}
