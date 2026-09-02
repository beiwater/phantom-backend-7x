import assert from 'node:assert';
import { handleWarehouseRoutes } from '../server/routes/warehouse-routes.ts';
import { db } from '../server/db/database.ts';

console.log('=== Verifying Warehouse Resource Statistics & Transactions (Issue #141) ===');

const testCompanyId = 1;
const testKind = 4; // Milk

// Clean old trades for testKind
db.prepare('DELETE FROM market_trades WHERE (buyer_id = ? OR seller_id = ?) AND kind = ?')
  .run(testCompanyId, testCompanyId, testKind);

// [1/3] Test empty statistics summary (Must return array `[]` so frontend renders empty state instead of infinite loading)
console.log('[1/3] Testing GET /api/v2/resources-transactions-summary/:companyId/:kind/ empty state...');
let emptySummaryPayload: any = null;
const mockEmptyRes: any = {
  statusCode: 200,
  getHeader() { return '*'; },
  setHeader() {},
  writeHead(code: number) { this.statusCode = code; },
  end(content: string) { emptySummaryPayload = JSON.parse(content); }
};

const emptyHandled = await handleWarehouseRoutes({} as any, mockEmptyRes, `/api/v2/resources-transactions-summary/${testCompanyId}/${testKind}/`, 'GET', testCompanyId);
assert.strictEqual(emptyHandled, true, 'Route must be handled');
assert.ok(Array.isArray(emptySummaryPayload), 'Summary response MUST be an array');
assert.strictEqual(emptySummaryPayload.length, 0, 'Empty transactions must return empty array []');
console.log('  -> Empty summary returned array [] successfully.');
db.prepare(`
  INSERT INTO market_trades (kind, quality, price, amount, fee, buyer_id, seller_id, traded_at, trade_date)
  VALUES (?, 0, 2.50, 100, 0, ?, 9999, datetime('now'), date('now'))
`).run(testKind, testCompanyId);

let populatedSummaryPayload: any = null;
const mockPopulatedRes: any = {
  statusCode: 200,
  getHeader() { return '*'; },
  setHeader() {},
  writeHead(code: number) { this.statusCode = code; },
  end(content: string) { populatedSummaryPayload = JSON.parse(content); }
};

const popHandled = await handleWarehouseRoutes({} as any, mockPopulatedRes, `/api/v2/resources-transactions-summary/${testCompanyId}/${testKind}/`, 'GET', testCompanyId);
assert.strictEqual(popHandled, true);
assert.ok(Array.isArray(populatedSummaryPayload), 'Populated summary must be an array');
assert.strictEqual(populatedSummaryPayload.length, 1);
assert.strictEqual(populatedSummaryPayload[0].category, 'bought');
assert.strictEqual(populatedSummaryPayload[0].amount, 100);
assert.strictEqual(populatedSummaryPayload[0].avgPrice, 2.50);
console.log('  -> Populated summary returned category rows:', populatedSummaryPayload);

// [3/3] Test GET /api/v2/resources-transactions/:kind/:fromId/
console.log('[3/3] Testing GET /api/v2/resources-transactions/:kind/:fromId/...');
let txListPayload: any = null;
const mockTxListRes: any = {
  statusCode: 200,
  getHeader() { return '*'; },
  setHeader() {},
  writeHead(code: number) { this.statusCode = code; },
  end(content: string) { txListPayload = JSON.parse(content); }
};

const txListHandled = await handleWarehouseRoutes({} as any, mockTxListRes, `/api/v2/resources-transactions/${testKind}/0/`, 'GET', testCompanyId);
assert.strictEqual(txListHandled, true);
assert.ok(Array.isArray(txListPayload), 'Transactions list must be an array');
assert.strictEqual(txListPayload.length, 1);
assert.strictEqual(txListPayload[0].kind, testKind);
assert.strictEqual(txListPayload[0].amount, 100);

// Cleanup
db.prepare('DELETE FROM market_trades WHERE (buyer_id = ? OR seller_id = ?) AND kind = ?')
  .run(testCompanyId, testCompanyId, testKind);

console.log('================================================================');
console.log(' [OK] ISSUE #141 WAREHOUSE RESOURCE STATISTICS PASSED ALL TESTS');
console.log('================================================================');
