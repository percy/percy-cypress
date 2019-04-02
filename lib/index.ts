import {clientInfo, environmentInfo} from './environment'
import PercyAgent from '@percy/agent'
import * as path from 'path'

declare const Cypress: any
declare const cy: any

Cypress.Commands.add('percySnapshot', (name: string, options: any = {}) => {
  const percyAgentClient = new PercyAgent({ handleAgentCommunication: false })

  // Use cy.exec(...) to check if percy agent is running. Ideally this would be
  // done using something like cy.request(...), but that's not currently possible,
  // for details, see: https://github.com/cypress-io/cypress/issues/3161
  const healthcheck = `node ${_healthcheckPath()} ${percyAgentClient.port}`
  cy.exec(healthcheck, {failOnNonZeroExit: false}).then((result: any) => {
    if (result.code != 0) {
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

const checkResolved = (x: string) => {
  // we are resolving a path to the module
  // and Webpack changes it to a number, then something is wrong
  if (typeof x !== 'string') {
    throw new Error('Should be a string')
  }
  return x
}

// An attempt to resiliently find the path to the 'percy-healthcheck' script, and to do so
// in a cross-platform manner.
function _healthcheckPath() {
  try {
    // Try to resolve with respect to the install local module.
    return checkResolved(require.resolve('@percy/cypress/dist/percy-healthcheck'))
  } catch {
    try {
      // Try to resolve relative to the current file.
      return checkResolved(require.resolve('./percy-healthcheck'))
    } catch {
      // Oh well. Assume it's in the local node_modules.
      // It would be nice to use __dirname here, but this code is entirely executed inside of
      // Cypress' unusual context, making __dirname always '/dist' for this file, which is
      // unhelpful when trying to find a working filesystem path to percy-healthcheck.
      return path.join('.', './node_modules/@percy/cypress/dist/percy-healthcheck')
    }
  }
}
