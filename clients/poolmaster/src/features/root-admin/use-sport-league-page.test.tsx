import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import {
  useSportLeagueConferencesQuery,
  useSportLeagueContestTemplatesQuery,
  useSportLeagueEventOverviewsQuery,
  useSportLeagueParticipantOverviewsQuery,
  useSportLeaguePositionsQuery,
  useSportLeagueStructureQuery,
  useSportLeagueSyncsQuery,
} from './use-sport-league-page';

const refuse = () => vi.fn().mockResolvedValue({ error: { error: { code: 'SPORT_LEAGUE_NOT_FOUND', message: 'No such league.' } }, status: 404 });

bindApiMocks({
  listSportLeagueSyncs: refuse(),
  listSportLeagueEventOverviews: refuse(),
  listSportLeagueParticipantOverviews: refuse(),
  listContestConfigTemplates: refuse(),
  getSportLeagueStructure: refuse(),
  listSportLeaguePositions: refuse(),
  listSportLeagueConferences: refuse(),
});

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

describe('the League page reads', () => {
  it.each([
    ['syncs', useSportLeagueSyncsQuery],
    ['events', useSportLeagueEventOverviewsQuery],
    ['participants', useSportLeagueParticipantOverviewsQuery],
    ['contest templates', useSportLeagueContestTemplatesQuery],
    ['structure', useSportLeagueStructureQuery],
    ['positions', useSportLeaguePositionsQuery],
    ['conferences', useSportLeagueConferencesQuery],
  ])('fails the %s read when the API refuses it', async (_name, useRead) => {
    const { result } = renderHook(() => useRead('sport-league-1'), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
