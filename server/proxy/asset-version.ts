import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config.ts';
import { RealmPhaseService } from '../services/realm-phase-service.ts';

export const FRONTEND_MAIN_BUNDLE_PATH = 'bundle/assets/index-cgzgptQ8.js';
export const FRONTEND_VERSION_PLACEHOLDER = '__SIMCOMPANIES_FRONTEND_VERSION__';

/**
 * These are the local release inputs that can change the running application.
 * Images, fonts, audio, and remote third-party styles are intentionally outside
 * this change-detection scope; they are not the application code/bootstrap.
 */
const FRONTEND_RELEASE_ASSETS = [
  FRONTEND_MAIN_BUNDLE_PATH,
  'bundle/assets/index-BsDbFrGK.css',
  'CACHE5/css/output.360142e683a5.css',
  'js/browser-translation.4d2c838bdb85.js',
  'js/realm-company-switch.js',
  'js/lang6/en.b0ef0ef4cd73.json',
  'js/lang6/zh-cn.5e80c8238708.json',
  'manifest.json'
] as const;

const FRONTEND_SYNTAX_REPAIRS: Record<string, readonly [string, string]> = {
  // Commit bbe9bed added a finite-number guard to this compiled React
  // component but dropped the closing call parenthesis. Keep the vendor
  // bundle immutable on disk while serving the corrected byte stream.
  [FRONTEND_MAIN_BUNDLE_PATH]: [
    ']})};var NSi=',
    ']})})};var NSi='
  ]
};

const FRONTEND_PX_PATTERN = /Px=\{0:\{[\s\S]*?\},2:\{[\s\S]*?\}\}/g;

interface PreparedFrontendAsset {
  body: string;
  sha256: string;
  bytes: number;
}

interface PreparedFrontendAssetCacheEntry extends PreparedFrontendAsset {
  mtimeMs: number;
  ctimeMs: number;
  size: number;
  dynamicPx: string | null;
}

interface FileDigestCacheEntry {
  mtimeMs: number;
  ctimeMs: number;
  size: number;
  sha256: string;
  bytes: number;
}

export interface FrontendVersionAsset {
  path: string;
  sha256: string;
  bytes: number;
}

export interface FrontendVersionManifest {
  version: string;
  sha256: string;
  algorithm: 'sha256';
  generatedAt: string;
  assets: FrontendVersionAsset[];
  scope: string;
}

const preparedFrontendAssetCache = new Map<string, PreparedFrontendAssetCacheEntry>();
const fileDigestCache = new Map<string, FileDigestCacheEntry>();

function applyFrontendSyntaxRepair(cleanRelPath: string, source: string): string {
  const syntaxRepair = FRONTEND_SYNTAX_REPAIRS[cleanRelPath];
  if (!syntaxRepair) {
    return source;
  }

  const [rawToken, repairedToken] = syntaxRepair;
  const rawIndex = source.indexOf(rawToken);
  if (rawIndex === -1) {
    if (source.includes(repairedToken)) {
      return source;
    }
    throw new Error(`Frontend syntax repair did not match ${cleanRelPath}`);
  }
  if (source.indexOf(rawToken, rawIndex + rawToken.length) !== -1) {
    throw new Error(`Frontend syntax repair matched multiple locations in ${cleanRelPath}`);
  }

  return `${source.slice(0, rawIndex)}${repairedToken}${source.slice(rawIndex + rawToken.length)}`;
}

export function prepareFrontendAsset(
  cleanRelPath: string,
  source: string,
  dynamicPxScript?: string
): string {
  let prepared = applyFrontendSyntaxRepair(cleanRelPath, source);
  if (cleanRelPath !== FRONTEND_MAIN_BUNDLE_PATH) {
    return prepared;
  }

  const pxMatches = prepared.match(FRONTEND_PX_PATTERN) ?? [];
  if (pxMatches.length !== 1) {
    throw new Error(
      `Frontend Px injection expected one supported realm object in ${cleanRelPath}; found ${pxMatches.length}`
    );
  }

  const dynamicPx = dynamicPxScript ?? RealmPhaseService.generateFrontendPxScript();
  prepared = prepared.replace(FRONTEND_PX_PATTERN, () => dynamicPx);
  return prepared;
}

/**
 * Return the exact text served for a prepared local asset. The cache avoids
 * rereading the large bundle unless its file metadata or dynamic realm payload
 * changes; the dynamic payload itself is cheap to regenerate and captures
 * runtime phase changes without hashing the bundle on every request.
 */
export function readPreparedFrontendAsset(
  cleanRelPath: string,
  localFilePath: string
): PreparedFrontendAsset {
  const stat = fs.statSync(localFilePath);
  const dynamicPx = cleanRelPath === FRONTEND_MAIN_BUNDLE_PATH
    ? RealmPhaseService.generateFrontendPxScript()
    : null;
  const cached = preparedFrontendAssetCache.get(localFilePath);
  if (
    cached &&
    cached.mtimeMs === stat.mtimeMs &&
    cached.ctimeMs === stat.ctimeMs &&
    cached.size === stat.size &&
    cached.dynamicPx === dynamicPx
  ) {
    return cached;
  }

  const source = fs.readFileSync(localFilePath, 'utf-8');
  const body = prepareFrontendAsset(cleanRelPath, source, dynamicPx ?? undefined);
  const bytes = Buffer.byteLength(body, 'utf8');
  const prepared: PreparedFrontendAssetCacheEntry = {
    body,
    sha256: crypto.createHash('sha256').update(body, 'utf8').digest('hex'),
    bytes,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
    size: stat.size,
    dynamicPx
  };
  preparedFrontendAssetCache.set(localFilePath, prepared);
  return prepared;
}

function digestLocalFile(filePath: string): FileDigestCacheEntry {
  const stat = fs.statSync(filePath);
  const cached = fileDigestCache.get(filePath);
  if (
    cached &&
    cached.mtimeMs === stat.mtimeMs &&
    cached.ctimeMs === stat.ctimeMs &&
    cached.size === stat.size
  ) {
    return cached;
  }

  const body = fs.readFileSync(filePath);
  const digest: FileDigestCacheEntry = {
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
    size: stat.size,
    sha256: crypto.createHash('sha256').update(body).digest('hex'),
    bytes: body.byteLength
  };
  fileDigestCache.set(filePath, digest);
  return digest;
}

function normalizeHtmlTemplate(source: string): string {
  const markerCount = source.split(FRONTEND_VERSION_PLACEHOLDER).length - 1;
  if (markerCount !== 1) {
    throw new Error(
      `Frontend HTML version placeholder expected once; found ${markerCount}`
    );
  }
  // The marker is deliberately hashed instead of the per-response version
  // value, preventing the shell's embedded version from hashing itself.
  return source;
}

function digestHtmlTemplate(htmlPath: string): FrontendVersionAsset {
  const stat = fs.statSync(htmlPath);
  const cached = fileDigestCache.get(htmlPath);
  if (
    cached &&
    cached.mtimeMs === stat.mtimeMs &&
    cached.ctimeMs === stat.ctimeMs &&
    cached.size === stat.size
  ) {
    return {
      path: 'html/index.html',
      sha256: cached.sha256,
      bytes: cached.bytes
    };
  }

  const source = normalizeHtmlTemplate(fs.readFileSync(htmlPath, 'utf-8'));
  const body = Buffer.from(source, 'utf8');
  const digest: FileDigestCacheEntry = {
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
    size: stat.size,
    sha256: crypto.createHash('sha256').update(body).digest('hex'),
    bytes: body.byteLength
  };
  fileDigestCache.set(htmlPath, digest);
  return {
    path: 'html/index.html',
    sha256: digest.sha256,
    bytes: digest.bytes
  };
}

function resolveStaticAsset(assetPath: string): string {
  const staticRoot = path.resolve(CONFIG.STATIC_DIR);
  const localFilePath = path.resolve(staticRoot, assetPath);
  if (localFilePath !== staticRoot && !localFilePath.startsWith(`${staticRoot}${path.sep}`)) {
    throw new Error(`Frontend release asset escaped static root: ${assetPath}`);
  }
  if (!fs.existsSync(localFilePath) || !fs.statSync(localFilePath).isFile()) {
    throw new Error(`Frontend release asset is missing: ${assetPath}`);
  }
  return localFilePath;
}

function digestReleaseAsset(assetPath: string): FrontendVersionAsset {
  const localFilePath = resolveStaticAsset(assetPath);
  if (assetPath === FRONTEND_MAIN_BUNDLE_PATH) {
    const prepared = readPreparedFrontendAsset(assetPath, localFilePath);
    return {
      path: `static/${assetPath}`,
      sha256: prepared.sha256,
      bytes: prepared.bytes
    };
  }

  const digest = digestLocalFile(localFilePath);
  return {
    path: `static/${assetPath}`,
    sha256: digest.sha256,
    bytes: digest.bytes
  };
}

function hashManifest(assets: readonly FrontendVersionAsset[]): string {
  const manifestInput = assets
    .map(asset => `${asset.path}\u0000${asset.sha256}\u0000${asset.bytes}\n`)
    .join('');
  return crypto.createHash('sha256').update(manifestInput, 'utf8').digest('hex');
}

export function getFrontendVersion(): FrontendVersionManifest {
  const htmlPath = path.join(CONFIG.HTML_DIR, 'index.html');
  if (!fs.existsSync(htmlPath) || !fs.statSync(htmlPath).isFile()) {
    throw new Error('Frontend HTML template is missing');
  }

  const assets: FrontendVersionAsset[] = [
    digestHtmlTemplate(htmlPath),
    ...FRONTEND_RELEASE_ASSETS.map(digestReleaseAsset)
  ];
  const version = hashManifest(assets);
  return {
    version,
    sha256: version,
    algorithm: 'sha256',
    generatedAt: new Date().toISOString(),
    assets,
    scope: 'HTML index template (embedded version marker normalized), transformed main JS, local CSS, translation scripts/data, adapter, and manifest'
  };
}

export function renderFrontendHtml(source: string, version: string): string {
  const markerCount = source.split(FRONTEND_VERSION_PLACEHOLDER).length - 1;
  if (markerCount !== 1) {
    throw new Error(
      `Frontend HTML version placeholder expected once; found ${markerCount}`
    );
  }
  return source.replace(FRONTEND_VERSION_PLACEHOLDER, version);
}
