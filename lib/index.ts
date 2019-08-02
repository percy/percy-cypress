import {clientInfo, environmentInfo} from './environment'
import PercyAgent from '@percy/agent'

declare const Cypress: any
declare const cy: any

Cypress.Commands.add('percySnapshot', (name: string, options: any = {}) => {
  cy.task('percyHealthCheck').then((percyIsRunning: boolean) => {
    if (percyIsRunning) {
      const percyAgentClient = new PercyAgent({
        handleAgentCommunication: false,
        domTransformation: options.domTransformation
      })

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
    }
  })
})
