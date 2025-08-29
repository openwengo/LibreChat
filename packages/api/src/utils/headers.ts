/**
 * Parses a comma-separated list of HTTP headers in the format:
 * `Header-Name: header value, Another-Header: another value`
 *
 * Used for *_EXTRA_HEADERS env vars.
 */
export function parseExtraHeaders(input?: string | null): Record<string, string> {
  if (!input || typeof input !== 'string') {
    return {};
  }

  const headers: Record<string, string> = {};
  const entries = input
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  for (const entry of entries) {
    const separatorIndex = entry.indexOf(':');
    if (separatorIndex === -1) {
      continue;
    }

    const name = entry.slice(0, separatorIndex).trim();
    const value = entry.slice(separatorIndex + 1).trim();
    if (!name) {
      continue;
    }

    headers[name] = value;
  }

  return headers;
}
