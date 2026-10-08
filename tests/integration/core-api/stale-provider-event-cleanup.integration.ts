import {
  cleanupTestData,
  createTestUser,
  getApp,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';
import { freshEventEdition } from '../../support/event-edition';

describe('the stale provider event cleanup is retired (ADR-0009: every event is admin-made)', () => {
  beforeAll(async () => {
    await setupIntegrationTests();
  });

  afterAll(async () => {
    await cleanupTestData();
    await teardownIntegrationTests();
  });

  it('answers 404 for the old cleanup route and deletes no event, even a past golf event with no contests', async () => {
    const prisma = getPrisma();
    const rootAdmin = await createTestUser({ displayName: 'Retired Cleanup Root Admin', isRootAdmin: true });
    const event = await prisma.sportEvent.create({
      data: {
        ...(await freshEventEdition(prisma)),
        providerId: 'integration-test',
        externalId: `retired-cleanup-${Date.now()}`,
        sport: 'GOLF',
        name: 'Admin-Made Past Open',
        startDate: new Date('2020-04-01T12:00:00.000Z'),
        endDate: new Date('2020-04-04T20:00:00.000Z'),
        status: 'COMPLETED',
        metadata: {},
      },
    });

    const res = await getApp().inject({
      method: 'POST',
      url: '/api/v1/ingestion/stale-events/cleanup',
      headers: rootAdmin.headers,
      payload: { mode: 'EXECUTE' },
    });

    expect(res.statusCode).toBe(404);
    await expect(prisma.sportEvent.findUnique({ where: { id: event.id } })).resolves.not.toBeNull();
    await prisma.sportEvent.delete({ where: { id: event.id } });
  });
});
