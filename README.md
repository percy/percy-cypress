# @percy/cypress
[![Version](https://img.shields.io/npm/v/@percy/cypress.svg)](https://npmjs.org/package/@percy/cypress)
![Test](https://github.com/percy/percy-cypress/workflows/Test/badge.svg)

[Percy](https://percy.io) visual testing for [Cypress](https://cypress.io).

## Installation

```sh-session
$ npm install --save-dev @percy/cli @percy/cypress
```

Then add to your `cypress/support/e2e.js` file (`cypress/support/index.js` before Cypress 10), and to
`cypress/support/component.js` if you take snapshots in component tests

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
- **Cookie Capture**: Automatically captures cookies for accurate session reproduction

## Cypress Config
- `percyThrowErrorOnFailure` - If set to true, it will throw an error when one is encountered. By default, it is set to false, and errors are suppressed.
If you are using uncaught exeception then test test will pass.
```
cy.on("uncaught:exception", (e, runnable) => {});

```

## Percy CLI address and environment values

The SDK talks to the Percy CLI on `http://localhost:5338` by default. `percy exec` sets
`PERCY_SERVER_ADDRESS` for the Cypress process; on Cypress 15 and older the SDK reads it with
`cy.exec()` (once per spec), so `percy exec --port <port>` works without any setup.

Cypress 16 removed `cy.exec()`, so on Cypress 16 a non-default port, and on any version the
`PERCY_RESPONSIVE_CAPTURE_*` values, must be passed to the browser in one of these ways:

- **Cypress 15.10+ (recommended on Cypress 16):** expose them, for example
  `cypress run --expose PERCY_SERVER_ADDRESS=http://localhost:5420`, or in `cypress.config.js`:

  ```js
  const { defineConfig } = require('cypress');

  module.exports = defineConfig({
    expose: { PERCY_SERVER_ADDRESS: process.env.PERCY_SERVER_ADDRESS }
  });
  ```

- **Environment variables:** `CYPRESS_PERCY_SERVER_ADDRESS=http://localhost:5420` (or `--env`). On
  Cypress 15.10+ the SDK reads these through `cy.env()`, so they also work with
  `allowCypressEnv: false` and on Cypress 16, which removed `Cypress.env()`.

The SDK checks `Cypress.expose()` first, then `cy.env()`, then `Cypress.env()` on Cypress 15 and
older, then `PERCY_SERVER_ADDRESS` through `cy.exec()` on Cypress 15 and older.

## Component testing

Import the SDK in `cypress/support/component.js` and call `cy.percySnapshot()` after mounting:

```javascript
// cypress/support/component.js
import '@percy/cypress';
import { mount } from 'cypress/react';
Cypress.Commands.add('mount', mount);
```

```javascript
it('renders the card', () => {
  cy.mount(<Card title="Hello" />);
  cy.percySnapshot('Card');
});
```

In component tests the SDK uses these defaults, so a snapshot shows the mounted component at the
size it was tested at instead of a mostly empty page at the CLI's default widths:

- `widths`: the test's viewport width (including any `cy.viewport()` call in the test)
- `minHeight`: the test's viewport height
- `scope`: `[data-cy-root]`, the element Cypress mounts components into
- the snapshot URL drops Cypress's `?specPath=` query, which contains your local spec path

Options passed to `cy.percySnapshot()` override these defaults, and the defaults override `widths`
in `.percy.yml`. To turn them off, pass `percyComponentDefaults: false` to a snapshot, or set it for
the whole run through `expose` (or `env` on Cypress 15 and older) or as a top-level Cypress config
value. Turning on these defaults changes existing component-test baselines once.

## Pages on another origin

Since Cypress 14, a sibling subdomain (for example `app.example.com` after `www.example.com`) is a
different origin, and you reach it with `cy.origin()`. `cy.percySnapshot()` called after such a
navigation, outside the `cy.origin()` callback, captures the page through `cy.origin()` for you.
Responsive capture (`responsiveSnapshotCapture`) isn't supported on these pages yet; the snapshot is
taken at the current viewport and the SDK logs a warning.

Calling `cy.percySnapshot()` *inside* a `cy.origin()` callback still needs Cypress's
`experimentalOriginDependencies: true` and `Cypress.require('@percy/cypress')` in the callback,
because the support file doesn't run there.

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
