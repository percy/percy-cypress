
declare namespace Cypress {
    interface Chainable<Subject = any> {
        percySnapshot(snapshotName: string | undefined, options: {widths ?: number[], minHeight ?: number} | undefined): Chainable<undefined>
    }
}
