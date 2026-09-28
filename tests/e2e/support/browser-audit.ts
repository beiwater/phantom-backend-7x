import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Page as PlaywrightPage } from '@playwright/test';
import type { Page as PuppeteerPage } from 'puppeteer';

export type AuditErrorType = 'pageerror' | 'unhandledrejection' | 'console.error' | 'requestfailed' | 'http5xx' | 'api4xx';

export interface AuditError {
  type: AuditErrorType;
  message: string;
  url?: string;
  source?: string;
  timestamp: string;
}

export interface AuditNetworkEntry {
  method: string;
  url: string;
  timestamp: string;
  status?: number;
  failed?: string;
  localApi: boolean;
  source?: string;
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
  expectExecutiveRoyaltiesContractBlock(companyId: number): void;
  flush(): Promise<void>;
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
    ignoredEvents: number;
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

function isOptionalWidgetCancellation(message: string, pageUrl: string): boolean {
  if (!/^CanceledError: canceled(?:\r?\n|$)/u.test(message)) return false;
  try {
    const page = new URL(pageUrl);
    return /^\/zh-cn\/(?:|signup|signin)\/$/.test(page.pathname)
      && /at Object\.cancel \(https?:\/\/[^/]+\/static\/bundle\/assets\/index-[^/]+\.js:97:5276\)/u.test(message)
      && /\/static\/bundle\/assets\/index-[^/]+\.js:1709:95653/u.test(message);
  } catch {
    return false;
  }
}

function isBlockedOptionalFontRequest(url: string, failure: string, sourceUrl: string): boolean {
  if (!/ERR_NETWORK_ACCESS_DENIED/u.test(failure)) return false;
  try {
    const requestUrl = new URL(url);
    const source = new URL(sourceUrl);
    const family = requestUrl.searchParams.get('family');
    return ['fonts.googleapis.com', 'fonts.bunny.net'].includes(requestUrl.hostname)
      && requestUrl.pathname === '/css'
      && /^(?:Roboto(?: Condensed)?|Montserrat|Anton)(?::400,700)?$/u.test(family ?? '')
      && requestUrl.searchParams.get('display') === 'swap'
      && (source.hostname === '127.0.0.1' || source.hostname === 'localhost')
      && source.pathname.startsWith('/zh-cn/');
  } catch {
    return false;
  }
}

function isSignupOrSigninPage(url: string): boolean {
  try {
    const pageUrl = new URL(url);
    return /^\/zh-cn\/(?:signup|signin)\/$/.test(pageUrl.pathname);
  } catch {
    return false;
  }
}

function isOptionalReviewWidgetSource(url: string): boolean {
  try {
    const pageUrl = new URL(url);
    return (pageUrl.hostname === '127.0.0.1' || pageUrl.hostname === 'localhost')
      && /^\/zh-cn\/(?:|signup|signin)\/$/.test(pageUrl.pathname);
  } catch {
    return false;
  }
}

function sameReviewWidgetPage(left: string, right: string): boolean {
  try {
    const leftUrl = new URL(left);
    const rightUrl = new URL(right);
    return leftUrl.origin === rightUrl.origin && leftUrl.pathname === rightUrl.pathname;
  } catch {
    return false;
  }
}

function requestFrameUrl(request: unknown): string | undefined {
  const frame = callValue(request, 'frame');
  return callString(frame, 'url');
}

function executivePage(url: string): boolean {
  try {
    return /^\/zh-cn\/headquarters\/executives(?:\/\d+)?\/$/.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

function isExecutiveRoyaltiesUrl(url: string, companyId: number): boolean {
  try {
    return new URL(url).pathname === `/api/v2/companies/${companyId}/royalties/`;
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
  return `  ${error.timestamp} [${error.type}] ${error.message}${error.url ? ` (at ${error.url})` : ''}${error.source ? ` (from ${error.source})` : ''}`;
}

export function attachBrowserAudit(
  browserPage: BrowserPage,
): BrowserAuditController {
  // Playwright and Puppeteer expose the same event and page methods with different
  // generic event-map types. This single boundary keeps event payloads runtime-checked.
  const page = browserPage as unknown as GenericBrowserPage;
  const errors: AuditError[] = [];
  const network: AuditNetworkEntry[] = [];
  const pendingOptionalReviewRequests = new Map<string, { count: number; source: string }>();
  const expectedRoyaltiesCompanyIds = new Set<number>();
  const pendingRoyaltiesRequests: Array<{ url: string; source: string; timestamp: number }> = [];
  const verifiedRoyaltiesBlocks: Array<{ url: string; source: string; timestamp: number; consoleAvailable: boolean; rejectionAvailable: boolean }> = [];
  const pendingRoyaltiesSideEffects: Array<{ kind: 'console.error' | 'unhandledrejection'; message: string; source: string; timestamp: number }> = [];
  const pendingAuditWork = new Set<Promise<void>>();
  const recentActions: string[] = [];
  const ignored: BrowserAuditSnapshot['ignored'] = [];
  let pendingAnonymousPrefetches = 0;
  const pendingAnonymousConsole401s: string[] = [];
  const expectedAnonymousConsole401s: number[] = [];
  const pendingBlockedFontConsoleErrors = new Map<string, number>();
  const recentOptionalReviewAborts: Array<{ timestamp: number; url: string; source: string }> = [];

  const recordIgnored = (message: string, reason: string): void => {
    ignored.push({ message, reason, timestamp: new Date().toISOString() });
  };
  const recordError = (type: AuditErrorType, message: string, url?: string, source?: string): void => {
    errors.push({ type, message, url, source, timestamp: new Date().toISOString() });
  };
  const recordRoyaltiesSideEffect = (kind: 'console.error' | 'unhandledrejection', message: string, source: string): boolean => {
    const now = Date.now();
    const sourceMatches = (candidate: string): boolean => executivePage(source)
      && executivePage(candidate)
      && sameReviewWidgetPage(source, candidate);
    const block = verifiedRoyaltiesBlocks.find(candidate => now - candidate.timestamp <= 2_000
      && sourceMatches(candidate.source)
      && (kind === 'console.error' ? candidate.consoleAvailable : candidate.rejectionAvailable));
    if (block) {
      if (kind === 'console.error') block.consoleAvailable = false;
      else block.rejectionAvailable = false;
      recordIgnored(message, `Paired within 2 seconds with the same executives page's exact declared GET ${safeUrl(block.url)} response: HTTP 501 code SOURCE_CONTRACT_BLOCKED. This test-scoped exception documents the unavailable upstream royalty contract; it does not allow other 501s or Axios failures.`);
      return true;
    }
    const requestIsPending = pendingRoyaltiesRequests.some(candidate => now - candidate.timestamp <= 2_000
      && sourceMatches(candidate.source));
    if (requestIsPending) {
      pendingRoyaltiesSideEffects.push({ kind, message, source, timestamp: now });
      return true;
    }
    return false;
  };
  const acceptRoyaltiesSideEffect = (block: { url: string; source: string; timestamp: number; consoleAvailable: boolean; rejectionAvailable: boolean }, sideEffect: typeof pendingRoyaltiesSideEffects[number]): boolean => {
    if (Date.now() - sideEffect.timestamp > 2_000 || !sameReviewWidgetPage(block.source, sideEffect.source)) return false;
    if (sideEffect.kind === 'console.error') {
      if (!block.consoleAvailable) return false;
      block.consoleAvailable = false;
    } else {
      if (!block.rejectionAvailable) return false;
      block.rejectionAvailable = false;
    }
    recordIgnored(sideEffect.message, `Paired within 2 seconds with the same executives page's exact declared GET ${safeUrl(block.url)} response: HTTP 501 code SOURCE_CONTRACT_BLOCKED. This test-scoped exception documents the unavailable upstream royalty contract; it does not allow other 501s or Axios failures.`);
    return true;
  };
  const observeUnhandledRejections = (): void => {
    window.addEventListener('unhandledrejection', event => {
      event.preventDefault();
      const reason = event.reason instanceof Error
        ? event.reason.stack || event.reason.message
        : String(event.reason);
      console.error(`[BROWSER_AUDIT_UNHANDLED_REJECTION] ${reason}`);
    });
  };
  const pageWithInitScript = browserPage as unknown as {
    addInitScript?: (script: () => void) => Promise<unknown>;
    evaluateOnNewDocument?: (script: () => void) => Promise<unknown>;
  };
  const installInitScript = pageWithInitScript.addInitScript ?? pageWithInitScript.evaluateOnNewDocument;
  if (installInitScript) {
    void Promise.resolve(installInitScript.call(browserPage, observeUnhandledRejections)).catch(error => {
      recordError('pageerror', `Could not install unhandled-rejection audit: ${error instanceof Error ? error.message : String(error)}`, safeUrl(currentUrl(page)));
    });
  } else {
    recordError('pageerror', 'Browser page does not support a new-document audit script for unhandled rejections.', safeUrl(currentUrl(page)));
  }
  const flushUnpairedAnonymousConsoleErrors = (): void => {
    if (pendingAnonymousPrefetches > 0) return;
    while (pendingAnonymousConsole401s.length > 0) {
      recordError('console.error', pendingAnonymousConsole401s.shift() ?? 'Unpaired anonymous 401 console error', safeUrl(currentUrl(page)));
    }
  };
  const takeOptionalReviewRequest = (method: string, url: string): string | undefined => {
    const key = `${method} ${url}`;
    const pending = pendingOptionalReviewRequests.get(key) ?? { count: 0, source: '' };
    if (pending.count === 0) return undefined;
    if (pending.count === 1) pendingOptionalReviewRequests.delete(key);
    else pendingOptionalReviewRequests.set(key, { ...pending, count: pending.count - 1 });
    return pending.source;
  };

  page.on('pageerror', (payload) => {
    const message = readStringProperty(payload, 'stack')
      || readStringProperty(payload, 'message')
      || String(payload);
      recordError('pageerror', safeMessage(message), safeUrl(currentUrl(page)), safeUrl(currentUrl(page)));
  });

  page.on('console', (payload) => {
    const type = callString(payload, 'type');
    if (type !== 'error') return;
    const message = callString(payload, 'text') || String(payload);
    if (message.startsWith('[BROWSER_AUDIT_UNHANDLED_REJECTION] ')) {
      const rejection = message.slice('[BROWSER_AUDIT_UNHANDLED_REJECTION] '.length);
      const sourceUrl = safeUrl(currentUrl(page));
      if (/^AxiosError: Request failed with status code 501(?:\r?\n|$)/u.test(rejection)
        && recordRoyaltiesSideEffect('unhandledrejection', rejection, sourceUrl)) return;
      if (isOptionalWidgetCancellation(rejection, currentUrl(page))) {
        const matchIndex = recentOptionalReviewAborts.findIndex(abort =>
          Date.now() - abort.timestamp <= 2_000
          && isOptionalReviewWidgetSource(abort.source)
          && isOptionalReviewWidgetSource(currentUrl(page))
          && sameReviewWidgetPage(abort.source, currentUrl(page)));
        if (matchIndex >= 0) {
          const [abort] = recentOptionalReviewAborts.splice(matchIndex, 1);
          recordIgnored(message, `The public landing/signup/signin page's optional MyReviews widget rejected during its verified cleanup (index bundle 1709:95653), paired within 2 seconds with ${safeUrl(abort.url)} failing ERR_ABORTED from request frame ${safeUrl(abort.source)}; rejection page was ${sourceUrl}.`);
          return;
        }
      }
      recordError('unhandledrejection', safeMessage(rejection), sourceUrl, sourceUrl);
      return;
    }
    if (message === 'Failed to load resource: the server responded with a status of 501 (Not Implemented)'
      && recordRoyaltiesSideEffect('console.error', message, safeUrl(currentUrl(page)))) return;
    if (message === 'Failed to load resource: net::ERR_NETWORK_ACCESS_DENIED') {
      const sourceUrl = safeUrl(currentUrl(page));
      const pending = pendingBlockedFontConsoleErrors.get(sourceUrl) ?? 0;
      if (pending > 0) {
        if (pending === 1) pendingBlockedFontConsoleErrors.delete(sourceUrl);
        else pendingBlockedFontConsoleErrors.set(sourceUrl, pending - 1);
        recordIgnored(message, `Paired with an observed ERR_NETWORK_ACCESS_DENIED for one exact optional Google Fonts/Bunny CSS family request; source page was ${sourceUrl}. Other console and network failures remain fatal.`);
        return;
      }
    }
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
    recordError('console.error', safeMessage(message), safeUrl(currentUrl(page)), safeUrl(currentUrl(page)));
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
    const sourceUrl = requestFrameUrl(payload) || currentUrl(page);
    if (method === 'GET' && isBlockedOptionalFontRequest(url, failure, sourceUrl)) {
      const safeSourceUrl = safeUrl(sourceUrl);
      pendingBlockedFontConsoleErrors.set(safeSourceUrl, (pendingBlockedFontConsoleErrors.get(safeSourceUrl) ?? 0) + 1);
      network.push({ method, url: safeUrl(url), timestamp: new Date().toISOString(), failed: failure, localApi: false, source: safeSourceUrl });
      recordIgnored(message, `Optional font CSS could not leave the isolated browser environment. Matched only ERR_NETWORK_ACCESS_DENIED for the exact Roboto/Roboto Condensed/Montserrat/Anton CSS URL from ${safeSourceUrl}.`);
      return;
    }
    const optionalReviewSource = isOptionalReviewEndpoint(url) ? takeOptionalReviewRequest(method, url) : undefined;
    if (optionalReviewSource && /\bERR_ABORTED\b/u.test(failure)) {
      recentOptionalReviewAborts.push({ timestamp: Date.now(), url, source: optionalReviewSource });
      network.push({ method, url: safeUrl(url), timestamp: new Date().toISOString(), failed: failure, localApi: false, source: safeUrl(optionalReviewSource) });
      recordIgnored(message, `Optional review widget request to the exact myreviews.ai reviews endpoint; its browser request frame was ${safeUrl(optionalReviewSource)} on the public landing/signup/signin route.`);
      return;
    }
    if (pendingAnonymousPrefetches > 0 && isAnonymousContractPrefetchEndpoint(url, method)) {
      pendingAnonymousPrefetches--;
      flushUnpairedAnonymousConsoleErrors();
    }
    network.push({
      method,
      url: safeUrl(url),
      timestamp: new Date().toISOString(),
      failed: failure,
      localApi,
      source: safeUrl(sourceUrl),
    });
    recordError('requestfailed', message, safeUrl(url), safeUrl(sourceUrl));
  });

  page.on('request', (payload) => {
    const url = callString(payload, 'url') || 'unknown';
    const method = callString(payload, 'method') || 'GET';
    const sourceUrl = requestFrameUrl(payload) || currentUrl(page);
    if (method === 'GET' && executivePage(sourceUrl)
      && [...expectedRoyaltiesCompanyIds].some(companyId => isExecutiveRoyaltiesUrl(url, companyId))) {
      pendingRoyaltiesRequests.push({ url, source: sourceUrl, timestamp: Date.now() });
    }
    if (method === 'GET' && isOptionalReviewEndpoint(url) && isOptionalReviewWidgetSource(sourceUrl)) {
      const key = `${method} ${url}`;
      const existing = pendingOptionalReviewRequests.get(key);
      pendingOptionalReviewRequests.set(key, { count: (existing?.count ?? 0) + 1, source: existing?.source ?? sourceUrl });
      network.push({ method, url: safeUrl(url), timestamp: new Date().toISOString(), localApi: false, failed: 'pending optional third-party request', source: safeUrl(sourceUrl) });
    }
    const localApi = sameOriginApi(url, currentUrl(page));
    if (!localApi) return;
    if (isAnonymousContractPrefetch(url, method, currentUrl(page))) pendingAnonymousPrefetches++;
    network.push({ method, url: safeUrl(url), timestamp: new Date().toISOString(), localApi, failed: 'pending', source: safeUrl(sourceUrl) });
  });

  page.on('response', (payload) => {
    const url = callString(payload, 'url') || 'unknown';
    const status = callNumber(payload, 'status');
    const request = callValue(payload, 'request');
    const method = callString(request, 'method') || 'GET';
    const localApi = sameOriginApi(url, currentUrl(page));
    const timestamp = new Date().toISOString();
    const sourceUrl = requestFrameUrl(request) || currentUrl(page);
    const optionalReviewSource = isOptionalReviewEndpoint(url) ? takeOptionalReviewRequest(method, url) : undefined;
    network.push({ method, url: safeUrl(url), timestamp, status, localApi, ...(optionalReviewSource ? { source: safeUrl(optionalReviewSource) } : localApi ? { source: safeUrl(sourceUrl) } : {}) });

    const royaltiesRequestIndex = method === 'GET' && status === 501 && executivePage(sourceUrl)
      ? pendingRoyaltiesRequests.findIndex(candidate => candidate.url === url
        && Date.now() - candidate.timestamp <= 2_000
        && sameReviewWidgetPage(candidate.source, sourceUrl))
      : -1;
    if (royaltiesRequestIndex >= 0) {
      const royaltiesRequest = pendingRoyaltiesRequests[royaltiesRequestIndex];
      const companyId = [...expectedRoyaltiesCompanyIds].find(id => isExecutiveRoyaltiesUrl(url, id));
      if (companyId !== undefined) {
        const work = Promise.resolve(callValue(payload, 'json')).then(body => {
          const pendingRequestIndex = pendingRoyaltiesRequests.indexOf(royaltiesRequest);
          if (pendingRequestIndex >= 0) pendingRoyaltiesRequests.splice(pendingRequestIndex, 1);
          const bodyCode = readStringProperty(body, 'code');
          if (bodyCode !== 'SOURCE_CONTRACT_BLOCKED') {
            recordError('http5xx', safeMessage(`HTTP 501 with unexpected body for ${method} ${url}; code=${bodyCode ?? 'missing'}`), safeUrl(url), safeUrl(sourceUrl));
            return;
          }
          const block = { url, source: royaltiesRequest.source, timestamp: Date.now(), consoleAvailable: true, rejectionAvailable: true };
          verifiedRoyaltiesBlocks.push(block);
          recordIgnored(`HTTP 501: ${method} ${safeUrl(url)} code SOURCE_CONTRACT_BLOCKED`, `This executive-history test explicitly declared the authenticated company's own royalties endpoint (${companyId}) as a known unavailable upstream contract; response came from ${safeUrl(royaltiesRequest.source)}. This exception is local to this BrowserAudit instance.`);
          for (let index = pendingRoyaltiesSideEffects.length - 1; index >= 0; index--) {
            if (acceptRoyaltiesSideEffect(block, pendingRoyaltiesSideEffects[index])) pendingRoyaltiesSideEffects.splice(index, 1);
          }
        }).catch(error => {
          const pendingRequestIndex = pendingRoyaltiesRequests.indexOf(royaltiesRequest);
          if (pendingRequestIndex >= 0) pendingRoyaltiesRequests.splice(pendingRequestIndex, 1);
          recordError('http5xx', safeMessage(`Could not verify SOURCE_CONTRACT_BLOCKED body for ${method} ${url}: ${error instanceof Error ? error.message : String(error)}`), safeUrl(url), safeUrl(sourceUrl));
        }).finally(() => pendingAuditWork.delete(work));
        pendingAuditWork.add(work);
        return;
      }
    }

    if (optionalReviewSource && status !== undefined && status >= 400) {
      recordIgnored(`HTTP ${status}: ${method} ${safeUrl(url)}`, `Optional review widget response from the exact myreviews.ai endpoint; its browser request frame was ${safeUrl(optionalReviewSource)} on the public landing/signup/signin route.`);
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
      recordError('http5xx', safeMessage(`HTTP ${status}: ${method} ${url}`), safeUrl(url), safeUrl(sourceUrl));
      return;
    }
    if (localApi && status >= 400) {
      recordError('api4xx', safeMessage(`API HTTP ${status}: ${method} ${url}`), safeUrl(url), safeUrl(sourceUrl));
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
    expectExecutiveRoyaltiesContractBlock(companyId: number): void {
      assert.ok(Number.isInteger(companyId) && companyId > 0, 'expected royalty company id must be a positive integer');
      expectedRoyaltiesCompanyIds.add(companyId);
    },
    async flush(): Promise<void> {
      await Promise.all([...pendingAuditWork]);
      for (const sideEffect of pendingRoyaltiesSideEffects.splice(0)) {
        recordError(sideEffect.kind, sideEffect.message, undefined, safeUrl(sideEffect.source));
      }
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
        ignoredEvents: ignored.length,
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
