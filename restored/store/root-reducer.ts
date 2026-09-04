/**
 * Reconstructed Root Redux State and Reducer Architecture
 * Reconstructed from entry.js:61987-62042 and redux_store.json
 */

export interface RootState {
  user: {
    authCompany: { companyId: number; realmId: number; testCategory?: string } | null;
    authUser: { id: number; username: string } | null;
    administrationOverhead: number | null;
    administrationOverheadPlusOne: number | null;
    productionModifier: number | null;
    salesModifier: number | null;
    simplifyUI: boolean;
  };
  buildings: {
    buildings: Record<number, unknown> | null;
    queues: Record<number, unknown[]>;
    abundance: Record<number, number>;
    recreationBonus: number | null;
    fetchingBuildings: boolean;
  };
  constants: {
    resources: Record<number, unknown[]>;
    resourceRetail: Record<number, unknown>; // realmId -> retail data
    resourceDetails: Record<number, Record<number, unknown>>;
    fetching: Record<string, unknown>;
  };
  market: {
    ticker: Record<number, { price: number; quality: number }> | null;
    marketData: Record<string, unknown>;
    fetchingTicker: boolean;
  };
  hints: {
    hints: Record<string, unknown[]>;
    encyclopediaAcknowledged: boolean;
    areHintsVisible: boolean;
  };
  warehouse: {
    resources: Record<number, unknown>;
    fetchingResources: boolean;
  };
  preferences: {
    theme: string;
  };
}

export const SLICE_NAMES = [
  'user',
  'messages',
  'flash',
  'newspaper',
  'constants',
  'buildings',
  'warehouse',
  'connectivity',
  'achievements',
  'stats',
  'hints',
  'finances',
  'market',
  'research',
  'localization',
  'preferences',
  'executives',
  'buildingAuctions',
  'animations',
  'gameNotifications',
  'giftBaskets'
] as const;
