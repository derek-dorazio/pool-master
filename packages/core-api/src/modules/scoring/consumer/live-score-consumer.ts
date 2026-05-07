/**
 * Live-score bus consumer per plans/117 §11.3 / §11.4.
 *
 * Subscribes to `live_score.persisted` events and runs the per-(category ×
 * contestFormat) scoring pipeline for affected contests:
 *
 *   1. Find contests with active/locked status whose entries hold picks
 *      against participants in the event's sportEventId.
 *   2. For each affected contest, acquire a per-contest Postgres advisory
 *      lock (`pg_try_advisory_xact_lock(hashtextextended(contestId, 0))`)
 *      so concurrent stat events for the same contest serialize while
 *      different contests run in parallel.
 *   3. Read each affected pick's golf rounds, run the pure
 *      `scoreGolfRoster` function, and upsert the resulting contribution
 *      rows (idempotent on `(contestEntryPickId, round)`).
 *   4. Recompute `ContestEntry.totalScore = SUM(contribution)` for every
 *      affected entry.
 *   5. Hand off to `StandingsRollup.rollupContest` to rerank entries and
 *      emit `standings.updated`.
 *
 * Phase 4 ships only the golf-roster path. Other (category × contestFormat)
 * combinations are no-ops at the dispatcher; they pick up implementations
 * in their respective slices (plans/117 §11.2).
 */

import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import type { EventBus } from '@poolmaster/shared/events/event-bus';
import type { LiveScorePersistedEvent } from '@poolmaster/shared/events';
import {
  DEFAULT_GOLF_ROSTER_SCORING_CONFIG,
  type GolfRosterScoringConfig,
} from '@poolmaster/shared/domain';
import { scoreGolfRoster } from '../engine/score-golf-roster';
import type { StandingsRollup } from '../rollup/standings-rollup';

export interface LiveScoreConsumerDeps {
  prisma: PrismaClient;
  eventBus: EventBus;
  standingsRollup: StandingsRollup;
  logger?: FastifyBaseLogger;
  /**
   * Override for tests — defaults to reading
   * `DEFAULT_GOLF_ROSTER_SCORING_CONFIG` for every contest. The contest
   * scoringConfig wire-through is a follow-up slice; until then every
   * golf-roster contest sums all completed rounds.
   */
  resolveGolfRosterConfig?: (contestId: string) => Promise<GolfRosterScoringConfig>;
}

export class LiveScoreConsumer {
  private readonly prisma: PrismaClient;
  private readonly eventBus: EventBus;
  private readonly standingsRollup: StandingsRollup;
  private readonly logger?: FastifyBaseLogger;
  private readonly resolveGolfRosterConfig: (contestId: string) => Promise<GolfRosterScoringConfig>;
  private subscribed = false;
  private readonly handler = this.handle.bind(this);

  constructor(deps: LiveScoreConsumerDeps) {
    this.prisma = deps.prisma;
    this.eventBus = deps.eventBus;
    this.standingsRollup = deps.standingsRollup;
    this.logger = deps.logger;
    this.resolveGolfRosterConfig =
      deps.resolveGolfRosterConfig ?? (async () => DEFAULT_GOLF_ROSTER_SCORING_CONFIG);
  }

  subscribe(): void {
    if (this.subscribed) return;
    this.eventBus.subscribe('live_score.persisted', this.handler);
    this.subscribed = true;
  }

  unsubscribe(): void {
    if (!this.subscribed) return;
    this.eventBus.unsubscribe('live_score.persisted', this.handler);
    this.subscribed = false;
  }

  async handle(event: LiveScorePersistedEvent): Promise<void> {
    if (event.category !== 'GOLF') {
      // Phase 4 ships only the golf-roster scoring path (plans/117 §11.1).
      // Other categories are designed-but-deferred (§11.2) and will land
      // in their own slices; until then the consumer is a no-op for them.
      return;
    }
    if (event.updatesPersisted === 0) {
      // No new detail rows landed — nothing to score.
      return;
    }

    let affectedContestIds: readonly string[];
    try {
      affectedContestIds = await this.findAffectedGolfRosterContests(event.sportEventId);
    } catch (err) {
      this.logger?.error(
        { action: 'liveScoreConsumer.findAffectedContestsFailed', err, data: { sportEventId: event.sportEventId } },
        'Failed to enumerate contests affected by live_score.persisted',
      );
      return;
    }

    for (const contestId of affectedContestIds) {
      try {
        await this.scoreContest(contestId, event.sportEventId);
      } catch (err) {
        // One contest's failure should not block scoring for the others.
        // The advisory lock guarantees a future event will retry from a
        // known-good state per plans/117 §11.5.
        this.logger?.error(
          { action: 'liveScoreConsumer.scoreContestFailed', err, data: { contestId, sportEventId: event.sportEventId } },
          'Failed to score contest in response to live_score.persisted',
        );
      }
    }
  }

  private async findAffectedGolfRosterContests(sportEventId: string): Promise<readonly string[]> {
    // Contest doesn't carry a sport column directly; the sport lives on the
    // anchoring SportEvent. We filter by the pick's own sportEventParticipant
    // (which scopes to the event) and require the contest's anchor SportEvent
    // to also be GOLF — guarding against future cross-sport contest types.
    const rows = await this.prisma.contestEntryPick.findMany({
      where: {
        sportEventParticipant: { sportEventId },
        contestFormat: 'ROSTER',
        entry: {
          contest: {
            status: { in: ['ACTIVE', 'LOCKED'] },
            sportEvent: { sport: 'GOLF' },
          },
        },
      },
      select: { entry: { select: { contestId: true } } },
    });
    return Array.from(new Set(rows.map((r) => r.entry.contestId)));
  }

  private async scoreContest(contestId: string, sportEventId: string): Promise<void> {
    const config = await this.resolveGolfRosterConfig(contestId);
    const acquired = await this.prisma.$transaction(async (tx) => {
      const lockResult = await tx.$queryRaw<{ acquired: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(hashtextextended(${contestId}::text, 0)) AS acquired
      `;
      if (!lockResult[0]?.acquired) {
        // Another worker is scoring this contest; skip — they'll handle
        // this stat-event slot. Per plans/117 §11.4: per-contest
        // pessimistic advisory lock; concurrent stat events for the same
        // contest serialize.
        this.logger?.debug?.(
          { action: 'liveScoreConsumer.lockContended', data: { contestId } },
          'Skipping contest scoring — advisory lock held by another worker',
        );
        return false;
      }

      const picks = await tx.contestEntryPick.findMany({
        where: {
          sportEventParticipant: { sportEventId },
          entry: { contestId },
          contestFormat: 'ROSTER',
        },
        include: {
          sportEventParticipant: {
            include: {
              golfRounds: { orderBy: { round: 'asc' } },
            },
          },
        },
      });
      if (picks.length === 0) {
        return true;
      }

      for (const pick of picks) {
        const contributions = scoreGolfRoster({
          pick: { id: pick.id },
          detail: pick.sportEventParticipant.golfRounds.map((r) => ({
            round: r.round,
            strokes: r.strokes,
            scoreToPar: r.scoreToPar,
            status: r.status as 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'DNF' | 'DSQ',
          })),
          rules: config,
        });

        // Delete contribution rows for this pick whose round is no longer
        // in the computed contribution set. A previously COMPLETED round
        // can be corrected to DNF / DSQ / PENDING (status filter drops it),
        // or a TOP_N_BEST / SPECIFIC_ROUNDS rule can stop selecting it
        // after a correction. Without this delete, the totalScore aggregate
        // below would still sum the stale row.
        const liveRounds = contributions.map((c) => c.round);
        await tx.contestEntryPickGolfRosterContribution.deleteMany({
          where: {
            contestEntryPickId: pick.id,
            ...(liveRounds.length > 0 ? { round: { notIn: liveRounds } } : {}),
          },
        });

        for (const contribution of contributions) {
          await tx.contestEntryPickGolfRosterContribution.upsert({
            where: {
              contestEntryPickId_round: {
                contestEntryPickId: contribution.contestEntryPickId,
                round: contribution.round,
              },
            },
            create: {
              contestEntryPickId: contribution.contestEntryPickId,
              round: contribution.round,
              strokes: contribution.strokes,
              scoreToPar: contribution.scoreToPar,
              contribution: contribution.contribution,
              contributedAt: new Date(),
            },
            update: {
              strokes: contribution.strokes,
              scoreToPar: contribution.scoreToPar,
              contribution: contribution.contribution,
              contributedAt: new Date(),
            },
          });
        }
      }

      // Recompute totalScore for every affected entry — sum across ALL
      // picks (this event may only touch some, but the running total
      // depends on contributions from prior events too).
      const affectedEntryIds = Array.from(new Set(picks.map((p) => p.entryId)));
      for (const entryId of affectedEntryIds) {
        const totals = await tx.contestEntryPickGolfRosterContribution.aggregate({
          where: { pick: { entryId } },
          _sum: { contribution: true },
        });
        const totalScore =
          totals._sum.contribution !== null && totals._sum.contribution !== undefined
            ? Number(totals._sum.contribution)
            : 0;
        await tx.contestEntry.update({
          where: { id: entryId },
          data: { totalScore },
        });
      }

      this.logger?.info(
        {
          action: 'liveScoreConsumer.contestScored',
          data: { contestId, picksScored: picks.length, entriesUpdated: affectedEntryIds.length },
        },
        'Scored golf-roster contest in response to live_score.persisted',
      );

      return true;
    });

    if (acquired) {
      // Rerank + emit standings.updated outside the scoring transaction so
      // the rollup uses the freshly committed totalScore values and so a
      // rerank failure doesn't roll back the contribution writes.
      // Golf-roster ranks lower-is-better: an entry at -5 (under par) wins
      // over an entry at +2. The rollup defaults to higher-is-better for
      // the rest of the pool formats (BRACKET / PICKEM_CONFIDENCE /
      // SURVIVOR / future basketball-roster / etc.).
      await this.standingsRollup.rollupContest(contestId, {
        rankDirection: 'LOWER_IS_BETTER',
      });
    }
  }
}
