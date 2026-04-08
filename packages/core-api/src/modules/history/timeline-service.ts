/**
 * TimelineService — scoring timeline checkpoints and replay views.
 *
 * Provides the "race chart" showing how standings evolved over a contest,
 * draft replay with hindsight analytics, and roster replay with scoring breakdown.
 */

import type { PrismaClient } from '@prisma/client';

// --- Scoring Timeline ---

export interface ScoringCheckpointEntry {
  entryId: string;
  entryName: string;
  pointsAtCheckpoint: number;
  rankAtCheckpoint: number;
  rankChangeFromPrevious: number;
}

export interface ScoringCheckpoint {
  checkpointLabel: string;
  checkpointType: string;
  checkpointOrder: number;
  recordedAt: Date;
  standings: ScoringCheckpointEntry[];
}

export interface ContestScoringTimeline {
  contestId: string;
  checkpoints: ScoringCheckpoint[];
}

// --- Draft Replay ---

export interface DraftPickHistoryEntry {
  pickNumber: number;
  round: number;
  pickInRound: number;
  entryId: string;
  entryName: string;
  participantId: string;
  participantName: string;
  participantCost?: number;
  wasAutoPicked: boolean;
  pickedAt: Date;
  finalPointsScored?: number;
  pickValueRank?: number;
}

export interface DraftHistoryReplay {
  contestId: string;
  draftSessionId: string;
  totalPicks: number;
  picks: DraftPickHistoryEntry[];
}

// --- Roster Replay ---

export interface RosterReplayEntry {
  participantId: string;
  participantName: string;
  tier?: string;
  salaryCost?: number;
  draftRound?: number;
  draftPick?: number;
  finalPoints?: number;
}

export interface ContestRosterReplay {
  contestId: string;
  entryId: string;
  entryName: string;
  roster: RosterReplayEntry[];
  totalScore: number;
  finalRank: number;
}

export class TimelineService {
  constructor(private readonly prisma: PrismaClient) {}

  // --- Scoring Timeline ---

  /** Records a scoring checkpoint (called during live contest at key moments). */
  async recordCheckpoint(
    contestId: string,
    label: string,
    type: string,
    order: number,
    standings: ScoringCheckpointEntry[],
  ): Promise<void> {
    await this.prisma.scoringCheckpoint.create({
      data: {
        contestId,
        checkpointLabel: label,
        checkpointType: type,
        checkpointOrder: order,
        standings: standings as unknown as object,
        recordedAt: new Date(),
      },
    });
  }

  /** Returns the full scoring timeline for a contest. */
  async getTimeline(contestId: string): Promise<ContestScoringTimeline> {
    const rows = await this.prisma.scoringCheckpoint.findMany({
      where: { contestId },
      orderBy: { checkpointOrder: 'asc' },
    });

    return {
      contestId,
      checkpoints: rows.map((row) => ({
        checkpointLabel: row.checkpointLabel,
        checkpointType: row.checkpointType,
        checkpointOrder: row.checkpointOrder,
        recordedAt: row.recordedAt,
        standings: row.standings as unknown as ScoringCheckpointEntry[],
      })),
    };
  }

  // --- Draft Replay ---

  /** Returns full draft history replay for a contest with hindsight analytics. */
  async getDraftReplay(contestId: string): Promise<DraftHistoryReplay | null> {
    const session = await this.prisma.draftSession.findUnique({
      where: { contestId },
      include: {
        picks: {
          orderBy: { pickNumber: 'asc' },
          include: {
            participant: true,
            entry: true,
          },
        },
      },
    });

    if (!session) return null;

    // TODO: compute hindsight value from contest results and roster picks

    const picks: DraftPickHistoryEntry[] = session.picks.map((pick) => ({
      pickNumber: pick.pickNumber,
      round: pick.round,
      pickInRound: pick.pickInRound,
      entryId: pick.entryId,
      entryName: pick.entry.name,
      participantId: pick.participantId,
      participantName: pick.participant.name,
      wasAutoPicked: pick.autoPicked,
      pickedAt: pick.pickedAt,
    }));

    return {
      contestId,
      draftSessionId: session.id,
      totalPicks: picks.length,
      picks,
    };
  }

  // --- Roster Replay ---

  /** Returns the roster replay for an entry in a completed contest. */
  async getRosterReplay(contestId: string, entryId: string): Promise<ContestRosterReplay | null> {
    // Try frozen roster history first
    const frozen = await this.prisma.teamRosterHistory.findUnique({
      where: { contestId_entryId: { contestId, entryId } },
    });

    const result = await this.prisma.contestResult.findUnique({
      where: { contestId_entryId: { contestId, entryId } },
    });

    const entry = await this.prisma.contestEntry.findUnique({
      where: { id: entryId },
    });

    if (!entry) return null;

    let roster: RosterReplayEntry[];

    if (frozen) {
      // Use frozen roster snapshot
      const rosterData = frozen.roster as unknown as Array<{
        participantId: string;
        participantName: string;
        tier?: number;
        salaryCost?: number;
        draftRound?: number;
        draftPick?: number;
      }>;
      roster = rosterData.map((r) => ({
        participantId: r.participantId,
        participantName: r.participantName,
        tier: r.tier !== undefined ? String(r.tier) : undefined,
        salaryCost: r.salaryCost,
        draftRound: r.draftRound,
        draftPick: r.draftPick,
      }));
    } else {
      // Fall back to live roster picks
      const picks = await this.prisma.rosterPick.findMany({
        where: { entryId },
        include: { participant: true },
        orderBy: { draftRound: 'asc' },
      });
      roster = picks.map((p) => ({
        participantId: p.participantId,
        participantName: p.participant.name,
        draftRound: p.draftRound ?? undefined,
        draftPick: p.draftPickNumber ?? undefined,
      }));
    }

    return {
      contestId,
      entryId,
      entryName: entry.name,
      roster,
      totalScore: result?.totalScore ?? entry.totalScore,
      finalRank: result?.finalRank ?? entry.standingsPosition ?? 0,
    };
  }
}
