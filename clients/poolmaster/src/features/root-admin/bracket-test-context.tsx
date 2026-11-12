import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MatchEnding, getSportDefinition, Sport } from '@poolmaster/shared/domain';
import type { SportEventMatchDto, SportEventParticipantDto } from '@/lib/api';
import type { BracketContext } from './bracket-match-write';
import { fieldEntryFixture, participantFixture } from './sport-test-fixtures';

// Test-only fixtures for the bracket match editors: two teams, a match between them and the
// context an editor reads.

export const homeTeam = fieldEntryFixture({ id: 'sep-1', participantId: 'p-1', seedNumber: 1, participant: participantFixture({ id: 'p-1', name: 'Arsenal' }) });
export const awayTeam = fieldEntryFixture({ id: 'sep-2', participantId: 'p-2', seedNumber: 2, participant: participantFixture({ id: 'p-2', name: 'Porto' }) });

export function bracketMatch(overrides: Partial<SportEventMatchDto> = {}): SportEventMatchDto {
  return {
    id: 'm-1',
    sportEventId: 'evt-1',
    roundNumber: 1,
    matchNumber: 1,
    homeSportEventParticipantId: 'sep-1',
    awaySportEventParticipantId: 'sep-2',
    isNeutralSite: false,
    scheduledDate: null,
    status: 'SCHEDULED',
    winnerSide: null,
    homeScore: null,
    awayScore: null,
    homeShootoutScore: null,
    awayShootoutScore: null,
    ending: MatchEnding.PLAYED,
    resultSource: null,
    advancesToMatchId: null,
    advancesToSide: null,
    regionLabel: null,
    homeSpread: null,
    periodScores: [],
    ...overrides,
  };
}

export function bracketContext({
  bracket,
  field = [homeTeam, awayTeam],
  sport = Sport.SOCCER,
}: {
  bracket: readonly SportEventMatchDto[];
  field?: readonly SportEventParticipantDto[];
  sport?: Sport;
}): BracketContext {
  const definition = getSportDefinition(sport);
  return {
    eventId: 'evt-1',
    vocabulary: definition.vocabulary,
    bracket,
    field,
    fieldById: new Map(field.map((entry) => [entry.id, entry])),
    spreads: false,
    shootout: definition.shootout,
    feedName: 'BALLDONTLIE',
  };
}

export function renderWithQueries(node: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>);
}
