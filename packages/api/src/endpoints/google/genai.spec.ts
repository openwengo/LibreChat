import http from 'http';
import { GoogleGenAI } from '@google/genai';
import type { AddressInfo } from 'net';
import type { IUser, AppConfig } from '@librechat/data-schemas';
import type { IncomingHttpHeaders } from 'http';
import { getGenAIHttpOptions } from './genai';

type CapturedRequest = { url?: string; headers: IncomingHttpHeaders };

const user = { id: 'user-1', email: 'jane@example.com' } as unknown as IUser;

const createConfig = (endpoints: Record<string, { headers: Record<string, string> }>) =>
  ({ endpoints }) as unknown as AppConfig;

describe('getGenAIHttpOptions', () => {
  let server: http.Server;
  let proxyUrl: string;
  let captured: CapturedRequest[];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      captured.push({ url: req.url, headers: req.headers });
      req.resume();
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    proxyUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(() => {
    captured = [];
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('returns undefined when nothing is configured, keeping SDK defaults', () => {
    expect(getGenAIHttpOptions({ env: {}, apiKey: 'key' })).toBeUndefined();
  });

  it('routes the SDK through the reverse proxy with resolved headers and bearer auth', async () => {
    const config = createConfig({
      all: {
        headers: {
          'X-All': '{{LIBRECHAT_USER_ID}}',
          'X-Gateway-User': '{{LIBRECHAT_USER_EMAIL}}',
          'X-Shared': 'all',
        },
      },
      google: {
        headers: { 'X-Conversation': '{{LIBRECHAT_BODY_CONVERSATIONID}}', 'x-shared': 'google' },
      },
    });
    const httpOptions = getGenAIHttpOptions({
      env: { GOOGLE_REVERSE_PROXY: proxyUrl, GOOGLE_AUTH_HEADER: 'true' },
      req: { user, config },
      body: { conversationId: 'convo-1' },
      apiKey: 'test-key',
    });

    const ai = new GoogleGenAI({ apiKey: 'test-key', httpOptions });
    await ai.models.generateContent({ model: 'gemini-2.5-flash-image', contents: 'draw' });

    expect(captured).toHaveLength(1);
    const [request] = captured;
    expect(request.url).toBe('/v1beta/models/gemini-2.5-flash-image:generateContent');
    expect(request.headers).toMatchObject({
      'x-goog-api-key': 'test-key',
      authorization: 'Bearer test-key',
      'x-all': 'user-1',
      'x-conversation': 'convo-1',
      'x-gateway-user': 'jane@example.com',
      'x-shared': 'google',
    });
  });

  it('keeps provider auth above configured headers and out of template expansion', () => {
    process.env.GENAI_SPEC_SECRET = 'server-secret';
    try {
      const httpOptions = getGenAIHttpOptions({
        env: { GOOGLE_AUTH_HEADER: 'true' },
        req: {
          user,
          config: createConfig({ google: { headers: { authorization: 'Bearer spoofed' } } }),
        },
        apiKey: '${GENAI_SPEC_SECRET}',
      });

      expect(httpOptions?.headers).toEqual({ Authorization: 'Bearer ${GENAI_SPEC_SECRET}' });
    } finally {
      delete process.env.GENAI_SPEC_SECRET;
    }
  });

  it('sends configured headers without the proxy or bearer auth when no API key is used', () => {
    const httpOptions = getGenAIHttpOptions({
      env: { GOOGLE_REVERSE_PROXY: proxyUrl, GOOGLE_AUTH_HEADER: 'true' },
      req: {
        user,
        config: createConfig({
          all: { headers: { 'X-Gateway-User': '{{LIBRECHAT_USER_EMAIL}}' } },
        }),
      },
    });

    expect(httpOptions).toEqual({ headers: { 'X-Gateway-User': 'jane@example.com' } });
  });
});
