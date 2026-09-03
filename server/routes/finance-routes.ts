import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson, readJsonBody } from './utils.ts';
import { RouteRegistry, globalRouteRegistry } from '../http/route-registry.ts';
import { fpaReportsRepository } from '../repositories/fpa-reports-repository.ts';
import { companyRepository } from '../repositories/company-repository.ts';
import { financeRepository } from '../repositories/finance-repository.ts';

const REPORT_CATEGORIES = ['Production', 'Retail', 'Financial', 'Warehouse', 'Market'];
import { getCompanyById } from '../game/company.ts';
import { takeLoan, repayLoan, getActiveLoans } from '../game/loans.ts';
import {
  getRecentCashLedger,
  readStatementWindow,
  getDailyFinanceSnapshots,
  formatSnapshotDate,
  sumPositive,
  sumNegative
} from '../game/cash-ledger.ts';

function safeParseDetails(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export async function handleFinanceRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  currentCompanyId: number | null
): Promise<boolean> {
  const requestedCompanyMatch = pathname.match(/\/companies\/(\d+|me)\//);
  const isCurrentAdmin = currentCompanyId ? financeRepository.isCompanyAdmin(currentCompanyId) : false;

  const authorizeRequestedCompany = (): number | null => {
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return null;
    }
    if (requestedCompanyMatch && requestedCompanyMatch[1] !== 'me') {
      const targetId = Number(requestedCompanyMatch[1]);
      if (targetId !== currentCompanyId && !isCurrentAdmin) {
        sendJson(res, { error: 'Unauthorized' }, 401);
        return null;
      }
      return targetId;
    }
    return currentCompanyId;
  };

  // 1. Custom Reports (FPA): /api/v2/fpa/custom-reports/ (GET list, POST create)
  if (pathname === '/api/v2/fpa/custom-reports/') {
    const companyId = authorizeRequestedCompany();
    if (companyId === null) return true;
    if (method === 'POST') {
      const body = await readJsonBody<{ name?: string; category?: string; config?: Record<string, unknown> }>(req);
      const name = (body.name || '').trim();
      if (!name) {
        sendJson(res, { error: 'Report name is required' }, 400);
        return true;
      }
      const category = REPORT_CATEGORIES.includes(body.category || '') ? body.category! : 'Financial';
      const report = fpaReportsRepository.create(companyId, name, category, body.config || {});
      sendJson(res, { report, canCreate: true });
      return true;
    }
    sendJson(res, {
      reports: fpaReportsRepository.list(companyId),
      categories: REPORT_CATEGORIES,
      canCreate: true
    });
    return true;
  }

  // 1b. Custom Report delete: /api/v2/fpa/custom-reports/:id/
  const fpaDeleteMatch = pathname.match(/^\/api\/v2\/fpa\/custom-reports\/(\d+)\/$/);
  if (fpaDeleteMatch && method === 'DELETE') {
    const companyId = authorizeRequestedCompany();
    if (companyId === null) return true;
    const deleted = fpaReportsRepository.delete(Number(fpaDeleteMatch[1]), companyId);
    if (!deleted) {
      sendJson(res, { error: 'Report not found' }, 404);
      return true;
    }
    sendJson(res, { success: true });
    return true;
  }


  const loanTakeMatch = pathname.match(/^\/api\/v2\/companies\/(\d+|me)\/loans\/$/);
  const loanRepayMatch = pathname.match(/^\/api\/v2\/companies\/(\d+|me)\/loans\/(\d+)\/repay\/$/);
  const loanListMatch = pathname.match(/^\/api\/v2\/companies\/(\d+|me)\/loans\/$/);

  if (loanTakeMatch && method === 'POST') {
    const companyId = authorizeRequestedCompany();
    if (companyId === null) return true;
    const body = await readJsonBody<{ amount: number }>(req);
    try {
      sendJson(res, takeLoan(companyId, Number(body.amount)));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: msg }, 400);
    }
    return true;
  }

  if (loanRepayMatch && method === 'POST') {
    const companyId = authorizeRequestedCompany();
    if (companyId === null) return true;
    const body = await readJsonBody<{ amount: number }>(req);
    try {
      sendJson(res, repayLoan(companyId, Number(loanRepayMatch[2]), Number(body.amount)));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: msg }, 400);
    }
    return true;
  }
  if (loanListMatch && method === 'GET') {
    const companyId = authorizeRequestedCompany();
    if (companyId === null) return true;
    sendJson(res, getActiveLoans(companyId));
    return true;
  }

  // 6. Balance Sheet — official camelCase schema (HAR-verified).
  if (pathname.startsWith('/api/') && pathname.includes('/balance-sheet/')) {
    const companyId = authorizeRequestedCompany();
    if (companyId === null) return true;
    const comp = getCompanyById(companyId);
    const money = comp ? round2(Number(comp.money) || 0) : 0;
    const inventory = round2(financeRepository.inventoryValue(companyId));
    const buildings = round2(financeRepository.buildingsValue(companyId));
    const bondsHeld = round2(financeRepository.bondsHeldValue(companyId));
    const liabilities = round2(financeRepository.loansOutstanding(companyId));
    const date = new Date().toISOString().replace('Z', '+00:00');
    sendJson(res, {
      date,
      cash: money,
      money,
      cashReservedForOrders: 0,
      accountsReceivable: 0,
      workInProcess: 0,
      materials: inventory,
      research: 0,
      finishedGoods: inventory,
      inventory,
      investmentInBonds: bondsHeld,
      bonds: bondsHeld,
      buildings,
      constructionInProgress: 0,
      patents: 0,
      bondsPayable: liabilities,
      liabilities,
      contributedCapital: 100000,
      retainedEarnings: round2(money + inventory + buildings + bondsHeld - liabilities - 100000),
      valuationAllowance: 0,
      deposits: 0,
      employees: financeRepository.employeeCount(companyId)
    });
    return true;
  }

  // 7. Income Statement — computed from the cash ledger journal (last 24h).
  // Real amounts come from persisted ledger entries; unavailable components are 0.
  if (pathname.startsWith('/api/') && pathname.includes('/income-statement/')) {
    const companyId = authorizeRequestedCompany();
    if (companyId === null) return true;
    const w = readStatementWindow(companyId);
    const byCat = w.aggregate.byCategory;
    const cat = (c: string): number => Math.round((byCat[c] || 0) * 100) / 100;
    const sales = cat('s') > 0 ? cat('s') : 0;
    // Expenses are negative per the official API.
    const payload = {
      date: w.date,
      dateFrom: w.dateFrom,
      sales,
      cogs: Math.min(0, cat('p') + cat('o')),
      freightOut: 0,
      constructionCosts: Math.min(0, cat('c')),
      marketFees: Math.min(0, cat('f') + cat('q')),
      salariesCosts: Math.min(0, cat('e')),
      trainingCosts: Math.min(0, cat('h')),
      poachingCosts: Math.min(0, cat('j')),
      gameIncome: cat('g') > 0 ? cat('g') : 0,
      executiveRoyalties: Math.max(0, cat('e')),
      gainOnSale: Math.max(0, cat('u')),
      patentConversion: 0,
      bondDefaults: 0,
      bondWriteoffs: 0,
      accountingOverhead: Math.min(0, cat('a')),
      bondInterestExpense: 0,
      bondInterestIncome: Math.max(0, cat('i') + cat('n') + cat('b')),
      donations: 0,
      otherComprehensiveIncome: 0,
      netIncome: 0,
      economicValueAdded: 0,
      cashAllExpenses: sumNegative(w.rows),
      isComputed: true
    };
    // netIncome = sum of all components (exactly what the client recomputes).
    const components = payload.sales + payload.cogs + payload.freightOut
      + payload.constructionCosts + payload.marketFees + payload.salariesCosts
      + payload.trainingCosts + payload.poachingCosts + payload.gameIncome
      + payload.executiveRoyalties + payload.gainOnSale + payload.patentConversion
      + payload.accountingOverhead + payload.bondInterestExpense
      + payload.bondInterestIncome + payload.bondDefaults + payload.bondWriteoffs
      + payload.donations;
    payload.netIncome = Math.round(components * 100) / 100;
    // EVA: net income minus 1.5% capital charge on non-cash assets (official rate 0.0015).
    payload.economicValueAdded = Math.round((payload.netIncome - 0.0015 * (financeRepository.buildingsValue(companyId) + financeRepository.inventoryValue(companyId))) * 100) / 100;
    sendJson(res, payload);
    return true;
  }

  // 8. Cashflow Statement + Recent Cashflow — from the cash ledger journal.
  const cashflowRecentMatch = pathname.match(/^\/api\/v2\/companies\/(\d+|me)\/cashflow\/(recent|all)\//);
  if (cashflowRecentMatch) {
    const companyId = authorizeRequestedCompany();
    if (companyId === null) return true;
    // #168: probe one row past the page size so the client knows when the
    // whole journal has been pulled (no endless "(there is more)" hint).
    const entries = getRecentCashLedger(companyId, 31);
    const comp = getCompanyById(companyId);
    const data = entries.map(e => ({
      id: e.id,
      datetime: e.created_at,
      money: Math.round((Number(e.amount) || 0) * 100) / 100,
      category: e.category,
      description: e.description,
      descriptionKey: e.description_key,
      details: safeParseDetails(e.details)
    }));
    sendJson(res, {
      data: data.slice(0, 30),
      oldestPulled: entries.length <= 30,
      money: comp ? Math.round((Number(comp.money) || 0) * 100) / 100 : 0
    });
    return true;
  }

  if (pathname.startsWith('/api/') && pathname.includes('/cashflow-statement/')) {
    const companyId = authorizeRequestedCompany();
    if (companyId === null) return true;
    const w = readStatementWindow(companyId);
    const byCat = w.aggregate.byCategory;
    const pos = (c: string): number => Math.round((byCat[c] || 0) * 100) / 100;
    const fromRetail = Math.max(0, pos('s'));
    const fromExchange = Math.max(0, pos('u'));
    const fromInterest = Math.max(0, pos('i') + pos('n') + pos('b'));
    const fromRoyalties = Math.max(0, pos('e'));
    const toEmployees = Math.min(0, pos('p'));

    const payload = {
      date: w.date,
      dateFrom: w.dateFrom,
      fromRetail,
      fromCustomers: Math.max(0, pos('k') + pos('c') + pos('t') + pos('o')),
      fromExchange,
      fromInterest,
      fromPoaching: 0,
      fromGame: 0,
      fromEmployees: 0,
      fromRoyalties,
      toGame: 0,
      toSuppliers: Math.min(0, pos('m') + pos('b') + pos('u') + pos('k') + pos('c') + pos('t')),
      toExchange: 0,
      toEmployees,
      toExecutives: Math.min(0, pos('e') + pos('h') + pos('j')),
      forInterest: 0,
      forFees: Math.min(0, pos('f') + pos('q')),
      forAccounting: Math.min(0, pos('a')),
      investmentInBonds: 0,
      bonds: 0,
      gameIncome: 0,
      cashAllIncome: sumPositive(w.rows),
      cashAllExpenses: sumNegative(w.rows),
      isComputed: true
    };
    sendJson(res, payload);
    return true;
  }

  // 9. Past Finances Overview (v2) — daily snapshot rows for the chart.
  const overviewMatch = pathname.match(/^\/api\/v2\/companies\/(\d+|me)\/past-finances-overview\/$/);
  if (overviewMatch) {
    const companyId = authorizeRequestedCompany();
    if (companyId === null) return true;
    const rows = getDailyFinanceSnapshots(companyId);
    sendJson(res, rows.map(r => ({
      total: r.total,
      currentAssets: r.current_assets,
      nonCurrentAssets: r.non_current_assets,
      liabilities: r.liabilities,
      economicValueAdded: r.economic_value_added,
      evaProfit: r.eva_profit,
      evaRank: r.eva_rank,
      rank: r.rank,
      date: formatSnapshotDate(r.created_at, r.snapshot_date)
    })));
    return true;
  }

  // 9b. Past Finances (v3) — richer snapshot rows for the finance history chart.
  const pastFinancesMatch = pathname.match(/^\/api\/v3\/companies\/(\d+|me)\/past-finances\/$/);
  if (pastFinancesMatch) {
    const companyId = authorizeRequestedCompany();
    if (companyId === null) return true;
    const rows = getDailyFinanceSnapshots(companyId);
    sendJson(res, rows.map(r => ({
      total: r.total,
      currentAssets: r.current_assets,
      cashAndReceivables: r.cash_and_receivables,
      inventory: r.inventory,
      nonCurrentAssets: r.non_current_assets,
      buildings: r.buildings,
      patents: r.patents,
      investmentInBonds: r.investment_in_bonds,
      deposits: r.deposits,
      liabilities: r.liabilities,
      rank: r.rank,
      date: formatSnapshotDate(r.created_at, r.snapshot_date)
    })));
    return true;
  }


  return false;
}
export function registerFinanceRoutes(registry: RouteRegistry = globalRouteRegistry): void {
  const bodyField = (body: unknown, field: string): unknown => {
    if (!body || typeof body !== 'object' || !(field in body)) return undefined;
    return Reflect.get(body, field);
  };
  const commandError = (err: unknown): { error: string } => ({
    error: err instanceof Error ? err.message : String(err)
  });
  const authorize = (ctx: { companyId: number } | null, params: Record<string, string>, res: ServerResponse): number | null => {
    const currentCompanyId = ctx?.companyId ?? null;
    if (!currentCompanyId) {
      sendJson(res, { error: 'Unauthorized' }, 401);
      return null;
    }
    const requested = params.companyId;
    if (requested && requested !== 'me') {
      const targetId = Number(requested);
      if (targetId !== currentCompanyId && !financeRepository.isCompanyAdmin(currentCompanyId)) {
        sendJson(res, { error: 'Unauthorized' }, 401);
        return null;
      }
      return targetId;
    }
    return currentCompanyId;
  };
  const report = (res: ServerResponse, companyId: number, body: unknown): void => {
    const rawName = bodyField(body, 'name');
    const name = (typeof rawName === 'string' ? rawName : '').trim();
    if (!name) {
      sendJson(res, { error: 'Report name is required' }, 400);
      return;
    }
    const rawCategory = bodyField(body, 'category');
    const category = REPORT_CATEGORIES.includes(typeof rawCategory === 'string' ? rawCategory : '')
      ? rawCategory as string
      : 'Financial';
    const rawConfig = bodyField(body, 'config');
    const config = rawConfig && typeof rawConfig === 'object' ? rawConfig as Record<string, unknown> : {};
    const created = fpaReportsRepository.create(companyId, name, category, config);
    sendJson(res, { report: created, canCreate: true });
  };
  const balanceSheet = (res: ServerResponse, companyId: number): void => {
    const comp = getCompanyById(companyId);
    const money = comp ? round2(Number(comp.money) || 0) : 0;
    const inventory = round2(financeRepository.inventoryValue(companyId));
    const buildings = round2(financeRepository.buildingsValue(companyId));
    const bondsHeld = round2(financeRepository.bondsHeldValue(companyId));
    const liabilities = round2(financeRepository.loansOutstanding(companyId));
    const date = new Date().toISOString().replace('Z', '+00:00');
    sendJson(res, {
      date, cash: money, money, cashReservedForOrders: 0, accountsReceivable: 0,
      workInProcess: 0, materials: inventory, research: 0, finishedGoods: inventory,
      inventory, investmentInBonds: bondsHeld, bonds: bondsHeld, buildings,
      constructionInProgress: 0, patents: 0, bondsPayable: liabilities, liabilities,
      contributedCapital: 100000,
      retainedEarnings: round2(money + inventory + buildings + bondsHeld - liabilities - 100000),
      valuationAllowance: 0, deposits: 0, employees: financeRepository.employeeCount(companyId)
    });
  };
  const incomeStatement = (res: ServerResponse, companyId: number): void => {
    const w = readStatementWindow(companyId);
    const byCat = w.aggregate.byCategory;
    const cat = (c: string): number => Math.round((byCat[c] || 0) * 100) / 100;
    const payload = {
      date: w.date, dateFrom: w.dateFrom, sales: cat('s') > 0 ? cat('s') : 0,
      cogs: Math.min(0, cat('p') + cat('o')), freightOut: 0,
      constructionCosts: Math.min(0, cat('c')), marketFees: Math.min(0, cat('f') + cat('q')),
      salariesCosts: Math.min(0, cat('e')), trainingCosts: Math.min(0, cat('h')),
      poachingCosts: Math.min(0, cat('j')), gameIncome: cat('g') > 0 ? cat('g') : 0,
      executiveRoyalties: Math.max(0, cat('e')), gainOnSale: Math.max(0, cat('u')),
      patentConversion: 0, bondDefaults: 0, bondWriteoffs: 0,
      accountingOverhead: Math.min(0, cat('a')), bondInterestExpense: 0,
      bondInterestIncome: Math.max(0, cat('i') + cat('n') + cat('b')),
      donations: 0, otherComprehensiveIncome: 0, netIncome: 0, economicValueAdded: 0,
      cashAllExpenses: sumNegative(w.rows), isComputed: true
    };
    const components = payload.sales + payload.cogs + payload.freightOut
      + payload.constructionCosts + payload.marketFees + payload.salariesCosts
      + payload.trainingCosts + payload.poachingCosts + payload.gameIncome
      + payload.executiveRoyalties + payload.gainOnSale + payload.patentConversion
      + payload.accountingOverhead + payload.bondInterestExpense
      + payload.bondInterestIncome + payload.bondDefaults + payload.bondWriteoffs
      + payload.donations;
    payload.netIncome = Math.round(components * 100) / 100;
    payload.economicValueAdded = Math.round((
      payload.netIncome - 0.0015 * (financeRepository.buildingsValue(companyId) + financeRepository.inventoryValue(companyId))
    ) * 100) / 100;
    sendJson(res, payload);
  };
  const cashflowStatement = (res: ServerResponse, companyId: number): void => {
    const w = readStatementWindow(companyId);
    const byCat = w.aggregate.byCategory;
    const pos = (c: string): number => Math.round((byCat[c] || 0) * 100) / 100;
    sendJson(res, {
      date: w.date, dateFrom: w.dateFrom, fromRetail: Math.max(0, pos('s')),
      fromCustomers: Math.max(0, pos('k') + pos('c') + pos('t') + pos('o')),
      fromExchange: Math.max(0, pos('u')), fromInterest: Math.max(0, pos('i') + pos('n') + pos('b')),
      fromPoaching: 0, fromGame: 0, fromEmployees: 0, fromRoyalties: Math.max(0, pos('e')),
      toGame: 0, toSuppliers: Math.min(0, pos('m') + pos('b') + pos('u') + pos('k') + pos('c') + pos('t')),
      toExchange: 0, toEmployees: Math.min(0, pos('p')),
      toExecutives: Math.min(0, pos('e') + pos('h') + pos('j')), forInterest: 0,
      forFees: Math.min(0, pos('f') + pos('q')), forAccounting: Math.min(0, pos('a')),
      investmentInBonds: 0, bonds: 0, gameIncome: 0,
      cashAllIncome: sumPositive(w.rows), cashAllExpenses: sumNegative(w.rows), isComputed: true
    });
  };
  const snapshotsV2 = (res: ServerResponse, companyId: number): void => {
    const rows = getDailyFinanceSnapshots(companyId);
    sendJson(res, rows.map(r => ({
      total: r.total, currentAssets: r.current_assets, nonCurrentAssets: r.non_current_assets,
      liabilities: r.liabilities, economicValueAdded: r.economic_value_added, evaProfit: r.eva_profit,
      evaRank: r.eva_rank, rank: r.rank, date: formatSnapshotDate(r.created_at, r.snapshot_date)
    })));
  };
  const snapshotsV3 = (res: ServerResponse, companyId: number): void => {
    const rows = getDailyFinanceSnapshots(companyId);
    sendJson(res, rows.map(r => ({
      total: r.total, currentAssets: r.current_assets, cashAndReceivables: r.cash_and_receivables,
      inventory: r.inventory, nonCurrentAssets: r.non_current_assets, buildings: r.buildings,
      patents: r.patents, investmentInBonds: r.investment_in_bonds, deposits: r.deposits,
      liabilities: r.liabilities, rank: r.rank, date: formatSnapshotDate(r.created_at, r.snapshot_date)
    })));
  };

  registry
    .register({
      method: 'GET', pattern: '/api/v2/fpa/custom-reports/', owner: 'finance',
      handler: async (_req, res, ctx) => {
        const companyId = authorize(ctx, {}, res);
        if (companyId === null) return;
        sendJson(res, { reports: fpaReportsRepository.list(companyId), categories: REPORT_CATEGORIES, canCreate: true });
      }
    })
    .register({
      method: 'POST', pattern: '/api/v2/fpa/custom-reports/', owner: 'finance',
      handler: async (_req, res, ctx, _params, body) => {
        const companyId = authorize(ctx, {}, res);
        if (companyId === null) return;
        report(res, companyId, body);
      }
    })
    .register({
      method: 'DELETE', pattern: '/api/v2/fpa/custom-reports/:reportId/', owner: 'finance',
      handler: async (_req, res, ctx, params) => {
        const companyId = authorize(ctx, {}, res);
        if (companyId === null) return;
        if (!fpaReportsRepository.delete(Number(params.reportId), companyId)) {
          sendJson(res, { error: 'Report not found' }, 404);
          return;
        }
        sendJson(res, { success: true });
      }
    })
    .register({
      method: 'POST', pattern: '/api/v2/companies/:companyId/loans/', owner: 'finance',
      handler: async (_req, res, ctx, params, body) => {
        const companyId = authorize(ctx, params, res);
        if (companyId === null) return;
        try {
          sendJson(res, takeLoan(companyId, Number(bodyField(body, 'amount'))));
        } catch (err: unknown) { sendJson(res, commandError(err), 400); }
      }
    })
    .register({
      method: 'GET', pattern: '/api/v2/companies/:companyId/loans/', owner: 'finance',
      handler: async (_req, res, ctx, params) => {
        const companyId = authorize(ctx, params, res);
        if (companyId === null) return;
        sendJson(res, getActiveLoans(companyId));
      }
    })
    .register({
      method: 'POST', pattern: '/api/v2/companies/:companyId/loans/:loanId/repay/', owner: 'finance',
      handler: async (_req, res, ctx, params, body) => {
        const companyId = authorize(ctx, params, res);
        if (companyId === null) return;
        try {
          sendJson(res, repayLoan(companyId, Number(params.loanId), Number(bodyField(body, 'amount'))));
        } catch (err: unknown) { sendJson(res, commandError(err), 400); }
      }
    })
    .register({
      method: 'GET', pattern: '/api/:version/companies/:companyId/balance-sheet/', owner: 'finance',
      handler: async (_req, res, ctx, params) => {
        const companyId = authorize(ctx, params, res);
        if (companyId !== null) balanceSheet(res, companyId);
      }
    })
    .register({
      method: 'GET', pattern: '/api/:version/companies/:companyId/balance-sheet/:from/:to/', owner: 'finance',
      handler: async (_req, res, ctx, params) => {
        const companyId = authorize(ctx, params, res);
        if (companyId !== null) balanceSheet(res, companyId);
      }
    })
    .register({
      method: 'GET', pattern: '/api/:version/companies/:companyId/income-statement/', owner: 'finance',
      handler: async (_req, res, ctx, params) => {
        const companyId = authorize(ctx, params, res);
        if (companyId !== null) incomeStatement(res, companyId);
      }
    })
    .register({
      method: 'GET', pattern: '/api/:version/companies/:companyId/income-statement/:from/:to/', owner: 'finance',
      handler: async (_req, res, ctx, params) => {
        const companyId = authorize(ctx, params, res);
        if (companyId !== null) incomeStatement(res, companyId);
      }
    })
    .register({
      method: 'GET', pattern: '/api/v2/companies/:companyId/cashflow/:range/', owner: 'finance',
      handler: async (_req, res, ctx, params) => {
        const companyId = authorize(ctx, params, res);
        if (companyId === null) return;
        const entries = getRecentCashLedger(companyId, 31);
        const comp = getCompanyById(companyId);
        sendJson(res, {
          data: entries.map(e => ({
            id: e.id, datetime: e.created_at, money: Math.round((Number(e.amount) || 0) * 100) / 100,
            category: e.category, description: e.description, descriptionKey: e.description_key,
            details: safeParseDetails(e.details)
          })).slice(0, 30),
          oldestPulled: entries.length <= 30,
          money: comp ? Math.round((Number(comp.money) || 0) * 100) / 100 : 0
        });
      }
    })
    .register({
      method: 'GET', pattern: '/api/:version/companies/:companyId/cashflow-statement/', owner: 'finance',
      handler: async (_req, res, ctx, params) => {
        const companyId = authorize(ctx, params, res);
        if (companyId !== null) cashflowStatement(res, companyId);
      }
    })
    .register({
      method: 'GET', pattern: '/api/:version/companies/:companyId/cashflow-statement/:from/:to/', owner: 'finance',
      handler: async (_req, res, ctx, params) => {
        const companyId = authorize(ctx, params, res);
        if (companyId !== null) cashflowStatement(res, companyId);
      }
    })
    .register({
      method: 'GET', pattern: '/api/v2/companies/:companyId/past-finances-overview/', owner: 'finance',
      handler: async (_req, res, ctx, params) => {
        const companyId = authorize(ctx, params, res);
        if (companyId !== null) snapshotsV2(res, companyId);
      }
    })
    .register({
      method: 'GET', pattern: '/api/v3/companies/:companyId/past-finances/', owner: 'finance',
      handler: async (_req, res, ctx, params) => {
        const companyId = authorize(ctx, params, res);
        if (companyId !== null) snapshotsV3(res, companyId);
      }
    });
}

registerFinanceRoutes(globalRouteRegistry);
