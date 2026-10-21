// Environment utilities for Cypress — handles address resolution across
// Cypress.expose() (15.10+), Cypress.env() (<= 15), and the async cy.env()
// secure store (15.10+, the only way to read CYPRESS_* / --env values on 16+).
// Extracted to a separate file because these code paths run in the Cypress
// browser context where nyc (Node-side) cannot collect coverage.

const utils = require('@percy/sdk-utils');

const PERCY_ENV_KEYS = [
  'PERCY_SERVER_ADDRESS',
  'PERCY_RESPONSIVE_CAPTURE_RELOAD_PAGE',
  'PERCY_RESPONSIVE_CAPTURE_MIN_HEIGHT',
  'PERCY_RESPONSIVE_CAPTURE_SLEEP_TIME',
  'RESPONSIVE_CAPTURE_SLEEP_TIME'
];

// Values read through cy.env() by the most recent lazyResolveAddress() call.
let secureEnv = {};

// Lookup order: Cypress.expose() (15.10+), values fetched via cy.env(), then the
// synchronous Cypress.env(), which throws on 16+ and with allowCypressEnv: false.
const getEnvValue = (key) => {
  if (typeof Cypress.expose === 'function') {
    const val = Cypress.expose(key);
    if (val !== undefined) return val;
  }
  if (secureEnv[key] !== undefined) return secureEnv[key];
  try {
    return Cypress.env(key);
  } catch (e) {
    return undefined;
  }
};

// Must be called from inside a custom command so cy.env() can be enqueued.
// utils.percy.address is never falsy (sdk-utils defaults it to :5338), so we
// can't use it to tell whether an address was configured.
function lazyResolveAddress(log) {
  secureEnv = {};
  const addr = getEnvValue('PERCY_SERVER_ADDRESS');
  if (addr) {
    utils.percy.address = addr;
    return;
  }
  if (typeof cy.env !== 'function') return;

  try {
    cy.env(PERCY_ENV_KEYS, { log: false }).then(values => {
      secureEnv = values || {};
      if (secureEnv.PERCY_SERVER_ADDRESS) utils.percy.address = secureEnv.PERCY_SERVER_ADDRESS;
    });
  } catch (e) {
    log.debug('Could not resolve Percy CLI address from environment variables', e);
  }
}

module.exports = { getEnvValue, lazyResolveAddress, PERCY_ENV_KEYS };
