/**
 * Market Exchange API Client
 */

import { httpClient } from './http-client.ts';
import { Routes } from '../routes/route-definitions.ts';

export interface MarketOrder {
  id: number;
  companyId: number;
  companyName: string;
  resourceId: number;
  amount: number;
  price: number;
  quality: number;
  postedAt: string;
}

export interface MarketOrderBook {
  resourceId: number;
  orders: MarketOrder[];
}

export const marketApi = {
  async fetchOrderBook(realmId: number | string, resourceId: number | string): Promise<MarketOrderBook> {
    const res = await httpClient.get<MarketOrderBook>(Routes.api.market.orderBook(realmId, resourceId));
    return res.data;
  },

  async postOrder(params: {
    resourceId: number;
    amount: number;
    price: number;
    quality: number;
  }): Promise<MarketOrder> {
    const res = await httpClient.post<MarketOrder>(Routes.api.market.postOrder(), params);
    return res.data;
  },

  async takeOrder(orderId: number | string, amount: number): Promise<{ moneyDelta: number; unitsAcquired: number }> {
    const res = await httpClient.post<{ moneyDelta: number; unitsAcquired: number }>(
      Routes.api.market.takeOrder(),
      { orderId, amount }
    );
    return res.data;
  },

  async cancelOrder(orderId: number | string): Promise<{ success: boolean }> {
    const res = await httpClient.delete<{ success: boolean }>(Routes.api.market.cancelOrder(orderId));
    return res.data;
  }
};
