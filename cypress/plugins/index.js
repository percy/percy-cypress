const dns = require('dns').promises;

// The subdomain spec needs two hostnames that resolve to this machine. CI maps
// a/b.percy.test in /etc/hosts; lvh.me resolves to 127.0.0.1 in public DNS.
async function resolveTestDomain() {
  for (const domain of [process.env.PERCY_TEST_DOMAIN, 'percy.test', 'lvh.me']) {
    if (!domain) continue;
    try {
      const { address } = await dns.lookup(`a.${domain}`);
      if (address === '127.0.0.1' || address === '::1') return domain;
    } catch (e) { /* not resolvable here */ }
  }
  return '';
}

module.exports = async (on, config) => {
  require('@cypress/code-coverage/task')(on, config);
  on('file:preprocessor', require('@cypress/code-coverage/use-babelrc'));

  // Forward PERCY_* env vars to the browser: config.expose for Cypress.expose()
  // (15.10+; config.expose may be absent, e.g. on 16 with no expose config) and
  // config.env for Cypress.env() (<= 15) / cy.env() (15.10+).
  const percyEnvVars = [
    'PERCY_SERVER_ADDRESS',
    'PERCY_RESPONSIVE_CAPTURE_RELOAD_PAGE',
    'PERCY_RESPONSIVE_CAPTURE_MIN_HEIGHT',
    'PERCY_RESPONSIVE_CAPTURE_SLEEP_TIME',
    'RESPONSIVE_CAPTURE_SLEEP_TIME'
  ];
  config.env = config.env || {};
  config.expose = config.expose || {};
  for (const key of percyEnvVars) {
    if (process.env[key]) {
      config.expose[key] = process.env[key];
      config.env[key] = process.env[key];
    }
  }

  const testDomain = await resolveTestDomain();
  config.expose.PERCY_TEST_DOMAIN = testDomain;
  config.env.PERCY_TEST_DOMAIN = testDomain;

  return config;
};
