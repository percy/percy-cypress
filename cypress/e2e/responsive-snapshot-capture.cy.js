/**
 * Integration tests for Responsive Snapshot Capture feature
 *
 * Tests Percy's ability to capture DOM snapshots at multiple viewport widths
 * and serialize responsive layouts for visual testing.
 *
 * Prerequisites:
 * - Run with: percy exec --testing -- cypress run --spec cypress/e2e/responsive-snapshot-capture.cy.js
 *
 * The responsiveSnapshotCapture feature:
 * 1. Takes snapshots at multiple configured viewport widths
 * 2. Serializes the DOM at each width
 * 3. Sends array of DOM snapshots to Percy CLI for comparison
 */

import helpers from '@percy/sdk-utils/test/helpers';

describe('Responsive Snapshot Capture', () => {
  const testFixturePath = 'cypress/fixtures/html/responsive-snapshot-capture.html';
  const viewportWidths = [375, 768, 1024, 1280];

  beforeEach(() => {
    cy.then(helpers.setupTest);
  });

  describe('Single Width Snapshots', () => {
    it('captures snapshot at mobile width (375px)', () => {
      cy.visit(testFixturePath);
      cy.viewport(375, 667);
      cy.percySnapshot('Responsive Layout - Mobile 375px');

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Responsive Layout - Mobile 375px');
    });

    it('captures snapshot at tablet width (768px)', () => {
      cy.visit(testFixturePath);
      cy.viewport(768, 1024);
      cy.percySnapshot('Responsive Layout - Tablet 768px');

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Responsive Layout - Tablet 768px');
    });

    it('captures snapshot at large tablet width (1024px)', () => {
      cy.visit(testFixturePath);
      cy.viewport(1024, 768);
      cy.percySnapshot('Responsive Layout - Large Tablet 1024px');

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Responsive Layout - Large Tablet 1024px');
    });

    it('captures snapshot at desktop width (1280px)', () => {
      cy.visit(testFixturePath);
      cy.viewport(1280, 720);
      cy.percySnapshot('Responsive Layout - Desktop 1280px');

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Responsive Layout - Desktop 1280px');
    });
  });

  describe('Responsive Layout Changes', () => {
    it('shows mobile layout at 375px with single column grid', () => {
      cy.visit(testFixturePath);
      cy.viewport(375, 667);

      // Verify viewport indicator shows correct width
      cy.get('#viewportIndicator').should('contain', '375px');

      // Verify layout state indicator shows mobile
      cy.get('#layoutState').should('contain', 'Small Mobile');

      // Verify single column grid
      cy.get('.features-grid').should('have.css', 'grid-template-columns')
        .and('match', /^1fr/);

      cy.percySnapshot('Mobile - Single Column Layout at 375px');
    });

    it('shows tablet layout at 768px with two column grid', () => {
      cy.visit(testFixturePath);
      cy.viewport(768, 1024);

      // Verify viewport indicator shows correct width
      cy.get('#viewportIndicator').should('contain', '768px');

      // Verify layout state indicates tablet
      cy.get('#layoutState').should('contain', 'Tablet');

      // Verify two column grid
      cy.get('.features-grid').should('have.css', 'grid-template-columns')
        .and('match', /2/);

      cy.percySnapshot('Tablet - Two Column Layout at 768px');
    });

    it('shows desktop layout at 1024px with three column grid', () => {
      cy.visit(testFixturePath);
      cy.viewport(1024, 768);

      // Verify viewport indicator shows correct width
      cy.get('#viewportIndicator').should('contain', '1024px');

      // Verify layout state indicates desktop
      cy.get('#layoutState').should('contain', 'Desktop');

      // Verify three column grid
      cy.get('.features-grid').should('have.css', 'grid-template-columns')
        .and('match', /3/);

      cy.percySnapshot('Desktop - Three Column Layout at 1024px');
    });

    it('shows large desktop layout at 1280px with expanded content', () => {
      cy.visit(testFixturePath);
      cy.viewport(1280, 720);

      // Verify viewport indicator shows correct width
      cy.get('#viewportIndicator').should('contain', '1280px');

      // Verify layout state indicates large desktop
      cy.get('#layoutState').should('contain', 'Desktop');

      cy.percySnapshot('Large Desktop - Full Layout at 1280px');
    });
  });

  describe('Navigation Responsiveness', () => {
    it('hides hamburger menu on desktop (1280px)', () => {
      cy.visit(testFixturePath);
      cy.viewport(1280, 720);

      cy.get('#hamburger').should('not.be.visible');
      cy.get('#navLinks').should('be.visible');

      cy.percySnapshot('Desktop Navigation - Full Links Visible');
    });

    it('shows hamburger menu on mobile (375px)', () => {
      cy.visit(testFixturePath);
      cy.viewport(375, 667);

      cy.get('#hamburger').should('be.visible');
      // Menu should be hidden by default
      cy.get('#navLinks').should('not.have.class', 'active');

      cy.percySnapshot('Mobile Navigation - Hamburger Menu Visible');
    });

    it('toggles mobile menu when hamburger is clicked', () => {
      cy.visit(testFixturePath);
      cy.viewport(375, 667);

      // Menu should be hidden initially
      cy.get('#navLinks').should('not.have.class', 'active');

      // Click hamburger
      cy.get('#hamburger').click();

      // Menu should be visible now
      cy.get('#navLinks').should('have.class', 'active');
      cy.get('#navLinks').should('be.visible');

      cy.percySnapshot('Mobile Navigation - Menu Expanded');

      // Click hamburger again to close
      cy.get('#hamburger').click();
      cy.get('#navLinks').should('not.have.class', 'active');
    });
  });

  describe('Typography Scaling', () => {
    it('scales heading sizes appropriately at different widths', () => {
      const headingSizes = {
        375: '24px', // Small mobile
        768: '36px', // Tablet
        1024: '36px', // Large tablet
        1280: '48px' // Desktop
      };

      viewportWidths.forEach((width) => {
        cy.visit(testFixturePath);
        cy.viewport(width, 667);

        cy.get('.hero h1')
          .should('have.css', 'font-size')
          .and('be.closeTo', headingSizes[width], 2);
      });
    });
  });

  describe('Content Reflow', () => {
    it('refluxes content correctly when resizing from mobile to desktop', () => {
      cy.visit(testFixturePath);

      // Start at mobile
      cy.viewport(375, 667);
      cy.get('#layoutState').should('contain', 'Small Mobile');
      cy.percySnapshot('Reflow - Initial Mobile View 375px');

      // Resize to tablet
      cy.viewport(768, 1024);
      cy.get('#layoutState').should('contain', 'Tablet');
      cy.percySnapshot('Reflow - Resized to Tablet 768px');

      // Resize to desktop
      cy.viewport(1280, 720);
      cy.get('#layoutState').should('contain', 'Desktop');
      cy.percySnapshot('Reflow - Resized to Desktop 1280px');
    });
  });

  describe('Feature Cards Grid Layout', () => {
    it('displays all 6 feature cards across all widths', () => {
      viewportWidths.forEach((width) => {
        cy.visit(testFixturePath);
        cy.viewport(width, 667);

        cy.get('.feature-card').should('have.length', 6);
        cy.percySnapshot(`Feature Cards - All 6 Cards Visible at ${width}px`);
      });
    });

    it('maintains card content visibility at all breakpoints', () => {
      viewportWidths.forEach((width) => {
        cy.visit(testFixturePath);
        cy.viewport(width, 667);

        // Verify all cards contain their content
        cy.get('.feature-card').each(($card) => {
          cy.wrap($card).find('h3').should('be.visible');
          cy.wrap($card).find('p').should('be.visible');
          cy.wrap($card).find('.feature-icon').should('be.visible');
        });
      });
    });
  });

  describe('Responsive Snapshot Capture with Options', () => {
    it('captures responsive snapshot with minHeight option', () => {
      cy.visit(testFixturePath);
      cy.viewport(375, 667);

      cy.percySnapshot('Mobile with minHeight', { minHeight: 2000 });

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Mobile with minHeight');
    });

    it('captures responsive snapshot with percyCSS option', () => {
      cy.visit(testFixturePath);
      cy.viewport(768, 1024);

      const customCSS = '.feature-card { border: 2px solid red; }';
      cy.percySnapshot('Tablet with Custom CSS', { percyCSS: customCSS });

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Tablet with Custom CSS');
    });

    it('captures responsive snapshot with sync option', () => {
      cy.visit(testFixturePath);
      cy.viewport(1280, 720);

      cy.percySnapshot('Desktop with Sync', { sync: true });

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Desktop with Sync');
    });
  });

  describe('Responsive Snapshot Capture Integration', () => {
    it('visits test page and captures multiple responsive snapshots in sequence', () => {
      cy.visit(testFixturePath);

      // Mobile snapshot
      cy.viewport(375, 667);
      cy.percySnapshot('Responsive - Mobile First');

      // Tablet snapshot
      cy.viewport(768, 1024);
      cy.percySnapshot('Responsive - Tablet Medium');

      // Desktop snapshot
      cy.viewport(1024, 768);
      cy.percySnapshot('Responsive - Desktop Large');

      // Extra large desktop
      cy.viewport(1280, 720);
      cy.percySnapshot('Responsive - Desktop XL');

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Responsive - Mobile First')
        .should('include', 'Snapshot found: Responsive - Tablet Medium')
        .should('include', 'Snapshot found: Responsive - Desktop Large')
        .should('include', 'Snapshot found: Responsive - Desktop XL');
    });
  });

  describe('Edge Cases and Boundary Widths', () => {
    it('handles boundary width 767px (just below tablet)', () => {
      cy.visit(testFixturePath);
      cy.viewport(767, 1024);

      cy.get('#layoutState').should('contain', 'Mobile');
      cy.percySnapshot('Boundary - Mobile at 767px');
    });

    it('handles boundary width 768px (tablet breakpoint)', () => {
      cy.visit(testFixturePath);
      cy.viewport(768, 1024);

      cy.get('#layoutState').should('contain', 'Tablet');
      cy.percySnapshot('Boundary - Tablet at 768px');
    });

    it('handles boundary width 1023px (just below large tablet)', () => {
      cy.visit(testFixturePath);
      cy.viewport(1023, 768);

      cy.get('#layoutState').should('contain', 'Tablet');
      cy.percySnapshot('Boundary - Tablet at 1023px');
    });

    it('handles boundary width 1024px (large tablet breakpoint)', () => {
      cy.visit(testFixturePath);
      cy.viewport(1024, 768);

      cy.get('#layoutState').should('contain', 'Desktop');
      cy.percySnapshot('Boundary - Desktop at 1024px');
    });

    it('handles extra small mobile width (320px)', () => {
      cy.visit(testFixturePath);
      cy.viewport(320, 568);

      cy.get('#layoutState').should('contain', 'Small Mobile');
      cy.percySnapshot('Boundary - Extra Small Mobile at 320px');
    });

    it('handles extra large desktop width (1920px)', () => {
      cy.visit(testFixturePath);
      cy.viewport(1920, 1080);

      cy.get('#layoutState').should('contain', 'Desktop');
      cy.percySnapshot('Boundary - Extra Large Desktop at 1920px');
    });
  });
});
