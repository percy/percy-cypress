// Local shim: extends @percy/sdk-utils with helpers the published 1.31.14-beta.3
// does not yet export. SDK code expects these names; we provide them locally
// until sdk-utils is updated.
const utils = require('@percy/sdk-utils');

const BROWSER_INTERNAL_PREFIXES = [
  'about:', 'chrome:', 'chrome-extension:', 'devtools:',
  'edge:', 'opera:', 'view-source:', 'data:', 'javascript:', 'blob:'
];

function resolveMaxFrameDepth(options = {}) {
  const requested = options.maxFrameDepth ?? options.maxIframeDepth;
  const def = utils.DEFAULT_MAX_IFRAME_DEPTH ?? 10;
  const hard = utils.HARD_MAX_IFRAME_DEPTH ?? 25;
  const value = requested == null ? def : Number(requested);
  if (Number.isNaN(value)) return def;
  return Math.max(0, Math.min(value, hard));
}

function resolveIgnoreSelectors(options = {}) {
  const sel = options.ignoreIframeSelectors ?? options.ignoreSelectors;
  if (!sel) return [];
  if (Array.isArray(sel)) return sel.filter(s => typeof s === 'string' && s.length);
  if (typeof sel === 'string') return sel ? [sel] : [];
  return [];
}

function normalizeIgnoreSelectors(options = {}) {
  return resolveIgnoreSelectors(options);
}

function isUnsupportedIframeSrc(src) {
  if (!src) return true;
  const s = String(src).toLowerCase();
  return BROWSER_INTERNAL_PREFIXES.some(p => s.startsWith(p));
}

module.exports = Object.assign({}, utils, {
  resolveMaxFrameDepth: utils.resolveMaxFrameDepth || resolveMaxFrameDepth,
  resolveIgnoreSelectors: utils.resolveIgnoreSelectors || resolveIgnoreSelectors,
  normalizeIgnoreSelectors: utils.normalizeIgnoreSelectors || normalizeIgnoreSelectors,
  isUnsupportedIframeSrc: utils.isUnsupportedIframeSrc || isUnsupportedIframeSrc
});
