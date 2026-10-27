import '../support/sdk-utils-instance';
import helpers from '@percy/sdk-utils/test/helpers';

const readConfig = key => typeof Cypress.expose === 'function' ? Cypress.expose(key) : Cypress.env(key);
const domain = readConfig('PERCY_TEST_DOMAIN');

// Since Cypress 14 sibling subdomains are separate origins, and cy.document()
// from the spec fails once the page has navigated to one.
describe('percySnapshot after a subdomain hop', () => {
  let pageA;
  let pageB;

  before(function() {
    if (!domain) this.skip();
  });

  beforeEach(() => {
    cy.then(helpers.setupTest);
    cy.then(() => {
      const { port } = new URL(readConfig('PERCY_SERVER_ADDRESS') || helpers.testSnapshotURL);
      pageA = `http://a.${domain}:${port}/test/snapshot`;
      pageB = `http://b.${domain}:${port}/test/snapshot`;
    });
  });

  const lastSnapshot = () => cy.then(() => helpers.get('requests'))
    .then(reqs => reqs.filter(r => r.url === '/percy/snapshot').pop()?.body);

  it('captures the page on the other origin without failing the test', () => {
    cy.then(() => cy.visit(pageA));
    cy.percySnapshot('Subdomain A');
    lastSnapshot().its('url').should('equal', pageA);

    cy.window().then(win => { win.location.href = pageB; });
    cy.then(() => cy.origin(new URL(pageB).origin, () => {
      cy.location('hostname').should('match', /^b\./);
    }));

    cy.percySnapshot('Subdomain B');

    lastSnapshot().then(body => {
      expect(body.name).to.equal('Subdomain B');
      expect(body.url).to.equal(pageB);
      expect(body.domSnapshot.html).to.include('<body');
      expect(body.domSnapshot.html).not.to.include('injection_cross_origin');
    });

    // Back on the primary origin the direct path is used again.
    cy.then(() => cy.visit(pageA));
    cy.percySnapshot('Subdomain A again');
    lastSnapshot().its('url').should('equal', pageA);
  });
});
