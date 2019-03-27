const fs = require('fs');
const httpServer = require('http-server');
const port = process.env.PORT_NUMBER || 8000;
const spawn = require('child_process').spawn;
const platform = require('os').platform();

// Helper to make sure directories we need exist.
function ensureDirExists(dir) {
  if (! fs.existsSync(dir)) {
    fs.mkdirSync(dir)
  }
}

// Copy our healthcheck script to node_modules, where it will be
// when this package is installed as a dependency.
const src = 'lib/percy-healthcheck'
const copyDst = /^win/.test(platform)
      ? `${process.cwd()}\\node_modules\\@percy\\cypress\\dist\\percy-healthcheck`
      : `${__dirname}/node_modules/@percy/cypress/dist/percy-healthcheck`;
console.log(`[run-tests] Copying ${src} to ${copyDst}`);
// The 'recursive' fs.mkdirSync() option is only available in Node >10.12.0;
// create all directories ourselves to accommodate Node 8.
ensureDirExists('./node_modules/@percy/cypress')
ensureDirExists('./node_modules/@percy/cypress/dist')
fs.copyFileSync(src, copyDst);

// We need to change the command path based on the platform they're using
const cmd = /^win/.test(platform)
      ? `${process.cwd()}\\node_modules\\.bin\\cypress.cmd`
      : `cypress`;

const server = httpServer.createServer({ root: './cypress/testapp' })

server.listen(port)
console.log(`[run-tests] Server is listening on http://localhost:${port}`)

const tests = spawn(cmd, ['run'], {
  stdio: "inherit",
  windowsVerbatimArguments: true,
});

 // Propagate non-zero exit code from test process.
tests.on('exit', code => {
  if (code !== 0) {
    console.log(`[run-tests] Tests exited with code ${code}. `)
    process.exit(code)
  }
});

tests.on('close', () => {
  console.log(`[run-tests] Tests completed! Closing server http://localhost:${port}`)
  server.close()

  console.log(`[run-tests] Deleting ${copyDst}`)
  fs.unlinkSync(copyDst)
});
