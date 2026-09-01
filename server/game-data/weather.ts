/**
 * Weather (Issue #107 build-out).
 * Derives the realm weather object from the decompiled seasonal saturation
 * curves (data/02-反编译数据/data/resource_lookups.json, `npr.seasons`).
 *
 * Official semantics (formulas_retail.md):
 * - `sellingSpeedMultiplier` divides per-hour sales; bounds are
 *   MIN_WEATHER_SPEED_MULTIPLIER 0.3 … MAX_WEATHER_SPEED_MULTIPLIER 1.7.
 * - A season is "active" when its curve saturation is >= 0.8 (G9 threshold).
 *
 * Mapping used here (deterministic, season-curve driven):
 * - saturation <= 0.8 → multiplier 1.0 (off-season)
 * - saturation  (0.8, 1.0] → linear 1.0 → 1.7 peak
 * The returned `since`/`until` window covers the current curve segment, so
 * clients see a stable object until the next segment boundary.
 */

interface SaturationPoint {
  date: string; // 'MM-DD'
  saturation: number;
}

interface SeasonDef {
  id: string;
  saturation: SaturationPoint[];
}

const SEASONS: Record<string, SeasonDef> = {
  Ramadan: {
    id: 'Ramadan',
    saturation: [
      { date: '01-01', saturation: 0.03 },
      { date: '02-05', saturation: 0.03 },
      { date: '02-18', saturation: 0.9 },
      { date: '03-01', saturation: 1 },
      { date: '03-10', saturation: 0.03 },
      { date: '12-31', saturation: 0.03 }
    ]
  },
  Easter: {
    id: 'Easter',
    saturation: [
      { date: '01-01', saturation: 0.03 },
      { date: '03-05', saturation: 0.03 },
      { date: '03-20', saturation: 0.9 },
      { date: '04-05', saturation: 1 },
      { date: '04-20', saturation: 0.03 },
      { date: '12-31', saturation: 0.03 }
    ]
  },
  Summer: {
    id: 'Summer',
    saturation: [
      { date: '01-01', saturation: 0.03 },
      { date: '07-05', saturation: 0.03 },
      { date: '07-14', saturation: 1 },
      { date: '08-20', saturation: 1 },
      { date: '09-05', saturation: 0.03 },
      { date: '12-31', saturation: 0.03 }
    ]
  },
  Halloween: {
    id: 'Halloween',
    saturation: [
      { date: '01-01', saturation: 0.03 },
      { date: '10-01', saturation: 0.03 },
      { date: '10-15', saturation: 1 },
      { date: '11-05', saturation: 1 },
      { date: '11-15', saturation: 0.03 },
      { date: '12-31', saturation: 0.03 }
    ]
  },
  Xmas: {
    id: 'Xmas',
    saturation: [
      { date: '01-01', saturation: 0.3 },
      { date: '01-10', saturation: 0.03 },
      { date: '11-01', saturation: 0.03 },
      { date: '12-01', saturation: 1 },
      { date: '12-27', saturation: 1 },
      { date: '12-31', saturation: 0.3 }
    ]
  }
};

const MIN_MULTIPLIER = 0.3;
const MAX_MULTIPLIER = 1.7;
const SEASON_THRESHOLD = 0.8;

function monthDay(now: Date): string {
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${m}-${d}`;
}

/** All seasons flattened to (date, saturation, seasonId) sorted by date within the calendar year. */
const CURVE: Array<{ date: string; saturation: number; season: string }> = Object.entries(SEASONS)
  .flatMap(([name, def]) => def.saturation.map(p => ({ date: p.date, saturation: p.saturation, season: name })))
  .sort((a, b) => a.date.localeCompare(b.date));

function pointDateToDate(pointMmDd: string, year: number): Date {
  const [m, d] = pointMmDd.split('-').map(Number);
  return new Date(Date.UTC(year, m - 1, d, 0, 0, 0));
}

export interface RealmWeather {
  id: number;
  realm: number;
  sellingSpeedMultiplier: number;
  since: string;
  until: string;
  season: string;
}

export function getWeather(realmId: number, now: Date = new Date()): RealmWeather {
  const md = monthDay(now);
  const year = now.getUTCFullYear();

  // Find the segment [lower, upper) containing today on the calendar circle.
  let lower = CURVE[CURVE.length - 1];
  let upper = CURVE[0];
  for (let i = 0; i < CURVE.length; i++) {
    if (CURVE[i].date <= md) {
      lower = CURVE[i];
      upper = CURVE[(i + 1) % CURVE.length];
    }
  }

  // Linear interpolation of saturation across the segment.
  const toMinutes = (mmDd: string): number => {
    const [m, d] = mmDd.split('-').map(Number);
    return (m - 1) * 31 + d; // monotone proxy; fine for interpolation ordering
  };
  const span = Math.max(1, toMinutes(upper.date) - toMinutes(lower.date));
  const t = Math.min(1, Math.max(0, (toMinutes(md) - toMinutes(lower.date)) / span));
  const saturation = lower.saturation + (upper.saturation - lower.saturation) * t;

  // saturation → multiplier: 1.0 off-season, ramps to 1.7 at full peak.
  let multiplier = 1.0;
  if (saturation > SEASON_THRESHOLD) {
    multiplier = 1.0 + ((saturation - SEASON_THRESHOLD) / (1 - SEASON_THRESHOLD)) * (MAX_MULTIPLIER - 1.0);
  }
  multiplier = Math.round(Math.min(MAX_MULTIPLIER, Math.max(MIN_MULTIPLIER, multiplier)) * 100) / 100;

  const since = pointDateToDate(lower.date, year);
  // upper boundary may cross into next year (e.g. Xmas 12-31 → 01-01).
  let until = pointDateToDate(upper.date, year);
  if (until <= since) {
    until = pointDateToDate(upper.date, year + 1);
  }

  return {
    id: 1,
    realm: realmId,
    sellingSpeedMultiplier: multiplier,
    since: since.toISOString(),
    until: until.toISOString(),
    season: lower.season
  };
}
