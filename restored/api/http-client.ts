/**
 * Reconstructed HTTP Client
 * Reverses the official frontend HTTP wrapper (oe() and Xcr header builder)
 */

export interface HttpResponse<T = unknown> {
  data: T;
  status: number;
  headers: Record<string, string>;
}

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp('(^|; )' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[2]) : null;
}

export class HttpClient {
  private baseURL: string;

  constructor(baseURL = '') {
    this.baseURL = baseURL;
  }

  private buildHeaders(customHeaders: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Yep': 'true',
      ...customHeaders
    };

    const csrf = getCookie('csrftoken') || getCookie('csrf_token');
    if (csrf) {
      headers['X-CSRFToken'] = csrf;
    }

    if (typeof Intl !== 'undefined') {
      headers['X-tz-offset'] = String(new Date().getTimezoneOffset());
    }

    return headers;
  }

  async get<T = unknown>(url: string, headers?: Record<string, string>): Promise<HttpResponse<T>> {
    const res = await fetch(`${this.baseURL}${url}`, {
      method: 'GET',
      headers: this.buildHeaders(headers)
    });
    const data = (await res.json().catch(() => null)) as T;
    if (!res.ok) throw { status: res.status, data };
    return { data, status: res.status, headers: {} };
  }

  async post<T = unknown>(url: string, body?: unknown, headers?: Record<string, string>): Promise<HttpResponse<T>> {
    const res = await fetch(`${this.baseURL}${url}`, {
      method: 'POST',
      headers: this.buildHeaders(headers),
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const data = (await res.json().catch(() => null)) as T;
    if (!res.ok) throw { status: res.status, data };
    return { data, status: res.status, headers: {} };
  }

  async put<T = unknown>(url: string, body?: unknown, headers?: Record<string, string>): Promise<HttpResponse<T>> {
    const res = await fetch(`${this.baseURL}${url}`, {
      method: 'PUT',
      headers: this.buildHeaders(headers),
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const data = (await res.json().catch(() => null)) as T;
    if (!res.ok) throw { status: res.status, data };
    return { data, status: res.status, headers: {} };
  }

  async patch<T = unknown>(url: string, body?: unknown, headers?: Record<string, string>): Promise<HttpResponse<T>> {
    const res = await fetch(`${this.baseURL}${url}`, {
      method: 'PATCH',
      headers: this.buildHeaders(headers),
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const data = (await res.json().catch(() => null)) as T;
    if (!res.ok) throw { status: res.status, data };
    return { data, status: res.status, headers: {} };
  }

  async delete<T = unknown>(url: string, headers?: Record<string, string>): Promise<HttpResponse<T>> {
    const res = await fetch(`${this.baseURL}${url}`, {
      method: 'DELETE',
      headers: this.buildHeaders(headers)
    });
    const data = (await res.json().catch(() => null)) as T;
    if (!res.ok) throw { status: res.status, data };
    return { data, status: res.status, headers: {} };
  }
}

export const httpClient = new HttpClient();
