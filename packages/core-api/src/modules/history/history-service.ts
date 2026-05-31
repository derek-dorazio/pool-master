/**
 * HistoryService — reads contest history and roster snapshots.
 */

import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import type {
  ContestHistorySummary,
  ContestHistoryPayout,
  ContestHistoryResult,
} from '@poolmaster/shared/domain';

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
      this.logger.warn(
        { contestId },
        'history get contest summary unavailable until pool-master-eux.6 settlement persistence lands',
      );
      return null;
    }

    const first = results[0];
    const payouts = await this.getContestPayouts(contestId);

    const summary = {
      contestId,
      contestName: first.contestName ?? '',
      sport: first.sport ?? '',
      contestFormat: first.contestFormat ?? '',
      startedAt: first.startedAt ?? undefined,
      endedAt: first.endedAt ?? undefined,
      numEntries: first.numEntries ?? results.length,
      finalStandings: results,
      payouts,
      highlights: {},
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
    this.logger.info({ leagueMembershipId, resultCount: 0 }, 'history get member results completed without legacy entry totals');
    // pool-master-eux.5 removed the generic score-history source. pool-master-eux.6
    // will replace this with Golf-specific ContestEntryGolfStanding settlement reads.
    return [];
  }

  /** Returns all contest results for a league. */
  async getLeagueResults(leagueId: string): Promise<ContestHistoryResult[]> {
    this.logger.debug({ leagueId }, 'history get league results start');
    this.logger.info({ leagueId, resultCount: 0 }, 'history get league results completed without legacy entry totals');
    // pool-master-eux.5 removed the generic score-history source. pool-master-eux.6
    // will replace this with Golf-specific ContestEntryGolfStanding settlement reads.
    return [];
  }

  /** Returns roster history snapshot for an entry. */
  async getRosterHistory(contestId: string, entryId: string) {
    this.logger.debug({ contestId, entryId }, 'history get roster history start');
    const entry = await this.prisma.contestEntry.findFirst({
      where: { id: entryId, contestId },
      include: {
        picks: {
          include: {
            sportEventParticipant: {
              include: {
                participant: true,
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
      picks: entry.picks.map((pick) => ({
        pickId: pick.id,
        sportEventParticipantId: pick.sportEventParticipantId,
        participantId: pick.sportEventParticipant.participantId,
        participantName: pick.sportEventParticipant.participant.name,
        position: pick.sportEventParticipant.participant.position,
        teamAffiliation: pick.sportEventParticipant.participant.teamAffiliation,
        pickedAt: pick.pickedAt,
        draftRound: pick.draftRound ?? undefined,
        draftPickNumber: pick.draftPickNumber ?? undefined,
        autoPicked: pick.isAutoPicked,
      })),
    };
    this.logger.info({ contestId, entryId, pickCount: rosterHistory.picks.length }, 'history get roster history completed');
    return rosterHistory;
  }

  /** Returns payout history for a contest. */
  async getContestPayouts(contestId: string): Promise<ContestHistoryPayout[]> {
    this.logger.debug({ contestId }, 'history get contest payouts start');
    this.logger.info({ contestId, payoutCount: 0 }, 'history get contest payouts completed without legacy prize awards');
    // pool-master-eux.5 removed legacy prize-award history. pool-master-eux.6 will
    // define the replacement settlement/payout read once final Golf standings persist.
    return [];
  }

  private async getCompletedContestResults(contestId: string): Promise<ContestHistoryResult[]> {
    this.logger.debug({ contestId }, 'history get completed contest results start');
    this.logger.info({ contestId, resultCount: 0 }, 'history get completed contest results completed without legacy entry totals');
    // pool-master-eux.5 intentionally deleted the generic completed-results source
    // instead of preserving stale ContestEntry totals. pool-master-eux.6 owns the
    // replacement ContestEntryGolfStanding settlement model and history read path.
    return [];
  }
}
