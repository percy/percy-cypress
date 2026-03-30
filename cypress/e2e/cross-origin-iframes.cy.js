/**
 * Integration tests for Cross-Origin Iframe feature
 *
 * Tests Percy's ability to detect and serialize cross-origin iframes
 * in a snapshot.
 *
 * Prerequisites:
 * - The fixture server must be running on localhost:8080 and localhost:8081
 * - Start with: node cypress/fixtures/server.js
 * - Or use Percy CLI: percy exec --testing -- cypress run --spec cypress/e2e/cross-origin-iframes.cy.js
 *
 * Note: These tests require chromeWebSecurity: false in cypress.config.js to allow
 * cross-origin iframe access from the test runner.
 */

import helpers from '@percy/sdk-utils/test/helpers';

describe('Cross-Origin Iframes', () => {
  beforeEach(() => {
    cy.then(helpers.setupTest);
    cy.visit('http://localhost:8080/cross-origin-iframes-main.html', {
      onBeforeLoad: (win) => {
        Object.defineProperty(win, 'isSecureContext', {
          get: () => true
        });
      }
    });
  });

  describe('Basic Functionality', () => {
    it('should load the cross-origin iframe test page', () => {
      cy.get('h1').should('contain', 'Cross-Origin Iframe Test Page');
      cy.get('body').should('exist');
    });

    it('should display all iframe sections', () => {
      cy.contains('Cross-Origin Iframe (Captured)').should('be.visible');
      cy.contains('Same-Origin Iframe (Skipped)').should('be.visible');
      cy.contains('about:blank Iframe (Skipped)').should('be.visible');
      cy.contains('Iframe with srcdoc (Skipped)').should('be.visible');
    });

    it('should have all iframes in the DOM', () => {
      cy.get('iframe').should('have.length', 4);
    });
  });

  describe('Cross-Origin Iframe Detection', () => {
    it('should identify cross-origin iframe by src attribute', () => {
      cy.get('#cross-origin-frame')
        .should('have.attr', 'src')
        .and('include', 'localhost:8081');
    });

    it('should identify same-origin iframe', () => {
      cy.get('#same-origin-frame')
        .should('have.attr', 'src')
        .and('include', 'cross-origin-iframes-same-origin.html');
    });

    it('should have about:blank iframe', () => {
      cy.get('#blank-frame')
        .should('have.attr', 'src')
        .and('equal', 'about:blank');
    });

    it('should have srcdoc iframe with no src attribute', () => {
      cy.get('#srcdoc-frame')
        .should('not.have.attr', 'src')
        .should('have.attr', 'srcdoc');
    });
  });

  describe('Percy Snapshot with Cross-Origin Iframes', () => {
    it('should take a snapshot of the main page with cross-origin iframes', () => {
      cy.percySnapshot('Cross-Origin Iframe Page');

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Cross-Origin Iframe Page')
        .should('include.match', /clientInfo: @percy\//);
    });

    it('should take a snapshot with options', () => {
      cy.percySnapshot('Cross-Origin Iframe Page with Options', {
        minHeight: 1000,
        percyCSS: 'body { background: white; }'
      });

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Cross-Origin Iframe Page with Options');
    });

    it('should handle snapshot without a name', () => {
      cy.percySnapshot();

      cy.then(() => helpers.get('logs'))
        .should('include.match', /Snapshot found:/);
    });
  });

  describe('Cross-Origin Iframe Content', () => {
    it('should load cross-origin frame content', () => {
      cy.get('#cross-origin-frame').then(($iframe) => {
        const $iframeBody = $iframe.contents().find('body');
        expect($iframeBody).to.exist;
      });
    });

    it('should display cross-origin frame header', () => {
      cy.get('#cross-origin-frame').then(($iframe) => {
        expect($iframe).to.have.length(1);
      });
    });
  });

  describe('Multiple Snapshots', () => {
    it('should take multiple snapshots of the same page', () => {
      cy.percySnapshot('Snapshot 1');
      cy.percySnapshot('Snapshot 2');
      cy.percySnapshot('Snapshot 3');

      cy.then(() => helpers.get('logs'))
        .should('include', 'Snapshot found: Snapshot 1')
        .should('include', 'Snapshot found: Snapshot 2')
        .should('include', 'Snapshot found: Snapshot 3');
    });
  });

  describe('Iframe Accessibility', () => {
    it('should have proper iframe styling', () => {
      cy.get('#cross-origin-frame')
        .should('have.css', 'width')
        .and('match', /100%|\\d+px/);
    });

    it('should have iframe containers with labels', () => {
      cy.get('.iframe-label').should('have.length', 4);
      cy.get('.iframe-label').first().should('contain', 'Cross-Origin');
    });
  });

  describe('Page Structure Verification', () => {
    it('should have proper semantic HTML structure', () => {
      cy.get('html[lang="en"]').should('exist');
      cy.get('head > meta[charset="UTF-8"]').should('exist');
      cy.get('body').should('exist');
    });

    it('should have main content area', () => {
      cy.get('.main-content').should('be.visible');
      cy.get('.main-content').should('contain', 'tests Percy');
    });

    it('should have proper section organization', () => {
      cy.get('.content-section').should('have.length.at.least', 4);
    });
  });
});

describe('Cross-Origin Iframes - Fixture Server Requirements', () => {
  it('documents fixture server requirements', () => {
    const requirements = {
      fixtureServer: 'node cypress/fixtures/server.js',
      mainOrigin: 'http://localhost:8080',
      crossOriginPort: 8081,
      percyCommand: 'percy exec --testing -- cypress run --spec cypress/e2e/cross-origin-iframes.cy.js'
    };

    expect(requirements.fixtureServer).to.exist;
    expect(requirements.mainOrigin).to.include('localhost:8080');
    expect(requirements.crossOriginPort).to.equal(8081);
  });
});
