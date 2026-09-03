import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { db } from '../server/db/database.ts';
import { handleFinanceRoutes } from '../server/routes/finance-routes.ts';

interface CapturedResponse {
  statusCode: number;
  body: unknown;
}

interface MockResponse {
  statusCode: number;
  setHeader(name: string, value: string | string[]): void;
  getHeader(name: string): string | string[] | undefined;
  writeHead(status: number): void;
  end(content?: string): void;
}

const companyId = 991234;

function captureResponse(): { response: ServerResponse; result: CapturedResponse } {
  const result: CapturedResponse = { statusCode: 0, body: undefined };
  const mock: MockResponse = {
    statusCode: 0,
    setHeader: () => undefined,
    getHeader: () => undefined,
    writeHead(status: number): void {
      this.statusCode = status;
      result.statusCode = status;
    },
    end(content?: string): void {
      result.body = content === undefined ? null : JSON.parse(content);
    }
  };
  return { response: mock as unknown as ServerResponse, result };
}

async function request(pathname: string): Promise<CapturedResponse> {
  const captured = captureResponse();
  const handled = await handleFinanceRoutes(
    {} as IncomingMessage,
    captured.response,
    pathname,
    'GET',
    companyId
  );
  assert.equal(handled, true, `${pathname} must be handled`);
  return captured.result;
}

function assertNumberFields(
  body: unknown,
  fields: readonly string[],
  label: string,
  hasDateFrom = true,
  hasComputed = true
): void {
  assert.ok(body && typeof body === 'object', `${label} must be an object`);
  const record = body as Record<string, unknown>;
  for (const field of fields) {
    const value = record[field];
    assert.equal(typeof value, 'number', `${label}.${field} must be numeric`);
    if (typeof value === 'number') {
      assert.ok(Number.isFinite(value), `${label}.${field} must be finite`);
    }
  }
  assert.equal(typeof record.date, 'string', `${label}.date must be a timestamp`);
  if (hasDateFrom) {
    assert.equal(typeof record.dateFrom, 'string', `${label}.dateFrom must be a timestamp`);
  }
  if (hasComputed) {
    assert.equal(record.isComputed, true, `${label}.isComputed must be true`);
  }
}

const incomeNumberFields = [
  'sales', 'cogs', 'freightOut', 'constructionCosts', 'marketFees', 'salariesCosts',
  'trainingCosts', 'poachingCosts', 'gameIncome', 'executiveRoyalties', 'gainOnSale',
  'patentConversion', 'bondDefaults', 'bondWriteoffs', 'accountingOverhead',
  'bondInterestExpense', 'bondInterestIncome', 'donations', 'otherComprehensiveIncome',
  'netIncome', 'economicValueAdded', 'cashAllExpenses'
] as const;

const cashflowNumberFields = [
  'fromRetail', 'fromCustomers', 'fromExchange', 'fromInterest', 'fromPoaching',
  'fromGame', 'fromEmployees', 'fromRoyalties', 'toGame', 'toSuppliers', 'toExchange',
  'toEmployees', 'toExecutives', 'forInterest', 'forFees', 'forAccounting',
  'investmentInBonds', 'bonds', 'gameIncome', 'cashAllIncome', 'cashAllExpenses'
] as const;

const balanceNumberFields = [
  'cash', 'cashReservedForOrders', 'accountsReceivable', 'workInProcess', 'materials',
  'research', 'finishedGoods', 'investmentInBonds', 'buildings', 'constructionInProgress',
  'patents', 'bondsPayable', 'contributedCapital', 'retainedEarnings', 'valuationAllowance',
  'deposits'
] as const;

try {
  db.prepare('DELETE FROM companies WHERE company_id = ? OR id = ?').run(companyId, companyId);
  db.prepare(`
    INSERT INTO companies (company_id, player_id, name, money, simboosts, level, rating, experience, realm_id, created_at)
    VALUES (?, ?, 'Financial Statement Contract', 100000, 250, 1, 'BBB', 0, 0, datetime('now'))
  `).run(companyId, companyId);
  db.prepare(`
    INSERT INTO market_orders
      (seller_id, kind, quality, quantity, price, posted_at, active, is_buy)
    VALUES (?, 1, 0, 3, 25, datetime('now'), 1, 1)
  `).run(companyId);
  db.prepare(`
    INSERT INTO retail_orders
      (building_id, company_id, resource_kind, quality, units, unit_price, cost, finished_at, created_at)
    VALUES (0, ?, 3, 0, 2, 40, 3, '2000-01-01T00:00:00.000Z', datetime('now'))
  `).run(companyId);
  db.prepare(`
    INSERT INTO production_queues
      (building_id, company_id, kind, quality, cost, amount, duration_seconds, started_at, finishes_at, resolved)
    VALUES (0, ?, 3, 0, 2, 10, 3600, datetime('now'), '2999-01-01T00:00:00.000Z', 0)
  `).run(companyId);

  const before = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM companies WHERE company_id = ?) AS companies,
      (SELECT COUNT(*) FROM cash_ledger WHERE company_id = ?) AS ledger,
      (SELECT COUNT(*) FROM finance_daily_snapshots WHERE company_id = ?) AS snapshots
  `).get(companyId, companyId, companyId) as { companies: number; ledger: number; snapshots: number };
  const balance = await request(`/api/v2/companies/${companyId}/balance-sheet/`);
  assert.equal(balance.statusCode, 200);
  assertNumberFields(balance.body, balanceNumberFields, 'balance-sheet', false, false);
  const balanceBody = balance.body as Record<string, unknown>;
  assert.equal(balanceBody.cashReservedForOrders, 75);
  assert.equal(balanceBody.accountsReceivable, 80);
  assert.equal(balanceBody.workInProcess, 20);
  assert.equal(typeof balanceBody.money, 'number');
  assert.equal(typeof balanceBody.inventory, 'number');
  assert.equal(typeof balanceBody.liabilities, 'number');

  const income = await request('/api/v2/companies/me/income-statement/');
  assert.equal(income.statusCode, 200);
  assertNumberFields(income.body, incomeNumberFields, 'income-statement');

  const cashflow = await request('/api/v2/companies/me/cashflow-statement/');
  assert.equal(cashflow.statusCode, 200);
  assertNumberFields(cashflow.body, cashflowNumberFields, 'cashflow-statement');

  const after = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM companies WHERE company_id = ?) AS companies,
      (SELECT COUNT(*) FROM cash_ledger WHERE company_id = ?) AS ledger,
      (SELECT COUNT(*) FROM finance_daily_snapshots WHERE company_id = ?) AS snapshots
  `).get(companyId, companyId, companyId) as { companies: number; ledger: number; snapshots: number };
  assert.deepEqual(after, before, 'financial statement GETs must not mutate durable state');
} finally {
  db.prepare('DELETE FROM market_orders WHERE seller_id = ?').run(companyId);
  db.prepare('DELETE FROM retail_orders WHERE company_id = ?').run(companyId);
  db.prepare('DELETE FROM production_queues WHERE company_id = ?').run(companyId);
  db.prepare('DELETE FROM companies WHERE company_id = ? OR id = ?').run(companyId, companyId);
  db.prepare('DELETE FROM cash_ledger WHERE company_id = ?').run(companyId);
  db.prepare('DELETE FROM finance_daily_snapshots WHERE company_id = ?').run(companyId);
}

console.log('[OK] financial statement contract and read-only checks passed');
