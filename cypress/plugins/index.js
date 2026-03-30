// Percy responsive snapshot state — stored in Node.js process,
// immune to page navigations that destroy browser window state.
const percyState = {
  snapshots: [],
};

module.exports = (on, config) => {
  require('@cypress/code-coverage/task')(on, config);
  on('file:preprocessor', require('@cypress/code-coverage/use-babelrc'));

  // Pass PERCY_SERVER_ADDRESS to the browser via config.expose (Cypress 15.10+).
  // This ensures Percy works with allowCypressEnv: false.
  // For older Cypress versions, config.env is used as fallback.
  if (process.env.PERCY_SERVER_ADDRESS) {
    if (config.expose) {
      config.expose.PERCY_SERVER_ADDRESS = process.env.PERCY_SERVER_ADDRESS;
    }
    config.env = config.env || {};
    config.env.PERCY_SERVER_ADDRESS = process.env.PERCY_SERVER_ADDRESS;
  }

  on('task', {
    'percy:storeSnapshot'({ width, dom }) {
      percyState.snapshots.push({...dom, width});
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
