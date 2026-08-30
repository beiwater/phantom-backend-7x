import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const COOKIES_PATH = path.join(__dirname, 'cookies.json');

export function saveCookies(email: string, sessionid: string): void {
  const data = JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf-8'));
  data.accounts[email] = {
    email,
    sessionid,
    domain: '127.0.0.1',
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
  };
  data.lastUpdated = new Date().toISOString();
  fs.writeFileSync(COOKIES_PATH, JSON.stringify(data, null, 2));
}

export function loadCookies(email: string): string | null {
  const data = JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf-8'));
  return data.accounts[email]?.sessionid ?? null;
}

export function hasCookies(email: string): boolean {
  return loadCookies(email) !== null;
}
