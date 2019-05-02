import {clientInfo, environmentInfo} from './environment'
import PercyAgent from '@percy/agent'

declare const Cypress: any
declare const cy: any

Cypress.Commands.add('percySnapshot', (name: string, options: any = {}) => {
  const percyAgentClient = new PercyAgent({
    handleAgentCommunication: false,
    domTransformation: options.domTransformation
  })

  // Use cy.exec(...) to check if percy agent is running. Ideally this would be
  // done using something like cy.request(...), but that's not currently possible,
  // for details, see: https://github.com/cypress-io/cypress/issues/3161
  const healthcheckCmd = `percy health-check -p ${percyAgentClient.port}`
  cy.exec(healthcheckCmd, { failOnNonZeroExit: false }).then(({ stderr }: any) => {
    if (stderr) {
      // Percy server not available
      cy.log('[percy] Percy agent is not running. Skipping snapshots')
      cy.log(stderr)

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
          clientInfo: clientInfo(),
          environmentInfo: environmentInfo(),
          domSnapshot
        }
      })
    })
  })
})
