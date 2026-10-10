import type {
  ContestDto,
  ContestEntryDto,
  ContestManagementDetailDto,
  GolfEffectiveTierDto,
  SportEventDto,
} from '@/lib/api';

/** Far enough ahead that "has not started" holds whatever day the suite runs. */
export const FUTURE_START = '2099-04-09T12:40:00.000Z';

export function buildSportEvent(overrides: Partial<SportEventDto> = {}): SportEventDto {
  return {
    id: 'event-1',
    externalId: 'ext-event-1',
    providerId: 'manual-admin',
    sport: 'GOLF',
    name: 'The Masters',
    venue: 'Augusta National',
    location: 'Augusta, GA',
    status: 'SCHEDULED',
    startDate: FUTURE_START,
    endDate: null,
    rounds: 4,
    roundsPar: null,
    participantCount: 89,
    loadedParticipantCount: 89,
    untieredParticipantCount: 0,
    unpricedParticipantCount: 0,
    pricing: { profileName: 'Standard', salaryCap: 50000, unit: 100, topSharePercent: 24, floorSharePercent: 12, steepness: 4 },
    readinessStatus: 'CONTEST_ELIGIBLE',
    readinessReasons: [],
    contestEligible: true,
    eventSeriesId: '00000000-0000-4000-8000-000000000001',
    eventYear: 2099,
    sportLeagueId: '00000000-0000-4000-8000-000000000002',
    syncScope: 'SCORES_ONLY',
    autoLifecycleEnabled: true,
    tierCount: 6,
    contestCount: 1,
    allowedTransitions: [],
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    ...overrides,
  };
}

export function buildContest(overrides: Partial<ContestDto> = {}): ContestDto {
  return {
    id: 'contest-1',
    name: 'Masters One-and-Done',
    status: 'DRAFT',
    contestFormat: 'ROSTER',
    selectionType: 'TIERED',
    scoringEngine: 'STROKE_PLAY',
    leagueId: 'league-1',
    sportEventId: 'event-1',
    sport: 'GOLF',
    entryCount: 0,
    isExclusive: false,
    ...overrides,
  };
}

export function buildTier(tierNumber: number, golferCount: number): GolfEffectiveTierDto {
  return {
    tierKey: `tier-${tierNumber}`,
    label: `Tier ${tierNumber}`,
    tierNumber,
    assignments: Array.from({ length: golferCount }, (_, index) => ({
      sportEventParticipantId: `sep-${tierNumber}-${index}`,
      participantId: `golfer-${tierNumber}-${index}`,
      tierOrderIndex: index,
      price: null,
    })),
  };
}

export function buildManagedContest(
  overrides: Partial<ContestManagementDetailDto> = {},
): ContestManagementDetailDto {
  const id = overrides.id ?? 'contest-1';
  return {
    id,
    leagueId: 'league-1',
    sportEventId: 'event-1',
    name: 'Masters One-and-Done',
    status: 'DRAFT',
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    configuration: {
      id: `config-${id}`,
      contestId: id,
      maxEntriesPerSquad: 1,
      picksPerTier: 1,
      countedScores: 4,
    },
    effectiveTiers: [buildTier(1, 8), buildTier(2, 12), buildTier(3, 14), buildTier(4, 16), buildTier(5, 18), buildTier(6, 21)],
    ...overrides,
  };
}

export function buildContestEntry(overrides: Partial<ContestEntryDto> = {}): ContestEntryDto {
  return {
    id: 'entry-1',
    contestId: 'contest-1',
    squadId: 'team-1',
    squadName: 'Team One',
    entryNumber: 1,
    name: 'Entry 1',
    status: 'SUBMITTED',
    picksCount: 6,
    createdAt: '2026-04-02T00:00:00.000Z',
    updatedAt: '2026-04-02T00:00:00.000Z',
    ...overrides,
  };
}
