const fs = require('fs');
const httpServer = require('http-server');
const port = process.env.PORT_NUMBER || 8000;
const spawn = require('child_process').spawn;
const platform = require('os').platform();

// Copy our healthcheck binary to the 'node_modules/.bin' directory where it will be
// when this package is installed as a dependency.
const src = 'percy-healthcheck'
const copyDst = /^win/.test(platform)
      ? `${process.cwd()}\\node_modules\\.bin\\percy-healthcheck`
      : `${__dirname}/node_modules/.bin/percy-healthcheck`;
console.log(`[run-tests] Copying ${src} to ${copyDst}`);
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
