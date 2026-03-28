// Percy responsive snapshot state — stored in Node.js process,
// immune to page navigations that destroy browser window state.
const percyState = {
  snapshots: [],
  percyDOMScript: null
};

module.exports = (on, config) => {
  require('@cypress/code-coverage/task')(on, config);
  on('file:preprocessor', require('@cypress/code-coverage/use-babelrc'));

  on('task', {
    'percy:storeSnapshot'({ width, dom }) {
      percyState.snapshots.push({ width, ...dom });
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
