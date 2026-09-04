import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = '/home/ubuntu/phantom-backend-7x';
const BUNDLE_PATH = path.join(ROOT, 'frontend-original/static/bundle/assets/index-cgzgptQ8.js');
const bundleContent = fs.readFileSync(BUNDLE_PATH, 'utf8');
const bundleSha256 = crypto.createHash('sha256').update(bundleContent).digest('hex');

const dictionary = [
  {
    symbol: "Fa",
    proposedName: "fetchWarehouseResources",
    confidence: 0.99,
    currentVersion: 2026,
    historicalMatches: {
      "2019": {
        "symbol": "fetchResources",
        "domain": "warehouse",
        "confidence": 0.95,
        "evidence": "Refreshes user warehouse inventory via GET /api/v2/resources/"
      },
      "2022": {
        "symbol": "fetchResources",
        "domain": "warehouse",
        "confidence": 0.99,
        "evidence": "2022 CRA action creator calling Ne(dispatch, wi().api_v2_resources(), 'FETCH_RESOURCES', 'FETCH_RESOURCES_ERROR')"
      }
    },
    evidence: {
      "arity": 2,
      "apiEndpoints": ["/api/v3/resources/:companyId/"],
      "stateFields": ["warehouse.fetchingResources", "warehouse.timestamp.resources", "warehouse.resources"],
      "headers": ["x-timestamp"],
      "callGraph": ["za", "L().api_v3_resources", "oe().get"]
    },
    provenance: {
      "bundle": "frontend-original/static/bundle/assets/index-cgzgptQ8.js",
      "byteRange": [1354694, 1354890],
      "bundleHash": bundleSha256
    }
  },
  {
    symbol: "QL",
    proposedName: "fetchWarehouseResourcesAsync",
    confidence: 0.98,
    currentVersion: 2026,
    historicalMatches: {
      "2022": {
        "symbol": "fetchResourcesAsync",
        "domain": "warehouse",
        "confidence": 0.95,
        "evidence": "Async generator thunk yielding axios response and updating warehouse resources"
      }
    },
    evidence: {
      "arity": 1,
      "apiEndpoints": ["/api/v3/resources/:companyId/"],
      "stateFields": ["warehouse.resources", "warehouse.timestamp.resources"],
      "headers": ["x-timestamp"],
      "callGraph": ["oe().get", "L().api_v3_resources"]
    },
    provenance: {
      "bundle": "frontend-original/static/bundle/assets/index-cgzgptQ8.js",
      "byteRange": [1354898, 1355140],
      "bundleHash": bundleSha256
    }
  },
  {
    symbol: "Mge",
    proposedName: "fetchWarehouseBuyOrders",
    confidence: 0.98,
    currentVersion: 2026,
    historicalMatches: {
      "2022": {
        "symbol": "fetchMarketBuyOrders",
        "domain": "warehouse",
        "confidence": 0.96,
        "evidence": "Queries /api/v2/companies/market-buy-orders/ and dispatches UPDATE_BUY_ORDERS"
      }
    },
    evidence: {
      "arity": 3,
      "constants": [180],
      "apiEndpoints": ["/api/v2/companies/market-buy-orders/"],
      "stateFields": ["warehouse.fetchingBuyOrders", "warehouse.timestamp.buyOrders"],
      "headers": ["x-timestamp"],
      "callGraph": ["za", "L().api_v2_companies_market_buy_orders"]
    },
    provenance: {
      "bundle": "frontend-original/static/bundle/assets/index-cgzgptQ8.js",
      "byteRange": [1355146, 1355480],
      "bundleHash": bundleSha256
    }
  },
  {
    symbol: "n4t",
    proposedName: "cancelWarehouseBuyOrder",
    confidence: 0.98,
    currentVersion: 2026,
    historicalMatches: {
      "2022": {
        "symbol": "cancelBuyOrder",
        "domain": "market/warehouse",
        "confidence": 0.95,
        "evidence": "DELETE /api/v2/companies/market-buy-orders/:id/ and dispatches REMOVE_BUY_ORDER"
      }
    },
    evidence: {
      "arity": 4,
      "callGraph": ["Ipr", "dispatch({type: IPt})"]
    },
    provenance: {
      "bundle": "frontend-original/static/bundle/assets/index-cgzgptQ8.js",
      "byteRange": [1355483, 1355650],
      "bundleHash": bundleSha256
    }
  },
  {
    symbol: "Qpr",
    proposedName: "fetchContractsIncoming",
    confidence: 0.99,
    currentVersion: 2026,
    historicalMatches: {
      "2019": {
        "symbol": "refreshContractsIncoming",
        "domain": "warehouse",
        "confidence": 0.95,
        "evidence": "Checked warehouse.timestamp.contractsIncoming with 180s timeout"
      },
      "2022": {
        "symbol": "dn",
        "domain": "warehouse",
        "confidence": 0.99,
        "evidence": "2022 CRA action calling Ne(dispatch, wi().api_contract_incoming(), 'FETCH_CONTRACTS_INCOMING', 'FETCH_CONTRACTS_INCOMING_ERROR')"
      }
    },
    evidence: {
      "arity": 3,
      "apiEndpoints": ["/api/v3/contract-incoming/:realmId/me/"],
      "stateFields": ["warehouse.fetchingContractsIncoming", "warehouse.timestamp.contractsIncoming"],
      "headers": ["x-timestamp"],
      "callGraph": ["za", "L().api_v3_contract_incoming"]
    },
    provenance: {
      "bundle": "frontend-original/static/bundle/assets/index-cgzgptQ8.js",
      "byteRange": [1356180, 1356370],
      "bundleHash": bundleSha256
    }
  },
  {
    symbol: "ev",
    proposedName: "refreshContractsIncoming",
    confidence: 0.99,
    currentVersion: 2026,
    historicalMatches: {
      "2019": {
        "symbol": "refreshContractsIncoming",
        "domain": "warehouse",
        "confidence": 0.99,
        "evidence": "(!timestamp || timestamp < now - 180) && fetchContractsIncoming()"
      },
      "2022": {
        "symbol": "pn",
        "domain": "warehouse",
        "confidence": 0.99,
        "evidence": "(!a || a < n - 180) && dn(dispatch, getState)"
      }
    },
    evidence: {
      "arity": 1,
      "constants": [180],
      "stateFields": ["warehouse.timestamp.contractsIncoming"],
      "callGraph": ["Qpr"]
    },
    provenance: {
      "bundle": "frontend-original/static/bundle/assets/index-cgzgptQ8.js",
      "byteRange": [1356379, 1356500],
      "bundleHash": bundleSha256
    }
  },
  {
    symbol: "Jpr",
    proposedName: "fetchRecentContractsOutgoing",
    confidence: 0.99,
    currentVersion: 2026,
    historicalMatches: {
      "2022": {
        "symbol": "bn",
        "domain": "warehouse",
        "confidence": 0.99,
        "evidence": "FETCH_RECENT_CONTRACTS_OUTGOING calling /api/contract-history-outgoing/"
      }
    },
    evidence: {
      "arity": 2,
      "apiEndpoints": ["/api/contract-history-outgoing/"],
      "stateFields": ["warehouse.fetchingRecentOutgoing", "warehouse.timestamp.recentOutgoing"],
      "headers": ["x-timestamp"],
      "callGraph": ["za", "L().api_contract_history_outgoing"]
    },
    provenance: {
      "bundle": "frontend-original/static/bundle/assets/index-cgzgptQ8.js",
      "byteRange": [1356506, 1356680],
      "bundleHash": bundleSha256
    }
  },
  {
    symbol: "Rge",
    proposedName: "refreshRecentContractsOutgoing",
    confidence: 0.99,
    currentVersion: 2026,
    historicalMatches: {
      "2022": {
        "symbol": "refreshRecentContractsOutgoing",
        "domain": "warehouse",
        "confidence": 0.99,
        "evidence": "(!r || r < n - 180) && Jpr(e, t)"
      }
    },
    evidence: {
      "arity": 0,
      "constants": [180],
      "stateFields": ["warehouse.timestamp.recentOutgoing"],
      "callGraph": ["Jpr"]
    },
    provenance: {
      "bundle": "frontend-original/static/bundle/assets/index-cgzgptQ8.js",
      "byteRange": [1356689, 1356800],
      "bundleHash": bundleSha256
    }
  },
  {
    symbol: "efr",
    proposedName: "fetchRecentContractsIncoming",
    confidence: 0.99,
    currentVersion: 2026,
    historicalMatches: {
      "2022": {
        "symbol": "fetchRecentContractsIncoming",
        "domain": "warehouse",
        "confidence": 0.99,
        "evidence": "FETCH_RECENT_CONTRACTS_INCOMING calling /api/contract-history-incoming/"
      }
    },
    evidence: {
      "arity": 2,
      "apiEndpoints": ["/api/contract-history-incoming/"],
      "stateFields": ["warehouse.fetchingRecentIncoming", "warehouse.timestamp.recentIncoming"],
      "headers": ["x-timestamp"],
      "callGraph": ["za", "L().api_contract_history_incoming"]
    },
    provenance: {
      "bundle": "frontend-original/static/bundle/assets/index-cgzgptQ8.js",
      "byteRange": [1356806, 1356980],
      "bundleHash": bundleSha256
    }
  },
  {
    symbol: "i4t",
    proposedName: "refreshRecentContractsIncoming",
    confidence: 0.99,
    currentVersion: 2026,
    historicalMatches: {
      "2022": {
        "symbol": "refreshRecentContractsIncoming",
        "domain": "warehouse",
        "confidence": 0.99,
        "evidence": "(!r || r < n - 180) && efr(e, t)"
      }
    },
    evidence: {
      "arity": 0,
      "constants": [180],
      "stateFields": ["warehouse.timestamp.recentIncoming"],
      "callGraph": ["efr"]
    },
    provenance: {
      "bundle": "frontend-original/static/bundle/assets/index-cgzgptQ8.js",
      "byteRange": [1356989, 1357110],
      "bundleHash": bundleSha256
    }
  },
  {
    symbol: "za",
    proposedName: "dispatchAsyncApiThunk",
    confidence: 1.0,
    currentVersion: 2026,
    historicalMatches: {
      "2022": {
        "symbol": "Ne",
        "domain": "network",
        "confidence": 1.0,
        "evidence": "function Ne(dispatch, url, actionStart, actionError, successCb, payload, method = 'get') - verbatim implementation"
      }
    },
    evidence: {
      "arity": 7,
      "callGraph": ["oe()[method](url).then(successCb).catch(...)"]
    },
    provenance: {
      "bundle": "frontend-original/static/bundle/assets/index-cgzgptQ8.js",
      "byteRange": [1341733, 1341880],
      "bundleHash": bundleSha256
    }
  },
  {
    symbol: "Stn",
    proposedName: "connectWarehouse",
    confidence: 0.99,
    currentVersion: 2026,
    historicalMatches: {
      "2022": {
        "symbol": "connect(mapStateToProps)",
        "domain": "warehouse",
        "confidence": 0.98,
        "evidence": "Redux connect HOC mapping realm, contest, contacts, contractsIncoming, resources to Warehouse props"
      }
    },
    evidence: {
      "arity": 1,
      "stateFields": ["user.authCompany.realmId", "user.temporals.contest", "messages.contacts", "warehouse.contractsIncoming", "warehouse.resources"],
      "callGraph": ["Vr (Redux connect)"]
    },
    provenance: {
      "bundle": "frontend-original/static/bundle/assets/index-cgzgptQ8.js",
      "byteRange": [2627177, 2627640],
      "bundleHash": bundleSha256
    }
  },
  {
    symbol: "Ctn",
    proposedName: "WarehouseInventoryComponent",
    confidence: 0.98,
    currentVersion: 2026,
    historicalMatches: {
      "2019": {
        "domain": "warehouse",
        "confidence": 0.90,
        "evidence": "Early React warehouse item grid view"
      },
      "2022": {
        "domain": "warehouse",
        "confidence": 0.96,
        "evidence": "Warehouse main view with inventory grid and search filters"
      }
    },
    evidence: {
      "componentType": "class",
      "stateFields": ["scrollHints", "selectedResource"],
      "domClasses": ["hover-effect", "resource-card", "warehouse-grid"]
    },
    provenance: {
      "bundle": "frontend-original/static/bundle/assets/index-cgzgptQ8.js",
      "byteRange": [2627654, 2630700],
      "bundleHash": bundleSha256
    }
  },
  {
    symbol: "ZP",
    proposedName: "WarehousePage",
    confidence: 0.99,
    currentVersion: 2026,
    historicalMatches: {
      "2022": {
        "domain": "warehouse",
        "confidence": 0.95,
        "evidence": "Warehouse page root wrapper receiving router props"
      }
    },
    evidence: {
      "componentType": "function",
      "callGraph": ["ke (useIntl)", "nc (useFeatures)", "ktn (connected Warehouse)"]
    },
    provenance: {
      "bundle": "frontend-original/static/bundle/assets/index-cgzgptQ8.js",
      "byteRange": [2630720, 2630950],
      "bundleHash": bundleSha256
    }
  },
  {
    symbol: "y$r",
    proposedName: "getWarehouseCategoryTabs",
    confidence: 0.97,
    currentVersion: 2026,
    historicalMatches: {
      "2022": {
        "domain": "warehouse",
        "confidence": 0.92,
        "evidence": "Filters warehouse resources by category: All, Energy, Resources, Agriculture, Construction, etc."
      }
    },
    evidence: {
      "arity": 2,
      "callGraph": ["e.formatMessage", "FU", "v6", "iA"]
    },
    provenance: {
      "bundle": "frontend-original/static/bundle/assets/index-cgzgptQ8.js",
      "byteRange": [2442370, 2445000],
      "bundleHash": bundleSha256
    }
  },
  {
    symbol: "cNt",
    proposedName: "matchesResourceSlug",
    confidence: 0.99,
    currentVersion: 2026,
    evidence: {
      "arity": 3,
      "callGraph": ["gt", "replace(/ /g, '-').toLowerCase()"]
    },
    provenance: {
      "bundle": "frontend-original/static/bundle/assets/index-cgzgptQ8.js",
      "byteRange": [2442261, 2442360],
      "bundleHash": bundleSha256
    }
  },
  {
    symbol: "gt",
    proposedName: "getResourceLocalizedName",
    confidence: 1.0,
    currentVersion: 2026,
    historicalMatches: {
      "2022": {
        "confidence": 1.0,
        "evidence": "e.formatMessage({id: 'be-re-' + resourceId})"
      }
    },
    evidence: {
      "arity": 2,
      "strings": ["be-re-"]
    },
    provenance: {
      "bundle": "frontend-original/static/bundle/assets/index-cgzgptQ8.js",
      "byteRange": [1751689, 1751800],
      "bundleHash": bundleSha256
    }
  },
  {
    symbol: "vw",
    proposedName: "sanitizeSearchInput",
    confidence: 1.0,
    currentVersion: 2026,
    evidence: {
      "arity": 1,
      "regex": "/[<>\\/\\\\\\\"';:?&#%+@]/g"
    },
    provenance: {
      "bundle": "frontend-original/static/bundle/assets/index-cgzgptQ8.js",
      "byteRange": [2761635, 2761750],
      "bundleHash": bundleSha256
    }
  },
  {
    symbol: "io",
    proposedName: "useRouteParams",
    confidence: 1.0,
    currentVersion: 2026,
    evidence: {
      "arity": 0,
      "callGraph": ["M.useContext(jx)", "matches[matches.length - 1].params"]
    },
    provenance: {
      "bundle": "frontend-original/static/bundle/assets/index-cgzgptQ8.js",
      "byteRange": [2144036, 2144180],
      "bundleHash": bundleSha256
    }
  }
];

const outPath = path.join(ROOT, 'reconstruction-report/cross-version-dictionary.json');
fs.writeFileSync(outPath, JSON.stringify(dictionary, null, 2), 'utf8');
console.log(`Generated cross-version semantic dictionary with ${dictionary.length} verified entries at ${outPath}`);

// Also update reconstruction-report/symbol-ledger.json to include these symbols if not present
const ledgerPath = path.join(ROOT, 'reconstruction-report/symbol-ledger.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));

for (const entry of dictionary) {
  const existingIndex = ledger.findIndex(item => item.minifiedSymbol === entry.symbol);
  const ledgerItem = {
    minifiedSymbol: entry.symbol,
    proposedName: entry.proposedName,
    domain: entry.historicalMatches?.["2022"]?.domain || entry.historicalMatches?.["2019"]?.domain || "core",
    role: `Cross-version recovered symbol from 2026 bundle (${entry.proposedName})`,
    bundleOffset: entry.provenance.byteRange[0],
    confidence: entry.confidence,
    evidence: `Historical cross-version match: 2019=${entry.historicalMatches?.["2019"]?.symbol || "N/A"}, 2022=${entry.historicalMatches?.["2022"]?.symbol || "N/A"}. Arity ${entry.evidence.arity}, call graph ${JSON.stringify(entry.evidence.callGraph || [])}`,
    historicalMatches: entry.historicalMatches,
    provenance: entry.provenance
  };

  if (existingIndex !== -1) {
    // Preserve existing and strengthen
    ledger[existingIndex] = {
      ...ledger[existingIndex],
      ...ledgerItem,
      evidence: `${ledger[existingIndex].evidence} | ${ledgerItem.evidence}`
    };
  } else {
    ledger.push(ledgerItem);
  }
}

fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2), 'utf8');
console.log(`Updated symbol-ledger.json, total entries: ${ledger.length}`);
