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

async function processCrossOriginIframes(dom, domSnapshot, options, percyDOMScript) {
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

// Internal state for responsive capture (closure variables, not Cypress.env)
let _percySkip = false;
let _percyDOMScript = null;
let _percyWidthHeights = null;
let _percySnapshots = [];

function _resetResponsiveState() {
  _percySkip = false;
  _percyDOMScript = null;
  _percyWidthHeights = null;
  _percySnapshots = [];
}

// Shared preconditions: check interactive mode, verify Percy is enabled, and
// fetch the PercyDOM serialization script. Returns { skip, percyDOMScript }
// so callers can branch on the result without duplicating checks.
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

// Inject PercyDOM into the current window if not already present.
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

  const needsResponsiveCapture = isResponsiveDOMCaptureValid(options);
  const needsReload = getEnvValue('PERCY_RESPONSIVE_CAPTURE_RELOAD_PAGE')?.toString().toLowerCase() === 'true';

  if (needsResponsiveCapture) {
    const originalWidth = Cypress.config('viewportWidth');
    const originalHeight = Cypress.config('viewportHeight');
    const rawSleepTime = getEnvValue('PERCY_RESPONSIVE_CAPTURE_SLEEP_TIME') || getEnvValue('RESPONSIVE_CAPTURE_SLEEP_TIME');
    const sleepMs = rawSleepTime ? parseInt(rawSleepTime, 10) * 1000 : 0;

    // Shared preconditions + fetch responsive width/height pairs from CLI
    cy.then({ timeout: CY_TIMEOUT }, async () => {
      const preconditions = await checkPreconditions(log, name);
      if (preconditions.skip) {
        _percySkip = true;
        return;
      }
      _percyDOMScript = preconditions.percyDOMScript;

      /* istanbul ignore next: sdk-utils version compatibility */
      if (utils.getResponsiveWidths) {
        _percyWidthHeights = await utils.getResponsiveWidths(options.widths || []);
      } else {
        _percyWidthHeights = (options.widths || [originalWidth]).map(w => ({ width: w, height: null }));
      }
    });

    _percySnapshots = [];

    cy.then(() => {
      /* istanbul ignore next -- guard: browser-side early return when Percy is disabled */
      if (_percySkip) return;
      /* istanbul ignore next */
      const widthHeights = _percyWidthHeights || [];

      const useMinHeight = getEnvValue('PERCY_RESPONSIVE_CAPTURE_MIN_HEIGHT')?.toString().toLowerCase() === 'true';
      const minHeight = useMinHeight ? (utils.percy?.config?.snapshot?.minHeight || originalHeight) : originalHeight;

      for (const { width, height: configHeight } of widthHeights) {
        const w = width;
        const h = configHeight || minHeight;

        cy.viewport(w, h);

        if (needsReload) {
          cy.reload({ log: false });
          cy.document({ log: false }).its('readyState').should('eq', 'complete');
        }

        if (sleepMs > 0) cy.wait(sleepMs, { log: false });

        cy.document({ log: false }).then(async doc => {
          /* istanbul ignore next */
          if (_percySkip) return;
          /* istanbul ignore next */
          if (!_percyDOMScript) return;

          injectPercyDOM(_percyDOMScript);
          if (window.PercyDOM && window.PercyDOM.waitForResize) window.PercyDOM.waitForResize();

          const dom = window.PercyDOM.serialize({ ...options, dom: doc });
          dom.width = w;
          await processCrossOriginIframes(doc, dom, options, _percyDOMScript);
          _percySnapshots.push(dom);
        });
      }
    });

    /* istanbul ignore next: viewport restore runs in Cypress command queue — nyc cannot instrument */
    cy.viewport(originalWidth, originalHeight);

    cy.then(() => {
      const snapshots = [..._percySnapshots];
      _percySnapshots = [];
      if (!snapshots || snapshots.length === 0 || _percySkip) {
        _resetResponsiveState();
        return;
      }

      cy.document({ log: false }).then({ timeout: CY_TIMEOUT }, async doc => {
        const url = doc.URL;

        /* istanbul ignore next: responsive post path — Cypress command queue callbacks */
        return cy.getCookies({ log: false }).then(async cookies => {
          if (cookies && cookies.length > 0) {
            for (const snap of snapshots) {
              if (snap && snap.dom) snap.dom.cookies = cookies;
            }
          }

          /* istanbul ignore next: responsive post path — nyc cannot fully instrument Cypress command queue callbacks */
          const throwConfig = Cypress.config('percyThrowErrorOnFailure');
          const _throw = throwConfig === undefined ? false : throwConfig;

          try {
            let response = await withRetry(async () => await withLog(async () => {
              return await utils.postSnapshot({
                ...options,
                environmentInfo: ENV_INFO,
                clientInfo: CLIENT_INFO,
                domSnapshot: snapshots,
                url,
                name
              });
            }, 'posting responsive dom snapshot', _throw));
            cylog(name, meta);
            /* istanbul ignore next */
            return response;
          } catch (err) {
            log.error(`Failed to post responsive snapshot "${name}"`, err);
          } finally {
            _resetResponsiveState();
          }
        });
      });
    });

    return;
  }

  return cy.then({ timeout: CY_TIMEOUT }, async () => {
    const preconditions = await checkPreconditions(log, name);
    if (preconditions.skip) {
      if (preconditions.reason === 'interactive') {
        return cylog('Disabled in interactive mode', { details: 'use "cypress run" instead of "cypress open"', name });
      }
      return cylog('Not running', { name });
    }

    await withLog(async () => {
      injectPercyDOM(preconditions.percyDOMScript);
    }, 'injecting @percy/dom');

    return cy.document({ log: false }).then({ timeout: CY_TIMEOUT }, async dom => {
      let domSnapshot = await withLog(() => {
        return window.PercyDOM.serialize({ ...options, dom });
      }, 'taking dom snapshot');

      await withLog(async () => {
        await processCrossOriginIframes(dom, domSnapshot, options, preconditions.percyDOMScript);
      }, 'processing cross-origin iframes', false);

      return cy.getCookies({ log: false }).then(async cookies => {
        if (cookies && cookies.length > 0) domSnapshot.cookies = cookies;

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
