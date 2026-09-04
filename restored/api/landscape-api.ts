/**
 * Landscape Map & Construction API Client
 */

import { httpClient } from './http-client.ts';
import { Routes } from '../routes/route-definitions.ts';
import type { PlayerBuilding } from '../shared/types.ts';

export interface ConstructionCostEstimate {
  moneyCost: number;
  materialsNeeded: Record<number, number>; // resourceId -> amount
}

export const landscapeApi = {
  async fetchBuildings(companyId: number | string): Promise<PlayerBuilding[]> {
    const res = await httpClient.get<PlayerBuilding[]>(Routes.api.building.list(companyId));
    return res.data;
  },

  async constructBuilding(companyId: number | string, params: {
    kind: string; // building dbLetter
    position: string;
  }): Promise<PlayerBuilding> {
    const res = await httpClient.post<PlayerBuilding>(Routes.api.building.construct(companyId), params);
    return res.data;
  },

  async upgradeBuilding(companyId: number | string, buildingId: number | string): Promise<PlayerBuilding> {
    const res = await httpClient.patch<PlayerBuilding>(
      Routes.api.building.upgrade(companyId, buildingId),
      { size: 1 }
    );
    return res.data;
  },

  async demolishBuilding(companyId: number | string, buildingId: number | string): Promise<{ refundedMoney: number }> {
    const res = await httpClient.delete<{ refundedMoney: number }>(
      Routes.api.building.demolish(companyId, buildingId)
    );
    return res.data;
  }
};
