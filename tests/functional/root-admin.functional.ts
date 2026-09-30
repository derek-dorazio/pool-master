import { randomUUID } from 'node:crypto';
import {
  deleteUser,
  disableUser,
  enableUser,
  adminGetIngestionSchedule,
  adminGetPollIntervals,
  adminPrepareSportSync,
  setUserRootAdmin,
  listContestConfigTemplates,
  adminListProviderSyncRuns,
  adminReIngestEvent,
  resetUserPassword,
  adminResetSportIngestionOverride,
  adminTriggerHealthCheck,
  getUser,
  listUsers,
  adminUpdateContestConfigTemplate,
  adminUpdateIngestionSchedule,
  adminUpdatePollIntervals,
  deleteLeague,
  inactivateLeague,
  listLeagues,
  loginUser,
  registerUser,
} from '@poolmaster/shared/generated/hey-api';
import { buildLeagueWithCommissioner, buildRegisteredUser, promoteToRootAdmin } from './builders';
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

/**
 * Promotes a user AND re-issues their session.
 *
 * #202 step 3.4 — the user routes take the actor from the authenticated request, so
 * `isRootAdmin` comes off the access-token claim. A promotion written straight to the database
 * therefore does not take effect until the next token is issued. That is the real contract of
 * `/api/v1/users/*`, and it is a change: the old `/api/v1/admin/*` prefix sat behind
 * `adminAuth`, which re-read the user row on every request (#195), so a mid-session promotion
 * appeared to take effect immediately.
 *
 * The context is mutated in place so the existing call sites keep using `user.client`.
 */
describe('SDK Functional: Root Admin', () => {
  it('rejects non-root-admin users from root-admin SDK flows', async () => {
    const user = await buildRegisteredUser({
      displayName: 'Root Admin Denial User',
    });

    const response = await listUsers({
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

    // #202 — the unscoped league list is a SCOPE on `listLeagues`, not a separate admin
    // route, so the refusal comes from the scope rather than from the route's existence. Same
    // access rule (A1), same 403, different code.
    const leagueResponse = await listLeagues({
      client: user.client,
      query: { scope: 'all' },
    });

    expectFunctionalError(leagueResponse, {
      status: 403,
      code: 'LEAGUE_SCOPE_FORBIDDEN',
    });

    const prepareSyncResponse = await adminPrepareSportSync({
      client: user.client,
      path: {
        sport: 'GOLF',
      },
      body: {
        feeds: ['EVENTSCHEDULE', 'PARTICIPANTRANKINGS'],
      },
    });

    expectFunctionalError(prepareSyncResponse, {
      status: 403,
      code: 'ROOT_ADMIN_ACCESS_REQUIRED',
    });

    const roleResponse = await setUserRootAdmin({
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

  it('pool-master-rop.68.1.2 allows a promoted root-admin user to read root-admin service data', async () => {
    const user = await buildRegisteredUser({
      displayName: 'Root Admin Service User',
    });
    await promoteToRootAdmin(user);

    const usersResponse = await listUsers({
      client: user.client,
    });
    expect(usersResponse.data?.users.some((item) => item.id === user.userId)).toBe(true);

    const detailResponse = await getUser({
      client: user.client,
      path: {
        userId: user.userId,
      },
    });
    // #202 step 3.4 — `{ user }`, the same envelope getCurrentUser uses, and no
    // `viewerAuthority` block (A8).
    expect(detailResponse.data?.user.id).toBe(user.userId);
    expect(detailResponse.data?.user.email).toBe(user.email);
  });

  it('returns stable not-found codes for root-admin user detail reads', async () => {
    const user = await buildRegisteredUser({
      displayName: 'Root Admin Detail User',
    });
    await promoteToRootAdmin(user);

    const response = await getUser({
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

  it('allows a root admin to promote and demote another user, and demotion revokes their sessions', async () => {
    const rootAdmin = await buildRegisteredUser({
      displayName: 'Root Admin Role Manager',
    });
    await promoteToRootAdmin(rootAdmin);

    const targetUser = await buildRegisteredUser({
      displayName: 'Root Admin Role Target',
    });

    const promoteResponse = await setUserRootAdmin({
      client: rootAdmin.client,
      path: {
        userId: targetUser.userId,
      },
      body: {
        isRootAdmin: true,
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

    const demoteResponse = await setUserRootAdmin({
      client: rootAdmin.client,
      path: {
        userId: targetUser.userId,
      },
      body: {
        isRootAdmin: false,
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
  });

  it('allows a root admin to reset another user password and delete an inactive account', async () => {
    const rootAdmin = await buildRegisteredUser({
      displayName: 'Root Admin Password Reset',
    });
    await promoteToRootAdmin(rootAdmin);

    const targetUser = await buildRegisteredUser({
      displayName: 'Root Admin Password Target',
      password: 'OriginalPass123!',
    });

    const resetResponse = await resetUserPassword({
      client: rootAdmin.client,
      path: {
        userId: targetUser.userId,
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

    const disableResponse = await disableUser({
      client: rootAdmin.client,
      path: {
        userId: targetUser.userId,
      },
    });
    // #202 step 3.4 — 200 with the user, not 204. The admin half used to return no content
    // while the self-service half returned the account; one operation, one response shape.
    expect(disableResponse.response.status).toBe(200);
    expect(disableResponse.data?.user.isActive).toBe(false);

    const enableResponse = await enableUser({
      client: rootAdmin.client,
      path: {
        userId: targetUser.userId,
      },
    });
    expect(enableResponse.response.status).toBe(200);
    expect(enableResponse.data?.user.isActive).toBe(true);

    await getFunctionalPrisma().user.update({
      where: { id: targetUser.userId },
      data: { isActive: false },
    });

    const deleteResponse = await deleteUser({
      client: rootAdmin.client,
      path: {
        userId: targetUser.userId,
      },
      body: {
        email: targetUser.email,
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
    await promoteToRootAdmin(user);
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
    await promoteToRootAdmin(user);

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
    await promoteToRootAdmin(user);

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
    await promoteToRootAdmin(rootAdmin);

    const { league } = await buildLeagueWithCommissioner({
      leagueName: 'Root Admin Search League',
    });

    // #202 — one league list, one inactivate, one delete. These were `adminListLeagues`,
    // `adminInactivateLeague` and `adminDeleteLeague`; the league routes always served root
    // admins, so the duplicates added only an audit entry, and #255 deleted the audit feature.
    const listResponse = await listLeagues({
      client: rootAdmin.client,
      query: {
        scope: 'all',
        search: 'Search League',
      },
    });

    expect(listResponse.data?.leagues.some((item) => item.id === league.id)).toBe(true);
    // A root admin listing leagues they do not belong to has no memberships among them, and
    // the response says so rather than inventing a relationship (A8).
    expect(listResponse.data?.memberships).toEqual([]);

    const inactivateResponse = await inactivateLeague({
      client: rootAdmin.client,
      path: {
        id: league.id,
      },
    });

    expect(inactivateResponse.data?.league.id).toBe(league.id);
    expect(inactivateResponse.data?.league.isActive).toBe(false);

    const deleteResponse = await deleteLeague({
      client: rootAdmin.client,
      path: {
        id: league.id,
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
    await promoteToRootAdmin(user);

    const listResponse = await listContestConfigTemplates({
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

    // #245 / A11 — templates are global: any signed-in user reads them, only a root admin writes.
    const plainUser = await buildRegisteredUser({
      displayName: 'Contest Template Reader',
    });
    const plainListResponse = await listContestConfigTemplates({
      client: plainUser.client,
      query: {
        sport: 'GOLF',
      },
    });
    expect(plainListResponse.data?.templates.map((entry) => entry.id)).toContain(template.id);
    const plainUpdateResponse = await adminUpdateContestConfigTemplate({
      client: plainUser.client,
      path: {
        templateId: template.id,
      },
      body: {
        description: 'A plain user may not write a global template.',
      },
    });
    expect(plainUpdateResponse.response.status).toBe(403);

    try {
      const updateResponse = await adminUpdateContestConfigTemplate({
        client: user.client,
        path: {
          templateId: template.id,
        },
        body: {
          description: 'Updated from functional root-admin coverage.',
          configuration: {
            ...template.configuration,
            countedScores: 5,
          },
        },
      });

      expect(updateResponse.data?.template.description).toBe('Updated from functional root-admin coverage.');
      expect(updateResponse.data?.template.configuration.countedScores).toBe(5);
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
