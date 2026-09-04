/**
 * Seasonal Events Feature Types
 */

import type { EggCollectResult } from '../../api/events-api.ts';

export interface SeasonalEventInfo {
  id: string;
  name: string;
  isActive: boolean;
  startDate: string;
  endDate: string;
  description: string;
  featuredCommodities: number[];
}

export interface SeasonalEventsState {
  events: SeasonalEventInfo[];
  eggHuntResult: EggCollectResult | null;
  collectingEgg: boolean;
  error: string | null;
}
