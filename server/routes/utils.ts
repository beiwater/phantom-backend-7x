import type { IncomingMessage, ServerResponse } from 'node:http';

export function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  let data = '';
  req.on('data', chunk => { data += chunk; });
  req.on('end', () => {
    try {
      resolve(data ? JSON.parse(data) : ({} as T));
    } catch (err) {
      reject(err);
    }
  });
  req.on('error', reject);
  return promise;
}

export function sendJson(
  res: ServerResponse,
  data: unknown,
  status: number = 200,
  extraHeaders: Record<string, string | string[]> = {}
) {
  for (const [key, value] of Object.entries(extraHeaders)) {
    if (key.toLowerCase() === 'set-cookie') {
      res.setHeader('Set-Cookie', value);
    } else {
      res.setHeader(key, value);
    }
  }
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'x-timestamp': String(Date.now()),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS'
  });
  res.end(JSON.stringify(data));
}
