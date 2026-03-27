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

// Check if responsive snapshot capture with page reload is needed.
// When true, the SDK sends the snapshot WITHOUT domSnapshot so Percy CLI
// navigates to the URL itself, resizes, and reloads at each width.
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

// eslint-disable-next-line no-unused-vars
async function captureResponsiveDOM(dom, options) {
  if (!utils.getResponsiveWidths) {
    throw new Error('Update Percy CLI to the latest version to use responsiveSnapshotCapture');
  }

  const widthHeights = await utils.getResponsiveWidths(options.widths || []);
  const domSnapshots = [];
  const currentWidth = window.innerWidth;
  const currentHeight = window.innerHeight;
  let lastWindowWidth = currentWidth;
  let lastWindowHeight = currentHeight;
  let resizeCount = 0;

  // Setup the resizeCount listener
  /* istanbul ignore next: no instrumenting injected code */
  window.PercyDOM.waitForResize();

  // Calculate default height — check options.minHeight first (parity with Playwright)
  let defaultHeight = currentHeight;
  if (Cypress.env('PERCY_RESPONSIVE_CAPTURE_MIN_HEIGHT')?.toString().toLowerCase() === 'true') {
    defaultHeight = options.minHeight || utils.percy?.config?.snapshot?.minHeight || currentHeight;
  }

  // Check if page should be reloaded between responsive captures
  const shouldReloadPage = Cypress.env('PERCY_RESPONSIVE_CAPTURE_RELOAD_PAGE')?.toString().toLowerCase() === 'true';

  // Read sleep time once before the loop (not per-iteration)
  const rawSleepTime = Cypress.env('PERCY_RESPONSIVE_CAPTURE_SLEEP_TIME') ||
                       Cypress.env('RESPONSIVE_CAPTURE_SLEEP_TIME');
  const sleepSeconds = rawSleepTime ? parseInt(rawSleepTime, 10) : 0;

  // Fetch PercyDOM script once upfront (parity with Playwright line 193-194)
  // Used for re-injection after page reloads and as a fallback
  const percyDOMScript = await utils.fetchPercyDOM();

  try {
    for (let { width, height } of widthHeights) {
      height = height || defaultHeight;
      if (lastWindowWidth !== width || lastWindowHeight !== height) {
        resizeCount++;
        // Resize the Cypress viewport
        Cypress.config('viewportWidth', width);
        Cypress.config('viewportHeight', height);
        // Trigger actual resize
        window.resizeTo(width, height);

        // Wait for resize to settle by polling resizeCount
        const start = Date.now();
        while (Date.now() - start < 1000) {
          /* istanbul ignore next: no instrumenting injected code */
          if (window.resizeCount >= resizeCount) break;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        lastWindowWidth = width;
        lastWindowHeight = height;
      }

      // Reload page between captures if configured (parity with Playwright/Selenium)
      if (shouldReloadPage) {
        // Reload the current page
        window.location.reload();
        // Wait for page to be ready after reload
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Re-inject PercyDOM after reload (it was lost when the page reloaded)
        // eslint-disable-next-line no-eval
        eval(percyDOMScript);

        // Re-setup resize listener and reset counter
        /* istanbul ignore next: no instrumenting injected code */
        window.PercyDOM.waitForResize();
        resizeCount = 0;
      }

      // Optional sleep between captures
      if (!isNaN(sleepSeconds) && sleepSeconds > 0) {
        await new Promise(resolve => setTimeout(resolve, sleepSeconds * 1000));
      }

      // Serialize DOM at this width
      /* istanbul ignore next: no instrumenting injected code */
      let domSnapshot = window.PercyDOM.serialize({ ...options, dom });
      domSnapshot.width = width;
      domSnapshots.push(domSnapshot);
    }
  } finally {
    // Always reset viewport to original dimensions and wait for it to settle
    resizeCount++;
    Cypress.config('viewportWidth', currentWidth);
    Cypress.config('viewportHeight', currentHeight);
    window.resizeTo(currentWidth, currentHeight);
    // Wait for restoration resize to complete (parity with Playwright)
    const start = Date.now();
    while (Date.now() - start < 1000) {
      /* istanbul ignore next: no instrumenting injected code */
      if (window.resizeCount >= resizeCount) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  return domSnapshots;
}

// Take a DOM snapshot and post it to the snapshot endpoint
Cypress.Commands.add('percySnapshot', (name, options = {}) => {
  let log = utils.logger('cypress');

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

    // Check if responsive capture with reload is needed
    const useResponsiveReload = shouldDoResponsiveReload(options);

    if (useResponsiveReload) {
      // =====================================================================
      // RESPONSIVE + RELOAD PATH
      //
      // Don't send domSnapshot — let Percy CLI handle everything:
      // 1. CLI navigates to the URL (discovery.js:286)
      // 2. CLI resizes at each width (discovery.js:332)
      // 3. CLI reloads the page at each width (discovery.js:333)
      // 4. CLI captures DOM and discovers assets
      //
      // The SDK just sends: url + name + options (including
      // responsiveSnapshotCapture: true and widths)
      // =====================================================================
      return cy.document({ log: false }).then({ timeout: CY_TIMEOUT }, async (dom) => {
        const throwConfig = Cypress.config('percyThrowErrorOnFailure');
        const _throw = throwConfig === undefined ? false : throwConfig;

        let response = await withRetry(async () => await withLog(async () => {
          return await utils.postSnapshot({
            ...options,
            environmentInfo: ENV_INFO,
            clientInfo: CLIENT_INFO,
            // NO domSnapshot — Percy CLI navigates to the URL and captures itself
            url: dom.URL,
            name
          });
        }, 'posting snapshot (CLI-handled responsive)', _throw));

        cylog(name, meta);
        return response;
      });
    }

    // --- Standard path (non-responsive or CSS-only responsive) ---
    // Serialize and capture the DOM
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

module.exports = { createRegion };
