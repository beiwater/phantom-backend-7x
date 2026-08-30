import type { Page, Request, Response, TestInfo } from '@playwright/test';

const MAX_RESPONSE_BODY_LENGTH = 12_000;

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
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: FailedRequestDiagnostic[];
  apiResponses: ApiDiagnostic[];
}

export interface DiagnosticsController {
  readonly data: BrowserDiagnostics;
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
    url: request.url(),
    failure: request.failure()?.errorText,
    localApi: isLocalApiUrl(request.url()),
  };
}

async function readResponseBody(response: Response): Promise<string | undefined> {
  try {
    const body = await response.text();
    return body.length > MAX_RESPONSE_BODY_LENGTH
      ? `${body.slice(0, MAX_RESPONSE_BODY_LENGTH)}\n...[truncated]`
      : body;
  } catch {
    return undefined;
  }
}

export function attachDiagnostics(page: Page): DiagnosticsController {
  const data: BrowserDiagnostics = {
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    apiResponses: [],
  };
  const pendingResponseBodies = new Set<Promise<void>>();

  page.on('console', (message) => {
    if (message.type() === 'error') {
      data.consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    const text = error.stack || error.message || String(error);
    if (text.includes('CanceledError') || text.includes('ERR_CANCELED') || text === 'Yi' || text.includes('canceled')) {
      return;
    }
    data.pageErrors.push(text);
  });
  page.on('requestfailed', (request) => {
    data.failedRequests.push(describeRequest(request));
  });
  page.on('response', (response) => {
    if (!isLocalApiUrl(response.url())) {
      return;
    }

    const request = response.request();
    const diagnostic: ApiDiagnostic = {
      method: request.method(),
      url: response.url(),
      status: response.status(),
      ok: response.ok(),
      requestBody: request.postData() ?? undefined,
    };
    data.apiResponses.push(diagnostic);

    const pendingBody = readResponseBody(response)
      .then((responseBody) => {
        diagnostic.responseBody = responseBody;
      })
      .finally(() => {
        pendingResponseBodies.delete(pendingBody);
      });
    pendingResponseBodies.add(pendingBody);
  });

  return {
    data,
    async flush(): Promise<void> {
      await Promise.all([...pendingResponseBodies]);
    },
    async write(testInfo: TestInfo): Promise<void> {
      await this.flush();
      await testInfo.attach('browser-diagnostics.json', {
        body: JSON.stringify(data, null, 2),
        contentType: 'application/json',
      });
    },
  };
}
