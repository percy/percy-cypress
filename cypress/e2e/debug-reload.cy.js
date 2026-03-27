const FIXTURE_URL = 'http://localhost:8000';

describe('Responsive Reload via CLI', () => {
  it('JS page: CLI handles resize + reload at each width', () => {
    // Visit the page that uses window.onload for layout
    cy.visit(`${FIXTURE_URL}/reload-test.html`);
    cy.get('#nav').should('be.visible');

    // With responsiveSnapshotCapture + RELOAD flag:
    // SDK sends NO domSnapshot — Percy CLI navigates to the URL,
    // resizes at each width, reloads (discovery.js:333), and captures
    Cypress.env('PERCY_RESPONSIVE_CAPTURE_RELOAD_PAGE', 'true');
    cy.percySnapshot('CLI Reload Test', {
      responsiveSnapshotCapture: true,
      widths: [1280, 375]
    });
    // Clean up AFTER the snapshot command executes, not synchronously
    cy.then(() => Cypress.env('PERCY_RESPONSIVE_CAPTURE_RELOAD_PAGE', undefined));
  });

  it('CSS responsive: standard path with domSnapshot', () => {
    cy.visit(`${FIXTURE_URL}/responsive-capture.html`);
    cy.get('.card-grid').should('be.visible');

    cy.percySnapshot('CSS Responsive', {
      responsiveSnapshotCapture: true,
      widths: [1280, 768, 375]
    });
  });

  it('standard snapshot: normal path', () => {
    cy.visit(`${FIXTURE_URL}/standard-snapshot.html`);
    cy.get('.hero').should('be.visible');

    cy.percySnapshot('Standard');
  });
});
