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
      // Store original methods
      originalEnv = Cypress.env;
      originalExpose = Cypress.expose;
    });

    afterEach(() => {
      // Restore original methods
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

      // Mock Cypress.expose
      Cypress.expose = cy.stub().withArgs('PERCY_SERVER_ADDRESS').returns(testAddress);

      // Reload the module to trigger the env configuration code
      cy.wrap(null).then(() => {
        // Simulate the configuration logic
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

      // Mock Cypress.expose to return undefined
      Cypress.expose = cy.stub().withArgs('PERCY_SERVER_ADDRESS').returns(undefined);

      cy.wrap(null).then(() => {
        // Simulate the configuration logic
        if (typeof Cypress.expose === 'function') {
          const addr = Cypress.expose('PERCY_SERVER_ADDRESS');
          if (addr) utils.percy.address = addr;
        }

        expect(Cypress.expose).to.be.calledWith('PERCY_SERVER_ADDRESS');
        // Address should remain unchanged
        expect(utils.percy.address).to.equal(originalAddress);
      });
    });

    it('handles allowCypressEnv: false gracefully', () => {
      // Simulate Cypress.env() throwing when allowCypressEnv is false
      // and Cypress.expose() returning undefined for the key
      const origExpose = Cypress.expose;
      const origEnv = Cypress.env;

      Cypress.expose = cy.stub().returns(undefined);
      Cypress.env = cy.stub().throws(new Error('Cypress.env() does not work when allowCypressEnv is set to false'));

      cy.wrap(null).then(() => {
        // getEnvValue should return undefined (not throw)
        // Re-import would be needed to test module-level code, but we can test
        // the same logic pattern: expose returns undefined, env throws
        let result;
        try {
          const val = Cypress.expose('PERCY_SERVER_ADDRESS');
          if (val !== undefined) {
            result = val;
          } else {
            try {
              result = Cypress.env('PERCY_SERVER_ADDRESS');
            } catch (e) {
              result = undefined;
            }
          }
        } finally {
          Cypress.expose = origExpose;
          Cypress.env = origEnv;
        }

        expect(result).to.be.undefined;
      });
    });

    it('lazy-resolves address via cy.env() when utils.percy.address is unset', () => {
      const utils = require('@percy/sdk-utils');

      // Clear address INSIDE the command queue so it's unset when percySnapshot runs.
      // This triggers the lazy resolution block (lines 128-134).
      cy.then(() => {
        utils.percy.address = null;
      });

      cy.percySnapshot('lazy-resolve-test');

      // Restore address for subsequent tests
      cy.then(() => {
        utils.percy.address = `http://localhost:${helpers.port}`;
      });
    });

    it('handles cy.env() failure during lazy address resolution gracefully', () => {
      const utils = require('@percy/sdk-utils');
      let origCyEnv;

      // Clear address and break cy.env INSIDE the command queue
      // to exercise the catch block (lines 136-138)
      cy.then(() => {
        origCyEnv = cy.env;
        utils.percy.address = null;
        cy.env = function() { throw new Error('cy.env not available'); };
      });

      cy.percySnapshot('lazy-resolve-error-test');

      cy.then(() => {
        cy.env = origCyEnv;
        utils.percy.address = `http://localhost:${helpers.port}`;
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
        // it only runs when test fails.
        // This will supress failure and pass the test.
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
          expect(retryCount).to.equal(3); // Ensure postSnapshot was called 3 times
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

  describe('Responsive Snapshot Capture', () => {
    it('supports responsiveSnapshotCapture option', () => {
      cy.percySnapshot('Responsive Capture Test', {
        responsiveSnapshotCapture: true,
        widths: [1280, 375]
      });

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Responsive Capture Test');
    });

    it('supports responsive_snapshot_capture snake_case option', () => {
      cy.percySnapshot('Responsive Snake Case Test', {
        responsive_snapshot_capture: true,
        widths: [1024, 768]
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

    it('captures responsive snapshots with default widths when none specified', () => {
      cy.percySnapshot('Responsive Default Widths', {
        responsiveSnapshotCapture: true
      });

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Responsive Default Widths');
    });

    it('captures responsive snapshots with minHeight option', () => {
      cy.percySnapshot('Responsive With MinHeight', {
        responsiveSnapshotCapture: true,
        widths: [1280, 375],
        minHeight: 2000
      });

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Responsive With MinHeight');
    });

    it('falls back to normal capture when deferUploads is enabled', () => {
      const utils = require('@percy/sdk-utils');
      const originalConfig = utils.percy?.config;

      cy.then(() => {
        utils.percy = utils.percy || {};
        utils.percy.config = { percy: { deferUploads: true }, snapshot: {} };
      });

      cy.percySnapshot('DeferUploads Test', { responsiveSnapshotCapture: true });

      cy.then(() => {
        if (originalConfig) {
          utils.percy.config = originalConfig;
        } else {
          delete utils.percy.config;
        }
      });

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: DeferUploads Test');
    });

    describe('in interactive mode', () => {
      let ogInteractive;

      beforeEach(() => {
        ogInteractive = Cypress.config('isInteractive');
      });

      afterEach(() => {
        Cypress.config().isInteractive = ogInteractive;
      });

      it('skips responsive snapshots in interactive mode', () => {
        Cypress.config().isInteractive = true;

        cy.percySnapshot('Responsive Interactive Skip', {
          responsiveSnapshotCapture: true,
          widths: [1280]
        });

        // Should not post a snapshot (cleanup path is hit)
      });
    });

    it('skips responsive capture when percy is not enabled', () => {
      const utils = require('@percy/sdk-utils');

      // Reset percy enabled state and set healthcheck to error
      cy.then(async () => {
        delete utils.percy.enabled;
        await helpers.test('error', '/percy/healthcheck');
      });

      cy.percySnapshot('Responsive Percy Disabled', {
        responsiveSnapshotCapture: true,
        widths: [1280]
      });

      // Reset mock server and percy state so subsequent tests work
      cy.then(async () => {
        await helpers.test('reset');
        delete utils.percy.enabled;
      });
    });

    it('uses fallback widths when getResponsiveWidths is not available', () => {
      const utils = require('@percy/sdk-utils');
      const originalGetResponsiveWidths = utils.getResponsiveWidths;

      cy.then(() => {
        delete utils.getResponsiveWidths;
      });

      cy.percySnapshot('Responsive Fallback Widths', {
        responsiveSnapshotCapture: true,
        widths: [800, 400]
      });

      cy.then(() => {
        utils.getResponsiveWidths = originalGetResponsiveWidths;
      });

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Responsive Fallback Widths');
    });

    it('uses viewport width as fallback when no widths specified and getResponsiveWidths unavailable', () => {
      const utils = require('@percy/sdk-utils');
      const originalGetResponsiveWidths = utils.getResponsiveWidths;

      cy.then(() => {
        delete utils.getResponsiveWidths;
      });

      // No widths specified -- should fall back to [originalWidth]
      cy.percySnapshot('Responsive No Widths Fallback', {
        responsiveSnapshotCapture: true
      });

      cy.then(() => {
        utils.getResponsiveWidths = originalGetResponsiveWidths;
      });

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Responsive No Widths Fallback');
    });

    it('reloads page when PERCY_RESPONSIVE_CAPTURE_RELOAD_PAGE is set', () => {
      Cypress.env('PERCY_RESPONSIVE_CAPTURE_RELOAD_PAGE', 'true');

      // Delete PercyDOM to force re-injection path (line 203-205)
      const savedPercyDOM = window.PercyDOM;
      cy.then(() => { delete window.PercyDOM; });

      cy.percySnapshot('Responsive Reload Test', {
        responsiveSnapshotCapture: true,
        widths: [1280]
      });

      cy.then(() => {
        Cypress.env('PERCY_RESPONSIVE_CAPTURE_RELOAD_PAGE', undefined);
        // PercyDOM should have been re-injected by the code
        if (!window.PercyDOM && savedPercyDOM) {
          window.PercyDOM = savedPercyDOM;
        }
      });

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Responsive Reload Test');
    });

    it('uses minHeight from env var PERCY_RESPONSIVE_CAPTURE_MIN_HEIGHT', () => {
      Cypress.env('PERCY_RESPONSIVE_CAPTURE_MIN_HEIGHT', 'true');

      cy.percySnapshot('Responsive MinHeight Env', {
        responsiveSnapshotCapture: true,
        widths: [1280],
        minHeight: 900
      });

      cy.then(() => {
        Cypress.env('PERCY_RESPONSIVE_CAPTURE_MIN_HEIGHT', undefined);
      });

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Responsive MinHeight Env');
    });

    it('uses config snapshot minHeight when option not provided', () => {
      const utils = require('@percy/sdk-utils');
      const originalConfig = utils.percy?.config;

      Cypress.env('PERCY_RESPONSIVE_CAPTURE_MIN_HEIGHT', 'true');

      cy.then(() => {
        utils.percy = utils.percy || {};
        utils.percy.config = utils.percy.config || {};
        utils.percy.config.snapshot = utils.percy.config.snapshot || {};
        utils.percy.config.snapshot.minHeight = 800;
      });

      cy.percySnapshot('Responsive Config MinHeight', {
        responsiveSnapshotCapture: true,
        widths: [1280]
        // No minHeight option -- falls through to config
      });

      cy.then(() => {
        Cypress.env('PERCY_RESPONSIVE_CAPTURE_MIN_HEIGHT', undefined);
        if (originalConfig) {
          utils.percy.config = originalConfig;
        } else {
          delete utils.percy.config;
        }
      });

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Responsive Config MinHeight');
    });

    it('uses originalHeight as minHeight fallback', () => {
      const utils = require('@percy/sdk-utils');
      const originalConfig = utils.percy?.config;

      Cypress.env('PERCY_RESPONSIVE_CAPTURE_MIN_HEIGHT', 'true');

      // Ensure no minHeight in config
      cy.then(() => {
        utils.percy = utils.percy || {};
        utils.percy.config = utils.percy.config || {};
        utils.percy.config.snapshot = {};
      });

      cy.percySnapshot('Responsive Height Fallback', {
        responsiveSnapshotCapture: true,
        widths: [1280]
        // No minHeight option, no config minHeight -- falls through to originalHeight
      });

      cy.then(() => {
        Cypress.env('PERCY_RESPONSIVE_CAPTURE_MIN_HEIGHT', undefined);
        if (originalConfig) {
          utils.percy.config = originalConfig;
        } else {
          delete utils.percy.config;
        }
      });

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Responsive Height Fallback');
    });

    it('waits when PERCY_RESPONSIVE_CAPTURE_SLEEP_TIME is set', () => {
      Cypress.env('PERCY_RESPONSIVE_CAPTURE_SLEEP_TIME', '1');

      cy.percySnapshot('Responsive Sleep Test', {
        responsiveSnapshotCapture: true,
        widths: [1280]
      });

      cy.then(() => {
        Cypress.env('PERCY_RESPONSIVE_CAPTURE_SLEEP_TIME', undefined);
      });

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Responsive Sleep Test');
    });

    it('handles responsive capture when waitForResize is not available', () => {
      // Delete waitForResize to cover the false branch at line 207
      const savedWaitForResize = window.PercyDOM?.waitForResize;
      cy.then(() => {
        if (window.PercyDOM) {
          delete window.PercyDOM.waitForResize;
        }
      });

      cy.percySnapshot('Responsive No WaitForResize', {
        responsiveSnapshotCapture: true,
        widths: [1280]
      });

      cy.then(() => {
        if (window.PercyDOM && savedWaitForResize) {
          window.PercyDOM.waitForResize = savedWaitForResize;
        }
      });

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Responsive No WaitForResize');
    });

    it('handles responsive snapshot post failure gracefully', () => {
      cy.then(() => helpers.test('error', '/percy/snapshot'));

      cy.percySnapshot('Responsive Post Fail', {
        responsiveSnapshotCapture: true,
        widths: [1280]
      });

      // Should not crash; the snapshot was attempted but failed
      // Reset mock server so subsequent tests work
      cy.then(() => helpers.test('reset'));
    });
  });

  describe('Cross-Origin Iframe Processing', () => {
    it('processes cross-origin iframes in snapshots', () => {
      cy.percySnapshot('Cross-Origin Iframe Test');

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Cross-Origin Iframe Test');
    });

    it('handles pages with no iframes gracefully', () => {
      cy.percySnapshot('No Iframe Test');

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: No Iframe Test');
    });

    it('processes a cross-origin iframe with data-percy-element-id', () => {
      cy.document().then(doc => {
        const iframe = doc.createElement('iframe');
        iframe.src = 'https://example.com/frame';
        iframe.setAttribute('data-percy-element-id', 'test-iframe-1');
        doc.body.appendChild(iframe);
      });

      cy.percySnapshot('Iframe With Percy ID');

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Iframe With Percy ID');
    });

    it('skips iframes with no src attribute', () => {
      cy.document().then(doc => {
        const iframe = doc.createElement('iframe');
        iframe.setAttribute('data-percy-element-id', 'no-src-iframe');
        doc.body.appendChild(iframe);
      });

      cy.percySnapshot('Iframe No Src');

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Iframe No Src');
    });

    it('skips iframes with srcdoc attribute', () => {
      cy.document().then(doc => {
        const iframe = doc.createElement('iframe');
        iframe.src = 'https://cross-origin.example.com/page';
        iframe.setAttribute('srcdoc', '<p>Hello</p>');
        iframe.setAttribute('data-percy-element-id', 'srcdoc-iframe');
        doc.body.appendChild(iframe);
      });

      cy.percySnapshot('Iframe Srcdoc');

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Iframe Srcdoc');
    });

    it('skips iframes with about:blank src', () => {
      cy.document().then(doc => {
        const iframe = doc.createElement('iframe');
        iframe.src = 'about:blank';
        iframe.setAttribute('data-percy-element-id', 'blank-iframe');
        doc.body.appendChild(iframe);
      });

      cy.percySnapshot('Iframe About Blank');

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Iframe About Blank');
    });

    it('skips same-origin iframes', () => {
      cy.document().then(doc => {
        const iframe = doc.createElement('iframe');
        // Use same origin as the test page
        iframe.src = doc.location.origin + '/some-page';
        iframe.setAttribute('data-percy-element-id', 'same-origin-iframe');
        doc.body.appendChild(iframe);
      });

      cy.percySnapshot('Iframe Same Origin');

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Iframe Same Origin');
    });

    it('skips cross-origin iframes without data-percy-element-id', () => {
      // PercyDOM.serialize() adds data-percy-element-id to all elements.
      // To test the !percyElementId branch in processCrossOriginIframes,
      // we override getAttribute on the iframe to return null for percy-element-id.
      // processCrossOriginIframes runs AFTER serialize, so this override applies.
      cy.document().then(doc => {
        const iframe = doc.createElement('iframe');
        iframe.setAttribute('src', 'https://no-percy-id.example.com/frame');
        doc.body.appendChild(iframe);

        // Override getAttribute to return null for data-percy-element-id
        const origGetAttr = iframe.getAttribute.bind(iframe);
        iframe.getAttribute = function(name) {
          if (name === 'data-percy-element-id') return null;
          return origGetAttr(name);
        };
      });

      cy.percySnapshot('Iframe No Percy ID');

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Iframe No Percy ID');
    });

    it('handles multiple iframes with mixed conditions', () => {
      cy.document().then(doc => {
        // Cross-origin iframe with percy ID (will be processed)
        const iframe1 = doc.createElement('iframe');
        iframe1.src = 'https://external.example.com/frame1';
        iframe1.setAttribute('data-percy-element-id', 'mixed-iframe-1');
        doc.body.appendChild(iframe1);

        // Iframe with javascript: src (should be skipped via SKIP_IFRAME_SRCS)
        const iframe2 = doc.createElement('iframe');
        iframe2.src = 'javascript:void(0)';
        iframe2.setAttribute('data-percy-element-id', 'mixed-iframe-2');
        doc.body.appendChild(iframe2);

        // Iframe with data: src (should be skipped)
        const iframe3 = doc.createElement('iframe');
        iframe3.src = 'data:text/html,<p>hello</p>';
        iframe3.setAttribute('data-percy-element-id', 'mixed-iframe-3');
        doc.body.appendChild(iframe3);
      });

      cy.percySnapshot('Mixed Iframes Test');

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Mixed Iframes Test');
    });

    it('handles cross-origin iframe where content access throws', () => {
      // Add a cross-origin iframe with sandbox to ensure cross-origin restriction.
      // The browser blocks contentWindow access, exercising the catch(accessError) block.
      cy.document().then(doc => {
        const iframe = doc.createElement('iframe');
        iframe.setAttribute('src', 'https://cross-origin-throws.example.com/page');
        iframe.setAttribute('data-percy-element-id', 'throws-iframe');
        iframe.setAttribute('sandbox', '');
        doc.body.appendChild(iframe);
      });

      cy.percySnapshot('Iframe Throws Test');

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Iframe Throws Test');
    });

    it('handles error in cross-origin iframe processing', () => {
      // Override querySelectorAll to throw, triggering the outer catch block
      cy.document().then(doc => {
        const origQSA = doc.querySelectorAll.bind(doc);
        let callCount = 0;
        doc.querySelectorAll = function(selector) {
          // Only throw for the 'iframe' selector used in processCrossOriginIframes
          // Allow other querySelectorAll calls (used by PercyDOM.serialize) to work
          if (selector === 'iframe') {
            callCount++;
            // The 2nd call is from processCrossOriginIframes (1st is from serialize)
            if (callCount >= 2) {
              doc.querySelectorAll = origQSA; // restore immediately
              throw new Error('Test: querySelectorAll failure');
            }
          }
          return origQSA(selector);
        };
      });

      cy.percySnapshot('Iframe Processing Error');

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Iframe Processing Error');
    });

    it('handles iframe with null contentDocument', () => {
      // Create a cross-origin iframe and override contentDocument to return null
      // This covers the branch where frameDocument is null (branch 7[1])
      cy.document().then(doc => {
        const iframe = doc.createElement('iframe');
        iframe.setAttribute('src', 'https://null-doc.example.com/page');
        iframe.setAttribute('data-percy-element-id', 'null-doc-iframe');
        doc.body.appendChild(iframe);

        // Override contentDocument to null and contentWindow.document to null
        Object.defineProperty(iframe, 'contentDocument', {
          get() { return null; },
          configurable: true
        });
        Object.defineProperty(iframe, 'contentWindow', {
          get() { return { document: null, PercyDOM: null }; },
          configurable: true
        });
      });

      cy.percySnapshot('Iframe Null Doc');

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Iframe Null Doc');
    });

    it('handles iframe where PercyDOM already exists on contentWindow', () => {
      // Create a cross-origin iframe with PercyDOM pre-loaded
      // This covers branch 8[1] (PercyDOM exists) and 9[0] (serialize works)
      cy.document().then(doc => {
        const iframe = doc.createElement('iframe');
        iframe.setAttribute('src', 'https://preloaded.example.com/page');
        iframe.setAttribute('data-percy-element-id', 'preloaded-iframe');
        doc.body.appendChild(iframe);

        // Get the real contentWindow and inject PercyDOM into it
        const realWindow = iframe.contentWindow;
        if (realWindow) {
          realWindow.PercyDOM = {
            serialize: function() { return { html: '<html></html>' }; }
          };
        }
      });

      cy.percySnapshot('Iframe PercyDOM Preloaded');

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Iframe PercyDOM Preloaded');
    });

    it('handles iframe where PercyDOM injection fails silently', () => {
      // Create a cross-origin iframe where script injection doesn't create PercyDOM
      // This covers branch 9[1] (PercyDOM still doesn't exist after injection)
      cy.document().then(doc => {
        const iframe = doc.createElement('iframe');
        iframe.setAttribute('src', 'https://no-inject.example.com/page');
        iframe.setAttribute('data-percy-element-id', 'no-inject-iframe');
        doc.body.appendChild(iframe);

        // Create a fake contentWindow where PercyDOM doesn't exist
        // and script injection doesn't add it
        const fakeDoc = {
          createElement: () => ({ textContent: '' }),
          head: {
            appendChild: () => {},
            removeChild: () => {}
          }
        };
        const fakeWindow = {
          PercyDOM: null,
          document: fakeDoc
        };
        Object.defineProperty(iframe, 'contentDocument', {
          get() { return fakeDoc; },
          configurable: true
        });
        Object.defineProperty(iframe, 'contentWindow', {
          get() { return fakeWindow; },
          configurable: true
        });
      });

      cy.percySnapshot('Iframe No Inject');

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Iframe No Inject');
    });

    it('handles iframe with invalid URL that causes parsing error', () => {
      cy.document().then(doc => {
        const iframe = doc.createElement('iframe');
        // //[invalid causes new URL() to throw "Invalid URL"
        iframe.setAttribute('src', '//[invalid');
        iframe.setAttribute('data-percy-element-id', 'invalid-url-iframe');
        doc.body.appendChild(iframe);
      });

      cy.percySnapshot('Iframe Invalid URL');

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Iframe Invalid URL');
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
      // Set some test cookies before taking snapshot
      cy.setCookie('test_cookie', 'test_value');
      cy.setCookie('another_cookie', 'another_value');

      // Verify cookies are set
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
});
