// Constants and helpers used across cross-origin iframe handling.
// Kept in a dedicated module so the same definitions don't drift between
// SDKs (puppeteer, playwright, nightwatch, cypress, webdriverio, protractor).

const UNSUPPORTED_IFRAME_SRCS = [
  'about:blank',
  'about:srcdoc',
  'javascript:',
  'data:',
  'blob:',
  'vbscript:',
  'chrome:',
  'chrome-extension:'
];

function isUnsupportedIframeSrc(src) {
  if (!src) return true;
  const lower = String(src).toLowerCase();
  return UNSUPPORTED_IFRAME_SRCS.some(prefix => lower === prefix || lower.startsWith(prefix));
}

function normalizeIgnoreSelectors(list) {
  return Array.isArray(list) ? list.filter(s => typeof s === 'string' && s.trim()) : [];
}

module.exports = {
  UNSUPPORTED_IFRAME_SRCS,
  isUnsupportedIframeSrc,
  normalizeIgnoreSelectors
};
