import { createReadStream, statSync } from 'node:fs';
import { Server, createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.mp3': 'audio/mpeg',
};

/**
 * A read-only static server for the viewer: URL prefixes map to folders. It answers GET and HEAD
 * only, never lists folders, never leaves a mounted folder, and listens on the loopback interface
 * unless told otherwise (OBS and a browser on the same machine are all a stream needs).
 */
export function serveStatic(mounts: Record<string, string>, port: number, host = '127.0.0.1'): Promise<Server> {
  const roots = Object.entries(mounts)
    .map(([prefix, folder]) => [prefix.replace(/\/?$/, '/'), resolve(folder)] as const)
    .sort((a, b) => b[0].length - a[0].length);
  const server = createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end();
      return;
    }
    let path: string;
    try {
      path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (path.endsWith('/')) path += 'index.html';
    const mount = roots.find(([prefix]) => path.startsWith(prefix));
    const file = mount && join(mount[1], normalize(path.slice(mount[0].length)));
    if (!mount || !file || !(file === mount[1] || file.startsWith(mount[1] + sep))) {
      res.writeHead(404).end();
      return;
    }
    try {
      if (!statSync(file).isFile()) throw new Error('not a file');
    } catch {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    if (req.method === 'HEAD') res.end();
    else createReadStream(file).pipe(res);
  });
  return new Promise((done) => server.listen(port, host, () => done(server)));
}
