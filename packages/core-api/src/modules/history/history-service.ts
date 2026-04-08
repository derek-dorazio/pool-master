/**
 * HistoryService — reads contest history, standings, and summaries.
 */

import type { PrismaClient } from '@prisma/client';
import type {
  ContestHistorySummary,
  ContestHighlights,
  ContestHistoryPayout,
  ContestHistoryResult,
} from '@poolmaster/shared/domain';

export class HistoryService {
  constructor(private readonly prisma: PrismaClient) {}

  /** Returns a full contest history summary for a completed contest. */
  async getContestSummary(contestId: string): Promise<ContestHistorySummary | null> {
    const results = await this.getContestResultsForHistory(contestId);

    if (results.length === 0) return null;

    const first = results[0];

    const payouts = await this.getContestPayouts(contestId);

    const entries = await this.prisma.contestEntry.findMany({
      where: { contestId },
    });
    const entryNameMap = new Map(entries.map((e) => [e.id, e.name]));

    const highlights = buildHighlights(results, entryNameMap);

    return {
      contestId,
      contestName: first.contestName ?? '',
      sport: first.sport ?? '',
      contestType: first.contestType ?? '',
      startedAt: first.startedAt ?? undefined,
      endedAt: first.endedAt ?? undefined,
      numEntries: first.numEntries ?? results.length,
      finalStandings: results,
      payouts,
      highlights,
    };
  }

  /** Returns final standings for a contest. */
  async getContestStandings(contestId: string): Promise<ContestHistoryResult[]> {
    return this.getContestResultsForHistory(contestId);
  }

  /** Returns all contest results for a league member across all contests. */
  async getMemberResults(leagueMembershipId: string): Promise<ContestHistoryResult[]> {
    const membership = await this.prisma.leagueMembership.findUnique({
      where: { id: leagueMembershipId },
      select: { leagueId: true, userId: true },
    });
    if (!membership) {
      return [];
    }

    const results = await this.buildFallbackResults({
      leagueId: membership.leagueId,
      userId: membership.userId,
    });
    return results.filter((result) => result.leagueMembershipId === leagueMembershipId);
  }

  /** Returns all contest results for a league. */
  async getLeagueResults(leagueId: string): Promise<ContestHistoryResult[]> {
    return this.buildFallbackResults({ leagueId });
  }

  /** Returns roster history snapshot for an entry. */
  async getRosterHistory(contestId: string, entryId: string) {
    const entry = await this.prisma.contestEntry.findFirst({
      where: { id: entryId, contestId },
      include: {
        rosterPicks: {
          include: {
            sportEventParticipant: {
              include: {
                participant: true,
                sourceData: {
                  orderBy: [{ receivedAt: 'desc' }, { createdAt: 'desc' }],
                },
              },
            },
          },
          orderBy: [{ pickedAt: 'asc' }, { id: 'asc' }],
        },
      },
    });
    if (!entry) {
      return null;
    }

    return {
      contestId,
      entryId,
      entryName: entry.name,
      rosterPicks: entry.rosterPicks.map((pick) => ({
        rosterPickId: pick.id,
        sportEventParticipantId: pick.sportEventParticipantId,
        participantId: pick.sportEventParticipant.participantId,
        participantName: pick.sportEventParticipant.participant.name,
        position: pick.sportEventParticipant.participant.position,
        teamAffiliation: pick.sportEventParticipant.participant.teamAffiliation,
        pickedAt: pick.pickedAt,
        draftRound: pick.draftRound ?? undefined,
        draftPickNumber: pick.draftPickNumber ?? undefined,
        autoPicked: pick.autoPicked,
        latestPerformance:
          pick.sportEventParticipant.sourceData[0]?.normalizedData ?? {},
      })),
    };
  }

  /** Returns payout history for a contest. */
  async getContestPayouts(contestId: string): Promise<ContestHistoryPayout[]> {
    const awards = await this.prisma.contestEntryPrizeAward.findMany({
      where: { entry: { contestId } },
      include: {
        entry: {
          include: {
            squad: {
              include: {
                memberships: {
                  where: { status: 'ACTIVE' },
                  orderBy: { joinedAt: 'asc' },
                },
              },
            },
          },
        },
      },
      orderBy: [{ awardedAt: 'asc' }, { createdAt: 'asc' }],
    });

    if (awards.length === 0) {
      return [];
    }

    const leagueMemberships = await this.prisma.leagueMembership.findMany({
      where: {
        leagueId: awards[0]?.entry.squad.leagueId,
        userId: {
          in: awards
            .map((award) => award.entry.squad.memberships[0]?.userId)
            .filter((userId): userId is string => Boolean(userId)),
        },
      },
    });
    const leagueMembershipIdByUserId = new Map(
      leagueMemberships.map((membership) => [membership.userId, membership.id]),
    );

    return awards.map((award, index) => ({
      id: award.id,
      contestId: award.entry.contestId,
      leagueId: award.entry.squad.leagueId,
      entryId: award.entryId,
      leagueMembershipId:
        leagueMembershipIdByUserId.get(award.entry.squad.memberships[0]?.userId ?? '') ?? '',
      prizeType: 'FINAL_STANDING',
      prizeLabel: award.displayName,
      prizeRank: index + 1,
      amount: award.amount ?? 0,
      isCash: true,
      nonCashDescription: undefined,
      paidAt: award.awardedAt,
      acknowledgedByMember: false,
      createdAt: award.createdAt,
    }));
  }

  private async getContestResultsForHistory(contestId: string): Promise<ContestHistoryResult[]> {
    return this.buildFallbackResults({ contestId });
  }

  private async buildFallbackResults(filters: {
    contestId?: string;
    leagueId?: string;
    userId?: string;
  }): Promise<ContestHistoryResult[]> {
    const contests = await this.prisma.contest.findMany({
      where: {
        ...(filters.contestId && { id: filters.contestId }),
        ...(filters.leagueId && { leagueId: filters.leagueId }),
        status: 'COMPLETED',
      },
      include: {
        sportEvent: {
          select: { sport: true },
        },
        entries: {
          include: {
            squad: {
              include: {
                memberships: {
                  where: {
                    status: 'ACTIVE',
                    ...(filters.userId && { userId: filters.userId }),
                  },
                  orderBy: { joinedAt: 'asc' },
                },
              },
            },
            prizeAwards: {
              orderBy: [{ awardedAt: 'asc' }, { createdAt: 'asc' }],
            },
          },
          orderBy: [{ standingsPosition: 'asc' }, { createdAt: 'asc' }],
        },
      },
      orderBy: [{ endsAt: 'desc' }, { createdAt: 'desc' }],
    });

    if (contests.length === 0) {
      return [];
    }

    const membershipPairs = contests.flatMap((contest) =>
      contest.entries.flatMap((entry) =>
        entry.squad.memberships.map((membership) => ({
          leagueId: contest.leagueId,
          userId: membership.userId,
        })),
      ),
    );
    const uniqueMembershipPairs = Array.from(
      new Map(
        membershipPairs.map((pair) => [`${pair.leagueId}:${pair.userId}`, pair] as const),
      ).values(),
    );

    const leagueMemberships = await this.prisma.leagueMembership.findMany({
      where: {
        OR: uniqueMembershipPairs.map((pair) => ({
          leagueId: pair.leagueId,
          userId: pair.userId,
        })),
      },
    });
    const leagueMembershipIdByKey = new Map(
      leagueMemberships.map((membership) => [
        `${membership.leagueId}:${membership.userId}`,
        membership.id,
      ]),
    );

    return contests.flatMap((contest) => {
      const numEntries = contest.entries.length;
      const winnerScore = contest.entries[0]?.totalScore ?? 0;

      return contest.entries
        .filter((entry) => entry.squad.memberships.length > 0)
        .map((entry) => {
          const firstMembership = entry.squad.memberships[0]!;
          const leagueMembershipId = leagueMembershipIdByKey.get(
            `${contest.leagueId}:${firstMembership.userId}`,
          );
          const prizeAmount = entry.prizeAwards.reduce(
            (sum, award) => sum + (award.amount ?? 0),
            0,
          );
          const rank = entry.standingsPosition ?? numEntries;

          return {
            id: `${contest.id}:${entry.id}`,
            contestId: contest.id,
            entryId: entry.id,
            finalRank: rank,
            totalScore: entry.totalScore,
            prizeAmount: prizeAmount > 0 ? prizeAmount : undefined,
            leagueId: contest.leagueId,
            leagueMembershipId,
            contestName: contest.name,
            contestType: contest.contestType,
            sport: contest.sportEvent?.sport ?? undefined,
            numEntries,
            startedAt: contest.startsAt ?? undefined,
            endedAt: contest.endsAt ?? undefined,
            isWinner: rank === 1,
            isPaidPosition: entry.prizeAwards.length > 0,
            entryFeePaid: undefined,
            prizeLabel: entry.prizeAwards[0]?.displayName,
            netResult: undefined,
            percentileRank: numEntries > 0 ? ((numEntries - rank + 1) / numEntries) * 100 : undefined,
            pointsBehindWinner: winnerScore - entry.totalScore,
            pointsBehindNext: undefined,
            draftPosition: undefined,
            rosterSnapshotId: undefined,
            closedAt: contest.endsAt ?? undefined,
            createdAt: entry.createdAt,
            updatedAt: entry.updatedAt,
          } satisfies ContestHistoryResult;
        });
    });
  }
}

function buildHighlights(
  results: Array<{ entryId: string; totalScore: number; finalRank: number }>,
  entryNames: Map<string, string>,
): ContestHighlights {
  if (results.length === 0) return {};

  const sorted = [...results].sort((a, b) => b.totalScore - a.totalScore);
  const highest = sorted[0];
  const lowest = sorted[sorted.length - 1];

  // Closest finish: smallest gap between consecutive ranks
  let closestMargin = Infinity;
  let winnerMargin: number | undefined;

  for (let i = 0; i < sorted.length - 1; i++) {
    const gap = Math.abs(sorted[i].totalScore - sorted[i + 1].totalScore);
    if (gap < closestMargin) closestMargin = gap;
  }

  if (sorted.length >= 2) {
    winnerMargin = Math.abs(sorted[0].totalScore - sorted[1].totalScore);
  }

  return {
    highestScore: {
      entryId: highest.entryId,
      entryName: entryNames.get(highest.entryId) ?? '',
      score: highest.totalScore,
    },
    lowestScore: {
      entryId: lowest.entryId,
      entryName: entryNames.get(lowest.entryId) ?? '',
      score: lowest.totalScore,
    },
    closestFinish: closestMargin < Infinity ? { margin: closestMargin } : undefined,
    winnerMargin,
  };
}
