const { CacheKeys } = require('librechat-data-provider');
const { getFlowStateManager } = require('~/config');
const { getLogStores } = require('~/cache');
const { configureTokenStore } = require('@librechat/api');
const { findToken, updateToken, createToken, deleteTokens } = require('~/models');

let configuredMethods = {
  findToken,
  updateToken,
  createToken,
  deleteTokens,
};

function initializeTokenStore(appConfig) {
  const tokenStoreConfig = appConfig?.config?.auth?.tokenStore;
  configuredMethods = configureTokenStore({
    config: tokenStoreConfig ?? null,
    acquireLease: (id, options) =>
      getFlowStateManager(getLogStores(CacheKeys.FLOWS)).acquireLease(id, options),
    defaultMethods: {
      findToken,
      updateToken,
      createToken,
      deleteTokens,
    },
  });
  return configuredMethods;
}

function getTokenStoreMethods() {
  return configuredMethods;
}

module.exports = {
  initializeTokenStore,
  getTokenStoreMethods,
};
