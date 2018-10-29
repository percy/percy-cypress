declare var Cypress: any

export function clientInfo(): string {
  const version: string = require('../package.json').version
  const name: string = require('../package.json').name
  return `${name}/${version}`
}

export function environmentInfo(): string {
  return `cypress/${_cypressVersion()}`
}

function _cypressVersion(): string {
  try {
    return Cypress.version
  } catch {
    return 'unknown'
  }
}
