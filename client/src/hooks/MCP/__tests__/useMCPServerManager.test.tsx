import React from 'react';
import { Provider, createStore } from 'jotai';
import { renderHook, act } from '@testing-library/react';
import { dataService } from 'librechat-data-provider';
import { useMCPServerManager } from '../useMCPServerManager';

const mockShowToast = jest.fn();
const mockMutateAsync = jest.fn();
const mockInvalidateQueries = jest.fn();
const mockGetQueryData = jest.fn();
const mockRefetchQueries = jest.fn();
const mockWindowOpen = jest.fn();

jest.mock('@librechat/client', () => ({
  useToastContext: jest.fn(() => ({
    showToast: mockShowToast,
  })),
}));

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: jest.fn(() => ({
    invalidateQueries: mockInvalidateQueries,
    getQueryData: mockGetQueryData,
    refetchQueries: mockRefetchQueries,
  })),
}));

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return {
    ...actual,
    dataService: {
      ...actual.dataService,
      bindMCPOAuth: jest.fn(),
    },
  };
});

jest.mock('librechat-data-provider/react-query', () => ({
  useCancelMCPOAuthMutation: jest.fn(() => ({
    mutate: jest.fn(),
  })),
  useGetAllEffectivePermissionsQuery: jest.fn(() => ({
    data: {},
  })),
  useReinitializeMCPServerMutation: jest.fn(() => ({
    mutateAsync: mockMutateAsync,
  })),
  useUpdateUserPluginsMutation: jest.fn(() => ({
    mutate: jest.fn(),
    isLoading: false,
  })),
}));

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: jest.fn(() => ({
    data: undefined,
  })),
  useMCPServersQuery: jest.fn(() => ({
    data: {
      kubectl_mcp: {
        type: 'streamable-http',
        url: 'http://kubectl-mcp.example/mcp',
      },
    },
    isLoading: false,
  })),
}));

jest.mock('~/hooks', () => ({
  useLocalize: jest.fn(() => (key: string) => key),
  useMCPConnectionStatus: jest.fn(() => ({
    connectionStatus: {},
  })),
  useMCPSelect: jest.fn(() => ({
    mcpValues: [],
    setMCPValues: jest.fn(),
    isPinned: true,
    setIsPinned: jest.fn(),
  })),
}));

describe('useMCPServerManager', () => {
  const bindMCPOAuth = dataService.bindMCPOAuth as jest.MockedFunction<
    typeof dataService.bindMCPOAuth
  >;

  const createWrapper = () => {
    const store = createStore();

    return ({ children }: { children: React.ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    Object.defineProperty(window, 'open', {
      configurable: true,
      value: mockWindowOpen,
    });

    bindMCPOAuth.mockResolvedValue({ success: true });
    mockMutateAsync.mockResolvedValue({
      success: true,
      oauthRequired: true,
      oauthUrl: 'https://kubectl-mcp.wengo.com/authorize?state=test',
    });
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('binds MCP OAuth before auto-opening the authorization URL', async () => {
    const { result } = renderHook(() => useMCPServerManager(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.initializeServer('kubectl_mcp');
    });

    expect(bindMCPOAuth).toHaveBeenCalledWith('kubectl_mcp');
    expect(mockWindowOpen).toHaveBeenCalledWith(
      'https://kubectl-mcp.wengo.com/authorize?state=test',
      '_blank',
      'noopener,noreferrer',
    );
    expect(bindMCPOAuth.mock.invocationCallOrder[0]).toBeLessThan(
      mockWindowOpen.mock.invocationCallOrder[0],
    );
  });

  it('binds MCP OAuth before continuing a pending authorization flow', async () => {
    const { result } = renderHook(() => useMCPServerManager(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.initializeServer('kubectl_mcp', false);
    });

    expect(mockWindowOpen).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.continueOAuth('kubectl_mcp');
    });

    expect(bindMCPOAuth).toHaveBeenCalledWith('kubectl_mcp');
    expect(mockWindowOpen).toHaveBeenCalledWith(
      'https://kubectl-mcp.wengo.com/authorize?state=test',
      '_blank',
      'noopener,noreferrer',
    );
    expect(bindMCPOAuth.mock.invocationCallOrder[0]).toBeLessThan(
      mockWindowOpen.mock.invocationCallOrder[0],
    );
  });
});
