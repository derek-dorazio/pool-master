import { SelectionType } from '@poolmaster/shared/domain';
import type {
  ContestDto,
  ContestEntryDto,
  ContestManagementDetailDto,
  ContestSportEventDto,
  EffectiveTierDto,
  SelectionStateResponse,
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
    emptyTierLabels: [],
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

/** One event of a contest, as a contest read names it: the first event, not started. */
export function buildContestSportEvent(
  overrides: Partial<ContestSportEventDto> = {},
): ContestSportEventDto {
  return {
    sportEventId: 'event-1',
    sequence: 1,
    name: 'The Masters',
    startDate: FUTURE_START,
    status: 'SCHEDULED',
    ...overrides,
  };
}

export function buildContest(overrides: Partial<ContestDto> = {}): ContestDto {
  return {
    id: 'contest-1',
    name: 'Masters One-and-Done',
    status: 'DRAFT',
    contestFormat: 'ROSTER',
    selectionType: SelectionType.TIERED,
    leagueId: 'league-1',
    sportEvents: [buildContestSportEvent()],
    sport: 'GOLF',
    entryCount: 0,
    ...overrides,
  };
}

export function buildTier(tierNumber: number, golferCount: number): EffectiveTierDto {
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
    sportEvents: [
      {
        sportEventId: 'event-1',
        effectiveTiers: [buildTier(1, 8), buildTier(2, 12), buildTier(3, 14), buildTier(4, 16), buildTier(5, 18), buildTier(6, 21)],
      },
    ],
    name: 'Masters One-and-Done',
    status: 'DRAFT',
    cupWeight: 'NORMAL',
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    configuration: {
      id: `config-${id}`,
      contestId: id,
      maxEntriesPerSquad: 1,
      selectionType: SelectionType.TIERED,
      picksPerTier: 1,
      countedScores: 4,
    },
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
    events: [{ sportEventId: 'event-1', status: 'SUBMITTED', submittedAt: '2026-04-03T00:00:00.000Z' }],
    picksCount: 6,
    createdAt: '2026-04-02T00:00:00.000Z',
    updatedAt: '2026-04-02T00:00:00.000Z',
    ...overrides,
  };
}

/** A contest's room as the commissioner reads it, no entry named: what the draw state comes from. */
export function buildSelectionState(overrides: Partial<SelectionStateResponse> = {}): SelectionStateResponse {
  return {
    contestId: 'contest-1',
    contestName: 'Masters Sweepstake',
    sportEventId: 'event-1',
    acceptsPicks: true,
    selectionType: SelectionType.RANDOM_DRAW,
    drawnAt: null,
    isCommissioner: true,
    rosterSize: 3,
    status: 'LIVE',
    myEntryId: null,
    entries: [],
    pickHistories: [],
    availableParticipantIds: [],
    selectionGroups: [],
    isComplete: false,
    ...overrides,
  };
}
