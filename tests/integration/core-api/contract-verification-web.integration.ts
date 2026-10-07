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
  UserResponseSchema,
  AuthResponseSchema,
  ContestConfigTemplateListResponseSchema,
  ContestManagementResponseSchema,
  ContestResponseSchema,
  DraftStateResponseSchema,
  ErrorEnvelopeSchema,
  SportEventListResponseSchema,
  GenerateInviteLinkResponseSchema,
  LeagueResponseSchema,
  SendLeagueInvitationsResponseSchema,
  SquadListResponseSchema,
  SquadResponseSchema,
  SuccessSchema,
  TokenRefreshResponseSchema,
} from '@poolmaster/shared/dto';
import type {
  ContestConfigTemplateListResponse,
  ContestResponse,
  ErrorEnvelope,
  LeagueContextResponse,
  SquadListResponse,
} from '@poolmaster/shared/dto';
import {
  ContestFormat,
  ScoringEngine,
  SelectionType,
  Sport,
} from '@poolmaster/shared/domain';
import { randomUUID } from 'node:crypto';
import { freshEventEdition } from '../../support/event-edition';

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
      url: API_ROUTES.users.detail('me'),
      headers: {
        cookie: cookieHeader,
      },
    });

    expect(meRes.statusCode).toBe(200);
    expect(UserResponseSchema.safeParse(meRes.json()).success).toBe(true);

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
      url: API_ROUTES.users.detail('me'),
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

  it('league invitation routes match their response DTOs', async () => {
    const owner = await createTestUser({ displayName: 'Contract Dashboard Owner' });

    const leagueRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.create,
      headers: owner.headers,
      payload: buildCreateLeaguePayload('Contract Dashboard League'),
    });
    const leagueId = leagueRes.json<LeagueContextResponse>().league.id;

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
  });

  it('league lifecycle routes match the shared response DTOs', async () => {
    const owner = await createTestUser({ displayName: 'Contract Lifecycle Owner' });

    const leagueRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.create,
      headers: owner.headers,
      payload: buildCreateLeaguePayload('Contract Lifecycle League'),
    });
    const leagueId = leagueRes.json<LeagueContextResponse>().league.id;
    const leagueCode = leagueRes.json<LeagueContextResponse>().league.leagueCode;

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

  it('event list route matches SportEventListResponseSchema, with the loaded field and readiness, on the happy path', async () => {
    const prisma = getPrisma();
    const eventId = randomUUID();
    const participantId = randomUUID();
    const sportId = randomUUID();
    const viewer = await createTestUser({ displayName: 'Contract Events Viewer' });
    const eventTiming = buildContestEligibleEventTiming();

    await prisma.sport.create({
      data: {
        id: sportId,
        name: Sport.UFC,
        participantType: 'INDIVIDUAL',
        tournamentFormat: 'STROKE_PLAY_TOURNAMENT',
      },
    });
    await prisma.sportEvent.create({
      data: {
        ...(await freshEventEdition(prisma)),
        id: eventId,
        providerId: 'contract-events-provider',
        externalId: `contract-event-${eventId}`,
        sport: Sport.UFC,
        name: 'Contract Events Major',
        startDate: eventTiming.startDate,
        endDate: new Date(eventTiming.startDate.getTime() + 3 * 24 * 60 * 60 * 1000),
        status: 'SCHEDULED',
        participantCount: 144,
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
        isActive: true,
      },
    });

    try {
      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/events/?sport=UFC',
        headers: viewer.headers,
      });

      expect(res.statusCode).toBe(200);
      const parsed = SportEventListResponseSchema.safeParse(res.json());
      expect(parsed.success).toBe(true);
      const event = parsed.data?.events.find((item) => item.id === eventId);
      expect(event).toMatchObject({
        id: eventId,
        contestEligible: true,
        readinessStatus: 'CONTEST_ELIGIBLE',
        loadedParticipantCount: 1,
      });
    } finally {
      await prisma.sportEventParticipantGolfStanding.deleteMany({
        where: {
          standing: {
            sportEventParticipant: { sportEventId: eventId },
          },
        },
      });
      await prisma.sportEventParticipantStanding.deleteMany({
        where: {
          sportEventParticipant: { sportEventId: eventId },
        },
      });
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
    const eventTiming = buildContestEligibleEventTiming();

    await prisma.sportEvent.create({
      data: {
        ...(await freshEventEdition(prisma)),
        id: eventId,
        providerId: 'contract-events-provider',
        externalId: `contract-shallow-event-${eventId}`,
        sport: Sport.UFC,
        name: 'Contract Shallow Event',
        startDate: eventTiming.startDate,
        endDate: new Date(eventTiming.startDate.getTime() + 3 * 24 * 60 * 60 * 1000),
        status: 'SCHEDULED',
        participantCount: 144,
        metadata: {},
      },
    });

    try {
      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/events/?sport=UFC',
        headers: viewer.headers,
      });

      expect(res.statusCode).toBe(200);
      const parsed = SportEventListResponseSchema.safeParse(res.json());
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
    const leagueId = leagueRes.json<LeagueContextResponse>().league.id;

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
    const leagueId = leagueRes.json<LeagueContextResponse>().league.id;

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
    const leagueId = leagueRes.json<LeagueContextResponse>().league.id;

    const listRes = await getApp().inject({
      method: 'GET',
      url: API_ROUTES.squads.list(leagueId),
      headers: owner.headers,
    });

    expect(listRes.statusCode).toBe(200);
    expect(SquadListResponseSchema.safeParse(listRes.json()).success).toBe(true);

    const squadId = listRes.json<SquadListResponse>().squads[0].id;

    const inactivateRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.squads.inactivate(leagueId, squadId),
      headers: withoutJsonBodyHeaders(owner.headers),
    });

    expect(inactivateRes.statusCode).toBe(200);
    expect(SquadResponseSchema.safeParse(inactivateRes.json()).success).toBe(true);
  });

  it('contest-config-template list and contest create routes match their response DTOs', async () => {
    const eventTiming = buildContestEligibleEventTiming();
    const owner = await createTestUser({ displayName: 'Contract Contest Owner' });

    const leagueRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.create,
      headers: owner.headers,
      payload: buildCreateLeaguePayload('Contract Contest League'),
    });
    const leagueId = leagueRes.json<LeagueContextResponse>().league.id;
    await getPrisma().sport.upsert({
      where: {
        name: Sport.GOLF,
      },
      update: {},
      create: {
        name: Sport.GOLF,
        participantType: 'INDIVIDUAL',
        tournamentFormat: 'STROKE_PLAY_TOURNAMENT',
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
        ...(await freshEventEdition(getPrisma())),
        externalId: `contract-event-${randomUUID().slice(0, 8)}`,
        providerId: 'integration-test',
        sport: Sport.GOLF,
        name: 'Contract Event',
        startDate: eventTiming.startDate,
        status: 'SCHEDULED',
      },
    });
    await getPrisma().sportEventParticipant.create({
      data: {
        sportEventId: sportEvent.id,
        participantId: participant.id,
        isActive: true,
      },
    });
    // pool-master-9y6: default tiered templates require a contest-ready field.
    for (let index = 2; index <= 80; index += 1) {
      const fieldParticipant = await getPrisma().participant.create({
        data: {
          name: `Contract Field Golfer ${index} ${randomUUID().slice(0, 8)}`,
          participantType: 'INDIVIDUAL',
          status: 'ACTIVE',
          sport: {
            connect: {
              name: Sport.GOLF,
            },
          },
        },
      });
      await getPrisma().sportEventParticipant.create({
        data: {
          sportEventId: sportEvent.id,
          participantId: fieldParticipant.id,
          isActive: true,
        },
      });
    }

    const templateRes = await getApp().inject({
      method: 'GET',
      url: '/api/v1/contest-config-templates/?sport=GOLF&contestFormat=ROSTER&active=true',
      headers: owner.headers,
    });

    expect(templateRes.statusCode).toBe(200);
    expect(
      ContestConfigTemplateListResponseSchema.safeParse(templateRes.json()).success,
    ).toBe(true);

    const defaultTemplate = templateRes.json<ContestConfigTemplateListResponse>().templates.find(
      (template) => template.isDefault,
    );
    if (!defaultTemplate) throw new Error('No default contest template is seeded');

    const res = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.contests(leagueId),
      headers: owner.headers,
      payload: {
        name: 'Contract Managed Contest',
        sportEventId: sportEvent.id,
        contestFormat: ContestFormat.ROSTER,
        selectionType: 'TIERED',
        templateId: defaultTemplate.id,
      },
    });

    expect(res.statusCode).toBe(201);
    const parsed = ContestResponseSchema.safeParse(res.json());
    expect(parsed.success).toBe(true);

    // openContest (#117) answers with the commissioner's contest read, now OPEN.
    const contestId = res.json<ContestResponse>().contest.id;
    const openRes = await getApp().inject({
      method: 'POST',
      url: `${API_ROUTES.contestManagement.detail(leagueId, contestId)}/open`,
      headers: withoutJsonBodyHeaders(owner.headers),
    });
    expect(openRes.statusCode).toBe(200);
    const openParsed = ContestManagementResponseSchema.safeParse(openRes.json());
    expect(openParsed.success).toBe(true);
    expect(openParsed.data?.contest.status).toBe('OPEN');
  });

  it('account lifecycle routes match their shared response DTOs', async () => {
    const user = await createTestUser({ displayName: 'Contract Account User' });

    const profileRes = await getApp().inject({
      method: 'PUT',
      url: API_ROUTES.users.profile('me'),
      headers: user.headers,
      payload: {
        email: user.user.email,
        firstName: 'Updated',
        lastName: 'Person',
      },
    });

    expect(profileRes.statusCode).toBe(200);
    expect(UserResponseSchema.safeParse(profileRes.json()).success).toBe(true);

    const preferencesRes = await getApp().inject({
      method: 'PUT',
      url: API_ROUTES.users.preferences('me'),
      headers: user.headers,
      payload: {
        timezone: 'America/New_York',
        locale: 'en-US',
        timeFormat: '12H',
        dateFormat: 'MDY',
      },
    });

    expect(preferencesRes.statusCode).toBe(200);
    expect(UserResponseSchema.safeParse(preferencesRes.json()).success).toBe(true);

    const passwordRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.users.password('me'),
      headers: user.headers,
      payload: {
        currentPassword: 'TestPass123',
        newPassword: 'UpdatedPassword123!',
        confirmNewPassword: 'UpdatedPassword123!',
      },
    });

    expect(passwordRes.statusCode).toBe(200);
    expect(SuccessSchema.safeParse(passwordRes.json()).success).toBe(true);

    const inactivateRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.users.disable('me'),
      headers: user.headers,
      // The disable operation takes an optional `reason`, which a root admin supplies and
      // self-inactivation does not. `{}` is the no-reason case.
      payload: {},
    });

    expect(inactivateRes.statusCode).toBe(200);
    expect(UserResponseSchema.safeParse(inactivateRes.json()).success).toBe(true);

    const reactivateRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.users.enable('me'),
      headers: withoutJsonBodyHeaders(user.headers),
    });

    expect(reactivateRes.statusCode).toBe(200);
    expect(UserResponseSchema.safeParse(reactivateRes.json()).success).toBe(true);

    const secondInactivateRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.users.disable('me'),
      headers: user.headers,
      // The disable operation takes an optional `reason`, which a root admin supplies and
      // self-inactivation does not. `{}` is the no-reason case.
      payload: {},
    });

    expect(secondInactivateRes.statusCode).toBe(200);
    expect(UserResponseSchema.safeParse(secondInactivateRes.json()).success).toBe(true);

    const deleteRes = await getApp().inject({
      method: 'DELETE',
      url: API_ROUTES.users.detail('me'),
      headers: user.headers,
      payload: {
        email: user.user.email,
      },
    });

    expect(deleteRes.statusCode).toBe(200);
    expect(SuccessSchema.safeParse(deleteRes.json()).success).toBe(true);
  });

  it('draft room routes match DraftStateResponseSchema', async () => {
    const owner = await createTestUser({ displayName: 'Contract Draft Owner' });

    const leagueRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.create,
      headers: owner.headers,
      payload: buildCreateLeaguePayload('Contract Draft League'),
    });
    const leagueId = leagueRes.json<LeagueContextResponse>().league.id;

    // #245 retired the event-less legacy create this contract once went through; the draft-state
    // contract does not depend on how the contest was made, so the row is a fixture.
    const contest = await getPrisma().contest.create({
      data: {
        leagueId,
        name: 'Contract Draft Contest',
        status: 'DRAFT',
        contestFormat: ContestFormat.ROSTER,
        selectionType: SelectionType.TIERED,
        scoringEngine: ScoringEngine.STROKE_PLAY,
      },
    });
    await getPrisma().contestConfiguration.create({
      data: {
        contestId: contest.id,
        selectionType: SelectionType.TIERED,
        maxEntriesPerSquad: 1,
      },
    });
    const contestId = contest.id;

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
    const leagueId = leagueRes.json<LeagueContextResponse>().league.id;

    const missingInviteRes = await getApp().inject({
      method: 'DELETE',
      url: `/api/v1/leagues/${leagueId}/invite-link/missing-code`,
      headers: withoutJsonBodyHeaders(owner.headers),
    });
    expect(missingInviteRes.statusCode).toBe(404);
    expect(ErrorEnvelopeSchema.safeParse(missingInviteRes.json()).success).toBe(true);
    expect(missingInviteRes.json<ErrorEnvelope>().error.code).toBe('LEAGUE_INVITATION_NOT_FOUND');
  });
});
