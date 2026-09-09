/**
 * Serve site/dist for local review.
 *
 *   pnpm docs:serve
 *
 * A plain static file server: the built site has no server-side behaviour, and
 * previewing it through anything more would risk hiding a problem that only
 * shows up on the real host.
 */
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const PORT = Number(process.env['PORT'] ?? 4173);

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  // Normalise before joining so a request cannot escape the output directory.
  let path = join(ROOT, normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, ''));

  try {
    if (statSync(path).isDirectory()) path = join(path, 'index.html');
  } catch {
    path = path.endsWith('.html') ? path : `${path}.html`;
  }

  try {
    statSync(path);
  } catch {
    response.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    createReadStream(join(ROOT, '404.html')).pipe(response);
    return;
  }

  response.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
  createReadStream(path).pipe(response);
}).listen(PORT, () => {
  console.log(`docs on http://localhost:${PORT}`);
});
