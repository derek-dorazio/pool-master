/**
 * Choosing a plan against Postgres (#945): PUT /leagues/:id/plan moves the league at once and logs
 * the change, and GET /plans lists every plan's caps and features for the comparison table. A new
 * league is gifted Premium until its renewal date, which a root admin can extend (#986).
 */
import { randomUUID } from 'node:crypto';
import { API_ROUTES } from '@poolmaster/shared/api-routes';
import { LeaguePlan, LeaguePlanChangeReason, PlanFeature } from '@poolmaster/shared/domain';
import {
  ErrorEnvelopeSchema,
  ExtendRunningPlanRenewalsResponseSchema,
  LeaguePlanListResponseSchema,
  LeagueResponseSchema,
  type ErrorEnvelope,
  type LeagueContextResponse,
} from '@poolmaster/shared/dto';
import { PrismaLeagueRepository } from '../../../packages/core-api/src/adapters/prisma-league-repository';
import {
  buildCreateLeaguePayload,
  cleanupTestData,
  createTestUser,
  getApp,
  getAppPrisma,
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
  it('starts a new league on Premium, renewing six months after signup, with Premium\'s caps and the all-years summary and record book', async () => {
    const before = new Date();
    const { league } = await createLeague();

    expect(league.planEntitlements.plan).toBe(LeaguePlan.PREMIUM);
    expect(league.planEntitlements.caps).toEqual({ ENTRIES_PER_CONTEST: 100, SPORTS_LEAGUES_PER_YEAR: 30 });
    expect(league.planEntitlements.features).toEqual(expect.arrayContaining([PlanFeature.ALL_TIME_SUMMARY, PlanFeature.RECORD_BOOK]));
    const sixMonthsOn = new Date(before);
    sixMonthsOn.setUTCMonth(sixMonthsOn.getUTCMonth() + 6);
    const renewsAt = new Date(league.planRenewsAt).getTime();
    expect(renewsAt).toBeGreaterThan(sixMonthsOn.getTime() - 3 * 24 * 60 * 60_000);
    expect(renewsAt).toBeLessThan(sixMonthsOn.getTime() + 3 * 24 * 60 * 60_000);
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
      caps: { ENTRIES_PER_CONTEST: 20, SPORTS_LEAGUES_PER_YEAR: 5 },
    });
    expect(parsed.league.planEntitlements.features).not.toContain(PlanFeature.CHAMPIONSHIP);
    const changes = await getPrisma().leaguePlanChange.findMany({ where: { leagueId: league.id } });
    expect(changes).toEqual([
      expect.objectContaining({
        fromPlan: 'PREMIUM', toPlan: 'FREE', changedById: commissioner.user.id, changeReason: LeaguePlanChangeReason.CHOSEN,
      }),
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
    expect(stored.plan).toBe('PREMIUM');
    expect(await getPrisma().leaguePlanChange.count({ where: { leagueId: league.id } })).toBe(0);
  });

  it('lets a root admin who is not in the league move it to Platinum, which commissioners cannot pick, logging the root admin as the changer', async () => {
    const { league } = await createLeague();
    const rootAdmin = await createTestUser({ displayName: 'Plan Root Admin', isRootAdmin: true });

    const res = await getApp().inject({
      method: 'PUT',
      url: API_ROUTES.leagues.plan(league.id),
      headers: rootAdmin.headers,
      payload: { plan: LeaguePlan.PLATINUM },
    });

    expect(res.statusCode).toBe(200);
    expect(LeagueResponseSchema.parse(res.json()).league.planEntitlements.plan).toBe(LeaguePlan.PLATINUM);
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

  it('changes nothing and logs nothing when the league has left the plan the change started from, so the log never records a stale from-plan', async () => {
    const { commissioner, league } = await createLeague();
    const repository = new PrismaLeagueRepository(getAppPrisma());
    await repository.changePlan(league.id, { fromPlan: LeaguePlan.PREMIUM, toPlan: LeaguePlan.FREE, changedById: commissioner.user.id });

    // A second commissioner's change read the league while it was still on Premium.
    const stale = await repository.changePlan(league.id, { fromPlan: LeaguePlan.PREMIUM, toPlan: LeaguePlan.PRO, changedById: commissioner.user.id });

    expect(stale).toBeNull();
    const stored = await getPrisma().league.findUniqueOrThrow({ where: { id: league.id } });
    expect(stored.plan).toBe('FREE');
    const changes = await getPrisma().leaguePlanChange.findMany({ where: { leagueId: league.id } });
    expect(changes.map((change) => [change.fromPlan, change.toPlan])).toEqual([['PREMIUM', 'FREE']]);
  });

  it('lists all four plans in order, lowest first, each capped and only Platinum not offered to commissioners, for the comparison table', async () => {
    const user = await createTestUser({ displayName: 'Plan Reader' });

    const res = await getApp().inject({ method: 'GET', url: API_ROUTES.plans.list, headers: user.headers });

    expect(res.statusCode).toBe(200);
    const { plans } = LeaguePlanListResponseSchema.parse(res.json());
    expect(plans.map((plan) => plan.plan)).toEqual([LeaguePlan.FREE, LeaguePlan.PRO, LeaguePlan.PREMIUM, LeaguePlan.PLATINUM]);
    expect(plans[0]?.caps).toEqual({ ENTRIES_PER_CONTEST: 20, SPORTS_LEAGUES_PER_YEAR: 5 });
    expect(plans[3]?.caps).toEqual({ ENTRIES_PER_CONTEST: 500, SPORTS_LEAGUES_PER_YEAR: 50 });
    expect(plans.map((plan) => plan.commissionerSelectable)).toEqual([true, true, true, false]);
  });

  it('refuses a commissioner Platinum with 400 LEAGUE_PLAN_NOT_AVAILABLE, leaving the plan as it was and logging nothing', async () => {
    const { commissioner, league } = await createLeague();

    const res = await getApp().inject({
      method: 'PUT',
      url: API_ROUTES.leagues.plan(league.id),
      headers: commissioner.headers,
      payload: { plan: LeaguePlan.PLATINUM },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json<ErrorEnvelope>().error.code).toBe('LEAGUE_PLAN_NOT_AVAILABLE');
    expect((await getPrisma().league.findUniqueOrThrow({ where: { id: league.id } })).plan).toBe('PREMIUM');
    expect(await getPrisma().leaguePlanChange.count({ where: { leagueId: league.id } })).toBe(0);
  });

  it('lets a root admin extend one league\'s gift, logging who moved it from which date to which, the plan unchanged', async () => {
    const { league } = await createLeague();
    const rootAdmin = await createTestUser({ displayName: 'Gift Root Admin', isRootAdmin: true });
    const before = await getPrisma().league.findUniqueOrThrow({ where: { id: league.id } });

    const res = await getApp().inject({
      method: 'POST',
      url: `${API_ROUTES.leagues.detail(league.id)}/plan-renewal/extend`,
      headers: rootAdmin.headers,
      payload: { months: 12 },
    });

    expect(res.statusCode).toBe(200);
    const parsed = LeagueResponseSchema.parse(res.json()).league;
    expect(parsed.planEntitlements.plan).toBe(LeaguePlan.PREMIUM);
    expect(new Date(parsed.planRenewsAt).getTime()).toBeGreaterThan(before.planRenewsAt.getTime());
    const changes = await getPrisma().leaguePlanRenewalChange.findMany({ where: { leagueId: league.id } });
    expect(changes).toEqual([expect.objectContaining({
      fromRenewsAt: before.planRenewsAt,
      toRenewsAt: new Date(parsed.planRenewsAt),
      changedById: rootAdmin.user.id,
    })]);
  });

  it('puts a league its ended preview period moved to Free back on the plan it had when a root admin extends its gift, logging the plan change as theirs', async () => {
    const { league } = await createLeague();
    const rootAdmin = await createTestUser({ displayName: 'Gift Root Admin', isRootAdmin: true });
    const now = new Date();
    await getPrisma().league.update({ where: { id: league.id }, data: { planRenewsAt: new Date(now.getTime() - 60_000) } });
    await new PrismaLeagueRepository(getAppPrisma()).moveEndedPlansToFree(now);

    const res = await getApp().inject({
      method: 'POST',
      url: `${API_ROUTES.leagues.detail(league.id)}/plan-renewal/extend`,
      headers: rootAdmin.headers,
      payload: { months: 3 },
    });

    expect(res.statusCode).toBe(200);
    expect(LeagueResponseSchema.parse(res.json()).league.planEntitlements.plan).toBe(LeaguePlan.PREMIUM);
    expect(await getPrisma().leaguePlanChange.findMany({ where: { leagueId: league.id }, orderBy: { changedAt: 'asc' } })).toEqual([
      expect.objectContaining({ fromPlan: LeaguePlan.PREMIUM, toPlan: LeaguePlan.FREE, changeReason: LeaguePlanChangeReason.PREVIEW_ENDED, changedById: null }),
      expect.objectContaining({
        fromPlan: LeaguePlan.FREE, toPlan: LeaguePlan.PREMIUM, changeReason: LeaguePlanChangeReason.GIFT_RESTORED, changedById: rootAdmin.user.id,
      }),
    ]);
  });

  it('leaves a league its commissioner moved to Free on Free when a root admin extends its gift', async () => {
    const { commissioner, league } = await createLeague();
    const rootAdmin = await createTestUser({ displayName: 'Gift Root Admin', isRootAdmin: true });
    await getApp().inject({
      method: 'PUT',
      url: API_ROUTES.leagues.plan(league.id),
      headers: commissioner.headers,
      payload: { plan: LeaguePlan.FREE },
    });

    const res = await getApp().inject({
      method: 'POST',
      url: `${API_ROUTES.leagues.detail(league.id)}/plan-renewal/extend`,
      headers: rootAdmin.headers,
      payload: { months: 12 },
    });

    expect(res.statusCode).toBe(200);
    expect(LeagueResponseSchema.parse(res.json()).league.planEntitlements.plan).toBe(LeaguePlan.FREE);
  });

  it('refuses a commissioner extending their own gift with 403, changing and logging nothing', async () => {
    const { commissioner, league } = await createLeague();
    const before = await getPrisma().league.findUniqueOrThrow({ where: { id: league.id } });

    const res = await getApp().inject({
      method: 'POST',
      url: `${API_ROUTES.leagues.detail(league.id)}/plan-renewal/extend`,
      headers: commissioner.headers,
      payload: { months: 12 },
    });

    expect(res.statusCode).toBe(403);
    expect((await getPrisma().league.findUniqueOrThrow({ where: { id: league.id } })).planRenewsAt).toEqual(before.planRenewsAt);
    expect(await getPrisma().leaguePlanRenewalChange.count({ where: { leagueId: league.id } })).toBe(0);
  });

  it('refuses an extension of zero or more than 24 months with 400', async () => {
    const { league } = await createLeague();
    const rootAdmin = await createTestUser({ displayName: 'Gift Root Admin', isRootAdmin: true });

    for (const months of [0, 25]) {
      const res = await getApp().inject({
        method: 'POST',
        url: `${API_ROUTES.leagues.detail(league.id)}/plan-renewal/extend`,
        headers: rootAdmin.headers,
        payload: { months },
      });
      expect(res.statusCode).toBe(400);
    }
  });

  it('extends every running gift that ends sooner, leaving ended ones alone and logging each move', async () => {
    const rootAdmin = await createTestUser({ displayName: 'Gift Root Admin', isRootAdmin: true });
    const { league: running } = await createLeague();
    const { league: ended } = await createLeague();
    const endedAt = new Date(Date.now() - 24 * 60 * 60_000);
    await getPrisma().league.update({ where: { id: ended.id }, data: { planRenewsAt: endedAt } });

    const res = await getApp().inject({
      method: 'POST',
      url: `${API_ROUTES.leagues.list}plan-renewals/extend`,
      headers: rootAdmin.headers,
      payload: { months: 12 },
    });

    expect(res.statusCode).toBe(200);
    const body = ExtendRunningPlanRenewalsResponseSchema.parse(res.json());
    expect(body.extendedCount).toBeGreaterThanOrEqual(1);
    const renewsAt = new Date(body.renewsAt);
    expect((await getPrisma().league.findUniqueOrThrow({ where: { id: running.id } })).planRenewsAt).toEqual(renewsAt);
    expect((await getPrisma().league.findUniqueOrThrow({ where: { id: ended.id } })).planRenewsAt).toEqual(endedAt);
    expect(await getPrisma().leaguePlanRenewalChange.findMany({ where: { leagueId: running.id } }))
      .toEqual([expect.objectContaining({ toRenewsAt: renewsAt, changedById: rootAdmin.user.id })]);
    expect(await getPrisma().leaguePlanRenewalChange.count({ where: { leagueId: ended.id } })).toBe(0);
  });

  it('lets an extension that starts while another write holds the league wait for it, then log the move from the date that write left', async () => {
    const { league } = await createLeague();
    const rootAdmin = await createTestUser({ displayName: 'Gift Root Admin', isRootAdmin: true });
    const repo = new PrismaLeagueRepository(getAppPrisma());
    const movedMeanwhile = new Date(Date.now() + 200 * 24 * 60 * 60_000);
    const later = new Date(Date.now() + 400 * 24 * 60 * 60_000);
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let moved: () => void = () => undefined;
    const movedSignal = new Promise<void>((resolve) => { moved = resolve; });

    const holder = getPrisma().$transaction(async (tx) => {
      await tx.league.update({ where: { id: league.id }, data: { planRenewsAt: movedMeanwhile } });
      moved();
      await held;
    });
    await movedSignal;
    const extendOne = repo.extendPlanRenewal(league.id, { renewsAt: later, changedById: rootAdmin.user.id });
    await new Promise((resolve) => setTimeout(resolve, 300));
    release();
    await holder;

    await expect(extendOne).resolves.toMatchObject({ planRenewsAt: later });
    expect(await getPrisma().leaguePlanRenewalChange.findMany({ where: { leagueId: league.id } }))
      .toEqual([expect.objectContaining({ fromRenewsAt: movedMeanwhile, toRenewsAt: later })]);
  });

  it('lets an extend-all that starts while another write holds a running league wait for it, then log that league\'s move from the date that write left', async () => {
    const { league } = await createLeague();
    const rootAdmin = await createTestUser({ displayName: 'Gift Root Admin', isRootAdmin: true });
    const repo = new PrismaLeagueRepository(getAppPrisma());
    const movedMeanwhile = new Date(Date.now() + 200 * 24 * 60 * 60_000);
    const later = new Date(Date.now() + 400 * 24 * 60 * 60_000);
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let moved: () => void = () => undefined;
    const movedSignal = new Promise<void>((resolve) => { moved = resolve; });

    const holder = getPrisma().$transaction(async (tx) => {
      await tx.league.update({ where: { id: league.id }, data: { planRenewsAt: movedMeanwhile } });
      moved();
      await held;
    });
    await movedSignal;
    const extendAll = repo.extendRunningPlanRenewals({ renewsAt: later, now: new Date(), changedById: rootAdmin.user.id });
    await new Promise((resolve) => setTimeout(resolve, 300));
    release();
    await holder;

    await expect(extendAll).resolves.toBeGreaterThanOrEqual(1);
    expect(await getPrisma().leaguePlanRenewalChange.findMany({ where: { leagueId: league.id } }))
      .toEqual([expect.objectContaining({ fromRenewsAt: movedMeanwhile, toRenewsAt: later })]);
  });

  it('moves every league whose preview period has ended to Free, logged as made by no one, once, leaving a running gift alone', async () => {
    const repo = new PrismaLeagueRepository(getAppPrisma());
    const { league: ended } = await createLeague();
    const { league: running } = await createLeague();
    const now = new Date();
    await getPrisma().league.update({ where: { id: ended.id }, data: { planRenewsAt: new Date(now.getTime() - 60_000) } });

    const moved = await repo.moveEndedPlansToFree(now);
    const again = await repo.moveEndedPlansToFree(now);

    expect(moved).toContainEqual({ leagueId: ended.id, fromPlan: LeaguePlan.PREMIUM });
    expect(moved.map((league) => league.leagueId)).not.toContain(running.id);
    expect(again.map((league) => league.leagueId)).not.toContain(ended.id);
    expect((await getPrisma().league.findUniqueOrThrow({ where: { id: ended.id } })).plan).toBe(LeaguePlan.FREE);
    expect((await getPrisma().league.findUniqueOrThrow({ where: { id: running.id } })).plan).toBe(LeaguePlan.PREMIUM);
    expect(await getPrisma().leaguePlanChange.findMany({ where: { leagueId: ended.id } }))
      .toEqual([expect.objectContaining({ fromPlan: LeaguePlan.PREMIUM, toPlan: LeaguePlan.FREE, changedById: null })]);
    expect(await getPrisma().leaguePlanChange.count({ where: { leagueId: running.id } })).toBe(0);
  });

  it('stamps each move to Free with the time the sweep picked the league by, not the database clock', async () => {
    const repo = new PrismaLeagueRepository(getAppPrisma());
    const { league } = await createLeague();
    const sweptAt = new Date(Date.now() - 60 * 60_000);
    await getPrisma().league.update({ where: { id: league.id }, data: { planRenewsAt: new Date(sweptAt.getTime() - 60_000) } });

    await repo.moveEndedPlansToFree(sweptAt);

    expect(await getPrisma().leaguePlanChange.findMany({ where: { leagueId: league.id } }))
      .toEqual([expect.objectContaining({ toPlan: LeaguePlan.FREE, changedAt: sweptAt })]);
  });

  it('leaves an ended league on its plan when an extension holding it commits while the move to Free waits', async () => {
    const repo = new PrismaLeagueRepository(getAppPrisma());
    const { league } = await createLeague();
    const now = new Date();
    await getPrisma().league.update({ where: { id: league.id }, data: { planRenewsAt: new Date(now.getTime() - 60_000) } });
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let extended: () => void = () => undefined;
    const extendedSignal = new Promise<void>((resolve) => { extended = resolve; });

    const holder = getPrisma().$transaction(async (tx) => {
      await tx.league.update({ where: { id: league.id }, data: { planRenewsAt: new Date(now.getTime() + 90 * 24 * 60 * 60_000) } });
      extended();
      await held;
    });
    await extendedSignal;
    const move = repo.moveEndedPlansToFree(now);
    await new Promise((resolve) => setTimeout(resolve, 300));
    release();
    await holder;

    expect((await move).map((moved) => moved.leagueId)).not.toContain(league.id);
    expect((await getPrisma().league.findUniqueOrThrow({ where: { id: league.id } })).plan).toBe(LeaguePlan.PREMIUM);
    expect(await getPrisma().leaguePlanChange.count({ where: { leagueId: league.id } })).toBe(0);
  });

  it('finds the active leagues not on Free whose preview period ends within the window, soonest first, for the reminders', async () => {
    const repo = new PrismaLeagueRepository(getAppPrisma());
    const now = new Date();
    const at = (days: number) => new Date(now.getTime() + days * 24 * 60 * 60_000);
    const { league: inWeek } = await createLeague();
    const { league: tomorrow } = await createLeague();
    const { league: free } = await createLeague();
    const { league: inactive } = await createLeague();
    const { league: later } = await createLeague();
    await getPrisma().league.update({ where: { id: inWeek.id }, data: { planRenewsAt: at(7) } });
    await getPrisma().league.update({ where: { id: tomorrow.id }, data: { planRenewsAt: at(1), plan: LeaguePlan.PRO } });
    await getPrisma().league.update({ where: { id: free.id }, data: { planRenewsAt: at(2), plan: LeaguePlan.FREE } });
    await getPrisma().league.update({ where: { id: inactive.id }, data: { planRenewsAt: at(2), isActive: false } });
    await getPrisma().league.update({ where: { id: later.id }, data: { planRenewsAt: at(40) } });
    const mine = new Set([inWeek.id, tomorrow.id, free.id, inactive.id, later.id]);

    const ending = await repo.findPlansEndingBetween(now, at(31));

    expect(ending.filter((league) => mine.has(league.id)).map((league) => league.id)).toEqual([tomorrow.id, inWeek.id]);
  });

  it('refuses a commissioner extending every gift with 403', async () => {
    const { commissioner } = await createLeague();

    const res = await getApp().inject({
      method: 'POST',
      url: `${API_ROUTES.leagues.list}plan-renewals/extend`,
      headers: commissioner.headers,
      payload: { months: 12 },
    });

    expect(res.statusCode).toBe(403);
  });

  it('lets a visitor without a session read the plan list, for the public Plans page', async () => {
    const res = await getApp().inject({ method: 'GET', url: API_ROUTES.plans.list });

    expect(res.statusCode).toBe(200);
    expect(LeaguePlanListResponseSchema.parse(res.json()).plans).toHaveLength(4);
  });
});
