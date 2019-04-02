import {clientInfo, environmentInfo} from './environment'
import PercyAgent from '@percy/agent'
import * as path from 'path'

declare const Cypress: any
declare const cy: any

// it will always live in the node_modules path
const HEALTHCHECK_PATH = 'node_modules/@percy/cypress/dist/percy-healthcheck';

Cypress.Commands.add('percySnapshot', (name: string, options: any = {}) => {
  const percyAgentClient = new PercyAgent({ handleAgentCommunication: false })

  // Use cy.exec(...) to check if percy agent is running. Ideally this would be
  // done using something like cy.request(...), but that's not currently possible,
  // for details, see: https://github.com/cypress-io/cypress/issues/3161
  const healthcheckCmd = `node ${HEALTHCHECK_PATH} ${percyAgentClient.port}`
  cy.exec(healthcheckCmd, { failOnNonZeroExit: false }).then((result: any) => {
    if (result.code !== 0) {
      // Percy server not available, or we failed to find the healthcheck.
      cy.log('[percy] Percy agent is not running. Skipping snapshots')
      cy.log(`[percy] Healthcheck output: ${result.stdout}\n${result.stderr}`)

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
