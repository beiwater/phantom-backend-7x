/**
 * Warehouse & Inventory API Client
 */

import { httpClient } from './http-client.ts';
import { Routes } from '../routes/route-definitions.ts';

export interface WarehouseItem {
  resourceId: number;
  name?: string;
  amount: number;
  quality: number;
  averageCost: number;
  transportationUnits: number;
}

export interface B2BContract {
  id: number;
  senderCompanyId: number;
  senderCompanyName: string;
  recipientCompanyId: number;
  recipientCompanyName: string;
  resourceId: number;
  amount: number;
  price: number;
  quality: number;
  createdAt: string;
}

export const warehouseApi = {
  async fetchInventory(companyId: number | string): Promise<WarehouseItem[]> {
    const res = await httpClient.get<WarehouseItem[]>(Routes.api.warehouse.inventory(companyId));
    return res.data;
  },

  async fetchIncomingContracts(companyId: number | string): Promise<B2BContract[]> {
    const res = await httpClient.get<B2BContract[]>(Routes.api.warehouse.contractsIncoming(companyId));
    return res.data;
  },

  async fetchOutgoingContracts(companyId: number | string): Promise<B2BContract[]> {
    const res = await httpClient.get<B2BContract[]>(Routes.api.warehouse.contractsOutgoing(companyId));
    return res.data;
  },

  async sendContract(params: {
    recipientCompanyId: number;
    resourceId: number;
    amount: number;
    price: number;
    quality: number;
  }): Promise<B2BContract> {
    const res = await httpClient.post<B2BContract>(Routes.api.warehouse.sendContract(), params);
    return res.data;
  },

  async acceptContract(contractId: number | string): Promise<{ success: boolean }> {
    const res = await httpClient.post<{ success: boolean }>(Routes.api.warehouse.acceptContract(contractId));
    return res.data;
  },

  async rejectContract(contractId: number | string): Promise<{ success: boolean }> {
    const res = await httpClient.post<{ success: boolean }>(Routes.api.warehouse.rejectContract(contractId));
    return res.data;
  }
};
