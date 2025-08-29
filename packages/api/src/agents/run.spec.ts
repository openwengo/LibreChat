import { Run } from '@librechat/agents';
import { EModelEndpoint } from 'librechat-data-provider';
import { createRun } from './run';

describe('createRun', () => {
  it('resolves extra header placeholders for OpenAI, Anthropic, and Google configs', async () => {
    const runCreateSpy = jest
      .spyOn(Run, 'create')
      .mockImplementation(async (options: unknown) => options as never);

    await createRun({
      agents: [
        {
          id: 'agent-1',
          provider: EModelEndpoint.openAI,
          endpoint: EModelEndpoint.openAI,
          edges: [],
          model_parameters: {
            configuration: {
              defaultHeaders: {
                'x-user-email': '{user_email}',
                'x-conversation-id': '{{LIBRECHAT_BODY_CONVERSATIONID}}',
              },
            },
            clientOptions: {
              defaultHeaders: {
                'x-user-id': '{user_id}',
              },
            },
            customHeaders: {
              'x-message-id': '{{LIBRECHAT_BODY_MESSAGEID}}',
            },
          },
        },
      ] as never,
      signal: new AbortController().signal,
      requestBody: { conversationId: 'convo-1', messageId: 'msg-1' } as never,
      user: { id: 'user-1', email: 'user@example.com' } as never,
      tokenCounter: jest.fn() as never,
      customHandlers: {} as never,
      indexTokenCountMap: new Map(),
    });

    expect(runCreateSpy).toHaveBeenCalledTimes(1);

    const args = runCreateSpy.mock.calls[0][0] as {
      graphConfig: { agents: Array<{ clientOptions: Record<string, unknown> }> };
    };

    const clientOptions = args.graphConfig.agents[0].clientOptions;

    expect(
      (clientOptions.configuration as { defaultHeaders: Record<string, string> }).defaultHeaders,
    ).toEqual({
      'x-user-email': 'user@example.com',
      'x-conversation-id': 'convo-1',
    });

    expect(
      (clientOptions.clientOptions as { defaultHeaders: Record<string, string> }).defaultHeaders,
    ).toEqual({
      'x-user-id': 'user-1',
    });

    expect(clientOptions.customHeaders).toEqual({
      'x-message-id': 'msg-1',
    });
  });
});
