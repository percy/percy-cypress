/// <reference types=".."/>
import { expectType, expectError } from 'tsd';
import { createRegion, Region } from '..';

expectType<Cypress.Chainable<undefined>>(cy.percySnapshot());
expectType<Cypress.Chainable<undefined>>(cy.percySnapshot('Snapshot name'));
expectType<Cypress.Chainable<undefined>>(cy.percySnapshot('Snapshot name', { widths: [1000] }));

expectError(cy.percySnapshot('Snapshot name', { foo: 'bar' }));

// Test createRegion function
expectType<Region>(createRegion({ boundingBox: { x: 0, y: 0, width: 400, height: 100 }, algorithm: 'ignore' }));
expectType<Region>(createRegion({ elementXpath: '//div[@id="test"]', algorithm: 'standard' }));
expectType<Region>(createRegion({ elementCSS: '.test-class', algorithm: 'intelliignore' }));

// Test regions in percySnapshot
const region1 = createRegion({ boundingBox: { x: 0, y: 0, width: 400, height: 100 }, algorithm: 'ignore' });
expectType<Cypress.Chainable<undefined>>(cy.percySnapshot('Snapshot name', { regions: [region1] }));
expectType<Cypress.Chainable<undefined>>(cy.percySnapshot('Snapshot name', { 
  regions: [
    createRegion({ boundingBox: { x: 0, y: 0, width: 400, height: 100 }, algorithm: 'ignore' })
  ]
}));

// Test region with all options
expectType<Region>(createRegion({
  boundingBox: { x: 0, y: 0, width: 400, height: 100 },
  algorithm: 'standard',
  diffSensitivity: 0.5,
  imageIgnoreThreshold: 0.1,
  carouselsEnabled: true,
  bannersEnabled: false,
  adsEnabled: true,
  diffIgnoreThreshold: 0.2
}));
