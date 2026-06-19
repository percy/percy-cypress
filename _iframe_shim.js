// Local shim: extends @percy/sdk-utils with helpers the published
// 1.31.14-beta.4 does not yet export. SDK code expects these names; we
// provide them locally until sdk-utils is updated.
const utils = require('@percy/sdk-utils');

const BROWSER_INTERNAL_PREFIXES = [
  'about:', 'chrome:', 'chrome-extension:', 'devtools:',
  'edge:', 'opera:', 'view-source:', 'data:', 'javascript:', 'blob:'
];

// Normalize a raw ignoreIframeSelectors value (array | string | unset) into
// a clean string[] that PercyDOM and our own loop can both consume with
// Array.prototype methods. PercyDOM internally does `selectors?.length &&
// selectors.some(...)`, which crashes when the caller passes a string —
// length is truthy but .some doesn't exist — so the normalization has to
// run on the SDK side before we ever hand the value to serialize().
function normalizeIgnoreSelectors(sel) {
  if (!sel) return [];
  if (Array.isArray(sel)) return sel.filter(s => typeof s === 'string' && s.length);
  // The last branch handles truthy non-string, non-array values (objects,
  // numbers, booleans). No SDK code path produces those today, so istanbul
  // is told to skip the `else` — but if a user threads garbage through
  // ignoreIframeSelectors, we'd rather hand back [] than a value PercyDOM
  // would crash on inside its own walk.
  /* istanbul ignore else */
  if (typeof sel === 'string') return [sel];
  /* istanbul ignore next */
  return [];
}

function isUnsupportedIframeSrc(src) {
  if (!src) return true;
  const s = String(src).toLowerCase();
  return BROWSER_INTERNAL_PREFIXES.some(p => s.startsWith(p));
}

// Augment the real @percy/sdk-utils singleton IN PLACE and re-export it,
// rather than `Object.assign({}, utils, …)`. A fresh copy snapshots
// `utils.percy` at load time and gives index.js a different object than the
// `@percy/sdk-utils` instance the rest of the world (CLI, and crucially the
// Cypress spec) reads and mutates — so a test setting `utils.percy.config`
// would never reach the SDK, and `getReadinessConfig`/`isReadinessDisabled`
// invoked as `utils.<fn>()` would see the stale copy's `this.percy`. Adding
// only the missing helpers keeps a single shared instance, matching the
// direct `require('@percy/sdk-utils')` master uses.
if (!utils.normalizeIgnoreSelectors) utils.normalizeIgnoreSelectors = normalizeIgnoreSelectors;
if (!utils.isUnsupportedIframeSrc) utils.isUnsupportedIframeSrc = isUnsupportedIframeSrc;

module.exports = utils;
