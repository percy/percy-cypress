"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
var environment_1 = require("./environment");
var agent_1 = __importDefault(require("@percy/agent"));
Cypress.Commands.add('percySnapshot', function (name, options) {
    if (options === void 0) { options = {}; }
    cy.task('percyHealthCheck').then(function (percyIsRunning) {
        if (percyIsRunning) {
            var percyAgentClient_1 = new agent_1.default({
                handleAgentCommunication: false,
                domTransformation: options.domTransformation
            });
            name = name || cy.state('runnable').fullTitle()(options.document
                ? new Promise(function (resolve) { return resolve(options.document); })
                : cy.document()).then(function (doc) {
                options.document = doc;
                var domSnapshot = percyAgentClient_1.snapshot(name, options);
                return cy.request({
                    method: 'POST',
                    url: "http://localhost:" + percyAgentClient_1.port + "/percy/snapshot",
                    failOnStatusCode: false,
                    body: {
                        name: name,
                        url: doc.URL,
                        enableJavaScript: options.enableJavaScript,
                        widths: options.widths,
                        minHeight: options.minHeight,
                        clientInfo: environment_1.clientInfo(),
                        percyCSS: options.percyCSS,
                        requestHeaders: options.requestHeaders,
                        environmentInfo: environment_1.environmentInfo(),
                        domSnapshot: domSnapshot
                    }
                });
            });
        }
    });
});
