import type { TTokenStoreConfig } from 'librechat-data-provider';
import type { AcquireTokenStoreLease } from './storage/guards';
import {
  createParameterStoreTokenMethods,
  createSecretsManagerTokenMethods,
  type MCPTokenMethods,
} from './storage';
import { resolvePrefixTemplate } from './storage/awsUtils';
import { withTokenStoreLease } from './storage/guards';
import { scopeMCPOAuthTokenMethods } from './scope';
import { MCPTokenStorage } from './tokens';

export interface TokenStoreFactoryParams {
  config?: TTokenStoreConfig | null;
  defaultMethods: MCPTokenMethods;
  acquireLease?: AcquireTokenStoreLease;
}

export function configureTokenStore({
  config,
  defaultMethods,
  acquireLease,
}: TokenStoreFactoryParams): MCPTokenMethods {
  const backend = config?.backend ?? 'mongo';
  const encryptBeforeStore = config?.encryptBeforeStore ?? true;
  MCPTokenStorage.setEncryptionPreference(encryptBeforeStore);

  if (backend !== 'mongo' && !acquireLease) {
    throw new Error('AWS token storage requires a shared mutation lease');
  }
  const wrap = (methods: MCPTokenMethods, prefix?: string): MCPTokenMethods =>
    scopeMCPOAuthTokenMethods(
      acquireLease && backend !== 'mongo'
        ? withTokenStoreLease(methods, acquireLease, resolvePrefixTemplate(prefix))
        : methods,
    );

  switch (backend) {
    case 'aws-parameter':
      return wrap(
        createParameterStoreTokenMethods({
          awsConfig: config?.aws,
          retry: config?.aws?.retry,
        }),
        config?.aws?.parameterPrefix,
      );
    case 'aws-secrets':
      return wrap(
        createSecretsManagerTokenMethods({
          awsConfig: config?.aws,
          retry: config?.aws?.retry,
        }),
        config?.aws?.secretPrefix,
      );
    case 'mongo':
    default:
      return scopeMCPOAuthTokenMethods(defaultMethods);
  }
}
