/**
 * PlanEntitlementsService (#944): the one place a league's plan becomes what the league may do,
 * its two caps and its features, read from PLAN_CONFIG. Every check asks it about a cap or a
 * feature; nothing else compares plans (`poolmaster/no-plan-branching`, which exempts this
 * folder).
 *
 * Caps are checked live against the plan the league is on now, and a lower plan only stops new
 * things: what a league already has is never taken away (plans/monetization-strategy.md,
 * *Moving to a lower plan*).
 */

import type { LeagueRepository } from '@poolmaster/shared/db';
import { LEAGUE_PLANS, LeaguePlan, PlanFeature, type PlanCap } from '@poolmaster/shared/domain';
import type { PlanConfig } from '@poolmaster/shared/dto';
import { LeagueNotFoundError } from '../leagues/service';

/** What a league on one plan may do. */
export interface PlanEntitlements {
  plan: LeaguePlan;
  /** Each cap's limit: a whole number, or null for unlimited. */
  caps: Readonly<Record<PlanCap, number | null>>;
  /** The features the plan has, each because it starts at this plan or a lower one. */
  features: ReadonlySet<PlanFeature>;
  /** Whether a commissioner may move their league to it; a root admin may set any plan. */
  commissionerSelectable: boolean;
}

/** Plans commissioners can't pick yet (Derek 2026-10-24, plans/payments.md §3): shown as coming soon. */
const COMING_SOON_PLANS: ReadonlySet<LeaguePlan> = new Set([LeaguePlan.PLATINUM]);

export interface PlanEntitlementsServiceDeps {
  leagues: Pick<LeagueRepository, 'findById'>;
  /** PLAN_CONFIG as it stands now; read on every call, so a save applies within the settings refresh. */
  readConfig: () => PlanConfig;
}

export class PlanEntitlementsService {
  constructor(private readonly deps: PlanEntitlementsServiceDeps) {}

  /** What a league on `plan` may do under the current PLAN_CONFIG. */
  forPlan(plan: LeaguePlan): PlanEntitlements {
    return resolvePlanEntitlements(plan, this.deps.readConfig());
  }

  /** What the league may do on the plan it is on now. */
  async forLeague(leagueId: string): Promise<PlanEntitlements> {
    const league = await this.deps.leagues.findById(leagueId);
    if (!league) {
      throw new LeagueNotFoundError(leagueId);
    }
    return this.forPlan(league.plan);
  }
}

/** A plan's caps and features under `config`. A feature is in every plan from the one it starts at up. */
export function resolvePlanEntitlements(plan: LeaguePlan, config: PlanConfig): PlanEntitlements {
  const rank = LEAGUE_PLANS.indexOf(plan);
  const caps = {
    ENTRIES_PER_CONTEST: config.caps.ENTRIES_PER_CONTEST[plan],
    SPORTS_LEAGUES_PER_YEAR: config.caps.SPORTS_LEAGUES_PER_YEAR[plan],
  } satisfies Record<PlanCap, number | null>;
  const features = new Set(
    Object.values(PlanFeature).filter((feature) => LEAGUE_PLANS.indexOf(config.features[feature]) <= rank),
  );
  return { plan, caps, features, commissionerSelectable: !COMING_SOON_PLANS.has(plan) };
}
