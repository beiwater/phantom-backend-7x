/**
 * Reconstructed 2026 Warehouse API Services
 * Provenance: frontend-original/static/bundle/assets/index-cgzgptQ8.js
 * Historical matches: 2019 early-react.js & 2022 main.17916b1c.final-cra.js
 */

export const FETCH_RESOURCES_START = "FETCH_RESOURCES_START";
export const FETCH_RESOURCES_ERROR = "FETCH_RESOURCES_ERROR";
export const FETCH_RESOURCES_SUCCESS = "FETCH_RESOURCES_SUCCESS";
export const FETCH_CONTRACTS_INCOMING_START = "FETCH_CONTRACTS_INCOMING_START";
export const FETCH_CONTRACTS_INCOMING_ERROR = "FETCH_CONTRACTS_INCOMING_ERROR";
export const FETCH_CONTRACTS_INCOMING_SUCCESS = "FETCH_CONTRACTS_INCOMING_SUCCESS";

export interface HttpResponse<T = unknown> {
  data: T;
  headers: Record<string, string>;
}

export interface HttpClient {
  get<T = unknown>(url: string): Promise<HttpResponse<T>>;
  post<T = unknown>(url: string, data?: unknown): Promise<HttpResponse<T>>;
  patch<T = unknown>(url: string, data?: unknown): Promise<HttpResponse<T>>;
  delete<T = unknown>(url: string): Promise<HttpResponse<T>>;
  [method: string]: unknown;
}

export interface RouteDirectory {
  api_v3_resources(companyId: string | number): string;
  api_v3_contract_incoming(realmId: string | number, target: string): string;
  [endpoint: string]: unknown;
}

export interface WarehouseStateSlice {
  fetchingResources: boolean;
  fetchingContractsIncoming: boolean;
  resources: unknown[] | null;
  contractsIncoming: unknown[] | null;
  timestamp: {
    resources?: string | number;
    contractsIncoming?: number;
    [key: string]: unknown;
  };
}

export interface ReduxRootState {
  warehouse: WarehouseStateSlice;
  user?: unknown;
}

export type AppDispatch = (action: { type: string; payload?: unknown }) => unknown;
export type AppGetState = () => ReduxRootState;

declare const window: {
  httpClient: HttpClient;
  Urls: RouteDirectory;
};
export function isValidRealm(realmId: unknown): boolean {
  return realmId != null;
}

export function getHttpClient(): HttpClient {
  return window.httpClient;
}

export function useRoutes(): RouteDirectory {
  return window.Urls;
}
/**
 * Verbatim counterpart to production symbol `za`.
 * Generic asynchronous API thunk dispatcher handling action lifecycle and errors.
 */
export function dispatchAsyncApiThunk(
  dispatch: AppDispatch,
  url: string,
  startActionType: string,
  errorActionType: string,
  onSuccess: (res: HttpResponse) => void,
  payload = {},
  method = "get"
) {
  return (
    dispatch({ type: startActionType, payload }),
    getHttpClient()[method](url).then(onSuccess).catch(() => dispatch({ type: errorActionType, payload }))
  );
}

/**
 * Verbatim counterpart to production symbol `Fa`.
 * Fetches user warehouse resources with concurrency guard and timestamp caching.
 */
export const fetchWarehouseResources = (companyId: string | number, callback = void 0) => (dispatch: AppDispatch, getState: AppGetState) =>
  getState().warehouse.fetchingResources
    ? Promise.resolve()
    : dispatchAsyncApiThunk(
        dispatch,
        useRoutes().api_v3_resources(companyId),
        FETCH_RESOURCES_START,
        FETCH_RESOURCES_ERROR,
        ({ data, headers }: HttpResponse) => {
          dispatch({
            type: FETCH_RESOURCES_SUCCESS,
            payload: { data, timestamp: headers["x-timestamp"] },
          });
          callback && callback();
        }
      );

/**
 * Verbatim counterpart to production symbol `Qpr`.
 * Fetches incoming contracts for the company in the active realm.
 */
export const fetchContractsIncoming = (dispatch: AppDispatch, realmId: string | number, getState: AppGetState) => {
  getState().warehouse.fetchingContractsIncoming ||
    dispatchAsyncApiThunk(
      dispatch,
      useRoutes().api_v3_contract_incoming(realmId, "me"),
      FETCH_CONTRACTS_INCOMING_START,
      FETCH_CONTRACTS_INCOMING_ERROR,
      ({ data, headers }: HttpResponse) => {
        dispatch({
          type: FETCH_CONTRACTS_INCOMING_SUCCESS,
          payload: { data, realmId, timestamp: headers["x-timestamp"] },
        });
      }
    );
};

/**
 * Verbatim counterpart to production symbol `ev`.
 * Checks the 180s cooldown timer before dispatching fetchContractsIncoming.
 */
export const refreshContractsIncoming = (realmId: string | number) => (dispatch: AppDispatch, getState: AppGetState) => {
  const { contractsIncoming } = getState().warehouse.timestamp;
  const nowSec = new Date().getTime() / 1e3;
  isValidRealm(realmId) && (!contractsIncoming || contractsIncoming < nowSec - 60 * 3) && fetchContractsIncoming(dispatch, realmId, getState);
};
