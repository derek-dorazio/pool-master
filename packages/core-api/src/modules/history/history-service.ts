/**
 * HistoryService — reads contest history, standings, and summaries.
 */

import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import type {
  ContestHistorySummary,
  ContestHighlights,
  ContestHistoryPayout,
  ContestHistoryResult,
} from '@poolmaster/shared/domain';
import { ContestStatus, LeagueMembershipStatus, SquadMembershipStatus } from '@poolmaster/shared/domain';

type LifecycleLogger = Pick<FastifyBaseLogger, 'debug' | 'info' | 'warn' | 'error' | 'fatal'>;

function createNoopLogger(): LifecycleLogger {
  const noop = () => undefined;
  return {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
  };
}

export class HistoryService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger: LifecycleLogger = createNoopLogger(),
  ) {}

  /** Returns a full contest history summary for a completed contest. */
  async getContestSummary(contestId: string): Promise<ContestHistorySummary | null> {
    this.logger.debug({ contestId }, 'history get contest summary start');
    const results = await this.getCompletedContestResults(contestId);

    if (results.length === 0) {
      this.logger.warn({ contestId }, 'history get contest summary missing history');
      return null;
    }

    const first = results[0];

    const payouts = await this.getContestPayouts(contestId);

    const entries = await this.prisma.contestEntry.findMany({
      where: { contestId },
    });
    const entryNameMap = new Map(entries.map((e) => [e.id, e.name]));

    const highlights = buildHighlights(results, entryNameMap);

    const summary = {
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
    this.logger.info({
      contestId,
      finalStandingCount: results.length,
      payoutCount: payouts.length,
    }, 'history get contest summary completed');
    return summary;
  }

  /** Returns final standings for a contest. */
  async getContestStandings(contestId: string): Promise<ContestHistoryResult[]> {
    this.logger.debug({ contestId }, 'history get contest standings start');
    const standings = await this.getCompletedContestResults(contestId);
    this.logger.info({ contestId, standingCount: standings.length }, 'history get contest standings completed');
    return standings;
  }

  /** Returns all contest results for a league member across all contests. */
  async getMemberResults(leagueMembershipId: string): Promise<ContestHistoryResult[]> {
    this.logger.debug({ leagueMembershipId }, 'history get member results start');
    const membership = await this.prisma.leagueMembership.findUnique({
      where: { id: leagueMembershipId },
      select: { leagueId: true, userId: true },
    });
    if (!membership) {
      this.logger.warn({ leagueMembershipId }, 'history get member results missing membership');
      return [];
    }

    const results = await this.buildFallbackResults({
      leagueId: membership.leagueId,
      userId: membership.userId,
    });
    const filtered = results.filter((result) => result.leagueMembershipId === leagueMembershipId);
    this.logger.info({ leagueMembershipId, resultCount: filtered.length }, 'history get member results completed');
    return filtered;
  }

  /** Returns all contest results for a league. */
  async getLeagueResults(leagueId: string): Promise<ContestHistoryResult[]> {
    this.logger.debug({ leagueId }, 'history get league results start');
    const results = await this.buildFallbackResults({ leagueId });
    this.logger.info({ leagueId, resultCount: results.length }, 'history get league results completed');
    return results;
  }

  /** Returns roster history snapshot for an entry. */
  async getRosterHistory(contestId: string, entryId: string) {
    this.logger.debug({ contestId, entryId }, 'history get roster history start');
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
      this.logger.warn({ contestId, entryId }, 'history get roster history missing entry');
      return null;
    }

    const rosterHistory = {
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
    this.logger.info({ contestId, entryId, rosterPickCount: rosterHistory.rosterPicks.length }, 'history get roster history completed');
    return rosterHistory;
  }

  /** Returns payout history for a contest. */
  async getContestPayouts(contestId: string): Promise<ContestHistoryPayout[]> {
    this.logger.debug({ contestId }, 'history get contest payouts start');
    const awards = await this.prisma.contestEntryPrizeAward.findMany({
      where: { entry: { contestId } },
      include: {
        entry: {
          include: {
            squad: {
              include: {
                memberships: {
                  where: { status: SquadMembershipStatus.ACTIVE },
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
      this.logger.warn({ contestId }, 'history get contest payouts no awards');
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

    const payouts: ContestHistoryPayout[] = awards.map((award, index) => ({
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
    this.logger.info({ contestId, payoutCount: payouts.length }, 'history get contest payouts completed');
    return payouts;
  }

  private async getCompletedContestResults(contestId: string): Promise<ContestHistoryResult[]> {
    this.logger.debug({ contestId }, 'history get completed contest results start');
    const results = await this.buildFallbackResults({ contestId });
    this.logger.info({ contestId, resultCount: results.length }, 'history get completed contest results completed');
    return results;
  }

  private async buildFallbackResults(filters: {
    contestId?: string;
    leagueId?: string;
    userId?: string;
  }): Promise<ContestHistoryResult[]> {
    this.logger.debug({
      contestId: filters.contestId ?? null,
      leagueId: filters.leagueId ?? null,
      userId: filters.userId ?? null,
    }, 'history build fallback results start');
    const contests = await this.prisma.contest.findMany({
      where: {
        ...(filters.contestId && { id: filters.contestId }),
        ...(filters.leagueId && { leagueId: filters.leagueId }),
        status: ContestStatus.COMPLETED,
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
                    status: SquadMembershipStatus.ACTIVE,
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
      this.logger.warn({
        contestId: filters.contestId ?? null,
        leagueId: filters.leagueId ?? null,
        userId: filters.userId ?? null,
      }, 'history build fallback results no completed contests');
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
        status: LeagueMembershipStatus.ACTIVE,
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

    const results = contests.flatMap((contest) => {
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
    this.logger.info({
      contestId: filters.contestId ?? null,
      leagueId: filters.leagueId ?? null,
      userId: filters.userId ?? null,
      resultCount: results.length,
      contestCount: contests.length,
    }, 'history build fallback results completed');
    return results;
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
