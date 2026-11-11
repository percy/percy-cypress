# @percy/cypress
[![Version](https://img.shields.io/npm/v/@percy/cypress.svg)](https://npmjs.org/package/@percy/cypress)
![Test](https://github.com/percy/percy-cypress/workflows/Test/badge.svg)

[Percy](https://percy.io) visual testing for [Cypress](https://cypress.io).

## Installation

```sh-session
$ npm install --save-dev @percy/cli @percy/cypress
```

Then add to your `cypress/support/index.js` file

```javascript
import '@percy/cypress'
```

## Usage

This is an example using the `cy.percySnapshot` command.

```javascript
describe('My app', () => {
  it('should look good', () => {
    cy.get('body').should('have.class', 'finished-loading');
    cy.percySnapshot();

    cy.get('button').click();
    cy.percySnapshot('Clicked button');
  });
});
```

Running the test above will result in the following log:

```sh-session
$ cypress run
...
[percy] Percy is not running, disabling snapshots
```

When running with [`percy
exec`](https://github.com/percy/cli/tree/master/packages/cli-exec#percy-exec), and your project's
`PERCY_TOKEN`, a new Percy build will be created and snapshots will be uploaded to your project.

```sh-session
$ export PERCY_TOKEN=[your-project-token]
$ percy exec -- cypress run
[percy] Percy has started!
[percy] Created build #1: https://percy.io/[your-project]
[percy] Running "cypress run"
...
[percy] Snapshot taken "My app should look good"
[percy] Snapshot taken "Clicked button"
...
[percy] Stopping percy...
[percy] Finalized build #1: https://percy.io/[your-project]
[percy] Done!
```

## Configuration

`cy.percySnapshot([name][, options])`

- `name` - The snapshot name; must be unique to each snapshot; defaults to the full test title
- `options` - [See per-snapshot configuration options](https://www.browserstack.com/docs/percy/take-percy-snapshots/overview#per-snapshot-configuration)

### Advanced Options

Percy Cypress now supports comprehensive snapshot options including:

- **Minimum Height**: `minHeight: 2000` - Set minimum snapshot height for tall pages
- **Animation Freezing**: Use `percyCSS` to freeze animations - `percyCSS: 'img { animation: none !important; }'`
- **Custom CSS**: `percyCSS` - Inject temporary CSS before snapshot
- **Sync Results**: `sync: true` - Get processed results synchronously
- **Cookie Capture**: Automatically captures browser cookies so Percy's asset discovery can load pages and assets that need a logged-in session. To opt out, set `PERCY_DO_NOT_USE_CAPTURED_COOKIES=true` (for example `CYPRESS_PERCY_DO_NOT_USE_CAPTURED_COOKIES=true` or `--env PERCY_DO_NOT_USE_CAPTURED_COOKIES=true`) or the Cypress config `percyDoNotUseCapturedCookies: true`. When opted out, no cookies are sent and a warning is logged once, because pages or assets that need a logged-in session may fail to load during asset discovery and render incorrectly.

## Cypress Config
- `percyThrowErrorOnFailure` - If set to true, it will throw an error when one is encountered. By default, it is set to false, and errors are suppressed.
- `percyDoNotUseCapturedCookies` - If set to true, browser cookies are not sent to Percy (same as `PERCY_DO_NOT_USE_CAPTURED_COOKIES=true`). By default, cookies are forwarded for asset discovery.
If you are using uncaught exeception then test test will pass.
```
cy.on("uncaught:exception", (e, runnable) => {});

```

## Upgrading

### Automatically with `@percy/migrate`

We built a tool to help automate migrating to the new CLI toolchain! Migrating
can be done by running the following commands and following the prompts:

``` shell
$ npx @percy/migrate
? Are you currently using @percy/cypress? Yes
? Install @percy/cli (required to run percy)? Yes
? Migrate Percy config file? Yes
? Upgrade SDK to @percy/cypress@3.0.0? Yes
```

This will automatically run the changes described below for you.

### Manually

#### Installing `@percy/cli`

If you're coming from a pre-3.0 version of this package, make sure to install `@percy/cli` after
upgrading to retain any existing scripts that reference the Percy CLI command.

```sh-session
$ npm install --save-dev @percy/cli
```

#### Removing tasks

If you're coming from 2.x the health check task, `@percy/cypress/task`, is no longer needed and no
longer exists. You should remove this task from your `cypress/plugins/index.js` file.

#### Migrating Config

If you have a previous Percy configuration file, migrate it to the newest version with the
[`config:migrate`](https://github.com/percy/cli/tree/master/packages/cli-config#percy-configmigrate-filepath-output) command:

```sh-session
$ percy config:migrate
```
