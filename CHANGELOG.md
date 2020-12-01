## [2.3.3](https://github.com/percy/percy-cypress/compare/v2.3.2...v2.3.3) (2020-12-01)


### Bug Fixes

* Upgrade deps for security ([#277](https://github.com/percy/percy-cypress/issues/277)) ([98b06a4](https://github.com/percy/percy-cypress/commit/98b06a4))

## [2.3.2](https://github.com/percy/percy-cypress/compare/v2.3.1...v2.3.2) (2020-09-30)


### Bug Fixes

* Add cypress 5 to peerDependencies ([#250](https://github.com/percy/percy-cypress/issues/250)) ([98d982d](https://github.com/percy/percy-cypress/commit/98d982d))

## [2.3.1](https://github.com/percy/percy-cypress/compare/v2.3.0...v2.3.1) (2020-03-05)


### Bug Fixes

* Update peerDependencies for Cypress v4 ([#198](https://github.com/percy/percy-cypress/issues/198)) ([0502199](https://github.com/percy/percy-cypress/commit/0502199)), closes [#193](https://github.com/percy/percy-cypress/issues/193)

# [2.3.0](https://github.com/percy/percy-cypress/compare/v2.2.0...v2.3.0) (2020-02-03)


### Features

* Use node v10 ([#190](https://github.com/percy/percy-cypress/issues/190)) ([be177c7](https://github.com/percy/percy-cypress/commit/be177c7))

# [2.2.0](https://github.com/percy/percy-cypress/compare/v2.1.1...v2.2.0) (2019-10-08)


### Features

* :sparkles: Add request headers option for asset-discovery ([#159](https://github.com/percy/percy-cypress/issues/159)) ([a595f48](https://github.com/percy/percy-cypress/commit/a595f48))

## [2.1.1](https://github.com/percy/percy-cypress/compare/v2.1.0...v2.1.1) (2019-09-20)


### Bug Fixes

* add `percyCSS` option to types ([#156](https://github.com/percy/percy-cypress/issues/156)) ([7475783](https://github.com/percy/percy-cypress/commit/7475783))

# [2.1.0](https://github.com/percy/percy-cypress/compare/v2.0.1...v2.1.0) (2019-09-17)


### Features

* Add the ability to pass per-snapshot CSS ([#154](https://github.com/percy/percy-cypress/issues/154)) ([02b976f](https://github.com/percy/percy-cypress/commit/02b976f))

## [2.0.1](https://github.com/percy/percy-cypress/compare/v2.0.0...v2.0.1) (2019-08-26)


### Bug Fixes

* pass minHeight option along to agent ([#148](https://github.com/percy/percy-cypress/issues/148)) ([44c2152](https://github.com/percy/percy-cypress/commit/44c2152))

# [2.0.0](https://github.com/percy/percy-cypress/compare/v1.0.9...v2.0.0) (2019-08-02)


### Bug Fixes

* Use `cy.task` for health check rather than `cy.exec` (BREAKING CHANGE) ([#140](https://github.com/percy/percy-cypress/issues/140)) ([40550f7](https://github.com/percy/percy-cypress/commit/40550f7)), closes [#104](https://github.com/percy/percy-cypress/issues/104) [#104](https://github.com/percy/percy-cypress/issues/104) [#138](https://github.com/percy/percy-cypress/issues/138)


### BREAKING CHANGES

* ## The problem

In all of the Percy SDKs we do a thing called a "heath check", which makes sure the Percy agent server is open and ready to accept the DOM we're going to `POST` to it. If the health check fails, we will disable Percy in the SDK so we're not failing your tests due to Percy not running. 

In the Cypress SDK, this was implemented in an interesting way due a limitation with `cy.request`.  The TL:DR of that is we can't `.catch` a failed request, so we needed to use `cy.exec` to health check & gracefully fall out. You can read a little more about that limitation here: https://github.com/cypress-io/cypress/issues/3161

## [1.0.9](https://github.com/percy/percy-cypress/compare/v1.0.8...v1.0.9) (2019-05-08)


### Bug Fixes

* Add TypeScript types. Closes [#89](https://github.com/percy/percy-cypress/issues/89) ([#96](https://github.com/percy/percy-cypress/issues/96)) ([6548bf7](https://github.com/percy/percy-cypress/commit/6548bf7)), closes [/github.com/percy/percy-cypress/pull/96#issuecomment-490487665](https://github.com//github.com/percy/percy-cypress/pull/96/issues/issuecomment-490487665)

## [1.0.8](https://github.com/percy/percy-cypress/compare/v1.0.7...v1.0.8) (2019-05-02)


### Bug Fixes

* Properly pass user agent ([#93](https://github.com/percy/percy-cypress/issues/93)) ([9b9f5e6](https://github.com/percy/percy-cypress/commit/9b9f5e6))

## [1.0.7](https://github.com/percy/percy-cypress/compare/v1.0.6...v1.0.7) (2019-04-30)


### Bug Fixes

* Open `@percy/agent` version range (tilde over caret) ([#92](https://github.com/percy/percy-cypress/issues/92)) ([0e4b3f9](https://github.com/percy/percy-cypress/commit/0e4b3f9)), closes [/github.com/npm/node-semver#caret-ranges-123-025-004](https://github.com//github.com/npm/node-semver/issues/caret-ranges-123-025-004) [/github.com/npm/node-semver#tilde-ranges-123-12-1](https://github.com//github.com/npm/node-semver/issues/tilde-ranges-123-12-1)

## [1.0.6](https://github.com/percy/percy-cypress/compare/v1.0.5...v1.0.6) (2019-04-09)


### Bug Fixes

* Require @percy/agent 0.2.2. Resolves issue [#58](https://github.com/percy/percy-cypress/issues/58) ([#80](https://github.com/percy/percy-cypress/issues/80)) ([15c59be](https://github.com/percy/percy-cypress/commit/15c59be))
