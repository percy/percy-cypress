module.exports = (on, config) => {
  // code coverage
  require('@cypress/code-coverage/task')(on, config);
  on('file:preprocessor', require('@cypress/code-coverage/use-babelrc'));

  return config;
};
