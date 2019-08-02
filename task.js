const Axios = require("axios");

module.exports = {
  percyHealthCheck() {
    return Axios.get("http://localhost:5338/percy/healthcheck")
      .then(() => true)
      .catch(() => false);
  }
};
