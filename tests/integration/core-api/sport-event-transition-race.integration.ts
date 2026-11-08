import { randomUUID } from 'node:crypto';
import { BackgroundJobType, Sport, SportEventStatus } from '@poolmaster/shared/domain';
import {
  PrismaContestConfigurationRepository,
  PrismaContestRepository,
  PrismaSportEventMatchRepository,
  PrismaSportEventRepository,
} from '../../../packages/core-api/src/adapters';
import {
  EventLifecycleService,
  type FinishedSportEventSettlement,
} from '../../../packages/core-api/src/modules/events/event-lifecycle-service';
import { cleanupTestData, getAppPrisma, getPrisma, integrationBackgroundJobs, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { createSportEventRow } from '../../support/sport-event-rows';
import { freshEventEdition } from '../../support/event-edition';
import { fakeLogger } from '../../support/fake-logger';

// Two server tasks (prod runs two) can each try the same status change at once (#1159). Only
// one write may win, and only the winner may run the side effects, settlement above all.
// Real Postgres: the race is between two reads and two writes, which a fake cannot interleave.

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

/**
 * A lifecycle service over the real event and job tables. Its settlement is never run: what is
 * counted is the settle jobs the status change writes (#1448), each of which would settle once.
 */
function lifecycleCountingSettlements() {
  const settlement: FinishedSportEventSettlement = {
    settleFinishedSportEvent: async () => undefined,
    settleFinishedGame: async () => undefined,
  };
  const service = new EventLifecycleService(
    {
      contests: new PrismaContestRepository(getAppPrisma()),
      configurations: new PrismaContestConfigurationRepository(getAppPrisma()),
      matches: new PrismaSportEventMatchRepository(getAppPrisma()),
    },
    new PrismaSportEventRepository(getAppPrisma()),
    fakeLogger(),
    integrationBackgroundJobs().queue,
    settlement,
  );
  const settleJobs = async () => (await getPrisma().backgroundJob.findMany({
    where: { type: BackgroundJobType.SETTLE_SPORT_EVENT_CONTESTS },
    select: { payload: true },
  })).map(({ payload }) => (payload as { sportEventId: string }).sportEventId);
  return { service, settleJobs };
}

async function createInProgressEvent() {
  return createSportEventRow(new PrismaSportEventRepository(getAppPrisma()), {
    ...(await freshEventEdition(getPrisma())),
    externalId: `race-${randomUUID()}`,
    providerId: 'integration-test',
    sport: Sport.GOLF,
    name: 'Race Open',
    startDate: new Date('2026-06-04T12:00:00.000Z'),
    endDate: new Date('2026-06-07T12:00:00.000Z'),
    status: SportEventStatus.IN_PROGRESS,
    rounds: 4,
    syncScope: 'NONE',
    autoLifecycleEnabled: true,
  });
}

describe('a sport event status change made by two callers at once', () => {
  it('queues one job to settle the event when two callers complete it at the same moment', async () => {
    const event = await createInProgressEvent();
    const { service, settleJobs } = lifecycleCountingSettlements();
    const complete = () => service.applySportEventStatusTransition({
      sportEventId: event.id,
      toStatus: SportEventStatus.COMPLETED,
      actor: { type: 'SYSTEM' },
    });

    await Promise.all([complete(), complete()]);

    await expect(settleJobs()).resolves.toEqual([event.id]);
    expect((await getPrisma().sportEvent.findUniqueOrThrow({ where: { id: event.id } })).status).toBe('COMPLETED');
  });

  it('queues no second settle job when the scheduler completes the event after an admin already has', async () => {
    const event = await createInProgressEvent();
    const { service, settleJobs } = lifecycleCountingSettlements();
    await service.applySportEventStatusTransition({
      sportEventId: event.id,
      toStatus: SportEventStatus.COMPLETED,
      actor: { type: 'ROOT_ADMIN' },
    });

    // The scheduler read the event as IN_PROGRESS before the admin's change landed.
    await service.applySportEventStatusTransition({
      sportEventId: event.id,
      toStatus: SportEventStatus.COMPLETED,
      actor: { type: 'SYSTEM' },
      fromStatus: SportEventStatus.IN_PROGRESS,
    });

    await expect(settleJobs()).resolves.toEqual([event.id]);
  });
});
