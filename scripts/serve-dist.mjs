// Local acceptance-test server only. Production is hosted by Netlify.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve('dist');
const config = await fs.readFile('netlify.toml', 'utf8');
const headers = Object.fromEntries(
  [
    ...config.matchAll(
      /^\s+(Content-Security-Policy|X-Content-Type-Options|Referrer-Policy|Permissions-Policy|X-Frame-Options|Strict-Transport-Security) = "([^"]*)"/gm,
    ),
  ].map((match) => [match[1], match[2]]),
);
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.tex': 'application/x-tex',
};
http
  .createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1:5173');
      const candidate = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
      if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
        response.writeHead(403);
        response.end();
        return;
      }
      let filename = candidate;
      try {
        if (!(await fs.stat(filename)).isFile()) filename = path.join(root, 'index.html');
      } catch {
        if (path.extname(url.pathname)) {
          response.writeHead(404);
          response.end();
          return;
        }
        filename = path.join(root, 'index.html');
      }
      const bytes = await fs.readFile(filename);
      response.writeHead(200, {
        ...headers,
        'Content-Type': types[path.extname(filename)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      response.end(bytes);
    } catch {
      response.writeHead(500);
      response.end('Local preview failed. Rebuild dist and retry.');
    }
  })
  .listen(5173, '127.0.0.1', () =>
    console.log('Built app + Netlify security headers: http://127.0.0.1:5173'),
  );
