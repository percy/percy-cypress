/// <reference types=".."/>
import { expectType, expectError } from 'tsd';

expectType<Cypress.Chainable<undefined>>(cy.percySnapshot());
expectType<Cypress.Chainable<undefined>>(cy.percySnapshot('Snapshot name'));
expectType<Cypress.Chainable<undefined>>(cy.percySnapshot('Snapshot name', { widths: [1000] }));

expectError(cy.percySnapshot('Snapshot name', { foo: 'bar' }));
