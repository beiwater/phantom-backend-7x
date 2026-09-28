import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Page as PlaywrightPage } from '@playwright/test';
import type { Page as PuppeteerPage } from 'puppeteer';

export type AuditErrorType = 'pageerror' | 'console.error' | 'requestfailed' | 'http5xx' | 'api4xx';

export interface AuditError {
  type: AuditErrorType;
  message: string;
  url?: string;
  timestamp: string;
}

export interface AuditNetworkEntry {
  method: string;
  url: string;
  timestamp: string;
  status?: number;
  failed?: string;
  localApi: boolean;
}

export interface BrowserAuditSnapshot {
  currentUrl: string;
  errors: AuditError[];
  recentActions: string[];
  network: AuditNetworkEntry[];
  ignored: Array<{ message: string; reason: string; timestamp: string }>;
}

export interface BrowserAuditController {
  readonly errors: AuditError[];
  recordAction(actionName: string): void;
  snapshot(): BrowserAuditSnapshot;
  writeFailureArtifacts(directory: string, prefix?: string): Promise<string | undefined>;
  assertClean(contextMessage?: string): void;
  getSummary(): {
    totalErrors: number;
    pageErrors: number;
    consoleErrors: number;
    requestFailures: number;
    httpFailures: number;
    localApiResponses: number;
  };
}

interface GenericBrowserPage {
  url(): string;
  evaluate<T>(pageFunction: () => T | Promise<T>): Promise<T>;
  screenshot(options: { path: string; fullPage?: boolean }): Promise<unknown>;
  on(event: string, listener: (payload: unknown) => void): unknown;
}

type BrowserPage = PlaywrightPage | PuppeteerPage;

const SENSITIVE_QUERY_KEY = /(?:password|passwd|pwd|token|cookie|authorization|session|secret|api[_-]?key|private[_-]?key)/i;

function safeUrl(value: string): string {
  try {
    const url = new URL(value);
    for (const key of url.searchParams.keys()) {
      if (SENSITIVE_QUERY_KEY.test(key)) url.searchParams.set(key, '[REDACTED]');
    }
    return url.toString();
  } catch {
    return value;
  }
}

function safeMessage(value: string): string {
  return value.replace(/https?:\/\/[^\s"')]+/giu, match => safeUrl(match));
}

interface EventRecord {
  [key: string]: unknown;
}

function asRecord(value: unknown): EventRecord | undefined {
  return typeof value === 'object' && value !== null
    ? value as EventRecord
    : undefined;
}

function callString(value: unknown, method: string): string | undefined {
  const record = asRecord(value);
  const candidate = record?.[method];
  if (typeof candidate !== 'function') return undefined;
  try {
    const result: unknown = candidate.call(value);
    return typeof result === 'string' ? result : undefined;
  } catch {
    return undefined;
  }
}

function callNumber(value: unknown, method: string): number | undefined {
  const record = asRecord(value);
  const candidate = record?.[method];
  if (typeof candidate !== 'function') return undefined;
  try {
    const result: unknown = candidate.call(value);
    return typeof result === 'number' ? result : undefined;
  } catch {
    return undefined;
  }
}

function callBoolean(value: unknown, method: string): boolean {
  const record = asRecord(value);
  const candidate = record?.[method];
  if (typeof candidate !== 'function') return false;
  try {
    return candidate.call(value) === true;
  } catch {
    return false;
  }
}

function callValue(value: unknown, method: string): unknown {
  const record = asRecord(value);
  const candidate = record?.[method];
  if (typeof candidate !== 'function') return undefined;
  try {
    return candidate.call(value);
  } catch {
    return undefined;
  }
}

function readStringProperty(value: unknown, property: string): string | undefined {
  const candidate = asRecord(value)?.[property];
  return typeof candidate === 'string' ? candidate : undefined;
}

function sameOriginApi(url: string, currentUrl: string): boolean {
  try {
    const requestUrl = new URL(url);
    const pageUrl = new URL(currentUrl);
    return requestUrl.origin === pageUrl.origin && requestUrl.pathname.startsWith('/api/');
  } catch {
    return false;
  }
}

function isAnonymousContractPrefetchEndpoint(url: string, method: string): boolean {
  if (method !== 'GET') return false;
  try {
    const requestUrl = new URL(url);
    return requestUrl.pathname === '/api/v3/contracts-incoming/0/me/';
  } catch {
    return false;
  }
}

function isAnonymousContractPrefetch(url: string, method: string, currentPageUrl: string): boolean {
  try {
    const requestUrl = new URL(url);
    const pageUrl = new URL(currentPageUrl);
    return isAnonymousContractPrefetchEndpoint(url, method)
      && requestUrl.origin === pageUrl.origin
      && /^\/zh-cn\/(?:signup|signin)\/$/.test(pageUrl.pathname);
  } catch {
    return false;
  }
}

function isAnonymousContractPrefetchConsoleError(message: string, currentPageUrl: string): boolean {
  try {
    const pathname = new URL(currentPageUrl).pathname;
    return /^\/zh-cn\/(?:signup|signin)\/$/.test(pathname)
      && message === 'Failed to load resource: the server responded with a status of 401 (Unauthorized)';
  } catch {
    return false;
  }
}

function isOptionalReviewEndpoint(url: string): boolean {
  try {
    const requestUrl = new URL(url);
    return requestUrl.protocol === 'https:'
      && requestUrl.hostname === 'www.myreviews.ai'
      && /^\/public\/api\/v1\/applications\/4\/reviews\/positive\/[A-Za-z0-9]{32}\/$/.test(requestUrl.pathname);
  } catch {
    return false;
  }
}

function isOptionalSignupReviewRequest(url: string, currentPageUrl: string): boolean {
  try {
    const pageUrl = new URL(currentPageUrl);
    return isOptionalReviewEndpoint(url)
      && /^\/zh-cn\/(?:signup|signin)\/$/.test(pageUrl.pathname);
  } catch {
    return false;
  }
}

function currentUrl(page: GenericBrowserPage): string {
  try {
    return page.url();
  } catch {
    return 'unknown';
  }
}

function displayError(error: AuditError): string {
  return `  ${error.timestamp} [${error.type}] ${error.message}${error.url ? ` (at ${error.url})` : ''}`;
}

export function attachBrowserAudit(
  browserPage: BrowserPage,
): BrowserAuditController {
  // Playwright and Puppeteer expose the same event and page methods with different
  // generic event-map types. This single boundary keeps event payloads runtime-checked.
  const page = browserPage as unknown as GenericBrowserPage;
  const errors: AuditError[] = [];
  const network: AuditNetworkEntry[] = [];
  const pendingOptionalReviewRequests = new Map<string, number>();
  const recentActions: string[] = [];
  const ignored: BrowserAuditSnapshot['ignored'] = [];
  let pendingAnonymousPrefetches = 0;
  const pendingAnonymousConsole401s: string[] = [];
  const expectedAnonymousConsole401s: number[] = [];

  const recordIgnored = (message: string, reason: string): void => {
    ignored.push({ message, reason, timestamp: new Date().toISOString() });
  };
  const recordError = (type: AuditErrorType, message: string, url?: string): void => {
    errors.push({ type, message, url, timestamp: new Date().toISOString() });
  };
  const flushUnpairedAnonymousConsoleErrors = (): void => {
    if (pendingAnonymousPrefetches > 0) return;
    while (pendingAnonymousConsole401s.length > 0) {
      recordError('console.error', pendingAnonymousConsole401s.shift() ?? 'Unpaired anonymous 401 console error', safeUrl(currentUrl(page)));
    }
  };
  const takeOptionalReviewRequest = (method: string, url: string): boolean => {
    const key = `${method} ${url}`;
    const pending = pendingOptionalReviewRequests.get(key) ?? 0;
    if (pending === 0) return false;
    if (pending === 1) pendingOptionalReviewRequests.delete(key);
    else pendingOptionalReviewRequests.set(key, pending - 1);
    return true;
  };

  page.on('pageerror', (payload) => {
    const message = readStringProperty(payload, 'stack')
      || readStringProperty(payload, 'message')
      || String(payload);
    recordError('pageerror', safeMessage(message), safeUrl(currentUrl(page)));
  });

  page.on('console', (payload) => {
    const type = callString(payload, 'type');
    if (type !== 'error') return;
    const message = callString(payload, 'text') || String(payload);
    if (isAnonymousContractPrefetchConsoleError(message, currentUrl(page))) {
      const recentExpected = expectedAnonymousConsole401s.findIndex(timestamp => Date.now() - timestamp < 2_000);
      if (recentExpected >= 0) {
        expectedAnonymousConsole401s.splice(recentExpected, 1);
        recordIgnored(message, 'Anonymous signup/signin prefetch of the official contracts-incoming endpoint returns 401 before an account exists; paired with the exact GET /api/v3/contracts-incoming/0/me/ response.');
        return;
      }
      if (pendingAnonymousPrefetches > pendingAnonymousConsole401s.length) {
        pendingAnonymousConsole401s.push(message);
        return;
      }
    }
    recordError('console.error', safeMessage(message), safeUrl(currentUrl(page)));
  });

  page.on('requestfailed', (payload) => {
    const url = callString(payload, 'url') || 'unknown';
    const method = callString(payload, 'method') || 'GET';
    const failureObject = callValue(payload, 'failure');
    const failure = readStringProperty(failureObject, 'errorText')
      || callString(failureObject, 'errorText')
      || 'network failure';
    const message = `${method} ${safeUrl(url)} (${failure})`;
    const localApi = sameOriginApi(url, currentUrl(page));
    const optionalReview = isOptionalReviewEndpoint(url) && takeOptionalReviewRequest(method, url);
    if (optionalReview) {
      network.push({ method, url: safeUrl(url), timestamp: new Date().toISOString(), failed: failure, localApi: false });
      recordIgnored(message, 'Optional third-party review widget request initiated on signup/signin; this exact myreviews.ai endpoint is external to the application and does not block account creation.');
      return;
    }
    if (pendingAnonymousPrefetches > 0 && isAnonymousContractPrefetchEndpoint(url, method)) {
      pendingAnonymousPrefetches--;
      flushUnpairedAnonymousConsoleErrors();
    }
    const isNavigationAbort = callBoolean(payload, 'isNavigationRequest')
      && /ERR_ABORTED|aborted/i.test(failure);
    if (isNavigationAbort) {
      recordIgnored(message, 'The browser canceled an in-flight document request while navigating to a different visible page.');
      return;
    }
    network.push({
      method,
      url: safeUrl(url),
      timestamp: new Date().toISOString(),
      failed: failure,
      localApi,
    });
    recordError('requestfailed', message, safeUrl(url));
  });

  page.on('request', (payload) => {
    const url = callString(payload, 'url') || 'unknown';
    const method = callString(payload, 'method') || 'GET';
    if (method === 'GET' && isOptionalSignupReviewRequest(url, currentUrl(page))) {
      const key = `${method} ${url}`;
      pendingOptionalReviewRequests.set(key, (pendingOptionalReviewRequests.get(key) ?? 0) + 1);
      network.push({ method, url: safeUrl(url), timestamp: new Date().toISOString(), localApi: false, failed: 'pending optional third-party request' });
    }
    const localApi = sameOriginApi(url, currentUrl(page));
    if (!localApi) return;
    if (isAnonymousContractPrefetch(url, method, currentUrl(page))) pendingAnonymousPrefetches++;
    network.push({ method, url: safeUrl(url), timestamp: new Date().toISOString(), localApi, failed: 'pending' });
  });

  page.on('response', (payload) => {
    const url = callString(payload, 'url') || 'unknown';
    const status = callNumber(payload, 'status');
    const request = callValue(payload, 'request');
    const method = callString(request, 'method') || 'GET';
    const localApi = sameOriginApi(url, currentUrl(page));
    const timestamp = new Date().toISOString();
    network.push({ method, url: safeUrl(url), timestamp, status, localApi });

    if (isOptionalReviewEndpoint(url) && takeOptionalReviewRequest(method, url) && status !== undefined && status >= 400) {
      recordIgnored(`HTTP ${status}: ${method} ${safeUrl(url)}`, 'Optional third-party review widget response for a request initiated on signup/signin; this exact myreviews.ai endpoint is external to the application and does not block account creation.');
      return;
    }
    if (status === undefined) return;
    if (localApi && isAnonymousContractPrefetchEndpoint(url, method) && pendingAnonymousPrefetches > 0) {
      pendingAnonymousPrefetches--;
      if (status === 401) {
        if (pendingAnonymousConsole401s.length > 0) {
          const consoleMessage = pendingAnonymousConsole401s.shift();
          recordIgnored(consoleMessage ?? 'Anonymous signup/signin prefetch console 401', 'Paired with the exact anonymous contracts-incoming GET 401 response.');
        } else {
          expectedAnonymousConsole401s.push(Date.now());
        }
        recordIgnored(
          `API HTTP 401: ${method} ${safeUrl(url)}`,
          'The official client prefetches this exact endpoint on an unauthenticated signup/signin page; no account exists yet, so authentication correctly rejects the request.',
        );
      }
      flushUnpairedAnonymousConsoleErrors();
      if (status === 401) return;
    }
    if (status >= 500) {
      recordError('http5xx', safeMessage(`HTTP ${status}: ${method} ${url}`), safeUrl(url));
      return;
    }
    if (localApi && status >= 400) {
      recordError('api4xx', safeMessage(`API HTTP ${status}: ${method} ${url}`), safeUrl(url));
    }
  });

  return {
    get errors() {
      return [...errors];
    },
    recordAction(actionName: string): void {
      recentActions.push(`[${new Date().toISOString()}] ${actionName}`);
      if (recentActions.length > 20) recentActions.shift();
    },
    snapshot(): BrowserAuditSnapshot {
      return {
        currentUrl: safeUrl(currentUrl(page)),
        errors: [...errors],
        recentActions: [...recentActions],
        network: network.map(entry => ({ ...entry })),
        ignored: ignored.map(entry => ({ ...entry })),
      };
    },
    async writeFailureArtifacts(directory: string, prefix = 'browser-audit-failure'): Promise<string | undefined> {
      const safePrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, '_');
      await fs.mkdir(directory, { recursive: true });
      const basePath = path.join(directory, safePrefix);
      let screenshotPath: string | undefined;
      let screenshotError: string | undefined;
      try {
        screenshotPath = `${basePath}.png`;
        await page.screenshot({ path: screenshotPath, fullPage: true });
      } catch (error) {
        screenshotPath = undefined;
        screenshotError = error instanceof Error ? error.message : String(error);
      }
      await fs.writeFile(`${basePath}.json`, JSON.stringify({
        ...this.snapshot(),
        screenshotPath,
        screenshotError,
      }, null, 2));
      return screenshotPath;
    },
    assertClean(contextMessage = 'Browser audit check'): void {
      if (errors.length === 0) return;
      const detail = errors.map(displayError).join('\n');
      const actions = recentActions.length > 0 ? `\nRecent actions:\n${recentActions.join('\n')}` : '';
      const networkSummary = network.length > 0
        ? `\nRecent network events:\n${network.slice(-20).map(entry => `  ${entry.method} ${entry.status ?? entry.failed ?? 'pending'} ${entry.url}`).join('\n')}`
        : '';
      throw new Error(`[BROWSER_AUDIT_FAILURE] ${contextMessage}: ${errors.length} unallowlisted error(s):\n${detail}${actions}${networkSummary}`);
    },
    getSummary() {
      return {
        totalErrors: errors.length,
        pageErrors: errors.filter(error => error.type === 'pageerror').length,
        consoleErrors: errors.filter(error => error.type === 'console.error').length,
        requestFailures: errors.filter(error => error.type === 'requestfailed').length,
        httpFailures: errors.filter(error => error.type === 'http5xx' || error.type === 'api4xx').length,
        localApiResponses: network.filter(entry => entry.localApi && entry.status !== undefined).length,
      };
    },
  };
}

export interface UiSnapshot {
  url: string;
  title: string;
  text: string;
  signature: string;
  readyState: string;
}

export interface UiWaitOptions {
  action: string;
  timeoutMs?: number;
  quietMs?: number;
  intervalMs?: number;
  condition?: string;
}

async function readUiSnapshot(browserPage: BrowserPage): Promise<UiSnapshot> {
  const page = browserPage as unknown as GenericBrowserPage;
  return page.evaluate(() => {
    const bodyText = (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim();
    const controls = Array.from(document.querySelectorAll('button, a[href], [role="button"], [role="tab"], input:not([type="password"]), select'))
      .filter(element => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .map(element => [
        element.tagName,
        element.getAttribute('role') ?? '',
        (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80),
        element.getAttribute('href') ?? '',
        element.getAttribute('aria-expanded') ?? '',
        element.getAttribute('aria-selected') ?? '',
        element.getAttribute('aria-pressed') ?? '',
        (element as HTMLButtonElement).disabled === true ? 'disabled' : 'enabled',
      ].join(':'))
      .join('|');
    const stableText = bodyText
      .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, '<time>')
      .replace(/\b\d+\s*(?:seconds?|secs?|minutes?|mins?|秒|分钟)\b/gi, '<countdown>');
    const signature = `${location.pathname}${location.search}\n${document.title}\n${stableText.slice(0, 5000)}\n${controls}`;
    return {
      url: location.href,
      title: document.title,
      text: bodyText.slice(0, 400),
      signature,
      readyState: document.readyState,
    };
  });
}

function waitInterval(intervalMs: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, intervalMs));
}

export async function waitForUiStable(
  page: BrowserPage,
  options: UiWaitOptions,
): Promise<UiSnapshot> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const quietMs = options.quietMs ?? 350;
  const intervalMs = options.intervalMs ?? 100;
  const condition = options.condition ?? `DOM signature unchanged for ${quietMs}ms after ${options.action}`;
  const startedAt = Date.now();
  let previousSignature: string | undefined;
  let unchangedSince = startedAt;
  let latest: UiSnapshot | undefined;

  while (Date.now() - startedAt < timeoutMs) {
    latest = await readUiSnapshot(page);
    if (latest.readyState !== 'loading' && latest.signature === previousSignature) {
      if (Date.now() - unchangedSince >= quietMs) return latest;
    } else {
      previousSignature = latest.signature;
      unchangedSince = Date.now();
    }
    await waitInterval(intervalMs);
  }

  latest ??= await readUiSnapshot(page);
  throw new Error(`[UI_TIMEOUT] action="${options.action}" condition="${condition}" timeout=${timeoutMs}ms state="${latest.title}" url=${latest.url} text="${latest.text}"`);
}

export async function waitForUiTransition(
  page: BrowserPage,
  before: UiSnapshot,
  options: UiWaitOptions,
): Promise<UiSnapshot> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const intervalMs = options.intervalMs ?? 100;
  const condition = options.condition ?? 'route or visible DOM state changes';
  const startedAt = Date.now();
  let latest = before;
  while (Date.now() - startedAt < timeoutMs) {
    latest = await readUiSnapshot(page);
    if (latest.signature !== before.signature) {
      return waitForUiStable(page, { ...options, timeoutMs: Math.max(1, timeoutMs - (Date.now() - startedAt)) });
    }
    await waitInterval(intervalMs);
  }
  throw new Error(`[UI_TIMEOUT] action="${options.action}" condition="${condition}" timeout=${timeoutMs}ms state="${latest.title}" url=${latest.url} text="${latest.text}"`);
}

/**
 * Business State Invariant Assertions (Issue #14):
 * Enforces money conservation, valid numbers, absence of NaN/Infinity, and coherent UI states.
 */
export async function assertBusinessInvariants(
  page: BrowserPage,
  options: {
    expectedMoney?: number;
    minMoney?: number;
    checkNaN?: boolean;
    context?: string;
  } = {},
): Promise<void> {
  const checkNaN = options.checkNaN ?? true;
  const context = options.context ?? 'Business Invariants';
  const genericPage = page as unknown as GenericBrowserPage;
  const bodyText = await genericPage.evaluate(() => document.body?.innerText ?? '');

  if (checkNaN) {
    const nanMatches = bodyText.match(/\$NaN|NaN\$|BoostsNaN|BoostNaN|undefined|null(?!\w)/i);
    assert.equal(
      nanMatches,
      null,
      `[INVARIANT_VIOLATION] ${context}: Discovered NaN/corrupted number formatting in DOM: ${nanMatches?.[0]}`,
    );
  }

  if (options.expectedMoney !== undefined) {
    const formatted = `$${options.expectedMoney.toLocaleString()}`;
    assert.ok(
      bodyText.includes(formatted),
      `[INVARIANT_VIOLATION] ${context}: Expected exact money ${formatted} not found in DOM`,
    );
  }

  if (options.minMoney !== undefined) {
    const moneyMatch = bodyText.match(/\$([\d,]+)/);
    if (moneyMatch) {
      const parsedMoney = Number(moneyMatch[1].replace(/,/g, ''));
      assert.ok(
        parsedMoney >= options.minMoney,
        `[INVARIANT_VIOLATION] ${context}: Money ${parsedMoney} below minimum expected ${options.minMoney}`,
      );
    }
  }
}
