/**
 * Simple HTTP server for serving HTML test fixtures.
 * Start before running Percy snapshot tests:
 *   node cypress/support/serve-fixtures.js &
 *   PERCY_TOKEN=xxx npx percy exec -- npx cypress run --spec cypress/e2e/percy-snapshot.cy.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8000;
const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures', 'html');

const server = http.createServer((req, res) => {
  // Strip query params before resolving file path
  const urlPath = new URL(req.url, `http://localhost:${PORT}`).pathname;
  const safePath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  const requestedPath = safePath === '/' ? '/standard-snapshot.html' : safePath;
  const resolvedPath = path.resolve(FIXTURES_DIR, '.' + requestedPath);

  if (!resolvedPath.startsWith(FIXTURES_DIR + path.sep)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(resolvedPath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Fixture server running at http://localhost:${PORT}`);
  console.log(`Serving files from: ${FIXTURES_DIR}`);
});
