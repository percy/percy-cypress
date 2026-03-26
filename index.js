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

// Check if responsive DOM capture should be used
function isResponsiveDOMCaptureValid(options) {
  if (utils.percy?.config?.percy?.deferUploads) {
    return false;
  }
  return (
    options?.responsive_snapshot_capture ||
    options?.responsiveSnapshotCapture ||
    utils.percy?.config?.snapshot?.responsiveSnapshotCapture ||
    false
  );
}

/**
 * Capture responsive DOM snapshots using Cypress's native viewport/reload commands.
 *
 * Unlike Selenium (driver.setRect) or Playwright (page.setViewportSize), Cypress
 * controls the viewport through its test runner — cy.viewport() is the ONLY way
 * to actually resize the browser. window.resizeTo() is a no-op in modern browsers.
 *
 * This function returns a Cypress chainable that collects snapshots at each width.
 */
function captureResponsiveDOMWithCypress(options) {
  if (!utils.getResponsiveWidths) {
    throw new Error('Update Percy CLI to the latest version to use responsiveSnapshotCapture');
  }

  const shouldReloadPage = Cypress.env('PERCY_RESPONSIVE_CAPTURE_RELOAD_PAGE')?.toString().toLowerCase() === 'true';
  const rawSleepTime = Cypress.env('PERCY_RESPONSIVE_CAPTURE_SLEEP_TIME') ||
                       Cypress.env('RESPONSIVE_CAPTURE_SLEEP_TIME');
  const sleepSeconds = rawSleepTime ? parseInt(rawSleepTime, 10) : 0;

  const domSnapshots = [];

  // Use cy.then to get into the Cypress command chain, then iterate widths
  return cy.then({ timeout: CY_TIMEOUT }, async () => {
    return await utils.getResponsiveWidths(options.widths || []);
  }).then((widthHeights) => {
    // Calculate default height
    let defaultHeight = Cypress.config('viewportHeight');
    if (Cypress.env('PERCY_RESPONSIVE_CAPTURE_MIN_HEIGHT')?.toString().toLowerCase() === 'true') {
      defaultHeight = options.minHeight || utils.percy?.config?.snapshot?.minHeight || defaultHeight;
    }

    // Save original viewport for restoration
    const originalWidth = Cypress.config('viewportWidth');
    const originalHeight = Cypress.config('viewportHeight');

    // Chain: for each width, resize → (optionally reload via visit) → inject PercyDOM → serialize
    let chain = cy.wrap(null, { log: false });

    for (const { width, height: configHeight } of widthHeights) {
      const targetHeight = configHeight || defaultHeight;

      // Step 1: Set viewport FIRST (before any page load)
      chain = chain.then(() => {
        return cy.viewport(width, targetHeight, { log: false });
      });

      // Step 2: Reload page if configured
      // Use cy.url() → cy.visit() instead of cy.reload() to guarantee
      // the page loads fresh at the current viewport width.
      // The page's window.onload sees the correct window.innerWidth.
      if (shouldReloadPage) {
        chain = chain.then(() => {
          return cy.url({ log: false }).then((currentUrl) => {
            return cy.visit(currentUrl, { log: false });
          });
        });
      }

      // Step 3: Optional sleep after resize/reload
      if (!isNaN(sleepSeconds) && sleepSeconds > 0) {
        chain = chain.then(() => cy.wait(sleepSeconds * 1000, { log: false }));
      }

      // Step 4: Inject PercyDOM and serialize at this width
      chain = chain.then({ timeout: CY_TIMEOUT }, async () => {
        // Always re-inject PercyDOM (lost on reload, or may need fresh state after resize)
        // eslint-disable-next-line no-eval
        eval(await utils.fetchPercyDOM());
      }).then(() => {
        return cy.document({ log: false }).then((doc) => {
          /* istanbul ignore next: no instrumenting injected code */
          const domSnapshot = window.PercyDOM.serialize({ ...options, dom: doc });
          domSnapshot.width = width;
          domSnapshots.push(domSnapshot);
        });
      });
    }

    // Restore original viewport
    chain = chain.then(() => {
      return cy.viewport(originalWidth, originalHeight, { log: false });
    });

    return chain;
  }).then(() => {
    return domSnapshots;
  });
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

    // Check if responsive capture is requested
    const useResponsive = isResponsiveDOMCaptureValid(options);

    if (useResponsive) {
      // --- Responsive path: uses cy.viewport() + cy.reload() (Cypress commands) ---
      return captureResponsiveDOMWithCypress(options).then((domSnapshots) => {
        return cy.document({ log: false }).then(async (dom) => {
          // Process cross-origin iframes for each width snapshot
          const percyDOMScript = await utils.fetchPercyDOM();
          for (const snap of domSnapshots) {
            await processCrossOriginIframes(dom, snap, options, percyDOMScript);
          }

          // Attach cookies to each snapshot
          return cy.getCookies({ log: false }).then(async (cookies) => {
            if (cookies && cookies.length > 0) {
              domSnapshots.forEach(snap => { snap.cookies = cookies; });
            }

            const throwConfig = Cypress.config('percyThrowErrorOnFailure');
            const _throw = throwConfig === undefined ? false : throwConfig;

            let response = await withRetry(async () => await withLog(async () => {
              return await utils.postSnapshot({
                ...options,
                environmentInfo: ENV_INFO,
                clientInfo: CLIENT_INFO,
                domSnapshot: domSnapshots,
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

    // --- Standard (non-responsive) path ---
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
});

module.exports = { createRegion };
