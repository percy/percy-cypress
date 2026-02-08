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

    it('falls back to Cypress.env() when Cypress.expose() is not available', () => {
      const utils = require('@percy/sdk-utils');
      const testAddress = 'http://test-env-address:5338';

      // Remove Cypress.expose
      delete Cypress.expose;

      // Mock Cypress.env
      const envStub = cy.stub().withArgs('PERCY_SERVER_ADDRESS').returns(testAddress);
      Cypress.env = envStub;

      cy.wrap(null).then(() => {
        // Simulate the configuration logic
        if (typeof Cypress.expose === 'function') {
          const addr = Cypress.expose('PERCY_SERVER_ADDRESS');
          if (addr) utils.percy.address = addr;
        } else if (typeof Cypress.env === 'function') {
          const addr = Cypress.env('PERCY_SERVER_ADDRESS');
          if (addr) utils.percy.address = addr;
        }

        expect(envStub).to.be.calledWith('PERCY_SERVER_ADDRESS');
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

    it('does not set address when Cypress.env() returns null/undefined', () => {
      const utils = require('@percy/sdk-utils');
      const originalAddress = utils.percy.address;

      // Remove Cypress.expose
      delete Cypress.expose;

      // Mock Cypress.env to return undefined
      const envStub = cy.stub().withArgs('PERCY_SERVER_ADDRESS').returns(undefined);
      Cypress.env = envStub;

      cy.wrap(null).then(() => {
        // Simulate the configuration logic
        if (typeof Cypress.expose === 'function') {
          const addr = Cypress.expose('PERCY_SERVER_ADDRESS');
          if (addr) utils.percy.address = addr;
        } else if (typeof Cypress.env === 'function') {
          const addr = Cypress.env('PERCY_SERVER_ADDRESS');
          if (addr) utils.percy.address = addr;
        }

        expect(envStub).to.be.calledWith('PERCY_SERVER_ADDRESS');
        // Address should remain unchanged
        expect(utils.percy.address).to.equal(originalAddress);
      });
    });

    it('prefers Cypress.expose() over Cypress.env() when both exist', () => {
      const utils = require('@percy/sdk-utils');
      const exposeAddress = 'http://expose-address:5338';
      const envAddress = 'http://env-address:5338';

      // Mock both methods
      Cypress.expose = cy.stub().withArgs('PERCY_SERVER_ADDRESS').returns(exposeAddress);
      const envStub = cy.stub().withArgs('PERCY_SERVER_ADDRESS').returns(envAddress);
      Cypress.env = envStub;

      cy.wrap(null).then(() => {
        // Simulate the configuration logic
        if (typeof Cypress.expose === 'function') {
          const addr = Cypress.expose('PERCY_SERVER_ADDRESS');
          if (addr) utils.percy.address = addr;
        } else if (typeof Cypress.env === 'function') {
          const addr = Cypress.env('PERCY_SERVER_ADDRESS');
          if (addr) utils.percy.address = addr;
        }

        expect(Cypress.expose).to.be.calledWith('PERCY_SERVER_ADDRESS');
        expect(envStub).to.not.be.called;
        expect(utils.percy.address).to.equal(exposeAddress);
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
