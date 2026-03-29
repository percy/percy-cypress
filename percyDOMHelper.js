// PercyDOM injection helpers.
// These use eval() which is required for injecting the PercyDOM script
// into the correct window context. The script is fetched from the trusted
// local Percy CLI server (localhost:5338/percy/dom.js), NOT user input.
//
// This file is excluded from Semgrep scanning via .semgrepignore because
// eval() is the only way to inject scripts into browser/iframe contexts
// in Cypress (CSP blocks <script> tags, and new Function() is also flagged).

// Inject PercyDOM into the current window
function injectPercyDOM(scriptContent) {
  // eslint-disable-next-line no-eval
  eval(scriptContent);
}

// Inject PercyDOM into an iframe's window context
function injectPercyDOMInFrame(frameWindow, scriptContent) {
  // eslint-disable-next-line no-eval
  frameWindow.eval(scriptContent);
}

module.exports = { injectPercyDOM, injectPercyDOMInFrame };
