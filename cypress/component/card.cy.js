import helpers from '@percy/sdk-utils/test/helpers';
import { createElement as h } from 'react';
import Card from './Card';

const lastSnapshot = () => cy.then(() => helpers.get('requests'))
  .then(reqs => reqs.filter(r => r.url === '/percy/snapshot').pop()?.body);

describe('percySnapshot in component tests', () => {
  // helpers.setupTest() would clear PERCY_SERVER_ADDRESS, which under Vite is
  // the same process.env the SDK reads its address from.
  beforeEach(() => {
    cy.then(() => helpers.test('reset'));
  });

  it('snapshots the mounted component at the test viewport', () => {
    cy.viewport(400, 300);
    cy.mount(h(Card, { title: 'Percy card' }));
    cy.get('button').click();
    cy.get('.count').should('have.text', '1');
    cy.percySnapshot('Component card');

    lastSnapshot().then(body => {
      expect(body.name).to.equal('Component card');
      expect(body.widths).to.deep.equal([400]);
      expect(body.minHeight).to.equal(300);
      expect(body.scope).to.equal('[data-cy-root]');
      expect(body.url).not.to.include('specPath');
      expect(body.domSnapshot.html).to.include('data-cy-root');
      expect(body.domSnapshot.html).to.include('Percy card');
    });
  });

  it('keeps per-snapshot options and the opt-out', () => {
    cy.mount(h(Card, { title: 'Percy card' }));
    cy.percySnapshot('Component card wide', { widths: [1024] });
    lastSnapshot().its('widths').should('deep.equal', [1024]);

    cy.percySnapshot('Component card full page', { percyComponentDefaults: false });
    lastSnapshot().then(body => {
      expect(body).not.to.have.property('scope');
      expect(body.url).to.include('specPath');
    });
  });
});
