/// <reference lib="dom"/>
/// <reference types="cypress"/>
import { SnapshotOptions } from '@percy/core';

export { createRegion } from '@percy/core';

declare global {
  namespace Cypress {
    interface Chainable<Subject> {
      percySnapshot(
        name?: string,
        options?: SnapshotOptions & {
          // Component tests only: set false to skip the viewport/scope defaults.
          percyComponentDefaults?: boolean
        }
      ): Chainable<Subject>
    }
  }
}
