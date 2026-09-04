/**
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
