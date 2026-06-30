// Environment utilities for Cypress — handles address resolution across
// Cypress.expose() (15.10+), Cypress.env(), and lazy cy.env() fallback.
// Extracted to a separate file because these code paths run in the Cypress
// browser context where nyc (Node-side) cannot collect coverage.

const utils = require('@percy/sdk-utils');

// The Percy CLI server always runs locally, so its address must resolve to a
// loopback host. Validating this prevents an attacker-controlled
// PERCY_SERVER_ADDRESS (or a rogue co-located process advertising a remote
// address) from redirecting snapshot payloads — which can carry cookies and
// serialized DOM — to an external host (CWE-284 / SSRF).
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

const isLoopbackAddress = (address) => {
  try {
    return LOOPBACK_HOSTS.has(new URL(address).hostname.toLowerCase());
  } catch (e) {
    return false;
  }
};

// Return the address only if it points at loopback; otherwise warn (when a
// logger is available) and return undefined so callers fall back to the
// default http://localhost:5338.
const sanitizeAddress = (address, log) => {
  if (!address) return undefined;
  if (isLoopbackAddress(address)) return address;
  if (log) log.warn(`Ignoring non-loopback PERCY_SERVER_ADDRESS "${address}"; the Percy CLI must run on localhost.`);
  return undefined;
};

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
      const addr = sanitizeAddress(Cypress.env('PERCY_SERVER_ADDRESS'), log);
      if (addr) utils.percy.address = addr;
    } catch (e) {
      log.debug('Could not resolve Percy CLI address from environment variables', e);
    }
  }
}

module.exports = { getEnvValue, lazyResolveAddress, sanitizeAddress, isLoopbackAddress };
