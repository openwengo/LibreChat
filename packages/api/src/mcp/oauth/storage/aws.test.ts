import { Keyv } from 'keyv';
import {
  SSMClient,
  GetParameterCommand,
  PutParameterCommand,
  DeleteParameterCommand,
  GetParametersByPathCommand,
} from '@aws-sdk/client-ssm';
import {
  SecretsManagerClient,
  CreateSecretCommand,
  GetSecretValueCommand,
  PutSecretValueCommand,
  DeleteSecretCommand,
  ListSecretsCommand,
} from '@aws-sdk/client-secrets-manager';
import type { TokenMethods } from '@librechat/data-schemas';
import { configureTokenStore } from '../tokenStoreFactory';
import { FlowStateManager } from '~/flow/manager';
import { MCPTokenStorage } from '../tokens';

const defaultMethods: TokenMethods = {
  findToken: jest.fn(),
  createToken: jest.fn(),
  updateToken: jest.fn(),
  deleteTokens: jest.fn(),
};
const missing = (name: string): Error => Object.assign(new Error(name), { name });

describe.each(['aws-parameter', 'aws-secrets'] as const)('%s OAuth storage', (backend) => {
  const records = new Map<string, string>();
  let methods: TokenMethods;
  let secondClient: TokenMethods;
  const userId = '012345678901234567890123';
  const query = { userId, identifier: 'mcp:server', type: 'mcp_oauth' };
  const data = {
    ...query,
    token: 'first-token',
    expiresIn: 60,
    metadata: { credential_set_id: 'generation-1', encrypted: false },
  };
  const previousNamespace = process.env.MCP_OAUTH_NAMESPACE;

  beforeEach(() => {
    records.clear();
    process.env.MCP_OAUTH_NAMESPACE = 'test-deployment';
    jest.spyOn(SSMClient.prototype, 'send').mockImplementation(async (command) => {
      if (command instanceof GetParameterCommand) {
        const value = records.get(command.input.Name!);
        if (!value) throw missing('ParameterNotFound');
        return { Parameter: { Name: command.input.Name, Value: value } };
      }
      if (command instanceof PutParameterCommand) {
        if (!command.input.Overwrite && records.has(command.input.Name!))
          throw missing('ParameterAlreadyExists');
        records.set(command.input.Name!, command.input.Value!);
        return {};
      }
      if (command instanceof DeleteParameterCommand) {
        if (!records.delete(command.input.Name!)) throw missing('ParameterNotFound');
        return {};
      }
      if (command instanceof GetParametersByPathCommand) {
        return {
          Parameters: [...records]
            .filter(([name]) => name.startsWith(command.input.Path!))
            .map(([Name, Value]) => ({ Name, Value })),
        };
      }
      throw new Error('Unexpected SSM command');
    });
    jest.spyOn(SecretsManagerClient.prototype, 'send').mockImplementation(async (command) => {
      if (command instanceof GetSecretValueCommand) {
        const value = records.get(command.input.SecretId!);
        if (!value) throw missing('ResourceNotFoundException');
        return { SecretString: value };
      }
      if (command instanceof CreateSecretCommand) {
        if (records.has(command.input.Name!)) throw missing('ResourceExistsException');
        records.set(command.input.Name!, command.input.SecretString!);
        return {};
      }
      if (command instanceof PutSecretValueCommand) {
        records.set(command.input.SecretId!, command.input.SecretString!);
        return {};
      }
      if (command instanceof DeleteSecretCommand) {
        if (!records.delete(command.input.SecretId!)) throw missing('ResourceNotFoundException');
        return {};
      }
      if (command instanceof ListSecretsCommand)
        return { SecretList: [...records.keys()].map((Name) => ({ Name })) };
      throw new Error('Unexpected Secrets Manager command');
    });
    const manager = new FlowStateManager(new Keyv({ namespace: `aws-test-${backend}` }));
    const options = {
      config: { backend, encryptBeforeStore: false, aws: { retry: { maxAttempts: 1 } } },
      defaultMethods,
      acquireLease: manager.acquireLease.bind(manager),
    };
    methods = configureTokenStore(options);
    secondClient = configureTokenStore(options);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    MCPTokenStorage.setEncryptionPreference(true);
    if (previousNamespace === undefined) delete process.env.MCP_OAUTH_NAMESPACE;
    else process.env.MCP_OAUTH_NAMESPACE = previousNamespace;
  });

  it('preserves deployment paths and the credential generation', async () => {
    await methods.createToken(data);
    expect([...records.keys()][0]).toContain('/mcp/test-deployment/server');
    expect((await methods.findToken(query))?.metadata?.get('credential_set_id')).toBe(
      'generation-1',
    );
  });

  it('rejects stale updates and deletes without touching a newer credential', async () => {
    await methods.createToken(data);
    expect(
      await methods.updateToken({ ...query, metadataCredentialSetId: 'old' }, { token: 'bad' }),
    ).toBeNull();
    expect(await methods.deleteTokens({ ...query, token: 'old-token' })).toEqual({
      deletedCount: 0,
    });
    expect(await methods.deleteTokens({ ...query, metadataCredentialSetId: 'old' })).toEqual({
      deletedCount: 0,
    });
    expect((await methods.findToken(query))?.token).toBe(data.token);
  });

  it('allows only one concurrent writer to replace the same generation', async () => {
    await methods.createToken(data);
    const expected = { ...query, token: data.token, metadataCredentialSetId: 'generation-1' };
    const results = await Promise.all([
      methods.updateToken(expected, {
        token: 'second',
        metadata: { credential_set_id: 'generation-2' },
      }),
      secondClient.updateToken(expected, {
        token: 'third',
        metadata: { credential_set_id: 'generation-3' },
      }),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('replaces metadata exactly when a failed write is rolled back', async () => {
    await methods.createToken(data);
    await methods.updateToken(query, { metadata: { encrypted: false, marker: 'temporary' } });
    const result = await methods.updateToken(query, { metadata: data.metadata });
    expect(result?.metadata?.has('marker')).toBe(false);
  });

  it('does not overwrite an existing record on create', async () => {
    await methods.createToken(data);
    await expect(secondClient.createToken({ ...data, token: 'replacement' })).rejects.toThrow();
    expect((await methods.findToken(query))?.token).toBe(data.token);
  });

  it('purges only the requested user and returns zero when repeated', async () => {
    await methods.createToken(data);
    await methods.createToken({ ...data, identifier: 'mcp:other' });
    await methods.createToken({ ...data, userId: `${userId}4` });
    expect(await methods.deleteTokens({ userId })).toEqual({ deletedCount: 2 });
    expect(await methods.deleteTokens({ userId })).toEqual({ deletedCount: 0 });
    expect(records.size).toBe(1);
  });
});
