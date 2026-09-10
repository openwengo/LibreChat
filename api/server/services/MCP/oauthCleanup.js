const { getTokenStoreMethods } = require('~/server/services/TokenStore');
const { CacheKeys } = require('librechat-data-provider');
const { MCPOAuthHandler, MCPTokenStorage, cleanupMCPServerOAuth } = require('@librechat/api');
const { getFlowStateManager, getMCPServersRegistry } = require('~/config');
const { getLogStores } = require('~/cache');

const maybeUninstallOAuthMCP = async (userId, pluginKey, appConfig, serverConfigOverride) => {
  const registry = getMCPServersRegistry();
  return cleanupMCPServerOAuth({
    userId,
    pluginKey,
    appConfig,
    serverConfigOverride,
    dependencies: {
      flowManager: getFlowStateManager(getLogStores(CacheKeys.FLOWS)),
      oauthHandler: MCPOAuthHandler,
      tokenStorage: MCPTokenStorage,
      findToken: getTokenStoreMethods().findToken,
      deleteTokens: getTokenStoreMethods().deleteTokens,
      getServerConfig: (serverName, ownerId) => registry.getServerConfig(serverName, ownerId),
      isRegisteredOAuthServer: async (serverName, ownerId) =>
        (await registry.getOAuthServers(ownerId)).has(serverName),
    },
  });
};

module.exports = { maybeUninstallOAuthMCP };
