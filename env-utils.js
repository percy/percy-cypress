// Environment utilities for Cypress — handles address resolution across
// Cypress.expose() (15.10+), Cypress.env() (<= 15), the async cy.env()
// secure store (15.10+, the only way to read CYPRESS_* / --env values on 16+),
// and the CLI's own PERCY_SERVER_ADDRESS read through cy.exec() (<= 15).
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

// No quotes, pipes or `$` so it runs unchanged in sh, cmd.exe and PowerShell.
// Prints "undefined" when the variable is unset.
const EXEC_ADDRESS_CMD = 'node -p process.env.PERCY_SERVER_ADDRESS';
let defaultAddress = 'http://localhost:5338';
// Cypress spawns the user's shell, so a heavy shell profile makes the first
// call take several seconds; a timeout would fail the user's test.
const EXEC_TIMEOUT = 30 * 1000;

// Values read through cy.env() by the most recent lazyResolveAddress() call.
let secureEnv = {};
// PERCY_SERVER_ADDRESS from the Cypress server process; undefined until looked
// up, then cached for the rest of the spec (the module is re-evaluated per spec).
let execAddress;

const isSet = (val) => val !== undefined && val !== null && val !== '';

const getExposedValue = (key) => {
  if (typeof Cypress.expose !== 'function') return undefined;
  const val = Cypress.expose(key);
  return isSet(val) ? val : undefined;
};

// Lookup order: Cypress.expose() (15.10+), values fetched via cy.env(), then the
// synchronous Cypress.env(), which throws on 16+ and with allowCypressEnv: false.
const getEnvValue = (key) => {
  const exposed = getExposedValue(key);
  if (exposed !== undefined) return exposed;
  if (isSet(secureEnv[key])) return secureEnv[key];
  try {
    const val = Cypress.env(key);
    return isSet(val) ? val : undefined;
  } catch (e) {
    return undefined;
  }
};

// cy.exec() was removed in Cypress 16 (it still exists there, but throws), and
// is not available inside a cy.origin() spec bridge.
function canExec() {
  return typeof cy.exec === 'function' &&
    parseInt(Cypress.version, 10) < 16 &&
    !Cypress.isCrossOriginSpecBridge &&
    !(Cypress.config('isInteractive') && !Cypress.config('enablePercyInteractiveMode'));
}

async function defaultAddressResponds() {
  try {
    await utils.request(`${defaultAddress}/percy/healthcheck`);
    return true;
  } catch (e) {
    return false;
  }
}

function parseExecAddress(result) {
  // `code` was renamed to `exitCode` in Cypress 13
  const exitCode = result?.exitCode ?? result?.code;
  const out = String(result?.stdout || '').trim();
  return exitCode === 0 && out !== 'undefined' ? out : '';
}

function applyAddress(log) {
  const addr = getEnvValue('PERCY_SERVER_ADDRESS');
  if (addr) {
    utils.percy.address = addr;
    return;
  }
  if (execAddress !== undefined) {
    if (execAddress) utils.percy.address = execAddress;
    return;
  }
  if (!canExec()) return;

  // Only spawn a shell when the CLI isn't on its default port.
  let defaultResponds = false;
  cy.then(async () => { defaultResponds = await defaultAddressResponds(); });
  cy.then(() => {
    if (defaultResponds) {
      execAddress = defaultAddress;
      utils.percy.address = defaultAddress;
      return;
    }
    try {
      // failOnNonZeroExit: false keeps a missing `node` binary from failing the test.
      cy.exec(EXEC_ADDRESS_CMD, { log: false, failOnNonZeroExit: false, timeout: EXEC_TIMEOUT })
        .then(result => {
          execAddress = parseExecAddress(result);
          if (execAddress) utils.percy.address = execAddress;
        });
    } catch (e) {
      execAddress = '';
      log.debug('Could not read PERCY_SERVER_ADDRESS from the Cypress process', e);
    }
  });
}

// Must be called from inside a custom command so cy.env() / cy.exec() can be
// enqueued; they run before the command's own healthcheck. utils.percy.address
// is never falsy (sdk-utils defaults it to :5338), so we can't use it to tell
// whether an address was configured.
function lazyResolveAddress(log) {
  secureEnv = {};
  // Exposed keys win, so only ask cy.env() for the rest. Asking even when the
  // address is exposed keeps --env / CYPRESS_* responsive-capture values working.
  const missing = PERCY_ENV_KEYS.filter(key => getExposedValue(key) === undefined);

  if (!missing.length || typeof cy.env !== 'function') {
    applyAddress(log);
    return;
  }

  try {
    // cy.env() yields undefined for unset keys; it only fails on a broken
    // privileged channel (non-spec invocation, server error or timeout), in
    // which case Cypress itself is unusable.
    cy.env(missing, { log: false }).then(values => {
      secureEnv = values || {};
      applyAddress(log);
    });
  } catch (e) {
    log.debug('Could not resolve Percy CLI address from environment variables', e);
    applyAddress(log);
  }
}

/* istanbul ignore next: test-only escape hatch */
function resetEnvCache({ defaultAddress: probeAddress = 'http://localhost:5338' } = {}) {
  secureEnv = {};
  execAddress = undefined;
  defaultAddress = probeAddress;
}

module.exports = { getEnvValue, lazyResolveAddress, resetEnvCache, PERCY_ENV_KEYS, EXEC_ADDRESS_CMD };
