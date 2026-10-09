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
import { cleanupTestData, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
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

function reader(provider = fakeSportDataProvider({ providerId: PROVIDER })) {
  return createScheduledEventReader({ prisma: getPrisma(), registry: registryWith(provider) });
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
    const sport = await prisma.sport.findUniqueOrThrow({ where: { name: Sport.GOLF } });
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

    const eventIds = await reader().listEventIdsForFeed({ sport: Sport.GOLF, feed: 'EVENTLIVESCORES', now });

    expect(eventIds).toEqual(['live-with-field']);
  });

  it('polls only the events held by the sport\'s registered provider', async () => {
    await createEvent('ours', { status: 'IN_PROGRESS', withField: true });
    await createEvent('theirs', { status: 'IN_PROGRESS', providerId: 'TEST_PROVIDER', withField: true });

    const eventIds = await reader().listEventIdsForFeed({ sport: Sport.GOLF, feed: 'EVENTLIVESCORES', now });

    expect(eventIds).toEqual(['ours']);
  });

  it('polls nothing when no provider is registered for the sport', async () => {
    await createEvent('orphan', { status: 'IN_PROGRESS', withField: true });

    const eventIds = await createScheduledEventReader({ prisma: getPrisma(), registry: registryWith(null) })
      .listEventIdsForFeed({ sport: Sport.GOLF, feed: 'EVENTLIVESCORES', now });

    expect(eventIds).toEqual([]);
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

    const eventIds = await reader().listEventIdsForFeed({
      sport: Sport.GOLF,
      feed: 'EVENTPARTICIPANTS',
      now,
      from: now,
      to: weekLater,
    });

    expect(eventIds).toEqual(['draft-event', 'released-event']);
  });

  it('never offers an event that starts after the window closes', async () => {
    await createEvent('in-window', { startDate: new Date('2026-05-01T12:00:00.000Z') });
    await createEvent('after-window', { startDate: new Date('2026-05-04T12:00:00.000Z') });

    const eventIds = await reader().listEventIdsForFeed({
      sport: Sport.GOLF,
      feed: 'EVENTPARTICIPANTS',
      now,
      from: now,
      to: weekLater,
    });

    expect(eventIds).toEqual(['in-window']);
  });

  it('offers at most the two soonest events per pass, soonest first', async () => {
    await createEvent('third', { startDate: new Date('2026-05-03T12:00:00.000Z') });
    await createEvent('first', { startDate: new Date('2026-04-28T12:00:00.000Z') });
    await createEvent('second', { startDate: new Date('2026-04-29T12:00:00.000Z') });

    const eventIds = await reader().listEventIdsForFeed({
      sport: Sport.GOLF,
      feed: 'EVENTPARTICIPANTS',
      now,
      from: now,
      to: weekLater,
    });

    expect(eventIds).toEqual(['first', 'second']);
  });

  it('leaves the window open-ended after now when no bounds are given', async () => {
    await createEvent('started', { startDate: new Date('2026-04-20T12:00:00.000Z') });
    await createEvent('next-year', { startDate: new Date('2027-04-20T12:00:00.000Z') });

    const eventIds = await reader().listEventIdsForFeed({ sport: Sport.GOLF, feed: 'EVENTPARTICIPANTS', now });

    expect(eventIds).toEqual(['next-year']);
  });
});
