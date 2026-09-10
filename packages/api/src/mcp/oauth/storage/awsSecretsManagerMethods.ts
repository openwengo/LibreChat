import { logger } from '@librechat/data-schemas';
import {
  CreateSecretCommand,
  DeleteSecretCommand,
  GetSecretValueCommand,
  ListSecretsCommand,
  PutSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import type { TokenQuery } from '@librechat/data-schemas';
import type { MCPTokenMethods, TokenMethodFactoryOptions, TokenRecordPayload } from './types';
import {
  buildResourceName,
  extractEncryptedFlag,
  metadataToObject,
  objectToMetadataMap,
  resolvePrefixTemplate,
  toTokenDataEnvelope,
  toTokenRecordPayload,
  withRetry,
} from './awsUtils';
import { matchesTokenQuery } from './guards';

export function createSecretsManagerTokenMethods({
  awsConfig,
  retry,
}: TokenMethodFactoryOptions): MCPTokenMethods {
  const region = awsConfig?.region;
  const prefix = resolvePrefixTemplate(awsConfig?.secretPrefix);
  const kmsKeyId = awsConfig?.kmsKeyId;
  const retryOptions = { ...(retry ?? {}), ...(awsConfig?.retry ?? {}) };

  const client = new SecretsManagerClient({ region });

  const toToken = (record: TokenRecordPayload) => {
    const envelope = toTokenDataEnvelope(record);
    return {
      userId: envelope.userId,
      identifier: envelope.identifier,
      type: envelope.type,
      token: envelope.token,
      createdAt: envelope.createdAt,
      expiresAt: envelope.expiresAt,
      metadata: envelope.metadata,
    } as unknown as import('@librechat/data-schemas').IToken;
  };

  const loadRecord = async (query: TokenQuery) => {
    if (!query.userId || typeof query.identifier !== 'string') {
      return null;
    }

    const name = buildResourceName(prefix, String(query.userId), query.identifier);

    try {
      const response = await withRetry(
        () => client.send(new GetSecretValueCommand({ SecretId: name })),
        retryOptions,
      );

      if (!response.SecretString) {
        return null;
      }

      const record = JSON.parse(response.SecretString) as TokenRecordPayload;
      return matchesTokenQuery(record, query) ? record : null;
    } catch (error) {
      const code = (error as Error & { name?: string }).name;
      if (code === 'ResourceNotFoundException') {
        return null;
      }
      logger.error(`[SecretsManager] Failed to load token ${name}`, error);
      throw error;
    }
  };

  const upsertSecret = async (name: string, payload: TokenRecordPayload) => {
    await withRetry(async () => {
      try {
        await client.send(
          new CreateSecretCommand({
            Name: name,
            SecretString: JSON.stringify(payload),
            KmsKeyId: kmsKeyId,
            ForceOverwriteReplicaSecret: true,
          }),
        );
      } catch (error) {
        const code = (error as Error & { name?: string }).name;
        if (code === 'ResourceExistsException') {
          await client.send(
            new PutSecretValueCommand({
              SecretId: name,
              SecretString: JSON.stringify(payload),
            }),
          );
          return;
        }
        throw error;
      }
    }, retryOptions);
  };

  const createToken: MCPTokenMethods['createToken'] = async (tokenData) => {
    if (!tokenData.identifier) {
      throw new Error('SecretsManager token creation requires an identifier');
    }

    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + tokenData.expiresIn * 1000);
    const encrypted = extractEncryptedFlag(tokenData.metadata);
    const record = toTokenRecordPayload(tokenData, createdAt, expiresAt, encrypted);
    const name = buildResourceName(prefix, String(tokenData.userId), tokenData.identifier);

    await withRetry(
      () =>
        client.send(
          new CreateSecretCommand({
            Name: name,
            SecretString: JSON.stringify(record),
            KmsKeyId: kmsKeyId,
          }),
        ),
      retryOptions,
    );

    return toToken(record);
  };

  const updateToken: MCPTokenMethods['updateToken'] = async (query, updateData) => {
    const record = await loadRecord(query);
    if (!record) {
      return null;
    }

    const encrypted = extractEncryptedFlag(
      updateData.metadata ?? objectToMetadataMap(record.metadata),
    );
    const expiresIn =
      'expiresIn' in updateData ? (updateData as { expiresIn?: number }).expiresIn : undefined;
    const expiresAt =
      (updateData.expiresAt as Date | undefined)?.toISOString() ??
      (expiresIn != null
        ? new Date(Date.now() + expiresIn * 1000).toISOString()
        : record.expiresAt);

    const mergedRecord: TokenRecordPayload = {
      userId: record.userId,
      identifier: updateData.identifier ?? record.identifier,
      type: updateData.type ?? record.type,
      token: updateData.token ?? record.token,
      createdAt: record.createdAt,
      expiresAt,
      metadata: {
        ...(metadataToObject(updateData.metadata) ?? record.metadata ?? {}),
        encrypted,
      },
      encrypted,
    };

    const name = buildResourceName(
      prefix,
      record.userId,
      mergedRecord.identifier ?? record.identifier!,
    );
    await upsertSecret(name, mergedRecord);

    return toToken(mergedRecord);
  };

  const findToken: MCPTokenMethods['findToken'] = async (query) => {
    const record = await loadRecord(query);
    return record ? toToken(record) : null;
  };

  const deleteTokens: MCPTokenMethods['deleteTokens'] = async (query) => {
    if (!query.userId) {
      return { deletedCount: 0 };
    }

    const identifiers = [] as string[];
    if (query.identifier instanceof RegExp) {
      logger.warn('[SecretsManager] deleteTokens does not support RegExp identifiers.');
      return { deletedCount: 0 };
    }
    if (typeof query.identifier === 'string') {
      identifiers.push(query.identifier);
    } else {
      const userPrefix = buildResourceName(prefix, String(query.userId), '').slice(0, -1);
      let nextToken: string | undefined;
      do {
        const page = await withRetry(
          () =>
            client.send(
              new ListSecretsCommand({
                Filters: [{ Key: 'name', Values: [userPrefix] }],
                NextToken: nextToken,
              }),
            ),
          retryOptions,
        );
        for (const secret of page.SecretList ?? []) {
          if (!secret.Name?.startsWith(userPrefix)) {
            continue;
          }
          const response = await withRetry(
            () => client.send(new GetSecretValueCommand({ SecretId: secret.Name })),
            retryOptions,
          );
          if (!response.SecretString) {
            continue;
          }
          const record = JSON.parse(response.SecretString) as TokenRecordPayload;
          if (record.identifier && matchesTokenQuery(record, query)) {
            identifiers.push(record.identifier);
          }
        }
        nextToken = page.NextToken;
      } while (nextToken);
    }

    let count = 0;
    for (const identifier of identifiers) {
      if (!(await loadRecord({ ...query, identifier }))) {
        continue;
      }
      const name = buildResourceName(prefix, String(query.userId), identifier);
      const deleted = await withRetry(async () => {
        try {
          await client.send(
            new DeleteSecretCommand({
              SecretId: name,
              ForceDeleteWithoutRecovery: true,
            }),
          );
          return true;
        } catch (error) {
          if ((error as Error).name === 'ResourceNotFoundException') {
            return false;
          }
          throw error;
        }
      }, retryOptions);
      if (deleted) {
        count++;
      }
    }

    return { deletedCount: count };
  };

  return {
    createToken,
    updateToken,
    findToken,
    deleteTokens,
  } as MCPTokenMethods;
}
