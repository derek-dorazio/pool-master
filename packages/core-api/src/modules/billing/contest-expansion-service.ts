/**
 * ContestExpansionService (#987): a contest's entry cap and its expansions (plans/payments.md
 * §4, §5). A commissioner expands a contest to a band on its plan's price list while it still
 * takes entries; a root admin can give any expansion free, with a reason. Payments are off until
 * checkout is built (#981), so a commissioner's expansion is free and its history line says so:
 * $0, "free while payments are off". Nothing pretends a charge happened.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { ContestExpansionRepository, ContestRepository } from '@poolmaster/shared/db';
import { ContestStatus, LeaguePaymentKind, type Contest } from '@poolmaster/shared/domain';
import type { ApiErrorCode, BillingConfig, ContestExpansionResponse } from '@poolmaster/shared/dto';
import { ContestNotFoundError, type ContestService } from '../contests/service';
import { contestEntriesCap, type PlanEntitlementsService } from '../plans/plan-entitlements-service';
import { contestExpansionOffers } from './contest-expansion-offers';

export class ContestExpansionError extends Error {
  constructor(message: string, readonly code: ApiErrorCode, readonly statusCode: number) {
    super(message);
    this.name = 'ContestExpansionError';
  }
}

export interface ContestExpansionServiceDeps {
  contests: Pick<ContestRepository, 'findById'>;
  expansions: ContestExpansionRepository;
  planEntitlements: Pick<PlanEntitlementsService, 'forLeague'>;
  entryWindow: Pick<ContestService, 'areEntriesOpen'>;
  /** BILLING_CONFIG as it stands now. */
  readConfig: () => BillingConfig;
  logger: FastifyBaseLogger;
}

export class ContestExpansionService {
  constructor(private readonly deps: ContestExpansionServiceDeps) {}

  /** The contest's cap, entries and the bands it can be expanded to. */
  async getExpansion(leagueId: string, contestId: string): Promise<ContestExpansionResponse> {
    const contest = await this.requireContest(leagueId, contestId);
    return this.describe(contest);
  }

  /**
   * A commissioner expands the contest to an offered band, from its creation until it stops
   * taking entries: free, while payments are off.
   */
  async expand(leagueId: string, contestId: string, entriesPerContest: number, userId: string): Promise<ContestExpansionResponse> {
    const { logger } = this.deps;
    logger.debug({ action: 'contestExpansion.expand.enter', data: { leagueId, contestId, entriesPerContest } }, 'Expanding contest');
    const contest = await this.requireContest(leagueId, contestId);
    const state = await this.describe(contest);
    if (state.paymentsEnabled) {
      logger.warn({ action: 'contestExpansion.expand.checkoutUnavailable', data: { contestId } }, 'Refused expansion: payments are on but checkout is not built');
      throw new ContestExpansionError(
        'Payments are switched on, but paying for an expansion isn\'t available yet. A root admin can switch payments off to expand free.',
        'PAYMENTS_CHECKOUT_UNAVAILABLE',
        409,
      );
    }
    if (!state.expandable) {
      logger.warn({ action: 'contestExpansion.expand.closed', data: { contestId, status: contest.status } }, 'Refused expansion of a contest that takes no entries');
      throw new ContestExpansionError('This contest no longer takes entries, so it can\'t be expanded.', 'CONTEST_EXPANSION_CLOSED', 409);
    }
    if (!state.offers.some((offer) => offer.entriesPerContest === entriesPerContest)) {
      logger.warn({ action: 'contestExpansion.expand.bandUnavailable', data: { contestId, entriesPerContest, cap: state.entriesPerContest } }, 'Refused an expansion band not offered');
      throw new ContestExpansionError(
        `This contest can't be expanded to ${entriesPerContest} entries. Reload to see the sizes it can take.`,
        'CONTEST_EXPANSION_BAND_UNAVAILABLE',
        409,
      );
    }
    await this.write(contest, entriesPerContest, userId, LeaguePaymentKind.CONTEST_EXPANSION_PAYMENTS_OFF, 'free while payments are off');
    logger.info({ action: 'contestExpansion.expand.success', data: { leagueId, contestId, entriesPerContest, userId } }, 'Expanded contest free while payments are off');
    return this.describe(contest);
  }

  /** A root admin gives the contest any expansion above its cap, free, with a reason; at any time. */
  async grant(
    leagueId: string,
    contestId: string,
    entriesPerContest: number,
    reason: string,
    userId: string,
  ): Promise<ContestExpansionResponse> {
    const { logger } = this.deps;
    logger.debug({ action: 'contestExpansion.grant.enter', data: { leagueId, contestId, entriesPerContest } }, 'Granting contest expansion');
    const contest = await this.requireContest(leagueId, contestId);
    const state = await this.describe(contest);
    if (state.entriesPerContest === null || entriesPerContest <= state.entriesPerContest) {
      this.refuseNotAbove(contestId, entriesPerContest, state.entriesPerContest);
    }
    await this.write(contest, entriesPerContest, userId, LeaguePaymentKind.CONTEST_EXPANSION_GRANT, `given free by Poolmaster: ${reason.trim()}`);
    logger.info({ action: 'contestExpansion.grant.success', data: { leagueId, contestId, entriesPerContest, userId } }, 'Granted contest expansion');
    return this.describe(contest);
  }

  private async write(contest: Contest, entriesPerContest: number, payerId: string, kind: LeaguePaymentKind, note: string): Promise<void> {
    const result = await this.deps.expansions.expand({
      contestId: contest.id,
      leagueId: contest.leagueId,
      entriesPerContest,
      payerId,
      kind,
      amountCents: 0,
      describe: (expandedTo) => expandedTo === null
        ? `${contest.name}: up to ${entriesPerContest} entries, ${note}`
        : `${contest.name}: ${expandedTo} to ${entriesPerContest} entries, ${note}`,
    });
    if (result.status === 'notAbove') {
      this.refuseNotAbove(contest.id, entriesPerContest, result.expandedTo);
    }
  }

  private refuseNotAbove(contestId: string, entriesPerContest: number, cap: number | null): never {
    this.deps.logger.warn({ action: 'contestExpansion.notAboveCap', data: { contestId, entriesPerContest, cap } }, 'Refused an expansion not above the contest\'s cap');
    throw new ContestExpansionError(
      cap === null
        ? 'This contest has no entry limit, so it needs no expansion.'
        : `This contest already takes ${cap} entries. Reload to see its size now.`,
      'CONTEST_EXPANSION_NOT_ABOVE_CAP',
      409,
    );
  }

  private async requireContest(leagueId: string, contestId: string): Promise<Contest> {
    const contest = await this.deps.contests.findById(contestId);
    if (!contest || contest.leagueId !== leagueId) {
      this.deps.logger.warn({ action: 'contestExpansion.contestNotFound', data: { leagueId, contestId } }, 'No such contest in the league');
      throw new ContestNotFoundError(contestId);
    }
    return contest;
  }

  private async describe(contest: Contest): Promise<ContestExpansionResponse> {
    const [entitlements, state, expandable] = await Promise.all([
      this.deps.planEntitlements.forLeague(contest.leagueId),
      this.deps.expansions.findState(contest.id),
      // Until it stops taking entries: a draft has not started taking them (plans/payments.md Q6).
      contest.status === ContestStatus.DRAFT ? true : this.deps.entryWindow.areEntriesOpen(contest),
    ]);
    const config = this.deps.readConfig();
    const entriesPerContest = contestEntriesCap(entitlements, state.expandedTo);
    return {
      entriesPerContest,
      entryCount: state.entryCount,
      expandedTo: state.expandedTo,
      expandable,
      paymentsEnabled: config.paymentsEnabled,
      offers: expandable
        ? contestExpansionOffers(config.expansionPrices[entitlements.plan], entriesPerContest, state.expandedTo)
        : [],
    };
  }
}
