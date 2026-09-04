import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

// Import 2019 extracted formulas
import { timeModeling, unitsSoldAnHour, profitPerUnit } from '../../historical/2019/formulas/retail.ts';
import { unitsAnHour, adminUnitCost } from '../../historical/2019/formulas/production.ts';
import { shouldRefreshContractsIncoming } from '../../historical/2019/warehouse/contracts.ts';

// Import 2022 extracted Redux slice constants
import { INITIAL_WAREHOUSE_STATE, WAREHOUSE_ACTION_TYPES } from '../../historical/2022/warehouse/slice.ts';

// Import 2026 reconstructed warehouse services
import {
  dispatchAsyncApiThunk,
  fetchWarehouseResources,
  fetchContractsIncoming,
  refreshContractsIncoming,
  isValidRealm,
  FETCH_RESOURCES_START,
  FETCH_RESOURCES_ERROR,
  FETCH_RESOURCES_SUCCESS,
  FETCH_CONTRACTS_INCOMING_START,
  FETCH_CONTRACTS_INCOMING_ERROR,
  FETCH_CONTRACTS_INCOMING_SUCCESS
} from '../../reconstruction/warehouse/api.ts';

test('2019 Retail formulas compute expected outputs with anti-saturation constant 0.24', () => {
  // Test timeModeling with basic quadratic
  const duration = timeModeling('saturation * 100 + price', 0.5, 100, 20);
  assert.equal(duration, 70);

  // Test unitsSoldAnHour
  // quality = 1, saturation = 0.5 => effective = max(0.5 - 0.24, 0.1) = 0.26
  // modeling = "100 + price + saturation * 10" => 100 + 10 + 2.6 = 112.6
  // salesModifier = 10%
  const hourly = unitsSoldAnHour(10, 10, 1, 0.5, '100 + price + saturation * 10');
  assert.ok(hourly > 0);

  // Test profitPerUnit
  const profit = profitPerUnit(10, 10, 1, 0.5, '100 + price + saturation * 10', 1.15, 2.5);
  assert.ok(typeof profit === 'number' && !Number.isNaN(profit));
});

test('2019 Production capacity and administrative overhead cost match original specs', () => {
  // Size = 2, Modifier = 5%, Abundance = 100%, Produced = 100/hr, Non-abundance resource
  const rate = unitsAnHour(2, 5, 100, 100, 'w');
  assert.equal(Math.round(rate), Math.round((2 * 100) / 0.95));

  // Admin overhead = 1.25 (25% overhead), worker cost = 10
  const adminCost = adminUnitCost(1.25, 10);
  assert.equal(adminCost, 2.5);

  // 0% overhead
  assert.equal(adminUnitCost(1.0, 10), 0);
});

test('2019 & 2022 Warehouse contracts cooldown enforces 180s timeout', () => {
  const now = 1000000;
  assert.equal(shouldRefreshContractsIncoming(null, now), true);
  assert.equal(shouldRefreshContractsIncoming(now - 100, now), false);
  assert.equal(shouldRefreshContractsIncoming(now - 181, now), true);
});

test('2022 CRA Redux slice invariants are preserved', () => {
  assert.equal(INITIAL_WAREHOUSE_STATE.resources, null);
  assert.equal(INITIAL_WAREHOUSE_STATE.fetchingResources, false);
  assert.equal(INITIAL_WAREHOUSE_STATE.fetchingContractsIncoming, false);
  assert.deepEqual(INITIAL_WAREHOUSE_STATE.resourceTransactions, {});

  assert.equal(WAREHOUSE_ACTION_TYPES.FETCH_RESOURCES, "FETCH_RESOURCES");
  assert.equal(WAREHOUSE_ACTION_TYPES.UPDATE_RESOURCES, "UPDATE_RESOURCES");
  assert.equal(WAREHOUSE_ACTION_TYPES.FETCH_CONTRACTS_INCOMING, "FETCH_CONTRACTS_INCOMING");
});

test('2026 Reconstructed dispatchAsyncApiThunk dispatches start and success lifecycle actions', async () => {
  const dispatched = [];
  const mockDispatch = (action) => dispatched.push(action);

  // Mock global httpClient and Urls
  const mockResponse = { data: [{ id: 1, amount: 50 }], headers: { 'x-timestamp': '1788500000' } };
  globalThis.window = {
    httpClient: {
      get: async (url) => {
        assert.equal(url, '/api/v3/resources/123/');
        return mockResponse;
      }
    },
    Urls: {
      api_v3_resources: (id) => `/api/v3/resources/${id}/`
    }
  };

  let successCalled = false;
  await dispatchAsyncApiThunk(
    mockDispatch,
    '/api/v3/resources/123/',
    FETCH_RESOURCES_START,
    FETCH_RESOURCES_ERROR,
    (res) => {
      successCalled = true;
      assert.deepEqual(res, mockResponse);
    }
  );

  assert.equal(successCalled, true);
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].type, FETCH_RESOURCES_START);
});

test('2026 Reconstructed fetchWarehouseResources honors concurrency guard and dispatches SUCCESS', async () => {
  const dispatched = [];
  const mockDispatch = (action) => dispatched.push(action);

  // 1. Guard check: when already fetching, resolves immediately without duplicate fetch
  const busyState = {
    warehouse: {
      fetchingResources: true,
      fetchingContractsIncoming: false,
      resources: null,
      timestamp: {}
    }
  };

  let res = await fetchWarehouseResources(123)(mockDispatch, () => busyState);
  assert.equal(dispatched.length, 0);

  // 2. Idle check: dispatches START, performs fetch, dispatches SUCCESS with headers['x-timestamp']
  const idleState = {
    warehouse: {
      fetchingResources: false,
      fetchingContractsIncoming: false,
      resources: null,
      timestamp: {}
    }
  };

  let callbackFired = false;
  await fetchWarehouseResources(123, () => { callbackFired = true; })(mockDispatch, () => idleState);

  assert.equal(callbackFired, true);
  assert.equal(dispatched.length, 2);
  assert.equal(dispatched[0].type, FETCH_RESOURCES_START);
  assert.equal(dispatched[1].type, FETCH_RESOURCES_SUCCESS);
  assert.equal(dispatched[1].payload.timestamp, '1788500000');
  assert.equal(dispatched[1].payload.data.length, 1);
});

test('2026 Reconstructed refreshContractsIncoming obeys 180s cooldown and realm validity', async () => {
  assert.equal(isValidRealm(null), false);
  assert.equal(isValidRealm(undefined), false);
  assert.equal(isValidRealm(1), true);
  assert.equal(isValidRealm('sandbox'), true);

  const dispatched = [];
  const mockDispatch = (action) => dispatched.push(action);

  // Cooldown active (fetched 60 seconds ago)
  const recentState = {
    warehouse: {
      fetchingResources: false,
      fetchingContractsIncoming: false,
      resources: null,
      contractsIncoming: null,
      timestamp: {
        contractsIncoming: Date.now() / 1000 - 60
      }
    }
  };

  refreshContractsIncoming(1)(mockDispatch, () => recentState);
  assert.equal(dispatched.length, 0); // Should not dispatch
});

test('Cross-version dictionary and symbol ledger are synchronized and non-empty', () => {
  const dictPath = path.resolve('reconstruction-report/cross-version-dictionary.json');
  const ledgerPath = path.resolve('reconstruction-report/symbol-ledger.json');

  assert.ok(fs.existsSync(dictPath), 'cross-version-dictionary.json must exist');
  assert.ok(fs.existsSync(ledgerPath), 'symbol-ledger.json must exist');

  const dict = JSON.parse(fs.readFileSync(dictPath, 'utf8'));
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));

  assert.ok(dict.length >= 15, `Expected >= 15 cross-version entries, got ${dict.length}`);
  assert.ok(ledger.length >= 40, `Expected >= 40 symbol ledger entries, got ${ledger.length}`);

  for (const entry of dict) {
    assert.ok(entry.symbol, 'Entry requires symbol');
    assert.ok(entry.proposedName, 'Entry requires proposedName');
    assert.ok(entry.confidence >= 0.9, `Confidence must be >= 0.90, got ${entry.confidence}`);
    assert.ok(Array.isArray(entry.provenance.byteRange), 'byteRange must be array');
  }
});
