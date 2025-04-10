const createRegion = function({
  boundingBox = null,
  elementXpath = null,
  elementCSS = null,
  padding = null,
  algorithm = 'ignore',
  diffSensitivity = null,
  imageIgnoreThreshold = null,
  carouselsEnabled = null,
  bannersEnabled = null,
  adsEnabled = null,
  diffIgnoreThreshold = null
} = {}) {
  const elementSelector = {};
  if (boundingBox) elementSelector.boundingBox = boundingBox;
  if (elementXpath) elementSelector.elementXpath = elementXpath;
  if (elementCSS) elementSelector.elementCSS = elementCSS;

  const region = {
    algorithm,
    elementSelector
  };
  //test
  if (padding) {
    region.padding = padding;
  }

  const configuration = {};
  if (['standard', 'intelliignore'].includes(algorithm)) {
    if (diffSensitivity) configuration.diffSensitivity = diffSensitivity;
    if (imageIgnoreThreshold) configuration.imageIgnoreThreshold = imageIgnoreThreshold;
    if (carouselsEnabled) configuration.carouselsEnabled = carouselsEnabled;
    if (bannersEnabled) configuration.bannersEnabled = bannersEnabled;
    if (adsEnabled) configuration.adsEnabled = adsEnabled;
  }

  if (Object.keys(configuration).length > 0) {
    region.configuration = configuration;
  }

  const assertion = {};
  if (diffIgnoreThreshold) {
    assertion.diffIgnoreThreshold = diffIgnoreThreshold;
  }

  if (Object.keys(assertion).length > 0) {
    region.assertion = assertion;
  }

  return region;
};

module.exports = { createRegion };
