import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const EXECUTABLE_NAMES = [
  'chrome-headless-shell',
  'chrome',
  'chromium',
  'chromium-browser',
  'google-chrome',
  'google-chrome-stable',
] as const;

const MAX_SCAN_DEPTH = 8;

function isExecutable(filePath: string): boolean {
  try {
    if (!fs.statSync(filePath).isFile()) {
      return false;
    }
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function addCandidate(candidates: string[], candidate: string | undefined): void {
  if (!candidate) {
    return;
  }

  const resolvedPath = path.resolve(candidate);
  if (!candidates.includes(resolvedPath)) {
    candidates.push(resolvedPath);
  }
}

function addKnownBrowserLocations(candidates: string[]): void {
  const repositoryRoot = process.cwd();
  const homeCache = path.join(os.homedir(), '.cache');
  const macCache = path.join(os.homedir(), 'Library', 'Caches');
  const explicitPaths = [
    process.env.E2E_BROWSER_PATH,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ];

  for (const explicitPath of explicitPaths) {
    addCandidate(candidates, explicitPath);
  }

  const browserRoots = [
    path.join(repositoryRoot, 'node_modules', 'playwright-core', '.local-browsers'),
    path.join(repositoryRoot, 'node_modules', 'puppeteer', '.local-chromium'),
    path.join(homeCache, 'ms-playwright'),
    path.join(homeCache, 'puppeteer'),
    path.join(macCache, 'ms-playwright'),
    path.join(macCache, 'puppeteer'),
    '/opt/phantom-browsers',
    '/usr/bin',
    '/usr/local/bin',
  ];

  for (const root of browserRoots) {
    for (const executableName of EXECUTABLE_NAMES) {
      addCandidate(candidates, path.join(root, executableName));
    }
  }
}

function findNamedExecutable(root: string, depth: number): string | undefined {
  if (depth > MAX_SCAN_DEPTH) {
    return undefined;
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return undefined;
  }

  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isFile() && EXECUTABLE_NAMES.includes(entry.name as typeof EXECUTABLE_NAMES[number]) && isExecutable(entryPath)) {
      return entryPath;
    }
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === '.git' || entry.name === 'node_modules') {
      continue;
    }

    const match = findNamedExecutable(path.join(root, entry.name), depth + 1);
    if (match) {
      return match;
    }
  }

  return undefined;
}

export function findBrowserExecutable(): string {
  const candidates: string[] = [];
  addKnownBrowserLocations(candidates);

  for (const candidate of candidates) {
    if (isExecutable(candidate)) {
      return candidate;
    }
  }

  const scanRoots = [
    path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'),
    path.join(os.homedir(), 'Library', 'Caches', 'puppeteer'),
    path.join(os.homedir(), '.cache', 'ms-playwright'),
    path.join(os.homedir(), '.cache', 'puppeteer'),
    '/opt/phantom-browsers',
    '/usr/lib',
    '/usr/local/lib',
  ];
  for (const root of scanRoots) {
    const match = findNamedExecutable(root, 0);
    if (match) {
      return match;
    }
  }

  throw new Error([
    'No executable Chromium-compatible browser was found.',
    'Set E2E_BROWSER_PATH to Chrome for Testing, Chromium, or chrome-headless-shell.',
    'The runner checks project dependencies and non-temporary /opt and system browser locations.',
  ].join(' '));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    console.log(findBrowserExecutable());
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
