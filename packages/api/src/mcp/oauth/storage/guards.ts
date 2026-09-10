import type { TokenQuery, TokenMethods } from '@librechat/data-schemas';
import type { FlowStateManager } from '~/flow/manager';
import type { TokenRecordPayload } from './types';

export type AcquireTokenStoreLease = FlowStateManager['acquireLease'];

export function matchesTokenQuery(record: TokenRecordPayload, query: TokenQuery): boolean {
  return (
    (query.userId === undefined || record.userId === String(query.userId)) &&
    (query.type === undefined || (record.type ?? null) === query.type) &&
    (query.identifier === undefined ||
      (query.identifier instanceof RegExp
        ? query.identifier.test(record.identifier ?? '')
        : record.identifier === query.identifier)) &&
    (query.token === undefined || record.token === query.token) &&
    query.email === undefined &&
    (query.metadataCredentialSetId === undefined ||
      (record.metadata?.credential_set_id ?? null) === query.metadataCredentialSetId)
  );
}

export function withTokenStoreLease(
  methods: TokenMethods,
  acquireLease: AcquireTokenStoreLease,
  prefix: string,
): TokenMethods {
  async function mutate<T>(userId: TokenQuery['userId'], operation: () => Promise<T>): Promise<T> {
    if (!userId) {
      throw new Error('AWS token mutations require a user ID');
    }
    const lease = await acquireLease(`mcp-token-store:${prefix}:${String(userId)}`);
    if (!lease) {
      throw new Error('Could not acquire the AWS token store mutation lease');
    }
    try {
      return await operation();
    } finally {
      await lease.release();
    }
  }
  return {
    findToken: methods.findToken,
    createToken: (data) => mutate(data.userId, () => methods.createToken(data)),
    updateToken: (query, data) => mutate(query.userId, () => methods.updateToken(query, data)),
    deleteTokens: (query) => mutate(query.userId, () => methods.deleteTokens(query)),
  };
}
