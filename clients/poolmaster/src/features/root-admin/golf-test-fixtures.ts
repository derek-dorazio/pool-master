import type {
  ParticipantDto,
  ParticipantLeagueAffiliationDto,
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
    readinessStatus: 'NOT_RELEASED',
    readinessReasons: ['EVENT_NOT_RELEASED', 'FIELD_NOT_LOADED'],
    contestEligible: false,
    eventSeriesId: 'event-series-1',
    eventYear: 2026,
    sportLeagueId: 'league-1',
    syncScope: 'NONE',
    autoLifecycleEnabled: true,
    tierCount: 6,
    contestCount: 0,
    allowedTransitions: ['CANCELLED'],
    metadata: {},
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
    participant: participantFixture({ id: participantId }),
    valuation: null,
    standing: null,
    rounds: [],
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
    name: 'PGA Tour',
    matchKeyword: 'PGA',
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
export const GOLF_SPORT_FIXTURE = {
  id: 'sport-golf',
  name: 'GOLF' as const,
  participantType: 'INDIVIDUAL' as const,
  category: 'GOLF' as const,
  tournamentFormat: 'STROKE_PLAY_TOURNAMENT' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
