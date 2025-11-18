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
utils.percy.address = Cypress.env('PERCY_SERVER_ADDRESS');

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

// Processes a single cross-origin frame to capture its snapshot and resources.
async function processFrame(win, frame, options, percyDOM, logger) {
  const frameUrl = frame.location.href;

  try {
    // Inject Percy DOM into the frame
    frame.eval(percyDOM);

    // Serialize the frame content
    // enableJavaScript: true prevents the standard iframe serialization logic from running.
    const iframeSnapshot = frame.eval((opts) => {
      /* eslint-disable-next-line no-undef */
      return PercyDOM.serialize(opts);
    }, { ...options, enableJavascript: true });

    // Create a new resource for the iframe's HTML
    const iframeResource = {
      url: frameUrl,
      content: iframeSnapshot.html,
      mimetype: 'text/html'
    };

    // Get the iframe's element data from the main window context
    const iframeData = win.eval((fUrl) => {
      const iframes = Array.from(document.querySelectorAll('iframe'));
      const matchingIframe = iframes.find(iframe => iframe.src && iframe.src.startsWith(fUrl));
      if (matchingIframe) {
        return {
          percyElementId: matchingIframe.getAttribute('data-percy-element-id')
        };
      }
    }, frameUrl);

    return {
      iframeData,
      iframeResource,
      iframeSnapshot,
      frameUrl
    };
  } catch (error) {
    logger.error(`Error processing iframe ${frameUrl}:`, error);
    return null;
  }
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
      let domSnapshot = await withLog(() => {
        return window.PercyDOM.serialize({ ...options, dom });
      }, 'taking dom snapshot');

      // Process Cross-Origin IFrames
      const currentUrl = new URL(dom.URL);
      const crossOriginFrames = [];

      // Get all iframes from the document
      const iframes = dom.querySelectorAll('iframe');
      for (const iframe of iframes) {
        try {
          const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
          if (!iframeDoc) continue; // Cannot access cross-origin iframe

          const iframeUrl = iframe.contentWindow.location.href;
          if (iframeUrl === 'about:blank') continue;

          const iframeOrigin = new URL(iframeUrl).origin;
          if (iframeOrigin !== currentUrl.origin) {
            crossOriginFrames.push({
              element: iframe,
              window: iframe.contentWindow,
              url: iframeUrl
            });
          }
        } catch (e) {
          // Cross-origin access error - expected for cross-origin iframes
          // We can't access these, so skip them
        }
      }

      // Process cross-origin frames in parallel
      if (crossOriginFrames.length > 0) {
        const percyDOM = await utils.fetchPercyDOM();

        const processedFrames = await Promise.all(
          crossOriginFrames.map(({ element, window: frameWindow, url }) =>
            processFrame(window, frameWindow, options, percyDOM, log)
          )
        ).then(results => results.filter(r => r !== null));

        for (const { iframeData, iframeResource, iframeSnapshot, frameUrl } of processedFrames) {
          // Add the iframe's own resources to the main snapshot
          if (iframeSnapshot && iframeSnapshot.resources && Array.isArray(iframeSnapshot.resources)) {
            domSnapshot.resources.push(...iframeSnapshot.resources);
          }
          // Add the iframe HTML resource itself
          domSnapshot.resources.push(iframeResource);

          if (iframeData && iframeData.percyElementId) {
            const regex = new RegExp(`(<iframe[^>]*data-percy-element-id=["']${iframeData.percyElementId}["'][^>]*>)`);
            const match = domSnapshot.html.match(regex);

            if (match) {
              const iframeTag = match[1];
              // Replace the original iframe tag with one that points to the new resource.
              const newIframeTag = iframeTag.replace(/src="[^"]*"/i, `src="${frameUrl}"`);
              domSnapshot.html = domSnapshot.html.replace(iframeTag, newIframeTag);
            }
          }
        }
      }

      // Capture cookies
      await withLog(async () => {
        const cookies = await cy.getCookies({ log: false });
        if (cookies && cookies.length > 0) {
          domSnapshot.cookies = cookies;
        }
      }, 'capturing cookies', false);

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

module.exports = { createRegion };
module.exports.createRegion = createRegion;
module.exports.CLIENT_INFO = CLIENT_INFO;
module.exports.ENV_INFO = ENV_INFO;
