const { defineConfig } = require('cypress');

module.exports = defineConfig({
  video: false,
  screenshotOnRunFailure: false,
  e2e: {
    // Integration tests require a fixture server (localhost:8000) and PERCY_TOKEN.
    // They are excluded from the default CI run. Run them explicitly:
    //   node cypress/support/serve-fixtures.js &
    //   npx percy exec -- npx cypress run --spec 'cypress/e2e/integration/*.cy.js'
    excludeSpecPattern: ['cypress/e2e/integration/**'],
    setupNodeEvents(on, config) {
      return require('./cypress/plugins/index.js')(on, config);
    }
  },
  // Run with `yarn test:component`; not part of the coverage run.
  component: {
    devServer: {
      framework: 'react',
      bundler: 'vite',
      // Serve this checkout as @percy/cypress, pre-bundled like an installed
      // package so Vite converts its CommonJS.
      viteConfig: {
        resolve: { alias: { '@percy/cypress': __dirname } },
        optimizeDeps: { include: ['@percy/cypress'] }
      }
    },
    specPattern: 'cypress/component/**/*.cy.js',
    setupNodeEvents(on, config) {
      config.expose = config.expose || {};
      if (process.env.PERCY_SERVER_ADDRESS) config.expose.PERCY_SERVER_ADDRESS = process.env.PERCY_SERVER_ADDRESS;
      return config;
    }
  }
});
