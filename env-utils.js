// Environment utilities for Cypress — handles address resolution across
// Cypress.expose() (15.10+), Cypress.env(), and lazy cy.env() fallback.
// Extracted to a separate file because these code paths run in the Cypress
// browser context where nyc (Node-side) cannot collect coverage.

const utils = require('@percy/sdk-utils');

// Read environment values using Cypress.expose() (Cypress 15.10+) with Cypress.env() fallback.
// Tries Cypress.expose() first, then Cypress.env() (wrapped in try/catch for allowCypressEnv: false).
const getEnvValue = (key) => {
  if (typeof Cypress.expose === 'function') {
    const val = Cypress.expose(key);
    if (val !== undefined) return val;
  }
  try {
    return Cypress.env(key);
  } catch (e) {
    return undefined;
  }
};

// Lazy address resolution: if getEnvValue() at module load didn't find the address
// (e.g., CYPRESS_PERCY_SERVER_ADDRESS with allowCypressEnv: false puts it in the
// secure store, accessible only via async cy.env()), try cy.env() as last resort.
function lazyResolveAddress(log) {
  if (!utils.percy.address) {
    try {
      if (typeof cy.env === 'function') {
        cy.env(['PERCY_SERVER_ADDRESS']).then((result) => {
          if (result && result.PERCY_SERVER_ADDRESS) {
            utils.percy.address = result.PERCY_SERVER_ADDRESS;
          }
        });
      }
    } catch (e) {
      log.debug('Could not resolve Percy CLI address from environment variables', e);
    }
  }
}

module.exports = { getEnvValue, lazyResolveAddress };
