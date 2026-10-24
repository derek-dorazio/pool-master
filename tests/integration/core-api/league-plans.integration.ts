/**
 * Choosing a plan against Postgres (#945): PUT /leagues/:id/plan moves the league at once and logs
 * the change, and GET /plans lists every plan's caps and features for the comparison table.
 */
import { randomUUID } from 'node:crypto';
import { API_ROUTES } from '@poolmaster/shared/api-routes';
import { LeaguePlan, PlanFeature } from '@poolmaster/shared/domain';
import {
  ErrorEnvelopeSchema,
  LeaguePlanListResponseSchema,
  LeagueResponseSchema,
  type ErrorEnvelope,
  type LeagueContextResponse,
} from '@poolmaster/shared/dto';
import {
  buildCreateLeaguePayload,
  cleanupTestData,
  createTestUser,
  getApp,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

async function createLeague() {
  const commissioner = await createTestUser({ displayName: `Plan Commissioner ${randomUUID().slice(0, 6)}` });
  const res = await getApp().inject({
    method: 'POST',
    url: API_ROUTES.leagues.create,
    headers: commissioner.headers,
    payload: buildCreateLeaguePayload('Plan League'),
  });
  return { commissioner, league: res.json<LeagueContextResponse>().league };
}

describe('League plans', () => {
  it('starts a new league on Platinum, with no limits and every feature', async () => {
    const { league } = await createLeague();

    expect(league.planEntitlements.plan).toBe(LeaguePlan.PLATINUM);
    expect(league.planEntitlements.caps).toEqual({ ENTRIES_PER_CONTEST: null, SPORTS_LEAGUES_PER_YEAR: null });
    expect([...league.planEntitlements.features].sort()).toEqual(Object.values(PlanFeature).sort());
  });

  it('lets a commissioner move the league to Free at once, returning Free caps and logging who changed it', async () => {
    const { commissioner, league } = await createLeague();

    const res = await getApp().inject({
      method: 'PUT',
      url: API_ROUTES.leagues.plan(league.id),
      headers: commissioner.headers,
      payload: { plan: LeaguePlan.FREE },
    });

    expect(res.statusCode).toBe(200);
    const parsed = LeagueResponseSchema.parse(res.json());
    expect(parsed.league.planEntitlements).toMatchObject({
      plan: LeaguePlan.FREE,
      caps: { ENTRIES_PER_CONTEST: 20, SPORTS_LEAGUES_PER_YEAR: 1 },
    });
    expect(parsed.league.planEntitlements.features).not.toContain(PlanFeature.CHAMPIONSHIP);
    const changes = await getPrisma().leaguePlanChange.findMany({ where: { leagueId: league.id } });
    expect(changes).toEqual([
      expect.objectContaining({ fromPlan: 'PLATINUM', toPlan: 'FREE', changedById: commissioner.user.id }),
    ]);
  });

  it('refuses a plan change from a member who is not a commissioner with 403, leaving the plan as it was', async () => {
    const { league } = await createLeague();
    const member = await createTestUser({ displayName: 'Plan Member' });
    await getPrisma().leagueMembership.create({
      data: { leagueId: league.id, userId: member.user.id, role: 'MEMBER', status: 'ACTIVE', joinedAt: new Date() },
    });

    const res = await getApp().inject({
      method: 'PUT',
      url: API_ROUTES.leagues.plan(league.id),
      headers: member.headers,
      payload: { plan: LeaguePlan.FREE },
    });

    expect(res.statusCode).toBe(403);
    expect(ErrorEnvelopeSchema.safeParse(res.json()).success).toBe(true);
    const stored = await getPrisma().league.findUniqueOrThrow({ where: { id: league.id } });
    expect(stored.plan).toBe('PLATINUM');
    expect(await getPrisma().leaguePlanChange.count({ where: { leagueId: league.id } })).toBe(0);
  });

  it('lets a root admin who is not in the league change its plan, logging the root admin as the changer', async () => {
    const { league } = await createLeague();
    const rootAdmin = await createTestUser({ displayName: 'Plan Root Admin', isRootAdmin: true });

    const res = await getApp().inject({
      method: 'PUT',
      url: API_ROUTES.leagues.plan(league.id),
      headers: rootAdmin.headers,
      payload: { plan: LeaguePlan.PREMIUM },
    });

    expect(res.statusCode).toBe(200);
    expect(LeagueResponseSchema.parse(res.json()).league.planEntitlements.plan).toBe(LeaguePlan.PREMIUM);
    const changes = await getPrisma().leaguePlanChange.findMany({ where: { leagueId: league.id } });
    expect(changes.map((change) => change.changedById)).toEqual([rootAdmin.user.id]);
  });

  it('refuses a plan that is not one of the four with a 400 error envelope', async () => {
    const { commissioner, league } = await createLeague();

    const res = await getApp().inject({
      method: 'PUT',
      url: API_ROUTES.leagues.plan(league.id),
      headers: commissioner.headers,
      payload: { plan: 'GOLD' },
    });

    expect(res.statusCode).toBe(400);
    expect(ErrorEnvelopeSchema.safeParse(res.json()).success).toBe(true);
  });

  it('refuses a plan change on an inactive league with 400 LEAGUE_DETAILS_READ_ONLY_WHEN_INACTIVE', async () => {
    const { commissioner, league } = await createLeague();
    await getPrisma().league.update({ where: { id: league.id }, data: { isActive: false } });

    const res = await getApp().inject({
      method: 'PUT',
      url: API_ROUTES.leagues.plan(league.id),
      headers: commissioner.headers,
      payload: { plan: LeaguePlan.FREE },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json<ErrorEnvelope>().error.code).toBe('LEAGUE_DETAILS_READ_ONLY_WHEN_INACTIVE');
  });

  it('lists all four plans in order, lowest first, with Platinum unlimited, for the comparison table', async () => {
    const user = await createTestUser({ displayName: 'Plan Reader' });

    const res = await getApp().inject({ method: 'GET', url: API_ROUTES.plans.list, headers: user.headers });

    expect(res.statusCode).toBe(200);
    const { plans } = LeaguePlanListResponseSchema.parse(res.json());
    expect(plans.map((plan) => plan.plan)).toEqual([LeaguePlan.FREE, LeaguePlan.PRO, LeaguePlan.PREMIUM, LeaguePlan.PLATINUM]);
    expect(plans[0]?.caps).toEqual({ ENTRIES_PER_CONTEST: 20, SPORTS_LEAGUES_PER_YEAR: 1 });
    expect(plans[3]?.caps).toEqual({ ENTRIES_PER_CONTEST: null, SPORTS_LEAGUES_PER_YEAR: null });
  });

  it('refuses the plan list without a signed-in user with 401', async () => {
    const res = await getApp().inject({ method: 'GET', url: API_ROUTES.plans.list });

    expect(res.statusCode).toBe(401);
  });
});
