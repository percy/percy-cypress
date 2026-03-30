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

      // Skip iframes without src, with srcdoc, or with unsupported protocols
      if (
        !src ||
        srcdoc ||
        src === 'about:blank' ||
        src === 'about:srcdoc' ||
        SKIPPED_IFRAME_PREFIXES.some(prefix => src.startsWith(prefix))
      ) continue;

      try {
        const frameUrl = new URL(src, currentUrl.href);

        // Only process cross-origin iframes
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
      if (!window.PercyDOM) {
        // eslint-disable-next-line no-eval
        eval(await utils.fetchPercyDOM());
      }
    }, 'injecting @percy/dom');

    return cy.document({ log: false }).then({ timeout: CY_TIMEOUT }, async (dom) => {
      /* istanbul ignore next: no instrumenting injected code */
      let domSnapshot = await withLog(() => {
        return window.PercyDOM.serialize({ ...options, dom });
      }, 'taking dom snapshot');

      await withLog(async () => {
        let processedFrames = processCrossOriginIframes(dom, options, log);
        if (processedFrames.length > 0) {
          domSnapshot.corsIframes = processedFrames;
        }
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
