jest.mock('@librechat/data-schemas', () => ({
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
  },
  webSearchKeys: [],
  getTenantId: jest.fn(() => undefined),
}));

jest.mock('librechat-data-provider', () => ({
  Tools: { web_search: 'web_search' },
  CacheKeys: { FLOWS: 'flows' },
  Constants: { mcp_prefix: 'mcp_', mcp_delimiter: '::' },
  FileSources: { s3: 's3' },
  ResourceType: { MCPSERVER: 'mcpserver' },
}));

jest.mock('@librechat/api', () => ({
  needsRefresh: jest.fn(),
  getNewS3URL: jest.fn(),
  normalizeHttpError: jest.fn((error) => ({
    status: error?.status ?? 500,
    message: error?.message ?? 'error',
  })),
  extractWebSearchEnvVars: jest.fn(({ keys }) => keys),
  getAppConfigOptionsFromUser: jest.fn(() => ({})),
  MCPOAuthHandler: {
    generateFlowId: jest.fn(() => 'flow-id'),
    generateTokenFlowId: jest.fn(() => 'flow-id'),
    revokeOAuthToken: jest.fn(),
  },
  MCPTokenStorage: {
    deleteUserTokens: jest.fn(),
    getTokens: jest.fn(),
    getClientInfoAndMetadata: jest.fn(),
  },
}));

jest.mock('~/models', () => ({
  updateUserPlugins: jest.fn().mockResolvedValue(undefined),
  findToken: jest.fn(),
  deleteTokens: jest.fn(),
}));

jest.mock('~/server/services/PluginService', () => ({
  updateUserPluginAuth: jest.fn(),
  deleteUserPluginAuth: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('~/server/services/AuthService', () => ({
  verifyEmail: jest.fn(),
  resendVerificationEmail: jest.fn(),
}));

jest.mock('~/server/services/Files/process', () => ({
  processDeleteRequest: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('~/server/services/Config', () => ({
  getAppConfig: jest.fn().mockResolvedValue({}),
}));

jest.mock('~/server/services/Config/getCachedTools', () => ({
  invalidateCachedTools: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('~/server/services/TokenStore', () => ({
  getTokenStoreMethods: jest.fn(),
}));

jest.mock('~/config', () => ({
  getMCPManager: jest.fn(),
  getFlowStateManager: jest.fn(),
  getMCPServersRegistry: jest.fn(),
}));

jest.mock('~/cache', () => ({
  getLogStores: jest.fn(),
}));

const db = require('~/models');
const { MCPOAuthHandler, MCPTokenStorage } = require('@librechat/api');
const { getTokenStoreMethods } = require('~/server/services/TokenStore');
const { deleteUserPluginAuth } = require('~/server/services/PluginService');
const { getMCPManager, getFlowStateManager, getMCPServersRegistry } = require('~/config');
const { getLogStores } = require('~/cache');
const { invalidateCachedTools } = require('~/server/services/Config/getCachedTools');
const { updateUserPluginsController } = require('./UserController');

describe('updateUserPluginsController MCP OAuth uninstall', () => {
  const mockRes = {
    status: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };

  let tokenMethods;
  let mcpManager;
  let flowManager;
  let registry;

  beforeEach(() => {
    jest.clearAllMocks();
    tokenMethods = {
      findToken: jest.fn(),
      createToken: jest.fn(),
      updateToken: jest.fn(),
      deleteTokens: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    };
    mcpManager = {
      disconnectUserConnection: jest.fn().mockResolvedValue(undefined),
    };
    flowManager = {
      deleteFlow: jest.fn().mockResolvedValue(undefined),
    };
    registry = {
      getServerConfig: jest.fn().mockResolvedValue({
        url: 'https://mcp.example.com/mcp',
        oauth: {
          revocation_endpoint: 'https://auth.example.com/oauth/revoke',
          revocation_endpoint_auth_methods_supported: ['client_secret_post'],
        },
      }),
      getOAuthServers: jest.fn().mockResolvedValue(new Set(['server1'])),
      getAllowedDomains: jest.fn().mockReturnValue(['auth.example.com', 'mcp.example.com']),
      getAllowedAddresses: jest.fn().mockReturnValue(['10.0.0.1']),
    };

    getTokenStoreMethods.mockReturnValue(tokenMethods);
    getMCPManager.mockReturnValue(mcpManager);
    getFlowStateManager.mockReturnValue(flowManager);
    getMCPServersRegistry.mockReturnValue(registry);
    getLogStores.mockReturnValue({});
    MCPTokenStorage.getClientInfoAndMetadata.mockResolvedValue({
      clientInfo: {
        client_id: 'client-1',
        client_secret: 'secret-1',
      },
      clientMetadata: {},
    });
    MCPTokenStorage.getTokens.mockResolvedValue({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      token_type: 'Bearer',
    });
    MCPTokenStorage.deleteUserTokens.mockImplementation(async ({ deleteToken }) => {
      await deleteToken({
        userId: 'user-1',
        type: 'mcp_oauth_refresh',
        identifier: 'mcp:server1:refresh',
      });
    });
    MCPOAuthHandler.revokeOAuthToken.mockResolvedValue(undefined);
  });

  it('uses the configured token store when revoking an OAuth MCP server', async () => {
    const req = {
      user: {
        id: 'user-1',
        _id: 'user-1',
        plugins: [],
      },
      body: {
        pluginKey: 'mcp_server1',
        action: 'uninstall',
        auth: {},
      },
      config: {
        mcpSettings: {
          allowedDomains: ['auth.example.com', 'mcp.example.com'],
          allowedAddresses: ['10.0.0.1'],
        },
      },
    };

    await updateUserPluginsController(req, mockRes);

    expect(deleteUserPluginAuth).toHaveBeenCalledWith('user-1', null, true, 'mcp_server1');
    expect(MCPTokenStorage.getClientInfoAndMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        serverName: 'server1',
        findToken: tokenMethods.findToken,
      }),
    );
    expect(MCPTokenStorage.getTokens).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        serverName: 'server1',
        findToken: tokenMethods.findToken,
      }),
    );
    expect(MCPOAuthHandler.revokeOAuthToken).toHaveBeenCalledWith(
      'server1',
      'access-token',
      'access',
      expect.objectContaining({
        clientId: 'client-1',
        clientSecret: 'secret-1',
      }),
      {},
      ['auth.example.com', 'mcp.example.com'],
      ['10.0.0.1'],
    );
    expect(MCPOAuthHandler.revokeOAuthToken).toHaveBeenCalledWith(
      'server1',
      'refresh-token',
      'refresh',
      expect.objectContaining({
        clientId: 'client-1',
        clientSecret: 'secret-1',
      }),
      {},
      ['auth.example.com', 'mcp.example.com'],
      ['10.0.0.1'],
    );
    expect(tokenMethods.deleteTokens).toHaveBeenCalledWith({
      userId: 'user-1',
      type: 'mcp_oauth_refresh',
      identifier: 'mcp:server1:refresh',
    });
    expect(db.findToken).not.toHaveBeenCalled();
    expect(db.deleteTokens).not.toHaveBeenCalled();
    expect(mcpManager.disconnectUserConnection).toHaveBeenCalledWith('user-1', 'server1');
    expect(invalidateCachedTools).toHaveBeenCalledWith({
      userId: 'user-1',
      serverName: 'server1',
    });
    expect(flowManager.deleteFlow).toHaveBeenCalledWith('flow-id', 'mcp_get_tokens');
    expect(flowManager.deleteFlow).toHaveBeenCalledWith('flow-id', 'mcp_oauth');
    expect(mockRes.status).toHaveBeenCalledWith(200);
  });
});
