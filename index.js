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

  window.PercyDOM.waitForResize();

  let defaultHeight = currentHeight;
  if (Cypress.env('PERCY_RESPONSIVE_CAPTURE_MIN_HEIGHT')?.toString().toLowerCase() === 'true') {
    defaultHeight = options.minHeight || utils.percy?.config?.snapshot?.minHeight || currentHeight;
  }

  const shouldReloadPage = Cypress.env('PERCY_RESPONSIVE_CAPTURE_RELOAD_PAGE')?.toString().toLowerCase() === 'true';

  const rawSleepTime = Cypress.env('PERCY_RESPONSIVE_CAPTURE_SLEEP_TIME') ||
                       Cypress.env('RESPONSIVE_CAPTURE_SLEEP_TIME');
  const sleepSeconds = rawSleepTime ? parseInt(rawSleepTime, 10) : 0;

  const percyDOMScript = await utils.fetchPercyDOM();

  try {
    for (let { width, height } of widthHeights) {
      height = height || defaultHeight;
      if (lastWindowWidth !== width || lastWindowHeight !== height) {
        resizeCount++;
        Cypress.config('viewportWidth', width);
        Cypress.config('viewportHeight', height);
        window.resizeTo(width, height);

        const start = Date.now();
        while (Date.now() - start < 1000) {
          if (window.resizeCount >= resizeCount) break;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        lastWindowWidth = width;
        lastWindowHeight = height;
      }

      if (shouldReloadPage) {
        window.location.reload();
        await new Promise(resolve => setTimeout(resolve, 1000));
        // eslint-disable-next-line no-eval
        eval(percyDOMScript);
        window.PercyDOM.waitForResize();
        resizeCount = 0;
      }

      if (!isNaN(sleepSeconds) && sleepSeconds > 0) {
        await new Promise(resolve => setTimeout(resolve, sleepSeconds * 1000));
      }

      let domSnapshot = window.PercyDOM.serialize({ ...options, dom });
      domSnapshot.width = width;
      domSnapshots.push(domSnapshot);
    }
  } finally {
    resizeCount++;
    Cypress.config('viewportWidth', currentWidth);
    Cypress.config('viewportHeight', currentHeight);
    window.resizeTo(currentWidth, currentHeight);
    const start = Date.now();
    while (Date.now() - start < 1000) {
      if (window.resizeCount >= resizeCount) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  return domSnapshots;
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

  // Check reload flag SYNCHRONOUSLY before any cy commands
  const needsResponsiveReload = (
    (options?.responsive_snapshot_capture || options?.responsiveSnapshotCapture) &&
    Cypress.env('PERCY_RESPONSIVE_CAPTURE_RELOAD_PAGE')?.toString().toLowerCase() === 'true'
  );

  if (needsResponsiveReload) {
    // =====================================================================
    // RESPONSIVE + RELOAD PATH (using cy.task for Node-side state)
    //
    // Pattern: cy.task stores DOM snapshots in Node.js memory,
    // which is immune to page navigations.
    //
    // All cy commands are FLAT in the command body.
    // =====================================================================
    const widths = options.widths || [Cypress.config('viewportWidth')];
    const originalWidth = Cypress.config('viewportWidth');
    const originalHeight = Cypress.config('viewportHeight');

    const useMinHeight = Cypress.env('PERCY_RESPONSIVE_CAPTURE_MIN_HEIGHT')?.toString().toLowerCase() === 'true';
    const defaultHeight = useMinHeight
      ? (options.minHeight || utils.percy?.config?.snapshot?.minHeight || originalHeight)
      : originalHeight;

    const rawSleepTime = Cypress.env('PERCY_RESPONSIVE_CAPTURE_SLEEP_TIME') ||
                         Cypress.env('RESPONSIVE_CAPTURE_SLEEP_TIME');
    const sleepMs = rawSleepTime ? parseInt(rawSleepTime, 10) * 1000 : 0;

    // Preconditions + fetch PercyDOM script (async, stored in Cypress.env)
    cy.then({ timeout: CY_TIMEOUT }, async () => {
      if (Cypress.config('isInteractive') && !Cypress.config('enablePercyInteractiveMode')) {
        Cypress.env('__percySkip', true);
        return;
      }
      if (!await utils.isPercyEnabled()) {
        Cypress.env('__percySkip', true);
        return;
      }
      Cypress.env('__percyDOMScript', await utils.fetchPercyDOM());
    });

    // Clear previous snapshots + save current URL
    cy.task('percy:clearSnapshots', null, { log: false });
    cy.url({ log: false }).then((currentUrl) => {
      Cypress.env('__percyBaseUrl', currentUrl);
    });

    // For each width: viewport → visit → serialize → store in Node.js
    for (const width of widths) {
      const w = width;

      cy.viewport(w, defaultHeight);

      // Visit using saved URL from Cypress.env
      cy.then(() => {
        if (Cypress.env('__percySkip')) return;
        const baseUrl = Cypress.env('__percyBaseUrl');
        if (baseUrl) cy.visit(baseUrl, { log: false });
      });

      if (sleepMs > 0) cy.wait(sleepMs, { log: false });

      // Serialize DOM + store in Node.js via cy.task
      cy.document({ log: false }).then((doc) => {
        if (Cypress.env('__percySkip')) return;
        const script = Cypress.env('__percyDOMScript');
        if (!script) return;

        // eslint-disable-next-line no-eval
        eval(script);
        const dom = window.PercyDOM.serialize({ ...options, dom: doc });
        cy.task('percy:storeSnapshot', { width: w, dom }, { log: false });
      });
    }

    // Restore viewport
    cy.viewport(originalWidth, originalHeight);

    // Retrieve all snapshots from Node.js and post ONE snapshot
    cy.task('percy:getSnapshots', null, { log: false }).then((snapshots) => {
      if (!snapshots || snapshots.length === 0 || Cypress.env('__percySkip')) {
        Cypress.env('__percySkip', undefined);
        Cypress.env('__percyDOMScript', undefined);
        Cypress.env('__percyBaseUrl', undefined);
        return;
      }

      cy.document({ log: false }).then({ timeout: CY_TIMEOUT }, async (doc) => {
        try {
          await utils.postSnapshot({
            ...options,
            environmentInfo: ENV_INFO,
            clientInfo: CLIENT_INFO,
            domSnapshot: snapshots,
            url: doc.URL,
            name
          });
          cylog(name, meta);
        } catch (err) {
          log.error(`Failed to post responsive snapshot "${name}"`, err);
        }

        Cypress.env('__percySkip', undefined);
        Cypress.env('__percyDOMScript', undefined);
        Cypress.env('__percyBaseUrl', undefined);
      });
    });

    return;
  }

  // =====================================================================
  // STANDARD PATH (single DOM capture)
  // =====================================================================
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

    await withLog(async () => {
      if (!window.PercyDOM) {
        // eslint-disable-next-line no-eval
        eval(await utils.fetchPercyDOM());
      }
    }, 'injecting @percy/dom');

    return cy.document({ log: false }).then({ timeout: CY_TIMEOUT }, async (dom) => {
      const percyDOMScript = await utils.fetchPercyDOM();
      const useResponsive = isResponsiveDOMCaptureValid(options);

      let domSnapshot = await withLog(() => {
        if (useResponsive) {
          return captureResponsiveDOM(dom, options);
        }
        return window.PercyDOM.serialize({ ...options, dom });
      }, 'taking dom snapshot');

      await withLog(async () => {
        if (Array.isArray(domSnapshot)) {
          for (const snap of domSnapshot) {
            await processCrossOriginIframes(dom, snap, options, percyDOMScript);
          }
        } else {
          await processCrossOriginIframes(dom, domSnapshot, options, percyDOMScript);
        }
      }, 'processing cross-origin iframes', false);

      return cy.getCookies({ log: false }).then(async (cookies) => {
        if (cookies && cookies.length > 0) {
          if (Array.isArray(domSnapshot)) {
            domSnapshot.forEach(snap => { snap.cookies = cookies; });
          } else {
            domSnapshot.cookies = cookies;
          }
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
