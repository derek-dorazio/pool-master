/**
 * StatEventConsumer — bridges incoming stat events to the scoring engine.
 *
 * Subscribes to 'stat.updated' events from the EventBus. For each event:
 * 1. Finds active contests that include the participant
 * 2. Finds entries with that participant in each contest
 * 3. Evaluates scoring rules via the scoring engine
 * 4. Stores results in ScoreStore
 * 5. Publishes 'score.updated' events
 */

import type { PrismaClient } from '@prisma/client';
import type { StatEvent } from '@poolmaster/shared/events/scoring';
import type { ScoringConfig } from '@poolmaster/shared/domain/scoring-config';
import type { EventBus } from '@poolmaster/shared/events/event-bus';
import type { ScoreBreakdown } from '../engine/scoring-engine';
import { scoreParticipant } from '../engine/scoring-engine';
import type { ScoreStore } from '../storage/score-store';
import { ContestStatus } from '@poolmaster/shared/domain/enums';

// --- Lookup Types ---

export interface ContestInfo {
  contestId: string;
  scoringEngine: string;
  scoringRules: ScoringConfig;
}

export interface EntryInfo {
  entryId: string;
  entryName: string;
  participantIds: string[];
}

// --- ContestLookup Service ---

/** Resolves contests and entries for a given participant via Prisma. */
export class ContestLookup {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /** Find active contests that include this participant. */
  async findActiveContestsForParticipant(participantId: string): Promise<ContestInfo[]> {
    const poolEntries = await this.prisma.contestParticipantPool.findMany({
      where: { participantId, isAvailable: true },
      include: {
        contest: true,
      },
    });

    return poolEntries
      .filter((pe) => pe.contest.status === ContestStatus.ACTIVE || pe.contest.status === ContestStatus.LOCKED)
      .map((pe) => ({
        contestId: pe.contest.id,
        scoringEngine: pe.contest.scoringEngine,
        scoringRules: pe.contest.scoringRules as ScoringConfig,
      }));
  }

  /** Find entries that include this participant within a contest. */
  async findEntriesWithParticipant(
    contestId: string,
    participantId: string,
  ): Promise<EntryInfo[]> {
    const picks = await this.prisma.rosterPick.findMany({
      where: { participantId, entry: { contestId } },
      include: { entry: true },
    });

    return picks.map((p) => ({
      entryId: p.entry.id,
      entryName: p.entry.name,
      participantIds: [],
    }));
  }

  /** Get the scoring config for a contest. */
  async getScoringConfig(contestId: string): Promise<ScoringConfig | undefined> {
    const contest = await this.prisma.contest.findUnique({
      where: { id: contestId },
      select: { scoringRules: true },
    });
    if (!contest) return undefined;
    return contest.scoringRules as ScoringConfig;
  }

  /** No-op — retained for test compatibility. */
  clear(): void {
    // No-op: Prisma-backed lookup has no local state to clear.
  }
}

// --- Consumer ---

export interface StatEventConsumerDeps {
  eventBus: EventBus;
  scoreStore: ScoreStore;
  contestLookup: ContestLookup;
}

/** Handle a single stat event by scoring all affected entries. */
export async function handleStatEvent(
  event: StatEvent,
  deps: StatEventConsumerDeps,
): Promise<void> {
  const { scoreStore, contestLookup, eventBus } = deps;
  const participantId = event.participantId ?? event.participantExternalId;
  const contests = await contestLookup.findActiveContestsForParticipant(participantId);

  for (const contest of contests) {
    const entries = await contestLookup.findEntriesWithParticipant(
      contest.contestId,
      participantId,
    );

    for (const entry of entries) {
      const participantData = buildParticipantData(event, participantId);
      const breakdown = scoreParticipant(contest.scoringRules, participantData);
      const timestamp = event.ingestedAt ?? new Date().toISOString();

      await storeScores(scoreStore, contest.contestId, entry, participantId, event, breakdown, timestamp);
      await publishScoreUpdated(eventBus, contest.contestId, entry, breakdown, timestamp);
    }
  }
}

/** Build ParticipantScoringData from a StatEvent. */
function buildParticipantData(
  event: StatEvent,
  participantId: string,
) {
  const stats: Record<string, number> = { [event.statKey]: event.statValue };
  return {
    participantId,
    stats,
    position: undefined,
    isDNF: false,
  };
}

/** Store participant and entry scores in the ScoreStore. */
async function storeScores(
  scoreStore: ScoreStore,
  contestId: string,
  entry: EntryInfo,
  participantId: string,
  event: StatEvent,
  breakdown: ScoreBreakdown,
  timestamp: string,
): Promise<void> {
  await scoreStore.appendParticipantScore({
    contestId,
    participantId,
    eventTimestamp: timestamp,
    stats: { [event.statKey]: event.statValue },
    points: breakdown.finalScore,
    breakdown,
  });

  const previousTotal = await scoreStore.getEntryTotal(contestId, entry.entryId);
  await scoreStore.appendEntryScore({
    contestId,
    entryId: entry.entryId,
    eventTimestamp: timestamp,
    pointsEarned: breakdown.finalScore,
    runningTotal: previousTotal + breakdown.finalScore,
    participantBreakdowns: [breakdown],
  });
}

/** Publish a score.updated event to the event bus. */
async function publishScoreUpdated(
  eventBus: EventBus,
  contestId: string,
  entry: EntryInfo,
  breakdown: ScoreBreakdown,
  timestamp: string,
): Promise<void> {
  await eventBus.publish('score.updated', {
    id: `score-${contestId}-${entry.entryId}-${Date.now()}`,
    type: 'score.updated',
    sourceService: 'scoring-service',
    timestamp,
    tenantId: '',
    contestId,
    teamId: entry.entryId,
    oldScore: 0,
    newScore: breakdown.finalScore,
    rank: 0,
    rankChanged: false,
  });
}

/** Subscribe the consumer to the event bus. */
export function subscribeStatEventConsumer(deps: StatEventConsumerDeps): void {
  deps.eventBus.subscribe<StatEvent>('stat.updated', (event) =>
    handleStatEvent(event, deps),
  );
}
