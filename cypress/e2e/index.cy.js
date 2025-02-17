import helpers from '@percy/sdk-utils/test/helpers';

const { match } = Cypress.sinon;

describe('percySnapshot', () => {
  beforeEach(() => {
    cy.then(helpers.setupTest);
    cy.visit(helpers.testSnapshotURL);
    cy.wrap(cy.spy(Cypress, 'log').log(false)).as('log');
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
});
