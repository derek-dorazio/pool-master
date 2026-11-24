import type {
  ParticipantDto,
  PricingProfileDto,
  ReleaseCheckDto,
  SettingsGroup,
  SportDto,
  SportEventDto,
  SportEventParticipantDto,
  SportEventRoundDto,
  SportEventTierDto,
  SportLeagueDto,
} from '@/lib/api';

/** The Standard pricing profile's id, which `sportLeagueFixture` names. */
export const STANDARD_PRICING_PROFILE_ID = '00000000-0000-4000-8000-0000000000b2';

/**
 * #236 — fixtures for the golf admin tests, typed by the generated DTOs the screens read.
 * Each builder returns a complete, valid object; a test overrides only what it is about.
 */

export function sportEventFixture(overrides: Partial<SportEventDto> = {}): SportEventDto {
  return {
    id: 'event-1',
    externalId: 'manual-event-1',
    providerId: 'manual-admin',
    sport: 'GOLF',
    name: 'Rolling Weekend Invitational',
    venue: 'Mock Golf Club',
    location: 'Augusta, GA',
    status: 'DRAFT',
    startDate: '2026-05-07T12:00:00.000Z',
    endDate: '2026-05-10T22:00:00.000Z',
    rounds: 4,
    roundsPar: null,
    participantCount: null,
    loadedParticipantCount: 0,
    pricing: { profileName: 'Standard', salaryCap: 50000, unit: 100, topSharePercent: 24, floorSharePercent: 12, steepness: 4 },
    tierLayout: null,
    readinessStatus: 'NOT_RELEASED',
    readinessReasons: ['EVENT_NOT_RELEASED', 'FIELD_NOT_LOADED'],
    contestEligible: false,
    contestOpenings: [
      { selectionType: 'TIERED', opening: 'NOT_YET', startsAtRounds: [] },
      { selectionType: 'BUDGET_PICK', opening: 'NOT_YET', startsAtRounds: [] },
      { selectionType: 'RANDOM_DRAW', opening: 'NOT_YET', startsAtRounds: [] },
    ],
    tiersLocked: false,
    eventSeriesId: 'event-series-1',
    eventYear: 2026,
    sportLeagueId: 'league-1',
    participantType: null,
    scoringFamily: null,
    syncScope: 'NONE',
    providerSynced: false,
    autoLifecycleEnabled: true,
    tierCount: 6,
    adminCounts: { untieredParticipantCount: 0, unpricedParticipantCount: 0, emptyTierLabels: [], contestCount: 0 },
    releaseChecks: passingReleaseChecks(),
    lastAutoReleaseCheck: null,
    allowedTransitions: ['CANCELLED'],
    createdAt: '2026-04-01T10:00:00.000Z',
    updatedAt: '2026-04-01T11:00:00.000Z',
    ...overrides,
  };
}

/**
 * A draft's ready checks as the server answers them (#1823), every one passing; a test replaces
 * the one it is about with `failingReleaseCheck`.
 */
export function passingReleaseChecks(...replacements: ReleaseCheckDto[]): ReleaseCheckDto[] {
  const passing: ReleaseCheckDto[] = [
    { key: 'NOT_STARTED', passed: true, value: '2026-05-07T12:00:00.000Z' },
    { key: 'ROUNDS_SCHEDULED', passed: true, value: 4 },
    { key: 'FIELD_LOADED', passed: true, value: 120 },
    { key: 'TIERS_ASSIGNED', passed: true, value: 0 },
    { key: 'TIERS_FILLED', passed: true, value: [] },
    { key: 'PRICES_ASSIGNED', passed: true, value: 0 },
    { key: 'CONTEST_SETUPS_ON', passed: true, value: 3 },
  ];
  return passing.map((check) => replacements.find((replacement) => replacement.key === check.key) ?? check)
    .concat(replacements.filter((replacement) => !passing.some((check) => check.key === replacement.key)));
}

export function sportEventRoundFixture(overrides: Partial<SportEventRoundDto> = {}): SportEventRoundDto {
  const roundNumber = overrides.roundNumber ?? 1;
  return {
    id: `round-${roundNumber}`,
    sportEventId: 'event-1',
    roundNumber,
    scheduledDate: `2026-05-0${6 + roundNumber}T12:00:00.000Z`,
    scheduledEndAt: null,
    status: 'SCHEDULED',
    resultCount: 0,
    completedAt: null,
    ...overrides,
  };
}

export function participantFixture(overrides: Partial<ParticipantDto> = {}): ParticipantDto {
  return {
    id: 'participant-1',
    sportLeagueId: 'league-1',
    ranking: null,
    name: 'Rory McIlroy',
    participantType: 'INDIVIDUAL',
    status: 'ACTIVE',
    injuryStatus: { status: 'HEALTHY' },
    externalIds: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function fieldEntryFixture(
  overrides: Partial<SportEventParticipantDto> = {},
): SportEventParticipantDto {
  const participantId = overrides.participantId ?? 'participant-1';
  return {
    id: 'sep-1',
    sportEventId: 'event-1',
    participantId,
    isActive: true,
    inactiveReason: null,
    ranking: null,
    oddsToWin: null,
    seedNumber: null,
    isPlayInPlace: false,
    participant: participantFixture({ id: participantId }),
    valuation: null,
    standing: null,
    rounds: [],
    race: null,
    affiliatedWithSportLeague: true,
    createdAt: '2026-04-01T10:00:00.000Z',
    updatedAt: '2026-04-01T11:00:00.000Z',
    ...overrides,
  };
}

/** A valuation for a field entry: its tier (by id), place in the tier, and price. */
export function valuationFixture(
  overrides: Partial<NonNullable<SportEventParticipantDto['valuation']>> = {},
): NonNullable<SportEventParticipantDto['valuation']> {
  return {
    id: 'valuation-1',
    sportEventTierId: null,
    tierOrderIndex: null,
    tierAssignedSource: null,
    price: null,
    priceAssignedSource: null,
    ...overrides,
  };
}

export function tierFixture(overrides: Partial<SportEventTierDto> = {}): SportEventTierDto {
  const tierNumber = overrides.tierNumber ?? 1;
  return {
    id: `tier-${tierNumber}`,
    sportEventId: 'event-1',
    tierKey: `TIER_${tierNumber}`,
    label: `Tier ${tierNumber}`,
    tierNumber,
    ...overrides,
  };
}

export function sportLeagueFixture(overrides: Partial<SportLeagueDto> = {}): SportLeagueDto {
  return {
    id: 'league-1',
    sportId: 'sport-golf',
    sport: 'GOLF',
    name: 'PGA Tour',
    matchKeyword: 'PGA',
    eventSyncProviderId: null,
    autoReleaseDaysBeforeStart: 7,
    tierProfileId: '00000000-0000-4000-8000-0000000000a1',
    pricingProfileId: STANDARD_PRICING_PROFILE_ID,
    bracketAdvancement: 'FIXED',
    roundNames: [],
    matchPeriodLayout: null,
    squaresFromRound: null,
    noun: null,
    displayName: null,
    participantType: null,
    scoringFamily: null,
    displayOrder: null,
    currentEventYear: null,
    isActive: true,
    participantCount: 0,
    sportEventCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** The golf sport row `listSports` answers with, for pages that resolve the golf sport id. */
export const GOLF_SPORT_FIXTURE: SportDto = {
  id: 'sport-golf',
  sport: 'GOLF',
  participantType: 'INDIVIDUAL',
  tournamentFormat: 'STROKE_PLAY_TOURNAMENT',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

/** The platform's two pricing profiles as the migration made them (#1844), by name. */
export function pricingProfilesFixture(): PricingProfileDto[] {
  const stamps = { sportLeagueCount: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
  return [
    { id: '00000000-0000-4000-8000-0000000000b1', name: 'Small', salaryCap: 5000, unit: 10, topSharePercent: 24, floorSharePercent: 12, steepness: 4, ...stamps, sportLeagueCount: 0 },
    { id: STANDARD_PRICING_PROFILE_ID, name: 'Standard', salaryCap: 50000, unit: 100, topSharePercent: 24, floorSharePercent: 12, steepness: 4, ...stamps },
  ];
}

/** The Plans settings group at its code defaults (the plan matrix, #986), never changed. */
export function planGroupFixture(): Extract<SettingsGroup, { key: 'PLAN_CONFIG' }> {
  const value = {
    caps: {
      ENTRIES_PER_CONTEST: { FREE: 20, PRO: 50, PREMIUM: 100, PLATINUM: 500 },
      SPORTS_LEAGUES_PER_YEAR: { FREE: 5, PRO: 15, PREMIUM: 30, PLATINUM: 50 },
    },
    features: {
      EMAIL_CONTEST_OPENED: 'FREE', EMAIL_CONTEST_ENTRY_COMPLETED: 'FREE', EMAIL_CONTEST_RESULTS: 'FREE',
      EMAIL_CONTEST_EVENT_CHANGED: 'FREE', EMAIL_CONTEST_STARTED_SUMMARY: 'PRO', EMAIL_CONTEST_ENTRY_REMINDER: 'PRO',
      EMAIL_CONTEST_STANDINGS: 'PRO', EMAIL_EVENT_COMING_UP: 'PRO', EMAIL_EVENT_READY_FOR_CONTESTS: 'PRO',
      EMAIL_CONTEST_NOT_OPEN: 'PRO', EMAIL_YEAR_IN_REVIEW: 'PRO', EMAIL_LEAGUE_MEMBER_JOINED: 'PRO', CUP_STANDINGS: 'PRO', CUP_CROWNING: 'PRO', CHAMPIONSHIP: 'PRO',
      TROPHY_SHELF: 'PRO', CUP_SETTINGS: 'PRO', PAST_YEARS: 'PRO', ALL_TIME_SUMMARY: 'PREMIUM', RECORD_BOOK: 'PREMIUM',
    },
  } satisfies Extract<SettingsGroup, { key: 'PLAN_CONFIG' }>['value'];
  return {
    key: 'PLAN_CONFIG',
    title: 'Plans',
    description: 'What each league plan allows: its caps, and the plan each feature starts at.',
    source: 'defaults',
    updatedAt: null,
    updatedBy: null,
    value,
    defaults: value,
  };
}
