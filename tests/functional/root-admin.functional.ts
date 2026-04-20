import { randomUUID } from 'node:crypto';
import {
  adminPrepareSportSync,
  adminListProviderSyncRuns,
  adminReIngestEvent,
  adminTriggerHealthCheck,
  adminGetUserDetail,
  adminListUsers,
} from '@poolmaster/shared/generated/hey-api';
import { buildRegisteredUser } from './builders';
import {
  cleanupFunctionalData,
  disconnectFunctionalPrisma,
  expectFunctionalError,
  getFunctionalPrisma,
} from './setup';

afterEach(async () => {
  await cleanupFunctionalData();
});

afterAll(async () => {
  await disconnectFunctionalPrisma();
});

async function promoteToRootAdmin(userId: string): Promise<void> {
  await getFunctionalPrisma().user.update({
    where: { id: userId },
    data: { isRootAdmin: true },
  });
}

describe('SDK Functional: Root Admin', () => {
  it('rejects non-root-admin users from root-admin SDK flows', async () => {
    const user = await buildRegisteredUser({
      displayName: 'Root Admin Denial User',
    });

    const response = await adminListUsers({
      client: user.client,
    });

    expectFunctionalError(response, {
      status: 403,
      code: 'ROOT_ADMIN_ACCESS_REQUIRED',
    });

    const providerResponse = await adminListProviderSyncRuns({
      client: user.client,
    });

    expectFunctionalError(providerResponse, {
      status: 403,
      code: 'ROOT_ADMIN_ACCESS_REQUIRED',
    });

    const prepareSyncResponse = await adminPrepareSportSync({
      client: user.client,
      path: {
        sport: 'GOLF',
      },
    });

    expectFunctionalError(prepareSyncResponse, {
      status: 403,
      code: 'ROOT_ADMIN_ACCESS_REQUIRED',
    });
  });

  it('allows a promoted root-admin user to read root-admin service data', async () => {
    const user = await buildRegisteredUser({
      displayName: 'Root Admin Service User',
    });
    await promoteToRootAdmin(user.userId);

    const usersResponse = await adminListUsers({
      client: user.client,
    });
    expect(usersResponse.data?.items.some((item) => item.id === user.userId)).toBe(true);

    const detailResponse = await adminGetUserDetail({
      client: user.client,
      path: {
        userId: user.userId,
      },
    });
    expect(detailResponse.data?.id).toBe(user.userId);
  });

  it('returns stable not-found codes for root-admin user detail reads', async () => {
    const user = await buildRegisteredUser({
      displayName: 'Root Admin Detail User',
    });
    await promoteToRootAdmin(user.userId);

    const response = await adminGetUserDetail({
      client: user.client,
      path: {
        userId: '00000000-0000-0000-0000-000000000000',
      },
    });

    expectFunctionalError(response, {
      status: 404,
      code: 'USER_NOT_FOUND',
    });
  });

  it('allows a promoted root-admin user to inspect persisted provider sync run history', async () => {
    const user = await buildRegisteredUser({
      displayName: 'Root Admin Sync History User',
    });
    await promoteToRootAdmin(user.userId);
    const providerId = `functional-provider-${randomUUID()}`;

    await getFunctionalPrisma().providerSyncRun.createMany({
      data: [
        {
          id: randomUUID(),
          providerId,
          sport: 'GOLF',
          eventId: 'masters-2026',
          status: 'COMPLETED',
          startedAt: new Date('2026-04-09T10:00:00.000Z'),
          completedAt: new Date('2026-04-09T10:01:00.000Z'),
          payloadJson: {
            runType: 'EVENT_SYNC',
            detail: 'Imported event and field snapshot.',
          },
        },
        {
          id: randomUUID(),
          providerId,
          sport: 'GOLF',
          eventId: null,
          status: 'FAILED',
          startedAt: new Date('2026-04-08T10:00:00.000Z'),
          completedAt: new Date('2026-04-08T10:00:30.000Z'),
          payloadJson: {
            runType: 'SCHEDULE_SYNC',
            detail: 'Transient timeout.',
          },
        },
      ],
    });

    const response = await adminListProviderSyncRuns({
      client: user.client,
      query: {
        providerId,
        sport: 'GOLF',
        status: 'COMPLETED',
        limit: 10,
      },
    });

    expect(response.data?.items).toHaveLength(1);
    expect(response.data?.items[0]?.providerId).toBe(providerId);
    expect(response.data?.items[0]?.payload.detail).toBe('Imported event and field snapshot.');
  });

  it('returns stable provider not-found codes for root-admin operational actions', async () => {
    const user = await buildRegisteredUser({
      displayName: 'Root Admin Provider Error User',
    });
    await promoteToRootAdmin(user.userId);

    const healthCheckResponse = await adminTriggerHealthCheck({
      client: user.client,
      path: {
        providerId: 'missing-provider',
      },
    });

    expectFunctionalError(healthCheckResponse, {
      status: 404,
      code: 'PROVIDER_NOT_FOUND',
    });

    const reIngestResponse = await adminReIngestEvent({
      client: user.client,
      path: {
        providerId: 'missing-provider',
        eventId: 'missing-event',
      },
    });

    expectFunctionalError(reIngestResponse, {
      status: 404,
      code: 'PROVIDER_NOT_FOUND',
    });

    const prepareSyncResponse = await adminPrepareSportSync({
      client: user.client,
      path: {
        sport: 'UFC',
      },
    });

    expectFunctionalError(prepareSyncResponse, {
      status: 404,
      code: 'SPORT_PROVIDER_NOT_FOUND',
    });
  });
});
