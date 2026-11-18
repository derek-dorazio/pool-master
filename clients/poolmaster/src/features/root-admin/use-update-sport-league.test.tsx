import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { QueryKeys } from '@/lib/query-keys';
import { bindApiMocks } from '@/test/msw-api';
import { sportLeagueFixture } from './sport-test-fixtures';
import { useUpdateSportLeague } from './use-update-sport-league';

const { updateSportLeagueMock } = vi.hoisted(() => ({ updateSportLeagueMock: vi.fn() }));

bindApiMocks({ updateSportLeague: updateSportLeagueMock });

describe('useUpdateSportLeague', () => {
  it('reads again the league lists and both profile lists after a save, so a league naming another profile moves its "Used by" counts and names', async () => {
    updateSportLeagueMock.mockResolvedValue({ data: { sportLeague: sportLeagueFixture({ id: 'pga' }) } });
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidated = vi.spyOn(queryClient, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useUpdateSportLeague<string>({
      failedAction: 'sportLeague.profile.failed',
      refusedMessage: 'Sport league update was rejected',
      sportLeagueId: 'pga',
      toBody: (tierProfileId) => ({ tierProfileId }),
    }), { wrapper });

    await act(async () => {
      await result.current.mutateAsync('00000000-0000-4000-8000-0000000000a9');
    });

    expect(invalidated.mock.calls.map(([filters]) => filters?.queryKey)).toEqual(expect.arrayContaining([
      QueryKeys.rootAdmin.manageSport.leagues,
      QueryKeys.sportLeagues.list(),
      QueryKeys.rootAdmin.tierProfiles,
      QueryKeys.rootAdmin.pricingProfiles,
    ]));
  });
});
