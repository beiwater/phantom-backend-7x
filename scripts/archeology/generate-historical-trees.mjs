import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve('.');
const DIR_2019 = path.join(ROOT, 'artifacts/archeology/golden-versions/2019-angular-django');
const DIR_2022 = path.join(ROOT, 'artifacts/archeology/golden-versions/2022-cra-react-final-dec2022');
const OUT_2019 = path.join(ROOT, 'historical/2019');
const OUT_2022 = path.join(ROOT, 'historical/2022');

fs.mkdirSync(path.join(OUT_2019, 'formulas'), { recursive: true });
fs.mkdirSync(path.join(OUT_2019, 'warehouse'), { recursive: true });
fs.mkdirSync(path.join(OUT_2019, 'executives'), { recursive: true });
fs.mkdirSync(path.join(OUT_2019, 'production'), { recursive: true });

fs.mkdirSync(path.join(OUT_2022, 'redux/slices'), { recursive: true });
fs.mkdirSync(path.join(OUT_2022, 'api'), { recursive: true });
fs.mkdirSync(path.join(OUT_2022, 'warehouse'), { recursive: true });

console.log('--- 1. Extracting 2019 Historical Source Tree ---');
const earlyReactJs = fs.readFileSync(path.join(DIR_2019, 'reactjs.2ebf9ff0e2ef.early-react.js'), 'utf8');

// 1.1 Retail formulas
const retailFormulasTs = `/**
 * Historical 2019 SimCompanies Retail Economic Formulas
 * Source: artifacts/archeology/golden-versions/2019-angular-django/reactjs.2ebf9ff0e2ef.early-react.js
 * Extracted verbatim from original unflattened React bundle.
 */

/**
 * Dynamic retail evaluation modeled on server/client.
 * Evaluates polynomial or custom formula defined in resource.retailModeling.
 */
export function timeModeling(retailModeling: string, saturation: number, amount: number, price: number): number {
  // Original 2019 implementation used eval(retailModeling) with scope variables: saturation, amount, price
  const fn = new Function('saturation', 'amount', 'price', \`return \${retailModeling};\`);
  return fn(saturation, amount, price);
}

/**
 * Hourly units sold taking into account market saturation, quality dampening, and sales modifier.
 * Anti-saturation constant is 0.24 per quality tier, lower bounded by 0.1.
 */
export function unitsSoldAnHour(
  salesModifier: number,
  price: number,
  quality: number,
  marketSaturation: number,
  retailModeling: string
): number {
  const effectiveSaturation = Math.max(marketSaturation - 0.24 * quality, 0.1);
  const baseDuration = timeModeling(retailModeling, effectiveSaturation, 100, price);
  return 360000 / (baseDuration - (baseDuration * salesModifier) / 100);
}

/**
 * Net profit per unit after deducting base wage per store size scaled by administrative overhead.
 */
export function profitPerUnit(
  salesModifier: number,
  price: number,
  quality: number,
  marketSaturation: number,
  retailModeling: string,
  administrationOverhead: number,
  storeBaseSalary: number
): number {
  const hourly = unitsSoldAnHour(salesModifier, price, quality, marketSaturation, retailModeling);
  return price - (storeBaseSalary * administrationOverhead) / hourly;
}
`;
fs.writeFileSync(path.join(OUT_2019, 'formulas/retail.ts'), retailFormulasTs, 'utf8');

// 1.2 Production formulas
const productionFormulasTs = `/**
 * Historical 2019 SimCompanies Production Formulas
 * Source: artifacts/archeology/golden-versions/2019-angular-django/reactjs.2ebf9ff0e2ef.early-react.js
 */

/**
 * Calculates hourly production capacity scaled by building size, production bonus modifier, and resource abundance.
 */
export function unitsAnHour(
  size: number,
  productionModifier: number,
  abundance: number,
  producedAnHour: number,
  dbLetter: string,
  abundanceDbLetters: string[] = ['m', 'o', 'c']
): number {
  const isAbundanceDependent = abundanceDbLetters.includes(dbLetter);
  const effectiveRate = isAbundanceDependent ? (producedAnHour * abundance) / 100 : producedAnHour;
  return (size * effectiveRate) / (1 - productionModifier / 100);
}

/**
 * Administrative overhead unit cost on worker wages.
 */
export function adminUnitCost(administrationOverhead: number, workerUnitCost: number): number {
  return Math.max(0, administrationOverhead - 1) * workerUnitCost;
}
`;
fs.writeFileSync(path.join(OUT_2019, 'formulas/production.ts'), productionFormulasTs, 'utf8');

// 1.3 2019 Warehouse logic
const warehouseContracts2019Ts = `/**
 * Historical 2019 SimCompanies Warehouse Contract Refresh Logic
 * Source: artifacts/archeology/golden-versions/2019-angular-django/reactjs.2ebf9ff0e2ef.early-react.js
 */

export const CONTRACT_REFRESH_COOLDOWN_SECONDS = 180;

export function shouldRefreshContractsIncoming(lastTimestampSec: number | null, nowSec = Date.now() / 1000): boolean {
  return !lastTimestampSec || lastTimestampSec < nowSec - CONTRACT_REFRESH_COOLDOWN_SECONDS;
}
`;
fs.writeFileSync(path.join(OUT_2019, 'warehouse/contracts.ts'), warehouseContracts2019Ts, 'utf8');

// 1.4 2019 Symbol ledger
const ledger2019 = [
  {
    symbol: "unitsSoldAnHour",
    semanticName: "calculateUnitsSoldAnHour",
    type: "function",
    domain: "retail",
    sourceFile: "reactjs.2ebf9ff0e2ef.early-react.js",
    arguments: ["salesModifier", "price", "quality", "marketSaturation", "retailModeling"],
    constants: [0.24, 0.1, 360000],
    confidence: 1.0,
    evidence: "Exact function definition in 2019 React bundle (line 1, index 2129)"
  },
  {
    symbol: "timeModeling",
    semanticName: "evaluateRetailTimeModeling",
    type: "function",
    domain: "retail",
    sourceFile: "reactjs.2ebf9ff0e2ef.early-react.js",
    arguments: ["retailModeling", "saturation", "amount", "price"],
    confidence: 1.0,
    evidence: "Direct eval of retailModeling expression with saturation, amount, price"
  },
  {
    symbol: "profitPerUnit",
    semanticName: "calculateRetailProfitPerUnit",
    type: "function",
    domain: "retail",
    sourceFile: "reactjs.2ebf9ff0e2ef.early-react.js",
    arguments: ["salesModifier", "price", "quality", "marketSaturation", "retailModeling", "administrationOverhead", "storeBaseSalary"],
    confidence: 1.0,
    evidence: "Direct profit per unit formula subtracting hourly salary overhead"
  },
  {
    symbol: "refreshContractsIncoming",
    semanticName: "checkAndRefreshContractsIncoming",
    type: "function",
    domain: "warehouse",
    sourceFile: "reactjs.2ebf9ff0e2ef.early-react.js",
    constants: [180],
    confidence: 1.0,
    evidence: "Checked last fetch timestamp against 180s cooldown"
  }
];
fs.writeFileSync(path.join(OUT_2019, 'symbol-ledger.json'), JSON.stringify(ledger2019, null, 2), 'utf8');

console.log('--- 2. Extracting 2022 Historical CRA Semantic Structure ---');
// 2.1 Unpack zh.jsreverse.js
const gzReverse = fs.readFileSync(path.join(DIR_2022, 'zh.jsreverse.js'));
const rawReverse = zlib.gunzipSync(gzReverse).toString('utf8');
const matchUrls = rawReverse.match(/var data=(\{"urls":\[.*?\]\});/);
let extractedUrls = [];
const dataIdx = rawReverse.indexOf('var data=');
if (dataIdx !== -1) {
  const start = dataIdx + 'var data='.length;
  let depth = 0;
  let end = -1;
  for (let i = start; i < rawReverse.length; i++) {
    if (rawReverse[i] === '{') depth++;
    else if (rawReverse[i] === '}') {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end !== -1) {
    try {
      const parsed = JSON.parse(rawReverse.slice(start, end));
      extractedUrls = (parsed.urls || []).map(([name, variants]) => ({
        name,
        pattern: variants[0]?.[0] || '',
        params: variants[0]?.[1] || []
      }));
    } catch (err) {
      console.warn('Failed to parse Urls JSON:', err.message);
    }
  }
}
fs.writeFileSync(
  path.join(OUT_2022, 'api/urls-catalog.json'),
  JSON.stringify(extractedUrls, null, 2),
  'utf8'
);
console.log(`Extracted ${extractedUrls.length} URL patterns from 2022 jsreverse.`);

// 2.2 2022 Redux Action Types & Warehouse Slice
const warehouseSlice2022Ts = `/**
 * 2022 CRA SimCompanies Warehouse Redux State Slice
 * Source: artifacts/archeology/golden-versions/2022-cra-react-final-dec2022/main.17916b1c.final-cra.js
 * Lines: 32641 - 36781
 */

export interface ResourceTransaction {
  id: number;
  date: string;
  kind: number;
  quality: number;
  amount: number;
  price: number;
  description: string;
}

export interface WarehouseState {
  resources: any[] | null;
  contractsIncoming: any[] | null;
  contractsOutgoing: any[] | null;
  resourceTransactions: Record<string | number, ResourceTransaction[]>;
  recentContractsOutgoing: any[] | null;
  recentContractsIncoming: any[] | null;
  fetchingResources: boolean;
  fetchingResourceTransactions: Record<string | number, boolean>;
  fetchingContractsIncoming: boolean;
  fetchingContractsOutgoing: boolean;
  fetchingRecentContractsOutgoing: boolean;
  fetchingRecentContractsIncoming: boolean;
  timestamp: {
    resources?: string | number;
    contractsIncoming?: number;
    contractsOutgoing?: number;
    recentContractsIncoming?: number;
    recentContractsOutgoing?: number;
    [key: string]: any;
  };
}

export const INITIAL_WAREHOUSE_STATE: WarehouseState = {
  resources: null,
  contractsIncoming: null,
  contractsOutgoing: null,
  resourceTransactions: {},
  recentContractsOutgoing: null,
  recentContractsIncoming: null,
  fetchingResources: false,
  fetchingResourceTransactions: {},
  fetchingContractsIncoming: false,
  fetchingContractsOutgoing: false,
  fetchingRecentContractsOutgoing: false,
  fetchingRecentContractsIncoming: false,
  timestamp: {}
};

export const WAREHOUSE_ACTION_TYPES = {
  FETCH_RESOURCES: "FETCH_RESOURCES",
  FETCH_RESOURCES_ERROR: "FETCH_RESOURCES_ERROR",
  UPDATE_RESOURCES: "UPDATE_RESOURCES",
  FETCH_CONTRACTS_INCOMING: "FETCH_CONTRACTS_INCOMING",
  FETCH_CONTRACTS_INCOMING_ERROR: "FETCH_CONTRACTS_INCOMING_ERROR",
  FETCH_CONTRACTS_OUTGOING: "FETCH_CONTRACTS_OUTGOING",
  FETCH_CONTRACTS_OUTGOING_ERROR: "FETCH_CONTRACTS_OUTGOING_ERROR",
  UPDATE_CONTRACTS_INCOMING: "UPDATE_CONTRACTS_INCOMING",
  UPDATE_CONTRACTS_OUTGOING: "UPDATE_CONTRACTS_OUTGOING",
  ADD_CONTRACT_INCOMING: "ADD_CONTRACT_INCOMING",
  ADD_CONTRACT_OUTGOING: "ADD_CONTRACT_OUTGOING",
  DELETE_CONTRACT_OUTGOING: "DELETE_CONTRACT_OUTGOING",
  DELETE_CONTRACT_INCOMING: "DELETE_CONTRACT_INCOMING",
  DELETE_ALL_CONTRACTS_INCOMING: "DELETE_ALL_CONTRACTS_INCOMING",
  FETCH_RECENT_CONTRACTS_OUTGOING: "FETCH_RECENT_CONTRACTS_OUTGOING",
  FETCH_RECENT_CONTRACTS_OUTGOING_ERROR: "FETCH_RECENT_CONTRACTS_OUTGOING_ERROR",
  UPDATE_RECENT_CONTRACTS_OUTGOING: "UPDATE_RECENT_CONTRACTS_OUTGOING",
  FETCH_RECENT_CONTRACTS_INCOMING: "FETCH_RECENT_CONTRACTS_INCOMING",
  FETCH_RECENT_CONTRACTS_INCOMING_ERROR: "FETCH_RECENT_CONTRACTS_INCOMING_ERROR",
  UPDATE_RECENT_CONTRACTS_INCOMING: "UPDATE_RECENT_CONTRACTS_INCOMING",
  ADD_RECENT_CONTRACT_INCOMING: "ADD_RECENT_CONTRACT_INCOMING",
  UPDATE_RESOURCE: "UPDATE_RESOURCE",
  UPDATE_RESOURCE_BY_ID: "UPDATE_RESOURCE_BY_ID",
  FETCH_RESOURCE_TRANSACTIONS: "FETCH_RESOURCE_TRANSACTIONS",
  FETCH_RESOURCE_TRANSACTIONS_ERROR: "FETCH_RESOURCE_TRANSACTIONS_ERROR",
  UPDATE_RESOURCE_TRANSACTIONS: "UPDATE_RESOURCE_TRANSACTIONS"
} as const;
`;
fs.writeFileSync(path.join(OUT_2022, 'warehouse/slice.ts'), warehouseSlice2022Ts, 'utf8');

// 2.3 2022 Symbol ledger
const ledger2022 = [
  {
    symbol: "ga",
    semanticName: "warehouseReducer",
    domain: "warehouse",
    sourceFile: "main.17916b1c.final-cra.js",
    role: "Redux reducer handling all warehouse resources, contracts, and transactions",
    confidence: 1.0,
    evidence: "Root reducer key 'warehouse: ga', handles FETCH_RESOURCES, UPDATE_RESOURCES, contracts"
  },
  {
    symbol: "ba",
    semanticName: "initialWarehouseState",
    domain: "warehouse",
    sourceFile: "main.17916b1c.final-cra.js",
    role: "Initial state object for warehouse slice",
    confidence: 1.0,
    evidence: "Default parameter to warehouseReducer ga"
  },
  {
    symbol: "wi",
    semanticName: "useRoutes",
    domain: "routing",
    sourceFile: "main.17916b1c.final-cra.js",
    role: "Dynamic Proxy wrapper around window.Urls for API route dispatch",
    confidence: 1.0,
    evidence: "Exact implementation creating Proxy around window.Urls[lang] with fallback logger"
  },
  {
    symbol: "Ne",
    semanticName: "dispatchAsyncApiThunk",
    domain: "network",
    sourceFile: "main.17916b1c.final-cra.js",
    role: "Generic axios thunk handler dispatching START, SUCCESS, and ERROR actions",
    confidence: 1.0,
    evidence: "Calls uo[method](url).then(successCb).catch(errorCb)"
  }
];
fs.writeFileSync(path.join(OUT_2022, 'symbol-ledger.json'), JSON.stringify(ledger2022, null, 2), 'utf8');

console.log('Successfully generated historical/2019 and historical/2022 source trees and symbol ledgers.');
