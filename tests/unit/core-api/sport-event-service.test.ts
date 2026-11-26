import { SlotTiebreakerService } from '../../../packages/core-api/src/modules/events/slot-tiebreaker-service';
import { expect, jest } from '@jest/globals';
import { testDomainEvents } from '../../support/domain-events';
import { BackgroundJobType, SlotKind, SlotWindowStatus, Sport, SportEventStatus, type SportEvent, type SportLeague, HomeAway, SportEventParticipantStatus } from '@poolmaster/shared/domain';
import type { ContestRepository } from '@poolmaster/shared/db';
import { EventLifecycleService } from '../../../packages/core-api/src/modules/events/event-lifecycle-service';
import type { SportEventChangedNotice } from '../../../packages/core-api/src/modules/notifications';
import { SportEventService } from '../../../packages/core-api/src/modules/events/service';
import { ProviderGameSlateService } from '../../../packages/core-api/src/modules/events/provider-game-slate';
import { SportEventBracketService } from '../../../packages/core-api/src/modules/events/sport-event-bracket-service';
import { SportEventContestService } from '../../../packages/core-api/src/modules/events/sport-event-contest-service';
import { SportLeaguePageService } from '../../../packages/core-api/src/modules/sport-catalog/sport-league-page';
import { SportEventRoundService } from '../../../packages/core-api/src/modules/events/sport-event-round-service';
import { SportEventTierService } from '../../../packages/core-api/src/modules/events/sport-event-tier-service';
import { SportEventParticipantService } from '../../../packages/core-api/src/modules/events/sport-event-participant-service';
import { createEventHandlers } from '../../../packages/core-api/src/modules/events/handler';
import { GolfScoreService } from '../../../packages/core-api/src/modules/golf/golf-score-service';
import { IngestionService } from '../../../packages/core-api/src/modules/ingestion/ingestion-service';
import { RaceResultService } from '../../../packages/core-api/src/modules/scoring-families/finish-position/race-result-service';
import { MatchResultService } from '../../../packages/core-api/src/modules/scoring-families/head-to-head/match-result-service';
import { SportLeagueService } from '../../../packages/core-api/src/modules/sport-catalog/sport-league-service';
import { asFastifyRequest } from '../../support/fastify-doubles';
import { stubInstance } from '../../support/stub-instance';
import { IN_MEMORY_SEASON_ID, InMemorySportEvents, NO_PICKS_ON_EVENT } from '../../support/in-memory-sport-events';
import { standardEventPricing } from '../../support/budget-pricing';
import {
  fakeContestConfigurationRepo,
  fakeContestRepo,
} from '../../support/repo-fakes';
import { mockFn } from '../../support/mock-fn';
import { eventChangedJob, recordingSportEventChangedNotice } from '../../support/sport-event-changed-notice';
import { fakeLogger } from '../../support/fake-logger';
import { expectDefined } from '../../support/expect-defined';
import { eventRebuildJob } from '../../support/recording-leaderboard-rebuilds';
import { RecordingDomainEvents } from '../../support/recording-domain-events';
import { RecordingLeaderboardRebuilds } from '../../support/recording-leaderboard-rebuilds';
import { NO_SETTLE_JOBS } from '../../support/event-settlement';

/** Before every event's start in this file, so the release cutoff never depends on today. */
const NOW = new Date('2026-01-15T12:00:00.000Z');

// SportEventService's own rules — where an event's sport comes from, what creation seeds,
// and what update and delete refuse — against an in-memory store. The adapters behind the
// same ports are tested against Postgres in sport-event-repositories.integration.

/** The leagues' notices among the jobs the store's writes carried, leaving out the boards' rebuilds. */
const noticeJobs = (store: InMemorySportEvents) => store.backgroundJobs.filter((job) => job.type === BackgroundJobType.CONTEST_EVENT_CHANGED_EMAILS);

function setup(sportName: Sport = Sport.GOLF, sportEventChanged?: SportEventChangedNotice, domainEvents?: RecordingDomainEvents, logger?: ReturnType<typeof fakeLogger>, seasons?: (store: InMemorySportEvents) => ReturnType<InMemorySportEvents['seasonRepo']>) {
  const store = new InMemorySportEvents();
  const reminderRechecks = jest.fn<ContestRepository['recheckReminders']>().mockResolvedValue(undefined);
  const sport = store.addSport(sportName);
  const sportLeague = store.addSportLeague(sport.id);
  const sportEvents = store.sportEventRepo();
  // The real lifecycle over the same store: a release is a status change like any other.
  const lifecycle = new EventLifecycleService(
    {
      contests: fakeContestRepo(),
      configurations: fakeContestConfigurationRepo(),
      matches: store.matchRepo(),
    },
    sportEvents,
    // What follows a release or a moved start, collected by the app's handler map.
    testDomainEvents({ sportEventChanged }),
    NO_SETTLE_JOBS,
  );
  const service = new SportEventService({
    sportEvents,
    sportLeagues: store.sportLeagueRepo(),
    sports: store.sportRepo(),
    seasons: seasons?.(store) ?? store.seasonRepo(),
    rounds: new SportEventRoundService({ rounds: store.roundRepo() }),
    tiers: new SportEventTierService({ sportEvents, tiers: store.tierRepo(), valuations: store.valuationRepo(), field: store.fieldRepo(), participants: store.participantRepo(), platformTierProfiles: store.platformTierProfileRepo(), platformPricingProfiles: store.platformPricingProfileRepo() }),
    bracket: new SportEventBracketService({ domainEvents: testDomainEvents(),
      sportEvents,
      sportLeagues: store.sportLeagueRepo(),
      rounds: store.roundRepo(),
      field: store.fieldRepo(),
      participants: store.participantRepo(),
      matches: store.matchRepo(),
      tiers: store.tierRepo(),
      valuations: store.valuationRepo(),
      ...NO_PICKS_ON_EVENT,
      contests: { recheckReminders: async () => undefined },
    }),
    lifecycle,
    contests: { recheckReminders: reminderRechecks },
    domainEvents: domainEvents ?? testDomainEvents(),
    logger,
    now: () => NOW,
  });
  return { store, service, sportLeague, lifecycle, sportEvents, reminderRechecks };
}

/** An ordinary edit: a moved start of a released event is told to its leagues. */
const TELL = { tellMembers: true };

const MANUAL_INPUT = {
  name: 'Harbour Open',
  startDate: new Date('2026-06-04T12:00:00.000Z'),
};

/** What `setup` gives that an event made by a test needs. */
type EventContext = Pick<ReturnType<typeof setup>, 'store' | 'service' | 'sportLeague'>;

/**
 * An event with no Season slots yet, as a synced golf event has until slice 12 matches them: its
 * dates are its own, and an edit can move them. Made through createEvent on a test slot, then
 * unlinked from it; a round count below its league's default trims the rounds the create scheduled.
 */
async function slotlessEvent({ store, service, sportLeague }: EventContext, input: { name?: string; startDate?: Date; rounds?: number } = {}) {
  const startDate = input.startDate ?? MANUAL_INPUT.startDate;
  const created = await service.createEvent({ seasonSlotIds: [store.addTestSlot(sportLeague, startDate)], name: input.name ?? MANUAL_INPUT.name });
  const eventId = created.event.id;
  // Its rounds keep the slot they are played in (#2006): only the event's list of slots goes.
  store.slotsByEvent.delete(eventId);
  const { rounds } = input;
  if (rounds !== undefined) {
    store.roundRows = store.roundRows.filter((round) => round.sportEventId !== eventId || round.roundNumber <= rounds);
    await store.sportEventRepo().update(eventId, { rounds });
  }
  return { ...created, event: expectDefined(await store.sportEventRepo().findById(eventId)) };
}

/** The provider the slate tests import from: BALLDONTLIE's adapter id, the only provider with a row. */
const FEED = 'balldontlie';

/** The provider's id for an event, from its one mapping. */
function feedIdOf(event: SportEvent): string | undefined {
  return event.providerMappings[0]?.externalId;
}

describe('SportEventService.createEvent', () => {
  it('creates a test event on a test slot as a DRAFT with no provider ids, its league\'s four golf rounds, six tiers and the slot\'s dates', async () => {
    const { store, service, sportLeague } = setup();
    const endsAt = new Date('2026-06-07T23:00:00.000Z');
    const seasonSlotId = store.addTestSlot(sportLeague, MANUAL_INPUT.startDate, { endsAt });

    const created = await service.createEvent({ seasonSlotIds: [seasonSlotId], name: MANUAL_INPUT.name });

    expect(created.event).toMatchObject({
      sport: Sport.GOLF,
      providerMappings: [],
      status: SportEventStatus.DRAFT,
      rounds: 4,
      startDate: MANUAL_INPUT.startDate,
      endDate: endsAt,
      sportLeagueId: sportLeague.id,
      sportLeagueSeasonId: IN_MEMORY_SEASON_ID,
      championshipYear: 2026,
    });
    expect(created.slots.map((slot) => slot.id)).toEqual([seasonSlotId]);
    expect(store.roundRows.map((round) => round.roundNumber)).toEqual([1, 2, 3, 4]);
    // The summary is read after the rounds and tiers exist, so its counts include them.
    expect(created.tierCount).toBe(6);
  });

  it('puts each event in its sport league\'s current Season, the league\'s own, so a year later the same event goes in the new Season', async () => {
    const { store, service, sportLeague } = setup();

    const first = await service.createEvent({ seasonSlotIds: [store.addTestSlot(sportLeague, MANUAL_INPUT.startDate)], name: MANUAL_INPUT.name });
    store.seasonYears.set('season-2027', 2027);
    sportLeague.currentSeasonId = 'season-2027';
    const second = await service.createEvent({ seasonSlotIds: [store.addTestSlot(sportLeague, MANUAL_INPUT.startDate)], name: MANUAL_INPUT.name });

    expect([first.event.sportLeagueId, second.event.sportLeagueId]).toEqual([sportLeague.id, sportLeague.id]);
    expect([first.event.sportLeagueSeasonId, second.event.sportLeagueSeasonId]).toEqual([IN_MEMORY_SEASON_ID, 'season-2027']);
  });

  it('refuses a slot the sync keeps with 422 SEASON_SLOT_NOT_TEST, creating nothing', async () => {
    const { store, service, sportLeague } = setup();
    const seasonSlotId = store.addTestSlot(sportLeague, MANUAL_INPUT.startDate, { isTestData: false, label: null });

    await expect(service.createEvent({ seasonSlotIds: [seasonSlotId], name: MANUAL_INPUT.name }))
      .rejects.toMatchObject({ code: 'SEASON_SLOT_NOT_TEST', statusCode: 422 });
    expect(store.events).toHaveLength(0);
  });

  it('refuses a test slot outside its league\'s current Season with 422 SEASON_SLOT_NOT_CURRENT, creating nothing', async () => {
    const { store, service, sportLeague } = setup();
    const seasonSlotId = store.addTestSlot(sportLeague, MANUAL_INPUT.startDate, { sportLeagueSeasonId: 'season-2025' });

    await expect(service.createEvent({ seasonSlotIds: [seasonSlotId], name: MANUAL_INPUT.name }))
      .rejects.toMatchObject({ code: 'SEASON_SLOT_NOT_CURRENT', statusCode: 422 });
    expect(store.events).toHaveLength(0);
  });

  it('refuses a test slot that already has an event with 409 SEASON_SLOT_TAKEN, creating nothing more', async () => {
    const { store, service, sportLeague } = setup();
    const seasonSlotId = store.addTestSlot(sportLeague, MANUAL_INPUT.startDate);
    await service.createEvent({ seasonSlotIds: [seasonSlotId], name: MANUAL_INPUT.name });

    await expect(service.createEvent({ seasonSlotIds: [seasonSlotId], name: 'Another Open' }))
      .rejects.toMatchObject({ code: 'SEASON_SLOT_TAKEN', statusCode: 409 });
    expect(store.events).toHaveLength(1);
  });

  it('refuses the second of two creates racing for one slot with 409 SEASON_SLOT_TAKEN when the database\'s slot key raises', async () => {
    // The other create wrote its slot row after this one read the slot as free.
    const { store, service, sportLeague } = setup(Sport.GOLF, undefined, undefined, undefined, (world) => ({
      ...world.seasonRepo(),
      findSlotsByIds: async (ids) => ids.map((id) => {
        const { sportLeagueId, sportLeagueSeasonId, ...slot } = expectDefined(world.seasonSlots.find((each) => each.id === id));
        return { slot, sportLeagueId, sportLeagueSeasonId, sportEventId: null };
      }),
    }));
    const seasonSlotId = store.addTestSlot(sportLeague, MANUAL_INPUT.startDate);
    store.slotsByEvent.set('racing-event', [expectDefined(store.seasonSlots.at(0))]);

    await expect(service.createEvent({ seasonSlotIds: [seasonSlotId], name: MANUAL_INPUT.name }))
      .rejects.toMatchObject({ code: 'SEASON_SLOT_TAKEN', statusCode: 409 });
  });

  it('creates a test bracket on several test slots, a round in each in the order given, its FINAL slot\'s round last (#2006)', async () => {
    const { store, service, sportLeague } = setup(Sport.BASKETBALL);
    const semifinal = store.addTestSlot(sportLeague, MANUAL_INPUT.startDate, { slotKind: SlotKind.SEMIFINAL, name: 'Final Four' });
    const final = store.addTestSlot(sportLeague, new Date('2026-06-06T12:00:00.000Z'), { slotKind: SlotKind.FINAL, name: 'National Championship' });

    const created = await service.createEvent({ seasonSlotIds: [semifinal, final], name: 'Test Bracket' });

    expect(created.event.rounds).toBe(2);
    expect(created.slots.map((slot) => slot.id)).toEqual([semifinal, final]);
    expect(store.roundRows.map((round) => [round.roundNumber, round.slot.seasonSlotId, round.scheduledDate])).toEqual([
      [1, semifinal, MANUAL_INPUT.startDate],
      [2, final, new Date('2026-06-06T12:00:00.000Z')],
    ]);
  });

  it('refuses test slots of more than one Season with 422 SEASON_SLOTS_NOT_ONE_SEASON, creating nothing', async () => {
    const { store, service, sportLeague } = setup(Sport.BASKETBALL);
    const thisSeason = store.addTestSlot(sportLeague, MANUAL_INPUT.startDate, { slotKind: SlotKind.SEMIFINAL });
    const lastSeason = store.addTestSlot(sportLeague, MANUAL_INPUT.startDate, { slotKind: SlotKind.FINAL, sportLeagueSeasonId: 'season-2025' });

    await expect(service.createEvent({ seasonSlotIds: [thisSeason, lastSeason], name: 'Test Bracket' }))
      .rejects.toMatchObject({ code: 'SEASON_SLOTS_NOT_ONE_SEASON', statusCode: 422 });
    expect(store.events).toHaveLength(0);
  });

  it('fails with 404 SEASON_SLOT_NOT_FOUND for an unknown slot', async () => {
    const { service } = setup();

    await expect(service.createEvent({ seasonSlotIds: ['missing'], name: MANUAL_INPUT.name }))
      .rejects.toMatchObject({ code: 'SEASON_SLOT_NOT_FOUND', statusCode: 404 });
  });
});

describe('SportEventService.requireTestEvent (#2074)', () => {
  it('answers a test event, one covering a test slot, so the admin result routes may write to it', async () => {
    const { store, service, sportLeague } = setup();
    const created = await service.createEvent({ seasonSlotIds: [store.addTestSlot(sportLeague, MANUAL_INPUT.startDate)], name: MANUAL_INPUT.name });

    await expect(service.requireTestEvent(created.event.id)).resolves.toBeUndefined();
  });

  it('refuses an event covering only slots the sync keeps, or no slot, with 409 SPORT_EVENT_NOT_TEST_DATA', async () => {
    const context = setup();
    const { store, service, sportLeague } = context;
    const synced = await service.createEvent({ seasonSlotIds: [store.addTestSlot(sportLeague, MANUAL_INPUT.startDate)], name: MANUAL_INPUT.name });
    store.slotsByEvent.set(synced.event.id, [{ ...expectDefined(store.seasonSlots.at(0)), isTestData: false }]);
    const slotless = await slotlessEvent(context, { name: 'Slotless Open' });

    for (const eventId of [synced.event.id, slotless.event.id]) {
      await expect(service.requireTestEvent(eventId)).rejects.toMatchObject({ code: 'SPORT_EVENT_NOT_TEST_DATA', statusCode: 409 });
    }
  });

  it('answers 404 EVENT_NOT_FOUND for an unknown event', async () => {
    const { service } = setup();

    await expect(service.requireTestEvent('missing')).rejects.toMatchObject({ code: 'EVENT_NOT_FOUND', statusCode: 404 });
  });
});

describe('SportEventService.updateEvent on an event with Season slots', () => {
  it('refuses a new start or end with 422 EVENT_DATES_FROM_SLOTS, since its dates are its slots\'', async () => {
    const { store, service, sportLeague } = setup();
    const { event } = await service.createEvent({ seasonSlotIds: [store.addTestSlot(sportLeague, MANUAL_INPUT.startDate)], name: MANUAL_INPUT.name });

    await expect(service.updateEvent(event.id, { startDate: new Date('2026-06-11T12:00:00.000Z') }, TELL))
      .rejects.toMatchObject({ code: 'EVENT_DATES_FROM_SLOTS', statusCode: 422 });
    await expect(service.updateEvent(event.id, { endDate: null }, TELL))
      .rejects.toMatchObject({ code: 'EVENT_DATES_FROM_SLOTS', statusCode: 422 });
    expect(expectDefined(await store.sportEventRepo().findById(event.id)).startDate).toEqual(MANUAL_INPUT.startDate);
  });

  it('still takes an edit that moves no date, such as its name', async () => {
    const { store, service, sportLeague } = setup();
    const { event } = await service.createEvent({ seasonSlotIds: [store.addTestSlot(sportLeague, MANUAL_INPUT.startDate)], name: MANUAL_INPUT.name });

    const edited = await service.updateEvent(event.id, { name: 'Renamed Open' }, TELL);

    expect(edited.event.name).toBe('Renamed Open');
  });
});

/** A provider event's one place, by `code`, its games spanning its dates. */
function playOf(code: string, startDate: Date, endDate: Date | null) {
  return { code, startsAt: startDate, endsAt: endDate ?? startDate };
}

/** A provider event whose games are all in one place, coded by its own id. */
function providerEvent(externalId: string, name: string, venue: string | null, startDate: Date, endDate: Date | null) {
  return { externalId, name, venue, startDate, endDate, providerSlots: [playOf(externalId, startDate, endDate)] };
}

/** A synced slot for each provider event, mapped by its code and listed by a template. */
function slotsFor(store: InMemorySportEvents, sportLeague: SportLeague, events: ReadonlyArray<{ providerSlots: ReadonlyArray<{ code: string }> }>): string[] {
  return events.flatMap((event) => event.providerSlots.map((play) => store.addSyncSlot(sportLeague, play.code)));
}

/** The import's input for the in-memory league's Season. */
const importOf = (sportLeague: SportLeague, providerEvents: ReadonlyArray<Parameters<SportEventService['importProviderSeason']>[0]['providerEvents'][number]>) => ({
  sportLeagueId: sportLeague.id,
  sportLeagueSeasonId: IN_MEMORY_SEASON_ID,
  providerId: FEED,
  sportLeagueProviderMappingId: 'provider-mapping',
  providerEvents,
});

// #385: a tour's provider slate for a Season, imported in one action and safe to run again.
describe('SportEventService.importProviderSeason', () => {
  const slate = [
    providerEvent('pga-2026-a', 'Alpha Open', 'A Links', new Date('2026-03-05T12:00:00.000Z'), new Date('2026-03-08T23:00:00.000Z')),
    providerEvent('pga-2026-b', 'Bravo Classic', null, new Date('2026-04-09T12:00:00.000Z'), new Date('2026-04-12T23:00:00.000Z')),
    providerEvent('pga-2026-c', 'Harbour Open', null, new Date('2026-06-04T12:00:00.000Z'), new Date('2026-06-07T23:00:00.000Z')),
  ];

  it('creates every provider event the tour lacks, each linked to its provider event for scores with four rounds', async () => {
    const { store, service, sportLeague } = setup();
    slotsFor(store, sportLeague, slate);

    const result = await service.importProviderSeason(importOf(sportLeague, slate));

    expect(result.skipped).toEqual([]);
    expect(result.unmatched).toEqual([]);
    expect(result.created.map(({ event }) => ({ externalId: feedIdOf(event), sportLeagueSeasonId: event.sportLeagueSeasonId, rounds: event.rounds })))
      .toEqual(slate.map(({ externalId }) => ({ externalId, sportLeagueSeasonId: IN_MEMORY_SEASON_ID, rounds: 4 })));
  });

  it('puts each created event on the Season slot its code maps to, and gives the slot its games\' dates', async () => {
    const { store, service, sportLeague, sportEvents } = setup();
    const [slotId] = slotsFor(store, sportLeague, [slate[0]]);

    const { created } = await service.importProviderSeason(importOf(sportLeague, [slate[0]]));

    const eventId = created[0].event.id;
    const slots = expectDefined((await sportEvents.findSlots([eventId])).get(eventId));
    expect(slots.map((slot) => ({ id: slot.id, startsAt: slot.startsAt, endsAt: slot.endsAt })))
      .toEqual([{ id: slotId, startsAt: slate[0].startDate, endsAt: slate[0].endDate }]);
    expect(created[0].event).toEqual(expect.objectContaining({ startDate: slate[0].startDate, endDate: slate[0].endDate }));
  });

  it('takes an event\'s dates from the slots its games matched, leaving out games whose code no mapping includes', async () => {
    const { store, service, sportLeague } = setup();
    const playoffs = {
      ...providerEvent('nfl-2026-postseason', 'NFL Playoffs', null, new Date('2026-03-07T18:00:00.000Z'), new Date('2026-04-02T18:00:00.000Z')),
      providerSlots: [
        playOf('POST:1', new Date('2026-03-07T18:00:00.000Z'), new Date('2026-03-08T18:00:00.000Z')),
        playOf('POST:4', new Date('2026-04-02T18:00:00.000Z'), new Date('2026-04-02T18:00:00.000Z')),
      ],
    };
    store.addSyncSlot(sportLeague, 'POST:1');

    const result = await service.importProviderSeason(importOf(sportLeague, [playoffs]));

    expect(result.created[0].event).toEqual(expect.objectContaining({ startDate: new Date('2026-03-07T18:00:00.000Z'), endDate: new Date('2026-03-08T18:00:00.000Z') }));
    expect(result.unmatched).toEqual([{ code: 'POST:4', eventName: 'NFL Playoffs' }]);
  });

  it('creates no event for a provider event whose code no mapping includes, and reports the code once however many events carry it', async () => {
    const { service, sportLeague } = setup();
    const preseason = [
      { ...providerEvent('nfl-2026-pre-1', 'Preseason Week 1', null, slate[0].startDate, slate[0].endDate), providerSlots: [playOf('PRE:1', slate[0].startDate, slate[0].endDate)] },
      { ...providerEvent('nfl-2026-pre-1b', 'Preseason Week 1 again', null, slate[1].startDate, slate[1].endDate), providerSlots: [playOf('PRE:1', slate[1].startDate, slate[1].endDate)] },
    ];

    const result = await service.importProviderSeason(importOf(sportLeague, preseason));

    expect(result.created).toEqual([]);
    expect(result.skipped.map((row) => row.reason)).toEqual(['NO_SLOT', 'NO_SLOT']);
    expect(result.unmatched).toEqual([{ code: 'PRE:1', eventName: 'Preseason Week 1' }]);
  });

  it('creates no event for a slot no contest template lists, though the slot still takes its games\' dates (ADR 0011)', async () => {
    const { store, service, sportLeague } = setup();
    const slotId = store.addSyncSlot(sportLeague, slate[0].externalId, { covered: false });

    const result = await service.importProviderSeason(importOf(sportLeague, [slate[0]]));

    expect(result.created).toEqual([]);
    expect(result.skipped).toEqual([{ externalId: 'pga-2026-a', name: 'Alpha Open', reason: 'NO_TEMPLATE' }]);
    expect(store.seasonSlots.find((slot) => slot.id === slotId)).toEqual(expect.objectContaining({ startsAt: slate[0].startDate, endsAt: slate[0].endDate }));
  });

  it('creates no second event on a slot another event already plays', async () => {
    const { store, service, sportLeague } = setup();
    slotsFor(store, sportLeague, [slate[0]]);
    const twin = { ...slate[0], externalId: 'pga-2026-a-twin' };

    const result = await service.importProviderSeason(importOf(sportLeague, [slate[0], twin]));

    expect(result.created.map(({ event }) => feedIdOf(event))).toEqual(['pga-2026-a']);
    expect(result.skipped).toEqual([{ externalId: 'pga-2026-a-twin', name: 'Alpha Open', reason: 'SLOT_TAKEN' }]);
  });

  it('gives an event already linked the slots its games reach since, such as a playoff\'s later rounds', async () => {
    const { store, service, sportLeague, sportEvents } = setup();
    const [firstRound, secondRound] = [store.addSyncSlot(sportLeague, 'POST:1'), store.addSyncSlot(sportLeague, 'POST:2')];
    const roundOne = playOf('POST:1', slate[0].startDate, slate[0].startDate);
    const playoffs = { ...providerEvent('nba-2026-postseason', 'NBA Playoffs', null, slate[0].startDate, slate[0].startDate), providerSlots: [roundOne] };
    const { created } = await service.importProviderSeason(importOf(sportLeague, [playoffs]));
    const eventId = created[0].event.id;

    const again = await service.importProviderSeason(importOf(sportLeague, [{ ...playoffs, providerSlots: [roundOne, playOf('POST:2', slate[1].startDate, slate[1].endDate)] }]));

    expect(again.skipped.map((row) => row.reason)).toEqual(['ALREADY_LINKED']);
    expect(expectDefined((await sportEvents.findSlots([eventId])).get(eventId)).map((slot) => slot.id)).toEqual([firstRound, secondRound]);
    expect(store.seasonSlots.find((slot) => slot.id === secondRound)).toEqual(expect.objectContaining({ startsAt: slate[1].startDate, endsAt: slate[1].endDate }));
  });

  it('skips an event already linked to the provider event, and creates one whose name a hand-made event of the Season shares, telling events apart by feed id, never by name', async () => {
    const { store, service, sportLeague } = setup();
    slotsFor(store, sportLeague, slate);
    store.addEvent({ providerRef: { providerId: FEED, externalId: 'pga-2026-a' } });
    await service.createEvent({ seasonSlotIds: [store.addTestSlot(sportLeague, MANUAL_INPUT.startDate)], name: MANUAL_INPUT.name });

    const result = await service.importProviderSeason(importOf(sportLeague, slate));

    expect(result.created.map(({ event }) => feedIdOf(event))).toEqual(['pga-2026-b', 'pga-2026-c']);
    expect(result.skipped).toEqual([{ externalId: 'pga-2026-a', name: 'Alpha Open', reason: 'ALREADY_LINKED' }]);
  });

  it('creates the provider\'s event beside a "Test- " event the test data loaded with its name and dates, and leaves the test event as it was (#1850)', async () => {
    const { store, service, sportLeague, sportEvents } = setup();
    slotsFor(store, sportLeague, [slate[0]]);
    const { event: testEvent } = await service.createEvent({ seasonSlotIds: [store.addTestSlot(sportLeague, slate[0].startDate)], name: 'Test- Alpha Open' });
    const before = await sportEvents.findById(testEvent.id);

    const result = await service.importProviderSeason(importOf(sportLeague, [slate[0]]));

    expect(result.created.map(({ event }) => ({ name: event.name, externalId: feedIdOf(event) }))).toEqual([{ name: 'Alpha Open', externalId: 'pga-2026-a' }]);
    expect(result.skipped).toEqual([]);
    expect(await sportEvents.findById(testEvent.id)).toEqual(before);
  });

  it('creates nothing on a second run, reporting every event as already linked', async () => {
    const { store, service, sportLeague } = setup();
    slotsFor(store, sportLeague, slate);
    await service.importProviderSeason(importOf(sportLeague, slate));

    const again = await service.importProviderSeason(importOf(sportLeague, slate));

    expect(again.created).toEqual([]);
    expect(again.skipped.map((row) => row.reason)).toEqual(['ALREADY_LINKED', 'ALREADY_LINKED', 'ALREADY_LINKED']);
  });

  it('creates only the provider events that have not started, reporting each one that already started as skipped', async () => {
    const { store, service, sportLeague } = setup();
    const past = providerEvent('pga-2026-past', 'Winter Open', null, new Date('2026-01-08T12:00:00.000Z'), new Date('2026-01-11T23:00:00.000Z'));
    const startingNow = providerEvent('pga-2026-now', 'Noon Open', null, NOW, new Date('2026-01-18T23:00:00.000Z'));
    const future = slate[0];
    slotsFor(store, sportLeague, [past, startingNow, future]);

    const result = await service.importProviderSeason(importOf(sportLeague, [past, startingNow, future]));

    expect(result.created.map(({ event }) => feedIdOf(event))).toEqual(['pga-2026-a']);
    expect(result.skipped).toEqual([
      { externalId: 'pga-2026-past', name: 'Winter Open', reason: 'ALREADY_STARTED' },
      { externalId: 'pga-2026-now', name: 'Noon Open', reason: 'ALREADY_STARTED' },
    ]);
  });

  it('judges a start by the first game its slots hold, creating an event for a slate begun long before its slots\' games (#2012)', async () => {
    const { store, service, sportLeague } = setup();
    store.addSyncSlot(sportLeague, 'POST:1');
    const seasonLong = {
      ...providerEvent('ncaaf-2026-cfp', 'College Football Playoff', null, new Date('2026-01-03T18:00:00.000Z'), slate[0].endDate),
      providerSlots: [
        playOf('REG:1', new Date('2026-01-03T18:00:00.000Z'), new Date('2026-01-03T18:00:00.000Z')),
        playOf('POST:1', slate[0].startDate, slate[0].endDate),
      ],
    };

    const result = await service.importProviderSeason(importOf(sportLeague, [seasonLong]));

    expect(result.skipped).toEqual([]);
    expect(result.created[0].event).toEqual(expect.objectContaining({ startDate: slate[0].startDate }));
  });

  it('places a game with no code in the window that holds it, confirms a tentative window and dates its slot only by a game between two seeds on the event\'s field, and names the date-window slots still needing dates (#2012)', async () => {
    const { store, service, sportLeague } = setup();
    const kickoff = slate[0].startDate;
    const window = (status: SlotWindowStatus) => ({ startsAt: new Date(kickoff.getTime() - 60_000), endsAt: new Date(kickoff.getTime() + 60_000), status });
    const firstRound = store.addWindowSlot(sportLeague, 'ROUND_OF_16', window(SlotWindowStatus.TENTATIVE));
    store.addWindowSlot(sportLeague, 'FINAL', null);
    const playoffOf = (...teams: string[][]) => ({
      ...providerEvent('ncaaf-2026-cfp', 'College Football Playoff', null, kickoff, kickoff),
      providerSlots: teams.map((pair) => ({ code: null, startsAt: kickoff, endsAt: kickoff, teams: pair })),
    });
    const slotOf = () => store.seasonSlots.find((slot) => slot.id === firstRound);

    // Made before its seeds are placed: on the slot, but no game is the event's own yet.
    const made = await service.importProviderSeason(importOf(sportLeague, [playoffOf(['1', '2'])]));
    expect(made.created).toHaveLength(1);
    expect(store.slotWindows.get(firstRound)?.status).toBe(SlotWindowStatus.TENTATIVE);
    expect(slotOf()?.startsAt).toBeNull();
    expect(made.slotsNeedingDates).toEqual(['ROUND_OF_16', 'FINAL']);

    // Seeds placed: another bowl in the window, between unseeded schools, still confirms nothing.
    const eventId = made.created[0].event.id;
    for (const feedId of ['1', '2']) store.addToField(eventId, store.addParticipant(sportLeague.sportId, `Seed ${feedId}`, { externalId: feedId }).id);
    store.addParticipant(sportLeague.sportId, 'Unseeded', { externalId: '9' });
    const bowl = await service.importProviderSeason(importOf(sportLeague, [playoffOf(['9', '8'])]));
    expect(store.slotWindows.get(firstRound)?.status).toBe(SlotWindowStatus.TENTATIVE);
    expect(bowl.slotsNeedingDates).toEqual(['ROUND_OF_16', 'FINAL']);

    // The game between the two seeds confirms the window and dates the slot.
    const seeded = await service.importProviderSeason(importOf(sportLeague, [playoffOf(['9', '8'], ['1', '2'])]));
    expect(store.slotWindows.get(firstRound)?.status).toBe(SlotWindowStatus.CONFIRMED);
    expect(slotOf()?.startsAt).toEqual(kickoff);
    expect(seeded.slotsNeedingDates).toEqual(['FINAL']);
  });

  it('names no slot needing dates for a Season with no slot placed by date window', async () => {
    const { store, service, sportLeague } = setup();
    slotsFor(store, sportLeague, slate);

    expect((await service.importProviderSeason(importOf(sportLeague, slate))).slotsNeedingDates).toBeNull();
  });

  it('reports a started provider event that is already linked as already linked, so the linked event keeps updating', async () => {
    const { store, service, sportLeague } = setup();
    store.addEvent({ providerRef: { providerId: FEED, externalId: 'pga-2026-past' } });
    const past = providerEvent('pga-2026-past', 'Winter Open', null, new Date('2026-01-08T12:00:00.000Z'), null);

    const result = await service.importProviderSeason(importOf(sportLeague, [past]));

    expect(result.created).toEqual([]);
    expect(result.skipped).toEqual([{ externalId: 'pga-2026-past', name: 'Winter Open', reason: 'ALREADY_LINKED' }]);
  });
});

// #2011: an open phase's tournaments match their Season slot by name the first time, then by code.
describe('SportEventService.importProviderSeason by tournament name', () => {
  const masters = providerEvent('17', 'Masters Tournament 2027', 'Augusta National', new Date('2026-04-09T12:00:00.000Z'), new Date('2026-04-12T23:00:00.000Z'));

  it('creates the Season slot of the one definition the tournament\'s name matches, links it to the tournament\'s code, and puts the new event on it', async () => {
    const { store, service, sportLeague, sportEvents } = setup();
    store.slotNamePatterns.push({ slotDefinitionId: 'masters', pattern: 'masters tournament' });
    store.templateCoveredDefinitionIds.add('masters');

    const result = await service.importProviderSeason(importOf(sportLeague, [masters]));

    const created = store.seasonSlots.filter((slot) => slot.slotDefinitionId === 'masters');
    expect(created).toHaveLength(1);
    expect(store.slotLinks.get(created[0].id)).toBe('17');
    expect(result.unmatched).toEqual([]);
    expect(result.unplacedNames).toEqual([]);
    const eventId = result.created[0].event.id;
    expect(expectDefined((await sportEvents.findSlots([eventId])).get(eventId)).map((slot) => slot.id)).toEqual([created[0].id]);
  });

  it('matches a linked tournament by its code on the next sync even after its name changed, creating no second slot', async () => {
    const { store, service, sportLeague } = setup();
    store.slotNamePatterns.push({ slotDefinitionId: 'masters', pattern: 'masters tournament' });
    store.templateCoveredDefinitionIds.add('masters');
    await service.importProviderSeason(importOf(sportLeague, [masters]));

    const renamed = await service.importProviderSeason(importOf(sportLeague, [{ ...masters, name: 'The Masters presented by Someone' }]));

    expect(store.seasonSlots.filter((slot) => slot.slotDefinitionId === 'masters')).toHaveLength(1);
    expect(renamed.unplacedNames).toEqual([]);
    expect(renamed.skipped).toEqual([{ externalId: '17', name: 'The Masters presented by Someone', reason: 'ALREADY_LINKED' }]);
  });

  it('places nothing for a name no pattern matches, and reports it once by its normalized name rather than as an unmapped code', async () => {
    const { store, service, sportLeague } = setup();
    store.slotNamePatterns.push({ slotDefinitionId: 'masters', pattern: 'masters tournament' });

    const result = await service.importProviderSeason(importOf(sportLeague, [
      providerEvent('40', 'The New Open 2027', null, new Date('2026-05-01T12:00:00.000Z'), null),
      providerEvent('41', 'The New Open', null, new Date('2027-05-01T12:00:00.000Z'), null),
    ]));

    expect(result.created).toEqual([]);
    expect(result.unmatched).toEqual([]);
    expect(result.unplacedNames).toEqual([{ normalizedName: 'the new open', name: 'The New Open 2027', reason: 'UNMATCHED' }]);
    expect(store.seasonSlots.filter((slot) => !slot.isTestData)).toEqual([]);
  });

  it('reports a name the patterns of two definitions match as ambiguous, and links it to neither', async () => {
    const { store, service, sportLeague } = setup();
    store.slotNamePatterns.push({ slotDefinitionId: 'twin-a', pattern: 'twin championship' }, { slotDefinitionId: 'twin-b', pattern: 'twin championship' });

    const result = await service.importProviderSeason(importOf(sportLeague, [providerEvent('50', 'Twin Championship', null, new Date('2026-05-01T12:00:00.000Z'), null)]));

    expect(result.unplacedNames).toEqual([{ normalizedName: 'twin championship', name: 'Twin Championship', reason: 'AMBIGUOUS' }]);
    expect(store.slotLinks.size).toBe(0);
  });

  it('reports a name whose matched slot has no phase in the Season, creating no slot and raising no unmapped code, rather than dropping it', async () => {
    const { store, service, sportLeague } = setup();
    store.slotNamePatterns.push({ slotDefinitionId: 'masters', pattern: 'masters tournament' });
    store.templateCoveredDefinitionIds.add('masters');
    store.definitionsWithoutSeasonPhase.add('masters');

    const result = await service.importProviderSeason(importOf(sportLeague, [masters]));

    expect(result.unplacedNames).toEqual([{ normalizedName: 'masters tournament', name: 'Masters Tournament 2027', reason: 'SEASON_COMPETITION_MISSING' }]);
    expect(result.created).toEqual([]);
    expect(result.unmatched).toEqual([]);
    expect(store.seasonSlots.filter((slot) => slot.slotDefinitionId === 'masters')).toEqual([]);
  });

  it('matches by name only in a league with NAME_PATTERN mappings: elsewhere a code no mapping includes is an unmapped code', async () => {
    const { service, sportLeague } = setup();

    const result = await service.importProviderSeason(importOf(sportLeague, [masters]));

    expect(result.unmatched).toEqual([{ code: '17', eventName: 'Masters Tournament 2027' }]);
    expect(result.unplacedNames).toEqual([]);
  });
});

describe('SportEventService.keepProviderEventsCurrent (#1727)', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const listed = providerEvent('pga-2026-a', 'Alpha Open', 'A Links', new Date('2026-03-05T12:00:00.000Z'), new Date('2026-03-08T23:00:00.000Z'));
  const listedEnd = expectDefined(listed.endDate);

  async function linkedEvent(status?: SportEventStatus, sportName?: Sport, notice?: SportEventChangedNotice) {
    const built = setup(sportName, notice);
    slotsFor(built.store, built.sportLeague, [listed]);
    const { created } = await built.service.importProviderSeason(importOf(built.sportLeague, [listed]));
    const { event } = created[0];
    if (status) await built.store.sportEventRepo().update(event.id, { status });
    return { ...built, eventId: event.id };
  }

  it('writes a released event\'s new provider name, venue and dates over the admin\'s, moving its rounds and telling its leagues of the moved start, though its dates come from its slots', async () => {
    const notice = recordingSportEventChangedNotice();
    const { service, sportLeague, sportEvents, eventId } = await linkedEvent(SportEventStatus.SCHEDULED, Sport.GOLF, notice);
    await service.updateEvent(eventId, { name: 'Admin Renamed Open' }, TELL);
    const moved = providerEvent('pga-2026-a', 'Alpha Invitational', 'B Links', new Date(listed.startDate.getTime() + 7 * DAY), new Date(listedEnd.getTime() + 7 * DAY));
    await service.importProviderSeason(importOf(sportLeague, [moved]));

    const changes = await service.keepProviderEventsCurrent({ sportLeagueId: sportLeague.id, providerId: FEED, providerEvents: [moved] });

    expect(changes).toEqual([{ sportEventId: eventId, externalId: 'pga-2026-a', changed: ['name', 'venue', 'startDate', 'endDate'] }]);
    expect(await sportEvents.findById(eventId)).toEqual(expect.objectContaining({ name: 'Alpha Invitational', venue: 'B Links', startDate: moved.startDate, endDate: moved.endDate }));
    expect(notice.sportEventChangedJobs).toHaveBeenCalledWith({ id: eventId, startDate: moved.startDate }, { kind: 'RESCHEDULED', previousStart: listed.startDate }, { reopening: new Set() });
  });

  it('changes only the name, venue and end of an event under way, never the start that already happened', async () => {
    const { service, sportLeague, sportEvents, eventId } = await linkedEvent(SportEventStatus.IN_PROGRESS);
    const delayed = providerEvent('pga-2026-a', 'Alpha Open', 'Rain Links', new Date(listed.startDate.getTime() + DAY), new Date(listedEnd.getTime() + DAY));
    await service.importProviderSeason(importOf(sportLeague, [delayed]));

    const changes = await service.keepProviderEventsCurrent({ sportLeagueId: sportLeague.id, providerId: FEED, providerEvents: [delayed] });

    expect(changes.map((change) => change.changed)).toEqual([['venue', 'endDate']]);
    expect(await sportEvents.findById(eventId)).toEqual(expect.objectContaining({ venue: 'Rain Links', startDate: listed.startDate, endDate: delayed.endDate }));
  });

  it('keeps a slotted event\'s dates on its slots\' when the provider event\'s own dates differ, so they are worked out one way', async () => {
    const { service, sportLeague, sportEvents, eventId } = await linkedEvent(SportEventStatus.SCHEDULED);
    const before = await sportEvents.findById(eventId);

    const changes = await service.keepProviderEventsCurrent({
      sportLeagueId: sportLeague.id,
      providerId: FEED,
      providerEvents: [{ ...listed, startDate: new Date(listed.startDate.getTime() - DAY), endDate: new Date(listedEnd.getTime() + DAY) }],
    });

    expect(changes).toEqual([]);
    expect(await sportEvents.findById(eventId)).toEqual(before);
  });

  it('moves a slotted event\'s dates with its slots on a later sync, after the import gave the slots the games\' new dates', async () => {
    const { store, service, sportLeague, sportEvents, eventId } = await linkedEvent(SportEventStatus.SCHEDULED);
    const rescheduled = providerEvent('pga-2026-a', 'Alpha Open', 'A Links', new Date(listed.startDate.getTime() + 2 * DAY), new Date(listedEnd.getTime() + 3 * DAY));
    await service.importProviderSeason(importOf(sportLeague, [rescheduled]));

    const changes = await service.keepProviderEventsCurrent({ sportLeagueId: sportLeague.id, providerId: FEED, providerEvents: [{ ...rescheduled, endDate: null }] });

    expect(changes.map((change) => change.changed)).toEqual([['startDate', 'endDate']]);
    const slot = expectDefined(store.seasonSlots.find((each) => each.startsAt?.getTime() === rescheduled.startDate.getTime()));
    expect(await sportEvents.findById(eventId)).toEqual(expect.objectContaining({ startDate: slot.startsAt, endDate: slot.endsAt }));
  });

  it.each([SportEventStatus.COMPLETED, SportEventStatus.CANCELLED])('leaves a %s event exactly as it is, whatever the provider now says', async (status) => {
    const { service, sportLeague, sportEvents, eventId } = await linkedEvent(status);
    const before = await sportEvents.findById(eventId);

    const changes = await service.keepProviderEventsCurrent({ sportLeagueId: sportLeague.id, providerId: FEED, providerEvents: [{ ...listed, name: 'Renamed', startDate: new Date(listed.startDate.getTime() + DAY) }] });

    expect(changes).toEqual([]);
    expect(await sportEvents.findById(eventId)).toEqual(before);
  });

  it('keeps the venue and end when the provider stops sending them, and changes nothing when the details still match', async () => {
    const { service, sportLeague, sportEvents, eventId } = await linkedEvent();

    const changes = await service.keepProviderEventsCurrent({ sportLeagueId: sportLeague.id, providerId: FEED, providerEvents: [{ ...listed, venue: null, endDate: null }, { ...listed, externalId: 'not-linked' }] });

    expect(changes).toEqual([]);
    expect(await sportEvents.findById(eventId)).toEqual(expect.objectContaining({ venue: 'A Links', endDate: listed.endDate }));
  });

  it('never changes a "Test- " event, which no provider event is linked to, though the provider sends an event of its name (#1850)', async () => {
    const { store, service, sportLeague, sportEvents } = setup();
    const { event: testEvent } = await service.createEvent({ seasonSlotIds: [store.addTestSlot(sportLeague, listed.startDate)], name: 'Test- Alpha Open' });
    const before = await sportEvents.findById(testEvent.id);

    const changes = await service.keepProviderEventsCurrent({ sportLeagueId: sportLeague.id, providerId: FEED, providerEvents: [{ ...listed, name: 'Test- Alpha Open', startDate: new Date(listed.startDate.getTime() + DAY) }] });

    expect(changes).toEqual([]);
    expect(await sportEvents.findById(testEvent.id)).toEqual(before);
  });

  it('logs an event whose update fails and still keeps the league\'s other events current', async () => {
    const logger = fakeLogger();
    const { store, service, sportLeague, sportEvents } = setup(Sport.GOLF, undefined, undefined, logger);
    const second = providerEvent('pga-2026-b', 'Bravo Classic', 'A Links', new Date('2026-04-09T12:00:00.000Z'), new Date('2026-04-12T23:00:00.000Z'));
    slotsFor(store, sportLeague, [listed, second]);
    const { created } = await service.importProviderSeason(importOf(sportLeague, [listed, second]));
    const [failing, kept] = created.map(({ event }) => event.id);
    const realUpdate = sportEvents.update.bind(sportEvents);
    jest.spyOn(sportEvents, 'update').mockImplementation(async (id, updates, options) => {
      if (id === failing) throw new Error('round shift refused');
      return realUpdate(id, updates, options);
    });

    const changes = await service.keepProviderEventsCurrent({
      sportLeagueId: sportLeague.id,
      providerId: FEED,
      providerEvents: [{ ...listed, name: 'Alpha Renamed' }, { ...second, name: 'Bravo Renamed' }],
    });

    expect(changes).toEqual([{ sportEventId: kept, externalId: 'pga-2026-b', changed: ['name'] }]);
    expect((await sportEvents.findById(kept))?.name).toBe('Bravo Renamed');
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ sportEventId: failing, externalId: 'pga-2026-a', error: 'round shift refused' }),
      'Could not keep a synced event current with its provider',
    );
  });

  it('never touches an event of another sport league linked to the same provider event', async () => {
    const { service, store, sportEvents, eventId } = await linkedEvent();
    const otherLeague = store.addSportLeague(store.sportLeagues[0].sportId, 'Other Tour');

    const changes = await service.keepProviderEventsCurrent({ sportLeagueId: otherLeague.id, providerId: FEED, providerEvents: [{ ...listed, name: 'Renamed' }] });

    expect(changes).toEqual([]);
    expect(await sportEvents.findById(eventId)).toEqual(expect.objectContaining({ name: 'Alpha Open' }));
  });
});

describe('SportEventService.releaseEvent (#431)', () => {
  /**
   * A draft whose field holds `golfers` active golfers, the first `tiered` of them in a tier and
   * the first `priced` of them priced with the Standard profile (all, unless `priced` says).
   * `priced: null` leaves the event with no prices assigned at all.
   */
  async function draftWithField(
    store: InMemorySportEvents,
    golfers: number,
    tiered: number,
    overrides: Parameters<InMemorySportEvents['addEvent']>[0] = {},
    priced: number | null = golfers,
  ) {
    const event = store.addEvent({ status: SportEventStatus.DRAFT, ...overrides });
    await store.addRounds(event.id, [{ roundNumber: 1, scheduledDate: event.startDate }]);
    await store.addTiers(event.id, [{ tierKey: 'tier-1', label: 'Tier 1', tierNumber: 1 }]);
    const tierId = store.tierRows[0].id;
    const entries = Array.from({ length: golfers }, (_, index) => store.addToField(event.id, `participant-${index}`));
    await store.valuationRepo().assignTiers(entries.slice(0, tiered).map((entry, index) => ({
      sportEventParticipantId: entry.id,
      sportEventTierId: tierId,
      tierOrderIndex: index + 1,
      source: 'MANUAL',
    })));
    if (priced !== null) {
      await store.valuationRepo().assignEventPrices({
        sportEventId: event.id,
        pricingConfig: standardEventPricing(),
        assignments: entries.slice(0, priced).map((entry) => ({ sportEventParticipantId: entry.id, price: 6000, source: 'AUTO_RANKING' })),
      });
    }
    return event;
  }

  it('releases a draft with a loaded, fully tiered field before its start: DRAFT becomes SCHEDULED', async () => {
    const { store, service } = setup();
    const event = await draftWithField(store, 3, 3);

    const released = await service.releaseEvent(event.id);

    expect(released.event.status).toBe(SportEventStatus.SCHEDULED);
    expect(store.events[0].status).toBe(SportEventStatus.SCHEDULED);
  });

  it('refuses a basketball draft whose bracket is not loaded with 422 SPORT_EVENT_NOT_READY, though its field is tiered and priced', async () => {
    const { store, service, sportLeague } = setup(Sport.BASKETBALL);
    const event = await draftWithField(store, 2, 2, { sport: Sport.BASKETBALL, sportLeagueId: sportLeague.id });

    await expect(service.releaseEvent(event.id)).rejects.toMatchObject({
      code: 'SPORT_EVENT_NOT_READY',
      statusCode: 422,
      message: expect.stringContaining('its bracket is not loaded'),
    });
    expect(store.events[0].status).toBe(SportEventStatus.DRAFT);
  });

  it('releases a basketball draft once its bracket holds every active team', async () => {
    const { store, service, sportLeague } = setup(Sport.BASKETBALL);
    const event = await draftWithField(store, 2, 2, { sport: Sport.BASKETBALL, sportLeagueId: sportLeague.id });
    const [home, away] = store.field;
    await store.matchRepo().replaceBracket(event.id, [{
      id: 'final', roundNumber: 1, matchNumber: 1,
      sides: [{ sideNumber: 1, sportEventParticipantId: away.id, homeAway: HomeAway.NONE }, { sideNumber: 2, sportEventParticipantId: home.id, homeAway: HomeAway.NONE }],
      isNeutralSite: true, scheduledDate: null, advancesToMatchId: null, advancesToSideNumber: null, regionLabel: null,
    }]);

    await expect(service.releaseEvent(event.id)).resolves.toMatchObject({ event: { status: SportEventStatus.SCHEDULED } });
  });

  it('lists what a draft still needs before release in the refusal\'s words, a bracket sport\'s bracket included, and nothing once it is ready', async () => {
    const { store, service, sportLeague } = setup(Sport.BASKETBALL);
    const unready = await draftWithField(store, 3, 2, { sport: Sport.BASKETBALL, sportLeagueId: sportLeague.id }, null);
    const golf = setup();
    const ready = await draftWithField(golf.store, 3, 3);

    await expect(service.releaseBlockersOf(unready.id)).resolves.toEqual([
      '1 active participant(s) have no tier',
      'its prices have not been assigned',
      expect.stringContaining('its bracket is not loaded'),
    ]);
    await expect(golf.service.releaseBlockersOf(ready.id)).resolves.toEqual([]);
  });

  it('refuses a draft whose field is empty with 422 SPORT_EVENT_NOT_READY, leaving it a draft', async () => {
    const { store, service } = setup();
    const event = await draftWithField(store, 0, 0);

    await expect(service.releaseEvent(event.id)).rejects.toMatchObject({ code: 'SPORT_EVENT_NOT_READY', statusCode: 422 });
    expect(store.events[0].status).toBe(SportEventStatus.DRAFT);
  });

  it('refuses a draft with an active golfer in no tier with 422 SPORT_EVENT_NOT_READY', async () => {
    const { store, service } = setup();
    const event = await draftWithField(store, 3, 2);

    await expect(service.releaseEvent(event.id)).rejects.toMatchObject({
      code: 'SPORT_EVENT_NOT_READY',
      message: expect.stringContaining('1 active participant(s) have no tier'),
    });
  });

  it('refuses a draft with a tier no active participant is in with 422 SPORT_EVENT_NOT_READY, naming the empty tier in the sport\'s words', async () => {
    const { store, service } = setup(Sport.AUTO_RACING);
    const event = await draftWithField(store, 3, 3, { sport: Sport.AUTO_RACING });
    await store.addTiers(event.id, [{ tierKey: 'tier-2', label: 'Tier 2', tierNumber: 2 }]);

    await expect(service.releaseEvent(event.id)).rejects.toMatchObject({
      code: 'SPORT_EVENT_NOT_READY',
      statusCode: 422,
      message: expect.stringContaining('Tier 2 has no drivers'),
    });
    expect(store.events[0].status).toBe(SportEventStatus.DRAFT);
  });

  it('counts a tier holding only a withdrawn participant as empty, so the draft is not released', async () => {
    const { store, service } = setup();
    const event = await draftWithField(store, 2, 2);
    await store.addTiers(event.id, [{ tierKey: 'tier-2', label: 'Tier 2', tierNumber: 2 }]);
    const withdrawn = store.addToField(event.id, 'participant-withdrawn');
    withdrawn.status = SportEventParticipantStatus.WITHDRAWN;
    const tier2Id = store.tierRows.filter((tier) => tier.tierKey === 'tier-2').map((tier) => tier.id)[0];
    await store.valuationRepo().assignTiers([{ sportEventParticipantId: withdrawn.id, sportEventTierId: tier2Id, tierOrderIndex: 3, source: 'MANUAL' }]);

    await expect(service.releaseEvent(event.id)).rejects.toMatchObject({
      code: 'SPORT_EVENT_NOT_READY',
      message: expect.stringContaining('Tier 2 has no golfers'),
    });
  });

  it('refuses a draft whose prices were never assigned with 422 SPORT_EVENT_NOT_READY (#93)', async () => {
    const { store, service } = setup();
    const event = await draftWithField(store, 3, 3, {}, null);

    await expect(service.releaseEvent(event.id)).rejects.toMatchObject({
      code: 'SPORT_EVENT_NOT_READY',
      message: expect.stringContaining('its prices have not been assigned'),
    });
    expect(store.events[0].status).toBe(SportEventStatus.DRAFT);
  });

  it('refuses a draft with an active golfer who has no price with 422 SPORT_EVENT_NOT_READY (#93)', async () => {
    const { store, service } = setup();
    const event = await draftWithField(store, 3, 3, {}, 2);

    await expect(service.releaseEvent(event.id)).rejects.toMatchObject({
      code: 'SPORT_EVENT_NOT_READY',
      message: expect.stringContaining('1 active participant(s) have no price'),
    });
  });

  it('ignores a withdrawn golfer with no tier or price: only active golfers must be tiered and priced', async () => {
    const { store, service } = setup();
    const event = await draftWithField(store, 2, 2);
    const withdrawn = store.addToField(event.id, 'participant-withdrawn');
    withdrawn.status = SportEventParticipantStatus.WITHDRAWN;

    await expect(service.releaseEvent(event.id)).resolves.toMatchObject({ event: { status: SportEventStatus.SCHEDULED } });
  });

  it('refuses a draft whose start time has passed with 409 SPORT_EVENT_ALREADY_STARTED', async () => {
    const { store, service } = setup();
    const event = await draftWithField(store, 3, 3, { startDate: new Date('2026-01-15T12:00:00.000Z') });

    await expect(service.releaseEvent(event.id)).rejects.toMatchObject({ code: 'SPORT_EVENT_ALREADY_STARTED', statusCode: 409 });
    expect(store.events[0].status).toBe(SportEventStatus.DRAFT);
  });

  it('refuses an event that is already released with 409 SPORT_EVENT_NOT_DRAFT, and an unknown one with 404', async () => {
    const { store, service } = setup();
    const event = await draftWithField(store, 3, 3, { status: SportEventStatus.SCHEDULED });

    await expect(service.releaseEvent(event.id)).rejects.toMatchObject({ code: 'SPORT_EVENT_NOT_DRAFT', statusCode: 409 });
    await expect(service.releaseEvent('missing')).rejects.toMatchObject({ code: 'EVENT_NOT_FOUND', statusCode: 404 });
  });
});

describe('SportEventService — read, update, delete', () => {
  it('lists events with their field, tier and admin counts for a root admin\'s read, zero where there are none', async () => {
    const { store, service } = setup();
    const event = store.addEvent();
    store.contestsByEvent.set(event.id, 2);
    store.addToField(event.id, 'participant-x');

    const [summary] = await service.listEvents({ sportLeagueSeasonId: event.sportLeagueSeasonId }, { adminCounts: true });

    expect(summary).toMatchObject({
      loadedParticipantCount: 1,
      tierCount: 0,
      adminCounts: { untieredParticipantCount: 1, unpricedParticipantCount: 1, emptyTierLabels: [], contestCount: 2 },
    });
  });

  // #1198 — the admin counts are five more queries per read and count contests across every
  // league, so a member's read runs only the field and tier counts.
  it('lists events for a member with only the field and tier counts, never running the admin counts', async () => {
    const { store, service, sportEvents } = setup();
    const event = store.addEvent();
    store.contestsByEvent.set(event.id, 2);
    store.addToField(event.id, 'participant-x');
    const adminCounts = [
      jest.spyOn(sportEvents, 'countUntieredActiveParticipants'),
      jest.spyOn(sportEvents, 'countUnpricedActiveParticipants'),
      jest.spyOn(sportEvents, 'findEmptyTierLabels'),
      jest.spyOn(sportEvents, 'countContests'),
    ];

    const [summary] = await service.listEvents({ sportLeagueSeasonId: event.sportLeagueSeasonId }, { adminCounts: false });

    expect(summary).toMatchObject({ loadedParticipantCount: 1, tierCount: 0, adminCounts: null });
    for (const count of adminCounts) {
      expect(count).not.toHaveBeenCalled();
    }
  });

  it('narrows the list to the statuses asked for', async () => {
    const { store, service } = setup();
    const scheduled = store.addEvent({ status: SportEventStatus.SCHEDULED });
    const live = store.addEvent({ status: SportEventStatus.IN_PROGRESS });
    store.addEvent({ status: SportEventStatus.COMPLETED });

    const listed = await service.listEvents(
      { sportLeagueSeasonId: IN_MEMORY_SEASON_ID, statuses: [SportEventStatus.SCHEDULED, SportEventStatus.IN_PROGRESS] },
      { adminCounts: false },
    );

    expect(listed.map(({ event }) => event.id).sort()).toEqual([scheduled.id, live.id].sort());
  });

  it('reads one event with no counts at all, and 404s a draft for a released-only read or an unknown id', async () => {
    const { store, service, sportEvents } = setup();
    const draft = store.addEvent({ status: SportEventStatus.DRAFT });
    const countParticipants = jest.spyOn(sportEvents, 'countParticipants');
    const countTiers = jest.spyOn(sportEvents, 'countTiers');

    await expect(service.requireEvent(draft.id)).resolves.toMatchObject({ id: draft.id });
    await expect(service.requireEvent(draft.id, { releasedOnly: true })).rejects.toMatchObject({ code: 'EVENT_NOT_FOUND', statusCode: 404 });
    await expect(service.requireEvent('missing')).rejects.toMatchObject({ code: 'EVENT_NOT_FOUND', statusCode: 404 });
    expect(countParticipants).not.toHaveBeenCalled();
    expect(countTiers).not.toHaveBeenCalled();
  });

  it('refuses to list every event: a sport, a sport league or a Season is required', async () => {
    const { store, service } = setup();
    store.addEvent();

    await expect(service.listEvents({}, { adminCounts: true })).rejects.toMatchObject({ code: 'SPORT_EVENT_FILTER_REQUIRED', statusCode: 400 });
    await expect(service.listEvents({ statuses: [SportEventStatus.DRAFT] }, { adminCounts: true })).rejects.toMatchObject({ code: 'SPORT_EVENT_FILTER_REQUIRED', statusCode: 400 });
  });

  it('updates an admin-managed event, clearing a field set to null', async () => {
    const { store, service } = setup();
    const event = store.addEvent({ venue: 'Old Course' });

    const updated = await service.updateEvent(event.id, { name: 'Renamed', venue: null }, TELL);

    expect(updated.event).toMatchObject({ name: 'Renamed', venue: undefined });
  });

  it('edits an event the provider has an id for, and 404s an unknown one', async () => {
    const { store, service } = setup();
    const linked = store.addEvent({ providerRef: { providerId: FEED, externalId: 'pga-2026-linked' } });

    await expect(service.updateEvent(linked.id, { name: 'Renamed Open' }, TELL)).resolves.toMatchObject({ event: { name: 'Renamed Open' } });
    await expect(service.updateEvent('missing', { name: 'x' }, TELL)).rejects.toMatchObject({ code: 'EVENT_NOT_FOUND', statusCode: 404 });
  });

  it('deletes an event with no contests, and refuses one with contests with 409 EVENT_HAS_CONTESTS', async () => {
    const { store, service } = setup();
    const free = store.addEvent();
    const busy = store.addEvent();
    store.contestsByEvent.set(busy.id, 1);

    await service.deleteEvent(free.id);

    expect(store.events.map((event) => event.id)).toEqual([busy.id]);
    await expect(service.deleteEvent(busy.id)).rejects.toMatchObject({ code: 'EVENT_HAS_CONTESTS', statusCode: 409 });
    await expect(service.deleteEvent('missing')).rejects.toMatchObject({ code: 'EVENT_NOT_FOUND', statusCode: 404 });
  });
});

describe('SportEventService.updateEvent keeps the round schedule in step with the event', () => {
  const DAY = 24 * 60 * 60 * 1000;

  function roundsOf(store: InMemorySportEvents, sportEventId: string) {
    return store.roundRows
      .filter((round) => round.sportEventId === sportEventId)
      .sort((left, right) => left.roundNumber - right.roundNumber)
      .map((round) => ({ roundNumber: round.roundNumber, scheduledDate: round.scheduledDate.toISOString() }));
  }

  it('schedules the added rounds a day apart when an admin raises the round count, so their live scores are kept', async () => {
    const { store, service, sportLeague } = setup();
    const { event } = await slotlessEvent({ store, service, sportLeague }, { rounds: 3 });

    await service.updateEvent(event.id, { rounds: 4 }, TELL);

    expect(roundsOf(store, event.id)).toEqual([
      { roundNumber: 1, scheduledDate: '2026-06-04T12:00:00.000Z' },
      { roundNumber: 2, scheduledDate: '2026-06-05T12:00:00.000Z' },
      { roundNumber: 3, scheduledDate: '2026-06-06T12:00:00.000Z' },
      { roundNumber: 4, scheduledDate: '2026-06-07T12:00:00.000Z' },
    ]);
  });

  it('moves every round by the same amount when an admin moves the start date, so automatic lifecycle starts it on the new date', async () => {
    const { store, service, sportLeague } = setup();
    const { event } = await slotlessEvent({ store, service, sportLeague }, { rounds: 2 });
    // An irregular schedule the admin set: round 2 two days after round 1.
    await new SportEventRoundService({ rounds: store.roundRepo() }).reschedule(event.id, [
      { roundNumber: 2, scheduledDate: new Date(MANUAL_INPUT.startDate.getTime() + 2 * DAY) },
    ]);

    await service.updateEvent(event.id, { startDate: new Date(MANUAL_INPUT.startDate.getTime() + 7 * DAY) }, TELL);

    expect(roundsOf(store, event.id)).toEqual([
      { roundNumber: 1, scheduledDate: '2026-06-11T12:00:00.000Z' },
      { roundNumber: 2, scheduledDate: '2026-06-13T12:00:00.000Z' },
    ]);
  });

  it('tells the leagues on a released event its previous start when an admin moves it, but not for a draft or an unchanged start', async () => {
    const notice = recordingSportEventChangedNotice();
    const { store, service, sportLeague } = setup(Sport.GOLF, notice);
    const { event: draft } = await slotlessEvent({ store, service, sportLeague });
    const { event: released } = await slotlessEvent({ store, service, sportLeague }, { name: 'Released Open' });
    await store.sportEventRepo().update(released.id, { status: SportEventStatus.SCHEDULED });
    const moved = new Date(MANUAL_INPUT.startDate.getTime() + 7 * DAY);

    await service.updateEvent(draft.id, { startDate: moved }, TELL);
    await service.updateEvent(released.id, { startDate: MANUAL_INPUT.startDate, name: 'Renamed Open' }, TELL);
    await service.updateEvent(released.id, { startDate: moved }, TELL);

    expect(notice.sportEventChangedJobs).toHaveBeenCalledTimes(1);
    expect(notice.sportEventChangedJobs).toHaveBeenCalledWith(
      { id: released.id, startDate: moved },
      { kind: 'RESCHEDULED', previousStart: MANUAL_INPUT.startDate },
      { reopening: new Set() },
    );
    // Written with the new start, not queued after it; every edit also carries its boards' rebuild.
    expect(noticeJobs(store)).toEqual([eventChangedJob(released.id, 'RESCHEDULED')]);
  });

  it('tells nobody when an admin moves the start of an event already under way or finished, since its picks are closed', async () => {
    const notice = recordingSportEventChangedNotice();
    const { store, service, sportLeague } = setup(Sport.GOLF, notice);
    const moved = new Date(MANUAL_INPUT.startDate.getTime() + DAY);
    for (const status of [SportEventStatus.IN_PROGRESS, SportEventStatus.COMPLETED, SportEventStatus.CANCELLED]) {
      const { event } = await slotlessEvent({ store, service, sportLeague }, { name: `${status} Open` });
      await store.sportEventRepo().update(event.id, { status });

      // poolmaster-allow-query-in-loop: one in-memory edit per status under test
      await service.updateEvent(event.id, { startDate: moved }, TELL);
    }

    expect(notice.sportEventChangedJobs).not.toHaveBeenCalled();
    expect(noticeJobs(store)).toEqual([]);
  });

  it('tells nobody, and moves nothing, when telling the leagues a released event moved fails before the edit is written', async () => {
    const notice = recordingSportEventChangedNotice();
    notice.sportEventChangedJobs.mockRejectedValueOnce(new Error('database unavailable'));
    const { store, service, sportLeague } = setup(Sport.GOLF, notice);
    const { event: released } = await slotlessEvent({ store, service, sportLeague }, { rounds: 1 });
    await store.sportEventRepo().update(released.id, { status: SportEventStatus.SCHEDULED });

    await expect(service.updateEvent(released.id, { startDate: new Date(MANUAL_INPUT.startDate.getTime() + 7 * DAY) }, TELL))
      .rejects.toThrow('database unavailable');

    expect(store.events.find((event) => event.id === released.id)?.startDate).toEqual(MANUAL_INPUT.startDate);
    expect(store.backgroundJobs).toEqual([]);
  });

  it('moves a released event\'s start and its rounds without telling its leagues when the edit is a data correction', async () => {
    const notice = recordingSportEventChangedNotice();
    const { store, service, sportLeague } = setup(Sport.GOLF, notice);
    const { event: released } = await slotlessEvent({ store, service, sportLeague }, { rounds: 1 });
    await store.sportEventRepo().update(released.id, { status: SportEventStatus.SCHEDULED });
    // Noon UTC, the date-only placeholder, filled in with the real first tee time that day.
    const realStart = new Date('2026-06-04T11:45:00.000Z');

    await service.updateEvent(released.id, { startDate: realStart }, { tellMembers: false });

    expect(notice.sportEventChangedJobs).not.toHaveBeenCalled();
    expect(roundsOf(store, released.id)).toEqual([{ roundNumber: 1, scheduledDate: '2026-06-04T11:45:00.000Z' }]);
  });

  it('refuses a quiet move of a released event that already has a real start time, so its leagues are never left out of a real reschedule', async () => {
    const notice = recordingSportEventChangedNotice();
    const { store, service, sportLeague } = setup(Sport.GOLF, notice);
    const realStart = new Date('2026-06-04T11:45:00.000Z');
    const { event: released } = await slotlessEvent({ store, service, sportLeague }, { startDate: realStart, rounds: 1 });
    await store.sportEventRepo().update(released.id, { status: SportEventStatus.SCHEDULED });

    await expect(service.updateEvent(released.id, { startDate: new Date(realStart.getTime() + DAY) }, { tellMembers: false }))
      .rejects.toMatchObject({ code: 'SPORT_EVENT_START_NOT_PLACEHOLDER', statusCode: 400 });

    expect(notice.sportEventChangedJobs).not.toHaveBeenCalled();
    expect(roundsOf(store, released.id)).toEqual([{ roundNumber: 1, scheduledDate: '2026-06-04T11:45:00.000Z' }]);
  });

  it('has the reminder sweep look again at the event\'s contests when its start moves, even quietly, but not when the start stays (#1170)', async () => {
    const { store, service, sportLeague, reminderRechecks } = setup();
    const { event: released } = await slotlessEvent({ store, service, sportLeague }, { rounds: 1 });
    await store.sportEventRepo().update(released.id, { status: SportEventStatus.SCHEDULED });

    await service.updateEvent(released.id, { name: 'Renamed', startDate: MANUAL_INPUT.startDate }, TELL);
    expect(reminderRechecks).not.toHaveBeenCalled();

    await service.updateEvent(released.id, { startDate: new Date('2026-06-04T11:45:00.000Z') }, { tellMembers: false });
    expect(reminderRechecks.mock.calls).toEqual([[{ sportEventId: released.id }, NOW]]);
  });

  it('leaves the round schedule alone when an edit changes neither the start date nor the round count', async () => {
    const { store, service, sportLeague } = setup();
    const { event } = await slotlessEvent({ store, service, sportLeague }, { rounds: 2 });
    const before = roundsOf(store, event.id);

    await service.updateEvent(event.id, { name: 'Renamed', startDate: MANUAL_INPUT.startDate, rounds: 2 }, TELL);

    expect(roundsOf(store, event.id)).toEqual(before);
  });
});

describe('PATCH /events/:eventId handler passes tellMembers on to the event service', () => {
  type UpdateEventRequest = Parameters<ReturnType<typeof createEventHandlers>['updateEvent']>[0];

  function setupHandlers() {
    const notice = recordingSportEventChangedNotice();
    const { store, service, sportLeague, lifecycle } = setup(Sport.GOLF, notice);
    const handlers = createEventHandlers({
      services: {
        sportEvents: service,
        rounds: stubInstance(SportEventRoundService, {}),
        contests: stubInstance(SportEventContestService, {}),
        bracket: stubInstance(SportEventBracketService, {}),
        tiers: stubInstance(SportEventTierService, {}),
        field: stubInstance(SportEventParticipantService, {}),
        golfScores: stubInstance(GolfScoreService, {}),
        raceResults: stubInstance(RaceResultService, {}),
        matchResults: stubInstance(MatchResultService, {}),
        sportLeagues: stubInstance(SportLeagueService, {}),
        providerGames: stubInstance(ProviderGameSlateService, {}),
      },
      eventLifecycle: lifecycle,
      ingestion: stubInstance(IngestionService, {}),
      leaderboards: new RecordingLeaderboardRebuilds(),
      eventOverviews: stubInstance(SportLeaguePageService, {}),
      slotTiebreakers: stubInstance(SlotTiebreakerService, {}),
    });
    return { store, service, sportLeague, notice, handlers };
  }

  async function releasedPlaceholderEvent({ store, service, sportLeague }: ReturnType<typeof setupHandlers>) {
    const { event } = await slotlessEvent({ store, service, sportLeague });
    await store.sportEventRepo().update(event.id, { status: SportEventStatus.SCHEDULED });
    return event;
  }

  it('fills in a released event\'s real start time without telling its leagues when the body says tellMembers false', async () => {
    const context = setupHandlers();
    const event = await releasedPlaceholderEvent(context);

    const response = await context.handlers.updateEvent(asFastifyRequest<UpdateEventRequest>({
      params: { eventId: event.id },
      body: { startDate: '2026-06-04T11:45:00.000Z', tellMembers: false },
    }));

    expect(response.event.startDate).toBe('2026-06-04T11:45:00.000Z');
    expect(context.notice.sportEventChangedJobs).not.toHaveBeenCalled();
  });

  it('tells a released event\'s leagues about a moved start when the body leaves tellMembers out', async () => {
    const context = setupHandlers();
    const event = await releasedPlaceholderEvent(context);

    await context.handlers.updateEvent(asFastifyRequest<UpdateEventRequest>({
      params: { eventId: event.id },
      body: { startDate: '2026-06-04T11:45:00.000Z' },
    }));

    expect(context.notice.sportEventChangedJobs).toHaveBeenCalledWith(
      { id: event.id, startDate: new Date('2026-06-04T11:45:00.000Z') },
      { kind: 'RESCHEDULED', previousStart: MANUAL_INPUT.startDate },
      { reopening: new Set() },
    );
    expect(noticeJobs(context.store)).toEqual([eventChangedJob(event.id, 'RESCHEDULED')]);
  });
});

describe('event read handlers count admin numbers for a root admin only (#1198)', () => {
  type ListEventsRequest = Parameters<ReturnType<typeof createEventHandlers>['listEvents']>[0];
  type GetEventRequest = Parameters<ReturnType<typeof createEventHandlers>['getEvent']>[0];

  const MEMBER = { userId: 'member-1', email: 'member-1@unit.test', isRootAdmin: false, sessionId: null };
  const ROOT_ADMIN = { userId: 'admin-1', email: 'admin-1@unit.test', isRootAdmin: true, sessionId: null };
  const log = fakeLogger();

  function setupHandlers() {
    const context = setup();
    const listBracket = mockFn<SportEventBracketService['listBracket']>(async () => []);
    const handlers = createEventHandlers({
      services: {
        sportEvents: context.service,
        rounds: stubInstance(SportEventRoundService, {}),
        contests: stubInstance(SportEventContestService, {}),
        bracket: stubInstance(SportEventBracketService, { listBracket }),
        tiers: stubInstance(SportEventTierService, {}),
        field: stubInstance(SportEventParticipantService, {}),
        golfScores: stubInstance(GolfScoreService, {}),
        raceResults: stubInstance(RaceResultService, {}),
        matchResults: stubInstance(MatchResultService, {}),
        sportLeagues: stubInstance(SportLeagueService, {}),
        providerGames: stubInstance(ProviderGameSlateService, {}),
      },
      eventLifecycle: context.lifecycle,
      ingestion: stubInstance(IngestionService, {}),
      leaderboards: new RecordingLeaderboardRebuilds(),
      eventOverviews: stubInstance(SportLeaguePageService, {}),
      slotTiebreakers: stubInstance(SlotTiebreakerService, {}),
    });
    const countContests = jest.spyOn(context.sportEvents, 'countContests');
    return { ...context, handlers, listBracket, countContests };
  }

  it('gives a member\'s event list null admin counts, without counting contests across leagues', async () => {
    const { store, handlers, countContests } = setupHandlers();
    const event = store.addEvent({ status: SportEventStatus.SCHEDULED });
    store.contestsByEvent.set(event.id, 3);

    const response = await handlers.listEvents(asFastifyRequest<ListEventsRequest>({ query: { sportLeagueSeasonId: IN_MEMORY_SEASON_ID, status: [SportEventStatus.SCHEDULED] }, authUser: MEMBER, log }));

    expect(response.events).toEqual([expect.objectContaining({ id: event.id, adminCounts: null })]);
    expect(countContests).not.toHaveBeenCalled();
  });

  it('gives a root admin\'s event list each event\'s admin counts, drafts included', async () => {
    const { store, handlers } = setupHandlers();
    const event = store.addEvent({ status: SportEventStatus.DRAFT });
    store.contestsByEvent.set(event.id, 3);

    const response = await handlers.listEvents(asFastifyRequest<ListEventsRequest>({ query: { sportLeagueSeasonId: IN_MEMORY_SEASON_ID }, authUser: ROOT_ADMIN, log }));

    expect(response.events).toEqual([expect.objectContaining({ id: event.id, adminCounts: expect.objectContaining({ contestCount: 3 }) })]);
  });

  it('passes the statuses asked for on to the list, so contest setup reads only events it can offer', async () => {
    const { store, handlers } = setupHandlers();
    const scheduled = store.addEvent({ status: SportEventStatus.SCHEDULED });
    store.addEvent({ status: SportEventStatus.COMPLETED });

    const response = await handlers.listEvents(asFastifyRequest<ListEventsRequest>({
      query: { sportLeagueSeasonId: IN_MEMORY_SEASON_ID, status: [SportEventStatus.SCHEDULED, SportEventStatus.IN_PROGRESS] },
      authUser: MEMBER,
      log,
    }));

    expect(response.events.map((event) => event.id)).toEqual([scheduled.id]);
  });

  it('gives a member one event with null admin counts, and a root admin the same event with them', async () => {
    const { store, handlers } = setupHandlers();
    const event = store.addEvent({ status: SportEventStatus.SCHEDULED });
    store.contestsByEvent.set(event.id, 2);

    const member = await handlers.getEvent(asFastifyRequest<GetEventRequest>({ params: { eventId: event.id }, authUser: MEMBER }));
    const admin = await handlers.getEvent(asFastifyRequest<GetEventRequest>({ params: { eventId: event.id }, authUser: ROOT_ADMIN }));

    expect(member.event.adminCounts).toBeNull();
    expect(admin.event.adminCounts).toMatchObject({ contestCount: 2 });
  });

  it('answers a member\'s bracket read on a draft with 404 from one event read, counting nothing', async () => {
    const { store, handlers, sportEvents, listBracket } = setupHandlers();
    const draft = store.addEvent({ status: SportEventStatus.DRAFT });
    const countParticipants = jest.spyOn(sportEvents, 'countParticipants');

    await expect(handlers.getEventBracket(asFastifyRequest<GetEventRequest>({ params: { eventId: draft.id }, authUser: MEMBER })))
      .rejects.toMatchObject({ code: 'EVENT_NOT_FOUND', statusCode: 404 });
    await expect(handlers.getEventBracket(asFastifyRequest<GetEventRequest>({ params: { eventId: draft.id }, authUser: ROOT_ADMIN })))
      .resolves.toEqual({ matches: [] });
    expect(listBracket).toHaveBeenCalledTimes(1);
    expect(countParticipants).not.toHaveBeenCalled();
  });
});

describe('SportEventService — leaderboard rebuild (#1466)', () => {
  it('writes the event\'s rebuild job with an edit, and with a moved start alongside the leagues\' notice, waking the runner after each', async () => {
    const domainEvents = new RecordingDomainEvents();
    const notice = recordingSportEventChangedNotice();
    const { store, service, sportLeague } = setup(Sport.GOLF, notice, domainEvents);
    const { event } = await slotlessEvent({ store, service, sportLeague }, { rounds: 1 });
    await store.sportEventRepo().update(event.id, { status: SportEventStatus.SCHEDULED });

    await service.updateEvent(event.id, { name: 'Renamed Open' }, TELL);
    await service.updateEvent(event.id, { startDate: new Date(MANUAL_INPUT.startDate.getTime() + 24 * 60 * 60 * 1000) }, TELL);

    expect(store.backgroundJobs).toEqual([eventRebuildJob(event.id), eventChangedJob(event.id, 'RESCHEDULED'), eventRebuildJob(event.id)]);
    expect(domainEvents.changedSportEventIds).toEqual([event.id, event.id]);
  });
});
