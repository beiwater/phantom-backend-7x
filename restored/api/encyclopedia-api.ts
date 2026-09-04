/**
 * Encyclopedia API Client
 * Reconstructed from index-cgzgptQ8.js offsets 2543000, 4068000-4085000
 */

import { httpClient } from './http-client.ts';
import { Routes } from '../routes/route-definitions.ts';
import type { ResourceRetailInfo, EncyclopediaResourceDetail } from '../shared/types.ts';

export interface MarketTickerItem {
  kind: number;
  price: number;
  quality: number;
}

export interface AdminOverheadResponse {
  administrationOverhead: number;
  administrationOverheadPlusOne?: number;
}

export const encyclopediaApi = {
  /**
   * Fetches retail market saturation and average price for all retail resources in the realm.
   */
  async fetchResourceRetailInfo(realmId: number | string): Promise<Record<number, ResourceRetailInfo>> {
    const res = await httpClient.get<Record<number, ResourceRetailInfo>>(
      Routes.api.encyclopedia.resourceRetailInfo(realmId)
    );
    return res.data;
  },

  /**
   * Fetches detailed encyclopedia information for a specific resource and quality.
   */
  async fetchResourceDetail(
    realmId: number | string,
    lang: string,
    resourceId: number | string,
    quality = 0
  ): Promise<EncyclopediaResourceDetail> {
    const res = await httpClient.get<EncyclopediaResourceDetail>(
      Routes.api.encyclopedia.resourceDetail(realmId, lang, resourceId, quality)
    );
    return res.data;
  },

  /**
   * Fetches the highest existing quality recorded in the economy for each resource.
   */
  async fetchExistingResourceQualities(
    realmId: number | string,
    lang: string
  ): Promise<Record<number, number>> {
    const res = await httpClient.get<Record<number, number>>(
      Routes.api.encyclopedia.existingQuality(realmId, lang)
    );
    return res.data;
  },

  /**
   * Fetches live market ticker prices across all resources in the realm.
   */
  async fetchMarketTicker(realmId: number | string): Promise<Record<number, MarketTickerItem>> {
    const res = await httpClient.get<Record<number, MarketTickerItem>>(
      Routes.api.market.ticker(realmId)
    );
    return res.data;
  },

  /**
   * Fetches the player's current administration overhead percentage.
   */
  async fetchAdminOverhead(): Promise<AdminOverheadResponse> {
    const res = await httpClient.get<AdminOverheadResponse>(
      Routes.api.company.adminOverhead()
    );
    return res.data;
  }
};
