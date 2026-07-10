// Canonical iframe-capture helpers, single source of truth (percy/cli #2319).
const utils = require('@percy/sdk-utils');
const { createRegion } = require('./createRegion');
const { getEnvValue, lazyResolveAddress } = require('./env-utils');
const { isUnsupportedIframeSrc, normalizeIgnoreSelectors } = utils;

const sdkPkg = require('./package.json');
const CLIENT_INFO = `${sdkPkg.name}/${sdkPkg.version}`;
const ENV_INFO = `cypress/${Cypress.version}`;
const CY_TIMEOUT = 30 * 1000 * 1.5;

// Inject Percy preflight script before every page load to intercept
// closed shadow roots and ElementInternals. This runs before the page's
// own scripts, so attachShadow({ mode: 'closed' }) calls are captured.
//
// Storage: a WeakMap<host, ShadowRoot> per window. We deliberately do NOT
// keep a parallel hosts[] array — that would hold strong refs to every host
// element across the test lifetime and defeat the WeakMap, leaking detached
// DOM nodes in long SPA suites. Consumers (@percy/dom serializer) reach the
// closed roots via the live DOM tree: they walk every element on the page
// and probe the WeakMap with the host as the key. No iteration over the map
// itself is required, so we never need a strong-ref handle to hosts.
function patchWindow(win) {
  if (!win || win.__percyPreflightActive) return;
  win.__percyPreflightActive = true;

  // Intercept closed shadow roots.
  let closedShadowRoots = new WeakMap();
  let origAttachShadow = win.Element.prototype.attachShadow;
  win.Element.prototype.attachShadow = function(init) {
    let root = origAttachShadow.apply(this, arguments);
    if (init && init.mode === 'closed') {
      closedShadowRoots.set(this, root);
    }
    return root;
  };
  win.__percyClosedShadowRoots = closedShadowRoots;

  // Intercept ElementInternals for :state() capture
  if (typeof win.HTMLElement.prototype.attachInternals === 'function') {
    let internalsMap = new WeakMap();
    let origAttachInternals = win.HTMLElement.prototype.attachInternals;
    win.HTMLElement.prototype.attachInternals = function() {
      let internals = origAttachInternals.apply(this, arguments);
      internalsMap.set(this, internals);
      return internals;
    };
    win.__percyInternals = internalsMap;
  }
}

function registerPreflight() {
  if (Cypress.__percyPreflightRegistered) return false;
  Cypress.__percyPreflightRegistered = true;
  Cypress.on('window:before:load', patchWindow);

  // Cypress.on('window:before:load') only fires on subsequent navigations.
  // The first AUT page is already loaded when `support/e2e.js` requires
  // this module, so it would otherwise miss closed-shadow / internals
  // capture for closed roots created on the initial page. Patch the
  // current window synchronously to cover it.
  /* istanbul ignore next: cy.state availability and a thrown getter are
     both edge-cases of Cypress initialization; the branches are guarded
     here so the SDK never crashes the runner, but they're not reachable
     from a normal browser test. */
  try {
    let initialWin = typeof cy !== 'undefined' && cy.state ? cy.state('window') : null;
    if (initialWin) patchWindow(initialWin);
  } catch (e) {
    // cy.state may not be available during very early init — that's fine,
    // window:before:load will handle the first real navigation.
  }
  return true;
}
registerPreflight();

utils.percy.address = getEnvValue('PERCY_SERVER_ADDRESS');

// Cookie names that commonly hold session/auth secrets. These are stripped from
// snapshot payloads by default so credentials don't leave the tester's trust
// boundary (CWE-613/CWE-532). Set Cypress config `percyForwardAllCookies: true`
// to restore the previous behaviour of forwarding the full cookie jar.
const SENSITIVE_COOKIE_PATTERN = /session|token|auth|sid|jwt|bearer|csrf|xsrf/i;

function filterSensitiveCookies(cookies) {
  let forwardAll = false;
  try {
    forwardAll = Cypress.config('percyForwardAllCookies') === true;
  } catch (e) {
    forwardAll = false;
  }
  if (forwardAll || !Array.isArray(cookies)) return cookies;
  return cookies.filter(cookie => !SENSITIVE_COOKIE_PATTERN.test(cookie?.name || ''));
}

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

function resolveIgnoreSelectors(options) {
  return normalizeIgnoreSelectors(
    options.ignoreIframeSelectors ??
      utils.percy?.config?.snapshot?.ignoreIframeSelectors
  );
}

// Cypress runs in the same browser window as the AUT and is blocked by the
// browser's same-origin policy from reading cross-origin iframe content from
// JS. We walk the top-level document only and emit a corsIframes entry for
// every cross-origin iframe with a percyElementId; the entry's snapshot stays
// null whenever the browser blocks access (which is the common case for true
// cross-origin frames). The null-snapshot filter then drops those entries
// before they go on the wire.
//
// Capture works ONLY when the browser does not block contentDocument access
// — typically same-origin-misclassified frames (e.g. about: trickery, or
// frames that share a registrable domain after document.domain manipulation).
// True cross-origin frames (different origin in the strict sense) cannot be
// captured from Cypress; the contentDocument access throws SecurityError and
// the entry is dropped. Supporting those would require a postMessage bridge
// with a listener injected into the frame at preflight time, which the
// Cypress harness cannot guarantee for third-party frames. Users who need
// full CORS frame capture should reach for percy-playwright or percy-
// puppeteer where the framework can address frames out-of-process.
//
// Nested cross-origin iframes (cross-origin within cross-origin) share the
// same limitation: even if we walked into the parent JS-side, the browser
// would block reading the grandchild's content the same way.
function processCrossOriginIframes(dom, domSnapshot, options, percyDOMScript) {
  const log = utils.logger('cypress');
  const ignoreSelectors = resolveIgnoreSelectors(options);
  try {
    const currentUrl = new URL(dom.URL);
    const processedFrames = [];

    for (const iframe of dom.querySelectorAll('iframe')) {
      // Per-element opt-out via data-percy-ignore attribute.
      if (iframe.hasAttribute('data-percy-ignore')) {
        log.debug('Skipping iframe marked with data-percy-ignore');
        continue;
      }
      // Per-snapshot opt-out via ignoreIframeSelectors option / config.
      if (ignoreSelectors.length) {
        let skipBySelector = false;
        for (const sel of ignoreSelectors) {
          try { if (iframe.matches(sel)) { skipBySelector = true; break; } } catch (e) { /* invalid */ }
        }
        if (skipBySelector) {
          log.debug('Skipping iframe matching ignoreIframeSelectors');
          continue;
        }
      }

      const src = iframe.getAttribute('src');
      const srcdoc = iframe.getAttribute('srcdoc');
      if (srcdoc || isUnsupportedIframeSrc(src ? src.toLowerCase() : '')) continue;

      let frameUrl;
      try {
        frameUrl = new URL(src, currentUrl.href);
      } catch (e) {
        log.debug(`Skipping iframe "${src}": ${e.message}`);
        continue;
      }
      if (frameUrl.origin === currentUrl.origin) continue;

      const percyElementId = iframe.getAttribute('data-percy-element-id');
      if (!percyElementId) {
        log.debug(`Skipping cross-origin iframe ${frameUrl.href}: no data-percy-element-id`);
        continue;
      }

      let iframeSnapshot = null;
      try {
        // contentWindow / contentDocument property access itself throws
        // SecurityError on true cross-origin frames (Blink throws on the
        // getter, not on a downstream property read). Wrap both accesses so
        // we degrade to iframeSnapshot=null and let the post-filter drop the
        // entry — instead of bubbling the throw and losing every same-origin
        // frame after it in the same loop iteration.
        const frameWindow = iframe.contentWindow;
        const frameDocument = iframe.contentDocument || (frameWindow && frameWindow.document);
        if (frameDocument && frameWindow) {
          if (!frameWindow.PercyDOM) {
            // Inject PercyDOM into the frame so its serialize() runs with
            // the frame's own Element/Document prototypes. Done as a <script>
            // element so the script executes in the frame's global scope —
            // calling frameWindow.eval() would still evaluate in the runner
            // global on most browsers.
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
    }

    // Drop entries whose snapshot couldn't be captured (true cross-origin
    // iframes that browser security blocks Cypress from reading). The CLI
    // would discard them on validation anyway; filtering here saves wire size
    // on pages with many ad/tracker iframes.
    const usableFrames = processedFrames.filter(f => f.iframeSnapshot && f.iframeSnapshot.html);
    const dropped = processedFrames.length - usableFrames.length;
    if (dropped > 0) {
      log.debug(`Dropping ${dropped} cross-origin iframe(s) with unreachable content (browser security)`);
    }
    if (usableFrames.length > 0) {
      domSnapshot.corsIframes = usableFrames;
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
  // fetchPercyDOM hits /percy/dom.js. A transient failure there shouldn't
  // throw the whole test — fall through with a null script so the snapshot
  // path quietly skips and downstream tests don't blow up because Cypress
  // turned an unhandled rejection into a test failure.
  let percyDOMScript = null;
  try {
    percyDOMScript = await utils.fetchPercyDOM();
  } catch (e) {
    log.debug(`fetchPercyDOM failed for "${name}": ${e.message}`);
  }
  return { skip: false, percyDOMScript };
}

// Inject the PercyDOM serializer INTO the AUT window so it walks the AUT
// document with the AUT's own document/HTMLElement constructors. Running
// PercyDOM in the runner window and passing `dom: aut_doc` loses cross-window
// state (shadow roots get dropped during cloneNode because clone.attachShadow
// has to happen with the AUT document's element prototype).
function injectPercyDOM(targetWin, percyDOMScript) {
  if (targetWin.PercyDOM) return;
  // Inject via a <script> element appended to the target document. Browsers
  // evaluate inline scripts in the global scope of the document that owns
  // them, so `PercyDOM` ends up on `targetWin` even when the caller lives in
  // a different window/realm (which is the case for Cypress: the SDK code
  // runs in the runner window, the page lives in the AUT iframe). We avoid
  // `targetWin.eval(...)` because indirect eval still runs in the caller's
  // global scope, which would land `PercyDOM` on the runner.
  const script = targetWin.document.createElement('script');
  script.textContent = percyDOMScript;
  targetWin.document.head.appendChild(script);
  targetWin.document.head.removeChild(script);
}

// The preflight (window:before:load) collects:
//   • `__percyClosedShadowRoots`: WeakMap<host, ShadowRoot> for closed roots
//   • `__percyInternals`:          WeakMap<host, ElementInternals>
// We expose these on the AUT window so @percy/dom (running inside the AUT)
// can consume them during serialization. The SDK's job stops at "give the
// serializer everything it needs"; turning that data into snapshot HTML is
// the CLI's responsibility (in @percy/dom). Once @percy/dom reads from these
// hooks, closed shadow + ElementInternals show up in the snapshot
// automatically — no DOM mutation needed here.

Cypress.Commands.add('percySnapshot', (name, options = {}) => {
  const log = utils.logger('cypress');

  lazyResolveAddress(log);

  if (typeof name === 'object') {
    options = name;
    name = undefined;
  }
  name = name || cy.state('runnable').fullTitle();

  // `readiness` is consumed locally by the SDK; the CLI already gets it from
  // .percy.yml healthcheck. Strip it so it doesn't leak into serialize() args
  // or round-trip back through postSnapshot.
  const { readiness: _readiness, ...forwardOpts } = options;

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
    const mergedCaptureOptions = utils.mergeSnapshotOptions(options);
    const defaultHeight = useMinHeight
      ? (mergedCaptureOptions.minHeight || originalHeight)
      : originalHeight;

    /* istanbul ignore next: legacy alias RESPONSIVE_CAPTURE_SLEEP_TIME is
       only consulted when the newer PERCY_RESPONSIVE_CAPTURE_SLEEP_TIME is
       unset; we cover the new var elsewhere and don't bother flipping env
       vars to exercise the fallback. */
    const rawSleepTime = _isResponsive
      ? (getEnvValue('PERCY_RESPONSIVE_CAPTURE_SLEEP_TIME') || getEnvValue('RESPONSIVE_CAPTURE_SLEEP_TIME'))
      : null;
    const sleepMs = rawSleepTime ? parseInt(rawSleepTime, 10) * 1000 : 0;

    let lastWindowWidth = originalWidth;
    let lastWindowHeight = defaultHeight;

    for (let { /* istanbul ignore next: destructuring default */ width, height } of widthHeights) {
      height = height || defaultHeight;

      // Resize viewport only when dimensions change (skip redundant resizes).
      /* istanbul ignore next: the short-circuit branch where width changes
         but height stays equal isn't reachable from our fixtures — height
         is always recomputed from defaultHeight when CLI doesn't supply
         one, so width changes drag height with them. */
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

      // Serialize DOM and collect snapshot. PercyDOM must run inside the AUT
      // window so it sees the page's document/Element prototypes — running
      // it in the runner window and passing `dom: aut_doc` would drop shadow
      // roots during cross-window cloneNode.
      cy.document({ log: false }).then(async doc => {
        if (_skip || !_percyDOMScript) return;
        const appWin = doc.defaultView;
        /* istanbul ignore next: doc.defaultView is null only for detached
           documents (e.g. an iframe removed from the tree). cy.document()
           hands back the live AUT document, which always has a window. */
        if (!appWin) return;

        // Inject + run PercyDOM in the app-under-test realm (appWin =
        // doc.defaultView), NOT the Cypress spec/runner frame. waitForReady
        // takes no document argument and queries the ambient `document`;
        // injecting via spec-realm eval made every readiness check observe the
        // runner frame instead of the app (readySelectors timed out, the other
        // checks silently no-op'd). serialize was unaffected only because it's
        // passed `dom: doc` explicitly.
        injectPercyDOM(appWin, _percyDOMScript);

        // Capture a stable PercyDOM reference from the AUT window: the page
        // can reassign PercyDOM across the await below (e.g. on cy.reload in
        // the responsive loop), so re-reading after the await is a footgun.
        const PercyDOM = appWin.PercyDOM;

        // injectPercyDOM appends an inline <script> to run the serializer in
        // the AUT realm. On an AUT served with a strict Content-Security-Policy
        // (no 'unsafe-inline' for script-src) the browser blocks that inline
        // script, so it never executes and PercyDOM stays undefined. Calling
        // PercyDOM.serialize() here would throw OUTSIDE any withLog/try guard
        // and fail the whole test. Degrade gracefully instead: log a warning
        // and skip this snapshot, matching the other disabled/skip paths.
        if (!PercyDOM || typeof PercyDOM.serialize !== 'function') {
          log.warn(`Percy is unable to inject its DOM serializer into the page for "${name}" ` +
            '(this usually means a strict Content-Security-Policy blocked the inline script). ' +
            'Skipping snapshot.');
          cylog('Snapshot skipped: DOM serializer unavailable (possible CSP restriction)', { name });
          return;
        }

        // Readiness gate. The package.json floor pins @percy/sdk-utils to
        // 1.31.15-beta.0+, so isReadinessDisabled / getReadinessConfig are
        // always present. Older CLI bundles may still lack
        // PercyDOM.waitForReady — that typeof guard remains the backward-
        // compat path on the @percy/dom side.
        let readinessDiagnostics;
        const waitForReady = PercyDOM?.waitForReady;
        if (!utils.isReadinessDisabled(options) && typeof waitForReady === 'function') {
          const readinessConfig = utils.getReadinessConfig(options);
          try {
            readinessDiagnostics = await waitForReady.call(PercyDOM, readinessConfig);
          } catch (e) {
            log.debug(`waitForReady failed, proceeding to serialize: ${e?.message || e}`);
          }
        }

        // Merge .percy.yml config options with snapshot options (snapshot options take priority).
        // forwardOpts has the SDK-local `readiness` key already stripped.
        const mergedOptions = utils.mergeSnapshotOptions(forwardOpts);
        // Normalize ignoreIframeSelectors before handing it to PercyDOM.
        // @percy/dom does `selectors.length && selectors.some(...)`, which
        // crashes when the caller passes a string (string has .length but
        // not .some). Our local shim already normalizes for the SDK-side
        // iframe walk; do it once more for PercyDOM's own walk.
        const serializeOpts = {
          ...mergedOptions,
          ignoreIframeSelectors: resolveIgnoreSelectors(options),
          dom: doc
        };
        const domSnapshot = PercyDOM.serialize(serializeOpts);

        // Attach readiness diagnostics so the CLI can log timing and pass/fail.
        // Defensive: serialize() may return non-object in legacy @percy/dom builds.
        if (readinessDiagnostics && typeof domSnapshot === 'object' && domSnapshot !== null) {
          domSnapshot.readiness_diagnostics = readinessDiagnostics;
        }
        if (width !== null) domSnapshot.width = width;

        processCrossOriginIframes(doc, domSnapshot, mergedOptions, _percyDOMScript);
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

    cy.getCookies({ log: false }).then(rawCookies => {
      const cookies = filterSensitiveCookies(rawCookies);
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
              ...forwardOpts,
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

// Exported for direct unit testing of branches that can't be reached
// through the Cypress command queue. Tests must reach the same module
// instance the SDK uses — Cypress spec bundling may produce a separate
// `@percy/sdk-utils` instance for the test file, so mutating
// utils.percy.config from the spec doesn't reach the SDK's `utils`.
// `__getShimForTesting` returns the `@percy/sdk-utils` instance index.js
// itself captured at module load, so tests can
// drive branches that key off utils.percy / utils.getResponsiveWidths
// without round-tripping through the healthcheck.
module.exports = {
  createRegion,
  registerPreflight,
  isResponsiveDOMCaptureValid,
  filterSensitiveCookies,
  /* istanbul ignore next: test-only escape hatch */
  __getShimForTesting: () => utils
};
