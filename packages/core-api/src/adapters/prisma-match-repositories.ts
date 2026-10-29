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
import type { SportEventMatch, SportEventMatchPeriodScore } from '@poolmaster/shared/domain';

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

  async replaceBracket(sportEventId: string, matches: readonly SportEventMatchWrite[]): Promise<void> {
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
    ]);
  }

  async update(id: string, patch: SportEventMatchPatch): Promise<void> {
    await this.prisma.sportEventMatch.update({ where: { id }, data: patch });
  }

  async savePeriodScore(sportEventMatchId: string, { periodNumber, homeScore, awayScore }: SportEventMatchPeriodScore): Promise<void> {
    await this.prisma.sportEventMatchPeriodScore.upsert({
      where: { sportEventMatchId_periodNumber: { sportEventMatchId, periodNumber } },
      create: { sportEventMatchId, periodNumber, homeScore, awayScore },
      update: { homeScore, awayScore },
    });
  }

  async deletePeriodScore(sportEventMatchId: string, periodNumber: number): Promise<void> {
    await this.prisma.sportEventMatchPeriodScore.deleteMany({ where: { sportEventMatchId, periodNumber } });
  }

  async placeSides(sides: readonly { id: string; homeSportEventParticipantId: string; awaySportEventParticipantId: string }[]): Promise<void> {
    // poolmaster-allow-query-in-loop: per-row values in one batched transaction; a set-based write needs raw SQL (held)
    await this.prisma.$transaction(sides.map(({ id, ...values }) => this.prisma.sportEventMatch.update({ where: { id }, data: values })));
  }

  async applyResult({ result, sideFill, standings }: MatchResultApply): Promise<void> {
    const { id, ...values } = result;
    await this.prisma.$transaction([
      this.prisma.sportEventMatch.update({ where: { id }, data: values }),
      ...(sideFill
        ? [this.prisma.sportEventMatch.update({
          where: { id: sideFill.id },
          data: sideFill.side === MatchSide.HOME
            ? { homeSportEventParticipantId: sideFill.sportEventParticipantId }
            : { awaySportEventParticipantId: sideFill.sportEventParticipantId },
        })]
        : []),
      // poolmaster-allow-query-in-loop: per-row values in one batched transaction; a set-based write needs raw SQL (held)
      ...standings.map(({ sportEventParticipantId, ...standing }) => this.prisma.sportEventParticipantStanding.upsert({
        where: { sportEventParticipantId },
        create: { sportEventParticipantId, ...standing },
        update: standing,
      })),
    ]);
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
