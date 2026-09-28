import type { Page, Request, Response, TestInfo } from '@playwright/test';
import { attachBrowserAudit, type BrowserAuditController } from './browser-audit.ts';

const MAX_RESPONSE_BODY_LENGTH = 12_000;
const SENSITIVE_FIELD = /(?:password|passwd|pwd|token|cookie|authorization|session|secret|api[_-]?key|private[_-]?key)/i;
const AUTH_ENDPOINT = /(?:^|\/)(?:auth|login|signin|signup|register|password)(?:\/|$)/i;

function redactJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactJsonValue);
  if (typeof value !== 'object' || value === null) return value;

  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key,
    SENSITIVE_FIELD.test(key) ? '[REDACTED]' : redactJsonValue(entry),
  ]));
}

/** Keep business request evidence while removing credentials from attached diagnostics. */
export function redactDiagnosticBody(body: string | undefined, requestUrl: string): string | undefined {
  if (body === undefined) return undefined;
  try {
    return JSON.stringify(redactJsonValue(JSON.parse(body)));
  } catch {
    // Form-encoded payloads are common for auth calls and can be safely redacted by key.
    if (/(?:^|&)[^=&]+=/u.test(body)) {
      const params = new URLSearchParams(body);
      for (const key of params.keys()) {
        if (SENSITIVE_FIELD.test(key)) params.set(key, '[REDACTED]');
      }
      return params.toString();
    }

    // An opaque body sent to an authentication endpoint must never be copied verbatim.
    if (AUTH_ENDPOINT.test(new URL(requestUrl).pathname)) return '[REDACTED auth request body]';

    return body
      .replace(/(["']?[^\s&=:'"]*(?:password|passwd|pwd|token|cookie|authorization|session|secret|api[_-]?key|private[_-]?key)[^\s&=:'"]*["']?\s*[:=]\s*["']?)[^"'&,\s}]+/giu, '$1[REDACTED]')
      .slice(0, MAX_RESPONSE_BODY_LENGTH);
  }
}

function redactDiagnosticUrl(url: string): string {
  try {
    const parsed = new URL(url);
    for (const key of parsed.searchParams.keys()) {
      if (SENSITIVE_FIELD.test(key)) parsed.searchParams.set(key, '[REDACTED]');
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

function redactDiagnosticText(value: string): string {
  return value.replace(/https?:\/\/[^\s"')]+/giu, match => redactDiagnosticUrl(match));
}

export interface ApiDiagnostic {
  method: string;
  url: string;
  status: number;
  ok: boolean;
  requestBody?: string;
  responseBody?: string;
}

export interface FailedRequestDiagnostic {
  method: string;
  url: string;
  failure?: string;
  localApi: boolean;
}

export interface BrowserDiagnostics {
  currentUrl: string;
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: FailedRequestDiagnostic[];
  apiResponses: ApiDiagnostic[];
  audit: ReturnType<BrowserAuditController['snapshot']>;
}

export interface DiagnosticsController {
  readonly data: BrowserDiagnostics;
  readonly audit: BrowserAuditController;
  recordAction(actionName: string): void;
  assertClean(contextMessage?: string): void;
  include(data: BrowserDiagnostics): void;
  flush(): Promise<void>;
  write(testInfo: TestInfo): Promise<void>;
}

function isLocalApiUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    return (parsedUrl.hostname === '127.0.0.1' || parsedUrl.hostname === 'localhost')
      && parsedUrl.pathname.startsWith('/api/');
  } catch {
    return false;
  }
}

function describeRequest(request: Request): FailedRequestDiagnostic {
  return {
    method: request.method(),
    url: redactDiagnosticUrl(request.url()),
    failure: request.failure()?.errorText,
    localApi: isLocalApiUrl(request.url()),
  };
}

async function readResponseBody(response: Response): Promise<string | undefined> {
  try {
    const body = redactDiagnosticBody(await response.text(), response.url());
    if (body === undefined) return undefined;
    return body.length > MAX_RESPONSE_BODY_LENGTH
      ? `${body.slice(0, MAX_RESPONSE_BODY_LENGTH)}\n...[truncated]`
      : body;
  } catch {
    return undefined;
  }
}

export function attachDiagnostics(page: Page): DiagnosticsController {
  const audit = attachBrowserAudit(page);
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: FailedRequestDiagnostic[] = [];
  const apiResponses: ApiDiagnostic[] = [];
  const pendingResponseBodies = new Set<Promise<void>>();

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => {
    pageErrors.push(error.stack || error.message || String(error));
  });
  page.on('requestfailed', (request) => {
    failedRequests.push(describeRequest(request));
  });
  page.on('response', (response) => {
    if (!isLocalApiUrl(response.url())) return;

    const request = response.request();
    const diagnostic: ApiDiagnostic = {
      method: request.method(),
      url: redactDiagnosticUrl(response.url()),
      status: response.status(),
      ok: response.ok(),
      requestBody: redactDiagnosticBody(request.postData() ?? undefined, response.url()),
    };
    apiResponses.push(diagnostic);

    const pendingBody = readResponseBody(response)
      .then((responseBody) => {
        diagnostic.responseBody = responseBody;
      })
      .finally(() => {
        pendingResponseBodies.delete(pendingBody);
      });
    pendingResponseBodies.add(pendingBody);
  });

  const controller: DiagnosticsController = {
    get data(): BrowserDiagnostics {
      return {
        currentUrl: redactDiagnosticUrl(page.url()),
        consoleErrors: consoleErrors.map(redactDiagnosticText),
        pageErrors: pageErrors.map(redactDiagnosticText),
        failedRequests: [...failedRequests],
        apiResponses: [...apiResponses],
        audit: audit.snapshot(),
      };
    },
    audit,
    recordAction(actionName: string): void {
      audit.recordAction(actionName);
    },
    assertClean(contextMessage?: string): void {
      audit.assertClean(contextMessage);
    },
    include(data: BrowserDiagnostics): void {
      consoleErrors.push(...data.consoleErrors);
      pageErrors.push(...data.pageErrors);
      failedRequests.push(...data.failedRequests);
      apiResponses.push(...data.apiResponses);
    },
    async flush(): Promise<void> {
      await Promise.all([...pendingResponseBodies]);
    },
    async write(testInfo: TestInfo): Promise<void> {
      await controller.flush();
      const body = JSON.stringify(controller.data, null, 2);
      await testInfo.attach('browser-diagnostics.json', {
        body,
        contentType: 'application/json',
      });

      const auditSnapshot = audit.snapshot();
      if (auditSnapshot.errors.length > 0 || testInfo.status !== 'passed') {
        try {
          await testInfo.attach('browser-failure.png', {
            body: await page.screenshot({ fullPage: true }),
            contentType: 'image/png',
          });
        } catch {
          // Playwright's trace and diagnostic JSON remain available if the page is already closed.
        }
      }

      if (testInfo.status === 'passed') audit.assertClean(`Playwright test: ${testInfo.title}`);
    },
  };
  return controller;
}
