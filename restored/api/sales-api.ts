/**
 * Sales Buildings API Client
 * Reconstructed from index-cgzgptQ8.js offsets 4918500-4925000, 4983000-4985000
 */

import { httpClient } from './http-client.ts';
import { Routes } from '../routes/route-definitions.ts';
import type { RetailTask, SalesOrder, RestaurantProperties, RestaurantRun } from '../shared/types.ts';

export interface DeliverSalesOrderResponse {
  money: number;
  resourceTransactions: Array<{
    dbLetter: number;
    quality: number;
    amount: number;
  }>;
}

export const salesApi = {
  // --- Generic Retail Queue (Stores, Dealership, Seasonal) ---

  async fetchQueue(buildingId: number | string): Promise<RetailTask[]> {
    const res = await httpClient.get<RetailTask[]>(Routes.api.building.queue(buildingId));
    return res.data;
  },

  async startRetailTask(
    buildingId: number | string,
    params: {
      resourceId: number;
      amount: number;
      price: number;
      quality?: number;
    }
  ): Promise<RetailTask[]> {
    const res = await httpClient.post<RetailTask[]>(Routes.api.building.queue(buildingId), {
      kind: params.resourceId,
      amount: params.amount,
      price: params.price,
      quality: params.quality ?? 0
    });
    return res.data;
  },

  async cancelRetailTask(buildingId: number | string, taskId: number | string): Promise<void> {
    await httpClient.delete(Routes.api.building.queueItem(buildingId, taskId));
  },

  // --- Sales Offices (Aerospace Contracts) ---

  async fetchSalesOrders(buildingId: number | string): Promise<SalesOrder[]> {
    const res = await httpClient.get<SalesOrder[]>(Routes.api.salesOffice.orders(buildingId));
    return res.data;
  },

  async findCustomer(buildingId: number | string): Promise<SalesOrder> {
    const res = await httpClient.post<SalesOrder>(Routes.api.salesOffice.orders(buildingId));
    return res.data;
  },

  async deliverSalesOrder(
    buildingId: number | string,
    orderId: number | string,
    options: { lowestQualityFirst: boolean }
  ): Promise<DeliverSalesOrderResponse> {
    const res = await httpClient.put<DeliverSalesOrderResponse>(
      Routes.api.salesOffice.orderDetail(buildingId, orderId),
      options
    );
    return res.data;
  },

  async rejectSalesOrder(buildingId: number | string, orderId: number | string): Promise<void> {
    await httpClient.delete(Routes.api.salesOffice.orderDetail(buildingId, orderId));
  },

  async rushOrderSearch(rushToken: string): Promise<void> {
    await httpClient.post(Routes.api.salesOffice.rush(rushToken));
  },

  // --- Restaurants ---

  async fetchRestaurantProperties(buildingId: number | string): Promise<RestaurantProperties> {
    const res = await httpClient.get<RestaurantProperties>(Routes.api.restaurant.properties(buildingId));
    return res.data;
  },

  async updateRestaurantProperties(
    buildingId: number | string,
    properties: Partial<RestaurantProperties>
  ): Promise<RestaurantProperties> {
    const res = await httpClient.post<RestaurantProperties>(
      Routes.api.restaurant.properties(buildingId),
      properties
    );
    return res.data;
  },

  async fetchRestaurantRuns(buildingId: number | string): Promise<RestaurantRun[]> {
    const res = await httpClient.get<RestaurantRun[]>(Routes.api.restaurant.runs(buildingId));
    return res.data;
  },

  async toggleRestaurantRun(buildingId: number | string, open: boolean): Promise<RestaurantRun> {
    const res = await httpClient.post<RestaurantRun>(Routes.api.restaurant.runs(buildingId), {
      open
    });
    return res.data;
  }
};
