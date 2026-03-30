import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook as rtlRenderHook } from '@testing-library/react';

export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

export function renderHook<T>(hook: () => T) {
  const queryClient = createTestQueryClient();
  return rtlRenderHook(hook, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}
