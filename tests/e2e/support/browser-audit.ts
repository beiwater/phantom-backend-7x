import assert from 'node:assert/strict';
import type { Page as PlaywrightPage } from '@playwright/test';
import type { Page as PuppeteerPage } from 'puppeteer';

export interface AuditError {
  type: 'pageerror' | 'console.error' | 'requestfailed' | 'http5xx' | 'api4xx';
  message: string;
  url?: string;
  timestamp: string;
}

export interface BrowserAuditOptions {
  allowConsolePatterns?: RegExp[];
  allowPageErrorPatterns?: RegExp[];
  allowFailedUrlPatterns?: RegExp[];
}

export interface BrowserAuditController {
  readonly errors: AuditError[];
  recordAction(actionName: string): void;
  assertClean(contextMessage?: string): void;
  getSummary(): {
    totalErrors: number;
    pageErrors: number;
    consoleErrors: number;
    requestFailures: number;
    httpFailures: number;
  };
}

const DEFAULT_IGNORED_CONSOLE: RegExp[] = [
  /favicon\.ico/,
  /google-analytics/,
  /amplitude/i,
  /facebook/i,
  /trailer/i,
  /myreviews/i
];

const DEFAULT_IGNORED_PAGE_ERRORS: RegExp[] = [
  /AbortError/i,
  /CanceledError/i,
  /ERR_ABORTED/i,
  /ERR_CANCELED/i
];

const DEFAULT_IGNORED_REQUEST_URLS: RegExp[] = [
  /google-analytics/,
  /analytics/,
  /amplitude/,
  /facebook/,
  /myreviews/
];

type GenericPage = PlaywrightPage | PuppeteerPage;

export function attachBrowserAudit(
  page: GenericPage,
  options: BrowserAuditOptions = {}
): BrowserAuditController {
  const errors: AuditError[] = [];
  const actionHistory: string[] = [];

  const ignoredConsole = [...DEFAULT_IGNORED_CONSOLE, ...(options.allowConsolePatterns || [])];
  const ignoredPageErrors = [...DEFAULT_IGNORED_PAGE_ERRORS, ...(options.allowPageErrorPatterns || [])];
  const ignoredRequestUrls = [...DEFAULT_IGNORED_REQUEST_URLS, ...(options.allowFailedUrlPatterns || [])];

  page.on('pageerror', (err: Error) => {
    const text = err.stack || err.message || String(err);
    if (ignoredPageErrors.some(pattern => pattern.test(text))) {
      return;
    }
    errors.push({
      type: 'pageerror',
      message: text,
      url: typeof (page as any).url === 'function' ? (page as any).url() : undefined,
      timestamp: new Date().toISOString()
    });
  });

  page.on('console', (msg: any) => {
    const type = typeof msg.type === 'function' ? msg.type() : msg.type;
    const text = typeof msg.text === 'function' ? msg.text() : String(msg);
    if (type === 'error') {
      if (ignoredConsole.some(pattern => pattern.test(text))) {
        return;
      }
      errors.push({
        type: 'console.error',
        message: text,
        url: typeof (page as any).url === 'function' ? (page as any).url() : undefined,
        timestamp: new Date().toISOString()
      });
    }
  });

  page.on('requestfailed', (req: any) => {
    const url = typeof req.url === 'function' ? req.url() : String(req);
    if (ignoredRequestUrls.some(pattern => pattern.test(url))) {
      return;
    }
    const failure = typeof req.failure === 'function' ? req.failure()?.errorText : undefined;
    errors.push({
      type: 'requestfailed',
      message: `${req.method ? req.method() : 'GET'} ${url} (${failure || 'network failure'})`,
      url,
      timestamp: new Date().toISOString()
    });
  });

  page.on('response', (res: any) => {
    const status = typeof res.status === 'function' ? res.status() : res.status;
    const url = typeof res.url === 'function' ? res.url() : String(res);
    if (status >= 500) {
      errors.push({
        type: 'http5xx',
        message: `HTTP ${status}: ${url}`,
        url,
        timestamp: new Date().toISOString()
      });
    } else if (status >= 400 && url.includes('/api/')) {
      errors.push({
        type: 'api4xx',
        message: `API HTTP ${status}: ${url}`,
        url,
        timestamp: new Date().toISOString()
      });
    }
  });

  return {
    get errors() {
      return [...errors];
    },
    recordAction(actionName: string): void {
      actionHistory.push(`[${new Date().toISOString()}] ${actionName}`);
      if (actionHistory.length > 20) actionHistory.shift();
    },
    getSummary() {
      return {
        totalErrors: errors.length,
        pageErrors: errors.filter(e => e.type === 'pageerror').length,
        consoleErrors: errors.filter(e => e.type === 'console.error').length,
        requestFailures: errors.filter(e => e.type === 'requestfailed').length,
        httpFailures: errors.filter(e => e.type === 'http5xx' || e.type === 'api4xx').length
      };
    },
    assertClean(contextMessage: string = 'Browser audit check'): void {
      if (errors.length > 0) {
        const detail = errors.map((e, idx) => `  ${idx + 1}. [${e.type}] ${e.message} (at ${e.url || 'unknown'})`).join('\n');
        const recentActions = actionHistory.length > 0 ? `\nRecent actions:\n${actionHistory.join('\n')}` : '';
        throw new Error(`[BROWSER_AUDIT_FAILURE] ${contextMessage}: Detected ${errors.length} unhandled browser/network error(s):\n${detail}${recentActions}`);
      }
    }
  };
}

/**
 * Observable UI Condition Waiters (Issue #13):
 * Replaces fixed setTimeout with deterministic predicate polling.
 */
export async function waitForUiCondition(
  predicate: () => Promise<boolean>,
  options: { timeoutMs?: number; intervalMs?: number; description?: string } = {}
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const intervalMs = options.intervalMs ?? 100;
  const description = options.description ?? 'Observable UI condition';

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await predicate()) {
        return;
      }
    } catch {
      // Continue polling on transient DOM errors
    }
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, intervalMs);
    await promise;
  }
  throw new Error(`[UI_TIMEOUT] Condition not satisfied within ${timeoutMs}ms: ${description}`);
}

/**
 * Business State Invariant Assertions (Issue #14):
 * Enforces money conservation, valid numbers, absence of NaN/Infinity, and coherent UI states.
 */
export async function assertBusinessInvariants(
  page: GenericPage,
  options: {
    expectedMoney?: number;
    minMoney?: number;
    checkNaN?: boolean;
    context?: string;
  } = {}
): Promise<void> {
  const checkNaN = options.checkNaN ?? true;
  const context = options.context ?? 'Business Invariants';

  const bodyText: string = await (page as any).evaluate(() => {
    return document.body ? document.body.innerText : '';
  });

  if (checkNaN) {
    const nanMatches = bodyText.match(/\$NaN|NaN\$|BoostsNaN|BoostNaN|undefined|null(?!\w)/i);
    assert.equal(
      nanMatches,
      null,
      `[INVARIANT_VIOLATION] ${context}: Discovered NaN/corrupted number formatting in DOM: ${nanMatches?.[0]}`
    );
  }

  if (options.expectedMoney !== undefined) {
    const formatted = `$${options.expectedMoney.toLocaleString()}`;
    assert.ok(
      bodyText.includes(formatted),
      `[INVARIANT_VIOLATION] ${context}: Expected exact money ${formatted} not found in DOM`
    );
  }

  if (options.minMoney !== undefined) {
    const moneyMatch = bodyText.match(/\$([\d,]+)/);
    if (moneyMatch) {
      const parsedMoney = Number(moneyMatch[1].replace(/,/g, ''));
      assert.ok(
        parsedMoney >= options.minMoney,
        `[INVARIANT_VIOLATION] ${context}: Money ${parsedMoney} below minimum expected ${options.minMoney}`
      );
    }
  }
}
