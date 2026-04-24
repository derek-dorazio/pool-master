import { randomUUID } from 'node:crypto';
import {
  adminDeleteUser,
  adminDeleteLeague,
  adminDisableUser,
  adminEnableUser,
  adminGetIngestionSchedule,
  adminGetPollIntervals,
  adminInactivateLeague,
  adminListLeagues,
  adminPrepareSportSync,
  adminSetUserRootAdmin,
  adminListContestConfigTemplates,
  adminListProviderSyncRuns,
  adminReIngestEvent,
  adminResetUserPassword,
  adminResetSportIngestionOverride,
  adminTriggerHealthCheck,
  adminGetUserDetail,
  adminListUsers,
  adminUpdateContestConfigTemplate,
  adminUpdateIngestionSchedule,
  adminUpdatePollIntervals,
  loginUser,
  registerUser,
} from '@poolmaster/shared/generated/hey-api';
import { buildLeagueWithCommissioner, buildRegisteredUser } from './builders';
import {
  cleanupFunctionalData,
  createFunctionalEmail,
  disconnectFunctionalPrisma,
  expectFunctionalError,
  getFunctionalPrisma,
  getSdkClient,
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

    const leagueResponse = await adminListLeagues({
      client: user.client,
    });

    expectFunctionalError(leagueResponse, {
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

    const roleResponse = await adminSetUserRootAdmin({
      client: user.client,
      path: {
        userId: user.userId,
      },
      body: {
        isRootAdmin: true,
      },
    });

    expectFunctionalError(roleResponse, {
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
    expect(detailResponse.data?.viewerAuthority).toEqual({
      self: true,
      rootAdmin: true,
      viewer: false,
    });
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

  it('allows a root admin to promote and demote another user with audit coverage', async () => {
    const rootAdmin = await buildRegisteredUser({
      displayName: 'Root Admin Role Manager',
    });
    await promoteToRootAdmin(rootAdmin.userId);

    const targetUser = await buildRegisteredUser({
      displayName: 'Root Admin Role Target',
    });

    const promoteResponse = await adminSetUserRootAdmin({
      client: rootAdmin.client,
      path: {
        userId: targetUser.userId,
      },
      body: {
        isRootAdmin: true,
        reason: 'Add backup operator',
      },
    });

    expect(promoteResponse.data?.success).toBe(true);
    await expect(
      getFunctionalPrisma().user.findUniqueOrThrow({
        where: { id: targetUser.userId },
      }),
    ).resolves.toMatchObject({
      isRootAdmin: true,
    });

    const demoteResponse = await adminSetUserRootAdmin({
      client: rootAdmin.client,
      path: {
        userId: targetUser.userId,
      },
      body: {
        isRootAdmin: false,
        reason: 'Remove temporary access',
      },
    });

    expect(demoteResponse.data?.success).toBe(true);
    await expect(
      getFunctionalPrisma().user.findUniqueOrThrow({
        where: { id: targetUser.userId },
      }),
    ).resolves.toMatchObject({
      isRootAdmin: false,
    });

    const refreshTokens = await getFunctionalPrisma().refreshToken.findMany({
      where: { userId: targetUser.userId },
      select: { revokedAt: true },
    });
    expect(refreshTokens.length).toBeGreaterThan(0);
    expect(refreshTokens.every((token) => token.revokedAt instanceof Date)).toBe(true);

    const auditEntries = await getFunctionalPrisma().adminAuditEntry.findMany({
      where: {
        actorId: rootAdmin.userId,
        action: 'user.set_root_admin',
        resourceId: targetUser.userId,
      },
      orderBy: {
        createdAt: 'asc',
      },
      select: {
        reason: true,
        beforeState: true,
        afterState: true,
      },
    });
    expect(auditEntries).toHaveLength(2);
    expect(auditEntries[0]).toMatchObject({
      reason: 'Add backup operator',
      beforeState: { isRootAdmin: false },
      afterState: { isRootAdmin: true },
    });
    expect(auditEntries[1]).toMatchObject({
      reason: 'Remove temporary access',
      beforeState: { isRootAdmin: true },
      afterState: { isRootAdmin: false },
    });
  });

  it('rejects self-demotion for root-admin users', async () => {
    const rootAdmin = await buildRegisteredUser({
      displayName: 'Root Admin Self Demote',
    });
    await promoteToRootAdmin(rootAdmin.userId);

    const response = await adminSetUserRootAdmin({
      client: rootAdmin.client,
      path: {
        userId: rootAdmin.userId,
      },
      body: {
        isRootAdmin: false,
      },
    });

    expectFunctionalError(response, {
      status: 400,
      code: 'SELF_ROOT_ADMIN_CHANGE',
    });
  });

  it('allows a root admin to reset another user password and delete an inactive account', async () => {
    const rootAdmin = await buildRegisteredUser({
      displayName: 'Root Admin Password Reset',
    });
    await promoteToRootAdmin(rootAdmin.userId);

    const targetUser = await buildRegisteredUser({
      displayName: 'Root Admin Password Target',
      password: 'OriginalPass123!',
    });

    const resetResponse = await adminResetUserPassword({
      client: rootAdmin.client,
      path: {
        userId: targetUser.userId,
      },
      body: {
        reason: 'Support reset',
      },
    });

    expect(typeof resetResponse.data?.temporaryPassword).toBe('string');

    const reloginResponse = await loginUser({
      client: getSdkClient(),
      body: {
        identifier: targetUser.username,
        password: resetResponse.data?.temporaryPassword ?? '',
      },
    });
    expect(reloginResponse.data?.user.id).toBe(targetUser.userId);

    const disableResponse = await adminDisableUser({
      client: rootAdmin.client,
      path: {
        userId: targetUser.userId,
      },
      body: {
        reason: 'Cleanup path',
      },
    });
    expect(disableResponse.response.status).toBe(204);

    const enableResponse = await adminEnableUser({
      client: rootAdmin.client,
      path: {
        userId: targetUser.userId,
      },
    });
    expect(enableResponse.response.status).toBe(204);

    await getFunctionalPrisma().user.update({
      where: { id: targetUser.userId },
      data: { isActive: false },
    });

    const deleteResponse = await adminDeleteUser({
      client: rootAdmin.client,
      path: {
        userId: targetUser.userId,
      },
      body: {
        email: targetUser.email,
        reason: 'Cleanup path',
      },
    });

    expect(deleteResponse.data?.success).toBe(true);
    await expect(
      getFunctionalPrisma().user.findUnique({
        where: { id: targetUser.userId },
      }),
    ).resolves.toBeNull();
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

  it('allows a promoted root-admin user to search, inactivate, and delete leagues', async () => {
    const rootAdmin = await buildRegisteredUser({
      displayName: 'Root Admin League User',
    });
    await promoteToRootAdmin(rootAdmin.userId);

    const { league } = await buildLeagueWithCommissioner({
      leagueName: 'Root Admin Search League',
    });

    const listResponse = await adminListLeagues({
      client: rootAdmin.client,
      query: {
        search: 'Search League',
        limit: 25,
      },
    });

    expect(listResponse.data?.leagues.some((item) => item.id === league.id)).toBe(true);

    const inactivateResponse = await adminInactivateLeague({
      client: rootAdmin.client,
      path: {
        leagueId: league.id,
      },
    });

    expect(inactivateResponse.data?.league.id).toBe(league.id);
    expect(inactivateResponse.data?.league.isActive).toBe(false);

    const deleteResponse = await adminDeleteLeague({
      client: rootAdmin.client,
      path: {
        leagueId: league.id,
      },
      body: {
        leagueCode: league.leagueCode,
      },
    });

    expect(deleteResponse.data?.success).toBe(true);
    expect(await getFunctionalPrisma().league.findUnique({ where: { id: league.id } })).toBeNull();
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

  it('ignores isRootAdmin in registration payloads', async () => {
    const email = createFunctionalEmail('register-root-admin');
    const username = `register-${Date.now().toString(36)}`;

    const response = await registerUser({
      client: getSdkClient(),
      body: {
        username,
        email,
        password: 'FuncTest123!',
        firstName: 'Registration',
        lastName: 'Probe',
        isRootAdmin: true,
      } as any,
    });

    expect(response.data?.user.isRootAdmin).toBe(false);

    const storedUser = await getFunctionalPrisma().user.findUniqueOrThrow({
      where: { email },
      select: { isRootAdmin: true },
    });
    expect(storedUser.isRootAdmin).toBe(false);
  });
});
