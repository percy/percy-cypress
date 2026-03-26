/**
 * Simple HTTP server for serving HTML test fixtures.
 * Start before running Percy snapshot tests:
 *   node serve-fixtures.js &
 *   PERCY_TOKEN=xxx npx percy exec -- npx cypress run --spec cypress/e2e/percy-snapshot.cy.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8000;
const FIXTURES_DIR = path.join(__dirname, 'cypress', 'fixtures', 'html');

const server = http.createServer((req, res) => {
  const filePath = path.join(FIXTURES_DIR, req.url === '/' ? 'standard-snapshot.html' : req.url);

  if (!filePath.startsWith(FIXTURES_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
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
