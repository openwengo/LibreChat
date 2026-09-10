import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { ElicitationState } from 'librechat-data-provider';
import { MCPConnection } from '../connection';
import { MCPManager } from '../MCPManager';

it('routes a real MCP elicitation to its user and returns the submitted answer to the server', async () => {
  const connection = new MCPConnection({
    serverName: 'forms',
    userId: 'user-1',
    serverConfig: { type: 'streamable-http', url: 'https://example.test/mcp' },
  });
  const manager = new MCPManager();
  const server = new Server({ name: 'forms', version: '1.0.0' }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  connection['subscribeToResources']();
  manager['setupConnectionElicitationHandler'](connection, 'forms', 'user-1');
  connection.setCurrentToolCallId('tool-1');
  const otherUser = jest.fn();
  const unsubscribeOther = manager.subscribeToElicitations('user-2', otherUser);
  let unsubscribe = () => {};
  const received = new Promise<ElicitationState>((resolve) => {
    unsubscribe = manager.subscribeToElicitations('user-1', resolve);
  });
  try {
    await Promise.all([
      server.connect(serverTransport),
      connection.client.connect(clientTransport),
    ]);
    const answer = server.elicitInput({
      message: 'Choose a city',
      requestedSchema: {
        type: 'object',
        properties: { city: { type: 'string' } },
        required: ['city'],
      },
    });
    const state = await received;
    expect(state.tool_call_id).toBe('tool-1');
    expect(otherUser).not.toHaveBeenCalled();
    expect(
      manager.respondToElicitation(state.id, { action: 'accept', content: { city: 'Paris' } }),
    ).toBe(true);
    await expect(answer).resolves.toEqual({ action: 'accept', content: { city: 'Paris' } });
    expect(manager.getElicitationState(state.id)).toBeUndefined();
    unsubscribe();
    unsubscribeOther();
    manager.setElicitationState('later', { ...state, id: 'later' });
    expect(otherUser).not.toHaveBeenCalled();
  } finally {
    unsubscribe();
    unsubscribeOther();
    await Promise.all([connection.client.close(), server.close()]);
  }
});
