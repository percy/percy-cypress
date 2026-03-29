const { defineConfig } = require('cypress');

module.exports = defineConfig({
  video: false,
  screenshotOnRunFailure: false,
  e2e: {
    // Integration tests require a fixture server (localhost:8000) and PERCY_TOKEN.
    // They are excluded from the default CI run. Run them explicitly:
    //   node serve-fixtures.js &
    //   npx percy exec -- npx cypress run --spec 'cypress/e2e/integration/*.cy.js'
    excludeSpecPattern: ['cypress/e2e/integration/**'],
    setupNodeEvents(on, config) {
      return require('./cypress/plugins/index.js')(on, config);
    }
  }
});
