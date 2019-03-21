import {clientInfo, environmentInfo} from './environment'
import PercyAgent from '@percy/agent'

declare const Cypress: any
declare const cy: any

Cypress.Commands.add('percySnapshot', (name: string, options: any = {}) => {
  const percyAgentClient = new PercyAgent({ handleAgentCommunication: false })

  // Use cy.exec(...) to check if percy agent is running. Ideally this would be
  // done using something like cy.request(...), but that's not currently possible,
  // for details, see: https://github.com/cypress-io/cypress/issues/3161
  // We rely on node finding the percy-healtcheck binary and running it correctly,
  // which is more cross-platform friendly than running the script directly ourselves.
  const healthcheck = `node percy-healthcheck ${percyAgentClient.port}`
  cy.exec(healthcheck, {failOnNonZeroExit: false}).then((result: any) => {
    if (result.code != 0) {
      // Percy server not available, or we failed to find the healthcheck.
      cy.log('[percy] Percy agent is not running. Skipping snapshots')
      return
    }

    name = name || cy.state('runnable').fullTitle()

    cy.document().then((doc: Document) => {
      options.document = doc
      const domSnapshot = percyAgentClient.snapshot(name, options)
      return cy.request({
        method: 'POST',
        url: `http://localhost:${percyAgentClient.port}/percy/snapshot`,
        failOnStatusCode: false,
        body: {
          name,
          url: doc.URL,
          enableJavaScript: options.enableJavaScript,
          widths: options.widths,
          clientInfo,
          environmentInfo,
          domSnapshot
        }
      })
    })
  })
})
