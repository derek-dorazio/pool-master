/**
 * Which events the scheduler polls, read from real rows.
 *
 * The reader turns a feed into a `sportEvent` query. Its unit suite used to assert the query
 * object it built, or replay that object through a hand-written filter, which only proved the
 * code agreed with itself (#209). Here each rule is a row that should or should not come back.
 */
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { Sport } from '@poolmaster/shared/domain';
import { createScheduledEventReader } from '../../../packages/core-api/src/modules/ingestion/core/scheduled-event-reader';
import { cleanupTestData, getAppPrisma, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { freshEventEdition } from '../../support/event-edition';
import { fakeSportDataProvider, registryWith } from '../../support/fake-sport-data-provider';

const PROVIDER = 'integration-test';
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

async function createEvent(
  externalId: string,
  overrides: Partial<Prisma.SportEventUncheckedCreateInput> & { withField?: boolean } = {},
) {
  const prisma = getPrisma();
  const { withField = false, ...data } = overrides;
  const event = await prisma.sportEvent.create({
    data: {
      ...(await freshEventEdition(prisma)),
      externalId,
      providerId: PROVIDER,
      sport: Sport.GOLF,
      name: `Reader ${externalId}`,
      startDate: new Date('2026-04-30T12:00:00.000Z'),
      status: 'SCHEDULED',
      syncScope: 'SCORES_ONLY',
      ...data,
    },
  });
  if (withField) {
    const sport = await prisma.sport.findUniqueOrThrow({ where: { sport: Sport.GOLF } });
    const participant = await prisma.participant.create({
      data: { sportId: sport.id, name: `Golfer ${randomUUID()}`, participantType: 'INDIVIDUAL' },
    });
    await prisma.sportEventParticipant.create({ data: { sportEventId: event.id, participantId: participant.id } });
  }
  return event;
}

describe('ScheduledEventReader — live scores', () => {
  it('polls only in-progress events linked for scores that already have a field', async () => {
    await createEvent('live-with-field', { status: 'IN_PROGRESS', withField: true });
    await createEvent('live-without-field', { status: 'IN_PROGRESS' });
    await createEvent('live-unlinked', { status: 'IN_PROGRESS', syncScope: 'NONE', withField: true });
    await createEvent('scheduled-with-field', { status: 'SCHEDULED', withField: true });
    await createEvent('completed-with-field', { status: 'COMPLETED', withField: true });

    const events = await reader().listLiveScoreEvents({ sport: Sport.GOLF, now });

    expect(externalIds(events)).toEqual(['live-with-field']);
  });

  it('polls only the events held by the sport\'s registered provider', async () => {
    await createEvent('ours', { status: 'IN_PROGRESS', withField: true });
    await createEvent('theirs', { status: 'IN_PROGRESS', providerId: 'TEST_PROVIDER', withField: true });

    const events = await reader().listLiveScoreEvents({ sport: Sport.GOLF, now });

    expect(externalIds(events)).toEqual(['ours']);
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

    expect(listed).toEqual({ providerId: PROVIDER, externalId: 'golf-round-2', playedInRounds: true, playUnderwaySince: roundTwoStart, lastProviderNotificationAt: notifiedAt });
  });

  it('reads a game event as in play since its earliest-scheduled match in progress, and not in play between its matches', async () => {
    const provider = fakeSportDataProvider({ providerId: PROVIDER, sportsCovered: [Sport.AMERICAN_FOOTBALL] });
    const playing = await createEvent('nfl-week-live', { sport: Sport.AMERICAN_FOOTBALL, status: 'IN_PROGRESS', withField: true });
    const between = await createEvent('nfl-week-between', { sport: Sport.AMERICAN_FOOTBALL, status: 'IN_PROGRESS', withField: true });
    const early = new Date('2026-04-26T17:00:00.000Z');
    for (const [event, matches] of [
      [playing, [{ status: 'COMPLETED', scheduledDate: new Date('2026-04-26T13:00:00.000Z') }, { status: 'IN_PROGRESS', scheduledDate: early }, { status: 'IN_PROGRESS', scheduledDate: new Date('2026-04-26T20:00:00.000Z') }]],
      [between, [{ status: 'COMPLETED', scheduledDate: new Date('2026-04-26T13:00:00.000Z') }, { status: 'SCHEDULED', scheduledDate: new Date('2026-04-27T00:00:00.000Z') }]],
    ] as const) {
      const round = await getPrisma().sportEventRound.create({ data: { sportEventId: event.id, roundNumber: 1, scheduledDate: new Date('2026-04-26T12:00:00.000Z') } });
      await getPrisma().sportEventMatch.createMany({
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
  it('offers draft and released events that start inside the window, never started, finished or unlinked ones', async () => {
    await createEvent('draft-event', { status: 'DRAFT', startDate: new Date('2026-04-30T12:00:00.000Z') });
    await createEvent('released-event', { status: 'SCHEDULED', startDate: new Date('2026-05-02T12:00:00.000Z') });
    await createEvent('in-progress-event', { status: 'IN_PROGRESS', startDate: new Date('2026-04-27T12:00:00.000Z') });
    await createEvent('completed-event', { status: 'COMPLETED', startDate: new Date('2026-04-27T12:00:00.000Z') });
    await createEvent('already-started-event', { status: 'SCHEDULED', startDate: new Date('2026-04-26T12:00:00.000Z') });
    await createEvent('past-window-event', { status: 'SCHEDULED', startDate: new Date('2026-05-04T12:00:00.000Z') });
    await createEvent('unlinked-event', { status: 'SCHEDULED', syncScope: 'NONE', startDate: new Date('2026-04-29T12:00:00.000Z') });

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
    await createEvent('in-window', { startDate: new Date('2026-05-01T12:00:00.000Z') });
    await createEvent('after-window', { startDate: new Date('2026-05-04T12:00:00.000Z') });

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
    await createEvent('third', { startDate: new Date('2026-05-03T12:00:00.000Z') });
    await createEvent('first', { startDate: new Date('2026-04-28T12:00:00.000Z') });
    await createEvent('second', { startDate: new Date('2026-04-29T12:00:00.000Z') });

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
    await createEvent('started', { startDate: new Date('2026-04-20T12:00:00.000Z') });
    await createEvent('next-year', { startDate: new Date('2027-04-20T12:00:00.000Z') });

    const events = await reader().listEventsForFeed({ sport: Sport.GOLF, feed: 'EVENTPARTICIPANTS', now });

    expect(externalIds(events)).toEqual(['next-year']);
  });
});

describe('ScheduledEventReader — field hydration for synced sport leagues only (#1726)', () => {
  async function seriesInLeague(name: string, eventSyncProviderId: string | null, isActive = true) {
    const prisma = getPrisma();
    const sport = await prisma.sport.upsert({
      where: { sport: Sport.GOLF },
      create: { sport: Sport.GOLF, participantType: 'INDIVIDUAL', tournamentFormat: 'STROKE_PLAY_TOURNAMENT' },
      update: {},
    });
    const league = await prisma.sportLeague.create({ data: { sportId: sport.id, name: `${name} ${randomUUID()}`, eventSyncProviderId, isActive } });
    const series = await prisma.eventSeries.create({ data: { sportLeagueId: league.id, name: `${name} series ${randomUUID()}` } });
    return { eventSeriesId: series.id };
  }

  it('offers only the events of active sport leagues whose sync names the event\'s provider, and offers every linked event without the switch', async () => {
    await createEvent('synced', { ...(await seriesInLeague('Synced', PROVIDER)), startDate: new Date('2026-04-29T12:00:00.000Z') });
    await createEvent('other-provider-sync', { ...(await seriesInLeague('Other sync', 'another-feed')), startDate: new Date('2026-04-28T12:00:00.000Z') });
    await createEvent('sync-off', { ...(await seriesInLeague('Off', null)), startDate: new Date('2026-04-28T06:00:00.000Z') });
    await createEvent('inactive-league', { ...(await seriesInLeague('Inactive', PROVIDER, false)), startDate: new Date('2026-04-28T03:00:00.000Z') });

    const syncedOnly = await reader().listEventsForFeed({ sport: Sport.GOLF, feed: 'EVENTPARTICIPANTS', now, to: weekLater, syncedLeaguesOnly: true });
    const all = await reader().listEventsForFeed({ sport: Sport.GOLF, feed: 'EVENTPARTICIPANTS', now, to: weekLater });

    expect(externalIds(syncedOnly)).toEqual(['synced']);
    expect(externalIds(all)).toEqual(['inactive-league', 'sync-off']);
  });

  it('takes the two soonest from the synced leagues\' events, so an earlier unsynced event never crowds one out', async () => {
    await createEvent('unsynced-earliest', { startDate: new Date('2026-04-27T12:00:00.000Z') });
    const synced = await seriesInLeague('Synced', PROVIDER);
    const later = await seriesInLeague('Synced later', PROVIDER);
    const latest = await seriesInLeague('Synced latest', PROVIDER);
    await createEvent('synced-first', { ...synced, startDate: new Date('2026-04-28T12:00:00.000Z') });
    await createEvent('synced-second', { ...later, startDate: new Date('2026-04-29T12:00:00.000Z') });
    await createEvent('synced-third', { ...latest, startDate: new Date('2026-04-30T12:00:00.000Z') });

    const events = await reader().listEventsForFeed({ sport: Sport.GOLF, feed: 'EVENTPARTICIPANTS', now, to: weekLater, syncedLeaguesOnly: true });

    expect(externalIds(events)).toEqual(['synced-first', 'synced-second']);
  });
});

describe('ScheduledEventReader — two providers serving the sport', () => {
  const OTHER = 'integration-test-secondary';
  const twoProviders = () => {
    const registry = registryWith(fakeSportDataProvider({ providerId: PROVIDER }));
    registry.register(Sport.GOLF, fakeSportDataProvider({ providerId: OTHER }), 'SECONDARY');
    return createScheduledEventReader({ prisma: getAppPrisma(), registry });
  };

  it('loads each provider\'s own two soonest fields, so one provider\'s earlier events never hold the other\'s back', async () => {
    await createEvent('ours-first', { startDate: new Date('2026-04-27T12:00:00.000Z') });
    await createEvent('ours-second', { startDate: new Date('2026-04-28T12:00:00.000Z') });
    await createEvent('ours-third', { startDate: new Date('2026-04-29T12:00:00.000Z') });
    await createEvent('theirs-first', { providerId: OTHER, startDate: new Date('2026-05-01T12:00:00.000Z') });

    const events = await twoProviders().listEventsForFeed({ sport: Sport.GOLF, feed: 'EVENTPARTICIPANTS', now, from: now, to: weekLater });

    expect(events).toEqual([
      { providerId: PROVIDER, externalId: 'ours-first' },
      { providerId: PROVIDER, externalId: 'ours-second' },
      { providerId: OTHER, externalId: 'theirs-first' },
    ]);
  });

  it('polls the live events of both providers, each named with the provider it is linked to', async () => {
    await createEvent('shared-id', { status: 'IN_PROGRESS', withField: true });
    await createEvent('shared-id', { status: 'IN_PROGRESS', providerId: OTHER, withField: true });

    const events = await twoProviders().listLiveScoreEvents({ sport: Sport.GOLF, now });

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerId: PROVIDER, externalId: 'shared-id' }),
      expect.objectContaining({ providerId: OTHER, externalId: 'shared-id' }),
    ]));
    expect(events).toHaveLength(2);
  });
});
