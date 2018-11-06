import {clientInfo, environmentInfo} from './environment'
import PercyAgent from '@percy/agent'

declare const Cypress: any
declare const cy: any

Cypress.Commands.add('percySnapshot', (name: string, options: any = {}) => {
  const percyAgentClient = new PercyAgent({
    clientInfo: clientInfo(),
    environmentInfo: environmentInfo()
  })

  name = name || cy.state('runnable').fullTitle()

  cy.document().then((doc: Document) => {
    options.document = doc

    try {
      percyAgentClient.snapshot(name, options)
    } catch (e) {
      cy.log('WARNING! percy is not started. See https://docs.percy.io for help.')
    }
  })
})
