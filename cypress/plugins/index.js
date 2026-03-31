// Percy responsive snapshot state — stored in Node.js process,
// immune to page navigations that destroy browser window state.
const percyState = {
  snapshots: []
};

module.exports = (on, config) => {
  require('@cypress/code-coverage/task')(on, config);
  on('file:preprocessor', require('@cypress/code-coverage/use-babelrc'));

  // Pass PERCY_SERVER_ADDRESS to the browser via config.expose (Cypress 15.10+).
  // This ensures Percy works with allowCypressEnv: false.
  // For older Cypress versions, config.env is used as fallback.
  // Forward PERCY_* env vars to the browser context
  const percyEnvVars = [
    'PERCY_SERVER_ADDRESS',
    'PERCY_RESPONSIVE_CAPTURE_RELOAD_PAGE',
    'PERCY_RESPONSIVE_CAPTURE_MIN_HEIGHT',
    'PERCY_RESPONSIVE_CAPTURE_SLEEP_TIME',
    'RESPONSIVE_CAPTURE_SLEEP_TIME'
  ];
  config.env = config.env || {};
  for (const key of percyEnvVars) {
    if (process.env[key]) {
      if (config.expose) config.expose[key] = process.env[key];
      config.env[key] = process.env[key];
    }
  }

  on('task', {
    'percy:storeSnapshot'({ width, dom }) {
      percyState.snapshots.push({ ...dom, width });
      return percyState.snapshots.length;
    },

    'percy:getSnapshots'() {
      const snapshots = [...percyState.snapshots];
      percyState.snapshots = [];
      return snapshots;
    },

    'percy:clearSnapshots'() {
      percyState.snapshots = [];
      return null;
    }
  });

  return config;
};
