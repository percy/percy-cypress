const utils = require('@percy/sdk-utils');
const { createRegion } = require('./createRegion');
const { getEnvValue, lazyResolveAddress } = require('./env-utils');

const sdkPkg = require('./package.json');
const CLIENT_INFO = `${sdkPkg.name}/${sdkPkg.version}`;
const ENV_INFO = `cypress/${Cypress.version}`;
const CY_TIMEOUT = 30 * 1000 * 1.5;

utils.percy.address = getEnvValue('PERCY_SERVER_ADDRESS');

utils.request.fetch = async function fetch(url, options) {
  options = { url, retryOnNetworkFailure: false, ...options };
  return Cypress.backend('http:request', options);
};

function cylog(message, meta) {
  Cypress.log({
    name: 'percySnapshot',
    displayName: 'percy',
    consoleProps: () => meta,
    message
  });
}

const SKIP_IFRAME_SRCS = [
  'about:blank', 'about:srcdoc', 'javascript:', 'data:',
  'vbscript:', 'blob:', 'chrome:', 'chrome-extension:'
];

function processCrossOriginIframes(dom, domSnapshot, options, percyDOMScript) {
  const log = utils.logger('cypress');
  try {
    const currentUrl = new URL(dom.URL);
    const iframes = dom.querySelectorAll('iframe');
    const processedFrames = [];

    for (const iframe of iframes) {
      const src = iframe.getAttribute('src');
      const srcdoc = iframe.getAttribute('srcdoc');
      const srcLower = src ? src.toLowerCase() : '';
      if (!src || srcdoc || SKIP_IFRAME_SRCS.some(p => srcLower === p || srcLower.startsWith(p))) continue;

      try {
        const frameUrl = new URL(src, currentUrl.href);
        if (frameUrl.origin === currentUrl.origin) continue;

        const percyElementId = iframe.getAttribute('data-percy-element-id');
        if (!percyElementId) {
          log.debug(`Skipping cross-origin iframe ${frameUrl.href}: no data-percy-element-id`);
          continue;
        }

        let iframeSnapshot = null;
        try {
          const frameWindow = iframe.contentWindow;
          const frameDocument = iframe.contentDocument || frameWindow?.document;
          if (frameDocument) {
            if (!frameWindow.PercyDOM) {
              const script = frameDocument.createElement('script');
              script.textContent = percyDOMScript;
              frameDocument.head.appendChild(script);
              frameDocument.head.removeChild(script);
            }
            if (frameWindow.PercyDOM) {
              iframeSnapshot = frameWindow.PercyDOM.serialize({ ...options, enableJavaScript: true });
            }
          }
        } catch (accessError) {
          log.debug(`Cannot access cross-origin iframe directly (expected): ${accessError.message}`);
          iframeSnapshot = null;
        }

        processedFrames.push({ iframeData: { percyElementId }, iframeSnapshot, frameUrl: frameUrl.href });
      } catch (e) {
        log.debug(`Skipping iframe "${src}": ${e.message}`);
      }
    }

    if (processedFrames.length > 0) {
      domSnapshot.corsIframes = processedFrames;
    }
  } catch (e) {
    log.debug(`Error during cross-origin iframe processing: ${e.message}`);
  }
}

function isResponsiveDOMCaptureValid(options) {
  if (utils.percy?.config?.percy?.deferUploads) {
    const log = utils.logger('cypress');
    log.warn('Responsive capture disabled: deferUploads is enabled');
    return false;
  }
  return (
    options?.responsive_snapshot_capture ||
    options?.responsiveSnapshotCapture ||
    utils.percy?.config?.snapshot?.responsiveSnapshotCapture ||
    false
  );
}

// Shared preconditions: check interactive mode, verify Percy is enabled, and
// fetch the PercyDOM serialization script.
async function checkPreconditions(log, name) {
  if (Cypress.config('isInteractive') && !Cypress.config('enablePercyInteractiveMode')) {
    return { skip: true, reason: 'interactive' };
  }
  if (!await utils.isPercyEnabled()) {
    return { skip: true, reason: 'disabled' };
  }
  const percyDOMScript = await utils.fetchPercyDOM();
  return { skip: false, percyDOMScript };
}

function injectPercyDOM(percyDOMScript) {
  if (!window.PercyDOM) {
    // eslint-disable-next-line no-eval
    (0, eval)(percyDOMScript);
  }
}

Cypress.Commands.add('percySnapshot', (name, options = {}) => {
  const log = utils.logger('cypress');

  lazyResolveAddress(log);

  if (typeof name === 'object') {
    options = name;
    name = undefined;
  }
  name = name || cy.state('runnable').fullTitle();

  const meta = { snapshot: { name, testCase: options.testCase } };

  const withLog = async (func, context, _throw) => {
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
    let error;
    while (num <= maxNum) {
      try {
        return await func();
      } catch (e) {
        error = e;
        log.error(`Retrying... (${num}/${maxNum})`);
        await new Promise(res => setTimeout(res, 1000));
      }
      num += 1;
    }
    throw error;
  };

  const needsReload = getEnvValue('PERCY_RESPONSIVE_CAPTURE_RELOAD_PAGE')?.toString().toLowerCase() === 'true';
  const originalWidth = Cypress.config('viewportWidth');
  const originalHeight = Cypress.config('viewportHeight');

  let _skip = false;
  let _percyDOMScript = null;
  let _widthHeights = null;
  let _snapshots = [];
  let _isResponsive = false;

  // Step 1: Preconditions (async — runs in cy.then)
  cy.then({ timeout: CY_TIMEOUT }, async () => {
    const preconditions = await checkPreconditions(log, name);
    if (preconditions.skip) {
      _skip = true;
      if (preconditions.reason === 'interactive') {
        cylog('Disabled in interactive mode', { details: 'use "cypress run" instead of "cypress open"', name });
      } else {
        cylog('Not running', { name });
      }
      return;
    }
    _percyDOMScript = preconditions.percyDOMScript;

    // Check responsive AFTER isPercyEnabled() populates utils.percy.config
    _isResponsive = isResponsiveDOMCaptureValid(options);

    try {
      if (_isResponsive) {
        _widthHeights = await utils.getResponsiveWidths(options.widths || []);
      }
    } catch (e) {
      log.debug('getResponsiveWidths not available — please upgrade @percy/cli to 1.31.10+. Using fallback widths.');
    }
  });

  // Step 2: Capture DOM at each width (flat cy commands — no async nesting)
  cy.then(() => {
    if (_skip) return;

    // Use CLI-provided width/height pairs when available, fallback to raw widths
    let widthHeights;
    if (_isResponsive) {
      widthHeights = _widthHeights || (options.widths || [originalWidth]).map(w => ({ width: w }));
    } else {
      widthHeights = [{ width: null }]; // null = don't resize, capture at current viewport
    }

    const useMinHeight = _isResponsive &&
      getEnvValue('PERCY_RESPONSIVE_CAPTURE_MIN_HEIGHT')?.toString().toLowerCase() === 'true';
    const defaultHeight = useMinHeight
      ? (utils.percy?.config?.snapshot?.minHeight || originalHeight)
      : originalHeight;

    const rawSleepTime = _isResponsive
      ? (getEnvValue('PERCY_RESPONSIVE_CAPTURE_SLEEP_TIME') || getEnvValue('RESPONSIVE_CAPTURE_SLEEP_TIME'))
      : null;
    const sleepMs = rawSleepTime ? parseInt(rawSleepTime, 10) * 1000 : 0;

    let lastWindowWidth = originalWidth;
    let lastWindowHeight = defaultHeight;

    for (let { width, height } of widthHeights) {
      height = height || defaultHeight;

      // Resize viewport only when dimensions change (skip redundant resizes)
      if (width !== null && (lastWindowWidth !== width || lastWindowHeight !== height)) {
        cy.viewport(width, height);
        lastWindowWidth = width;
        lastWindowHeight = height;
      }

      // Reload page at new viewport (responsive + reload mode only)
      if (width !== null && needsReload) {
        cy.reload({ log: false });
        cy.document({ log: false }).its('readyState').should('eq', 'complete');
      }

      if (sleepMs > 0) cy.wait(sleepMs, { log: false });

      // Serialize DOM and collect snapshot
      cy.document({ log: false }).then(async doc => {
        if (_skip || !_percyDOMScript) return;

        injectPercyDOM(_percyDOMScript);

        const domSnapshot = window.PercyDOM.serialize({ ...options, dom: doc });
        if (width !== null) domSnapshot.width = width;

        processCrossOriginIframes(doc, domSnapshot, options, _percyDOMScript);
        _snapshots.push(domSnapshot);
      });
    }
  });

  // Restore viewport after responsive capture
  cy.then(() => {
    if (_isResponsive) {
      cy.viewport(originalWidth, originalHeight);
    }
  });

  // Step 3: Post snapshot(s) with cookies, retry, and error handling
  cy.then(() => {
    if (_skip || _snapshots.length === 0) return;

    cy.getCookies({ log: false }).then(cookies => {
      if (cookies && cookies.length > 0) {
        for (const snap of _snapshots) {
          snap.cookies = cookies;
        }
      }

      cy.document({ log: false }).then({ timeout: CY_TIMEOUT }, async doc => {
        const throwConfig = Cypress.config('percyThrowErrorOnFailure');
        const _throw = throwConfig === undefined ? false : throwConfig;

        // Post single snapshot or array depending on mode
        const domSnapshot = _isResponsive ? _snapshots : _snapshots[0];

        try {
          let response = await withRetry(async () => await withLog(async () => {
            return await utils.postSnapshot({
              ...options,
              environmentInfo: ENV_INFO,
              clientInfo: CLIENT_INFO,
              domSnapshot,
              url: doc.URL,
              name
            });
          }, 'posting dom snapshot', _throw));

          cylog(name, meta);
          return response;
        } catch (err) {
          log.error(`Failed to post snapshot "${name}"`, err);
        } finally {
          _snapshots = [];
        }
      });
    });
  });
});

module.exports = { createRegion };
