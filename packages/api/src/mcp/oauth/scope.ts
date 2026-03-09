interface ParsedFlowId {
  namespace?: string;
  tenantId?: string;
  userId: string;
  serverName: string;
}

const DEFAULT_NAMESPACE = 'default';

function sanitizeNamespace(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return normalized.replace(/^-+|-+$/g, '') || DEFAULT_NAMESPACE;
}

function deriveNamespaceFromDomainServer(): string {
  const domainServer = process.env.DOMAIN_SERVER;
  if (!domainServer) {
    return DEFAULT_NAMESPACE;
  }

  try {
    const normalized = /^https?:\/\//i.test(domainServer) ? domainServer : `https://${domainServer}`;
    const parsed = new URL(normalized);
    const pathname = parsed.pathname === '/' ? '' : parsed.pathname;
    return sanitizeNamespace(`${parsed.hostname}${parsed.port ? `-${parsed.port}` : ''}${pathname}`);
  } catch {
    return sanitizeNamespace(domainServer);
  }
}

export function getMCPOAuthNamespace(): string {
  if (process.env.MCP_OAUTH_NAMESPACE) {
    return sanitizeNamespace(process.env.MCP_OAUTH_NAMESPACE);
  }

  return deriveNamespaceFromDomainServer();
}

export function buildMCPOAuthFlowId(
  userId: string,
  serverName: string,
  tenantId?: string,
): string {
  const namespace = getMCPOAuthNamespace();
  if (tenantId) {
    return `${namespace}:tenant:${encodeURIComponent(tenantId)}:${userId}:${serverName}`;
  }
  return `${namespace}:${userId}:${serverName}`;
}

export function parseMCPOAuthFlowId(flowId: string): ParsedFlowId | null {
  const parts = flowId.split(':');

  if (parts[0] === 'tenant' && parts.length >= 4) {
    const [, encodedTenantId, userId, ...serverNameParts] = parts;
    const serverName = serverNameParts.join(':');
    if (!encodedTenantId || !userId || !serverName) {
      return null;
    }
    try {
      return { tenantId: decodeURIComponent(encodedTenantId), userId, serverName };
    } catch {
      return null;
    }
  }

  if (parts[1] === 'tenant' && parts.length >= 5) {
    const [namespace, , encodedTenantId, userId, ...serverNameParts] = parts;
    const serverName = serverNameParts.join(':');
    if (!namespace || !encodedTenantId || !userId || !serverName) {
      return null;
    }
    try {
      return {
        namespace,
        tenantId: decodeURIComponent(encodedTenantId),
        userId,
        serverName,
      };
    } catch {
      return null;
    }
  }

  if (parts.length === 2) {
    const [userId, serverName] = parts;
    if (!userId || !serverName) {
      return null;
    }
    return { userId, serverName };
  }

  if (parts.length >= 3) {
    const [namespace, userId, ...serverNameParts] = parts;
    const serverName = serverNameParts.join(':');
    if (!namespace || !userId || !serverName) {
      return null;
    }
    return { namespace, userId, serverName };
  }

  return null;
}

export function isMCPOAuthFlowOwnedByUser(flowId: string, userId: string): boolean {
  const parsed = parseMCPOAuthFlowId(flowId);
  if (!parsed || (parsed.namespace && parsed.namespace !== getMCPOAuthNamespace())) {
    return false;
  }
  return parsed.userId === userId;
}

export function buildMCPOAuthTokenIdentifier(serverName: string): string {
  return `mcp:${getMCPOAuthNamespace()}:${serverName}`;
}

export function buildLegacyMCPOAuthTokenIdentifier(serverName: string): string {
  return `mcp:${serverName}`;
}
