import {
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
  ContestManagementResponseSchema,
  ConsentRecordResponseSchema,
  DraftStateResponseSchema,
  ErrorEnvelopeSchema,
  GenerateInviteLinkResponseSchema,
  LeagueDashboardResponseSchema,
  LeagueResponseSchema,
  ScoringConfigValidationResponseSchema,
  SendLeagueInvitationsResponseSchema,
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
  it('auth routes expose the shared error envelope on negative responses', async () => {
    const loginRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.auth.login,
      payload: {
        email: 'missing-user@integration.test',
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

  it('contest management routes match ContestManagementResponseSchema', async () => {
    const owner = await createTestUser({ displayName: 'Contract Contest Owner' });

    const leagueRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.create,
      headers: owner.headers,
      payload: buildCreateLeaguePayload('Contract Contest League'),
    });
    const leagueId = leagueRes.json().league.id as string;

    const sportEvent = await getPrisma().sportEvent.create({
      data: {
        externalId: `contract-event-${randomUUID().slice(0, 8)}`,
        providerId: 'integration-test',
        sport: Sport.GOLF,
        name: 'Contract Event',
        startDate: new Date('2026-04-12T12:00:00.000Z'),
        status: 'SCHEDULED',
      },
    });

    const res = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.contestManagement(leagueId),
      headers: owner.headers,
      payload: {
        name: 'Contract Managed Contest',
        sportEventId: sportEvent.id,
        contestType: ContestType.SINGLE_EVENT,
        configuration: {
          selectionType: 'BUDGET_PICK',
          rosterSize: 6,
          minimumEntries: 1,
          maxEntriesPerSquad: 1,
          participantScoringRules: [
            {
              participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL',
              sortOrder: 1,
              config: {},
              active: true,
            },
          ],
          entryAggregationRule: {
            aggregationDefinitionId: 'SUM_ALL_ENTRIES',
            config: {},
            active: true,
          },
          prizeDefinitions: [],
        },
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
