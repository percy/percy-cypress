import helpers from '@percy/sdk-utils/test/client';

const { match } = Cypress.sinon;

describe('percySnapshot', () => {
  beforeEach(() => {
    cy.then(helpers.setup);
    cy.visit('http://localhost:8000');
    cy.wrap(cy.spy(Cypress, 'log').log(false)).as('log');
  });

  afterEach(() => {
    cy.then(helpers.teardown);
  });

  it('disables snapshots when the healthcheck fails', () => {
    cy.then(() => helpers.testFailure('/percy/healthcheck'));

    cy.percySnapshot();
    cy.percySnapshot('Snapshot 2');

    cy.then(helpers.getRequests).should('deep.equal', [
      ['/percy/healthcheck']
    ]);

    cy.wrap(helpers.logger.stderr).should('deep.equal', []);
    cy.wrap(helpers.logger.stdout).should('deep.equal', [
      '[percy] Percy is not running, disabling snapshots'
    ]);
  });

  it('posts snapshots to the local percy server', () => {
    cy.percySnapshot();
    cy.percySnapshot('Snapshot 2');

    cy.then(helpers.getRequests).should(requests => {
      // test stub so we can utilize sinon matchers
      let test = cy.stub(); test(requests);

      expect(test).to.be.calledWith(match([
        match(['/percy/healthcheck']),
        match(['/percy/dom.js']),
        match(['/percy/snapshot', match({
          name: 'percySnapshot posts snapshots to the local percy server',
          url: 'http://localhost:8000/',
          domSnapshot: match(/<html><head>(.*?)<\/head><body>Snapshot Me<\/body><\/html>/),
          clientInfo: match(/@percy\/cypress\/.+/),
          environmentInfo: match(/cypress\/.+/)
        })]),
        match(['/percy/snapshot', match({
          name: 'Snapshot 2'
        })])
      ]));
    });
  });

  it('handles snapshot failures', () => {
    cy.then(() => helpers.testFailure('/percy/snapshot'));

    cy.percySnapshot();

    cy.wrap(helpers.logger.stdout).should('deep.equal', []);
    cy.wrap(helpers.logger.stderr).should('deep.equal', [
      '[percy] Could not take DOM snapshot "percySnapshot handles snapshot failures"',
      '[percy] Error: 500 Internal Server Error'
    ]);
  });
});
