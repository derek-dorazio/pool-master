/**
 * Which events the scheduler polls, read from real rows.
 *
 * The reader turns a feed into a `sportEvent` query. Its unit suite used to assert the query
 * object it built, or replay that object through a hand-written filter, which only proved the
 * code agreed with itself (#209). Here each rule is a row that should or should not come back.
 */
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { ProviderCode, Sport } from '@poolmaster/shared/domain';
import { createScheduledEventReader } from '../../../packages/core-api/src/modules/ingestion/core/scheduled-event-reader';
import { cleanupTestData, getAppPrisma, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { freshEventEdition, mapEventToProvider } from '../../support/event-edition';
import { fakeSportDataProvider, registryWith } from '../../support/fake-sport-data-provider';
import { sportLeagueRowDefaults } from '../../support/league-profiles';
import { SYNCED_PROVIDER_ID, syncLeagueTo } from '../../support/league-sync';
import { participantLeagueId } from '../../support/participant-league';
import { sportRowKeys } from '../../support/sport-rows';
import { sportPlay } from '../../support/sport-play';

// The events' provider: BALLDONTLIE's id, since a synced league names a provider by its row (#1997).
const PROVIDER = SYNCED_PROVIDER_ID;
const now = new Date('2026-04-26T22:30:00.000Z');
const weekLater = new Date('2026-05-03T22:30:00.000Z');

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

function externalIds(events: Array<{ externalId: string }>): string[] {
  return events.map((event) => event.externalId);
}

function reader(provider = fakeSportDataProvider({ providerId: PROVIDER })) {
  return createScheduledEventReader({ prisma: getAppPrisma(), registry: registryWith(provider) });
}

/** The provider league an event of each sport here is kept under. */
const PROVIDER_LEAGUE_OF: Partial<Record<Sport, string>> = { [Sport.GOLF]: 'pga', [Sport.AMERICAN_FOOTBALL]: 'nfl' };

/**
 * A Season of its own in a new golf league, synced from BALLDONTLIE's PGA league when `synced`:
 * an event made in it is that league's (#2004).
 */
async function seriesInLeague(name: string, synced: boolean, isActive = true) {
  const prisma = getPrisma();
  const sport = await prisma.sport.upsert({
    where: { sport: Sport.GOLF },
    create: { sport: Sport.GOLF, ...sportRowKeys(Sport.GOLF), tournamentFormat: 'STROKE_PLAY_TOURNAMENT' },
    update: {},
  });
  const league = await prisma.sportLeague.create({ data: { timeZone: 'UTC', ...(await sportLeagueRowDefaults(prisma)), ...sportPlay(sport.sport), sportId: sport.id, name: `${name} ${randomUUID()}`, isActive } });
  if (synced) await syncLeagueTo(prisma, league.id, 'pga');
  return freshEventEdition(prisma, { name, sportLeagueId: league.id, championshipYear: 2026 });
}

/**
 * An event the provider has `externalId` for (#2004), under its sport's provider league, unless
 * `linked` is false, when it has no provider id at all. With `synced`, it is in a league of its own
 * synced from the provider, as a field sync reads (#2086).
 */
async function createEvent(
  externalId: string,
  overrides: Partial<Prisma.SportEventUncheckedCreateInput> & { withField?: boolean; linked?: boolean; sport?: Sport; synced?: boolean } = {},
) {
  const prisma = getPrisma();
  const { withField = false, sport: eventSport = Sport.GOLF, linked = true, synced = false, ...data } = overrides;
  const event = await prisma.sportEvent.create({
    data: {
      ...(await freshEventEdition(prisma, { sport: eventSport })),
      ...(synced && await seriesInLeague(`Synced ${externalId}`, true)),
      name: `Reader ${externalId}`,
      startDate: new Date('2026-04-30T12:00:00.000Z'),
      status: 'SCHEDULED',
      ...data,
    },
  });
  if (linked) await mapEventToProvider(prisma, event.id, { providerId: PROVIDER, externalId }, PROVIDER_LEAGUE_OF[eventSport]);
  if (withField) {
    const sport = await prisma.sport.findUniqueOrThrow({ where: { sport: Sport.GOLF } });
    const participant = await prisma.participant.create({
      data: { sportLeagueId: await participantLeagueId(prisma, sport.id), name: `Golfer ${randomUUID()}`, participantType: 'INDIVIDUAL' },
    });
    await prisma.sportEventParticipant.create({ data: { sportEventId: event.id, participantId: participant.id } });
  }
  return event;
}

describe('ScheduledEventReader — live scores', () => {
  it('polls only in-progress events linked for scores that already have a field', async () => {
    await createEvent('live-with-field', { status: 'IN_PROGRESS', withField: true });
    await createEvent('live-without-field', { status: 'IN_PROGRESS' });
    await createEvent('live-unlinked', { status: 'IN_PROGRESS', linked: false, withField: true });
    await createEvent('scheduled-with-field', { status: 'SCHEDULED', withField: true });
    await createEvent('completed-with-field', { status: 'COMPLETED', withField: true });

    const events = await reader().listLiveScoreEvents({ sport: Sport.GOLF, now });

    expect(externalIds(events)).toEqual(['live-with-field']);
  });

  it('polls nothing for a registered provider with no Provider row, which holds no event\'s id', async () => {
    await createEvent('ours', { status: 'IN_PROGRESS', withField: true });

    const events = await reader(fakeSportDataProvider({ providerId: 'integration-test-rowless' })).listLiveScoreEvents({ sport: Sport.GOLF, now });

    expect(events).toEqual([]);
  });

  it('polls nothing when no provider is registered for the sport', async () => {
    await createEvent('orphan', { status: 'IN_PROGRESS', withField: true });

    const events = await createScheduledEventReader({ prisma: getAppPrisma(), registry: registryWith(null) })
      .listLiveScoreEvents({ sport: Sport.GOLF, now });

    expect(externalIds(events)).toEqual([]);
  });
});

describe('ScheduledEventReader — play under way and notifications (#1499)', () => {
  it('reads a golf event as in play since its latest started round while that round runs, with when its provider last notified about it', async () => {
    const notifiedAt = new Date('2026-04-26T21:00:00.000Z');
    const event = await createEvent('golf-round-2', { status: 'IN_PROGRESS', withField: true, lastProviderNotificationAt: notifiedAt });
    const roundTwoStart = new Date('2026-04-26T12:00:00.000Z');
    await getPrisma().sportEventRound.createMany({
      data: [
        { sportEventId: event.id, roundNumber: 1, scheduledDate: new Date('2026-04-25T12:00:00.000Z'), scheduledEndAt: new Date('2026-04-26T00:00:00.000Z') },
        { sportEventId: event.id, roundNumber: 2, scheduledDate: roundTwoStart, scheduledEndAt: new Date('2026-04-27T00:00:00.000Z') },
        { sportEventId: event.id, roundNumber: 3, scheduledDate: new Date('2026-04-27T12:00:00.000Z'), scheduledEndAt: new Date('2026-04-28T00:00:00.000Z') },
      ],
    });

    const [listed] = await reader().listLiveScoreEvents({ sport: Sport.GOLF, now });

    expect(listed).toEqual({ providerId: PROVIDER, externalId: 'golf-round-2', providerLeagueCode: 'pga', playedInRounds: true, playUnderwaySince: roundTwoStart, lastProviderNotificationAt: notifiedAt });
  });

  it('reads a game event as in play since its earliest-scheduled match in progress, and not in play between its matches', async () => {
    const provider = fakeSportDataProvider({ providerId: PROVIDER });
    const playing = await createEvent('nfl-week-live', { sport: Sport.AMERICAN_FOOTBALL, status: 'IN_PROGRESS', withField: true });
    const between = await createEvent('nfl-week-between', { sport: Sport.AMERICAN_FOOTBALL, status: 'IN_PROGRESS', withField: true });
    const early = new Date('2026-04-26T17:00:00.000Z');
    for (const [event, matches] of [
      [playing, [{ status: 'COMPLETED', scheduledDate: new Date('2026-04-26T13:00:00.000Z') }, { status: 'IN_PROGRESS', scheduledDate: early }, { status: 'IN_PROGRESS', scheduledDate: new Date('2026-04-26T20:00:00.000Z') }]],
      [between, [{ status: 'COMPLETED', scheduledDate: new Date('2026-04-26T13:00:00.000Z') }, { status: 'SCHEDULED', scheduledDate: new Date('2026-04-27T00:00:00.000Z') }]],
    ] as const) {
      const round = await getPrisma().sportEventRound.create({ data: { sportEventId: event.id, roundNumber: 1, scheduledDate: new Date('2026-04-26T12:00:00.000Z') } });
      await getPrisma().sportEventRoundMatch.createMany({
        data: matches.map((match, index) => ({ sportEventId: event.id, sportEventRoundId: round.id, matchNumber: index + 1, isNeutralSite: false, ...match })),
      });
    }

    const listed = await reader(provider).listLiveScoreEvents({ sport: Sport.AMERICAN_FOOTBALL, now });

    expect(listed).toEqual(expect.arrayContaining([
      expect.objectContaining({ externalId: 'nfl-week-live', playUnderwaySince: early, lastProviderNotificationAt: null }),
      expect.objectContaining({ externalId: 'nfl-week-between', playUnderwaySince: null }),
    ]));
    expect(listed).toHaveLength(2);
  });
});

describe('ScheduledEventReader — field hydration', () => {
  // Every event here is a synced league's: the field sync reads no other (#2086).
  it('offers draft and released events that start inside the window, never started, finished or unlinked ones', async () => {
    await createEvent('draft-event', { synced: true, status: 'DRAFT', startDate: new Date('2026-04-30T12:00:00.000Z') });
    await createEvent('released-event', { synced: true, status: 'SCHEDULED', startDate: new Date('2026-05-02T12:00:00.000Z') });
    await createEvent('in-progress-event', { synced: true, status: 'IN_PROGRESS', startDate: new Date('2026-04-27T12:00:00.000Z') });
    await createEvent('completed-event', { synced: true, status: 'COMPLETED', startDate: new Date('2026-04-27T12:00:00.000Z') });
    await createEvent('already-started-event', { synced: true, status: 'SCHEDULED', startDate: new Date('2026-04-26T12:00:00.000Z') });
    await createEvent('past-window-event', { synced: true, status: 'SCHEDULED', startDate: new Date('2026-05-04T12:00:00.000Z') });
    await createEvent('unlinked-event', { synced: true, status: 'SCHEDULED', linked: false, startDate: new Date('2026-04-29T12:00:00.000Z') });

    const events = await reader().listEventsForFeed({
      sport: Sport.GOLF,
      feed: 'EVENTPARTICIPANTS',
      now,
      from: now,
      to: weekLater,
    });

    expect(externalIds(events)).toEqual(['draft-event', 'released-event']);
  });

  it('never offers an event that starts after the window closes', async () => {
    await createEvent('in-window', { synced: true, startDate: new Date('2026-05-01T12:00:00.000Z') });
    await createEvent('after-window', { synced: true, startDate: new Date('2026-05-04T12:00:00.000Z') });

    const events = await reader().listEventsForFeed({
      sport: Sport.GOLF,
      feed: 'EVENTPARTICIPANTS',
      now,
      from: now,
      to: weekLater,
    });

    expect(externalIds(events)).toEqual(['in-window']);
  });

  it('offers at most the two soonest events per pass, soonest first', async () => {
    await createEvent('third', { synced: true, startDate: new Date('2026-05-03T12:00:00.000Z') });
    await createEvent('first', { synced: true, startDate: new Date('2026-04-28T12:00:00.000Z') });
    await createEvent('second', { synced: true, startDate: new Date('2026-04-29T12:00:00.000Z') });

    const events = await reader().listEventsForFeed({
      sport: Sport.GOLF,
      feed: 'EVENTPARTICIPANTS',
      now,
      from: now,
      to: weekLater,
    });

    expect(externalIds(events)).toEqual(['first', 'second']);
  });

  it('leaves the window open-ended after now when no bounds are given', async () => {
    await createEvent('started', { synced: true, startDate: new Date('2026-04-20T12:00:00.000Z') });
    await createEvent('next-year', { synced: true, startDate: new Date('2027-04-20T12:00:00.000Z') });

    const events = await reader().listEventsForFeed({ sport: Sport.GOLF, feed: 'EVENTPARTICIPANTS', now });

    expect(externalIds(events)).toEqual(['next-year']);
  });
});

describe('ScheduledEventReader — field hydration for synced sport leagues only (#1726)', () => {


  it('offers only the events of active sport leagues whose sync names the event\'s provider: never an unsynced or inactive league\'s', async () => {
    await createEvent('synced', { ...(await seriesInLeague('Synced', true)), startDate: new Date('2026-04-29T12:00:00.000Z') });
    await createEvent('sync-off', { ...(await seriesInLeague('Off', false)), startDate: new Date('2026-04-28T06:00:00.000Z') });
    await createEvent('inactive-league', { ...(await seriesInLeague('Inactive', true, false)), startDate: new Date('2026-04-28T03:00:00.000Z') });

    const offered = await reader().listEventsForFeed({ sport: Sport.GOLF, feed: 'EVENTPARTICIPANTS', now, to: weekLater });

    expect(externalIds(offered)).toEqual(['synced']);
  });

  it('offers none of the events of a provider with no Provider row, which syncs no league, even in a synced league', async () => {
    const rowless = 'integration-test-rowless';
    const registry = registryWith(fakeSportDataProvider({ providerId: rowless }));
    await createEvent('rowless', { ...(await seriesInLeague('Synced', true)), startDate: new Date('2026-04-29T12:00:00.000Z') });

    const events = await createScheduledEventReader({ prisma: getAppPrisma(), registry })
      .listEventsForFeed({ sport: Sport.GOLF, feed: 'EVENTPARTICIPANTS', now, to: weekLater });

    expect(events).toEqual([]);
  });

  it('takes the two soonest from the synced leagues\' events, so an earlier unsynced event never crowds one out', async () => {
    await createEvent('unsynced-earliest', { startDate: new Date('2026-04-27T12:00:00.000Z') });
    const synced = await seriesInLeague('Synced', true);
    const later = await seriesInLeague('Synced later', true);
    const latest = await seriesInLeague('Synced latest', true);
    await createEvent('synced-first', { ...synced, startDate: new Date('2026-04-28T12:00:00.000Z') });
    await createEvent('synced-second', { ...later, startDate: new Date('2026-04-29T12:00:00.000Z') });
    await createEvent('synced-third', { ...latest, startDate: new Date('2026-04-30T12:00:00.000Z') });

    const events = await reader().listEventsForFeed({ sport: Sport.GOLF, feed: 'EVENTPARTICIPANTS', now, to: weekLater });

    expect(externalIds(events)).toEqual(['synced-first', 'synced-second']);
  });
});

describe('ScheduledEventReader — a second provider running', () => {
  // BALLDONTLIE is the one provider with a row, so a second running provider holds no event's
  // id and no league's selected mapping: it adds nothing, and never holds BALLDONTLIE's events back.
  const twoProviders = () => {
    const registry = registryWith(
      fakeSportDataProvider({ providerId: PROVIDER }),
      fakeSportDataProvider({ providerId: 'integration-test-secondary', providerCode: 'SECONDARY_FEED' as ProviderCode }),
    );
    return createScheduledEventReader({ prisma: getAppPrisma(), registry });
  };

  it('loads the two soonest fields of the provider its leagues sync from, the second provider with no row adding none', async () => {
    await createEvent('ours-first', { synced: true, startDate: new Date('2026-04-27T12:00:00.000Z') });
    await createEvent('ours-second', { synced: true, startDate: new Date('2026-04-28T12:00:00.000Z') });
    await createEvent('ours-third', { synced: true, startDate: new Date('2026-04-29T12:00:00.000Z') });

    const events = await twoProviders().listEventsForFeed({ sport: Sport.GOLF, feed: 'EVENTPARTICIPANTS', now, from: now, to: weekLater });

    expect(events).toEqual([
      { providerId: PROVIDER, externalId: 'ours-first' },
      { providerId: PROVIDER, externalId: 'ours-second' },
    ]);
  });

  it('polls the live events by the provider each is linked to, the second provider with no row adding none', async () => {
    await createEvent('shared-id', { status: 'IN_PROGRESS', withField: true });

    const events = await twoProviders().listLiveScoreEvents({ sport: Sport.GOLF, now });

    expect(events).toEqual([expect.objectContaining({ providerId: PROVIDER, externalId: 'shared-id', providerLeagueCode: 'pga' })]);
  });
});

describe('ScheduledEventReader — the sports the scheduler runs loops for (#2073)', () => {
  it('lists each sport with an active league whose selected mapping names a running provider, once, in display order', async () => {
    // A synced golf league made inactive adds nothing of its own; an active one keeps golf listed.
    await seriesInLeague('Inactive synced', true, false);
    await seriesInLeague('Active synced', true);
    const leagues = await getPrisma().sportLeague.findMany({
      select: { isActive: true, sport: { select: { sport: true, displayOrder: true } }, selectedProviderMapping: { select: { providerLeague: { select: { provider: { select: { code: true } } } } } } },
    });
    const expected = [...new Map(leagues
      .filter((league) => league.isActive && league.selectedProviderMapping?.providerLeague.provider.code === 'BALLDONTLIE')
      .sort((a, b) => a.sport.displayOrder - b.sport.displayOrder)
      .map((league) => [league.sport.sport, league.sport.sport])).values()];

    const sports = await reader().listSyncedSports({ providerCodes: [ProviderCode.BALLDONTLIE] });

    expect(sports).toContain(Sport.GOLF);
    expect(sports).toEqual(expected);
  });
});
