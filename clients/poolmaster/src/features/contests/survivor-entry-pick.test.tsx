import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { GamePicksResponse } from '@/lib/api';
import { QueryKeys } from '@/lib/query-keys';
import { useSurvivorEntryPick } from './survivor-entry-pick';
import { NFL_TEAMS, pickEmEventFieldFixture, pickEmWeekFixture, survivorWeekFixture, week1Games, weekPick } from './test/pick-em-fixtures';

const CONTEST = { id: 'contest-1', status: 'OPEN' as const };

/** The hook over a cache already holding the entry's picks and, when given, the week's field. */
function pickOf(picks: GamePicksResponse | undefined, options: { field?: boolean; enabled?: boolean; sportEventId?: string } = {}) {
  const sportEventId = 'sportEventId' in options ? options.sportEventId : 'week-1';
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  if (picks) queryClient.setQueryData(QueryKeys.gamePicks.detail(CONTEST.id, 'entry-1', 'week-1'), picks);
  if (options.field ?? true) queryClient.setQueryData(QueryKeys.sportEvents.field('week-1'), pickEmEventFieldFixture('week-1'));
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  return renderHook(() => useSurvivorEntryPick(CONTEST, 'entry-1', sportEventId, options.enabled ?? true), { wrapper }).result.current;
}

const picked = week1Games({ 3: { pick: weekPick(NFL_TEAMS.eagles) } });

describe('useSurvivorEntryPick', () => {
  it('names the survivor entry\'s pick by the week it is for and the team\'s short name', () => {
    expect(pickOf(survivorWeekFixture({ games: picked }))).toBe('Week 2: PHI');
  });

  it('falls back to the team\'s own name while the field is not read, and leaves out a week the picks name none for', () => {
    const noWeek = survivorWeekFixture({ games: picked, survivor: { eliminatedInWeek: null, usedTeams: [], roundWeeks: [] } });
    expect(pickOf(noWeek, { field: false })).toBe('Eagles');
  });

  it('names nothing for a survivor entry with no pick yet, or for a pick\'em entry', () => {
    expect(pickOf(survivorWeekFixture({ games: week1Games() }))).toBeNull();
    expect(pickOf(pickEmWeekFixture({ games: picked }))).toBeNull();
  });

  it('reads nothing and names nothing when not enabled, with no event, or before the picks are read', () => {
    expect(pickOf(survivorWeekFixture({ games: picked }), { enabled: false })).toBeNull();
    expect(pickOf(survivorWeekFixture({ games: picked }), { sportEventId: undefined })).toBeNull();
    expect(pickOf(undefined, { enabled: false })).toBeNull();
  });
});
