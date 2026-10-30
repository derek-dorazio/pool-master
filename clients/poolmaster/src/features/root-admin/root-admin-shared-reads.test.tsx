import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { QueryKeys } from '@/lib/query-keys';
import { useIngestionScheduleQuery } from './use-ingestion-schedule-query';
import { useProvidersQuery } from './use-providers-query';
import { useUpdateSportLeague } from './use-update-sport-league';
import { fieldWriteKeys } from './use-sport-event';

const { getIngestionScheduleMock, listProvidersMock, updateSportLeagueMock } = vi.hoisted(() => ({
  getIngestionScheduleMock: vi.fn(),
  listProvidersMock: vi.fn(),
  updateSportLeagueMock: vi.fn(),
}));

bindApiMocks({
  getIngestionSchedule: getIngestionScheduleMock,
  listProviders: listProvidersMock,
  updateSportLeague: updateSportLeagueMock,
});

function wrapperFor(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

const SCHEDULE = {
  scheduledSports: ['GOLF'],
  healthCheck: { enabled: true, intervalMinutes: 5 },
  eventParticipants: { enabled: true, intervalMinutes: 60, lookaheadDays: 14 },
  eventLiveScores: { enabled: false, intervalSeconds: 60 },
  perSportOverrides: {},
};

describe('useProvidersQuery', () => {
  beforeEach(() => listProvidersMock.mockReset());

  it('reads the provider list', async () => {
    listProvidersMock.mockResolvedValue({ data: { providers: [{ providerId: 'mock' }] } });
    const { result } = renderHook(() => useProvidersQuery(), { wrapper: wrapperFor(newClient()) });

    await waitFor(() => expect(result.current.data).toEqual([{ providerId: 'mock' }]));
  });

  it('reads nothing while the page says it does not need the providers', () => {
    const { result } = renderHook(() => useProvidersQuery({ enabled: false }), { wrapper: wrapperFor(newClient()) });

    expect(result.current.fetchStatus).toBe('idle');
    expect(listProvidersMock).not.toHaveBeenCalled();
  });
});

describe('useIngestionScheduleQuery', () => {
  it('hands the page its own copy of the schedule, so editing a draft never edits the cache', async () => {
    getIngestionScheduleMock.mockResolvedValue({ data: SCHEDULE });
    const queryClient = newClient();
    const { result } = renderHook(() => useIngestionScheduleQuery(), { wrapper: wrapperFor(queryClient) });

    await waitFor(() => expect(result.current.data).toBeDefined());
    const cached = queryClient.getQueryData(QueryKeys.rootAdmin.ingestionConfig);
    expect(result.current.data).toEqual(cached);
    expect(result.current.data).not.toBe(cached);
  });
});

describe('useUpdateSportLeague', () => {
  beforeEach(() => updateSportLeagueMock.mockReset());

  it('sends the change the page builds from what it saves, then refreshes the sport\'s leagues', async () => {
    updateSportLeagueMock.mockResolvedValue({ data: { sportLeague: { id: 'pga' } } });
    const queryClient = newClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useUpdateSportLeague({
      failedAction: 'test.failed',
      onSuccess,
      refusedMessage: 'Refused',
      sportLeagueId: 'pga',
      toBody: (year: number) => ({ currentEventYear: year }),
    }), { wrapper: wrapperFor(queryClient) });

    await act(() => result.current.mutateAsync(2027));

    expect(updateSportLeagueMock).toHaveBeenCalledWith(expect.objectContaining({ path: { sportLeagueId: 'pga' }, body: { currentEventYear: 2027 } }));
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: QueryKeys.rootAdmin.manageSport.leagues });
  });
});

describe('fieldWriteKeys', () => {
  it('names the field, the event, the event list and the tiers a change to the field reaches', () => {
    expect(fieldWriteKeys('event-1')).toEqual([
      QueryKeys.rootAdmin.manageSport.field('event-1'),
      QueryKeys.rootAdmin.manageSport.event('event-1'),
      QueryKeys.rootAdmin.manageSport.events,
      QueryKeys.rootAdmin.manageSport.tiers('event-1'),
    ]);
  });
});
