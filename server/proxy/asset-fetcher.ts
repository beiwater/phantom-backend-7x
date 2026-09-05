import fs from 'node:fs';
import path from 'node:path';
import type { ServerResponse } from 'node:http';
import { CONFIG } from '../config.ts';
import { RealmPhaseService } from '../services/realm-phase-service.ts';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg'
};

const FRONTEND_MAIN_BUNDLE_PATH = 'bundle/assets/index-cgzgptQ8.js';
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

async function prepareFrontendAsset(cleanRelPath: string, source: string): Promise<string> {
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

  const dynamicPx = RealmPhaseService.generateFrontendPxScript();
  prepared = prepared.replace(FRONTEND_PX_PATTERN, () => dynamicPx);
  return prepared;
}

export async function serveOrFetchAsset(urlPath: string, res: ServerResponse): Promise<boolean> {
  // Normalize path removing /static/ prefix if present.
  let cleanRelPath = urlPath.replace(/^\/static\//, '').replace(/^\//, '');

  const queryIndex = cleanRelPath.indexOf('?');
  if (queryIndex !== -1) {
    cleanRelPath = cleanRelPath.slice(0, queryIndex);
  }

  const staticRoot = path.resolve(CONFIG.STATIC_DIR);
  const localFilePath = path.resolve(staticRoot, cleanRelPath);
  if (localFilePath !== staticRoot && !localFilePath.startsWith(`${staticRoot}${path.sep}`)) {
    return false;
  }
  const ext = path.extname(cleanRelPath).toLowerCase();
  const mime = MIME_TYPES[ext] || 'application/octet-stream';
  const isMutableFrontendResource = ext === '.html' || ext === '.css' || ext === '.js' || ext === '.json';
  const cacheControl = isMutableFrontendResource ? 'no-store' : 'public, max-age=86400';
  const shouldPrepareFrontendAsset = Boolean(FRONTEND_SYNTAX_REPAIRS[cleanRelPath]);

  // 1. Check local file
  if (fs.existsSync(localFilePath) && fs.statSync(localFilePath).isFile()) {
    if (shouldPrepareFrontendAsset) {
      const source = fs.readFileSync(localFilePath, 'utf-8');
      const prepared = await prepareFrontendAsset(cleanRelPath, source);
      res.writeHead(200, {
        'Content-Type': mime,
        'Cache-Control': cacheControl
      });
      res.end(prepared);
      return true;
    }
    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': cacheControl
    });
    fs.createReadStream(localFilePath).pipe(res);
    return true;
  }

  // 2. Fetch from upstream and cache locally
  const upstreamUrls = [
    `${CONFIG.UPSTREAM_BASE}/static/${cleanRelPath}`,
    `${CONFIG.UPSTREAM_CDN}/${cleanRelPath}`,
    `${CONFIG.UPSTREAM_BASE}/${cleanRelPath}`
  ];

  for (const upUrl of upstreamUrls) {
    let buffer: Buffer;
    try {
      const resp = await fetch(upUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0' }
      });

      if (!resp.ok) {
        continue;
      }
      buffer = Buffer.from(await resp.arrayBuffer());
    } catch {
      // Continue to next upstream candidate when the request itself fails.
      continue;
    }

    // Prepare before caching or sending so upstream misses and local hits
    // deliver the same supported bundle, while the cache retains raw bytes.
    const body = shouldPrepareFrontendAsset
      ? await prepareFrontendAsset(cleanRelPath, buffer.toString('utf8'))
      : buffer;

    fs.mkdirSync(path.dirname(localFilePath), { recursive: true });
    fs.writeFileSync(localFilePath, buffer);

    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': cacheControl
    });
    res.end(body);
    return true;
  }

  return false;
}
