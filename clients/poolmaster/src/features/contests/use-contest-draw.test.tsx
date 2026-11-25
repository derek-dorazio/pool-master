import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { useContestDrawState } from './use-contest-draw';

const getSelectionStateMock = vi.fn();
bindApiMocks({ getSelectionState: getSelectionStateMock });

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

describe('useContestDrawState', () => {
  it('reads the contest room for the draw', async () => {
    getSelectionStateMock.mockResolvedValue({ data: { drawnAt: null, rosterSize: 4 } });

    const { result } = renderHook(() => useContestDrawState('contest-1'), { wrapper });

    await waitFor(() => expect(result.current.data).toMatchObject({ drawnAt: null, rosterSize: 4 }));
    expect(getSelectionStateMock).toHaveBeenCalledWith(expect.objectContaining({ path: { contestId: 'contest-1' } }));
  });

  it('fails the read with the API\'s refusal, without retrying', async () => {
    getSelectionStateMock.mockResolvedValue({ error: { error: { code: 'CONTEST_NOT_FOUND', message: 'No such contest.' } }, status: 404 });

    const { result } = renderHook(() => useContestDrawState('contest-1'), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(getSelectionStateMock).toHaveBeenCalledTimes(1);
  });
});
