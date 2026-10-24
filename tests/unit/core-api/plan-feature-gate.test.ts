import { LeaguePlan, PlanFeature, championshipYear } from '@poolmaster/shared/domain';
import { PlanEntitlementsService } from '../../../packages/core-api/src/modules/plans/plan-entitlements-service';
import { featuresNeeded, requirePlanFeatures } from '../../../packages/core-api/src/modules/plans/plan-feature-gate';
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

const NOW = new Date('2026-06-01T12:00:00.000Z');
const THIS_YEAR = championshipYear(NOW);

describe('featuresNeeded', () => {
  it('adds PAST_YEARS only for a year before the current one', () => {
    expect(featuresNeeded([PlanFeature.CHAMPIONSHIP], THIS_YEAR - 1, NOW)).toEqual([PlanFeature.CHAMPIONSHIP, PlanFeature.PAST_YEARS]);
    expect(featuresNeeded([PlanFeature.CHAMPIONSHIP], THIS_YEAR, NOW)).toEqual([PlanFeature.CHAMPIONSHIP]);
    expect(featuresNeeded([PlanFeature.CHAMPIONSHIP], undefined, NOW)).toEqual([PlanFeature.CHAMPIONSHIP]);
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

  it('asks for PAST_YEARS when the request reads an earlier year, and not for the current one', async () => {
    // Premium with PAST_YEARS moved up to Platinum: the championship, but only this year.
    const league = buildLeague({ plan: LeaguePlan.PREMIUM });
    const defaults = PLAN_SETTINGS.defaults({});
    const service = new PlanEntitlementsService({
      leagues: { findById: () => Promise.resolve(league) },
      readConfig: () => ({ ...defaults, features: { ...defaults.features, [PlanFeature.PAST_YEARS]: LeaguePlan.PLATINUM } }),
    });
    const hook = requirePlanFeatures(service, [PlanFeature.CHAMPIONSHIP], {
      yearOf: (request) => (request.query as { year: number }).year,
    });
    const currentYear = championshipYear(new Date());

    const earlier = await run(hook, { params: { id: league.id }, query: { year: currentYear - 1 } });
    const current = await run(hook, { params: { id: league.id }, query: { year: currentYear } });

    expect(earlier.reply.statusCode).toBe(403);
    expect(earlier.reply.payload).toMatchObject({ error: { details: { feature: PlanFeature.PAST_YEARS } } });
    expect(current.reply.payload).toBeUndefined();
  });

  it('answers 404 LEAGUE_NOT_FOUND for a league that does not exist', async () => {
    const { service } = entitlementsFor(LeaguePlan.PLATINUM);

    const { reply } = await run(requirePlanFeatures(service, [PlanFeature.CHAMPIONSHIP]), { params: { id: 'missing-league' } });

    expect(reply.statusCode).toBe(404);
    expect(reply.payload).toMatchObject({ error: { code: 'LEAGUE_NOT_FOUND' } });
  });
});
