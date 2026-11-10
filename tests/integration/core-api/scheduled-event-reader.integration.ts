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

    const events = await reader().listEventsForFeed({ sport: Sport.GOLF, feed: 'EVENTLIVESCORES', now });

    expect(externalIds(events)).toEqual(['live-with-field']);
  });

  it('polls only the events held by the sport\'s registered provider', async () => {
    await createEvent('ours', { status: 'IN_PROGRESS', withField: true });
    await createEvent('theirs', { status: 'IN_PROGRESS', providerId: 'TEST_PROVIDER', withField: true });

    const events = await reader().listEventsForFeed({ sport: Sport.GOLF, feed: 'EVENTLIVESCORES', now });

    expect(externalIds(events)).toEqual(['ours']);
  });

  it('polls nothing when no provider is registered for the sport', async () => {
    await createEvent('orphan', { status: 'IN_PROGRESS', withField: true });

    const events = await createScheduledEventReader({ prisma: getAppPrisma(), registry: registryWith(null) })
      .listEventsForFeed({ sport: Sport.GOLF, feed: 'EVENTLIVESCORES', now });

    expect(externalIds(events)).toEqual([]);
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

    const events = await twoProviders().listEventsForFeed({ sport: Sport.GOLF, feed: 'EVENTLIVESCORES', now });

    expect(events).toEqual(expect.arrayContaining([
      { providerId: PROVIDER, externalId: 'shared-id' },
      { providerId: OTHER, externalId: 'shared-id' },
    ]));
    expect(events).toHaveLength(2);
  });
});
