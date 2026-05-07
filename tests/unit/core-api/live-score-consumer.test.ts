/**
 * Unit tests for LiveScoreConsumer per pool-master-rop.78.7 / plans/117
 * §11.3 / §11.4 / §11.5.
 *
 * Coverage:
 *   - Subscribes to live_score.persisted on subscribe(), unsubscribes on
 *     unsubscribe().
 *   - Non-GOLF events are no-ops (Phase 4 ships golf-roster only).
 *   - Zero-update events are no-ops (nothing to score).
 *   - On a GOLF event with picks present:
 *       * acquires the per-contest advisory lock,
 *       * upserts contributions for every pick's completed rounds,
 *       * recomputes ContestEntry.totalScore for every affected entry,
 *       * hands off to standingsRollup.rollupContest.
 *   - Lock-contended path is a no-op (no contributions, no totalScore
 *     update, no rollup) so concurrent workers don't double-write.
 *   - One contest's failure does not block scoring for the others.
 */

import { LiveScoreConsumer } from '../../../packages/core-api/src/modules/scoring/consumer/live-score-consumer';
import type { LiveScorePersistedEvent } from '@poolmaster/shared/events';

function buildBus() {
  return {
    publish: jest.fn().mockResolvedValue(undefined),
    subscribe: jest.fn(),
    unsubscribe: jest.fn(),
    clear: jest.fn(),
  } as any;
}

function buildEvent(overrides: Partial<LiveScorePersistedEvent> = {}): LiveScorePersistedEvent {
  return {
    id: 'evt-1',
    type: 'live_score.persisted',
    sourceService: 'ingestion-worker',
    timestamp: new Date('2026-04-10T12:00:00.000Z').toISOString(),
    category: 'GOLF',
    providerId: 'mock-contest-feed',
    sportEventId: 'sport-event-1',
    updatesPersisted: 2,
    ingestedAt: new Date('2026-04-10T12:00:00.000Z').toISOString(),
    ...overrides,
  };
}

function buildPrismaWithGolfPicks({
  acquireLock = true,
  picks = [
    {
      id: 'pick-1',
      entryId: 'entry-1',
      contestFormat: 'ROSTER',
      sportEventParticipant: {
        id: 'sep-1',
        sportEventId: 'sport-event-1',
        golfRounds: [
          { round: 1, strokes: 70, scoreToPar: -2, status: 'COMPLETED' },
          { round: 2, strokes: 73, scoreToPar: 1, status: 'COMPLETED' },
        ],
      },
    },
  ],
  affectedContestIds = ['contest-1'],
  aggregateContribution = -1,
} = {}) {
  const upsert = jest.fn().mockResolvedValue({});
  const deleteMany = jest.fn().mockResolvedValue({ count: 0 });
  const update = jest.fn().mockResolvedValue({});
  const aggregate = jest.fn().mockResolvedValue({ _sum: { contribution: aggregateContribution } });
  const findManyAffected = jest.fn().mockResolvedValue(
    affectedContestIds.map((contestId) => ({ entry: { contestId } })),
  );
  const findManyPicks = jest.fn().mockResolvedValue(picks);

  // Prisma's findMany has different shapes per call site; we route them
  // by the presence of `select` (affected-contest lookup) vs `include`
  // (full pick + golf-rounds expansion).
  const contestEntryPickFindMany = jest.fn().mockImplementation((args: any) => {
    if (args?.select) return findManyAffected(args);
    if (args?.include) return findManyPicks(args);
    return Promise.resolve([]);
  });

  return {
    contestEntryPick: { findMany: contestEntryPickFindMany },
    contestEntryPickGolfRosterContribution: { upsert, deleteMany, aggregate },
    contestEntry: { update },
    $queryRaw: jest.fn().mockResolvedValue([{ acquired: acquireLock }]),
    $transaction: jest.fn().mockImplementation(async (fn: any) => fn({
      contestEntryPick: { findMany: contestEntryPickFindMany },
      contestEntryPickGolfRosterContribution: { upsert, deleteMany, aggregate },
      contestEntry: { update },
      $queryRaw: jest.fn().mockResolvedValue([{ acquired: acquireLock }]),
    })),
  } as any;
}

function buildRollup() {
  return {
    rollupContest: jest.fn().mockResolvedValue({ contestId: 'contest-1', entriesUpdated: 1, rankChanges: 0, rolledUpAt: new Date() }),
  } as any;
}

describe('pool-master-rop.78.7 / plans/117 §11.3-§11.5 — LiveScoreConsumer', () => {
  describe('bus subscription lifecycle', () => {
    it('subscribes to live_score.persisted on subscribe()', () => {
      const bus = buildBus();
      const consumer = new LiveScoreConsumer({
        prisma: {} as any,
        eventBus: bus,
        standingsRollup: buildRollup(),
      });
      consumer.subscribe();
      expect(bus.subscribe).toHaveBeenCalledWith('live_score.persisted', expect.any(Function));
    });

    it('does not double-subscribe when subscribe() is called twice', () => {
      const bus = buildBus();
      const consumer = new LiveScoreConsumer({
        prisma: {} as any,
        eventBus: bus,
        standingsRollup: buildRollup(),
      });
      consumer.subscribe();
      consumer.subscribe();
      expect(bus.subscribe).toHaveBeenCalledTimes(1);
    });

    it('unsubscribes via unsubscribe()', () => {
      const bus = buildBus();
      const consumer = new LiveScoreConsumer({
        prisma: {} as any,
        eventBus: bus,
        standingsRollup: buildRollup(),
      });
      consumer.subscribe();
      consumer.unsubscribe();
      expect(bus.unsubscribe).toHaveBeenCalledWith('live_score.persisted', expect.any(Function));
    });
  });

  describe('event filtering (Phase 4 = golf-roster only)', () => {
    it('is a no-op for non-GOLF categories', async () => {
      const prisma = buildPrismaWithGolfPicks();
      const rollup = buildRollup();
      const consumer = new LiveScoreConsumer({ prisma, eventBus: buildBus(), standingsRollup: rollup });
      await consumer.handle(buildEvent({ category: 'BASKETBALL' }));
      expect(prisma.contestEntryPick.findMany).not.toHaveBeenCalled();
      expect(rollup.rollupContest).not.toHaveBeenCalled();
    });

    it('is a no-op when updatesPersisted === 0', async () => {
      const prisma = buildPrismaWithGolfPicks();
      const rollup = buildRollup();
      const consumer = new LiveScoreConsumer({ prisma, eventBus: buildBus(), standingsRollup: rollup });
      await consumer.handle(buildEvent({ updatesPersisted: 0 }));
      expect(prisma.contestEntryPick.findMany).not.toHaveBeenCalled();
      expect(rollup.rollupContest).not.toHaveBeenCalled();
    });
  });

  describe('GOLF scoring path', () => {
    it('acquires lock, upserts contributions, recomputes totalScore, and hands off to rollup', async () => {
      const prisma = buildPrismaWithGolfPicks();
      const rollup = buildRollup();
      const consumer = new LiveScoreConsumer({ prisma, eventBus: buildBus(), standingsRollup: rollup });
      await consumer.handle(buildEvent());

      // Two completed rounds upserted.
      expect(prisma.contestEntryPickGolfRosterContribution.upsert).toHaveBeenCalledTimes(2);
      expect(prisma.contestEntryPickGolfRosterContribution.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { contestEntryPickId_round: { contestEntryPickId: 'pick-1', round: 1 } },
          create: expect.objectContaining({ scoreToPar: -2, contribution: -2 }),
        }),
      );
      // totalScore recomputed from the aggregated contribution sum.
      expect(prisma.contestEntry.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'entry-1' },
          data: { totalScore: -1 },
        }),
      );
      // Rerank handoff happens once per affected contest, after the
      // scoring transaction commits. Golf-roster ranks lower-is-better
      // (scoreToPar of -5 wins over +2) so the consumer must pass
      // `rankDirection: 'LOWER_IS_BETTER'` to the rollup — without it the
      // rollup defaults to descending and inverts the leaderboard.
      expect(rollup.rollupContest).toHaveBeenCalledWith(
        'contest-1',
        { rankDirection: 'LOWER_IS_BETTER' },
      );
    });

    it('deletes contribution rows whose round is no longer in the computed contribution set', async () => {
      // Pick had rounds 1-4 completed previously (and rows persisted by an
      // earlier event). On this event, round 3 was corrected to DNF — it
      // must drop out of the contribution set, otherwise the totalScore
      // aggregate keeps summing the stale row.
      const prisma = buildPrismaWithGolfPicks({
        picks: [
          {
            id: 'pick-1',
            entryId: 'entry-1',
            contestFormat: 'ROSTER',
            sportEventParticipant: {
              id: 'sep-1',
              sportEventId: 'sport-event-1',
              golfRounds: [
                { round: 1, strokes: 70, scoreToPar: -2, status: 'COMPLETED' },
                { round: 2, strokes: 73, scoreToPar: 1, status: 'COMPLETED' },
                { round: 3, strokes: 0, scoreToPar: 0, status: 'DNF' },
                { round: 4, strokes: 71, scoreToPar: -1, status: 'COMPLETED' },
              ],
            },
          },
        ],
      });
      const consumer = new LiveScoreConsumer({ prisma, eventBus: buildBus(), standingsRollup: buildRollup() });
      await consumer.handle(buildEvent());

      // Live rounds = 1, 2, 4. Round 3 must be deleted if a stale row exists.
      expect(prisma.contestEntryPickGolfRosterContribution.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            contestEntryPickId: 'pick-1',
            round: { notIn: [1, 2, 4] },
          }),
        }),
      );
      expect(prisma.contestEntryPickGolfRosterContribution.upsert).toHaveBeenCalledTimes(3);
    });

    it('deletes ALL contribution rows for the pick when no completed rounds remain (full retraction)', async () => {
      // All previously completed rounds were corrected to DNF — nothing
      // should count, including any prior contribution rows.
      const prisma = buildPrismaWithGolfPicks({
        picks: [
          {
            id: 'pick-1',
            entryId: 'entry-1',
            contestFormat: 'ROSTER',
            sportEventParticipant: {
              id: 'sep-1',
              sportEventId: 'sport-event-1',
              golfRounds: [
                { round: 1, strokes: 0, scoreToPar: 0, status: 'DNF' },
                { round: 2, strokes: 0, scoreToPar: 0, status: 'DNF' },
              ],
            },
          },
        ],
      });
      const consumer = new LiveScoreConsumer({ prisma, eventBus: buildBus(), standingsRollup: buildRollup() });
      await consumer.handle(buildEvent());

      // With no live rounds the deleteMany WHERE narrows to just the pick id
      // (no `round` filter), retracting any prior rows.
      expect(prisma.contestEntryPickGolfRosterContribution.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { contestEntryPickId: 'pick-1' },
        }),
      );
      expect(prisma.contestEntryPickGolfRosterContribution.upsert).not.toHaveBeenCalled();
    });

    it('skips contributions and rerank when the advisory lock is contended', async () => {
      const prisma = buildPrismaWithGolfPicks({ acquireLock: false });
      const rollup = buildRollup();
      const consumer = new LiveScoreConsumer({ prisma, eventBus: buildBus(), standingsRollup: rollup });
      await consumer.handle(buildEvent());
      expect(prisma.contestEntryPickGolfRosterContribution.upsert).not.toHaveBeenCalled();
      expect(prisma.contestEntry.update).not.toHaveBeenCalled();
      expect(rollup.rollupContest).not.toHaveBeenCalled();
    });

    it('continues scoring remaining contests when one fails', async () => {
      const rollup = buildRollup();
      const prisma = buildPrismaWithGolfPicks({
        affectedContestIds: ['contest-bad', 'contest-good'],
      });
      // Throw on the first $transaction (contest-bad), succeed on the second.
      const txMock = prisma.$transaction as jest.Mock;
      txMock
        .mockImplementationOnce(() => Promise.reject(new Error('simulated failure')))
        .mockImplementationOnce(async (fn: any) => fn({
          contestEntryPick: prisma.contestEntryPick,
          contestEntryPickGolfRosterContribution: prisma.contestEntryPickGolfRosterContribution,
          contestEntry: prisma.contestEntry,
          $queryRaw: jest.fn().mockResolvedValue([{ acquired: true }]),
        }));
      const logger = { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } as any;
      const consumer = new LiveScoreConsumer({ prisma, eventBus: buildBus(), standingsRollup: rollup, logger });
      await consumer.handle(buildEvent());

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'liveScoreConsumer.scoreContestFailed' }),
        expect.any(String),
      );
      // contest-good still gets reranked, with golf-roster direction.
      expect(rollup.rollupContest).toHaveBeenCalledWith(
        'contest-good',
        { rankDirection: 'LOWER_IS_BETTER' },
      );
    });
  });
});
