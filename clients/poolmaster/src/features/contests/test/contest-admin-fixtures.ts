import { ContestOpening, SelectionType, eventSportDefinition } from '@poolmaster/shared/domain';
import { sportPlay } from '@/test/sport-play';
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

/**
 * The API's contest openings for an event before it starts: every selection type its definition
 * offers, OPEN when it is contest-ready and NOT_YET otherwise, a bracket at the full bracket only.
 * A test of a knockout under way passes its own.
 */
export function openingsBeforeStart(
  event: Pick<SportEventDto, 'sport' | 'participantType' | 'scoringFamily'>,
  opening: ContestOpening = ContestOpening.OPEN,
): SportEventDto['contestOpenings'] {
  return eventSportDefinition(event).selectionTypes.map((selectionType) => ({
    selectionType,
    opening,
    startsAtRounds: selectionType === SelectionType.BRACKET ? [1] : [],
  }));
}

/**
 * The API's contest openings for a knockout under way (#721, #711): a second-chance bracket from
 * the rounds given and squares stay OPEN, every other selection type is CLOSED.
 */
export function openingsUnderWay(
  event: Pick<SportEventDto, 'sport' | 'participantType' | 'scoringFamily'>,
  bracketStartsAtRounds: number[],
): SportEventDto['contestOpenings'] {
  return eventSportDefinition(event).selectionTypes.map((selectionType) => {
    if (selectionType === SelectionType.BRACKET) {
      return {
        selectionType,
        opening: bracketStartsAtRounds.length > 0 ? ContestOpening.OPEN : ContestOpening.CLOSED,
        startsAtRounds: bracketStartsAtRounds,
      };
    }
    return { selectionType, opening: selectionType === SelectionType.SQUARES ? ContestOpening.OPEN : ContestOpening.CLOSED, startsAtRounds: [] };
  });
}

type LooseEvent = { sport: SportEventDto['sport']; participantType?: SportEventDto['participantType']; scoringFamily?: SportEventDto['scoringFamily']; contestEligible?: boolean; contestOpenings?: unknown };

/**
 * A list-events answer with each event that names no openings given the ones an event before its
 * start has: OPEN when contest-ready, else NOT_YET. Lets a page test's partial events stand in for
 * the API's; a test of a knockout under way names its own with `openingsUnderWay`.
 */
export function withEventOpenings<T>(response: T): T {
  const events = (response as { data?: { events?: LooseEvent[] } } | undefined)?.data?.events;
  if (!events) return response;
  return {
    ...(response as object),
    data: {
      ...(response as { data: object }).data,
      events: events.map((event) => (event.contestOpenings !== undefined ? event : {
        ...event,
        contestOpenings: openingsBeforeStart(
          { ...sportPlay(event.sport), sport: event.sport, ...(event.participantType && { participantType: event.participantType }), ...(event.scoringFamily && { scoringFamily: event.scoringFamily }) },
          event.contestEligible === false ? ContestOpening.NOT_YET : ContestOpening.OPEN,
        ),
      })),
    },
  } as T;
}

export function buildSportEvent(overrides: Partial<SportEventDto> = {}): SportEventDto {
  const event: Omit<SportEventDto, 'contestOpenings'> = {
    id: 'event-1',
    externalId: 'ext-event-1',
    providerId: 'manual-admin',
    providerName: null,
    sport: 'GOLF',
    sportUrlSegment: 'golf',
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
    pricing: { profileName: 'Standard', salaryCap: 50000, unit: 100, topSharePercent: 24, floorSharePercent: 12, steepness: 4 },
    tierLayout: null,
    readinessStatus: 'CONTEST_ELIGIBLE',
    readinessReasons: [],
    contestEligible: true,
    tiersLocked: true,
    eventSeriesId: '00000000-0000-4000-8000-000000000001',
    eventYear: 2099,
    sportLeagueId: '00000000-0000-4000-8000-000000000002',
    ...sportPlay(overrides.sport ?? 'GOLF'),
    syncScope: 'SCORES_ONLY',
    providerSynced: false,
    autoLifecycleEnabled: true,
    tierCount: 6,
    // A commissioner's read: only a root admin's carries the admin counts (#1198).
    adminCounts: null,
    releaseChecks: null,
    lastAutoReleaseCheck: null,
    allowedTransitions: [],
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    ...overrides,
  };
  return {
    ...event,
    contestOpenings: overrides.contestOpenings
      ?? openingsBeforeStart(event, event.contestEligible ? ContestOpening.OPEN : ContestOpening.NOT_YET),
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
    endDate: null,
    status: 'SCHEDULED',
    participantType: 'INDIVIDUAL',
    scoringFamily: 'STROKE_PLAY',
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
    entriesPerContest: null,
    sportEvents: [buildContestSportEvent()],
    sport: 'GOLF',
    entryCount: 0,
    enteredSquadCount: 0,
    allEntryCount: 0,
    myEntryIds: [],
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
