import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { POST as upload } from './api/upload.js';
import { POST as generate } from './api/generate.js';
import { GET as download } from './api/download.js';
import { GET as listWorks, POST as createWork } from './api/works.js';

const routes = { 'POST /api/upload': upload, 'POST /api/generate': generate, 'GET /api/download': download, 'GET /api/works': listWorks, 'POST /api/works': createWork };
const root = resolve('dist');
const port = Number(process.env.PORT || 4173);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const handler = routes[`${req.method} ${url.pathname}`];
    if (handler) {
      const abort = new AbortController();
      res.on('close', () => { if (!res.writableEnded) abort.abort(); });
      const request = new Request(url, { method: req.method, headers: req.headers, signal: abort.signal, ...(req.method === 'POST' ? { body: Readable.toWeb(req), duplex: 'half' } : {}) });
      const response = await handler(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.flushHeaders();
      if (response.body) Readable.fromWeb(response.body).pipe(res); else res.end();
      return;
    }
    if (url.pathname.startsWith('/api/')) { res.writeHead(405); res.end('Method not allowed'); return; }
    const file = resolve(root, `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`);
    if (!file.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  } catch (error) {
    res.writeHead(error.code === 'ENOENT' ? 404 : 500);
    res.end(error.code === 'ENOENT' ? 'Not found' : 'Server error');
    if (error.code !== 'ENOENT') console.error(error.name);
  }
});
server.requestTimeout = 300_000;
server.listen(port, '127.0.0.1', () => console.log(`Local: http://127.0.0.1:${port}`));
