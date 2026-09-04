/**
 * Semantic Route Definitions
 * Comprehensive Route Definitions extracted from Wcr & Ycr tables in index-cgzgptQ8.js
 */

export const Routes = {
  // Navigation / UI Routes
  ui: {
    home: () => '/',
    landscape: () => '/landscape/',
    building: (buildingId: number | string) => `/b/${buildingId}/`,
    buildingProduction: (buildingId: number | string, tab: string) => `/b/${buildingId}/production/${tab}/`,
    company: (realmId: number | string, companyId: number | string) => `/company/${realmId}/${companyId}/`,
    warehouse: () => '/warehouse/',
    exchange: (realmId: number | string = 0) => `/market/${realmId}/`,
    newspaper: (realmId: number | string = 0) => `/newspaper/${realmId}/`,
    newspaperArticle: (realmId: number | string, articleId: number | string) =>
      `/newspaper/${realmId}/article/${articleId}/`,
    chatroom: (channel: string = 'game') => `/chat/${channel}/`,
    messages: () => '/messages/',
    directMessage: (companyId: number | string) => `/messages/${companyId}/`,
    finances: (companyId: number | string) => `/company/${companyId}/finances/`,
    accountSettings: () => '/account-settings/',
    accountPreferences: () => '/account-settings/preferences/',
    accountLanguage: () => '/account-settings/language/',
    achievements: () => '/achievements/',

    // Encyclopedia UI Routes
    encyclopedia: {
      base: (realmId: number | string = 0) => `/encyclopedia/${realmId}/`,
      resources: (realmId: number | string = 0) => `/encyclopedia/${realmId}/resources/`,
      resourceDetail: (realmId: number | string, resourceId: number | string) =>
        `/encyclopedia/${realmId}/resource/${resourceId}/`,
      buildings: (realmId: number | string = 0) => `/encyclopedia/${realmId}/buildings/`,
      buildingDetail: (realmId: number | string, buildingKind: string) =>
        `/encyclopedia/${realmId}/building/${buildingKind}/`,
      seasons: (realmId: number | string = 0) => `/encyclopedia/${realmId}/seasons/`,
      retailSeason: (realmId: number | string, season: string) =>
        `/encyclopedia/${realmId}/retail-seasons/${season}/`,
      productionSeason: (realmId: number | string, season: string) =>
        `/encyclopedia/${realmId}/production-seasons/${season}/`,
      levels: (realmId: number | string = 0) => `/encyclopedia/${realmId}/levels/`,
      rankings: (realmId: number | string = 0) => `/encyclopedia/${realmId}/ranking/`,
      evaRankings: (realmId: number | string = 0) => `/encyclopedia/${realmId}/eva-ranking/`,
      certificates: (realmId: number | string = 0) => `/encyclopedia/${realmId}/certificates/`,
      collectibles: (realmId: number | string = 0) => `/encyclopedia/${realmId}/collectibles/`
    }
  },

  // API Endpoints
  api: {
    // Buildings & Landscape
    building: {
      list: (companyId: number | string) => `/api/v2/companies/${companyId}/buildings/`,
      get: (companyId: number | string, buildingId: number | string) =>
        `/api/v2/companies/${companyId}/buildings/${buildingId}/`,
      construct: (companyId: number | string) => `/api/v2/companies/${companyId}/buildings/`,
      upgrade: (companyId: number | string, buildingId: number | string) =>
        `/api/v2/companies/${companyId}/buildings/${buildingId}/`,
      demolish: (companyId: number | string, buildingId: number | string) =>
        `/api/v2/companies/${companyId}/buildings/${buildingId}/`,
      queue: (buildingId: number | string) => `/api/v2/companies/buildings/${buildingId}/queue/`,
      queueItem: (buildingId: number | string, taskId: number | string) =>
        `/api/v2/companies/buildings/${buildingId}/queue/${taskId}/`,
      busy: (buildingId: number | string) => `/api/v1/buildings/${buildingId}/busy/`,
      abundance: (buildingId: number | string) => `/api/v2/companies/buildings/${buildingId}/abundance/`
    },

    // Sales Offices
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

    // Chatrooms & Real-time Messages
    chat: {
      messages: (channelId: string) => `/api/v2/chatentry/${channelId}/`,
      postMessage: (channelId: string) => `/api/v2/chatentry/${channelId}/`,
      rooms: (companyId: number | string) => `/api/v2/companies/chatrooms/${companyId}/`,
      deleteMessage: (messageId: number | string) => `/api/v2/chatentry/entry/${messageId}/`
    },

    // Direct Messages & Contacts
    messages: {
      list: (companyId: number | string) => `/api/v2/messages/${companyId}/`,
      thread: (companyId: number | string, targetCompanyId: number | string) =>
        `/api/v2/messages_by_company/${companyId}/${targetCompanyId}/`,
      send: () => '/api/v2/message/',
      contacts: (companyId: number | string) => `/api/v2/contacts/${companyId}/`
    },

    // Player Profile & Company Lookup
    player: {
      me: () => '/api/v2/companies/me/',
      companyProfile: (companyId: number | string) => `/api/v2/companies/${companyId}/`,
      companyLookup: (realmId: number | string, name: string, tag: string) =>
        `/api/v2/company-lookup/${realmId}/${encodeURIComponent(name)}/${encodeURIComponent(tag)}/`,
      preferences: () => '/api/v2/players/preferences/',
      simboostsUse: (action: string) => `/api/v2/players/simboosts-use/${action}/`,
      notes: () => '/api/v2/moderator-notes/'
    },

    // Newspaper & Articles
    newspaper: {
      current: (realmId: number | string) => `/api/v2/newspaper/${realmId}/`,
      archive: (realmId: number | string, edition: number | string) =>
        `/api/v2/newspaper/${realmId}/${edition}/`,
      article: (articleId: number | string) => `/api/v2/article/${articleId}/`,
      vote: (articleId: number | string) => `/api/v2/article/${articleId}/vote/`
    },

    // Seasonal Events & Holiday Features (e.g. Easter Egg Hunt)
    events: {
      eggCollect: () => '/api/v2/egg-collect/',
      eggMarketOrders: () => '/api/v2/egg-market-orders/'
    },

    // Financial Statements
    finances: {
      balanceSheet: (companyId: number | string) => `/api/v2/companies/${companyId}/balance-sheet/`,
      cashflowStatement: (companyId: number | string) => `/api/v2/companies/${companyId}/cashflow-statement/`,
      incomeStatement: (companyId: number | string) => `/api/v2/companies/${companyId}/income-statement/`
    },

    // Personal Assistant (PA)
    assistant: {
      action: (paId: number | string, action: string) => `/api/v2/pa-action/${paId}/${action}/`
    },

    // Warehouse & Inventory
    warehouse: {
      inventory: (companyId: number | string) => `/api/v2/resources/${companyId}/`,
      contractsIncoming: (companyId: number | string) => `/api/v2/contracts-incoming/${companyId}/`,
      contractsOutgoing: (companyId: number | string) => `/api/v2/contracts-outgoing/${companyId}/`,
      sendContract: () => '/api/v2/contracts/',
      acceptContract: (contractId: number | string) => `/api/v2/contracts/${contractId}/accept/`,
      rejectContract: (contractId: number | string) => `/api/v2/contracts/${contractId}/reject/`
    },

    // Market Exchange
    market: {
      orderBook: (realmId: number | string, resourceId: number | string) => `/api/v3/market/${realmId}/${resourceId}/`,
      ticker: (realmId: number | string) => `/api/v3/market-ticker/${realmId}/`,
      postOrder: () => '/api/v2/market-order/',
      takeOrder: () => '/api/v2/market-order/take/',
      cancelOrder: (orderId: number | string) => `/api/v2/market-order/${orderId}/`
    },

    // Encyclopedia
    encyclopedia: {
      resourceRetailInfo: (realmId: number | string) => `/api/v4/${realmId}/resources-retail-info/`,
      resourceDetail: (realmId: number | string, lang: string, resourceId: number | string, quality: number) =>
        `/api/v4/${realmId}/${lang}/encyclopedia/resources/${resourceId}/${quality}/`,
      existingQuality: (realmId: number | string, lang: string) =>
        `/api/v4/${realmId}/${lang}/encyclopedia/existing-resource-quality/`,
      ranking: (realmId: number | string, date: string) => `/api/v4/encyclopedia/ranking/${realmId}/${date}/`,
      evaRanking: (realmId: number | string, date: string) => `/api/v4/encyclopedia/eva-ranking/${realmId}/${date}/`
    },

    company: {
      adminOverhead: () => '/api/v2/companies/me/administration-overhead/'
    }
  }
};
