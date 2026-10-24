import type {
  ParticipantDto,
  ParticipantLeagueAffiliationDto,
  SettingsGroup,
  SportDto,
  SportEventDto,
  SportEventParticipantDto,
  SportEventRoundDto,
  SportEventTierDto,
  SportLeagueDto,
} from '@/lib/api';

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
    untieredParticipantCount: 0,
    emptyTierLabels: [],
    unpricedParticipantCount: 0,
    pricing: { profileName: 'Standard', salaryCap: 50000, unit: 100, topSharePercent: 24, floorSharePercent: 12, steepness: 4 },
    readinessStatus: 'NOT_RELEASED',
    readinessReasons: ['EVENT_NOT_RELEASED', 'FIELD_NOT_LOADED'],
    contestEligible: false,
    eventSeriesId: 'event-series-1',
    eventYear: 2026,
    sportLeagueId: 'league-1',
    participantType: null,
    scoringFamily: null,
    syncScope: 'NONE',
    autoLifecycleEnabled: true,
    tierCount: 6,
    contestCount: 0,
    allowedTransitions: ['CANCELLED'],
    createdAt: '2026-04-01T10:00:00.000Z',
    updatedAt: '2026-04-01T11:00:00.000Z',
    ...overrides,
  };
}

export function sportEventRoundFixture(overrides: Partial<SportEventRoundDto> = {}): SportEventRoundDto {
  const roundNumber = overrides.roundNumber ?? 1;
  return {
    id: `round-${roundNumber}`,
    sportEventId: 'event-1',
    roundNumber,
    scheduledDate: `2026-05-0${6 + roundNumber}T12:00:00.000Z`,
    scheduledEndAt: null,
    ...overrides,
  };
}

export function participantFixture(overrides: Partial<ParticipantDto> = {}): ParticipantDto {
  return {
    id: 'participant-1',
    sportId: 'sport-golf',
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
    affiliationCount: 0,
    sportEventCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function affiliationFixture(
  overrides: Partial<ParticipantLeagueAffiliationDto> = {},
): ParticipantLeagueAffiliationDto {
  const participantId = overrides.participantId ?? 'participant-1';
  return {
    id: `affiliation-${participantId}`,
    sportLeagueId: 'league-1',
    participantId,
    ranking: null,
    participant: participantFixture({ id: participantId }),
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

/** The Budget pricing settings group with the app's two default profiles, Standard first (#93). */
export function budgetPricingGroupFixture(): Extract<SettingsGroup, { key: 'BUDGET_PRICING_CONFIG' }> {
  const profiles = [
    { name: 'Standard', salaryCap: 50000, unit: 100, topSharePercent: 24, floorSharePercent: 12, steepness: 4 },
    { name: 'Small', salaryCap: 5000, unit: 10, topSharePercent: 24, floorSharePercent: 12, steepness: 4 },
  ];
  return {
    key: 'BUDGET_PRICING_CONFIG',
    title: 'Budget pricing',
    description: 'The pricing profiles an event\'s field is priced with for budget contests.',
    source: 'defaults',
    updatedAt: null,
    updatedBy: null,
    value: { profiles },
    defaults: { profiles },
  };
}

/** The Plans settings group at its starting values (#944), never changed. */
export function planGroupFixture(): Extract<SettingsGroup, { key: 'PLAN_CONFIG' }> {
  const value = {
    caps: {
      ENTRIES_PER_CONTEST: { FREE: 20, PRO: 50, PREMIUM: 100 },
      SPORTS_LEAGUES_PER_YEAR: { FREE: 1, PRO: 3, PREMIUM: 10 },
    },
    features: {
      EMAIL_CONTEST_OPENED: 'FREE', EMAIL_CONTEST_ENTRY_COMPLETED: 'FREE', EMAIL_CONTEST_RESULTS: 'FREE',
      EMAIL_CONTEST_EVENT_CHANGED: 'FREE', EMAIL_CONTEST_STARTED_SUMMARY: 'PRO', EMAIL_CONTEST_ENTRY_REMINDER: 'PRO',
      EMAIL_CONTEST_STANDINGS: 'PRO', EMAIL_EVENT_COMING_UP: 'PRO', EMAIL_EVENT_READY_FOR_CONTESTS: 'PRO',
      EMAIL_CONTEST_NOT_OPEN: 'PRO', EMAIL_YEAR_IN_REVIEW: 'PRO', EMAIL_LEAGUE_MEMBER_JOINED: 'PRO', CUP_STANDINGS: 'PRO', CUP_CROWNING: 'PRO', CHAMPIONSHIP: 'PRO',
      TROPHY_SHELF: 'PRO', CUP_SETTINGS: 'PRO', PAST_YEARS: 'PRO', ALL_TIME_SUMMARY: 'PLATINUM', RECORD_BOOK: 'PLATINUM',
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
