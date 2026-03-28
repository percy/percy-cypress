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

  // Check responsive flag SYNCHRONOUSLY before any cy commands
  const needsResponsiveCapture = isResponsiveDOMCaptureValid(options);
  const needsReload = Cypress.env('PERCY_RESPONSIVE_CAPTURE_RELOAD_PAGE')?.toString().toLowerCase() === 'true';

  if (needsResponsiveCapture) {
    // =====================================================================
    // RESPONSIVE CAPTURE PATH (unified — uses cy.task for Node-side state)
    //
    // Handles BOTH reload and non-reload responsive capture:
    // - With reload: cy.viewport → cy.visit(url) → serialize → cy.task(store)
    // - Without reload: cy.viewport → serialize → cy.task(store)
    //
    // cy.task stores DOM snapshots in Node.js memory,
    // which is immune to page navigations.
    // =====================================================================
    const originalWidth = Cypress.config('viewportWidth');
    const originalHeight = Cypress.config('viewportHeight');

    const rawSleepTime = Cypress.env('PERCY_RESPONSIVE_CAPTURE_SLEEP_TIME') ||
                         Cypress.env('RESPONSIVE_CAPTURE_SLEEP_TIME');
    const sleepMs = rawSleepTime ? parseInt(rawSleepTime, 10) * 1000 : 0;

    // Preconditions + fetch PercyDOM + get responsive widths from CLI config
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

      // Use utils.getResponsiveWidths to get width/height PAIRS from CLI config
      // (same as captureResponsiveDOM uses)
      if (utils.getResponsiveWidths) {
        const widthHeights = await utils.getResponsiveWidths(options.widths || []);
        Cypress.env('__percyWidthHeights', JSON.stringify(widthHeights));
      } else {
        // Fallback: use raw widths with default height
        const fallback = (options.widths || [originalWidth]).map(w => ({ width: w, height: null }));
        Cypress.env('__percyWidthHeights', JSON.stringify(fallback));
      }
    });

    // Clear previous snapshots + save current URL
    cy.task('percy:clearSnapshots', null, { log: false });
    cy.url({ log: false }).then((currentUrl) => {
      Cypress.env('__percyBaseUrl', currentUrl);
    });

    // Calculate default height
    const useMinHeight = Cypress.env('PERCY_RESPONSIVE_CAPTURE_MIN_HEIGHT')?.toString().toLowerCase() === 'true';
    const configMinHeight = useMinHeight
      ? (options.minHeight || utils.percy?.config?.snapshot?.minHeight || originalHeight)
      : originalHeight;

    // Get widths and iterate — widthHeights comes from the async step above
    cy.then(() => {
      if (Cypress.env('__percySkip')) return;

      const widthHeights = JSON.parse(Cypress.env('__percyWidthHeights') || '[]');

      for (const { width, height: configHeight } of widthHeights) {
        const w = width;
        const h = configHeight || configMinHeight;

        // Resize viewport (same as captureResponsiveDOM)
        cy.viewport(w, h);

        // Reload page if flag is set (JS-driven responsive pages)
        if (needsReload) {
          cy.then(() => {
            if (Cypress.env('__percySkip')) return;
            const baseUrl = Cypress.env('__percyBaseUrl');
            if (baseUrl) cy.visit(baseUrl, { log: false });
          });
        }

        // Optional sleep between captures
        if (sleepMs > 0) cy.wait(sleepMs, { log: false });

        // Inject PercyDOM + setup resize listener + serialize + store via cy.task
        cy.document({ log: false }).then((doc) => {
          if (Cypress.env('__percySkip')) return;
          const script = Cypress.env('__percyDOMScript');
          if (!script) return;

          // eslint-disable-next-line no-eval
          eval(script);

          // Setup resize listener (same as captureResponsiveDOM)
          if (window.PercyDOM.waitForResize) {
            window.PercyDOM.waitForResize();
          }

          const dom = window.PercyDOM.serialize({ ...options, dom: doc });
          dom.width = w;
          cy.task('percy:storeSnapshot', { width: w, dom }, { log: false });
        });
      }

      // Restore viewport
      cy.viewport(originalWidth, originalHeight);
    });

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

      let domSnapshot = await withLog(() => {
        return window.PercyDOM.serialize({ ...options, dom });
      }, 'taking dom snapshot');

      await withLog(async () => {
        await processCrossOriginIframes(dom, domSnapshot, options, percyDOMScript);
      }, 'processing cross-origin iframes', false);

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
