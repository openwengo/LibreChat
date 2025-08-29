import { EModelEndpoint } from 'librechat-data-provider';
import { initializeAnthropic } from '~/endpoints/anthropic/initialize';
import { initializeGoogle } from '~/endpoints/google/initialize';
import { initializeOpenAI } from '~/endpoints/openai/initialize';

describe('Built-in endpoint extra headers', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('propagates `endpoints.*.headers` to OpenAI configuration defaultHeaders', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.OPENAI_EXTRA_HEADERS = 'x-env: {user_email}';

    const result = await initializeOpenAI({
      req: {
        config: {
          endpoints: {
            all: { headers: { 'x-all': 'all' } },
            openAI: { headers: { 'x-openai': 'openai' } },
          },
        },
        body: {},
        user: { id: 'user-1' },
      } as never,
      endpoint: EModelEndpoint.openAI,
      model_parameters: { model: 'gpt-4o-mini' } as never,
      db: {} as never,
    });

    expect(result.configOptions?.defaultHeaders).toEqual({
      'x-all': 'all',
      'x-openai': 'openai',
      'x-env': '{user_email}',
    });
  });

  it('propagates `endpoints.*.headers` to Anthropic clientOptions.defaultHeaders', async () => {
    process.env.ANTHROPIC_API_KEY = 'anthropic-test';
    process.env.ANTHROPIC_EXTRA_HEADERS = 'x-env: {user_email}';

    const result = await initializeAnthropic({
      req: {
        config: {
          endpoints: {
            all: { headers: { 'x-all': 'all' } },
            anthropic: { headers: { 'x-anthropic': 'anthropic' } },
          },
        },
        body: {},
        user: { id: 'user-1' },
      } as never,
      endpoint: EModelEndpoint.anthropic,
      model_parameters: { model: 'claude-3-5-sonnet-latest' } as never,
      db: {} as never,
    });

    const llmConfig = result.llmConfig as unknown as {
      clientOptions?: { defaultHeaders?: Record<string, string> };
    };
    expect(llmConfig.clientOptions?.defaultHeaders).toMatchObject({
      'x-all': 'all',
      'x-anthropic': 'anthropic',
      'x-env': '{user_email}',
    });
  });

  it('propagates `endpoints.*.headers` to Google customHeaders', async () => {
    process.env.GOOGLE_KEY = 'google-test';
    process.env.GOOGLE_EXTRA_HEADERS = 'x-env: {user_email}';

    const result = await initializeGoogle({
      req: {
        config: {
          endpoints: {
            all: { headers: { 'x-all': 'all' } },
            google: { headers: { 'x-google': 'google' } },
          },
        },
        body: {},
        user: { id: 'user-1' },
      } as never,
      endpoint: EModelEndpoint.google,
      model_parameters: { model: 'gemini-1.5-flash' } as never,
      db: {} as never,
    });

    const llmConfig = result.llmConfig as unknown as {
      customHeaders?: Record<string, string>;
    };
    expect(llmConfig.customHeaders).toMatchObject({
      'x-all': 'all',
      'x-google': 'google',
      'x-env': '{user_email}',
    });
  });
});
