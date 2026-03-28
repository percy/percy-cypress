const utils = require('@percy/sdk-utils');
const { createRegion } = require('./createRegion');

// Collect client and environment information
const sdkPkg = require('./package.json');
const CLIENT_INFO = `${sdkPkg.name}/${sdkPkg.version}`;
const ENV_INFO = `cypress/${Cypress.version}`;
const CY_TIMEOUT = 30 * 1000 * 1.5;

const getPercyServerAddress = () => {
  return (typeof Cypress.expose === 'function')
    ? Cypress.expose('PERCY_SERVER_ADDRESS')
    : Cypress.env('PERCY_SERVER_ADDRESS');
};
utils.percy.address = getPercyServerAddress();

// Use Cypress's http:request backend task
utils.request.fetch = async function fetch(url, options) {
  options = { url, retryOnNetworkFailure: false, ...options };
  return Cypress.backend('http:request', options);
};

// Create Cypress log messages
function cylog(message, meta) {
  Cypress.log({
    name: 'percySnapshot',
    displayName: 'percy',
    consoleProps: () => meta,
    message
  });
}

// URLs to skip when scanning for cross-origin iframes
const SKIP_IFRAME_SRCS = [
  'about:blank',
  'about:srcdoc',
  'javascript:',
  'data:',
  'vbscript:',
  'blob:',
  'chrome:',
  'chrome-extension:'
];

// Process cross-origin iframes and attach serialized content to the snapshot
async function processCrossOriginIframes(dom, domSnapshot, options, percyDOMScript) {
  const log = utils.logger('cypress');

  try {
    const currentUrl = new URL(dom.URL);
    const iframes = dom.querySelectorAll('iframe');
    const processedFrames = [];

    for (const iframe of iframes) {
      const src = iframe.getAttribute('src');
      const srcdoc = iframe.getAttribute('srcdoc');

      // Skip non-processable iframes
      if (!src || srcdoc || SKIP_IFRAME_SRCS.some(prefix => src === prefix || src.startsWith(prefix))) {
        continue;
      }

      try {
        const frameUrl = new URL(src, currentUrl.href);

        // Only process cross-origin iframes
        if (frameUrl.origin === currentUrl.origin) continue;

        // Get the percy element ID (set by PercyDOM.serialize on the parent)
        const percyElementId = iframe.getAttribute('data-percy-element-id');
        if (!percyElementId) {
          log.debug(`Skipping cross-origin iframe ${frameUrl.href}: no data-percy-element-id`);
          continue;
        }

        log.debug(`Processing cross-origin iframe: ${frameUrl.href}`);

        // Try to access the iframe's content and serialize it
        let iframeSnapshot = null;
        try {
          const frameWindow = iframe.contentWindow;
          const frameDocument = iframe.contentDocument || frameWindow?.document;

          if (frameDocument) {
            // Same-origin accessible (e.g., sandboxed but accessible) — inject and serialize
            // eslint-disable-next-line no-eval
            frameWindow.eval(percyDOMScript);
            iframeSnapshot = frameWindow.PercyDOM.serialize({
              ...options,
              enableJavaScript: true
            });
          }
        } catch (accessError) {
          // Cross-origin security error — expected for true CORS iframes
          // The Percy CLI will handle these via its own discovery mechanism
          log.debug(`Cannot access cross-origin iframe directly (expected): ${accessError.message}`);

          // Still record the frame metadata so Percy CLI knows about it
          iframeSnapshot = null;
        }

        processedFrames.push({
          iframeData: { percyElementId },
          iframeSnapshot,
          frameUrl: frameUrl.href
        });

        log.debug(`Captured cross-origin iframe: ${frameUrl.href} (snapshot: ${!!iframeSnapshot})`);
      } catch (e) {
        log.debug(`Skipping iframe "${src}": ${e.message}`);
      }
    }

    if (processedFrames.length > 0) {
      domSnapshot.corsIframes = processedFrames;
      log.debug(`Attached ${processedFrames.length} cross-origin iframe(s) to snapshot`);
    }
  } catch (e) {
    log.debug(`Error during cross-origin iframe processing: ${e.message}`);
  }
}

// Take a DOM snapshot and post it to the snapshot endpoint
Cypress.Commands.add('percySnapshot', (name, options = {}) => {
  let log = utils.logger('cypress');

  if (typeof name === 'object') {
    options = name;
    name = undefined;
  }
  name = name || cy.state('runnable').fullTitle();

  const meta = {
    snapshot: {
      name: name,
      testCase: options.testCase
    }
  };

  const withLog = async (func, context, _throw = true) => {
    try {
      return await func();
    } catch (error) {
      log.error(`Got error while ${context}`, meta);
      log.error(error, meta);
      log.error(error.stack, meta);
      if (_throw) throw error;
      return error;
    }
  };

  const withRetry = async (func) => {
    let num = 1;
    const maxNum = 3;
    const sleepTime = 1000;
    let error;

    while (num <= maxNum) {
      try {
        return await func();
      } catch (e) {
        error = e;
        log.error(`Retrying... (${num}/${maxNum})`);
        await new Promise((res) => setTimeout(res, sleepTime));
      }
      num += 1;
    }
    throw error;
  };

  return cy.then({ timeout: CY_TIMEOUT }, async () => {
    if (Cypress.config('isInteractive') &&
        !Cypress.config('enablePercyInteractiveMode')) {
      return cylog('Disabled in interactive mode', {
        details: 'use "cypress run" instead of "cypress open"',
        name
      });
    }

    // Check if Percy is enabled
    if (!await utils.isPercyEnabled()) {
      return cylog('Not running', { name });
    }

    await withLog(async () => {
      // Inject @percy/dom
      if (!window.PercyDOM) {
        // eslint-disable-next-line no-eval
        eval(await utils.fetchPercyDOM());
      }
    }, 'injecting @percy/dom');

    return cy.document({ log: false }).then({ timeout: CY_TIMEOUT }, async (dom) => {
      const percyDOMScript = await utils.fetchPercyDOM();

      let domSnapshot = await withLog(() => {
        return window.PercyDOM.serialize({ ...options, dom });
      }, 'taking dom snapshot');

      // Process cross-origin iframes
      await withLog(async () => {
        await processCrossOriginIframes(dom, domSnapshot, options, percyDOMScript);
      }, 'processing cross-origin iframes', false);

      // Capture cookies
      return cy.getCookies({ log: false }).then(async (cookies) => {
        if (cookies && cookies.length > 0) {
          domSnapshot.cookies = cookies;
        }

        const throwConfig = Cypress.config('percyThrowErrorOnFailure');
        const _throw = throwConfig === undefined ? false : throwConfig;

        // Post the DOM snapshot to Percy
        let response = await withRetry(async () => await withLog(async () => {
          return await utils.postSnapshot({
            ...options,
            environmentInfo: ENV_INFO,
            clientInfo: CLIENT_INFO,
            domSnapshot,
            url: dom.URL,
            name
          });
        }, 'posting dom snapshot', _throw));

        cylog(name, meta);
        return response;
      });
    });
  });
});

/**
 * Capture responsive Percy snapshots with page reload at each viewport width.
 * For JS-driven pages where layout changes on window.onload (not CSS media queries).
 * Sends ONE snapshot with a domSnapshot array — same as Selenium/Playwright SDKs.
 *
 * Uses cy.task() to store DOM snapshots in the Node.js background process,
 * which is immune to page navigations that destroy browser window state.
 *
 * @example
 * const { percyResponsiveSnapshot } = require('@percy/cypress');
 *
 * it('responsive test', () => {
 *   cy.visit('/my-page');
 *   percyResponsiveSnapshot('My Page', {
 *     url: '/my-page',
 *     widths: [1280, 768, 375],
 *   });
 * });
 *
 * @param {string} name - Snapshot name
 * @param {object} options - Must include url and widths
 */
function percyResponsiveSnapshot(name, options = {}) {
  if (!options.url) {
    throw new Error('percyResponsiveSnapshot requires options.url');
  }

  const url = options.url;
  const widths = options.widths || [];
  const originalWidth = Cypress.config('viewportWidth');
  const originalHeight = Cypress.config('viewportHeight');

  // Env var: PERCY_RESPONSIVE_CAPTURE_MIN_HEIGHT — use minHeight for viewport
  const useMinHeight = Cypress.env('PERCY_RESPONSIVE_CAPTURE_MIN_HEIGHT')?.toString().toLowerCase() === 'true';
  const defaultHeight = useMinHeight
    ? (options.minHeight || utils.percy?.config?.snapshot?.minHeight || originalHeight)
    : originalHeight;

  // Env var: sleep between responsive captures (parity with Selenium/Playwright)
  const rawSleepTime = Cypress.env('PERCY_RESPONSIVE_CAPTURE_SLEEP_TIME') ||
                       Cypress.env('RESPONSIVE_CAPTURE_SLEEP_TIME');
  const sleepMs = rawSleepTime ? parseInt(rawSleepTime, 10) * 1000 : 0;

  let percyDOMScript = null;

  // Step 1: Check Percy + fetch DOM script + clear any previous state
  cy.then({ timeout: CY_TIMEOUT }, async () => {
    if (!await utils.isPercyEnabled()) return;
    percyDOMScript = await utils.fetchPercyDOM();
  });
  cy.task('percy:clearSnapshots', null, { log: false });

  // Step 2: For each width — viewport → visit → (optional sleep) → serialize → store
  for (const width of widths) {
    const w = width;

    cy.viewport(w, defaultHeight);
    cy.visit(url);

    // Env var: sleep between captures
    if (sleepMs > 0) {
      cy.wait(sleepMs, { log: false });
    }

    // Serialize DOM then send to Node.js via cy.task
    cy.document().then((doc) => {
      if (!percyDOMScript) return;
      // eslint-disable-next-line no-eval
      eval(percyDOMScript);
      const dom = window.PercyDOM.serialize({ ...options, dom: doc });
      cy.task('percy:storeSnapshot', { width: w, dom }, { log: false });
    });
  }

  // Step 3: Restore viewport
  cy.viewport(originalWidth, originalHeight);

  // Step 4: Retrieve all snapshots from Node.js and post ONE snapshot
  cy.task('percy:getSnapshots', null, { log: false }).then((snapshots) => {
    if (!snapshots || snapshots.length === 0) return;

    cy.document().then({ timeout: CY_TIMEOUT }, async (doc) => {
      try {
        await utils.postSnapshot({
          ...options,
          environmentInfo: ENV_INFO,
          clientInfo: CLIENT_INFO,
          domSnapshot: snapshots,
          url: doc.URL,
          name
        });

        Cypress.log({
          name: 'percySnapshot',
          displayName: 'percy',
          message: `${name} (${snapshots.length} widths)`
        });
      } catch (err) {
        utils.logger('cypress').error(`Failed to post responsive snapshot "${name}"`, err);
      }
    });
  });
}

module.exports = { createRegion, percyResponsiveSnapshot };
