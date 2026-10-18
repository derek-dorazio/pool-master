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
  ContestListResponseSchema,
  ContestManagementResponseSchema,
  ContestResponseSchema,
  SelectionStateResponseSchema,
  GamePicksResponseSchema,
  ErrorEnvelopeSchema,
  SportEventListResponseSchema,
  GenerateInviteLinkResponseSchema,
  ListLeagueInvitationsResponseSchema,
  ResendLeagueInvitationResponseSchema,
  LeagueResponseSchema,
  SendLeagueInvitationsResponseSchema,
  SquadListResponseSchema,
  SquadResponseSchema,
  SuccessResponseSchema,
  TokenRefreshResponseSchema,
} from '@poolmaster/shared/dto';
import type {
  ContestConfigTemplateListResponse,
  ContestResponse,
  ErrorEnvelope,
  GenerateInviteLinkResponse,
  LeagueContextResponse,
  SendLeagueInvitationsResponse,
} from '@poolmaster/shared/dto';
import {
  ContestFormat,
  PickEmMode,
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
    const owner = await createTestUser({ displayName: 'Contract Invitations Owner' });

    const leagueRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.create,
      headers: owner.headers,
      payload: buildCreateLeaguePayload('Contract Invitations League'),
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

    const listRes = await getApp().inject({
      method: 'GET',
      url: `/api/v1/leagues/${leagueId}/invitations`,
      headers: owner.headers,
    });
    expect(listRes.statusCode).toBe(200);
    const listed = ListLeagueInvitationsResponseSchema.safeParse(listRes.json());
    expect(listed.success).toBe(true);
    expect(listed.data?.invitations).toHaveLength(2);

    const emailInvitationId = invitationRes.json<SendLeagueInvitationsResponse>().sent[0].id;
    const resendRes = await getApp().inject({
      method: 'POST',
      url: `/api/v1/leagues/${leagueId}/invitations/${emailInvitationId}/resend`,
      headers: owner.headers,
      payload: {},
    });
    expect(resendRes.statusCode).toBe(200);
    expect(ResendLeagueInvitationResponseSchema.safeParse(resendRes.json()).success).toBe(true);

    const resendLinkRes = await getApp().inject({
      method: 'POST',
      url: `/api/v1/leagues/${leagueId}/invitations/${
        inviteLinkRes.json<GenerateInviteLinkResponse>().invitation.id
      }/resend`,
      headers: owner.headers,
      payload: {},
    });
    expect(resendLinkRes.statusCode).toBe(409);
    expect(ErrorEnvelopeSchema.safeParse(resendLinkRes.json()).success).toBe(true);
    expect(resendLinkRes.json<ErrorEnvelope>().error.code).toBe('LEAGUE_INVITATION_NOT_RESENDABLE');

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
    expect(SuccessResponseSchema.safeParse(deleteRes.json()).success).toBe(true);
  });

  it('event list route matches SportEventListResponseSchema, with the loaded field and readiness, on the happy path', async () => {
    const prisma = getPrisma();
    const eventId = randomUUID();
    const participantId = randomUUID();
    const viewer = await createTestUser({ displayName: 'Contract Events Viewer' });
    const eventTiming = buildContestEligibleEventTiming();

    await prisma.sport.upsert({
      where: { sport: Sport.GOLF },
      update: {},
      create: { sport: Sport.GOLF, participantType: 'INDIVIDUAL', tournamentFormat: 'STROKE_PLAY_TOURNAMENT' },
    });
    await prisma.sportEvent.create({
      data: {
        ...(await freshEventEdition(prisma)),
        id: eventId,
        providerId: 'contract-events-provider',
        externalId: `contract-event-${eventId}`,
        sport: Sport.GOLF,
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
            sport: Sport.GOLF,
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
        url: '/api/v1/events/?sport=GOLF',
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
        sport: Sport.GOLF,
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
        url: '/api/v1/events/?sport=GOLF',
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
        iconKey: 'SOCCER_BALL',
      },
    });

    expect(updateRes.statusCode).toBe(200);
    expect(LeagueResponseSchema.safeParse(updateRes.json()).success).toBe(true);
  });

  it.each([
    ['missing', {}],
    ['not in the icon catalog', { iconKey: 'NOT_AN_ICON' }],
  ])('league detail update refuses a body whose iconKey is %s with a 400 error envelope and leaves the league unchanged', async (_case, icon) => {
    const owner = await createTestUser({ displayName: 'Contract League Icon Validator' });

    const leagueRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.create,
      headers: owner.headers,
      payload: buildCreateLeaguePayload('Icon Validation League'),
    });
    const league = leagueRes.json<LeagueContextResponse>().league;

    const updateRes = await getApp().inject({
      method: 'PUT',
      url: API_ROUTES.leagues.details(league.id),
      headers: owner.headers,
      payload: { name: 'Should Not Save', ...icon },
    });

    expect(updateRes.statusCode).toBe(400);
    expect(ErrorEnvelopeSchema.safeParse(updateRes.json()).success).toBe(true);
    const stored = await getApp().inject({
      method: 'GET',
      url: API_ROUTES.leagues.byCode(league.leagueCode),
      headers: owner.headers,
    });
    expect(stored.json<LeagueContextResponse>().league).toMatchObject({ name: league.name, iconKey: league.iconKey });
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

    // Inactivating ends the owners' league memberships, so the league's only commissioner may
    // not inactivate their own team. Inactivate a second member's team instead.
    const member = await createTestUser({ displayName: 'Contract Team Member' });
    const prisma = getPrisma();
    await prisma.leagueMembership.create({
      data: { leagueId, userId: member.user.id, role: 'MEMBER', status: 'ACTIVE', joinedAt: new Date() },
    });
    const memberSquad = await prisma.squad.create({
      data: { leagueId, name: 'Contract Member Team', createdBy: member.user.id },
    });
    await prisma.squadMembership.create({
      data: { squadId: memberSquad.id, leagueId, userId: member.user.id, status: 'ACTIVE', joinedAt: new Date() },
    });

    const inactivateRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.squads.inactivate(leagueId, memberSquad.id),
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
        sport: Sport.GOLF,
      },
      update: {},
      create: {
        sport: Sport.GOLF,
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
            sport: Sport.GOLF,
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
              sport: Sport.GOLF,
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
        sportEventIds: [sportEvent.id],
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

    // The league's contest list carries each contest's event name and start (#577).
    const listRes = await getApp().inject({
      method: 'GET',
      url: API_ROUTES.leagues.contests(leagueId),
      headers: withoutJsonBodyHeaders(owner.headers),
    });
    expect(listRes.statusCode).toBe(200);
    const listParsed = ContestListResponseSchema.safeParse(listRes.json());
    expect(listParsed.success).toBe(true);
    expect(listParsed.data?.contests.find((contest) => contest.id === contestId)?.sportEvents).toEqual([{
      sportEventId: sportEvent.id,
      sequence: 1,
      name: sportEvent.name,
      startDate: sportEvent.startDate.toISOString(),
      status: sportEvent.status,
    }]);
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
    expect(SuccessResponseSchema.safeParse(passwordRes.json()).success).toBe(true);

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
    expect(SuccessResponseSchema.safeParse(deleteRes.json()).success).toBe(true);
  });

  it('selection room routes match SelectionStateResponseSchema', async () => {
    const owner = await createTestUser({ displayName: 'Contract Draft Owner' });

    const leagueRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.create,
      headers: owner.headers,
      payload: buildCreateLeaguePayload('Contract Draft League'),
    });
    const leagueId = leagueRes.json<LeagueContextResponse>().league.id;

    // #245 retired the event-less legacy create this contract once went through; the selection-state
    // contract does not depend on how the contest was made, so the row is a fixture.
    const contest = await getPrisma().contest.create({
      data: {
        leagueId,
        name: 'Contract Draft Contest',
        status: 'DRAFT',
        contestFormat: ContestFormat.ROSTER,
        selectionType: SelectionType.TIERED,
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

    // Entered before the contest has an event, so the entry does not wait on a loaded field.
    await getApp().inject({
      method: 'POST',
      url: API_ROUTES.contests.myEntry(contestId),
      headers: withoutJsonBodyHeaders(owner.headers),
    });
    // A selection room is always one event's (#713), so the contest covers one.
    const event = await getPrisma().sportEvent.create({
      data: {
        ...(await freshEventEdition(getPrisma())),
        externalId: `contract-room-${randomUUID().slice(0, 8)}`,
        providerId: 'integration-test',
        sport: Sport.GOLF,
        name: 'Contract Room Event',
        startDate: new Date('2099-04-20T12:00:00.000Z'),
        status: 'SCHEDULED',
      },
    });
    await getPrisma().contestSportEvent.create({ data: { contestId, sportEventId: event.id, sequence: 1 } });
    const roomEntries = await getPrisma().contestEntry.findMany({ where: { contestId }, select: { id: true } });
    await getPrisma().contestEntryEvent.createMany({
      data: roomEntries.map((entry) => ({ contestEntryId: entry.id, sportEventId: event.id })),
    });

    const stateRes = await getApp().inject({
      method: 'GET',
      url: API_ROUTES.selections.state(contestId),
      headers: owner.headers,
    });

    expect(stateRes.statusCode).toBe(200);
    expect(SelectionStateResponseSchema.safeParse(stateRes.json()).success).toBe(true);
  });

  it('POST /api/v1/selections/:contestId/draw matches SelectionStateResponseSchema, carrying when the draw ran', async () => {
    const commissioner = await createTestUser({ displayName: 'Contract Draw Commissioner' });
    const leagueRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.create,
      headers: commissioner.headers,
      payload: buildCreateLeaguePayload('Contract Draw League'),
    });
    const leagueId = leagueRes.json<LeagueContextResponse>().league.id;

    const prisma = getPrisma();
    const contest = await prisma.contest.create({
      data: {
        leagueId,
        name: 'Contract Draw Contest',
        status: 'OPEN',
        contestFormat: ContestFormat.ROSTER,
        selectionType: SelectionType.RANDOM_DRAW,
      },
    });
    await prisma.contestConfiguration.create({
      data: {
        contestId: contest.id,
        selectionType: SelectionType.RANDOM_DRAW,
        maxEntriesPerSquad: 1,
        configJson: { selectionType: SelectionType.RANDOM_DRAW, picksPerEntry: 1, countedScores: 1 },
      },
    });
    // Entered before the contest has an event, so the entry does not wait on a loaded field.
    await getApp().inject({
      method: 'POST',
      url: API_ROUTES.contests.myEntry(contest.id),
      headers: withoutJsonBodyHeaders(commissioner.headers),
    });

    const sport = await prisma.sport.upsert({
      where: { sport: Sport.GOLF },
      create: { sport: Sport.GOLF, participantType: 'INDIVIDUAL', tournamentFormat: 'STROKE_PLAY_TOURNAMENT' },
      update: {},
    });
    const event = await prisma.sportEvent.create({
      data: {
        ...(await freshEventEdition(prisma)),
        externalId: `contract-draw-${randomUUID().slice(0, 8)}`,
        providerId: 'integration-test',
        sport: Sport.GOLF,
        name: 'Contract Draw Event',
        startDate: new Date('2099-04-20T12:00:00.000Z'),
        status: 'SCHEDULED',
      },
    });
    const golfer = await prisma.participant.create({
      data: { sportId: sport.id, name: 'Contract Draw Golfer', participantType: 'INDIVIDUAL', externalIds: {} },
    });
    await prisma.sportEventParticipant.create({ data: { sportEventId: event.id, participantId: golfer.id, isActive: true } });
    // The event added after the entry, as "Events in this contest" adds one: the entry gets a
    // DRAFT status in it (#713).
    await prisma.contestSportEvent.create({ data: { contestId: contest.id, sportEventId: event.id, sequence: 1 } });
    const drawEntries = await prisma.contestEntry.findMany({ where: { contestId: contest.id }, select: { id: true } });
    await prisma.contestEntryEvent.createMany({
      data: drawEntries.map((entry) => ({ contestEntryId: entry.id, sportEventId: event.id })),
    });

    const drawRes = await getApp().inject({
      method: 'POST',
      url: `/api/v1/selections/${contest.id}/draw`,
      headers: withoutJsonBodyHeaders(commissioner.headers),
    });

    expect(drawRes.statusCode).toBe(200);
    const parsed = SelectionStateResponseSchema.safeParse(drawRes.json());
    expect(parsed.success).toBe(true);
    expect(parsed.data?.drawnAt).toEqual(expect.any(String));
  });

  it('game-pick read, save and submit routes match GamePicksResponseSchema, with a pick on the game', async () => {
    const owner = await createTestUser({ displayName: 'Contract Pickem Owner' });
    const leagueRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.create,
      headers: owner.headers,
      payload: buildCreateLeaguePayload('Contract Pickem League'),
    });
    const leagueId = leagueRes.json<LeagueContextResponse>().league.id;

    const prisma = getPrisma();
    const contest = await prisma.contest.create({
      data: {
        leagueId,
        name: 'Contract Pickem Contest',
        status: 'OPEN',
        contestFormat: ContestFormat.PREDICTION,
        selectionType: SelectionType.PICK_EM,
      },
    });
    await prisma.contestConfiguration.create({
      data: {
        contestId: contest.id,
        selectionType: SelectionType.PICK_EM,
        maxEntriesPerSquad: 1,
        configJson: { selectionType: SelectionType.PICK_EM, mode: PickEmMode.CONFIDENCE },
      },
    });
    // Entered before the contest has an event, so the entry does not wait on a loaded field.
    await getApp().inject({
      method: 'POST',
      url: API_ROUTES.contests.myEntry(contest.id),
      headers: withoutJsonBodyHeaders(owner.headers),
    });

    const sport = await prisma.sport.upsert({
      where: { sport: Sport.BASKETBALL },
      create: { sport: Sport.BASKETBALL, participantType: 'TEAM', tournamentFormat: 'KNOCKOUT_BRACKET' },
      update: {},
    });
    const event = await prisma.sportEvent.create({
      data: {
        ...(await freshEventEdition(prisma)),
        externalId: `contract-pickem-${randomUUID().slice(0, 8)}`,
        providerId: 'integration-test',
        sport: Sport.BASKETBALL,
        name: 'Contract Pickem Event',
        startDate: new Date('2099-03-19T16:00:00.000Z'),
        status: 'SCHEDULED',
        rounds: 1,
      },
    });
    const round = await prisma.sportEventRound.create({ data: { sportEventId: event.id, roundNumber: 1, scheduledDate: event.startDate } });
    const [home, away] = await Promise.all(['Contract Home', 'Contract Away'].map(async (name) => {
      const team = await prisma.participant.create({ data: { sportId: sport.id, name, participantType: 'TEAM', externalIds: {} } });
      return prisma.sportEventParticipant.create({ data: { sportEventId: event.id, participantId: team.id, isActive: true } });
    }));
    const game = await prisma.sportEventMatch.create({
      data: {
        sportEventId: event.id,
        sportEventRoundId: round.id,
        matchNumber: 1,
        homeSportEventParticipantId: home.id,
        awaySportEventParticipantId: away.id,
        isNeutralSite: false,
        scheduledDate: new Date('2099-03-19T16:00:00.000Z'),
      },
    });
    await prisma.contestSportEvent.create({ data: { contestId: contest.id, sportEventId: event.id, sequence: 1 } });
    const entry = await prisma.contestEntry.findFirstOrThrow({ where: { contestId: contest.id }, select: { id: true } });
    await prisma.contestEntryEvent.create({ data: { contestEntryId: entry.id, sportEventId: event.id } });
    const url = `/api/v1/selections/${contest.id}/entries/${entry.id}/events/${event.id}/game-picks`;

    const saveRes = await getApp().inject({
      method: 'PUT',
      url,
      headers: owner.headers,
      payload: { picks: [{ sportEventMatchId: game.id, sportEventParticipantId: away.id, confidence: 1 }] },
    });
    expect(saveRes.statusCode).toBe(200);
    const saved = GamePicksResponseSchema.safeParse(saveRes.json());
    expect(saved.success).toBe(true);
    expect(saved.data?.games[0]?.pick).toMatchObject({ sportEventParticipantId: away.id, confidence: 1 });

    const readRes = await getApp().inject({ method: 'GET', url, headers: owner.headers });
    expect(readRes.statusCode).toBe(200);
    expect(GamePicksResponseSchema.safeParse(readRes.json()).success).toBe(true);

    const submitRes = await getApp().inject({ method: 'POST', url: `${url}/submit`, headers: withoutJsonBodyHeaders(owner.headers) });
    expect(submitRes.statusCode).toBe(200);
    const submitted = GamePicksResponseSchema.safeParse(submitRes.json());
    expect(submitted.success).toBe(true);
    expect(submitted.data?.submittedAt).toEqual(expect.any(String));

    const clearRes = await getApp().inject({ method: 'DELETE', url: `${url}/${game.id}`, headers: withoutJsonBodyHeaders(owner.headers) });
    expect(clearRes.statusCode).toBe(200);
    expect(GamePicksResponseSchema.safeParse(clearRes.json()).success).toBe(true);
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
