import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { QueryKeys } from '@/lib/query-keys';
import { useProvidersQuery } from './use-providers-query';
import { useUpdateSportLeague } from './use-update-sport-league';
import { fieldWriteKeys, useSportEventSlotTiebreakersQuery } from './use-sport-event';

const { listProvidersMock, updateSportLeagueMock, listEventSlotTiebreakersMock } = vi.hoisted(() => ({
  listProvidersMock: vi.fn(),
  updateSportLeagueMock: vi.fn(),
  listEventSlotTiebreakersMock: vi.fn(),
}));

bindApiMocks({
  listProviders: listProvidersMock,
  updateSportLeague: updateSportLeagueMock,
  listEventSlotTiebreakers: listEventSlotTiebreakersMock,
});

function wrapperFor(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

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

describe('useSportEventSlotTiebreakersQuery', () => {
  beforeEach(() => listEventSlotTiebreakersMock.mockReset());

  it('reads the event\'s slots with their tiebreaker games', async () => {
    listEventSlotTiebreakersMock.mockResolvedValue({ data: { slots: [{ sportEventSlotId: 'slot-1' }] } });
    const { result } = renderHook(() => useSportEventSlotTiebreakersQuery('evt-1'), { wrapper: wrapperFor(newClient()) });

    await waitFor(() => expect(result.current.data).toEqual([{ sportEventSlotId: 'slot-1' }]));
  });

  it('fails with the API\'s error when the read answers without slots', async () => {
    listEventSlotTiebreakersMock.mockResolvedValue({ error: { error: { code: 'EVENT_NOT_FOUND', message: 'No such event.' } } });
    const { result } = renderHook(() => useSportEventSlotTiebreakersQuery('evt-1'), { wrapper: wrapperFor(newClient()) });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });

  it('reads nothing until the page names an event', () => {
    const { result } = renderHook(() => useSportEventSlotTiebreakersQuery(''), { wrapper: wrapperFor(newClient()) });

    expect(result.current.fetchStatus).toBe('idle');
    expect(listEventSlotTiebreakersMock).not.toHaveBeenCalled();
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
      toBody: (name: string) => ({ name }),
    }), { wrapper: wrapperFor(queryClient) });

    await act(() => result.current.mutateAsync('PGA TOUR'));

    expect(updateSportLeagueMock).toHaveBeenCalledWith(expect.objectContaining({ path: { sportLeagueId: 'pga' }, body: { name: 'PGA TOUR' } }));
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
