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
    // Import env-utils inside each test to avoid module-level side effects
    const envUtils = () => require('../../env-utils');
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

    it('getEnvValue() returns value from Cypress.expose() when available', () => {
      const { getEnvValue } = envUtils();
      Cypress.expose = cy.stub().withArgs('PERCY_SERVER_ADDRESS').returns('http://test-expose:5338');

      cy.wrap(null).then(() => {
        const result = getEnvValue('PERCY_SERVER_ADDRESS');
        expect(result).to.equal('http://test-expose:5338');
        expect(Cypress.expose).to.be.calledWith('PERCY_SERVER_ADDRESS');
      });
    });

    it('getEnvValue() falls back to Cypress.env() when expose returns undefined', () => {
      const { getEnvValue } = envUtils();
      Cypress.expose = cy.stub().returns(undefined);
      const origEnv = Cypress.env;
      Cypress.env = cy.stub().withArgs('PERCY_SERVER_ADDRESS').returns('http://fallback:5338');

      cy.wrap(null).then(() => {
        const result = getEnvValue('PERCY_SERVER_ADDRESS');
        expect(result).to.equal('http://fallback:5338');
        expect(Cypress.expose).to.be.calledWith('PERCY_SERVER_ADDRESS');
        Cypress.env = origEnv;
      });
    });

    it('getEnvValue() handles Cypress.env() throwing (allowCypressEnv: false)', () => {
      const { getEnvValue } = envUtils();
      Cypress.expose = cy.stub().returns(undefined);
      Cypress.env = cy.stub().throws(new Error('Cypress.env() does not work when allowCypressEnv is set to false'));

      cy.wrap(null).then(() => {
        const result = getEnvValue('PERCY_SERVER_ADDRESS');
        expect(result).to.be.undefined;
      });
    });

    it('getEnvValue() returns undefined when both methods fail', () => {
      const { getEnvValue } = envUtils();
      // No Cypress.expose available, Cypress.env throws
      delete Cypress.expose;
      Cypress.env = cy.stub().throws(new Error('env unavailable'));

      cy.wrap(null).then(() => {
        const result = getEnvValue('SOME_KEY');
        expect(result).to.be.undefined;
      });
    });

    it('lazy-resolves address via cy.env() when utils.percy.address is unset', () => {
      const utils = require('@percy/sdk-utils');

      // Clear address INSIDE the command queue so it's unset when percySnapshot runs.
      // This triggers the lazy resolution block.
      cy.then(() => {
        utils.percy.address = null;
      });

      cy.percySnapshot('lazy-resolve-test');

      // Restore address for subsequent tests
      cy.then(() => {
        utils.percy.address = helpers.testSnapshotURL.replace('/test/snapshot', '');
      });
    });

    it('handles cy.env() failure during lazy address resolution gracefully', () => {
      const utils = require('@percy/sdk-utils');
      let origCyEnv;

      // Clear address and break cy.env INSIDE the command queue
      // to exercise the catch block in lazyResolveAddress
      cy.then(() => {
        origCyEnv = cy.env;
        utils.percy.address = null;
        cy.env = function() { throw new Error('cy.env not available'); };
      });

      cy.percySnapshot('lazy-resolve-error-test');

      cy.then(() => {
        cy.env = origCyEnv;
        utils.percy.address = helpers.testSnapshotURL.replace('/test/snapshot', '');
      });
    });

    it('lazyResolveAddress() resolves from Cypress.env() when address is falsy', () => {
      const { lazyResolveAddress } = envUtils();
      const utils = require('@percy/sdk-utils');
      const log = utils.logger('cypress');

      cy.wrap(null).then(() => {
        const savedAddress = utils.percy.address;
        // The address getter always returns a truthy default ('http://localhost:5338')
        // via process.env.PERCY_SERVER_ADDRESS || 'http://localhost:5338'.
        // To test the resolution path, temporarily override the getter to return null.
        const descriptor = Object.getOwnPropertyDescriptor(utils.percy, 'address');
        Object.defineProperty(utils.percy, 'address', {
          get: () => null,
          set: (v) => { /* no-op during test */ },
          configurable: true
        });

        Cypress.env = cy.stub().withArgs('PERCY_SERVER_ADDRESS').returns('http://lazy:5338');

        lazyResolveAddress(log);
        // lazyResolveAddress calls Cypress.env('PERCY_SERVER_ADDRESS') when address is falsy
        expect(Cypress.env).to.be.calledWith('PERCY_SERVER_ADDRESS');

        // Restore the original address property
        Object.defineProperty(utils.percy, 'address', descriptor);
        utils.percy.address = savedAddress;
      });
    });

    it('lazyResolveAddress() does not set address when Cypress.env() returns undefined', () => {
      const { lazyResolveAddress } = envUtils();
      const utils = require('@percy/sdk-utils');
      const log = utils.logger('cypress');

      cy.wrap(null).then(() => {
        const descriptor = Object.getOwnPropertyDescriptor(utils.percy, 'address');
        let capturedSet = null;
        Object.defineProperty(utils.percy, 'address', {
          get: () => null,
          set: (v) => { capturedSet = v; },
          configurable: true
        });

        Cypress.env = cy.stub().withArgs('PERCY_SERVER_ADDRESS').returns(undefined);

        lazyResolveAddress(log);
        expect(Cypress.env).to.be.calledWith('PERCY_SERVER_ADDRESS');
        // addr is falsy (undefined) so address should NOT be set
        expect(capturedSet).to.be.null;

        Object.defineProperty(utils.percy, 'address', descriptor);
      });
    });

    it('lazyResolveAddress() catches Cypress.env() errors and logs debug', () => {
      const { lazyResolveAddress } = envUtils();
      const utils = require('@percy/sdk-utils');
      const log = utils.logger('cypress');
      const debugSpy = cy.spy(log, 'debug');

      cy.wrap(null).then(() => {
        const descriptor = Object.getOwnPropertyDescriptor(utils.percy, 'address');
        Object.defineProperty(utils.percy, 'address', {
          get: () => null,
          set: () => {},
          configurable: true
        });

        Cypress.env = cy.stub().throws(new Error('env blocked'));

        lazyResolveAddress(log);
        expect(debugSpy).to.be.calledWithMatch('Could not resolve Percy CLI address');

        Object.defineProperty(utils.percy, 'address', descriptor);
      });
    });

    it('lazyResolveAddress() does nothing when address is already set', () => {
      const { lazyResolveAddress } = envUtils();
      const utils = require('@percy/sdk-utils');
      const log = utils.logger('cypress');

      cy.wrap(null).then(() => {
        const savedAddress = utils.percy.address;
        utils.percy.address = 'http://already-set:5338';
        const envStub = cy.stub();
        Cypress.env = envStub;

        lazyResolveAddress(log);
        expect(utils.percy.address).to.equal('http://already-set:5338');
        expect(envStub).not.to.be.called;

        // Restore
        utils.percy.address = savedAddress;
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

  describe('readiness gate', () => {
    // The SDK injects + runs PercyDOM in the app-under-test realm
    // (doc.defaultView), so stub PercyDOM on the AUT window via cy.window().
    // (It previously read window.PercyDOM from the spec runner frame, which
    // silently ran the readiness gate against the wrong document; stubbing on
    // the AUT window matches the fix and guards that regression.)
    const installPercyDOMStub = (stub) => {
      cy.window({ log: false }).then((win) => {
        win.PercyDOM = stub;
      });
    };

    afterEach(() => {
      const utils = require('@percy/sdk-utils');
      if (utils.percy) utils.percy.config = undefined;
      cy.window({ log: false }).then((win) => { delete win.PercyDOM; });
    });

    it('calls waitForReady before serialize when the CLI exposes it', () => {
      const calls = [];
      installPercyDOMStub({
        waitForReady: (cfg) => { calls.push(['waitForReady', cfg]); return Promise.resolve(); },
        serialize: (opts) => { calls.push(['serialize', opts]); return { html: { html: '<html></html>' } }; }
      });

      cy.percySnapshot('readiness-happy-path');

      cy.then(() => {
        // deep.equal (not indexOf) so a duplicate waitForReady call would fail.
        expect(calls.map(([name]) => name)).to.deep.equal(['waitForReady', 'serialize']);
      });
    });

    it('merges global .percy.yml readiness config with per-snapshot overrides', () => {
      const utils = require('@percy/sdk-utils');
      const originalConfig = utils.percy?.config;
      const cfgs = [];
      installPercyDOMStub({
        waitForReady: (cfg) => { cfgs.push(cfg); return Promise.resolve(); },
        serialize: () => ({ html: { html: '<html></html>' } })
      });

      cy.then(() => {
        utils.percy = utils.percy || {};
        utils.percy.config = {
          ...(originalConfig || {}),
          snapshot: {
            ...(originalConfig?.snapshot || {}),
            readiness: { preset: 'balanced', timeoutMs: 8000, stabilityWindowMs: 200 }
          }
        };
      });

      // Per-snapshot keys override global ones; unspecified global keys are inherited.
      cy.percySnapshot('readiness-merge', { readiness: { stabilityWindowMs: 500 } });

      cy.then(() => {
        expect(cfgs).to.have.length(1);
        expect(cfgs[0]).to.deep.equal({
          preset: 'balanced',
          timeoutMs: 8000,
          stabilityWindowMs: 500
        });
        if (originalConfig) utils.percy.config = originalConfig;
        else delete utils.percy.config;
      });
    });

    it('inherits global preset: disabled when per-snapshot override omits preset', () => {
      const utils = require('@percy/sdk-utils');
      const originalConfig = utils.percy?.config;
      const calls = [];
      installPercyDOMStub({
        waitForReady: (cfg) => { calls.push(['waitForReady', cfg]); return Promise.resolve(); },
        serialize: () => { calls.push(['serialize']); return { html: { html: '<html></html>' } }; }
      });

      cy.then(() => {
        utils.percy = utils.percy || {};
        utils.percy.config = {
          ...(originalConfig || {}),
          snapshot: {
            ...(originalConfig?.snapshot || {}),
            readiness: { preset: 'disabled' }
          }
        };
      });

      cy.percySnapshot('readiness-global-disabled', { readiness: { stabilityWindowMs: 500 } });

      cy.then(() => {
        expect(calls.map(([name]) => name)).to.deep.equal(['serialize']);
        if (originalConfig) utils.percy.config = originalConfig;
        else delete utils.percy.config;
      });
    });

    it('skips waitForReady when global .percy.yml has preset: disabled', () => {
      const utils = require('@percy/sdk-utils');
      const originalConfig = utils.percy?.config;
      const calls = [];
      installPercyDOMStub({
        waitForReady: (cfg) => { calls.push(['waitForReady', cfg]); return Promise.resolve(); },
        serialize: () => { calls.push(['serialize']); return { html: { html: '<html></html>' } }; }
      });

      cy.then(() => {
        utils.percy = utils.percy || {};
        utils.percy.config = {
          ...(originalConfig || {}),
          snapshot: {
            ...(originalConfig?.snapshot || {}),
            readiness: { preset: 'disabled' }
          }
        };
      });

      cy.percySnapshot('readiness-global-disabled-no-override');

      cy.then(() => {
        expect(calls.map(([name]) => name)).to.deep.equal(['serialize']);
        if (originalConfig) utils.percy.config = originalConfig;
        else delete utils.percy.config;
      });
    });

    it('does not forward `readiness` into postSnapshot, but forwards readiness_diagnostics on domSnapshot', () => {
      const utils = require('@percy/sdk-utils');
      const diagnostics = { passed: true, timed_out: false, preset: 'balanced', total_duration_ms: 12, checks: {} };
      const posted = [];

      installPercyDOMStub({
        waitForReady: () => Promise.resolve(diagnostics),
        serialize: () => ({ html: '<html></html>' })
      });

      cy.then(() => {
        cy.stub(utils, 'postSnapshot').callsFake(async (payload) => {
          posted.push(payload);
          return { success: true };
        });
      });

      cy.percySnapshot('readiness-postSnapshot-forward', { readiness: { stabilityWindowMs: 250 } });

      cy.then(() => {
        expect(posted).to.have.length(1);
        const payload = posted[0];
        // readiness is SDK-local — it must not be forwarded to the CLI again.
        expect(payload).to.not.have.property('readiness');
        // diagnostics rides on the snapshot itself.
        expect(payload.domSnapshot.readiness_diagnostics).to.deep.equal(diagnostics);
      });
    });

    it('skips waitForReady when the CLI is old (function is absent)', () => {
      const calls = [];
      // No waitForReady — simulating an older CLI. serialize must still run.
      installPercyDOMStub({
        serialize: (opts) => { calls.push(['serialize', opts]); return { html: { html: '<html></html>' } }; }
      });

      cy.percySnapshot('readiness-backward-compat');

      cy.then(() => {
        expect(calls.map(([name]) => name)).to.deep.equal(['serialize']);
      });
    });

    it('skips waitForReady when preset is disabled', () => {
      const calls = [];
      installPercyDOMStub({
        waitForReady: (cfg) => { calls.push(['waitForReady', cfg]); return Promise.resolve(); },
        serialize: (opts) => { calls.push(['serialize', opts]); return { html: { html: '<html></html>' } }; }
      });

      cy.percySnapshot('readiness-disabled', { readiness: { preset: 'disabled' } });

      cy.then(() => {
        expect(calls.map(([name]) => name)).to.deep.equal(['serialize']);
      });
    });

    it('proceeds to serialize when waitForReady rejects', () => {
      const calls = [];
      installPercyDOMStub({
        waitForReady: () => { calls.push(['waitForReady']); return Promise.reject(new Error('readiness failed')); },
        serialize: (opts) => { calls.push(['serialize', opts]); return { html: { html: '<html></html>' } }; }
      });

      cy.percySnapshot('readiness-rejection');

      cy.then(() => {
        expect(calls.map(([name]) => name)).to.deep.equal(['waitForReady', 'serialize']);
      });
    });

    it('still serializes when waitForReady rejects with a non-Error value', () => {
      // Exercises the `|| e` fallback in `e?.message || e` -- a plain-string
      // (or anything without `.message`) rejection.
      const calls = [];
      installPercyDOMStub({
        // eslint-disable-next-line prefer-promise-reject-errors
        waitForReady: () => { calls.push(['waitForReady']); return Promise.reject('plain-string-rejection'); },
        serialize: (opts) => { calls.push(['serialize', opts]); return { html: { html: '<html></html>' } }; }
      });

      cy.percySnapshot('readiness-rejection-string');

      cy.then(() => {
        expect(calls.map(([name]) => name)).to.deep.equal(['waitForReady', 'serialize']);
      });
    });

    it('attaches readiness diagnostics returned by waitForReady to domSnapshot', () => {
      const diagnostics = { passed: true, timed_out: false, preset: 'balanced', total_duration_ms: 42, checks: {} };
      let capturedSnapshot;
      installPercyDOMStub({
        waitForReady: () => Promise.resolve(diagnostics),
        serialize: () => { capturedSnapshot = { html: '<html></html>' }; return capturedSnapshot; }
      });

      cy.percySnapshot('readiness-diagnostics');

      cy.then(() => {
        // The SDK assigns readiness_diagnostics onto the domSnapshot object
        // returned by serialize, so the CLI receives it via snapshot.js:225.
        expect(capturedSnapshot.readiness_diagnostics).to.deep.equal(diagnostics);
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
      // We can't reach the deferUploads warn branch through cy.percySnapshot
      // alone: webpack bundles the spec separately from the SDK, so the
      // test's `@percy/sdk-utils` is a different module instance than the
      // SDK uses, and direct mutation of utils.percy.config doesn't carry
      // over (the SDK's healthcheck would overwrite it anyway). Call the
      // shim's `utils.percy` (same instance the SDK reads) by going
      // through index.js's exports — index.js is loaded by support/e2e.js
      // and its `require('@percy/sdk-utils')` resolves to the SDK-side
      // instance. We bridge by calling isResponsiveDOMCaptureValid
      // directly and asserting the warn fires + return value is false.
      const indexExports = require('../../');
      const shim = require('@percy/sdk-utils');

      const originalConfig = shim.percy.config;

      cy.then(() => {
        // Reach the shim instance that index.js *actually* uses by going
        // through index.js's exports — webpack treats each separately
        // required path as a unique module, so `require('@percy/sdk-utils')`
        // from this file does NOT alias the instance that index.js
        // captured at module-load time. The index.js module IS the same
        // instance the SDK uses (since support/e2e.js imports it), so we
        // route through it.
        const indexShim = indexExports.__getShimForTesting();
        indexShim.percy.config = { percy: { deferUploads: true }, snapshot: {} };

        // Capture warn messages from the SDK's own logger instance, since
        // that's what isResponsiveDOMCaptureValid uses (helpers.logger
        // mocks the spec-bundle's logger, which is a different instance).
        const warnMessages = [];
        const origLog = indexShim.logger.log;
        indexShim.logger.log = (ns, lvl, msg) => {
          if (lvl === 'warn') warnMessages.push(`[percy] ${msg}`);
        };
        try {
          const result = indexExports.isResponsiveDOMCaptureValid({
            responsiveSnapshotCapture: true
          });
          expect(result).to.equal(false);
        } finally {
          indexShim.logger.log = origLog;
        }
        expect(warnMessages.join('\n'))
          .to.include('Responsive capture disabled: deferUploads is enabled');
      });

      // Restore percy.config so subsequent tests aren't affected.
      cy.then(() => {
        if (originalConfig === undefined) {
          delete shim.percy.config;
        } else {
          shim.percy.config = originalConfig;
        }
      });

      // Also exercise the cy.percySnapshot fall-through path (responsive
      // disabled → captures non-responsive). This is the same code path
      // existing tests already cover, but anchoring it here demonstrates
      // the user-visible behaviour: deferUploads turns responsive off and
      // we still post the snapshot.
      cy.percySnapshot('DeferUploads Test');
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

        cy.then(() => helpers.get('logs'))
          .should('not.include', 'Snapshot found: Responsive Interactive Skip');
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

      cy.then(() => helpers.get('logs'))
        .should('not.include', 'Snapshot found: Responsive Percy Disabled');

      // Reset mock server and percy state so subsequent tests work
      cy.then(async () => {
        await helpers.test('reset');
        delete utils.percy.enabled;
      });
    });

    it('skips DOM serialization when percyDOMScript is unavailable', () => {
      // Make /percy/dom.js return an error from the testing server AND
      // clear the SDK-side cached domScript so fetchPercyDOM actually
      // re-hits the endpoint. Webpack bundles the spec separately from
      // the SDK, so deleting utils.percy.domScript on the spec-side
      // sdk-utils doesn't clear the SDK's cached value — we reach the
      // SDK's percy info via index.js's __getShimForTesting hook. The
      // testing-mode server, on the other hand, is a single process both
      // sides talk to via HTTP, so /test/api/error reaches the SDK.
      const indexExports = require('../../');
      const indexShim = indexExports.__getShimForTesting();

      cy.then(async () => {
        delete indexShim.percy.domScript;
        await helpers.test('error', '/percy/dom.js');
      });

      cy.percySnapshot('Responsive No DOM Script', {
        responsiveSnapshotCapture: true,
        widths: [1280]
      });

      cy.then(() => helpers.get('logs'))
        .should('not.include', 'Snapshot found: Responsive No DOM Script');

      cy.then(() => helpers.test('reset'));
    });

    it('uses getResponsiveWidths when available for width/height pairs', () => {
      const utils = require('@percy/sdk-utils');
      const originalGetResponsiveWidths = utils.getResponsiveWidths;

      cy.then(() => {
        // Stub getResponsiveWidths to return width/height pairs
        utils.getResponsiveWidths = async (widths) => {
          return widths.map(w => ({ width: w, height: 900 }));
        };
      });

      cy.percySnapshot('Responsive With CLI Heights', {
        responsiveSnapshotCapture: true,
        widths: [1024, 768]
      });

      cy.then(() => {
        if (originalGetResponsiveWidths) {
          utils.getResponsiveWidths = originalGetResponsiveWidths;
        } else {
          delete utils.getResponsiveWidths;
        }
      });

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Responsive With CLI Heights');
    });

    it('logs and falls back when getResponsiveWidths throws', () => {
      // Cover the catch in Step 1 of percySnapshot: getResponsiveWidths can
      // reject if the CLI is older than 1.31.10. We reach the same
      // instance index.js captured (webpack spec/SDK isolation means
      // require('@percy/sdk-utils') from this file is a separate instance),
      // and we intercept the SDK-side logger to capture the debug log —
      // helpers.logger mocks a different logger module instance.
      const indexExports = require('../../');
      const indexShim = indexExports.__getShimForTesting();
      const originalGRW = indexShim.getResponsiveWidths;
      const debugMessages = [];
      let originalLog;

      cy.then(() => {
        indexShim.getResponsiveWidths = async () => {
          throw new Error('getResponsiveWidths failed for test');
        };
        originalLog = indexShim.logger.log;
        // Force debug level so log.debug actually pushes through, then
        // capture every debug into a local array we can assert against.
        const origLevel = indexShim.logger.loglevel();
        indexShim.logger.loglevel('debug');
        indexShim.logger.log = (ns, lvl, msg) => {
          if (lvl === 'debug') debugMessages.push(msg);
        };
        // Stash level on the function so restoration uses the right value.
        indexShim.logger.log.__origLevel = origLevel;
      });

      cy.percySnapshot('Responsive Throws Test', {
        responsiveSnapshotCapture: true,
        widths: [1024]
      });

      cy.then(() => {
        expect(debugMessages.join('\n'))
          .to.include('getResponsiveWidths not available');
      });

      cy.then(() => {
        indexShim.getResponsiveWidths = originalGRW;
        const origLevel = indexShim.logger.log.__origLevel;
        indexShim.logger.log = originalLog;
        indexShim.logger.loglevel(origLevel || 'info');
      });

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Responsive Throws Test');
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
        if (originalGetResponsiveWidths) {
          utils.getResponsiveWidths = originalGetResponsiveWidths;
        }
      });

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Responsive Fallback Widths');
    });

    it('uses viewport width as fallback when no widths specified and getResponsiveWidths unavailable', () => {
      // Reach the same shim instance index.js captured at module-load —
      // webpack treats the spec bundle's sdk-utils as a separate instance,
      // so deleting utils.getResponsiveWidths there doesn't reach the SDK.
      const indexExports = require('../../');
      const indexShim = indexExports.__getShimForTesting();
      const original = indexShim.getResponsiveWidths;

      cy.then(() => {
        // Throw so percySnapshot's catch swallows it and _widthHeights stays
        // undefined; that's the only way the `_widthHeights || (...).map`
        // OR branch trips the `[originalWidth]` short-circuit when widths
        // is also unset.
        indexShim.getResponsiveWidths = async () => {
          throw new Error('CLI too old for this test');
        };
      });

      // No widths specified -- should fall back to [originalWidth]
      cy.percySnapshot('Responsive No Widths Fallback', {
        responsiveSnapshotCapture: true
      });

      cy.then(() => {
        indexShim.getResponsiveWidths = original;
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

      // Snapshot should not appear in logs (post failed)
      cy.then(() => helpers.get('logs'))
        .should('not.include', 'Snapshot found: Responsive Post Fail');

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

    it('skips iframes marked with data-percy-ignore', () => {
      cy.document().then(doc => {
        const iframe = doc.createElement('iframe');
        iframe.setAttribute('src', 'https://other.com/frame');
        iframe.setAttribute('data-percy-element-id', 'ignored-iframe');
        iframe.setAttribute('data-percy-ignore', '');
        doc.body.appendChild(iframe);
      });

      cy.percySnapshot('Iframe Data Percy Ignore');

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Iframe Data Percy Ignore');
    });

    it('skips iframes matching ignoreIframeSelectors', () => {
      cy.document().then(doc => {
        const iframe = doc.createElement('iframe');
        iframe.setAttribute('src', 'https://ad-network.com/frame');
        iframe.setAttribute('data-percy-element-id', 'ad-iframe');
        iframe.className = 'ad-frame';
        doc.body.appendChild(iframe);
      });

      cy.percySnapshot('Iframe Selector Ignore', { ignoreIframeSelectors: ['.ad-frame'] });

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Iframe Selector Ignore');
    });

    it('tolerates non-array ignoreIframeSelectors (normalizeIgnoreSelectors falsy branch)', () => {
      cy.document().then(doc => {
        const iframe = doc.createElement('iframe');
        iframe.setAttribute('src', 'https://other.com/frame');
        iframe.setAttribute('data-percy-element-id', 'still-captured-non-array');
        doc.body.appendChild(iframe);
      });

      // Passing a string instead of an array — normalizeIgnoreSelectors returns []
      // and the iframe is processed normally.
      cy.percySnapshot('Iframe Non-Array Selectors', { ignoreIframeSelectors: 'not-an-array' });

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Iframe Non-Array Selectors');
    });

    it('does not skip iframes that do not match ignoreIframeSelectors', () => {
      cy.document().then(doc => {
        const iframe = doc.createElement('iframe');
        iframe.setAttribute('src', 'https://other.com/frame');
        iframe.setAttribute('data-percy-element-id', 'kept-iframe');
        // class does NOT match the selector below
        iframe.className = 'normal-frame';
        doc.body.appendChild(iframe);
      });

      // Iframe doesn't have .ad-frame class — iframe.matches returns false,
      // skipBySelector stays false, iframe is processed normally.
      cy.percySnapshot('Iframe Selector NoMatch', { ignoreIframeSelectors: ['.ad-frame'] });

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Iframe Selector NoMatch');
    });

    it('tolerates invalid selectors in ignoreIframeSelectors', () => {
      cy.document().then(doc => {
        const iframe = doc.createElement('iframe');
        iframe.setAttribute('src', 'https://other.com/frame');
        iframe.setAttribute('data-percy-element-id', 'still-captured');
        doc.body.appendChild(iframe);
      });

      // '[broken===' is not a valid CSS selector — iframe.matches() throws,
      // the inner try/catch swallows, and the iframe stays in the capture set.
      cy.percySnapshot('Iframe Bad Selector', { ignoreIframeSelectors: ['[broken==='] });

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Iframe Bad Selector');
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

    it('drops null-snapshot entries from corsIframes payload', () => {
      // A cross-origin iframe whose contentDocument is unreachable produces
      // iframeSnapshot: null. The SDK filters these out before submission so
      // they don't waste wire size. We use a real cross-origin src instead of
      // overriding contentDocument with a throwing getter (which would crash
      // the in-page PercyDOM serializer's own iframe walk before the SDK's
      // filter ever runs).
      cy.document().then(doc => {
        const iframe = doc.createElement('iframe');
        iframe.setAttribute('src', 'https://blocked.example.com/page');
        iframe.setAttribute('data-percy-element-id', 'blocked-iframe');
        doc.body.appendChild(iframe);
      });

      cy.percySnapshot('Filtered Null Snapshot');

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Filtered Null Snapshot');
      // No corsIframes mention in logs because all entries were filtered
      cy.then(() => helpers.get('logs')).then(logs => {
        const text = logs.join('\n');
        // Either the payload had no corsIframes key, or it was empty.
        expect(text).to.not.match(/corsIframes.*blocked-iframe/);
      });
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

    it('filters out httpOnly cookies from snapshots', () => {
      // Set a regular cookie and an httpOnly cookie
      cy.setCookie('regular_cookie', 'regular_value');
      cy.setCookie('httponly_cookie', 'secret_value', { httpOnly: true });

      // Verify both cookies exist in the browser
      cy.getCookies().should('have.length', 2);

      cy.percySnapshot('HttpOnly Filter Test');

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: HttpOnly Filter Test');
    });

    it('captures all non-httpOnly cookies when mixed with httpOnly', () => {
      cy.setCookie('visible_one', 'value1');
      cy.setCookie('visible_two', 'value2');
      cy.setCookie('session_token', 'secret', { httpOnly: true });

      cy.getCookies().should('have.length', 3);

      cy.percySnapshot('Mixed Cookie Test');

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Mixed Cookie Test');
    });

    it('handles snapshots where all cookies are httpOnly', () => {
      cy.clearCookies();
      cy.setCookie('session_only', 'secret', { httpOnly: true });

      cy.getCookies().should('have.length', 1);

      cy.percySnapshot('All HttpOnly Test');

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: All HttpOnly Test');
    });
  });

  describe('Closed Shadow DOM and ElementInternals Preflight', () => {
    beforeEach(() => {
      cy.then(helpers.setupTest);
      cy.visit(helpers.testSnapshotURL);
    });

    it('sets __percyPreflightActive flag on the window', () => {
      cy.window().then(win => {
        expect(win.__percyPreflightActive).to.be.true;
      });
    });

    it('intercepts closed shadow roots and stores them in WeakMap', () => {
      cy.window().then(win => {
        expect(win.__percyClosedShadowRoots).to.be.an.instanceOf(WeakMap);
      });

      cy.document().then(doc => {
        const el = doc.createElement('div');
        doc.body.appendChild(el);
        const shadow = el.attachShadow({ mode: 'closed' });

        cy.window().then(win => {
          expect(win.__percyClosedShadowRoots.has(el)).to.be.true;
          expect(win.__percyClosedShadowRoots.get(el)).to.equal(shadow);
        });
      });
    });

    it('does NOT capture open shadow roots in the WeakMap', () => {
      cy.document().then(doc => {
        const el = doc.createElement('div');
        doc.body.appendChild(el);
        el.attachShadow({ mode: 'open' });

        cy.window().then(win => {
          expect(win.__percyClosedShadowRoots.has(el)).to.be.false;
        });
      });
    });

    it('intercepts ElementInternals and stores them in WeakMap', () => {
      cy.window().then(win => {
        if (typeof win.HTMLElement.prototype.attachInternals !== 'function') {
          // Skip if browser doesn't support attachInternals
          return;
        }

        const tag = 'test-internals-' + Math.random().toString(36).slice(2);
        class TestEl extends win.HTMLElement {
          static get formAssociated() { return true; }

          constructor() {
            super();
            this.internals = this.attachInternals();
          }
        }
        win.customElements.define(tag, TestEl);

        const el = win.document.createElement(tag);
        win.document.body.appendChild(el);

        expect(win.__percyInternals).to.be.an.instanceOf(WeakMap);
        expect(win.__percyInternals.has(el)).to.be.true;
        // Avoid deep-inspecting ElementInternals (Chai triggers NotSupportedError on .form)
        expect(win.__percyInternals.get(el) === el.internals).to.be.true;
      });
    });

    it('is idempotent and skips if __percyPreflightActive is already set', () => {
      cy.window().then(win => {
        // Preflight has already run (flag is true from page load)
        expect(win.__percyPreflightActive).to.be.true;

        // Store reference to the already-patched attachShadow
        const patchedFn = win.Element.prototype.attachShadow;

        // Note: Cypress.emit is a private API used here for testing idempotency.
        // This may break across Cypress major versions.
        Cypress.emit('window:before:load', win);

        // attachShadow should NOT have been re-patched
        expect(win.Element.prototype.attachShadow).to.equal(patchedFn);
      });
    });

    it('sets Cypress.__percyPreflightRegistered to prevent duplicate registration', () => {
      // The module-level guard sets this flag when index.js is first loaded
      expect(Cypress.__percyPreflightRegistered).to.be.true;

      // Calling registerPreflight again should return false (already registered)
      const { registerPreflight } = require('../../index');
      expect(registerPreflight()).to.be.false;
    });

    it('attachShadow still returns the shadow root correctly', () => {
      cy.document().then(doc => {
        const el = doc.createElement('div');
        doc.body.appendChild(el);
        const shadow = el.attachShadow({ mode: 'closed' });

        // Verify the shadow root is returned and is usable
        expect(shadow).to.not.be.null;
        expect(shadow).to.not.be.undefined;
        shadow.innerHTML = '<span>test</span>';
        expect(shadow.querySelector('span').textContent).to.equal('test');
      });
    });

    it('skips ElementInternals setup when the API is unavailable', () => {
      cy.window().then(win => {
        // Create a minimal mock window without attachInternals
        const mockWin = {
          __percyPreflightActive: false,
          Element: {
            prototype: {
              attachShadow: win.Element.prototype.attachShadow
            }
          },
          HTMLElement: {
            prototype: {} // no attachInternals
          }
        };

        // Emit preflight on the mock window — should not throw and should skip internals
        Cypress.emit('window:before:load', mockWin);

        expect(mockWin.__percyPreflightActive).to.be.true;
        expect(mockWin.__percyClosedShadowRoots).to.be.an.instanceOf(WeakMap);
        expect(mockWin.__percyInternals).to.be.undefined;
      });
    });

    it('bridges preflight data to runner window during snapshot', () => {
      cy.document().then(doc => {
        // Create a closed shadow root element before taking a snapshot
        const el = doc.createElement('div');
        doc.body.appendChild(el);
        el.attachShadow({ mode: 'closed' });
      });

      cy.percySnapshot('Shadow DOM Bridge Test');
      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Shadow DOM Bridge Test');
    });

    it('handles snapshot when preflight data is absent from app window', () => {
      // Remove preflight WeakMaps to exercise the falsy branches at lines 286-289
      cy.window().then(win => {
        delete win.__percyClosedShadowRoots;
        delete win.__percyInternals;
      });

      cy.percySnapshot('No Preflight Data Test');
      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: No Preflight Data Test');
    });

    it('does not keep a parallel hosts array (WeakMap leak guard)', () => {
      // CE review #1: closedShadowHosts / internalsHosts arrays were dropped
      // because they pinned every host element strongly across the suite and
      // defeated the WeakMap. Assert they're not present on the window.
      cy.window().then(win => {
        expect(win.__percyClosedShadowHosts).to.be.undefined;
        expect(win.__percyInternalsHosts).to.be.undefined;
      });
    });

    it('patches the current window synchronously at registration time', () => {
      // CE review #3: window:before:load only fires on subsequent navigations.
      // The initial AUT page is already loaded by the time index.js runs in
      // support/e2e.js, so registerPreflight() also runs patchWindow on
      // cy.state('window') synchronously. We can prove the synchronous path
      // by re-invoking it on a fresh mock window (without going through the
      // event bus) and verifying it patches.
      cy.window().then(win => {
        const mockWin = {
          __percyPreflightActive: false,
          Element: {
            prototype: {
              attachShadow: win.Element.prototype.attachShadow
            }
          },
          HTMLElement: {
            prototype: {
              attachInternals: function() { return {}; }
            }
          }
        };

        // The exported patchWindow isn't public; we exercise it via the
        // 'window:before:load' emit which uses the same code path. The key
        // assertion is that calling patchWindow synchronously on a window
        // produces the same WeakMap setup as the event-driven path.
        Cypress.emit('window:before:load', mockWin);
        expect(mockWin.__percyPreflightActive).to.be.true;
        expect(mockWin.__percyClosedShadowRoots).to.be.an.instanceOf(WeakMap);
        expect(mockWin.__percyInternals).to.be.an.instanceOf(WeakMap);
      });
    });

    it('injects PercyDOM into the AUT window via a script element', () => {
      // CE review companion: the rewrite swapped runner-window eval for an
      // AUT-window <script> append. Verify PercyDOM lands on the AUT window
      // after a snapshot, not the runner.
      cy.percySnapshot('Inject Verifier');
      cy.window().then(win => {
        expect(win.PercyDOM).to.exist;
        expect(typeof win.PercyDOM.serialize).to.equal('function');
      });
      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Inject Verifier');
    });

    it('no-ops the script injection when PercyDOM is already on the AUT window', () => {
      // Branch coverage for `if (targetWin.PercyDOM) return;` in
      // injectPercyDOM. Snapshot once to inject, then again to take the
      // early-return path. Both posts succeed.
      cy.percySnapshot('Inject Once');
      cy.window().then(win => {
        // Stamp a marker on the already-installed serializer so we can prove
        // the second snapshot didn't replace PercyDOM.
        win.PercyDOM.__percyInjectMarker = 'kept';
      });
      cy.percySnapshot('Inject Twice');
      cy.window().then(win => {
        expect(win.PercyDOM.__percyInjectMarker).to.equal('kept');
      });
      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Inject Twice');
    });

    it('skips the snapshot gracefully when PercyDOM never loads (e.g. CSP-blocked injection)', () => {
      // Branch coverage for the CSP guard: a strict-CSP AUT still delivers the
      // inline serializer <script> (so _percyDOMScript is truthy) but the
      // browser blocks it from executing, leaving PercyDOM undefined. The
      // snapshot must be skipped — not throw and fail the whole test.
      const utils = require('@percy/sdk-utils');
      cy.window({ log: false }).then((win) => { delete win.PercyDOM; });
      // Non-empty script that does NOT define window.PercyDOM — mimics the
      // blocked inline script having been delivered but never executed.
      cy.stub(utils, 'fetchPercyDOM').resolves('window.__percyCspBlockedMarker = true;');

      // Must not throw / fail the test.
      cy.percySnapshot('csp-blocked-skip');

      // Snapshot was skipped, never posted.
      cy.then(() => helpers.get('logs'))
        .should('not.include', 'Snapshot found: csp-blocked-skip');
    });
  });

  describe('CORS iframe success path', () => {
    it('captures a same-origin-misclassified iframe through the CORS branch', () => {
      // CE review #2: the CORS-iframe code path keys off URL.origin
      // comparison. A frame whose src URL parses to a different origin but
      // whose contentDocument is actually accessible (e.g. javascript:-built
      // shells or iframes that mutate document.domain) lands in the capture
      // branch. We can't ship a true cross-origin frame inside Cypress, so
      // we simulate the branch by overriding contentWindow/contentDocument
      // to surface a working PercyDOM-capable window.
      cy.document().then(doc => {
        const iframe = doc.createElement('iframe');
        iframe.setAttribute('src', 'https://capture-success.example.com/page');
        iframe.setAttribute('data-percy-element-id', 'capture-success-iframe');
        doc.body.appendChild(iframe);

        const fakeHtml = '<html><head></head><body><p>captured</p></body></html>';
        const fakeHead = {
          appendChild: () => {},
          removeChild: () => {}
        };
        const fakeDoc = {
          createElement: () => ({ textContent: '' }),
          head: fakeHead
        };
        const fakeWindow = {
          PercyDOM: {
            serialize: () => ({ html: fakeHtml })
          },
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

      cy.percySnapshot('CORS Iframe Capture Success');

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: CORS Iframe Capture Success');
    });
  });
});
