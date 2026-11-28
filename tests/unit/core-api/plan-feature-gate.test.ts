import { LeaguePlan, PlanFeature } from '@poolmaster/shared/domain';
import { PlanEntitlementsService } from '../../../packages/core-api/src/modules/plans/plan-entitlements-service';
import { describePlanFeatureGate, featuresNeeded, requirePlanFeatures } from '../../../packages/core-api/src/modules/plans/plan-feature-gate';
import { PLAN_SETTINGS } from '../../../packages/core-api/src/modules/plans/plan-settings';
import { buildLeague } from '../../factories';
import { fakeLogger } from '../../support/fake-logger';

// The plan feature gate (#948): a route whose features the league's plan lacks answers 403
// PLAN_FEATURE_NOT_INCLUDED naming the missing feature, and an earlier year also needs PAST_YEARS.

function createReply() {
  const reply = {
    statusCode: 200,
    payload: undefined as unknown,
    status(code: number) {
      reply.statusCode = code;
      return reply;
    },
    send(payload: unknown) {
      reply.payload = payload;
      return reply;
    },
  };
  return reply;
}

function entitlementsFor(plan: LeaguePlan) {
  const league = buildLeague({ plan });
  const service = new PlanEntitlementsService({
    leagues: { findById: (id) => Promise.resolve(id === league.id ? league : null) },
    readConfig: () => PLAN_SETTINGS.defaults({}),
  });
  return { league, service };
}

async function run(hook: ReturnType<typeof requirePlanFeatures>, request: { params: Record<string, unknown>; query?: Record<string, unknown>; isRootAdmin?: boolean }) {
  const reply = createReply();
  const logger = fakeLogger();
  await hook.call(
    {} as never,
    {
      authUser: { userId: 'user-1', email: 'user-1@unit.test', isRootAdmin: request.isRootAdmin ?? false, sessionId: null },
      params: request.params,
      query: request.query ?? {},
      log: logger,
    } as never,
    reply as never,
  );
  return { reply, logger };
}

describe('featuresNeeded', () => {
  it('adds PAST_YEARS only for a championship year the league has closed', () => {
    expect(featuresNeeded([PlanFeature.CHAMPIONSHIP], true)).toEqual([PlanFeature.CHAMPIONSHIP, PlanFeature.PAST_YEARS]);
    expect(featuresNeeded([PlanFeature.CHAMPIONSHIP], false)).toEqual([PlanFeature.CHAMPIONSHIP]);
  });
});

describe('requirePlanFeatures', () => {
  it('lets a request through when the league\'s plan has every feature', async () => {
    const { league, service } = entitlementsFor(LeaguePlan.PRO);

    const { reply } = await run(requirePlanFeatures(service, [PlanFeature.CHAMPIONSHIP, PlanFeature.PAST_YEARS]), { params: { id: league.id } });

    expect(reply.payload).toBeUndefined();
  });

  it('refuses with 403 PLAN_FEATURE_NOT_INCLUDED naming the first missing feature, never the plan, and logs it', async () => {
    const { league, service } = entitlementsFor(LeaguePlan.FREE);

    const { reply, logger } = await run(requirePlanFeatures(service, [PlanFeature.CHAMPIONSHIP]), { params: { id: league.id } });

    expect(reply.statusCode).toBe(403);
    expect(reply.payload).toEqual({
      error: { code: 'PLAN_FEATURE_NOT_INCLUDED', message: 'This league\'s plan does not include this.', details: { feature: PlanFeature.CHAMPIONSHIP } },
    });
    expect(JSON.stringify(reply.payload)).not.toMatch(/FREE|Free/);
    expect(logger.info).toHaveBeenCalledWith(
      { action: 'planFeature.gate.denied', data: { leagueId: league.id, feature: PlanFeature.CHAMPIONSHIP, userId: 'user-1' } },
      expect.any(String),
    );
  });

  it('holds a root admin to the league\'s plan, so testing a lower plan shows what members see', async () => {
    const { league, service } = entitlementsFor(LeaguePlan.FREE);

    const { reply } = await run(requirePlanFeatures(service, [PlanFeature.RECORD_BOOK]), { params: { id: league.id }, isRootAdmin: true });

    expect(reply.statusCode).toBe(403);
  });

  it('asks for PAST_YEARS when the request reads a closed year, and not for a year still open after the calendar turned (#2021)', async () => {
    // Premium with PAST_YEARS moved up to Platinum: the championship, but only open years.
    const league = buildLeague({ plan: LeaguePlan.PREMIUM });
    const defaults = PLAN_SETTINGS.defaults({});
    const service = new PlanEntitlementsService({
      leagues: { findById: () => Promise.resolve(league) },
      readConfig: () => ({ ...defaults, features: { ...defaults.features, [PlanFeature.PAST_YEARS]: LeaguePlan.PLATINUM } }),
    });
    const closedYears = { isClosed: jest.fn(({ championshipYear }: { championshipYear: number }) => Promise.resolve(championshipYear === 2024)) };
    const hook = requirePlanFeatures(service, [PlanFeature.CHAMPIONSHIP], {
      year: { yearOf: (request) => (request.query as { year: number }).year, closedYears },
    });

    const closed = await run(hook, { params: { id: league.id }, query: { year: 2024 } });
    // 2025 is still open in 2026 while its Super Bowl is to play.
    const open = await run(hook, { params: { id: league.id }, query: { year: 2025 } });

    expect(closed.reply.statusCode).toBe(403);
    expect(closed.reply.payload).toMatchObject({ error: { details: { feature: PlanFeature.PAST_YEARS } } });
    expect(open.reply.payload).toBeUndefined();
    expect(closedYears.isClosed).toHaveBeenCalledWith({ leagueId: league.id, championshipYear: 2025 });
  });

  it('answers 404 LEAGUE_NOT_FOUND for a league that does not exist', async () => {
    const { service } = entitlementsFor(LeaguePlan.PLATINUM);

    const { reply } = await run(requirePlanFeatures(service, [PlanFeature.CHAMPIONSHIP]), { params: { id: 'missing-league' } });

    expect(reply.statusCode).toBe(404);
    expect(reply.payload).toMatchObject({ error: { code: 'LEAGUE_NOT_FOUND' } });
  });

  it('answers 400 LEAGUE_ID_REQUIRED without reading a plan when the path names no league', async () => {
    const forLeague = jest.fn();

    const { reply } = await run(requirePlanFeatures({ forLeague }, [PlanFeature.CHAMPIONSHIP]), { params: {} });

    expect(reply.statusCode).toBe(400);
    expect(reply.payload).toMatchObject({ error: { code: 'LEAGUE_ID_REQUIRED' } });
    expect(forLeague).not.toHaveBeenCalled();
  });

  it('lets a plan read that fails for any other reason through to the error handler', async () => {
    const forLeague = jest.fn().mockRejectedValue(new Error('database unavailable'));

    await expect(run(requirePlanFeatures({ forLeague }, [PlanFeature.CHAMPIONSHIP]), { params: { id: 'league-1' } }))
      .rejects.toThrow('database unavailable');
  });
});

describe('describePlanFeatureGate', () => {
  it('names the features a route needs, and PAST_YEARS for a closed year when the route reads one', () => {
    expect(describePlanFeatureGate([PlanFeature.CHAMPIONSHIP])).toContain('unless the league\'s plan has CHAMPIONSHIP (root admins too).');
    expect(describePlanFeatureGate([PlanFeature.CHAMPIONSHIP], true))
      .toContain('has CHAMPIONSHIP, PAST_YEARS for a championship year the league has closed (root admins too).');
  });
});

