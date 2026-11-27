import { sportPlay } from '../../support/sport-play';
import { AutoReleaseCheckOutcome, ContestStatus, MatchFormat, ReleaseCheckKey, RoundStatus, SeasonSlotStatus, SeriesFormat, SlotKind, SlotPairing, Sport, type SportEvent, type SportEventTierSlot } from '@poolmaster/shared/domain';
import {
  mapSportEventContestsToResponse,
  mapSportEventRoundToDto,
  mapSportEventTierToDto,
  mapSportEventToDto,
} from '../../../packages/core-api/src/mappers/sport-events.mapper';
import type { SportEventSummary } from '../../../packages/core-api/src/modules/events/service';
import { inMemoryStandardPricing } from '../../support/budget-pricing';
import { ROUNDS_PAR_MAX, ROUNDS_PAR_MIN } from '@poolmaster/shared/dto';
import { roundSlot } from '../../support/round-slots';

function event(overrides: Partial<SportEvent> = {}): SportEvent {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    providerMappings: [{ providerCode: 'BALLDONTLIE', providerName: 'BALLDONTLIE', externalId: 'mock-major-2026' }],
    sport: 'GOLF',
    sportUrlSegment: 'golf',
    name: 'Mock Major',
    status: 'SCHEDULED',
    // Far ahead, so the mapper's own clock always reads it as not yet started.
    startDate: new Date('2999-04-12T16:00:00.000Z'),
    slotDefinitions: [],
    sportLeagueSeasonId: 'season-2026',
    championshipYear: 2026,
    sportLeagueId: '33333333-3333-4333-8333-333333333333',
    autoLifecycleEnabled: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...sportPlay(overrides.sport ?? Sport.GOLF),
    ...overrides,
  };
}

/** The event's first slot (#2044), its set tiered and priced as given. */
function firstSlot(sportEvent: SportEvent, set: Partial<Pick<SportEventTierSlot, 'pricing' | 'tierLayout'>> = {}): SportEventTierSlot {
  return { id: 'event-slot-1', sportEventId: sportEvent.id, seasonSlotId: 'season-slot-1', slotDefinitionId: 'slot-definition-1', seasonSlotStatus: SeasonSlotStatus.SCHEDULED, holdsTierSet: true, isTierSetSlot: true, tierLayout: null, pricing: null, ...set };
}

/** A root admin's summary, with the admin counts; `adminCounts: null` is everyone else's. */
function summary(sportEvent: SportEvent, participantCount: number, untieredParticipantCount = 0, tierSetSlot: SportEventTierSlot | null = firstSlot(sportEvent)): SportEventSummary {
  return {
    event: sportEvent,
    participantCount,
    tierCount: 0,
    tierSetSlot,
    tierSets: tierSetSlot === null ? [] : [{ slot: tierSetSlot, tierCount: 0 }],
    adminCounts: { untieredParticipantCount, unpricedParticipantCount: 0, emptyTierNumbers: [], contestCount: 0 },
    slots: [],
  };
}

describe('SportEvent pricing on the wire (#93)', () => {
  it('carries the values the event\'s first slot was priced with, whose salary cap every budget contest on the event uses', () => {
    const pricing = inMemoryStandardPricing();
    const priced = event();

    expect(mapSportEventToDto(summary(priced, 72, 0, firstSlot(priced, { pricing }))).pricing).toEqual(pricing);
  });

  it('locks the tiers of a draft that covers no slot, which has no set to edit', () => {
    expect(mapSportEventToDto(summary(event({ status: 'DRAFT' }), 0, 0, null))).toMatchObject({ tiersLocked: true, pricing: null, tierLayout: null });
  });

  it('leaves a draft\'s first-slot set editable and locks it once the event is released', () => {
    expect(mapSportEventToDto(summary(event({ status: 'DRAFT' }), 0)).tiersLocked).toBe(false);
    expect(mapSportEventToDto(summary(event({ status: 'SCHEDULED' }), 0)).tiersLocked).toBe(true);
  });

  it('carries null pricing for an event whose prices were never assigned', () => {
    expect(mapSportEventToDto(summary(event(), 72)).pricing).toBeNull();
  });
});

describe('SportEvent par bounds on the wire', () => {
  it('sends the par per round an update takes, so the settings form checks what the server checks', () => {
    expect(mapSportEventToDto(summary(event(), 72))).toEqual(expect.objectContaining({ roundsParMin: ROUNDS_PAR_MIN, roundsParMax: ROUNDS_PAR_MAX }));
  });
});

describe('SportEvent contest openings and tier lock on the wire (#1929)', () => {
  it('opens every format golf offers on a contest-ready event, and locks its tiers and prices since it is released', () => {
    expect(mapSportEventToDto(summary(event(), 72))).toMatchObject({
      contestOpenings: [
        { selectionType: 'TIERED', opening: 'OPEN' },
        { selectionType: 'BUDGET_PICK', opening: 'OPEN' },
        { selectionType: 'RANDOM_DRAW', opening: 'OPEN' },
      ],
      tiersLocked: true,
    });
  });

  it('opens nothing yet on a draft, whose tiers and prices are still editable', () => {
    const dto = mapSportEventToDto(summary(event({ status: 'DRAFT' }), 72));
    expect(dto.tiersLocked).toBe(false);
    expect(dto.contestOpenings.map((row) => row.opening)).toEqual(['NOT_YET', 'NOT_YET', 'NOT_YET']);
  });
});

describe('SportEvent readiness on the wire', () => {
  it('is contest-eligible once released with a loaded field and before it starts', () => {
    expect(mapSportEventToDto(summary(event(), 72))).toMatchObject({
      participantCount: 72,
      readinessStatus: 'CONTEST_ELIGIBLE',
      contestEligible: true,
    });
  });

  it('is not released while the event is a draft, and carries how many active participants have no tier', () => {
    expect(mapSportEventToDto(summary(event({ status: 'DRAFT' }), 72, 5))).toMatchObject({
      status: 'DRAFT',
      adminCounts: { untieredParticipantCount: 5 },
      readinessStatus: 'NOT_RELEASED',
      readinessReasons: ['EVENT_NOT_RELEASED'],
      contestEligible: false,
    });
  });

  it('is pending, with a field size of 0, while no participant is loaded', () => {
    expect(mapSportEventToDto(summary(event(), 0))).toMatchObject({
      participantCount: 0,
      readinessStatus: 'PENDING_FIELD',
      readinessReasons: ['FIELD_NOT_LOADED'],
      contestEligible: false,
    });
  });

  it('reports a released event whose start time has passed as started', () => {
    expect(mapSportEventToDto(summary(event({ startDate: new Date('2000-04-12T16:00:00.000Z') }), 72))).toMatchObject({
      readinessStatus: 'EVENT_STARTED',
      contestEligible: false,
    });
  });

  it('carries null, not undefined, for absent optional columns', () => {
    expect(mapSportEventToDto(summary(event(), 1))).toMatchObject({
      venue: null,
      location: null,
      endDate: null,
      rounds: null,
    });
  });

  // The Season and the sport league are always present: an event has exactly one of each (#2010).
  it('carries the event\'s slot definitions in play order, its Season with that Season\'s championship year, and its sport league', () => {
    const slotted = event({ slotDefinitions: [{ id: 'afc-championship', slotKind: SlotKind.SEMIFINAL, canEndTied: false, periods: null, matchFormat: MatchFormat.HEAD_TO_HEAD }, { id: 'nfc-championship', slotKind: SlotKind.SEMIFINAL, canEndTied: false, periods: null, matchFormat: MatchFormat.HEAD_TO_HEAD }] });
    expect(mapSportEventToDto(summary(slotted, 1))).toMatchObject({
      slotDefinitionIds: ['afc-championship', 'nfc-championship'],
      sportLeagueSeasonId: 'season-2026',
      championshipYear: 2026,
      sportLeagueId: '33333333-3333-4333-8333-333333333333',
    });
  });

  it('says the event plays matches when one of its slots is HEAD_TO_HEAD, and not when its slots are all FIELD (#2008)', () => {
    const slot = (id: string, matchFormat: MatchFormat) => ({ id, slotKind: SlotKind.TOURNAMENT, canEndTied: true, periods: null, matchFormat });
    expect(mapSportEventToDto(summary(event({ slotDefinitions: [slot('final', MatchFormat.HEAD_TO_HEAD)] }), 1)).playsMatches).toBe(true);
    expect(mapSportEventToDto(summary(event({ slotDefinitions: [slot('masters', MatchFormat.FIELD)] }), 1)).playsMatches).toBe(false);
  });
});

describe('SportEvent last automatic release try on the wire (#1889)', () => {
  it('sends the stored try with its time as ISO and its failed checks', () => {
    const checkedAt = new Date('2026-11-18T21:04:00.000Z');
    const dto = mapSportEventToDto(summary(event({
      status: 'DRAFT',
      autoReleaseCheck: { checkedAt, outcome: AutoReleaseCheckOutcome.HELD, failedChecks: [ReleaseCheckKey.TIERS_FILLED] },
    }), 1));

    expect(dto.lastAutoReleaseCheck).toEqual({ checkedAt: checkedAt.toISOString(), outcome: AutoReleaseCheckOutcome.HELD, failedChecks: [ReleaseCheckKey.TIERS_FILLED] });
  });

  it('sends null for an event never tried', () => {
    expect(mapSportEventToDto(summary(event(), 1)).lastAutoReleaseCheck).toBeNull();
  });
});

describe('the contests on an event on the wire (#1889)', () => {
  const AT = new Date('2026-11-18T15:00:00.000Z');

  it('sends each contest\'s league and template flat, its creation time as ISO, and a contest with no template as nulls', () => {
    const response = mapSportEventContestsToResponse([
      { id: 'c1', name: 'Sentry pick 6', status: ContestStatus.DRAFT, league: { id: 'l1', leagueCode: 'HOOPS', name: 'Office Hoops' }, contestTemplate: { id: 't1', name: 'Pick 6' }, entryCount: 3, createdAt: AT },
      { id: 'c2', name: 'One and done', status: ContestStatus.OPEN, league: { id: 'l2', leagueCode: 'PALS', name: 'Golf Pals' }, contestTemplate: null, entryCount: 0, createdAt: AT },
    ]);

    expect(response).toEqual({
      contests: [
        { id: 'c1', name: 'Sentry pick 6', status: ContestStatus.DRAFT, leagueId: 'l1', leagueCode: 'HOOPS', leagueName: 'Office Hoops', contestTemplateId: 't1', contestTemplateName: 'Pick 6', entryCount: 3, createdAt: AT.toISOString() },
        { id: 'c2', name: 'One and done', status: ContestStatus.OPEN, leagueId: 'l2', leagueCode: 'PALS', leagueName: 'Golf Pals', contestTemplateId: null, contestTemplateName: null, entryCount: 0, createdAt: AT.toISOString() },
      ],
    });
  });
});

describe('SportEvent admin counts on the wire (#1198)', () => {
  it('carries null admin counts for a read that did not count them, keeping the field size and tier count', () => {
    expect(mapSportEventToDto({ event: event(), participantCount: 72, tierCount: 6, tierSetSlot: null, tierSets: [], adminCounts: null, slots: [] })).toMatchObject({
      participantCount: 72,
      tierCount: 6,
      adminCounts: null,
      contestEligible: true,
    });
  });
});

describe('SportEvent next statuses on the wire', () => {
  it('carries the declared transitions from the event\'s current status, and its counts', () => {
    const adminCounts = { untieredParticipantCount: 0, unpricedParticipantCount: 0, emptyTierNumbers: [6], contestCount: 2 };
    expect(mapSportEventToDto({ event: event({ status: 'SCHEDULED' }), participantCount: 0, tierCount: 6, tierSetSlot: null, tierSets: [], adminCounts, slots: [] })).toMatchObject({
      allowedTransitions: ['IN_PROGRESS', 'POSTPONED', 'CANCELLED'],
      tierCount: 6,
      adminCounts,
    });
    expect(mapSportEventToDto(summary(event({ status: 'COMPLETED' }), 0)).allowedTransitions).toEqual([]);
  });

  it('does not offer SCHEDULED from a draft: releasing it is its own action (#431)', () => {
    expect(mapSportEventToDto(summary(event({ status: 'DRAFT' }), 0)).allowedTransitions).toEqual(['CANCELLED']);
  });
});

describe('the event\'s rounds and tiers on the wire', () => {
  const AT = new Date('2026-04-09T12:00:00.000Z');

  it('sends a round\'s scheduled end as ISO, and a round with none as null, with the slot it is played in', () => {
    const round = {
      id: 'r1', sportEventId: 'e1', roundNumber: 1, scheduledDate: AT, scheduledEndAt: AT, createdAt: AT, updatedAt: AT,
      slot: roundSlot(SlotKind.FINAL, { name: 'Super Bowl' }),
      progress: { status: RoundStatus.SCHEDULED, resultCount: 0, completedAt: null },
    };

    expect(mapSportEventRoundToDto(round)).toEqual({
      id: 'r1', sportEventId: 'e1', roundNumber: 1, scheduledDate: AT.toISOString(), scheduledEndAt: AT.toISOString(),
      slot: { seasonSlotId: round.slot.seasonSlotId, name: 'Super Bowl', slotKind: SlotKind.FINAL, weekNumber: null, periods: null },
      status: RoundStatus.SCHEDULED, resultCount: 0, completedAt: null,
    });
    expect(mapSportEventRoundToDto({ ...round, scheduledEndAt: null }).scheduledEndAt).toBeNull();
  });

  it('sends a finished round\'s status, result count and completion time as ISO', () => {
    const round = {
      id: 'r1', sportEventId: 'e1', roundNumber: 2, scheduledDate: AT, scheduledEndAt: null, createdAt: AT, updatedAt: AT,
      slot: roundSlot(SlotKind.TOURNAMENT),
      progress: { status: RoundStatus.COMPLETED, resultCount: 8, completedAt: AT },
    };

    expect(mapSportEventRoundToDto(round)).toMatchObject({ status: RoundStatus.COMPLETED, resultCount: 8, completedAt: AT.toISOString() });
  });

  it('sends a tier\'s key and number and the Season slot whose set it is in, with no stored name', () => {
    expect(mapSportEventTierToDto({ id: 't1', sportEventId: 'e1', sportEventSlotId: 'es1', seasonSlotId: 's1', tierKey: 'A', tierNumber: 1, createdAt: new Date(0), updatedAt: new Date(0) }))
      .toEqual({ id: 't1', seasonSlotId: 's1', tierKey: 'A', tierNumber: 1 });
  });
});

describe('SportEvent provider sync on the wire (ADR 0011)', () => {
  it('names an event\'s provider when its sport league\'s sync provider has an id for it, and sends every provider\'s id', () => {
    const dto = mapSportEventToDto(summary(event({ syncProviderId: 'balldontlie' }), 72));

    expect(dto).toMatchObject({ isTestData: false, providerName: 'BALLDONTLIE', slots: [] });
    expect(dto.providerMappings).toEqual([{ providerCode: 'BALLDONTLIE', providerName: 'BALLDONTLIE', externalId: 'mock-major-2026' }]);
  });

  it('names no provider for an event of a league no provider syncs', () => {
    expect(mapSportEventToDto(summary(event(), 72))).toMatchObject({ providerName: null });
  });

  it('marks an event on a test slot a test event, with its slot on the wire and no provider ids, even in a synced league', () => {
    const AT = new Date('2026-06-04T12:00:00.000Z');
    const slot = {
      id: 'slot-1', slotDefinitionId: 'def-1', key: 'MASTERS', slotKind: SlotKind.TOURNAMENT, weekNumber: null, name: 'Masters Tournament',
      startsAt: AT, endsAt: null, status: SeasonSlotStatus.SCHEDULED, seriesFormat: SeriesFormat.SINGLE_GAME, seriesGames: 1,
      pairing: SlotPairing.FIXED, isTestData: true, label: 'QA A', window: null,
    };
    const dto = mapSportEventToDto({ ...summary(event({ syncProviderId: 'balldontlie', providerMappings: [] }), 72), slots: [slot] });

    expect(dto).toMatchObject({ isTestData: true, providerName: null, providerMappings: [] });
    expect(dto.slots).toEqual([{ ...slot, startsAt: AT.toISOString(), endsAt: null }]);
  });
});
