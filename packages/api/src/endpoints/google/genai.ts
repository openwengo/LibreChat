import { EModelEndpoint } from 'librechat-data-provider';
import type { HttpOptions } from '@google/genai';
import type { ServerRequest, RequestBody } from '~/types';
import { isEnabled, mergeHeaders, createSafeUser, resolveModelHeaders } from '~/utils';
import { resolveRequestTenantId } from '~/middleware/tenant';

/** Google endpoint env settings that shape `@google/genai` requests */
export type GenAIEnv = Partial<Record<'GOOGLE_REVERSE_PROXY' | 'GOOGLE_AUTH_HEADER', string>>;

/**
 * Builds `@google/genai` HTTP options from the Google endpoint's transport settings, so
 * SDK clients (e.g. the Gemini image tool) reach the same gateway as the chat endpoint.
 *
 * Headers layer `endpoints.all` beneath `endpoints.google`, and are resolved before the
 * key-derived `Authorization` header is added, keeping the API key out of placeholder and
 * env expansion. `GOOGLE_REVERSE_PROXY` and `GOOGLE_AUTH_HEADER` apply only to API-key
 * (Gemini API) auth; Vertex AI keeps its own endpoint and credentials.
 *
 * @returns the options, or `undefined` when nothing differs from the SDK defaults.
 */
export function getGenAIHttpOptions({
  env,
  req,
  body,
  apiKey,
}: {
  env: GenAIEnv;
  req?: Pick<ServerRequest, 'user' | 'config'> & { tenantId?: string };
  body?: RequestBody;
  apiKey?: string;
}): HttpOptions | undefined {
  const endpoints = req?.config?.endpoints;
  const templates = mergeHeaders(
    endpoints?.all?.headers,
    endpoints?.[EModelEndpoint.google]?.headers,
  );
  const resolved = templates
    ? resolveModelHeaders({
        headers: templates,
        user: createSafeUser(req?.user),
        tenantId: resolveRequestTenantId(req ?? {}),
        body,
      })
    : undefined;
  const authorization =
    apiKey && isEnabled(env.GOOGLE_AUTH_HEADER) ? { Authorization: `Bearer ${apiKey}` } : undefined;
  const headers = mergeHeaders(resolved, authorization);
  const baseUrl = apiKey ? env.GOOGLE_REVERSE_PROXY?.trim() : undefined;

  if (!baseUrl && !headers) {
    return undefined;
  }
  return { ...(baseUrl && { baseUrl }), ...(headers && { headers }) };
}
