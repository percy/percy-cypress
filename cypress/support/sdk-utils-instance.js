// @percy/sdk-utils' browser bundle assigns its exports onto the shared
// window.PercySDKUtils each time a webpack bundle evaluates it. The spec bundle
// evaluates it again after support/e2e.js has, swapping in a fresh logger and
// percy-info that the SDK then reads, while sdk-utils/test/helpers may hold the
// first copy. Evaluate it here, before the helpers, and put the SDK's copy back
// so the helpers' mocks and resets reach the objects the SDK uses.
const sdkExports = { ...window.PercySDKUtils };
require('@percy/sdk-utils');
Object.assign(window.PercySDKUtils, sdkExports);
