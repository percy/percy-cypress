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

  it('handles snapshot failures', () => {
    cy.then(() => helpers.test('error', '/percy/snapshot'));

    cy.percySnapshot();

    cy.then(() => helpers.logger.stderr).should('include.members', [
      '[percy] Could not take DOM snapshot "percySnapshot handles snapshot failures"'
    ]);
  });

  it('it should throw error on failure when throwErrorOnFailure is true', () => {
    cy.then(() => helpers.test('error', '/percy/snapshot'));

    expect(() => cy.percySnapshot('name', null, true))
      .toThrowError('error');
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
});
