/**
 * Prisma adapter for a race's finishing order (#622, #2008). A race is one FIELD Match in its
 * event's first round, every runner a side, with one Game: a runner's result is its side result
 * there, with its rider, and the race is official once that Game is COMPLETED. The finishing
 * order writes the sides, their results, the Game's status and each runner's core standing in
 * one transaction, so a reader never sees a result without the place
 * it gives the runner in the event.
 */

import type { PrismaClient } from '@prisma/client';
import type { RaceOrderApply, RaceOrderRepository, RaceOrderResult } from '@poolmaster/shared/db';
import { HomeAway, MatchStatus } from '@poolmaster/shared/domain';
import { insertBackgroundJobs } from './prisma-background-job-repository';
import { rewriteStandings } from './prisma-standing-rewrite';
import { readFieldMatchIds } from './field-match-read';
import { FIELD_MATCH_WHERE } from './season-slot-select';

/** A race result as read: the side result, its side's field row and rider, and its Game's status. */
const RACE_SIDE_RESULT_INCLUDE = {
  side: { select: { sportEventParticipantId: true } },
  game: { select: { status: true } },
} as const;

export class PrismaRaceOrderRepository implements RaceOrderRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findBySportEvent(sportEventId: string): Promise<RaceOrderResult[]> {
    const matchIds = await readFieldMatchIds(this.prisma, [sportEventId]);
    if (matchIds.length === 0) return [];
    const rows = await this.prisma.sportEventRoundMatchGameSideResult.findMany({
      where: { sportEventRoundMatchId: { in: matchIds } },
      include: RACE_SIDE_RESULT_INCLUDE,
      orderBy: { side: { sportEventParticipantId: 'asc' } },
    });
    return rows.flatMap((row) => {
      const entryId = row.side.sportEventParticipantId;
      // A side result with no status is not a race result (the race writer always sends one).
      return entryId && row.status !== null ? [{
        sportEventParticipantId: entryId,
        position: row.position,
        startPosition: row.startPosition,
        status: row.status,
        riderName: row.riderName,
        isOfficial: row.game.status === MatchStatus.COMPLETED,
        updatedAt: row.updatedAt,
      }] : [];
    });
  }

  /**
   * In a fixed number of statements, however big the field (#1252): the race's Match and Game are
   * created with its first result, a runner new to the race gets the next side number, and the
   * named runners' side results, each with its rider, are deleted and inserted again.
   */
  async applyOrder(sportEventId: string, apply: RaceOrderApply): Promise<void> {
    // A runner named twice keeps the later result, as two writes in a row would leave it.
    const sides = [...new Map(apply.sides.map((side) => [side.sportEventParticipantId, side])).values()];
    const gameStatus = apply.isOfficial ? MatchStatus.COMPLETED : MatchStatus.IN_PROGRESS;
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.sportEventRoundMatch.findFirst({
        where: { sportEventId, ...FIELD_MATCH_WHERE },
        orderBy: [{ sportEventRound: { roundNumber: 'asc' } }, { matchNumber: 'asc' }],
        select: { id: true, games: { where: { gameNumber: 1 }, select: { id: true, gameNumber: true } }, sides: { select: { id: true, sideNumber: true, sportEventParticipantId: true } } },
      });
      const race = existing ?? await createRace(tx, sportEventId, gameStatus);
      const gameId = race.games.find((game) => game.gameNumber === 1)?.id;
      if (!gameId) throw new Error(`The race of sport event ${sportEventId} has no Game.`);
      await tx.sportEventRoundMatch.update({ where: { id: race.id }, data: { status: gameStatus } });
      await tx.sportEventRoundMatchGame.update({
        where: { id: gameId },
        data: { status: gameStatus, completedAt: apply.isOfficial ? apply.at : null },
      });

      if (sides.length > 0) {
        const sideByEntry = new Map(race.sides.flatMap((side) => (side.sportEventParticipantId ? [[side.sportEventParticipantId, side.id] as const] : [])));
        let nextSideNumber = Math.max(0, ...race.sides.map((side) => side.sideNumber)) + 1;
        const added = sides
          .filter((side) => !sideByEntry.has(side.sportEventParticipantId))
          .map((side) => ({ sportEventId, sportEventRoundMatchId: race.id, sideNumber: nextSideNumber++, sportEventParticipantId: side.sportEventParticipantId }));
        if (added.length > 0) {
          const created = await tx.sportEventRoundMatchSide.createManyAndReturn({ data: added, select: { id: true, sportEventParticipantId: true } });
          for (const side of created) if (side.sportEventParticipantId) sideByEntry.set(side.sportEventParticipantId, side.id);
        }
        const sideIdOf = (entryId: string): string => {
          const sideId = sideByEntry.get(entryId);
          if (!sideId) throw new Error(`Field row ${entryId} has no side in the race of sport event ${sportEventId}.`);
          return sideId;
        };
        await tx.sportEventRoundMatchGameSideResult.deleteMany({
          where: { sportEventRoundMatchGameId: gameId, sportEventRoundMatchSideId: { in: sides.map((side) => sideIdOf(side.sportEventParticipantId)) } },
        });
        await tx.sportEventRoundMatchGameSideResult.createMany({
          data: sides.map((side) => ({
            sportEventRoundMatchId: race.id,
            sportEventRoundMatchGameId: gameId,
            sportEventRoundMatchSideId: sideIdOf(side.sportEventParticipantId),
            homeAway: HomeAway.NONE,
            position: side.position,
            startPosition: side.startPosition,
            status: side.status,
            riderName: side.riderName,
          })),
        });
      }
      await rewriteStandings(tx, apply.standings.map(({ sportEventParticipantId, ...standing }) => ({ sportEventParticipantId, standing })));
      await insertBackgroundJobs(tx, apply.jobs ?? []);
    });
  }
}

/** The race's Match and Game 1, in the event's first round and its slot. */
async function createRace(tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0], sportEventId: string, status: MatchStatus) {
  const round = await tx.sportEventRound.findFirst({
    where: { sportEventId },
    orderBy: { roundNumber: 'asc' },
    select: { id: true, sportEventSlotId: true, matches: { select: { matchNumber: true } } },
  });
  if (!round) throw new Error(`Sport event ${sportEventId} has no round to hold its race.`);
  const match = await tx.sportEventRoundMatch.create({
    data: { sportEventId, sportEventRoundId: round.id, matchNumber: Math.max(0, ...round.matches.map((match) => match.matchNumber)) + 1, status },
    select: { id: true },
  });
  const game = await tx.sportEventRoundMatchGame.create({
    data: { sportEventId, sportEventRoundMatchId: match.id, sportEventSlotId: round.sportEventSlotId, gameNumber: 1, status },
    select: { id: true, gameNumber: true },
  });
  return { id: match.id, games: [game], sides: [] as Array<{ id: string; sideNumber: number; sportEventParticipantId: string | null }> };
}
