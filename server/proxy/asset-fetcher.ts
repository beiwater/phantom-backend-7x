import fs from 'node:fs';
import path from 'node:path';
import type { ServerResponse } from 'node:http';
import { CONFIG } from '../config.ts';

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

export async function serveOrFetchAsset(urlPath: string, res: ServerResponse): Promise<boolean> {
  // Normalize path removing /static/ prefix if present
  let cleanRelPath = urlPath.replace(/^\/static\//, '').replace(/^\//, '');
  
  // Also handle query parameters if any
  const queryIndex = cleanRelPath.indexOf('?');
  if (queryIndex !== -1) {
    cleanRelPath = cleanRelPath.slice(0, queryIndex);
  }

  const localFilePath = path.join(CONFIG.STATIC_DIR, cleanRelPath);
  const ext = path.extname(cleanRelPath).toLowerCase();
  const mime = MIME_TYPES[ext] || 'application/octet-stream';

  // 1. Check local file
  if (fs.existsSync(localFilePath) && fs.statSync(localFilePath).isFile()) {
    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': 'public, max-age=86400'
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
    try {
      const resp = await fetch(upUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0' }
      });

      if (resp.ok) {
        const buffer = Buffer.from(await resp.arrayBuffer());
        
        // Save to disk
        fs.mkdirSync(path.dirname(localFilePath), { recursive: true });
        fs.writeFileSync(localFilePath, buffer);

        res.writeHead(200, {
          'Content-Type': mime,
          'Cache-Control': 'public, max-age=86400'
        });
        res.end(buffer);
        return true;
      }
    } catch {
      // Continue to next upstream candidate
    }
  }
  // 3. Fallback for image requests to prevent browser 404 broken images
  if (mime.startsWith('image/')) {
    const transparentPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400'
    });
    res.end(transparentPng);
    return true;
  }

  return false;
}
