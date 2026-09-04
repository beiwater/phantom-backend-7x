/**
 * Market Exchange Feature Types
 */

import type { MarketOrder } from '../../api/market-api.ts';

export interface MarketState {
  selectedResourceId: number;
  orderBook: MarketOrder[];
  tickerPrice: number;
  loading: boolean;
  submitting: boolean;
  error: string | null;
}
