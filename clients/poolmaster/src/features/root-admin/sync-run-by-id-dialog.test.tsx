import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { SyncRunByIdDialog } from './sync-run-by-id-dialog';

const getProviderSyncRun = vi.fn();
bindApiMocks({ getProviderSyncRun });

describe('SyncRunByIdDialog', () => {
  it('says the run could not be loaded, and reads it again on Retry', async () => {
    getProviderSyncRun.mockResolvedValue({ error: { error: { code: 'PROVIDER_SYNC_RUN_NOT_FOUND', message: 'No such run.' } }, status: 404 });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SyncRunByIdDialog onClose={vi.fn()} syncRunId="run-1" />
      </QueryClientProvider>,
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));

    expect(getProviderSyncRun).toHaveBeenCalledTimes(2);
  });
});
