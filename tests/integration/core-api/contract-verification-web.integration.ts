import {
  buildContestEligibleEventTiming,
  buildCreateLeaguePayload,
  cleanupTestData,
  createTestUser,
  getApp,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
  withoutJsonBodyHeaders,
} from '../helpers';
import { API_ROUTES } from '@poolmaster/shared/api-routes';
import {
  AccountPasswordChangeResponseSchema,
  AccountDeleteResponseSchema,
  AccountResponseSchema,
  AuthResponseSchema,
  ContestConfigTemplateListResponseSchema,
  ConsentHistoryResponseSchema,
  ContestManagementResponseSchema,
  ConsentRecordResponseSchema,
  DraftStateResponseSchema,
  ErrorEnvelopeSchema,
  EventListResponseSchema,
  GenerateInviteLinkResponseSchema,
  LeagueDashboardResponseSchema,
  LeagueResponseSchema,
  MeResponseSchema,
  ScoringConfigValidationResponseSchema,
  SendLeagueInvitationsResponseSchema,
  SquadListResponseSchema,
  SquadResponseSchema,
  SuccessSchema,
  TokenRefreshResponseSchema,
} from '@poolmaster/shared/dto';
import {
  ContestType,
  ScoringEngine,
  SelectionType,
  Sport,
} from '@poolmaster/shared/domain';
import { randomUUID } from 'node:crypto';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

describe('Contract verification (web)', () => {
  it('auth happy-path routes match the shared auth response DTOs', async () => {
    const uniqueSuffix = randomUUID().slice(0, 8);
    const email = `contract-auth-${uniqueSuffix}@integration.test`;
    const username = `contractauth${uniqueSuffix}`;
    const password = 'ContractAuth123!';

    const registerRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.auth.register,
      payload: {
        username,
        email,
        password,
        firstName: 'Contract',
        lastName: 'Auth',
      },
    });

    expect(registerRes.statusCode).toBe(201);
    expect(AuthResponseSchema.safeParse(registerRes.json()).success).toBe(true);

    const sessionCookie = registerRes.headers['set-cookie'];
    const cookieHeader = Array.isArray(sessionCookie)
      ? sessionCookie.map((value) => value.split(';')[0]).join('; ')
      : sessionCookie?.split(';')[0] ?? '';

    const meRes = await getApp().inject({
      method: 'GET',
      url: API_ROUTES.auth.me,
      headers: {
        cookie: cookieHeader,
      },
    });

    expect(meRes.statusCode).toBe(200);
    expect(MeResponseSchema.safeParse(meRes.json()).success).toBe(true);

    const refreshRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.auth.refresh,
      headers: {
        cookie: cookieHeader,
      },
    });

    expect(refreshRes.statusCode).toBe(200);
    expect(TokenRefreshResponseSchema.safeParse(refreshRes.json()).success).toBe(true);
  });

  it('auth routes expose the shared error envelope on negative responses', async () => {
    const loginRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.auth.login,
      payload: {
        identifier: 'missing-user@integration.test',
        password: 'WrongPassword123',
      },
    });

    expect(loginRes.statusCode).toBe(401);
    expect(ErrorEnvelopeSchema.safeParse(loginRes.json()).success).toBe(true);

    const meRes = await getApp().inject({
      method: 'GET',
      url: API_ROUTES.auth.me,
    });

    expect(meRes.statusCode).toBe(401);
    expect(ErrorEnvelopeSchema.safeParse(meRes.json()).success).toBe(true);
  });

  it('POST /api/v1/leagues matches LeagueResponseSchema', async () => {
    const owner = await createTestUser({ displayName: 'Contract League Owner' });

    const res = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.create,
      headers: owner.headers,
      payload: buildCreateLeaguePayload('Contract League'),
    });

    expect(res.statusCode).toBe(201);
    const parsed = LeagueResponseSchema.safeParse(res.json());
    expect(parsed.success).toBe(true);
  });

  it('league invitation and dashboard routes match their response DTOs', async () => {
    const owner = await createTestUser({ displayName: 'Contract Dashboard Owner' });

    const leagueRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.create,
      headers: owner.headers,
      payload: buildCreateLeaguePayload('Contract Dashboard League'),
    });
    const leagueId = leagueRes.json().league.id as string;

    const invitationRes = await getApp().inject({
      method: 'POST',
      url: `/api/v1/leagues/${leagueId}/invitations`,
      headers: owner.headers,
      payload: {
        emails: [`contract-${randomUUID().slice(0, 8)}@integration.test`],
      },
    });
    expect(invitationRes.statusCode).toBe(201);
    expect(
      SendLeagueInvitationsResponseSchema.safeParse(invitationRes.json()).success,
    ).toBe(true);

    const inviteLinkRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.inviteLink(leagueId),
      headers: owner.headers,
      payload: {
        expiresInDays: 7,
        maxUses: 3,
      },
    });
    expect(inviteLinkRes.statusCode).toBe(201);
    expect(
      GenerateInviteLinkResponseSchema.safeParse(inviteLinkRes.json()).success,
    ).toBe(true);

    const dashboardRes = await getApp().inject({
      method: 'GET',
      url: `${API_ROUTES.leagues.detail(leagueId)}/dashboard`,
      headers: owner.headers,
    });
    expect(dashboardRes.statusCode).toBe(200);
    expect(
      LeagueDashboardResponseSchema.safeParse(dashboardRes.json()).success,
    ).toBe(true);
  });

  it('league lifecycle routes match the shared response DTOs', async () => {
    const owner = await createTestUser({ displayName: 'Contract Lifecycle Owner' });

    const leagueRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.create,
      headers: owner.headers,
      payload: buildCreateLeaguePayload('Contract Lifecycle League'),
    });
    const leagueId = leagueRes.json().league.id as string;
    const leagueCode = leagueRes.json().league.leagueCode as string;

    const inactivateRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.inactivate(leagueId),
      headers: withoutJsonBodyHeaders(owner.headers),
    });

    expect(inactivateRes.statusCode).toBe(200);
    expect(LeagueResponseSchema.safeParse(inactivateRes.json()).success).toBe(true);

    const activateRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.activate(leagueId),
      headers: withoutJsonBodyHeaders(owner.headers),
    });

    expect(activateRes.statusCode).toBe(200);
    expect(LeagueResponseSchema.safeParse(activateRes.json()).success).toBe(true);

    const reinactivateRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.inactivate(leagueId),
      headers: withoutJsonBodyHeaders(owner.headers),
    });

    expect(reinactivateRes.statusCode).toBe(200);
    expect(LeagueResponseSchema.safeParse(reinactivateRes.json()).success).toBe(true);

    const deleteRes = await getApp().inject({
      method: 'DELETE',
      url: API_ROUTES.leagues.detail(leagueId),
      headers: owner.headers,
      payload: {
        leagueCode,
      },
    });

    expect(deleteRes.statusCode).toBe(200);
    expect(SuccessSchema.safeParse(deleteRes.json()).success).toBe(true);
  });

  it('event list route matches EventListResponseSchema on the happy path', async () => {
    const prisma = getPrisma();
    const eventId = randomUUID();
    const participantId = randomUUID();
    const sportId = randomUUID();
    const viewer = await createTestUser({ displayName: 'Contract Events Viewer' });

    await prisma.sport.create({
      data: {
        id: sportId,
        name: Sport.UFC,
        participantType: 'INDIVIDUAL',
        statSchema: {},
      },
    });
    await prisma.sportEvent.create({
      data: {
        id: eventId,
        providerId: 'contract-events-provider',
        externalId: `contract-event-${eventId}`,
        sport: Sport.UFC,
        name: 'Contract Events Major',
        startDate: new Date('2026-05-20T15:00:00.000Z'),
        endDate: new Date('2026-05-23T23:00:00.000Z'),
        releaseAt: new Date('2026-04-17T12:00:00.000Z'),
        fieldLocksAt: new Date('2026-05-19T12:00:00.000Z'),
        status: 'SCHEDULED',
        participantCount: 144,
        fieldLocked: false,
        metadata: {},
      },
    });
    await prisma.participant.create({
      data: {
        id: participantId,
        sport: {
          connect: {
            name: Sport.UFC,
          },
        },
        participantType: 'INDIVIDUAL',
        firstName: 'Scottie',
        lastName: 'Scheffler',
        name: 'Scottie Scheffler',
      },
    });
    await prisma.sportEventParticipant.create({
      data: {
        sportEventId: eventId,
        participantId,
        status: 'ACTIVE',
      },
    });

    try {
      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/events/?sport=UFC&limit=100',
        headers: viewer.headers,
      });

      expect(res.statusCode).toBe(200);
      const parsed = EventListResponseSchema.safeParse(res.json());
      expect(parsed.success).toBe(true);
      const event = parsed.data?.events.find((item) => item.id === eventId);
      expect(event).toMatchObject({
        id: eventId,
        contestEligible: true,
        readinessStatus: 'CONTEST_ELIGIBLE',
      });
    } finally {
      await prisma.sportEventParticipant.deleteMany({ where: { sportEventId: eventId } });
      await prisma.participant.delete({ where: { id: participantId } });
      await prisma.sportEvent.delete({ where: { id: eventId } });
      await prisma.sport.delete({ where: { id: sportId } });
    }
  });

  it('event list route keeps shallow imported events pending until field detail is hydrated', async () => {
    const prisma = getPrisma();
    const eventId = randomUUID();
    const viewer = await createTestUser({ displayName: 'Contract Shallow Events Viewer' });

    await prisma.sportEvent.create({
      data: {
        id: eventId,
        providerId: 'contract-events-provider',
        externalId: `contract-shallow-event-${eventId}`,
        sport: Sport.UFC,
        name: 'Contract Shallow Event',
        startDate: new Date('2026-05-20T15:00:00.000Z'),
        endDate: new Date('2026-05-23T23:00:00.000Z'),
        releaseAt: new Date('2026-04-17T12:00:00.000Z'),
        fieldLocksAt: new Date('2026-05-19T12:00:00.000Z'),
        status: 'SCHEDULED',
        participantCount: 144,
        fieldLocked: false,
        metadata: {},
      },
    });

    try {
      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/events/?sport=UFC&limit=100',
        headers: viewer.headers,
      });

      expect(res.statusCode).toBe(200);
      const parsed = EventListResponseSchema.safeParse(res.json());
      expect(parsed.success).toBe(true);
      const event = parsed.data?.events.find((item) => item.id === eventId);
      expect(event).toMatchObject({
        id: eventId,
        contestEligible: false,
        readinessStatus: 'PENDING_FIELD',
      });
      expect(event?.readinessReasons).toContain('FIELD_NOT_LOADED');
    } finally {
      await prisma.sportEvent.delete({ where: { id: eventId } });
    }
  });

  it('league detail update route matches LeagueResponseSchema', async () => {
    const owner = await createTestUser({ displayName: 'Contract League Editor' });

    const leagueRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.create,
      headers: owner.headers,
      payload: buildCreateLeaguePayload('Editable League'),
    });
    const leagueId = leagueRes.json().league.id as string;

    const updateRes = await getApp().inject({
      method: 'PUT',
      url: API_ROUTES.leagues.details(leagueId),
      headers: owner.headers,
      payload: {
        name: 'Edited League',
        description: 'Edited description',
      },
    });

    expect(updateRes.statusCode).toBe(200);
    expect(LeagueResponseSchema.safeParse(updateRes.json()).success).toBe(true);
  });

  it('league icon update route matches LeagueResponseSchema', async () => {
    const owner = await createTestUser({ displayName: 'Contract League Icon Editor' });

    const leagueRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.create,
      headers: owner.headers,
      payload: buildCreateLeaguePayload('Icon League'),
    });
    const leagueId = leagueRes.json().league.id as string;

    const updateRes = await getApp().inject({
      method: 'PUT',
      url: API_ROUTES.leagues.icon(leagueId),
      headers: owner.headers,
      payload: {
        iconKey: 'SOCCER_BALL',
      },
    });

    expect(updateRes.statusCode).toBe(200);
    expect(LeagueResponseSchema.safeParse(updateRes.json()).success).toBe(true);
  });

  it('team lifecycle routes match Squad DTOs', async () => {
    const owner = await createTestUser({ displayName: 'Contract Team Owner' });

    const leagueRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.create,
      headers: owner.headers,
      payload: buildCreateLeaguePayload('Contract Team League'),
    });
    const leagueId = leagueRes.json().league.id as string;

    const listRes = await getApp().inject({
      method: 'GET',
      url: API_ROUTES.squads.list(leagueId),
      headers: owner.headers,
    });

    expect(listRes.statusCode).toBe(200);
    expect(SquadListResponseSchema.safeParse(listRes.json()).success).toBe(true);

    const squadId = listRes.json().squads[0].id as string;

    const inactivateRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.squads.inactivate(leagueId, squadId),
      headers: withoutJsonBodyHeaders(owner.headers),
    });

    expect(inactivateRes.statusCode).toBe(200);
    expect(SquadResponseSchema.safeParse(inactivateRes.json()).success).toBe(true);
  });

  it('contest management routes match their template-first response DTOs', async () => {
    const eventTiming = buildContestEligibleEventTiming();
    const owner = await createTestUser({ displayName: 'Contract Contest Owner' });

    const leagueRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.create,
      headers: owner.headers,
      payload: buildCreateLeaguePayload('Contract Contest League'),
    });
    const leagueId = leagueRes.json().league.id as string;
    await getPrisma().sport.upsert({
      where: {
        name: Sport.GOLF,
      },
      update: {},
      create: {
        name: Sport.GOLF,
        participantType: 'INDIVIDUAL',
        statSchema: {},
      },
    });

    const participant = await getPrisma().participant.create({
      data: {
        name: `Tiger Contract Contest ${randomUUID().slice(0, 8)}`,
        participantType: 'INDIVIDUAL',
        status: 'ACTIVE',
        sport: {
          connect: {
            name: Sport.GOLF,
          },
        },
      },
    });

    const sportEvent = await getPrisma().sportEvent.create({
      data: {
        externalId: `contract-event-${randomUUID().slice(0, 8)}`,
        providerId: 'integration-test',
        sport: Sport.GOLF,
        name: 'Contract Event',
        startDate: eventTiming.startDate,
        releaseAt: eventTiming.releaseAt,
        fieldLocksAt: eventTiming.fieldLocksAt,
        status: 'SCHEDULED',
      },
    });
    await getPrisma().sportEventParticipant.create({
      data: {
        sportEventId: sportEvent.id,
        participantId: participant.id,
        status: 'ACTIVE',
      },
    });

    const templateRes = await getApp().inject({
      method: 'GET',
      url: `${API_ROUTES.contestManagement.templates(leagueId)}?sport=GOLF&contestType=SINGLE_EVENT`,
      headers: owner.headers,
    });

    expect(templateRes.statusCode).toBe(200);
    expect(
      ContestConfigTemplateListResponseSchema.safeParse(templateRes.json()).success,
    ).toBe(true);

    const defaultTemplate = templateRes.json().templates.find(
      (template: { isDefault: boolean }) => template.isDefault,
    );
    expect(defaultTemplate).toBeDefined();

    const res = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.contestManagement(leagueId),
      headers: owner.headers,
      payload: {
        name: 'Contract Managed Contest',
        sportEventId: sportEvent.id,
        contestType: ContestType.SINGLE_EVENT,
        templateId: defaultTemplate.id,
      },
    });

    expect(res.statusCode).toBe(201);
    const parsed = ContestManagementResponseSchema.safeParse(res.json());
    expect(parsed.success).toBe(true);
  });

  it('account consent and scoring validation routes match their DTOs', async () => {
    const user = await createTestUser({ displayName: 'Contract Consent User' });

    const consentRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.account.consent,
      headers: user.headers,
      payload: {
        consentType: 'terms_of_service',
        granted: true,
        version: '2026-04',
        minimumAgeThreshold: 18,
        ageAffirmed: true,
      },
    });
    expect(consentRes.statusCode).toBe(201);
    expect(ConsentRecordResponseSchema.safeParse(consentRes.json()).success).toBe(true);

    const consentHistoryRes = await getApp().inject({
      method: 'GET',
      url: API_ROUTES.account.consent,
      headers: user.headers,
    });
    expect(consentHistoryRes.statusCode).toBe(200);
    expect(ConsentHistoryResponseSchema.safeParse(consentHistoryRes.json()).success).toBe(true);

    const scoringRes = await getApp().inject({
      method: 'POST',
      url: '/api/v1/scoring/config/validate',
      headers: user.headers,
      payload: {
        sport: 'GOLF',
        scoring_type: 'STROKE_PLAY',
        stat_rules: [],
        position_rules: [],
        bonus_rules: [],
        penalty_rules: [],
        multiplier_rules: [],
        bracket_round_rules: [],
        special_slots: [],
        dnf_handling: 'ZERO',
        counting_method: 'ALL',
        lower_is_better: true,
      },
    });
    expect(scoringRes.statusCode).toBe(200);
    expect(
      ScoringConfigValidationResponseSchema.safeParse(scoringRes.json()).success,
    ).toBe(true);
  });

  it('account lifecycle routes match their shared response DTOs', async () => {
    const user = await createTestUser({ displayName: 'Contract Account User' });

    const profileRes = await getApp().inject({
      method: 'PUT',
      url: API_ROUTES.account.profile,
      headers: user.headers,
      payload: {
        email: user.user.email,
        firstName: 'Updated',
        lastName: 'Person',
      },
    });

    expect(profileRes.statusCode).toBe(200);
    expect(AccountResponseSchema.safeParse(profileRes.json()).success).toBe(true);

    const preferencesRes = await getApp().inject({
      method: 'PUT',
      url: API_ROUTES.account.preferences,
      headers: user.headers,
      payload: {
        timezone: 'America/New_York',
        locale: 'en-US',
        timeFormat: '12H',
        dateFormat: 'MDY',
      },
    });

    expect(preferencesRes.statusCode).toBe(200);
    expect(AccountResponseSchema.safeParse(preferencesRes.json()).success).toBe(true);

    const passwordRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.account.password,
      headers: user.headers,
      payload: {
        currentPassword: 'TestPass123',
        newPassword: 'UpdatedPassword123!',
        confirmNewPassword: 'UpdatedPassword123!',
      },
    });

    expect(passwordRes.statusCode).toBe(200);
    expect(AccountPasswordChangeResponseSchema.safeParse(passwordRes.json()).success).toBe(true);

    const inactivateRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.account.inactivate,
      headers: withoutJsonBodyHeaders(user.headers),
    });

    expect(inactivateRes.statusCode).toBe(200);
    expect(AccountResponseSchema.safeParse(inactivateRes.json()).success).toBe(true);

    const reactivateRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.account.reactivate,
      headers: withoutJsonBodyHeaders(user.headers),
    });

    expect(reactivateRes.statusCode).toBe(200);
    expect(AccountResponseSchema.safeParse(reactivateRes.json()).success).toBe(true);

    const secondInactivateRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.account.inactivate,
      headers: withoutJsonBodyHeaders(user.headers),
    });

    expect(secondInactivateRes.statusCode).toBe(200);
    expect(AccountResponseSchema.safeParse(secondInactivateRes.json()).success).toBe(true);

    const deleteRes = await getApp().inject({
      method: 'DELETE',
      url: API_ROUTES.account.detail,
      headers: user.headers,
      payload: {
        email: user.user.email,
      },
    });

    expect(deleteRes.statusCode).toBe(200);
    expect(AccountDeleteResponseSchema.safeParse(deleteRes.json()).success).toBe(true);
  });

  it('draft room routes match DraftStateResponseSchema', async () => {
    const owner = await createTestUser({ displayName: 'Contract Draft Owner' });

    const leagueRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.create,
      headers: owner.headers,
      payload: buildCreateLeaguePayload('Contract Draft League'),
    });
    const leagueId = leagueRes.json().league.id as string;

    const contestRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.contests(leagueId),
      headers: owner.headers,
      payload: {
        name: 'Contract Draft Contest',
        sport: 'GOLF',
        contestType: ContestType.SINGLE_EVENT,
        selectionType: SelectionType.TIERED,
        scoringEngine: ScoringEngine.STROKE_PLAY,
        contestConfiguration: {
          rounds: 1,
          tierAssignmentMethod: 'AUTO_ODDS',
          tierConfig: [
            {
              tierId: 'tier-1',
              tierName: 'Tier 1',
              tierNumber: 1,
              picksFromTier: 1,
              participantIds: [],
            },
          ],
        },
      },
    });
    const contestId = contestRes.json().contest.id as string;

    await getApp().inject({
      method: 'POST',
      url: API_ROUTES.contests.myEntry(contestId),
      headers: withoutJsonBodyHeaders(owner.headers),
    });

    const stateRes = await getApp().inject({
      method: 'GET',
      url: API_ROUTES.drafts.state(contestId),
      headers: owner.headers,
    });

    expect(stateRes.statusCode).toBe(200);
    expect(DraftStateResponseSchema.safeParse(stateRes.json()).success).toBe(true);
  });

  it('active negative routes match ErrorEnvelopeSchema', async () => {
    const owner = await createTestUser({ displayName: 'Contract Error Owner' });

    const unauthorizedLeaguesRes = await getApp().inject({
      method: 'GET',
      url: API_ROUTES.leagues.list,
    });
    expect(unauthorizedLeaguesRes.statusCode).toBe(401);
    expect(ErrorEnvelopeSchema.safeParse(unauthorizedLeaguesRes.json()).success).toBe(true);

    const leagueRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.create,
      headers: owner.headers,
      payload: buildCreateLeaguePayload('Contract Error League'),
    });
    const leagueId = leagueRes.json().league.id as string;

    const missingInviteRes = await getApp().inject({
      method: 'DELETE',
      url: `/api/v1/leagues/${leagueId}/invite-link/missing-code`,
      headers: withoutJsonBodyHeaders(owner.headers),
    });
    expect(missingInviteRes.statusCode).toBe(404);
    expect(ErrorEnvelopeSchema.safeParse(missingInviteRes.json()).success).toBe(true);
    expect(missingInviteRes.json().error.code).toBe('LEAGUE_INVITATION_NOT_FOUND');
  });
});
