declare var Cypress: any

export function clientInfo(): string {
  let version = require('../package.json').version
  let name = require('../package.json').name
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
