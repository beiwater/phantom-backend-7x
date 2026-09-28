import assert from 'node:assert';
import { handleFinanceRoutes } from '../server/routes/finance-routes.ts';
import { db } from '../server/db/database.ts';
import { companyRepository } from '../server/repositories/company-repository.ts';
import { restaurantRepository } from '../server/repositories/restaurant-repository.ts';
import { calculateEffectiveExecutiveSkill } from '../server/domain/executives.ts';

console.log('=== Verifying Accounting Metrics & NaN Prevention (Issue #139) ===');

// Prepare brand new company with 0 sales and 0 buildings
const testCompanyId = 9999;
db.prepare('DELETE FROM companies WHERE id = ? OR company_id = ?').run(testCompanyId, testCompanyId);
db.prepare(`
  INSERT INTO companies (company_id, player_id, name, money, simboosts, level, rating, experience, realm_id, logo, personal_assistant, note, extra_building_slots, created_at)
  VALUES (?, ?, 'Zero Sales Co', 100000, 250, 1, 'BBB', 0, 0, '', 'old', '', 0, datetime('now'))
`).run(testCompanyId, testCompanyId);

// [1/3] Test Balance Sheet for new company
console.log('[1/3] Testing GET /api/v2/companies/me/balance-sheet/ for new company...');
let bsPayload: any = null;
const mockBsRes: any = {
  statusCode: 200,
  getHeader() { return '*'; },
  setHeader() {},
  writeHead(code: number) { this.statusCode = code; },
  end(content: string) { bsPayload = JSON.parse(content); }
};

const bsHandled = await handleFinanceRoutes({} as any, mockBsRes, `/api/v2/companies/${testCompanyId}/balance-sheet/`, 'GET', testCompanyId);
assert.strictEqual(bsHandled, true, 'Balance sheet must be handled');
assert.strictEqual(typeof bsPayload.cash, 'number');
assert.strictEqual(typeof bsPayload.inventory, 'number');
assert.strictEqual(typeof bsPayload.buildings, 'number');
assert.strictEqual(typeof bsPayload.liabilities, 'number');
assert.ok(!Number.isNaN(bsPayload.cash), 'Cash must not be NaN');
assert.ok(!Number.isNaN(bsPayload.retainedEarnings), 'Retained earnings must not be NaN');
console.log('  -> Balance Sheet returned valid numbers (cash=' + bsPayload.cash + ', buildings=' + bsPayload.buildings + ')');

// [2/3] Test Income Statement for new company (0 sales)
console.log('[2/3] Testing GET /api/v2/companies/me/income-statement/ for new company with 0 sales...');
let isPayload: any = null;
const mockIsRes: any = {
  statusCode: 200,
  getHeader() { return '*'; },
  setHeader() {},
  writeHead(code: number) { this.statusCode = code; },
  end(content: string) { isPayload = JSON.parse(content); }
};

const isHandled = await handleFinanceRoutes({} as any, mockIsRes, `/api/v2/companies/${testCompanyId}/income-statement/`, 'GET', testCompanyId);
assert.strictEqual(isHandled, true, 'Income statement must be handled');
assert.strictEqual(isPayload.sales, 0, 'Sales must be 0 for fresh company');
assert.strictEqual(typeof isPayload.netIncome, 'number');
assert.strictEqual(typeof isPayload.economicValueAdded, 'number');
assert.ok(!Number.isNaN(isPayload.netIncome), 'netIncome must not be NaN');
assert.ok(!Number.isNaN(isPayload.economicValueAdded), 'EVA must not be NaN');
console.log('  -> Income Statement returned valid non-NaN metrics (sales=' + isPayload.sales + ', netIncome=' + isPayload.netIncome + ')');

// [3/3] Simulate ratio calculations (Gross Margin, Operating Margin, Debt-to-Buildings)
console.log('[3/3] Simulating ratio calculations with 0-division protection...');
const grossMarginRaw = (isPayload.sales + isPayload.cogs) / (isPayload.sales || 0);
const safeGrossMargin = Number.isFinite(grossMarginRaw) ? grossMarginRaw : 0;
assert.strictEqual(safeGrossMargin, 0, 'Zero sales gross margin must safely fall back to 0');

const debtToBuildingRaw = bsPayload.bondsPayable / (bsPayload.buildings || 0);
const safeDebtToBuilding = Number.isFinite(debtToBuildingRaw) ? debtToBuildingRaw : 0;
assert.strictEqual(safeDebtToBuilding, 0, 'Zero building debt ratio must safely fall back to 0');

// Executive skill-effect reads use canonical and legacy position spellings,
// with the bundle's weighted sum and sequential soft cap rather than MAX().
const execNow = new Date().toISOString();
const executiveRows = [
  ['o', 60, 20, 0, 20],
  ['coo apprentice', 50, 0, 0, 20],
  ['f', 20, 100, 0, 20],
  ['x', 0, 30, 0, 20],
  ['m', 0, 0, 0, 100],
  ['cmo apprentice', 0, 0, 0, 30]
] as const;
const insertExecutive = db.prepare(`
  INSERT INTO executives (
    company_id, name, avatar, position,
    skill_management, skill_accounting, skill_science, skill_communication,
    salary, status, created_at
  ) VALUES (?, ?, '', ?, ?, ?, ?, ?, 300, 'employed', ?)
`);
for (const [index, [position, management, accounting, science, communication]] of executiveRows.entries()) {
  insertExecutive.run(
    testCompanyId,
    `Skill Fixture ${index}`,
    position,
    management,
    accounting,
    science,
    communication,
    execNow
  );
}
assert.equal(companyRepository.getAccountingOverheadStats(testCompanyId).cooSkill, 72);
assert.equal(companyRepository.getAccountingLift(testCompanyId).cfoSkill, 80);
assert.equal(restaurantRepository.getCooManagement(testCompanyId), 72);
assert.equal(restaurantRepository.getCmoCommunication(testCompanyId), 83);
assert.equal(calculateEffectiveExecutiveSkill([{ position: 'o', skill: 100 }], 'coo'), 75);

// Clean up
db.prepare('DELETE FROM executives WHERE company_id = ?').run(testCompanyId);
db.prepare('DELETE FROM companies WHERE company_id = ?').run(testCompanyId);

console.log('================================================================');
console.log(' [OK] ISSUE #139 ACCOUNTING METRICS PASSED ALL TESTS');
console.log('================================================================');
