const FIXTURE_URL = 'http://localhost:8000';

describe('Responsive Reload via cy.percySnapshot', () => {
  it('JS page: one snapshot with multiple width DOMs', () => {
    cy.visit(`${FIXTURE_URL}/responsive-js-test.html`);
    cy.get('#content').should('be.visible');

    Cypress.env('PERCY_RESPONSIVE_CAPTURE_RELOAD_PAGE', 'true');
    cy.percySnapshot('JS Responsive Single', {
      responsiveSnapshotCapture: true,
      widths: [1280, 768, 375]
    });
    cy.then(() => Cypress.env('PERCY_RESPONSIVE_CAPTURE_RELOAD_PAGE', undefined));
  });

  it('reload-test: one snapshot with Desktop + Mobile DOMs', () => {
    cy.visit(`${FIXTURE_URL}/reload-test.html`);
    cy.get('#nav').should('be.visible');

    Cypress.env('PERCY_RESPONSIVE_CAPTURE_RELOAD_PAGE', 'true');
    cy.percySnapshot('Reload Single Snapshot', {
      responsiveSnapshotCapture: true,
      widths: [1280, 375]
    });
    cy.then(() => Cypress.env('PERCY_RESPONSIVE_CAPTURE_RELOAD_PAGE', undefined));
  });
});
