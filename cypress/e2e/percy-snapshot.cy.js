/**
 * Real Percy snapshot tests with custom HTML fixtures.
 *
 * These test the actual responsiveSnapshotCapture feature by:
 * 1. Visiting HTML pages with distinct responsive layouts
 * 2. Taking snapshots at multiple widths
 * 3. Percy captures visual diffs showing layout changes per width
 *
 * Prerequisites:
 *   node serve-fixtures.js &          # Start fixture server on port 8000
 *   PERCY_TOKEN=<token> PERCY_BROWSER_EXECUTABLE=<chrome-path> \
 *     npx percy exec -- npx cypress run --spec cypress/e2e/percy-snapshot.cy.js
 */

const FIXTURE_URL = 'http://localhost:8000';

describe('Percy Snapshot with Custom HTML Fixtures', () => {
  describe('Standard Snapshots', () => {
    it('captures a standard snapshot of the feature page', () => {
      cy.visit(`${FIXTURE_URL}/standard-snapshot.html`);
      cy.get('.hero h1').should('be.visible');

      cy.percySnapshot('Standard Feature Page');
    });

    it('captures a snapshot with percyCSS override', () => {
      cy.visit(`${FIXTURE_URL}/standard-snapshot.html`);
      cy.get('.hero').should('be.visible');

      cy.percySnapshot('Feature Page - Custom CSS', {
        percyCSS: '.hero { background: linear-gradient(135deg, #dc2626, #f97316) !important; }'
      });
    });
  });

  describe('Responsive Snapshot Capture', () => {
    it('captures responsive snapshots showing 3-col, 2-col, and 1-col layouts', () => {
      cy.visit(`${FIXTURE_URL}/responsive-capture.html`);
      cy.get('.card-grid').should('be.visible');

      // This is the key test: at 1280px the grid is 3 columns,
      // at 768px it's 2 columns, at 375px it's 1 column.
      // Percy should capture all 3 layouts as separate visual diffs.
      cy.percySnapshot('Responsive Grid - Desktop/Tablet/Mobile', {
        responsiveSnapshotCapture: true,
        widths: [1280, 768, 375]
      });
    });

    it('captures responsive snapshots at 2 widths showing sidebar collapse', () => {
      cy.visit(`${FIXTURE_URL}/responsive-capture.html`);
      cy.get('.sidebar').should('be.visible');

      // At 1024px sidebar is on the left, at 480px it moves to top
      cy.percySnapshot('Responsive Sidebar - Side vs Top', {
        responsiveSnapshotCapture: true,
        widths: [1024, 480]
      });
    });

    it('captures responsive with snake_case option name', () => {
      cy.visit(`${FIXTURE_URL}/responsive-capture.html`);
      cy.get('.nav').should('be.visible');

      // At 1280px nav is horizontal, at 375px nav is vertical
      cy.percySnapshot('Responsive Nav - Horizontal vs Vertical', {
        responsive_snapshot_capture: true,
        widths: [1280, 375]
      });
    });

    it('captures responsive with minHeight option', () => {
      cy.visit(`${FIXTURE_URL}/responsive-capture.html`);

      cy.percySnapshot('Responsive with MinHeight', {
        responsiveSnapshotCapture: true,
        widths: [1280, 375],
        minHeight: 2000
      });
    });

    it('captures responsive with percyCSS applied per width', () => {
      cy.visit(`${FIXTURE_URL}/responsive-capture.html`);

      cy.percySnapshot('Responsive with Percy CSS', {
        responsiveSnapshotCapture: true,
        widths: [1280, 375],
        percyCSS: '.header { background: #dc2626 !important; }'
      });
    });
  });

  describe('PERCY_RESPONSIVE_CAPTURE_RELOAD_PAGE', () => {
    it('captures different layouts at different widths with page reload', () => {
      // This page uses window.onload to set layout based on width.
      // WITHOUT reload, resizing alone won't change the content.
      // WITH reload, each width gets the correct layout.
      cy.visit(`${FIXTURE_URL}/reload-test.html`);
      cy.get('#nav').should('be.visible');

      Cypress.env('PERCY_RESPONSIVE_CAPTURE_RELOAD_PAGE', 'true');

      cy.percySnapshot('Reload Test - Desktop vs Mobile Menu', {
        responsiveSnapshotCapture: true,
        widths: [1280, 375]
      });

      Cypress.env('PERCY_RESPONSIVE_CAPTURE_RELOAD_PAGE', undefined);
    });

    it('captures responsive snapshots with reload on responsive page', () => {
      cy.visit(`${FIXTURE_URL}/responsive-capture.html`);
      cy.get('.card-grid').should('be.visible');

      Cypress.env('PERCY_RESPONSIVE_CAPTURE_RELOAD_PAGE', 'true');

      cy.percySnapshot('Reload Test - Responsive Grid', {
        responsiveSnapshotCapture: true,
        widths: [1280, 375]
      });

      Cypress.env('PERCY_RESPONSIVE_CAPTURE_RELOAD_PAGE', undefined);
    });
  });

  describe('Cross-Origin Iframe Processing', () => {
    it('detects and processes cross-origin iframes', { defaultCommandTimeout: 60000 }, () => {
      cy.visit(`${FIXTURE_URL}/cross-origin-iframe.html`, { timeout: 30000 });
      cy.get('.cross-origin-frame').should('have.length', 2);

      cy.percySnapshot('Cross-Origin Iframe Page');
    });

    it('captures cross-origin iframes alongside responsive capture', { defaultCommandTimeout: 120000 }, () => {
      cy.visit(`${FIXTURE_URL}/cross-origin-iframe.html`, { timeout: 30000 });
      cy.get('.cross-origin-frame').should('have.length', 2);

      cy.percySnapshot('Cross-Origin Iframe - Responsive', {
        responsiveSnapshotCapture: true,
        widths: [1280, 375]
      });
    });

    it('skips about:blank, srcdoc, and data: iframes', () => {
      cy.visit(`${FIXTURE_URL}/cross-origin-iframe.html`);

      // These iframes should exist but NOT be processed as cross-origin
      cy.get('iframe[src="about:blank"]').should('exist');
      cy.get('iframe[srcdoc]').should('exist');

      cy.percySnapshot('Cross-Origin Iframe - Skip Filters');
    });
  });

  describe('Non-responsive fallback', () => {
    it('takes a normal snapshot when responsiveSnapshotCapture is false', () => {
      cy.visit(`${FIXTURE_URL}/responsive-capture.html`);

      cy.percySnapshot('Non-Responsive Fallback', {
        responsiveSnapshotCapture: false
      });
    });

    it('takes a normal snapshot when no responsive option is passed', () => {
      cy.visit(`${FIXTURE_URL}/responsive-capture.html`);

      cy.percySnapshot('Default Non-Responsive');
    });
  });
});
