
interface SnapshotOptions {
  enableJavaScript?: boolean,
  widths?: number[],
  minHeight?: number,
}

declare namespace Cypress {
  interface Chainable<Subject> {
    /**
     * Take a snapshot in Percy
     * @see https://github.com/percy/percy-cypress
     * @example
     *    cy.percySnapshot('home page')
     *    cy.percySnapshot('about page', {widths: [1280, 1960]})
     */
    percySnapshot(name?: string, options?: SnapshotOptions): Chainable<Subject>
  }
}
