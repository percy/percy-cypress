"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.environmentInfo = exports.clientInfo = void 0;
function clientInfo() {
    var version = require('../package.json').version;
    var name = require('../package.json').name;
    return name + "/" + version;
}
exports.clientInfo = clientInfo;
function environmentInfo() {
    return "cypress/" + _cypressVersion();
}
exports.environmentInfo = environmentInfo;
function _cypressVersion() {
    try {
        return Cypress.version;
    }
    catch (_a) {
        return 'unknown';
    }
}
