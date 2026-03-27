const utils = require('@percy/sdk-utils');
const { createRegion } = require('./createRegion');

// Collect client and environment information
const sdkPkg = require('./package.json');
const CLIENT_INFO = `${sdkPkg.name}/${sdkPkg.version}`;
const ENV_INFO = `cypress/${Cypress.version}`;
// asset discovery should timeout before this
// 1.5 times the 30 second nav timeout
const CY_TIMEOUT = 30 * 1000 * 1.5;

// Maybe set the CLI API address from the environment
// Support both new and legacy methods for backward compatibility

const getPercyServerAddress = () => {
  return (typeof Cypress.expose === 'function')
    ? Cypress.expose('PERCY_SERVER_ADDRESS')
    : /* istanbul ignore next */ Cypress.env('PERCY_SERVER_ADDRESS');
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

      if (!src || srcdoc || SKIP_IFRAME_SRCS.some(prefix => src === prefix || src.startsWith(prefix))) {
        continue;
      }

      try {
        const frameUrl = new URL(src, currentUrl.href);
        if (frameUrl.origin === currentUrl.origin) continue;

        const percyElementId = iframe.getAttribute('data-percy-element-id');
        if (!percyElementId) {
          log.debug(`Skipping cross-origin iframe ${frameUrl.href}: no data-percy-element-id`);
          continue;
        }

        log.debug(`Processing cross-origin iframe: ${frameUrl.href}`);

        let iframeSnapshot = null;
        try {
          const frameWindow = iframe.contentWindow;
          const frameDocument = iframe.contentDocument || frameWindow?.document;

          if (frameDocument) {
            // eslint-disable-next-line no-eval
            frameWindow.eval(percyDOMScript);
            iframeSnapshot = frameWindow.PercyDOM.serialize({
              ...options,
              enableJavaScript: true
            });
          }
        } catch (accessError) {
          log.debug(`Cannot access cross-origin iframe directly (expected): ${accessError.message}`);
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

// Check if responsive snapshot capture with reload is requested
function shouldDoResponsiveReload(options) {
  const hasResponsiveFlag = (
    options?.responsive_snapshot_capture ||
    options?.responsiveSnapshotCapture ||
    utils.percy?.config?.snapshot?.responsiveSnapshotCapture ||
    false
  );
  const hasReloadFlag = Cypress.env('PERCY_RESPONSIVE_CAPTURE_RELOAD_PAGE')?.toString().toLowerCase() === 'true';
  return hasResponsiveFlag && hasReloadFlag;
}

/**
 * Take a single DOM snapshot at the CURRENT viewport size and post it to Percy.
 * This is the core snapshot logic — no viewport changes, no reload.
 * Used by both the standard path and the responsive-reload loop.
 *
 * Returns a Cypress chainable.
 */
function takeSingleSnapshot(name, options, meta) {
  const log = utils.logger('cypress');

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

  // Inject PercyDOM if needed, then serialize, then post
  return cy.then({ timeout: CY_TIMEOUT }, async () => {
    if (!window.PercyDOM) {
      // eslint-disable-next-line no-eval
      eval(await utils.fetchPercyDOM());
    }
  }).then(() => {
    return cy.document({ log: false }).then({ timeout: CY_TIMEOUT }, async (dom) => {
      const percyDOMScript = await utils.fetchPercyDOM();

      /* istanbul ignore next: no instrumenting injected code */
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
}

// Take a DOM snapshot and post it to the snapshot endpoint
Cypress.Commands.add('percySnapshot', (name, options = {}) => {
  // if name is not passed
  if (typeof name === 'object') {
    options = name;
    name = undefined;
  }
  // Default name to test title
  name = name || cy.state('runnable').fullTitle();

  const meta = {
    snapshot: {
      name: name,
      testCase: options.testCase
    }
  };

  // Phase 1: Check preconditions
  return cy.then({ timeout: CY_TIMEOUT }, async () => {
    if (Cypress.config('isInteractive') &&
        !Cypress.config('enablePercyInteractiveMode')) {
      return cylog('Disabled in interactive mode', {
        details: 'use "cypress run" instead of "cypress open"',
        name
      });
    }

    if (!await utils.isPercyEnabled()) {
      return cylog('Not running', { name });
    }

    // Signal that preconditions passed
    window.__percyReady = true;
  }).then(() => {
    if (!window.__percyReady) return;
    window.__percyReady = false;

    // Phase 2: Check if responsive-reload capture is needed
    // When responsiveSnapshotCapture + PERCY_RESPONSIVE_CAPTURE_RELOAD_PAGE are both true,
    // we need to take a SEPARATE snapshot at each width with a page reload between them.
    // This is because JS-driven responsive pages (like window.onload layouts) need
    // the page to actually reload at each viewport size.
    //
    // We handle this with PURE Cypress command chaining — no async/await mixing:
    //   cy.viewport(w) → cy.visit(url) → takeSingleSnapshot() → repeat for next width
    //
    // For CSS-only responsive pages (no reload needed), responsiveSnapshotCapture
    // is just passed through to Percy CLI which handles multi-width rendering itself.

    if (shouldDoResponsiveReload(options)) {
      // --- Responsive + Reload path ---
      // Takes separate snapshots per width using Cypress commands.
      const widths = options.widths || [Cypress.config('viewportWidth')];
      const originalWidth = Cypress.config('viewportWidth');
      const originalHeight = Cypress.config('viewportHeight');

      const rawSleepTime = Cypress.env('PERCY_RESPONSIVE_CAPTURE_SLEEP_TIME') ||
                           Cypress.env('RESPONSIVE_CAPTURE_SLEEP_TIME');
      const sleepSeconds = rawSleepTime ? parseInt(rawSleepTime, 10) : 0;

      let chain = cy.wrap(null, { log: false });

      for (const width of widths) {
        const w = width; // capture for closure

        // Step 1: Resize viewport
        chain = chain.then(() => cy.viewport(w, originalHeight, { log: false }));

        // Step 2: Reload page at new viewport width
        chain = chain.then(() => {
          return cy.url({ log: false }).then((currentUrl) => {
            const url = new URL(currentUrl);
            url.searchParams.set('_percy_w', `${w}`);
            return cy.visit(url.toString(), { log: false });
          });
        });

        // Step 3: Optional sleep
        if (!isNaN(sleepSeconds) && sleepSeconds > 0) {
          chain = chain.then(() => cy.wait(sleepSeconds * 1000, { log: false }));
        }

        // Step 4: Take a single snapshot at this width
        // Pass widths: [w] so Percy renders at exactly this width
        chain = chain.then(() => {
          return takeSingleSnapshot(name, { ...options, widths: [w] }, meta);
        });
      }

      // Restore original viewport
      chain = chain.then(() => cy.viewport(originalWidth, originalHeight, { log: false }));

      return chain;
    }

    // --- Standard path (including CSS-only responsive) ---
    // For responsiveSnapshotCapture without reload, just pass the flag through.
    // Percy CLI handles multi-width rendering via CSS during asset discovery.
    return takeSingleSnapshot(name, options, meta);
  });
});

module.exports = { createRegion };
