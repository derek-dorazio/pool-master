/**
 * Prisma adapter for the match port (#698): an event's bracket. Loading a bracket replaces every
 * match of the event in one transaction; the links between matches use ids the caller chose, so
 * the whole bracket is written in one insert and its foreign keys are checked once at its end.
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import type {
  MatchResultApply,
  SportEventMatchPatch,
  SportEventMatchRepository,
  SportEventMatchWrite,
} from '@poolmaster/shared/db';
import { MatchSide } from '@poolmaster/shared/domain';
import type { BackgroundJobRequest, SportEventMatch, SportEventMatchPeriodScore } from '@poolmaster/shared/domain';
import { rewriteStandings } from './prisma-standing-rewrite';
import { backgroundJobsInsert, insertBackgroundJobs } from './prisma-background-job-repository';

/** What a match is read with: its round's number and its period scores in order. */
export const MATCH_INCLUDE = {
  sportEventRound: { select: { roundNumber: true } },
  periodScores: { select: { periodNumber: true, homeScore: true, awayScore: true }, orderBy: { periodNumber: 'asc' } },
} satisfies Prisma.SportEventMatchInclude;

export class PrismaSportEventMatchRepository implements SportEventMatchRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<SportEventMatch | null> {
    const row = await this.prisma.sportEventMatch.findUnique({ where: { id }, include: MATCH_INCLUDE });
    return row ? toSportEventMatch(row) : null;
  }

  async findBySportEvent(sportEventId: string): Promise<SportEventMatch[]> {
    return this.findBySportEvents([sportEventId]);
  }

  async findBySportEvents(sportEventIds: readonly string[]): Promise<SportEventMatch[]> {
    if (sportEventIds.length === 0) return [];
    const rows = await this.prisma.sportEventMatch.findMany({
      where: { sportEventId: { in: [...sportEventIds] } },
      include: MATCH_INCLUDE,
      orderBy: [{ sportEventId: 'asc' }, { matchNumber: 'asc' }],
    });
    return rows.map(toSportEventMatch);
  }

  async replaceBracket(sportEventId: string, matches: readonly SportEventMatchWrite[], jobs: readonly BackgroundJobRequest[] = []): Promise<void> {
    const rounds = await this.prisma.sportEventRound.findMany({
      where: { sportEventId },
      select: { id: true, roundNumber: true },
    });
    const roundIdByNumber = new Map(rounds.map((round) => [round.roundNumber, round.id]));
    const data = matches.map(({ roundNumber, ...match }) => {
      const sportEventRoundId = roundIdByNumber.get(roundNumber);
      if (sportEventRoundId === undefined) {
        throw new Error(`Sport event ${sportEventId} has no round ${roundNumber}`);
      }
      return { ...match, sportEventId, sportEventRoundId };
    });
    await this.prisma.$transaction([
      this.prisma.sportEventMatch.deleteMany({ where: { sportEventId } }),
      this.prisma.sportEventMatch.createMany({ data }),
      ...(jobs.length > 0 ? [backgroundJobsInsert(this.prisma, jobs)] : []),
    ]);
  }

  async update(id: string, patch: SportEventMatchPatch, jobs: readonly BackgroundJobRequest[] = []): Promise<void> {
    const write = this.prisma.sportEventMatch.update({ where: { id }, data: patch });
    await (jobs.length === 0 ? write : this.prisma.$transaction([write, backgroundJobsInsert(this.prisma, jobs)]));
  }

  async savePeriodScore(
    sportEventMatchId: string,
    { periodNumber, homeScore, awayScore }: SportEventMatchPeriodScore,
    jobs: readonly BackgroundJobRequest[] = [],
  ): Promise<void> {
    const save = (db: Prisma.TransactionClient | PrismaClient) => db.sportEventMatchPeriodScore.upsert({
      where: { sportEventMatchId_periodNumber: { sportEventMatchId, periodNumber } },
      create: { sportEventMatchId, periodNumber, homeScore, awayScore },
      update: { homeScore, awayScore },
    });
    if (jobs.length === 0) {
      await save(this.prisma);
      return;
    }
    await this.prisma.$transaction(async (tx) => {
      await save(tx);
      await insertBackgroundJobs(tx, jobs);
    });
  }

  async deletePeriodScore(sportEventMatchId: string, periodNumber: number, jobs: readonly BackgroundJobRequest[] = []): Promise<void> {
    const remove = (db: Prisma.TransactionClient | PrismaClient) => db.sportEventMatchPeriodScore.deleteMany({ where: { sportEventMatchId, periodNumber } });
    if (jobs.length === 0) {
      await remove(this.prisma);
      return;
    }
    await this.prisma.$transaction(async (tx) => {
      await remove(tx);
      await insertBackgroundJobs(tx, jobs);
    });
  }

  async placeSides(sides: readonly { id: string; homeSportEventParticipantId: string; awaySportEventParticipantId: string }[], jobs: readonly BackgroundJobRequest[] = []): Promise<void> {
    await this.prisma.$transaction([
      // poolmaster-allow-query-in-loop: one round's matches (per-row values, one transaction)
      ...sides.map(({ id, ...values }) => this.prisma.sportEventMatch.update({ where: { id }, data: values })),
      ...(jobs.length > 0 ? [backgroundJobsInsert(this.prisma, jobs)] : []),
    ]);
  }

  async applyResult({ result, sideFill, standings, jobs = [] }: MatchResultApply): Promise<void> {
    const { id, ...values } = result;
    await this.prisma.$transaction(async (tx) => {
      await tx.sportEventMatch.update({ where: { id }, data: values });
      if (sideFill) {
        await tx.sportEventMatch.update({
          where: { id: sideFill.id },
          data: sideFill.side === MatchSide.HOME
            ? { homeSportEventParticipantId: sideFill.sportEventParticipantId }
            : { awaySportEventParticipantId: sideFill.sportEventParticipantId },
        });
      }
      // Every team's standing in a fixed number of statements, however big the bracket (#1252).
      await rewriteStandings(tx, standings.map(({ sportEventParticipantId, ...standing }) => ({ sportEventParticipantId, standing })));
      if (jobs.length > 0) await insertBackgroundJobs(tx, jobs);
    });
  }
}

export function toSportEventMatch(
  { sportEventRound, sportEventRoundId: _roundId, homeSpread, ...row }: Prisma.SportEventMatchGetPayload<{ include: typeof MATCH_INCLUDE }>,
): SportEventMatch {
  return {
    ...row,
    roundNumber: sportEventRound.roundNumber,
    homeSpread: homeSpread === null ? null : Number(homeSpread),
  };
}
