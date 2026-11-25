import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { useSportEventContestsQuery, useSportEventOverviewQuery } from './use-event-page';

const getEventOverviewMock = vi.fn();
const listEventContestsMock = vi.fn();
bindApiMocks({ getEventOverview: getEventOverviewMock, listEventContests: listEventContestsMock });

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

const refusal = { error: { error: { code: 'SPORT_EVENT_NOT_FOUND', message: 'No such event.' } }, status: 404 };

describe('the Event page reads', () => {
  it('fails the overview read when the API refuses it', async () => {
    getEventOverviewMock.mockResolvedValue(refusal);

    const { result } = renderHook(() => useSportEventOverviewQuery('event-1'), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('fails the contests read when the API refuses it', async () => {
    listEventContestsMock.mockResolvedValue(refusal);

    const { result } = renderHook(() => useSportEventContestsQuery('event-1'), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
