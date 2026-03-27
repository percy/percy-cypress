const FIXTURE_URL = 'http://localhost:8000';

describe('Responsive Reload Capture', () => {
  it('verifies viewport + visit works (assertion test)', () => {
    // Prove that cy.viewport() THEN cy.visit() shows correct layout
    cy.viewport(1280, 720);
    cy.visit(`${FIXTURE_URL}/reload-test.html`);
    cy.get('#nav').should('contain', 'Desktop Menu');
    cy.window().its('innerWidth').should('eq', 1280);

    cy.viewport(375, 667);
    cy.visit(`${FIXTURE_URL}/reload-test.html`);
    cy.get('#nav').should('contain', 'Mobile Menu');
    cy.window().its('innerWidth').should('eq', 375);
  });

  it('responsive reload: JS page shows different layouts per width', () => {
    cy.visit(`${FIXTURE_URL}/reload-test.html`);
    cy.get('#nav').should('be.visible');

    Cypress.env('PERCY_RESPONSIVE_CAPTURE_RELOAD_PAGE', 'true');
    cy.percySnapshot('Reload - Desktop vs Mobile', {
      responsiveSnapshotCapture: true,
      widths: [1280, 375]
    });
    Cypress.env('PERCY_RESPONSIVE_CAPTURE_RELOAD_PAGE', undefined);
  });

  it('responsive CSS: works without reload', () => {
    cy.visit(`${FIXTURE_URL}/responsive-capture.html`);
    cy.get('.card-grid').should('be.visible');

    cy.percySnapshot('CSS Responsive Grid', {
      responsiveSnapshotCapture: true,
      widths: [1280, 768, 375]
    });
  });
});
