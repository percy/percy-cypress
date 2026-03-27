const FIXTURE_URL = 'http://localhost:8000';

describe('Responsive Reload Capture', () => {
  it('JS-driven page: shows Desktop at 1280 and Mobile at 375 with reload', () => {
    // reload-test.html uses window.onload to set layout based on width.
    // Without reload, resizing alone won't change the content.
    // With PERCY_RESPONSIVE_CAPTURE_RELOAD_PAGE=true, each width gets
    // a separate cy.viewport() + cy.visit() + percySnapshot() cycle.
    cy.visit(`${FIXTURE_URL}/reload-test.html`);
    cy.get('#nav').should('be.visible');

    Cypress.env('PERCY_RESPONSIVE_CAPTURE_RELOAD_PAGE', 'true');
    cy.percySnapshot('Reload Test - Desktop vs Mobile', {
      responsiveSnapshotCapture: true,
      widths: [1280, 375]
    });
    Cypress.env('PERCY_RESPONSIVE_CAPTURE_RELOAD_PAGE', undefined);
  });

  it('CSS-driven page: responsive capture without reload', () => {
    // responsive-capture.html uses CSS media queries.
    // Percy CLI handles multi-width rendering — no reload needed.
    cy.visit(`${FIXTURE_URL}/responsive-capture.html`);
    cy.get('.card-grid').should('be.visible');

    cy.percySnapshot('CSS Responsive - Grid Layout', {
      responsiveSnapshotCapture: true,
      widths: [1280, 768, 375]
    });
  });

  it('standard snapshot without responsive flag', () => {
    cy.visit(`${FIXTURE_URL}/standard-snapshot.html`);
    cy.get('.hero').should('be.visible');

    cy.percySnapshot('Standard Snapshot');
  });
});
