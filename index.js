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
      if (!src || srcdoc || SKIP_IFRAME_SRCS.some(p => src === p || src.startsWith(p))) continue;

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
  if (utils.percy?.config?.percy?.deferUploads) return false;
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
let _percyBaseUrl = null;
let _percyWidthHeights = null;

function _resetResponsiveState() {
  _percySkip = false;
  _percyDOMScript = null;
  _percyBaseUrl = null;
  _percyWidthHeights = null;
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

    // Preconditions + fetch PercyDOM + get responsive width/height pairs from CLI
    cy.then({ timeout: CY_TIMEOUT }, async () => {
      if (Cypress.config('isInteractive') && !Cypress.config('enablePercyInteractiveMode')) {
        _percySkip = true;
        return;
      }
      if (!await utils.isPercyEnabled()) {
        _percySkip = true;
        return;
      }
      _percyDOMScript = await utils.fetchPercyDOM();

      if (utils.getResponsiveWidths) {
        _percyWidthHeights = await utils.getResponsiveWidths(options.widths || []);
      } else {
        _percyWidthHeights = (options.widths || [originalWidth]).map(w => ({ width: w, height: null }));
      }
    });

    cy.task('percy:clearSnapshots', null, { log: false });
    cy.url({ log: false }).then(url => { _percyBaseUrl = url; });

    const useMinHeight = getEnvValue('PERCY_RESPONSIVE_CAPTURE_MIN_HEIGHT')?.toString().toLowerCase() === 'true';
    const minHeight = useMinHeight ? (utils.percy?.config?.snapshot?.minHeight || originalHeight) : originalHeight;

    cy.then(() => {
      /* istanbul ignore next -- guard: browser-side early return when Percy is disabled */
      if (_percySkip) return;
      /* istanbul ignore next */
      const widthHeights = _percyWidthHeights || [];

      for (const { width, height: configHeight } of widthHeights) {
        const w = width;
        const h = configHeight || minHeight;

        cy.viewport(w, h);

        if (needsReload) {
          cy.then(() => {
            /* istanbul ignore next */
            if (_percySkip) return;
            /* istanbul ignore next */
            if (_percyBaseUrl) cy.visit(_percyBaseUrl, { log: false });
          });
        }

        if (sleepMs > 0) cy.wait(sleepMs, { log: false });

        cy.document({ log: false }).then(doc => {
          /* istanbul ignore next */
          if (_percySkip) return;
          /* istanbul ignore next */
          if (!_percyDOMScript) return;

          // Re-inject PercyDOM (may have been lost after page reload)
          if (!window.PercyDOM) {
            // eslint-disable-next-line no-eval
            (0, eval)(_percyDOMScript);
          }
          if (window.PercyDOM && window.PercyDOM.waitForResize) window.PercyDOM.waitForResize();

          const dom = window.PercyDOM.serialize({ ...options, dom: doc });
          dom.width = w;
          cy.task('percy:storeSnapshot', { width: w, dom }, { log: false });
        });
      }

      cy.viewport(originalWidth, originalHeight);
    });

    // Collect all snapshots from Node.js and post ONE snapshot
    cy.task('percy:getSnapshots', null, { log: false }).then(snapshots => {
      if (!snapshots || snapshots.length === 0 || _percySkip) {
        _resetResponsiveState();
        return;
      }

      cy.document({ log: false }).then({ timeout: CY_TIMEOUT }, async doc => {
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

        _resetResponsiveState();
      });
    });

    return;
  }

  return cy.then({ timeout: CY_TIMEOUT }, async () => {
    if (Cypress.config('isInteractive') && !Cypress.config('enablePercyInteractiveMode')) {
      return cylog('Disabled in interactive mode', { details: 'use "cypress run" instead of "cypress open"', name });
    }

    if (!await utils.isPercyEnabled()) {
      return cylog('Not running', { name });
    }

    const percyDOMScript = await utils.fetchPercyDOM();

    await withLog(async () => {
      if (!window.PercyDOM) {
        // eslint-disable-next-line no-eval
        (0, eval)(percyDOMScript);
      }
    }, 'injecting @percy/dom');

    return cy.document({ log: false }).then({ timeout: CY_TIMEOUT }, async dom => {

      let domSnapshot = await withLog(() => {
        return window.PercyDOM.serialize({ ...options, dom });
      }, 'taking dom snapshot');

      await withLog(async () => {
        await processCrossOriginIframes(dom, domSnapshot, options, percyDOMScript);
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
