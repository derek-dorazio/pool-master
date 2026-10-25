/**
 * LeaguePlanService (#945): moves a league to another plan. Any commissioner of the league, or a
 * root admin, may pick a plan at any time, free; it applies at once, and every change is logged
 * with who made it. Moving to the plan the league is already on changes and logs nothing. A plan
 * not offered yet (Platinum, plans/payments.md §3) only a root admin may set.
 *
 * It also extends gifted plans (#986): a root admin moves one league's renewal date, or that of
 * every league whose gift still runs, out to some months from now. A date never moves earlier,
 * and every move is logged with who made it and to when.
 *
 * Once a league's date has passed, it moves to Free (#986, plans/payments.md §3): the lifecycle
 * scheduler's sweep calls `moveEndedToFree`, after the reminders. There is no grace period, and
 * each move is logged as a plan change made by no one.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { LeagueRepository } from '@poolmaster/shared/db';
import { LeaguePlan, type League } from '@poolmaster/shared/domain';
import { LeagueNotFoundError, LeagueOperationError } from '../leagues/service';
import type { PlanEntitlementsService } from './plan-entitlements-service';

/**
 * How long the Premium gift every new league starts with runs (plans/payments.md §3). The
 * `leagues.plan_renews_at` column default adds the same six months at signup.
 */
export const PREMIUM_PREVIEW_PERIOD_MONTHS = 6;

export interface LeaguePlanServiceDeps {
  leagues: Pick<LeagueRepository, 'findById' | 'changePlan' | 'extendPlanRenewal' | 'extendRunningPlanRenewals' | 'moveEndedPlansToFree' | 'findLastPlanChange'>;
  planEntitlements: Pick<PlanEntitlementsService, 'forPlan'>;
  logger?: FastifyBaseLogger;
  now?: () => Date;
}

/** Who is changing a plan: a commissioner of the league, or a root admin. */
export interface LeaguePlanActor {
  userId: string;
  isRootAdmin: boolean;
}

export class LeaguePlanService {
  constructor(private readonly deps: LeaguePlanServiceDeps) {}

  async changePlan(leagueId: string, plan: LeaguePlan, actor: LeaguePlanActor): Promise<League> {
    const { leagues, logger } = this.deps;
    logger?.debug({ action: 'leaguePlan.change.enter', data: { leagueId, plan } }, 'Changing league plan');
    const league = await leagues.findById(leagueId);
    if (!league) {
      logger?.warn({ action: 'leaguePlan.change.notFound', data: { leagueId } }, 'Cannot change the plan of a missing league');
      throw new LeagueNotFoundError(leagueId);
    }
    if (!league.isActive) {
      logger?.warn({ action: 'leaguePlan.change.readOnlyInactive', data: { leagueId } }, 'Rejected plan change for inactive league');
      throw new LeagueOperationError(
        'Inactive leagues are read-only outside lifecycle actions',
        'LEAGUE_DETAILS_READ_ONLY_WHEN_INACTIVE',
      );
    }
    if (league.plan === plan) {
      logger?.debug({ action: 'leaguePlan.change.unchanged', data: { leagueId, plan } }, 'League is already on that plan');
      return league;
    }
    if (!actor.isRootAdmin && !this.deps.planEntitlements.forPlan(plan).commissionerSelectable) {
      logger?.warn({ action: 'leaguePlan.change.notSelectable', data: { leagueId, plan } }, 'Rejected a plan commissioners cannot pick yet');
      throw new LeagueOperationError('That plan is not available yet.', 'LEAGUE_PLAN_NOT_AVAILABLE');
    }
    const updated = await leagues.changePlan(leagueId, { fromPlan: league.plan, toPlan: plan, changedById: actor.userId });
    if (!updated) {
      logger?.warn({ action: 'leaguePlan.change.conflict', data: { leagueId, fromPlan: league.plan, toPlan: plan } }, 'League plan changed during the change');
      throw new LeagueOperationError(
        'The plan was just changed by someone else. Reload to see it, then try again.',
        'LEAGUE_PLAN_CHANGED',
        409,
      );
    }
    logger?.info({
      action: 'leaguePlan.change.success',
      data: { leagueId, fromPlan: league.plan, toPlan: plan, changedById: actor.userId },
    }, 'Changed league plan');
    return updated;
  }

  /**
   * Moves one league's renewal date out to `months` from now, unless it is already later. A league
   * the end of its gift moved to Free goes back to the plan it had, as the gift runs again (#1026).
   * Root admin only.
   */
  async extendRenewal(leagueId: string, months: number, changedById: string): Promise<League> {
    const { leagues, logger } = this.deps;
    const renewsAt = addMonths(this.now(), months);
    logger?.debug({ action: 'leaguePlan.extend.enter', data: { leagueId, months } }, 'Extending league plan renewal');
    const [league, lastChange] = await Promise.all([leagues.findById(leagueId), leagues.findLastPlanChange(leagueId)]);
    // The end of the gift is the one change made by no one, on or after the league's date.
    const endedGift = league !== null && lastChange !== null && lastChange.changedById === null
      && lastChange.toPlan === LeaguePlan.FREE && lastChange.changedAt >= league.planRenewsAt;
    const restorePlan = endedGift ? { fromPlan: lastChange.toPlan, toPlan: lastChange.fromPlan } : undefined;
    const updated = await leagues.extendPlanRenewal(leagueId, { renewsAt, changedById, restorePlan });
    if (!updated) {
      logger?.warn({ action: 'leaguePlan.extend.notFound', data: { leagueId } }, 'Cannot extend the plan of a missing league');
      throw new LeagueNotFoundError(leagueId);
    }
    logger?.info({
      action: 'leaguePlan.extend.success',
      data: { leagueId, renewsAt: updated.planRenewsAt.toISOString(), plan: updated.plan, changedById },
    }, 'Extended league plan renewal');
    return updated;
  }

  /** Moves every running gift's renewal date out to `months` from now, where it ends sooner. Root admin only. */
  async extendRunningRenewals(months: number, changedById: string): Promise<{ extendedCount: number; renewsAt: Date }> {
    const { leagues, logger } = this.deps;
    const now = this.now();
    const renewsAt = addMonths(now, months);
    logger?.debug({ action: 'leaguePlan.extendAll.enter', data: { months } }, 'Extending every running plan renewal');
    const extendedCount = await leagues.extendRunningPlanRenewals({ renewsAt, now, changedById });
    logger?.info({
      action: 'leaguePlan.extendAll.success',
      data: { extendedCount, renewsAt: renewsAt.toISOString(), changedById },
    }, 'Extended every running plan renewal');
    return { extendedCount, renewsAt };
  }

  /** Moves every league whose renewal date has passed by `now` to Free. Returns how many moved. */
  async moveEndedToFree(now: Date): Promise<number> {
    const moved = await this.deps.leagues.moveEndedPlansToFree(now);
    for (const { leagueId, fromPlan } of moved) {
      this.deps.logger?.info({ action: 'leaguePlan.ended.movedToFree', data: { leagueId, fromPlan } }, 'Moved a league to Free at its renewal date');
    }
    return moved.length;
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }
}

/**
 * `date` plus whole calendar months, in UTC, held at the month's last day when the day doesn't
 * exist there (Aug 31 + 6 is Feb 28), as Postgres adds the six months a new league is gifted.
 */
function addMonths(date: Date, months: number): Date {
  const moved = new Date(date);
  moved.setUTCDate(1);
  moved.setUTCMonth(moved.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(moved.getUTCFullYear(), moved.getUTCMonth() + 1, 0)).getUTCDate();
  moved.setUTCDate(Math.min(date.getUTCDate(), lastDay));
  return moved;
}
