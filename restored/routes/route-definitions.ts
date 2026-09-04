/**
 * Semantic Route Definitions
 * Reconstructed from Wcr & Ycr routing tables in index-cgzgptQ8.js
 */

export const Routes = {
  // Navigation / UI Routes
  ui: {
    home: () => '/',
    building: (buildingId: number | string) => `/b/${buildingId}/`,
    buildingProduction: (buildingId: number | string, tab: string) => `/b/${buildingId}/production/${tab}/`,
    company: (realmId: number | string, companyId: number | string) => `/company/${realmId}/${companyId}/`,
    warehouse: () => '/warehouse/',
    exchange: () => '/market/',

    // Encyclopedia UI Routes
    encyclopedia: {
      base: (realmId: number | string) => `/encyclopedia/${realmId}/`,
      resources: (realmId: number | string) => `/encyclopedia/${realmId}/resources/`,
      resourceDetail: (realmId: number | string, resourceId: number | string) =>
        `/encyclopedia/${realmId}/resource/${resourceId}/`,
      buildings: (realmId: number | string) => `/encyclopedia/${realmId}/buildings/`,
      buildingDetail: (realmId: number | string, buildingKind: string) =>
        `/encyclopedia/${realmId}/building/${buildingKind}/`,
      seasons: (realmId: number | string) => `/encyclopedia/${realmId}/seasons/`,
      retailSeason: (realmId: number | string, season: string) =>
        `/encyclopedia/${realmId}/retail-seasons/${season}/`,
      productionSeason: (realmId: number | string, season: string) =>
        `/encyclopedia/${realmId}/production-seasons/${season}/`,
      levels: (realmId: number | string) => `/encyclopedia/${realmId}/levels/`,
      rankings: (realmId: number | string) => `/encyclopedia/${realmId}/ranking/`,
      evaRankings: (realmId: number | string) => `/encyclopedia/${realmId}/eva-ranking/`,
      certificates: (realmId: number | string) => `/encyclopedia/${realmId}/certificates/`,
      collectibles: (realmId: number | string) => `/encyclopedia/${realmId}/collectibles/`
    }
  },

  // API Endpoints
  api: {
    // Buildings & Production Queue (Generic Retail)
    building: {
      list: (companyId: number | string) => `/api/v2/companies/${companyId}/buildings/`,
      get: (companyId: number | string, buildingId: number | string) =>
        `/api/v2/companies/${companyId}/buildings/${buildingId}/`,
      queue: (buildingId: number | string) => `/api/v2/companies/buildings/${buildingId}/queue/`,
      queueItem: (buildingId: number | string, taskId: number | string) =>
        `/api/v2/companies/buildings/${buildingId}/queue/${taskId}/`,
      busy: (buildingId: number | string) => `/api/v1/buildings/${buildingId}/busy/`,
      abundance: (buildingId: number | string) => `/api/v2/companies/buildings/${buildingId}/abundance/`
    },

    // Sales Offices (Aerospace Contracts)
    salesOffice: {
      orders: (buildingId: number | string) => `/api/v2/companies/buildings/${buildingId}/sales-orders/`,
      orderDetail: (buildingId: number | string, orderId: number | string) =>
        `/api/v2/companies/buildings/${buildingId}/sales-orders/${orderId}/`,
      rush: (rushToken: string) => `/api/v1/rush/${rushToken}/`
    },

    // Restaurants
    restaurant: {
      properties: (buildingId: number | string) =>
        `/api/v2/companies/buildings/${buildingId}/restaurant-properties/`,
      runs: (buildingId: number | string) =>
        `/api/v2/companies/buildings/${buildingId}/restaurant-runs/`
    },

    // Encyclopedia & Market APIs
    encyclopedia: {
      resourceRetailInfo: (realmId: number | string) =>
        `/api/v4/${realmId}/resources-retail-info/`,
      resourceDetail: (realmId: number | string, lang: string, resourceId: number | string, quality: number) =>
        `/api/v4/${realmId}/${lang}/encyclopedia/resources/${resourceId}/${quality}/`,
      existingQuality: (realmId: number | string, lang: string) =>
        `/api/v4/${realmId}/${lang}/encyclopedia/existing-resource-quality/`,
      ranking: (realmId: number | string, date: string) =>
        `/api/v4/encyclopedia/ranking/${realmId}/${date}/`,
      evaRanking: (realmId: number | string, date: string) =>
        `/api/v4/encyclopedia/eva-ranking/${realmId}/${date}/`
    },

    // Market Ticker & Company Metrics
    market: {
      ticker: (realmId: number | string) => `/api/v3/market-ticker/${realmId}/`,
      orderBook: (realmId: number | string, resourceId: number | string) => `/api/v3/market/${realmId}/${resourceId}/`
    },

    company: {
      adminOverhead: () => '/api/v2/companies/me/administration-overhead/'
    }
  }
};
