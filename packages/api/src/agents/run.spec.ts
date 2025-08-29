import { ToolMessage, AIMessage, HumanMessage } from '@langchain/core/messages';
import { Run } from '@librechat/agents';
import { EModelEndpoint } from 'librechat-data-provider';
import { createRun, extractDiscoveredToolsFromHistory } from './run';

describe('extractDiscoveredToolsFromHistory', () => {
  it('extracts tool names from tool_search JSON output', () => {
    const toolSearchOutput = JSON.stringify({
      found: 3,
      tools: [
        { name: 'tool_a', score: 1.0 },
        { name: 'tool_b', score: 0.8 },
        { name: 'tool_c', score: 0.5 },
      ],
    });

    const messages = [
      new HumanMessage('Find tools'),
      new AIMessage({ content: '', tool_calls: [{ id: 'call_1', name: 'tool_search', args: {} }] }),
      new ToolMessage({ content: toolSearchOutput, tool_call_id: 'call_1', name: 'tool_search' }),
    ];

    const discovered = extractDiscoveredToolsFromHistory(messages);

    expect(discovered.size).toBe(3);
    expect(discovered.has('tool_a')).toBe(true);
    expect(discovered.has('tool_b')).toBe(true);
    expect(discovered.has('tool_c')).toBe(true);
  });

  it('extracts tool names from legacy tool_search format', () => {
    const legacyOutput = `Found 2 tools:
- tool_x (score: 0.95)
- tool_y (score: 0.80)`;

    const messages = [
      new ToolMessage({ content: legacyOutput, tool_call_id: 'call_1', name: 'tool_search' }),
    ];

    const discovered = extractDiscoveredToolsFromHistory(messages);

    expect(discovered.size).toBe(2);
    expect(discovered.has('tool_x')).toBe(true);
    expect(discovered.has('tool_y')).toBe(true);
  });

  it('returns empty set when no tool_search messages exist', () => {
    const messages = [new HumanMessage('Hello'), new AIMessage('Hi there!')];

    const discovered = extractDiscoveredToolsFromHistory(messages);

    expect(discovered.size).toBe(0);
  });

  it('ignores non-tool_search ToolMessages', () => {
    const messages = [
      new ToolMessage({
        content: '[{"sha": "abc123"}]',
        tool_call_id: 'call_1',
        name: 'list_commits_mcp_github',
      }),
    ];

    const discovered = extractDiscoveredToolsFromHistory(messages);

    expect(discovered.size).toBe(0);
  });

  it('handles multiple tool_search calls in history', () => {
    const firstOutput = JSON.stringify({
      tools: [{ name: 'tool_1' }, { name: 'tool_2' }],
    });
    const secondOutput = JSON.stringify({
      tools: [{ name: 'tool_2' }, { name: 'tool_3' }],
    });

    const messages = [
      new ToolMessage({ content: firstOutput, tool_call_id: 'call_1', name: 'tool_search' }),
      new AIMessage('Using discovered tools'),
      new ToolMessage({ content: secondOutput, tool_call_id: 'call_2', name: 'tool_search' }),
    ];

    const discovered = extractDiscoveredToolsFromHistory(messages);

    expect(discovered.size).toBe(3);
    expect(discovered.has('tool_1')).toBe(true);
    expect(discovered.has('tool_2')).toBe(true);
    expect(discovered.has('tool_3')).toBe(true);
  });

  it('handles malformed JSON in tool_search output', () => {
    const messages = [
      new ToolMessage({
        content: 'This is not valid JSON',
        tool_call_id: 'call_1',
        name: 'tool_search',
      }),
    ];

    const discovered = extractDiscoveredToolsFromHistory(messages);

    // Should not throw, just return empty set
    expect(discovered.size).toBe(0);
  });

  it('handles tool_search output with empty tools array', () => {
    const output = JSON.stringify({
      found: 0,
      tools: [],
    });

    const messages = [
      new ToolMessage({ content: output, tool_call_id: 'call_1', name: 'tool_search' }),
    ];

    const discovered = extractDiscoveredToolsFromHistory(messages);

    expect(discovered.size).toBe(0);
  });

  it('handles non-string content in ToolMessage', () => {
    const messages = [
      new ToolMessage({
        content: [{ type: 'text', text: 'array content' }],
        tool_call_id: 'call_1',
        name: 'tool_search',
      }),
    ];

    const discovered = extractDiscoveredToolsFromHistory(messages);

    // Should handle gracefully
    expect(discovered.size).toBe(0);
  });
});

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
