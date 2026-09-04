/**
 * Player Profile & Settings API Client
 */

import { httpClient } from './http-client.ts';
import { Routes } from '../routes/route-definitions.ts';

export interface CompanyProfile {
  id: number;
  companyId: number;
  name: string;
  money: number;
  simboosts: number;
  level: number;
  rating: string;
  experience: number;
  realmId: number;
  logo: string;
  note?: string;
  extraBuildingSlots: number;
  extraExecutiveSlots: number;
  displayCaseSlots: number;
  createdAt: string;
}

export interface PlayerPreferences {
  theme: 'light' | 'dark' | 'system';
  simplifyUI: boolean;
  language: string;
  showOnlineIndicator: boolean;
}

export const profileApi = {
  async fetchCurrentCompany(): Promise<CompanyProfile> {
    const res = await httpClient.get<CompanyProfile>(Routes.api.player.me());
    return res.data;
  },

  async fetchCompanyProfile(companyId: number | string): Promise<CompanyProfile> {
    const res = await httpClient.get<CompanyProfile>(Routes.api.player.companyProfile(companyId));
    return res.data;
  },

  async lookupCompany(realmId: number | string, name: string, tag: string): Promise<CompanyProfile[]> {
    const res = await httpClient.get<CompanyProfile[]>(Routes.api.player.companyLookup(realmId, name, tag));
    return res.data;
  },

  async updatePreferences(prefs: Partial<PlayerPreferences>): Promise<PlayerPreferences> {
    const res = await httpClient.post<PlayerPreferences>(Routes.api.player.preferences(), prefs);
    return res.data;
  },

  async useSimboosts(action: string, params: Record<string, unknown> = {}): Promise<{ success: boolean; simboostsRemaining: number }> {
    const res = await httpClient.post<{ success: boolean; simboostsRemaining: number }>(
      Routes.api.player.simboostsUse(action),
      params
    );
    return res.data;
  }
};
