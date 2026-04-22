import { useEffect } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { AuthProvider } from './features/auth/auth-provider';
import { logger } from './lib/logger';
import { queryClient } from './lib/query-client';
import { router } from './routes';

export function App() {
  useEffect(() => {
    logger.info(
      {
        action: 'app.bootstrap.mounted',
      },
      'PoolMaster webapp mounted',
    );
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  );
}
