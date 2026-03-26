const FIXTURE_URL = 'http://localhost:8000';

describe('Debug Reload with Percy', () => {
  it('manual responsive capture with reload - should show different menus', () => {
    // Manually do what captureResponsiveDOMWithCypress should do

    // Width 1: 1280 → Desktop
    cy.viewport(1280, 720);
    cy.visit(`${FIXTURE_URL}/reload-test.html`);
    cy.get('#nav').should('contain', 'Desktop Menu');
    cy.percySnapshot('Manual Reload - 1280 Desktop');

    // Width 2: 375 → Mobile (visit again to trigger onload at new width)
    cy.viewport(375, 667);
    cy.visit(`${FIXTURE_URL}/reload-test.html`);
    cy.get('#nav').should('contain', 'Mobile Menu');
    cy.percySnapshot('Manual Reload - 375 Mobile');
  });

  it('automatic responsive - let Percy CLI handle it (single DOM + flag)', () => {
    // Percy CLI checks responsiveSnapshotCapture flag and handles
    // multi-width capture + reload itself during asset discovery.
    // The SDK just sends a single DOM with the flag.
    cy.visit(`${FIXTURE_URL}/reload-test.html`);
    cy.get('#nav').should('be.visible');

    cy.percySnapshot('CLI Responsive Reload Test', {
      responsiveSnapshotCapture: true,
      widths: [1280, 375]
    });
  });

  it('verify responsive actually visits at each width', () => {
    // This test verifies that our responsive capture chain
    // actually changes the viewport and reloads between captures
    cy.visit(`${FIXTURE_URL}/reload-test.html`);

    // Simulate what captureResponsiveDOMWithCypress should do
    const snapshots = [];

    // Width 1280
    cy.viewport(1280, 720);
    cy.url().then((url) => {
      const u = new URL(url);
      u.searchParams.set('_percy_reload', '1280');
      cy.visit(u.toString());
    });
    cy.get('#nav').should('contain', 'Desktop');
    cy.window().its('innerWidth').should('eq', 1280);
    cy.document().then((doc) => {
      snapshots.push({ width: 1280, navText: doc.getElementById('nav').innerText });
    });

    // Width 375
    cy.viewport(375, 667);
    cy.url().then((url) => {
      const u = new URL(url);
      u.searchParams.set('_percy_reload', '375');
      cy.visit(u.toString());
    });
    cy.get('#nav').should('contain', 'Mobile');
    cy.window().its('innerWidth').should('eq', 375);
    cy.document().then((doc) => {
      snapshots.push({ width: 375, navText: doc.getElementById('nav').innerText });
    });

    // Verify both snapshots captured different content
    cy.then(() => {
      expect(snapshots).to.have.length(2);
      expect(snapshots[0].navText).to.contain('Desktop');
      expect(snapshots[1].navText).to.contain('Mobile');
    });
  });
});
