import { randomUUID } from 'node:crypto';
import {
  adminGetIngestionSchedule,
  adminGetPollIntervals,
  adminPrepareSportSync,
  adminListContestConfigTemplates,
  adminListProviderSyncRuns,
  adminReIngestEvent,
  adminResetSportIngestionOverride,
  adminTriggerHealthCheck,
  adminGetUserDetail,
  adminListUsers,
  adminUpdateContestConfigTemplate,
  adminUpdateIngestionSchedule,
  adminUpdatePollIntervals,
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
      body: {
        feeds: ['EVENTSCHEDULE', 'EVENTPARTICIPANTS', 'PARTICIPANTRANKINGS'],
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
            runType: 'EVENT_SCHEDULE_SYNC',
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
      body: {
        feeds: ['EVENTSCHEDULE'],
      },
    });

    expectFunctionalError(prepareSyncResponse, {
      status: 404,
      code: 'SPORT_PROVIDER_NOT_FOUND',
    });
  });

  it('allows a promoted root-admin user to update persisted system configuration', async () => {
    const user = await buildRegisteredUser({
      displayName: 'Root Admin Config User',
    });
    await promoteToRootAdmin(user.userId);

    const pollResponse = await adminUpdatePollIntervals({
      client: user.client,
      body: {
        standings: 15000,
      },
    });
    expect(pollResponse.data?.standings).toBe(15000);

    const pollRead = await adminGetPollIntervals({
      client: user.client,
    });
    expect(pollRead.data?.standings).toBe(15000);

    const ingestionUpdate = await adminUpdateIngestionSchedule({
      client: user.client,
      body: {
        eventLiveScores: {
          intervalSeconds: 45,
        },
      },
    });
    expect(ingestionUpdate.data?.eventLiveScores.intervalSeconds).toBe(45);

    const ingestionRead = await adminGetIngestionSchedule({
      client: user.client,
    });
    expect(ingestionRead.data?.eventLiveScores.intervalSeconds).toBe(45);

    const resetSportOverride = await adminResetSportIngestionOverride({
      client: user.client,
      path: {
        sport: 'GOLF',
      },
    });
    expect(resetSportOverride.data?.perSportOverrides.GOLF).toBeUndefined();
  });

  it('allows a promoted root-admin user to manage persisted contest templates', async () => {
    const user = await buildRegisteredUser({
      displayName: 'Root Admin Contest Template User',
    });
    await promoteToRootAdmin(user.userId);

    const listResponse = await adminListContestConfigTemplates({
      client: user.client,
      query: {
        sport: 'GOLF',
      },
    });

    const template = listResponse.data?.templates[0];
    expect(template).toBeDefined();
    if (!template) {
      throw new Error('Expected at least one contest template');
    }
    const originalTemplate = structuredClone(template);

    try {
      const updateResponse = await adminUpdateContestConfigTemplate({
        client: user.client,
        path: {
          templateId: template.id,
        },
        body: {
          description: 'Updated from functional root-admin coverage.',
          configuration: template.configuration.mode === 'GOLF_TIERED'
            ? {
                ...template.configuration,
                countedScores: 5,
              }
            : template.configuration,
        },
      });

      expect(updateResponse.data?.template.description).toBe('Updated from functional root-admin coverage.');
      if (updateResponse.data?.template.configuration.mode !== 'GOLF_TIERED') {
        throw new Error('Expected tiered contest template');
      }
      expect(updateResponse.data.template.configuration.countedScores).toBe(5);
    } finally {
      await getFunctionalPrisma().contestConfigTemplate.update({
        where: { id: template.id },
        data: {
          name: originalTemplate.name,
          description: originalTemplate.description,
          sortOrder: originalTemplate.sortOrder,
          isDefault: originalTemplate.isDefault,
          active: originalTemplate.active,
          configJson: originalTemplate.configuration,
        },
      });
    }
  });
});
