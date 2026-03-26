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

// Reload the page and wait for it to be ready.
// Uses a marker element to detect when the NEW page has fully loaded.
async function reloadAndWait(percyDOMScript, timeout = 5000) {
  const log = utils.logger('cypress');

  // Save the current URL for navigation
  const currentURL = window.location.href;

  // Set a marker to detect the reload completed
  window.__percy_pre_reload = true;

  // Navigate to the same URL (triggers full page reload)
  window.location.href = currentURL;

  // Poll until the page has reloaded (marker is gone = new page)
  const start = Date.now();
  while (Date.now() - start < timeout) {
    await new Promise(resolve => setTimeout(resolve, 100));
    // After reload, the marker will be undefined on the new page
    if (!window.__percy_pre_reload) {
      // Page has reloaded — wait a bit more for DOM to settle
      await new Promise(resolve => setTimeout(resolve, 500));

      // Re-inject PercyDOM on the new page
      try {
        // eslint-disable-next-line no-eval
        eval(percyDOMScript);
        log.debug('PercyDOM re-injected after page reload');
      } catch (e) {
        log.error(`Failed to re-inject PercyDOM after reload: ${e.message}`);
      }
      return true;
    }
  }

  // If we got here, the page didn't reload within timeout
  // This can happen in Cypress's sandboxed environment
  log.debug('Page reload did not complete within timeout — continuing without reload');
  return false;
}

// Capture responsive DOM snapshots across different widths
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
        const reloaded = await reloadAndWait(percyDOMScript);
        if (reloaded) {
          // Re-setup resize listener and reset counter on the new page
          /* istanbul ignore next: no instrumenting injected code */
          window.PercyDOM.waitForResize();
          resizeCount = 0;
        }
      }

      // Optional sleep between captures
      if (!isNaN(sleepSeconds) && sleepSeconds > 0) {
        await new Promise(resolve => setTimeout(resolve, sleepSeconds * 1000));
      }

      // Serialize DOM at this width
      // Use window.document (not the original dom param) because the page may have reloaded
      /* istanbul ignore next: no instrumenting injected code */
      const currentDoc = shouldReloadPage ? window.document : dom;
      let domSnapshot = window.PercyDOM.serialize({ ...options, dom: currentDoc });
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

    // Serialize and capture the DOM
    return cy.document({ log: false }).then({ timeout: CY_TIMEOUT }, async (dom) => {
      // Check if responsive capture is requested
      const useResponsive = isResponsiveDOMCaptureValid(options);

      // Fetch PercyDOM script for cross-origin iframe injection
      const percyDOMScript = await utils.fetchPercyDOM();

      /* istanbul ignore next: no instrumenting injected code */
      let domSnapshot = await withLog(() => {
        if (useResponsive) {
          return captureResponsiveDOM(dom, options);
        }
        return window.PercyDOM.serialize({ ...options, dom });
      }, 'taking dom snapshot');

      // Process cross-origin iframes (parity with Selenium/Playwright)
      await withLog(async () => {
        if (Array.isArray(domSnapshot)) {
          // Responsive mode — process iframes for each width snapshot
          for (const snap of domSnapshot) {
            await processCrossOriginIframes(dom, snap, options, percyDOMScript);
          }
        } else {
          await processCrossOriginIframes(dom, domSnapshot, options, percyDOMScript);
        }
      }, 'processing cross-origin iframes', false);

      // Capture cookies (for non-responsive, or attach to each responsive snapshot)
      return cy.getCookies({ log: false }).then(async (cookies) => {
        if (cookies && cookies.length > 0) {
          if (Array.isArray(domSnapshot)) {
            // Responsive mode — attach cookies to each snapshot
            domSnapshot.forEach(snap => { snap.cookies = cookies; });
          } else {
            domSnapshot.cookies = cookies;
          }
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

        // Log the snapshot name on success
        cylog(name, meta);

        return response;
      });
    });
  });
});

module.exports = { createRegion };
