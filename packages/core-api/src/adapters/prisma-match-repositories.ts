/**
 * Prisma adapter for the match port (#698): an event's bracket. Loading a bracket replaces every
 * match of the event in one transaction; the links between matches use ids the caller chose, so
 * the whole bracket is written in one insert and its foreign keys are checked once at its end.
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import type {
  MatchLiveScoreWrite,
  MatchResultApply,
  SportEventRoundMatchPatch,
  SportEventRoundMatchRepository,
  SportEventRoundMatchWrite,
} from '@poolmaster/shared/db';
import { MatchSide, MatchStatus, UNPLAYED_MATCH_STATUSES } from '@poolmaster/shared/domain';
import type { BackgroundJobRequest, SportEventRoundMatch, SportEventMatchPeriodScore } from '@poolmaster/shared/domain';
import { ROUND_EVENT_SLOT_SELECT, toRoundSlot } from './season-slot-select';
import { rewriteStandings } from './prisma-standing-rewrite';
import { backgroundJobsInsert, insertBackgroundJobs } from './prisma-background-job-repository';

/** What a match is read with: its round's number and its period scores in order. */
export const MATCH_INCLUDE = {
  sportEventRound: { select: { roundNumber: true, eventSlot: ROUND_EVENT_SLOT_SELECT } },
  periodScores: { select: { periodNumber: true, homeScore: true, awayScore: true }, orderBy: { periodNumber: 'asc' } },
} satisfies Prisma.SportEventRoundMatchInclude;

export class PrismaSportEventRoundMatchRepository implements SportEventRoundMatchRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<SportEventRoundMatch | null> {
    const row = await this.prisma.sportEventRoundMatch.findUnique({ where: { id }, include: MATCH_INCLUDE });
    return row ? toSportEventRoundMatch(row) : null;
  }

  async findBySportEvent(sportEventId: string): Promise<SportEventRoundMatch[]> {
    return this.findBySportEvents([sportEventId]);
  }

  async findBySportEvents(sportEventIds: readonly string[]): Promise<SportEventRoundMatch[]> {
    if (sportEventIds.length === 0) return [];
    const rows = await this.prisma.sportEventRoundMatch.findMany({
      where: { sportEventId: { in: [...sportEventIds] } },
      include: MATCH_INCLUDE,
      orderBy: [{ sportEventId: 'asc' }, { sportEventRound: { roundNumber: 'asc' } }, { matchNumber: 'asc' }],
    });
    return rows.map(toSportEventRoundMatch);
  }

  async replaceBracket(sportEventId: string, matches: readonly SportEventRoundMatchWrite[], jobs: readonly BackgroundJobRequest[] = []): Promise<void> {
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
      this.prisma.sportEventRoundMatch.deleteMany({ where: { sportEventId } }),
      this.prisma.sportEventRoundMatch.createMany({ data }),
      ...(jobs.length > 0 ? [backgroundJobsInsert(this.prisma, jobs)] : []),
    ]);
  }

  async update(id: string, patch: SportEventRoundMatchPatch, jobs: readonly BackgroundJobRequest[] = []): Promise<void> {
    const write = this.prisma.sportEventRoundMatch.update({ where: { id }, data: patch });
    await (jobs.length === 0 ? write : this.prisma.$transaction([write, backgroundJobsInsert(this.prisma, jobs)]));
  }

  async savePeriodScore(
    sportEventRoundMatchId: string,
    { periodNumber, homeScore, awayScore }: SportEventMatchPeriodScore,
    jobs: readonly BackgroundJobRequest[] = [],
  ): Promise<void> {
    const save = (db: Prisma.TransactionClient | PrismaClient) => db.sportEventMatchPeriodScore.upsert({
      where: { sportEventRoundMatchId_periodNumber: { sportEventRoundMatchId, periodNumber } },
      create: { sportEventRoundMatchId, periodNumber, homeScore, awayScore },
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

  async linkGames(links: readonly { id: string; externalGameId: string }[]): Promise<void> {
    if (links.length === 0) return;
    await this.prisma.$transaction(
      // poolmaster-allow-query-in-loop: the games one sync linked (per-row values, one transaction)
      links.map(({ id, externalGameId }) => this.prisma.sportEventRoundMatch.update({ where: { id }, data: { externalGameId } })),
    );
  }

  async applyLiveScores(scores: readonly MatchLiveScoreWrite[]): Promise<void> {
    if (scores.length === 0) return;
    await this.prisma.$transaction(
      // poolmaster-allow-query-in-loop: the games one sync found live (per-row values, one transaction)
      scores.map(({ id, ...values }) => this.prisma.sportEventRoundMatch.updateMany({
        // A result entered since the sync read the match stands.
        where: { id, status: { in: [...UNPLAYED_MATCH_STATUSES, MatchStatus.IN_PROGRESS] } },
        data: values,
      })),
    );
  }

  async placeSides(sides: readonly { id: string; homeSportEventParticipantId: string; awaySportEventParticipantId: string }[], jobs: readonly BackgroundJobRequest[] = []): Promise<void> {
    await this.prisma.$transaction([
      // poolmaster-allow-query-in-loop: one round's matches (per-row values, one transaction)
      ...sides.map(({ id, ...values }) => this.prisma.sportEventRoundMatch.update({ where: { id }, data: values })),
      ...(jobs.length > 0 ? [backgroundJobsInsert(this.prisma, jobs)] : []),
    ]);
  }

  async applyResult({ result, sideFill, standings, jobs = [] }: MatchResultApply): Promise<void> {
    const { id, ...values } = result;
    await this.prisma.$transaction(async (tx) => {
      await tx.sportEventRoundMatch.update({ where: { id }, data: values });
      if (sideFill) {
        await tx.sportEventRoundMatch.update({
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

export function toSportEventRoundMatch(
  { sportEventRound, sportEventRoundId: _roundId, homeSpread, ...row }: Prisma.SportEventRoundMatchGetPayload<{ include: typeof MATCH_INCLUDE }>,
): SportEventRoundMatch {
  return {
    ...row,
    roundNumber: sportEventRound.roundNumber,
    slot: toRoundSlot(sportEventRound.eventSlot),
    homeSpread: homeSpread === null ? null : Number(homeSpread),
  };
}

