const utils = require('@percy/sdk-utils');

// Processes a single cross-origin frame to capture its snapshot and resources.
// This code handles cross-origin iframes which cannot be tested in Cypress's test environment
// because Cypress runs in the same origin as the application under test.
async function processFrame(win, frame, options, percyDOM, logger) {
  const frameUrl = frame.location.href;

  try {
    // Inject Percy DOM into the frame
    /* istanbul ignore next: browser-executed iframe code injection */
    frame.eval(percyDOM);

    // Serialize the frame content
    // enableJavaScript: true prevents the standard iframe serialization logic from running.
    /* istanbul ignore next: browser-executed iframe serialization */
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
    /* istanbul ignore next: browser-executed evaluation function */
    const iframeData = win.eval((fUrl) => {
      const iframes = Array.from(document.querySelectorAll('iframe'));
      const matchingIframe = iframes.find(iframe => iframe.src && iframe.src.startsWith(fUrl));
      if (matchingIframe) {
        return {
          percyElementId: matchingIframe.getAttribute('data-percy-element-id')
        };
      }
      return undefined;
    }, frameUrl);

    return {
      iframeData,
      iframeResource,
      iframeSnapshot,
      frameUrl
    };
  } catch (error) {
    /* istanbul ignore next: error handling for cross-origin failures */
    logger.error(`Error processing iframe ${frameUrl}:`, error);
    /* istanbul ignore next */
    return null;
  }
}

// Process cross-origin iframes and merge them into the main snapshot
async function processCrossOriginIframes(window, dom, domSnapshot, options, log) {
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
        /* istanbul ignore next: cross-origin iframe detection */
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
    /* istanbul ignore next: cross-origin iframe processing */
    const percyDOM = await utils.fetchPercyDOM();

    /* istanbul ignore next: cross-origin iframe processing */
    const processedFrames = await Promise.all(
      crossOriginFrames.map(({ element, window: frameWindow, url }) =>
        processFrame(window, frameWindow, options, percyDOM, log)
      )
    ).then(results => results.filter(r => r !== null));

    /* istanbul ignore next: cross-origin iframe processing */
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

        /* istanbul ignore next: iframe matching logic depends on DOM structure */
        if (match) {
          const iframeTag = match[1];
          // Replace the original iframe tag with one that points to the new resource.
          const newIframeTag = iframeTag.replace(/src="[^"]*"/i, `src="${frameUrl}"`);
          domSnapshot.html = domSnapshot.html.replace(iframeTag, newIframeTag);
        }
      }
    }
  }

  return domSnapshot;
}

module.exports = { processCrossOriginIframes };
