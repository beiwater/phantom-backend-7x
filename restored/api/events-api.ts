/**
 * Seasonal & Holiday Events API Client (e.g. Easter Egg Hunt)
 */

import { httpClient } from './http-client.ts';
import { Routes } from '../routes/route-definitions.ts';

export interface EggCollectResult {
  success: boolean;
  eggType: string;
  count: number;
  totalCollected: number;
}

export const eventsApi = {
  async collectEasterEgg(): Promise<EggCollectResult> {
    const res = await httpClient.post<EggCollectResult>(Routes.api.events.eggCollect());
    return res.data;
  },

  async fetchEggMarketOrders(): Promise<unknown[]> {
    const res = await httpClient.get<unknown[]>(Routes.api.events.eggMarketOrders());
    return res.data;
  }
};
