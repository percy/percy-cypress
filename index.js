const utils = require('@percy/sdk-utils');
const { createRegion } = require('./createRegion');

const sdkPkg = require('./package.json');
const CLIENT_INFO = `${sdkPkg.name}/${sdkPkg.version}`;
const ENV_INFO = `cypress/${Cypress.version}`;
// asset discovery should timeout before this (1.5 times the 30 second nav timeout)
const CY_TIMEOUT = 30 * 1000 * 1.5;

// Support both new and legacy methods for backward compatibility

const getPercyServerAddress = () => {
  return (typeof Cypress.expose === 'function')
    ? Cypress.expose('PERCY_SERVER_ADDRESS')
    : /* istanbul ignore next */ Cypress.env('PERCY_SERVER_ADDRESS');
};
utils.percy.address = getPercyServerAddress();

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

const parseEnvBool = (value) => {
  if (typeof value === 'string') {
    return value.toLowerCase() === 'true';
  }
  return value === true;
};

const DEFAULT_MIN_HEIGHT = 1024;

function isResponsiveDOMCaptureValid(options) {
  const log = utils.logger('cypress');
  if (utils.percy?.config?.percy?.deferUploads) {
    log.error('Responsive capture disabled: deferUploads is true');
    return false;
  }
  return (
    options?.responsive_snapshot_capture ||
    options?.responsiveSnapshotCapture ||
    utils.percy?.config?.snapshot?.responsiveSnapshotCapture ||
    false
  );
}

function isResponsiveMinHeightEnabled() {
  const envVar = Cypress.env('PERCY_RESPONSIVE_CAPTURE_MIN_HEIGHT') ||
                 Cypress.env('RESONSIVE_CAPTURE_MIN_HEIGHT');
  return parseEnvBool(envVar);
}

function isReloadPageEnabled() {
  const envVar = Cypress.env('PERCY_RESPONSIVE_CAPTURE_RELOAD_PAGE');
  return envVar && parseEnvBool(envVar);
}

// CSS-based responsive capture: changes document width without reloading
async function captureResponsiveDOM(dom, options) {
  let widthHeights;
  const inputWidths = options.widths || [];

  /* istanbul ignore next: CLI version compatibility */
  if (typeof utils.getResponsiveWidths === 'function') {
    widthHeights = await utils.getResponsiveWidths(inputWidths);
  } else {
    widthHeights = inputWidths.map(w => ({ width: w }));
  }
  const domSnapshots = [];

  const originalWidth = dom.documentElement.style.width;
  const originalOverflow = dom.documentElement.style.overflow;
  const originalMinHeight = dom.documentElement.style.minHeight;

  for (let { width } of widthHeights) {
    dom.documentElement.style.width = width + 'px';
    dom.documentElement.style.overflow = 'hidden';

    if (isResponsiveMinHeightEnabled()) {
      const minHeight = utils.percy?.config?.snapshot?.minHeight || DEFAULT_MIN_HEIGHT;
      dom.documentElement.style.minHeight = minHeight + 'px';
    }

    // Force reflow
    // eslint-disable-next-line no-unused-expressions
    dom.documentElement.offsetHeight;

    const sleepTime = parseInt(
      Cypress.env('RESPONSIVE_CAPTURE_SLEEP_TIME') ||
      Cypress.env('PERCY_RESPONSIVE_CAPTURE_SLEEP_TIME') ||
      '0'
    );
    if (sleepTime > 0) {
      await new Promise(resolve => setTimeout(resolve, sleepTime * 1000));
    }

    /* istanbul ignore next: no instrumenting injected code */
    let domSnapshot = window.PercyDOM.serialize({ ...options, dom });
    domSnapshot.width = width;
    domSnapshots.push(domSnapshot);
  }

  dom.documentElement.style.width = originalWidth;
  dom.documentElement.style.overflow = originalOverflow;
  dom.documentElement.style.minHeight = originalMinHeight;

  return domSnapshots;
}

// Reload-based responsive capture: resizes viewport and reloads page at each width,
// collects domSnapshots into an array (each with different HTML/SHA after JS re-executes),
// then returns the array for posting as a single Percy snapshot
function captureResponsiveDOMWithReload(options, widths) {
  const log = utils.logger('cypress');
  const minHeight = utils.percy?.config?.snapshot?.minHeight || DEFAULT_MIN_HEIGHT;
  const domSnapshots = [];

  let chain = cy.wrap(null, { log: false });

  for (const width of widths) {
    chain = chain
      .then(() => cy.viewport(width, minHeight, { log: false }))
      .then(() => cy.reload({ log: false }))
      .then(() => cy.document({ log: false }).its('readyState').should('eq', 'complete'))
      .then(() => {
        return cy.window({ log: false }).then(async () => {
          if (!window.PercyDOM) {
            // eslint-disable-next-line no-eval
            eval(await utils.fetchPercyDOM());
          }
        });
      })
      .then(() => {
        return cy.document({ log: false }).then((dom) => {
          /* istanbul ignore next: no instrumenting injected code */
          // Serialize WITHOUT enableJavaScript so CSSOM is captured —
          // combined with JS-mutated DOM from reload, this produces unique HTML per width
          const domSnapshot = window.PercyDOM.serialize({ ...options, dom });
          domSnapshot.width = width;
          domSnapshots.push(domSnapshot);
          log.debug(`Captured reload snapshot at ${width}px (${domSnapshot.html.length} bytes)`);
        });
      });
  }

  return chain.then(() => domSnapshots);
}

// Skip protocols that cannot be accessed (javascript:, data:, etc.)
const SKIPPED_IFRAME_PREFIXES = [
  'javascript:',
  'data:',
  'vbscript:',
  'blob:',
  'chrome:',
  'chrome-extension:'
];

function processCrossOriginIframes(dom, options, log) {
  const processedFrames = [];
  try {
    const currentUrl = new URL(dom.URL);
    const iframes = dom.querySelectorAll('iframe');

    for (const iframe of iframes) {
      const src = iframe.getAttribute('src');
      const srcdoc = iframe.getAttribute('srcdoc');

      if (
        !src ||
        srcdoc ||
        src === 'about:blank' ||
        src === 'about:srcdoc' ||
        SKIPPED_IFRAME_PREFIXES.some(prefix => src.startsWith(prefix))
      ) continue;

      try {
        const frameUrl = new URL(src, currentUrl.href);

        if (frameUrl.origin !== currentUrl.origin) {
          log.debug(`Processing cross-origin iframe: ${frameUrl.href}`);
          const percyElementId = iframe.getAttribute('data-percy-element-id');

          if (!percyElementId) {
            log.debug(`Skipping frame ${frameUrl.href}: no data-percy-element-id found`);
            continue;
          }

          try {
            // Requires chromeWebSecurity: false to access cross-origin contentDocument
            const iframeDoc = iframe.contentDocument;
            const iframeWin = iframe.contentWindow;

            if (!iframeDoc || !iframeWin) {
              log.debug(`Skipping frame ${frameUrl.href}: contentDocument not accessible`);
              continue;
            }

            if (!iframeWin.PercyDOM) {
              /* istanbul ignore next: no instrumenting injected code */
              iframeWin.PercyDOM = window.PercyDOM;
            }

            /* istanbul ignore next: no instrumenting injected code */
            const iframeSnapshot = iframeWin.PercyDOM.serialize({
              ...options,
              dom: iframeDoc,
              enableJavaScript: true
            });

            log.debug(`Successfully captured cross-origin iframe: ${frameUrl.href}`);
            processedFrames.push({
              iframeData: { percyElementId },
              iframeSnapshot,
              frameUrl: frameUrl.href
            });
          } catch (e) {
            // Typically SecurityError when chromeWebSecurity: false is not configured
            log.debug(`Could not access iframe "${frameUrl.href}": ${e.message}`);
          }
        }
      } catch (e) {
        log.debug(`Skipping iframe "${src}": ${e.message}`);
      }
    }
  } catch (e) {
    log.debug(`Error during cross-origin iframe processing: ${e.message}`);
  }

  return processedFrames;
}

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

  // Step 1: async checks (isPercyEnabled, inject PercyDOM)
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

  // Step 2: check reload — must be in a non-async .then() so Cypress commands execute
  }).then(() => {
    // Skip if Percy is not enabled (Step 1 returned early)
    if (!window.PercyDOM) return;

    const responsiveCapture = isResponsiveDOMCaptureValid(options);
    // Accept reload flag via options or Cypress.env (env may not persist through percy exec)
    const useReload = responsiveCapture && (
      options?.reloadPage === true ||
      isReloadPageEnabled()
    );

    if (useReload) {
      let widths = (options.widths || []);
      return captureResponsiveDOMWithReload(options, widths).then((domSnapshots) => {
        // Post as single snapshot with array of domSnapshots (each has unique HTML/SHA)
        return cy.getCookies({ log: false }).then(async (cookies) => {
          if (cookies && cookies.length > 0) {
            domSnapshots.forEach(s => { s.cookies = cookies; });
          }
          return cy.url({ log: false }).then(async (snapshotUrl) => {
            const throwConfig = Cypress.config('percyThrowErrorOnFailure');
            const _throw = throwConfig === undefined ? false : throwConfig;
            try {
              await utils.postSnapshot({
                ...options,
                environmentInfo: ENV_INFO,
                clientInfo: CLIENT_INFO,
                domSnapshot: domSnapshots,
                url: snapshotUrl,
                name
              });
            } catch (e) {
              if (_throw) throw e;
              log.error(`Failed to post snapshot: ${e.message}`);
            }
            cylog(name, meta);
          });
        });
      });
    }

    // Step 3: standard path (single snapshot or CSS-based responsive)
    return cy.document({ log: false }).then({ timeout: CY_TIMEOUT }, async (dom) => {
      const responsiveCapture = isResponsiveDOMCaptureValid(options);
      let domSnapshot;

      if (responsiveCapture) {
        domSnapshot = await withLog(async () => {
          return await captureResponsiveDOM(dom, options);
        }, 'taking responsive dom snapshot');
      } else {
        /* istanbul ignore next: no instrumenting injected code */
        domSnapshot = await withLog(() => {
          return window.PercyDOM.serialize({ ...options, dom });
        }, 'taking dom snapshot');
      }

      if (!responsiveCapture) {
        await withLog(async () => {
          let processedFrames = processCrossOriginIframes(dom, options, log);
          if (processedFrames.length > 0) {
            domSnapshot.corsIframes = processedFrames;
          }
        }, 'processing cross-origin iframes', false);
      }

      return cy.getCookies({ log: false }).then(async (cookies) => {
        if (cookies && cookies.length > 0) {
          if (Array.isArray(domSnapshot)) {
            domSnapshot.forEach(snapshot => { snapshot.cookies = cookies; });
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
