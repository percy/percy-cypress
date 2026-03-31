import helpers from '@percy/sdk-utils/test/helpers';
import { createRegion } from '../../createRegion';

const { match } = Cypress.sinon;

describe('percySnapshot', () => {
  beforeEach(() => {
    cy.then(helpers.setupTest);
    cy.visit(helpers.testSnapshotURL);
    cy.wrap(cy.spy(Cypress, 'log').log(false)).as('log');
  });

  describe('Environment Configuration', () => {
    let originalEnv;
    let originalExpose;

    beforeEach(() => {
      originalEnv = Cypress.env;
      originalExpose = Cypress.expose;
    });

    afterEach(() => {
      if (originalEnv) {
        Cypress.env = originalEnv;
      }
      if (originalExpose) {
        Cypress.expose = originalExpose;
      } else {
        delete Cypress.expose;
      }
    });

    it('uses Cypress.expose() when available', () => {
      const utils = require('@percy/sdk-utils');
      const testAddress = 'http://test-expose-address:5338';

      Cypress.expose = cy.stub().withArgs('PERCY_SERVER_ADDRESS').returns(testAddress);

      cy.wrap(null).then(() => {
        if (typeof Cypress.expose === 'function') {
          const addr = Cypress.expose('PERCY_SERVER_ADDRESS');
          if (addr) utils.percy.address = addr;
        }

        expect(Cypress.expose).to.be.calledWith('PERCY_SERVER_ADDRESS');
        expect(utils.percy.address).to.equal(testAddress);
      });
    });

    it('does not set address when Cypress.expose() returns null/undefined', () => {
      const utils = require('@percy/sdk-utils');
      const originalAddress = utils.percy.address;

      Cypress.expose = cy.stub().withArgs('PERCY_SERVER_ADDRESS').returns(undefined);

      cy.wrap(null).then(() => {
        if (typeof Cypress.expose === 'function') {
          const addr = Cypress.expose('PERCY_SERVER_ADDRESS');
          if (addr) utils.percy.address = addr;
        }

        expect(Cypress.expose).to.be.calledWith('PERCY_SERVER_ADDRESS');
        expect(utils.percy.address).to.equal(originalAddress);
      });
    });
  });

  it('disables snapshots when the healthcheck fails', () => {
    cy.then(() => helpers.test('error', '/percy/healthcheck'));

    cy.percySnapshot();
    cy.percySnapshot('Snapshot 2');

    cy.then(() => helpers.logger.stdout).should('include.members', [
      '[percy] Percy is not running, disabling snapshots'
    ]);
  });

  it('posts snapshots to the local percy server', () => {
    cy.percySnapshot();
    cy.percySnapshot('Snapshot 2');

    cy.then(() => helpers.get('logs'))
      .should('include', `Snapshot found: ${cy.state('runnable').fullTitle()}`)
      .should('include', `- url: ${helpers.testSnapshotURL}`)
      .should('include.match', /clientInfo: @percy\/cypress\/.+/)
      .should('include.match', /environmentInfo: cypress\/.+/)
      .should('include', 'Snapshot found: Snapshot 2');
  });

  it('works with with only options passed', () => {
    cy.percySnapshot({ enableJavascript: true });

    cy.then(() => helpers.get('logs'))
      .should('include', `Snapshot found: ${cy.state('runnable').fullTitle()}`)
      .should('include', `- url: ${helpers.testSnapshotURL}`)
      .should('include.match', /clientInfo: @percy\/cypress\/.+/)
      .should('include.match', /environmentInfo: cypress\/.+/);
  });

  it('handles snapshot failures', () => {
    cy.then(() => helpers.test('error', '/percy/snapshot'));

    cy.percySnapshot();

    cy.then(() => helpers.logger.stderr).should('include.members', [
      '[percy] Got error while posting dom snapshot',
      '[percy] Error: testing'
    ]);
  });

  describe('if percyThrowErrorOnFailure set to true', () => {
    let ogPercyThrowErrorOnFailure;

    beforeEach(() => {
      ogPercyThrowErrorOnFailure = Cypress.config('percyThrowErrorOnFailure');
    });

    afterEach(() => {
      Cypress.config().percyThrowErrorOnFailure = ogPercyThrowErrorOnFailure;
    });

    it('disables snapshots and fails the test', () => {
      cy.on('fail', (_err, runnable) => {
        return false;
      });

      Cypress.config().percyThrowErrorOnFailure = true;
      cy.then(() => helpers.test('error', '/percy/snapshot'));

      cy.percySnapshot();

      cy.then(() => helpers.logger.stderr).should('include.members', [
        '[percy] Could not take DOM snapshot "percySnapshot handles snapshot failures"'
      ]);
    });
  });

  describe('in interactive mode', () => {
    let ogInteractive;

    beforeEach(() => {
      ogInteractive = Cypress.config('isInteractive');
    });

    afterEach(() => {
      Cypress.config().isInteractive = ogInteractive;
    });

    it('disables snapshots', () => {
      Cypress.config().isInteractive = true;
      cy.percySnapshot('Snapshot name');

      cy.get('@log').should((spy) => {
        expect(spy).to.be.calledWith(
          match({
            name: 'percySnapshot',
            displayName: 'percy',
            message: 'Disabled in interactive mode'
          })
        );
      });
    });
  });

  describe('withRetry Function Test', () => {
    const withRetry = (func) => {
      let attempt = 1;
      const maxAttempts = 3;
      const sleepTime = 1000;

      const tryFunction = () => {
        return func().catch((error) => {
          if (attempt < maxAttempts) {
            cy.log(`Retrying... (${attempt}/${maxAttempts})`);
            attempt += 1;
            return new Cypress.Promise((resolve) =>
              setTimeout(() => resolve(tryFunction()), sleepTime)
            );
          }
          throw error;
        });
      };

      return tryFunction();
    };

    it('should succeed after retries', () => {
      let failureCount = 0;
      const mockFunction = () => {
        return new Cypress.Promise((resolve, reject) => {
          if (failureCount < 2) {
            failureCount += 1;
            reject(new Error('Mock error'));
          } else {
            resolve('Success');
          }
        });
      };

      cy.wrap(null).then(() => {
        return withRetry(mockFunction).then((result) => {
          expect(result).to.equal('Success');
        });
      });
    });

    it('should fail after max retries', () => {
      const alwaysFailingFunction = () => {
        return new Cypress.Promise((resolve, reject) => {
          reject(new Error('Mock error'));
        });
      };

      cy.wrap(null).then(() => {
        return withRetry(alwaysFailingFunction).then(
          () => {
            throw new Error('Test should have failed but succeeded');
          },
          (error) => {
            expect(error.message).to.equal('Mock error');
          }
        );
      });
    });

    it('should call withLog and retry with withRetry thrice on postSnapshot failure', () => {
      let retryCount = 0;
      const utils = require('@percy/sdk-utils');

      cy.stub(utils, 'postSnapshot').callsFake(() => {
        retryCount += 1;
        return Cypress.Promise.reject(new Error('postSnapshot failed'));
      });

      const withLog = (func, context, _throw = true) => {
        return func().catch((error) => {
          if (_throw) throw error;
          return error;
        });
      };

      const withRetryAndLog = (func) => {
        return withRetry(() => withLog(func, 'posting dom snapshot'));
      };

      cy.wrap(null).then(() => {
        return withRetryAndLog(utils.postSnapshot).catch((error) => {
          expect(error.message).to.equal('postSnapshot failed');
          expect(retryCount).to.equal(3);
        });
      });
    });
  });

  describe('createRegion function', () => {
    it('creates a region object with default values', () => {
      const region = createRegion();
      expect(region).to.deep.equal({ algorithm: 'ignore', elementSelector: {} });
    });

    it('creates a region object with provided values', () => {
      const region = createRegion({ boundingBox: { x: 10, y: 20, width: 100, height: 200 }, algorithm: 'standard' });
      expect(region).to.deep.equal({
        algorithm: 'standard',
        elementSelector: { boundingBox: { x: 10, y: 20, width: 100, height: 200 } }
      });
    });

    it('adds configuration properties when using standard or intelliignore', () => {
      const region = createRegion({ algorithm: 'standard', diffSensitivity: 0.5 });
      expect(region).to.have.property('configuration');
      expect(region.configuration).to.deep.equal({ diffSensitivity: 0.5 });
    });

    it('adds assertion properties if diffIgnoreThreshold is provided', () => {
      const region = createRegion({ diffIgnoreThreshold: 0.1 });
      expect(region).to.have.property('assertion');
      expect(region.assertion).to.deep.equal({ diffIgnoreThreshold: 0.1 });
    });

    it('includes padding when provided', () => {
      const region = createRegion({ padding: { top: 10 } });
      expect(region).to.have.property('padding').that.deep.equals({ top: 10 });
    });

    it('includes configuration when algorithm is standard', () => {
      const region = createRegion({ algorithm: 'standard', diffSensitivity: 5 });
      expect(region.configuration.diffSensitivity).to.equal(5);
    });

    it('includes configuration when algorithm is intelliignore', () => {
      const region = createRegion({ algorithm: 'intelliignore', imageIgnoreThreshold: 0.2 });
      expect(region.configuration.imageIgnoreThreshold).to.equal(0.2);
    });

    it('does not include configuration for ignore algorithm', () => {
      const region = createRegion({ algorithm: 'ignore', diffSensitivity: 5 });
      expect(region.configuration).to.be.undefined;
    });

    it('sets elementXpath in elementSelector', () => {
      const region = createRegion({ elementXpath: "//div[@id='test']" });
      expect(region.elementSelector.elementXpath).to.equal("//div[@id='test']");
    });

    it('sets elementCSS in elementSelector', () => {
      const region = createRegion({ elementCSS: '.test-class' });
      expect(region.elementSelector.elementCSS).to.equal('.test-class');
    });
  });

  it('includes carouselsEnabled in configuration if provided', () => {
    const region = createRegion({ algorithm: 'standard', carouselsEnabled: true });
    expect(region).to.have.property('configuration');
    expect(region.configuration).to.have.property('carouselsEnabled', true);
  });

  it('includes bannersEnabled in configuration if provided', () => {
    const region = createRegion({ algorithm: 'standard', bannersEnabled: true });
    expect(region).to.have.property('configuration');
    expect(region.configuration).to.have.property('bannersEnabled', true);
  });

  it('includes adsEnabled in configuration if provided', () => {
    const region = createRegion({ algorithm: 'standard', adsEnabled: true });
    expect(region).to.have.property('configuration');
    expect(region.configuration).to.have.property('adsEnabled', true);
  });

  describe('crossOriginIframes', () => {
    it('captures cross-origin iframes with accessible contentDocument', () => {
      cy.visit(helpers.testSnapshotURL);

      cy.document().then((dom) => {
        const iframe = dom.createElement('iframe');
        iframe.setAttribute('src', 'https://external.example.com/page');
        iframe.setAttribute('data-percy-element-id', 'iframe-abc123');
        dom.body.appendChild(iframe);

        const mockDoc = dom.implementation.createHTMLDocument('iframe');
        mockDoc.body.innerHTML = '<h1>Cross-origin content</h1>';

        const mockSerializeResult = { html: '<html><body><h1>Cross-origin content</h1></body></html>' };

        const mockWindow = {
          PercyDOM: {
            serialize: cy.stub().returns(mockSerializeResult)
          }
        };

        Object.defineProperty(iframe, 'contentDocument', { value: mockDoc, configurable: true });
        Object.defineProperty(iframe, 'contentWindow', { value: mockWindow, configurable: true });

        const iframes = dom.querySelectorAll('iframe[src="https://external.example.com/page"]');
        expect(iframes.length).to.equal(1);

        expect(iframes[0].getAttribute('data-percy-element-id')).to.equal('iframe-abc123');
        expect(iframes[0].contentDocument).to.not.be.null;
        expect(iframes[0].contentWindow.PercyDOM).to.not.be.undefined;

        dom.body.removeChild(iframe);
      });
    });

    it('attaches corsIframes to domSnapshot when cross-origin iframes exist', () => {
      cy.visit(helpers.testSnapshotURL);

      cy.document().then((dom) => {
        const iframe = dom.createElement('iframe');
        iframe.setAttribute('src', 'https://external.example.com/page');
        iframe.setAttribute('data-percy-element-id', 'iframe-test-id');
        dom.body.appendChild(iframe);

        const mockDoc = dom.implementation.createHTMLDocument('iframe');
        mockDoc.body.innerHTML = '<p>External content</p>';
        const mockSerializeResult = { html: '<html><body><p>External content</p></body></html>' };

        Object.defineProperty(iframe, 'contentDocument', { value: mockDoc, configurable: true });
        Object.defineProperty(iframe, 'contentWindow', {
          value: {
            PercyDOM: { serialize: cy.stub().returns(mockSerializeResult) }
          },
          configurable: true
        });

        cy.percySnapshot('Cross-origin iframe test');

        dom.body.removeChild(iframe);
      });

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Cross-origin iframe test');
    });

    it('skips iframes with about:blank src', () => {
      cy.visit(helpers.testSnapshotURL);

      cy.document().then((dom) => {
        const iframe = dom.createElement('iframe');
        iframe.setAttribute('src', 'about:blank');
        iframe.setAttribute('data-percy-element-id', 'iframe-blank');
        dom.body.appendChild(iframe);

        cy.percySnapshot('Skip about:blank iframe');

        dom.body.removeChild(iframe);
      });

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Skip about:blank iframe');
    });

    it('skips iframes with javascript: src', () => {
      cy.visit(helpers.testSnapshotURL);

      cy.document().then((dom) => {
        const iframe = dom.createElement('iframe');
        iframe.setAttribute('src', 'javascript:void(0)');
        iframe.setAttribute('data-percy-element-id', 'iframe-js');
        dom.body.appendChild(iframe);

        cy.percySnapshot('Skip javascript iframe');

        dom.body.removeChild(iframe);
      });

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Skip javascript iframe');
    });

    it('skips iframes with data: src', () => {
      cy.visit(helpers.testSnapshotURL);

      cy.document().then((dom) => {
        const iframe = dom.createElement('iframe');
        iframe.setAttribute('src', 'data:text/html,<h1>test</h1>');
        iframe.setAttribute('data-percy-element-id', 'iframe-data');
        dom.body.appendChild(iframe);

        cy.percySnapshot('Skip data iframe');

        dom.body.removeChild(iframe);
      });

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Skip data iframe');
    });

    it('skips iframes with srcdoc attribute', () => {
      cy.visit(helpers.testSnapshotURL);

      cy.document().then((dom) => {
        const iframe = dom.createElement('iframe');
        iframe.setAttribute('src', 'https://external.example.com/page');
        iframe.setAttribute('srcdoc', '<h1>Inline content</h1>');
        iframe.setAttribute('data-percy-element-id', 'iframe-srcdoc');
        dom.body.appendChild(iframe);

        cy.percySnapshot('Skip srcdoc iframe');

        dom.body.removeChild(iframe);
      });

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Skip srcdoc iframe');
    });

    it('handles SecurityError when iframe access is blocked', () => {
      cy.visit(helpers.testSnapshotURL);

      cy.document().then((dom) => {
        const iframe = dom.createElement('iframe');
        iframe.setAttribute('src', 'https://external.example.com/blocked');
        iframe.setAttribute('data-percy-element-id', 'iframe-blocked');
        dom.body.appendChild(iframe);

        Object.defineProperty(iframe, 'contentDocument', {
          get: () => { throw new DOMException('Blocked by CORS', 'SecurityError'); },
          configurable: true
        });

        cy.percySnapshot('SecurityError iframe');

        dom.body.removeChild(iframe);
      });

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: SecurityError iframe');
    });

    it('skips same-origin iframes', () => {
      cy.visit(helpers.testSnapshotURL);

      cy.document().then((dom) => {
        const currentOrigin = new URL(dom.URL).origin;
        const iframe = dom.createElement('iframe');
        iframe.setAttribute('src', `${currentOrigin}/some-page`);
        iframe.setAttribute('data-percy-element-id', 'iframe-same-origin');
        dom.body.appendChild(iframe);

        cy.percySnapshot('Same-origin iframe skipped');

        dom.body.removeChild(iframe);
      });

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Same-origin iframe skipped');
    });

    it('skips iframes without src attribute', () => {
      cy.visit(helpers.testSnapshotURL);

      cy.document().then((dom) => {
        const iframe = dom.createElement('iframe');
        iframe.setAttribute('data-percy-element-id', 'iframe-no-src');
        dom.body.appendChild(iframe);

        cy.percySnapshot('No src iframe');

        dom.body.removeChild(iframe);
      });

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: No src iframe');
    });

    it('skips iframes with blob: src', () => {
      cy.visit(helpers.testSnapshotURL);

      cy.document().then((dom) => {
        const iframe = dom.createElement('iframe');
        iframe.setAttribute('src', 'blob:https://example.com/some-blob');
        iframe.setAttribute('data-percy-element-id', 'iframe-blob');
        dom.body.appendChild(iframe);

        cy.percySnapshot('Skip blob iframe');

        dom.body.removeChild(iframe);
      });

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Skip blob iframe');
    });
  });

  describe('New Feature Tests', () => {
    it('supports minHeight option', () => {
      cy.percySnapshot('Min Height Test', { minHeight: 2000 });

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Min Height Test');
    });

    it('supports sync option', () => {
      cy.percySnapshot('Sync Test', { sync: true });

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Sync Test');
    });

    it('supports percyCSS option', () => {
      cy.percySnapshot('Percy CSS Test', { percyCSS: 'body { background: red; }' });

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Percy CSS Test');
    });

    it('supports percyCSS for freezing animations', () => {
      cy.percySnapshot('Freeze Animation Test', { percyCSS: 'img { animation: none !important; }' });

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Freeze Animation Test');
    });

    it('supports percyCSS for freezing specific elements', () => {
      cy.percySnapshot('Freeze By Selector Test', {
        percyCSS: '.animated-image { animation: none !important; }'
      });

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Freeze By Selector Test');
    });

    it('captures cookies in snapshots', () => {
      cy.setCookie('test_cookie', 'test_value');
      cy.setCookie('another_cookie', 'another_value');

      cy.getCookies().should('have.length', 2);

      cy.percySnapshot('Cookie Capture Test');

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Cookie Capture Test');
    });

    it('handles snapshots with no cookies', () => {
      cy.clearCookies();
      cy.getCookies().should('have.length', 0);
      cy.percySnapshot('No Cookie Test');
      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: No Cookie Test');
    });
  });

  describe('responsiveSnapshotCapture', () => {
    it('posts snapshot with responsiveSnapshotCapture option enabled', () => {
      cy.percySnapshot('Responsive Capture Test', {
        responsiveSnapshotCapture: true,
        widths: [375, 1280]
      });

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Responsive Capture Test');
    });

    it('posts snapshot with responsive_snapshot_capture (snake_case) option enabled', () => {
      cy.percySnapshot('Responsive Snake Case Test', {
        responsive_snapshot_capture: true,
        widths: [375]
      });

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Responsive Snake Case Test');
    });

    it('falls back to normal capture when responsiveSnapshotCapture is false', () => {
      cy.percySnapshot('Non-Responsive Test', {
        responsiveSnapshotCapture: false
      });

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Non-Responsive Test');
    });

    it('disables responsive capture when deferUploads is true', () => {
      const utils = require('@percy/sdk-utils');
      const originalConfig = utils.percy?.config;

      cy.wrap(null).then(() => {
        utils.percy.config = { percy: { deferUploads: true }, snapshot: { responsiveSnapshotCapture: true } };
      });

      cy.percySnapshot('DeferUploads Disabled Test', {
        responsiveSnapshotCapture: true,
        widths: [375]
      });

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: DeferUploads Disabled Test');

      cy.wrap(null).then(() => {
        if (originalConfig) {
          utils.percy.config = originalConfig;
        } else {
          delete utils.percy.config;
        }
      });
    });

    it('falls back to standard capture when deferUploads disables responsive', () => {
      const utils = require('@percy/sdk-utils');
      const originalConfig = utils.percy?.config;

      cy.wrap(null).then(() => {
        utils.percy.config = { percy: { deferUploads: true }, snapshot: { responsiveSnapshotCapture: true } };
      });

      cy.percySnapshot('DeferUploads Fallback Test', {
        responsiveSnapshotCapture: true,
        widths: [375]
      });

      // When deferUploads disables responsive capture, a standard snapshot is still taken
      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: DeferUploads Fallback Test');

      cy.wrap(null).then(() => {
        if (originalConfig) {
          utils.percy.config = originalConfig;
        } else {
          delete utils.percy.config;
        }
      });
    });

    it('uses responsiveSnapshotCapture from percy config when not in options', () => {
      const utils = require('@percy/sdk-utils');
      const originalConfig = utils.percy?.config;

      cy.wrap(null).then(() => {
        utils.percy.config = { snapshot: { responsiveSnapshotCapture: true } };
      });

      cy.percySnapshot('Config Responsive Test', {
        widths: [375]
      });

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Config Responsive Test');

      cy.wrap(null).then(() => {
        if (originalConfig) {
          utils.percy.config = originalConfig;
        } else {
          delete utils.percy.config;
        }
      });
    });

    it('captures DOM at multiple widths and attaches width to each snapshot', () => {
      cy.percySnapshot('Multi Width Test', {
        responsiveSnapshotCapture: true,
        widths: [375, 768, 1280]
      });

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Multi Width Test');
    });

    it('restores original document width after responsive capture', () => {
      cy.document().then((dom) => {
        const originalWidth = dom.documentElement.style.width;

        cy.percySnapshot('Restore Width Test', {
          responsiveSnapshotCapture: true,
          widths: [375, 1280]
        });

        cy.document().then((domAfter) => {
          expect(domAfter.documentElement.style.width).to.equal(originalWidth);
        });
      });
    });

    it('handles responsive capture with sleep time env var', () => {
      const originalSleepTime = Cypress.env('PERCY_RESPONSIVE_CAPTURE_SLEEP_TIME');

      Cypress.env('PERCY_RESPONSIVE_CAPTURE_SLEEP_TIME', '0');

      cy.percySnapshot('Sleep Time Test', {
        responsiveSnapshotCapture: true,
        widths: [375]
      });

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Sleep Time Test');

      cy.wrap(null).then(() => {
        if (originalSleepTime !== undefined) {
          Cypress.env('PERCY_RESPONSIVE_CAPTURE_SLEEP_TIME', originalSleepTime);
        } else {
          // Cypress.env doesn't support delete, set to undefined
          Cypress.env('PERCY_RESPONSIVE_CAPTURE_SLEEP_TIME', undefined);
        }
      });
    });

    it('handles responsive capture with RESPONSIVE_CAPTURE_SLEEP_TIME env var', () => {
      const originalSleepTime = Cypress.env('RESPONSIVE_CAPTURE_SLEEP_TIME');

      Cypress.env('RESPONSIVE_CAPTURE_SLEEP_TIME', '0');

      cy.percySnapshot('Alt Sleep Time Test', {
        responsiveSnapshotCapture: true,
        widths: [375]
      });

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Alt Sleep Time Test');

      cy.wrap(null).then(() => {
        if (originalSleepTime !== undefined) {
          Cypress.env('RESPONSIVE_CAPTURE_SLEEP_TIME', originalSleepTime);
        } else {
          Cypress.env('RESPONSIVE_CAPTURE_SLEEP_TIME', undefined);
        }
      });
    });

    it('handles responsive capture with min height env var enabled', () => {
      const originalMinHeight = Cypress.env('PERCY_RESPONSIVE_CAPTURE_MIN_HEIGHT');

      Cypress.env('PERCY_RESPONSIVE_CAPTURE_MIN_HEIGHT', 'true');

      cy.percySnapshot('Min Height Env Test', {
        responsiveSnapshotCapture: true,
        widths: [375]
      });

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Min Height Env Test');

      cy.wrap(null).then(() => {
        if (originalMinHeight !== undefined) {
          Cypress.env('PERCY_RESPONSIVE_CAPTURE_MIN_HEIGHT', originalMinHeight);
        } else {
          Cypress.env('PERCY_RESPONSIVE_CAPTURE_MIN_HEIGHT', undefined);
        }
      });
    });

    it('uses reload-based capture when PERCY_RESPONSIVE_CAPTURE_RELOAD_PAGE is enabled', () => {
      const originalReload = Cypress.env('PERCY_RESPONSIVE_CAPTURE_RELOAD_PAGE');

      Cypress.env('PERCY_RESPONSIVE_CAPTURE_RELOAD_PAGE', 'true');

      cy.percySnapshot('Reload Page Test', {
        responsiveSnapshotCapture: true,
        widths: [375, 1280]
      });

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Reload Page Test');

      cy.wrap(null).then(() => {
        if (originalReload !== undefined) {
          Cypress.env('PERCY_RESPONSIVE_CAPTURE_RELOAD_PAGE', originalReload);
        } else {
          Cypress.env('PERCY_RESPONSIVE_CAPTURE_RELOAD_PAGE', undefined);
        }
      });
    });

    it('re-injects PercyDOM after each reload during responsive capture', () => {
      const originalReload = Cypress.env('PERCY_RESPONSIVE_CAPTURE_RELOAD_PAGE');

      Cypress.env('PERCY_RESPONSIVE_CAPTURE_RELOAD_PAGE', 'true');

      cy.percySnapshot('Reload PercyDOM Reinject Test', {
        responsiveSnapshotCapture: true,
        widths: [375, 768]
      });

      // After the reload-based capture completes, PercyDOM should still be
      // available on the spec runner window (not the AUT window, which resets on reload)
      cy.wrap(null).then(() => {
        expect(window.PercyDOM).to.not.be.undefined;
      });

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Reload PercyDOM Reinject Test');

      cy.wrap(null).then(() => {
        if (originalReload !== undefined) {
          Cypress.env('PERCY_RESPONSIVE_CAPTURE_RELOAD_PAGE', originalReload);
        } else {
          Cypress.env('PERCY_RESPONSIVE_CAPTURE_RELOAD_PAGE', undefined);
        }
      });
    });

    it('does not use reload when PERCY_RESPONSIVE_CAPTURE_RELOAD_PAGE is false', () => {
      const originalReload = Cypress.env('PERCY_RESPONSIVE_CAPTURE_RELOAD_PAGE');

      Cypress.env('PERCY_RESPONSIVE_CAPTURE_RELOAD_PAGE', 'false');

      // Should use CSS-based capture (default), verify document width is restored
      cy.document().then((dom) => {
        const originalWidth = dom.documentElement.style.width;

        cy.percySnapshot('No Reload Test', {
          responsiveSnapshotCapture: true,
          widths: [375, 1280]
        });

        cy.document().then((domAfter) => {
          expect(domAfter.documentElement.style.width).to.equal(originalWidth);
        });
      });

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: No Reload Test');

      cy.wrap(null).then(() => {
        if (originalReload !== undefined) {
          Cypress.env('PERCY_RESPONSIVE_CAPTURE_RELOAD_PAGE', originalReload);
        } else {
          Cypress.env('PERCY_RESPONSIVE_CAPTURE_RELOAD_PAGE', undefined);
        }
      });
    });

    it('captures cookies after reload-based responsive capture', () => {
      const originalReload = Cypress.env('PERCY_RESPONSIVE_CAPTURE_RELOAD_PAGE');

      Cypress.env('PERCY_RESPONSIVE_CAPTURE_RELOAD_PAGE', 'true');
      cy.setCookie('reload_test_cookie', 'reload_value');

      cy.percySnapshot('Reload Cookie Test', {
        responsiveSnapshotCapture: true,
        widths: [375]
      });

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Reload Cookie Test');

      cy.wrap(null).then(() => {
        if (originalReload !== undefined) {
          Cypress.env('PERCY_RESPONSIVE_CAPTURE_RELOAD_PAGE', originalReload);
        } else {
          Cypress.env('PERCY_RESPONSIVE_CAPTURE_RELOAD_PAGE', undefined);
        }
      });
    });

    it('returns domSnapshot as array when responsive capture is enabled', () => {
      cy.percySnapshot('Array Snapshot Test', {
        responsiveSnapshotCapture: true,
        widths: [375, 1280]
      });

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Array Snapshot Test');
    });

    it('works with no widths specified when responsive capture is enabled', () => {
      cy.percySnapshot('No Widths Test', {
        responsiveSnapshotCapture: true
      });

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: No Widths Test');
    });
  });
});
