/**
 * Prisma adapter for the results of an event's FIELD Games (#622, #2008): a race, a golf round.
 * Each round holds one FIELD Match with every competitor in it as a side, and one Game; a
 * competitor's result in the round is its side result there. A write puts down the side results,
 * the Games' statuses and each competitor's core standing in one transaction, so a reader never
 * sees a result without the place it gives the competitor in the event.
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { FieldGameRepository, FieldGameWrite, FieldResultsApply, FieldSideResult, FieldStanding } from '@poolmaster/shared/db';
import { HomeAway } from '@poolmaster/shared/domain';
import { insertBackgroundJobs } from './prisma-background-job-repository';
import { rewriteStandings } from './prisma-standing-rewrite';
import { readFieldMatchIds } from './field-match-read';
import { FIELD_MATCH_WHERE } from './season-slot-select';

type Tx = Prisma.TransactionClient;

/** A round's FIELD Match as a write needs it: its Game 1 and the sides already in it. */
interface FieldMatch {
  id: string;
  roundNumber: number;
  gameId: string;
  sides: Array<{ id: string; sideNumber: number; sportEventParticipantId: string | null }>;
}

export class PrismaFieldGameRepository implements FieldGameRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findResults(sportEventId: string): Promise<FieldSideResult[]> {
    const matchIds = await readFieldMatchIds(this.prisma, [sportEventId]);
    if (matchIds.length === 0) return [];
    const rows = await this.prisma.sportEventRoundMatchGameSideResult.findMany({
      where: { sportEventRoundMatchId: { in: matchIds } },
      include: {
        side: { select: { sportEventParticipantId: true } },
        game: { select: { status: true, match: { select: { sportEventRound: { select: { roundNumber: true } } } } } },
      },
    });
    return rows
      .flatMap((row) => {
        const entryId = row.side.sportEventParticipantId;
        return entryId ? [{
          sportEventParticipantId: entryId,
          score: row.score,
          scoreToPar: row.scoreToPar,
          periodsCompleted: row.periodsCompleted,
          position: row.position,
          startPosition: row.startPosition,
          status: row.status,
          roundNumber: row.game.match.sportEventRound.roundNumber,
          gameStatus: row.game.status,
          updatedAt: row.updatedAt,
        }] : [];
      })
      .sort((left, right) => left.roundNumber - right.roundNumber || left.sportEventParticipantId.localeCompare(right.sportEventParticipantId));
  }

  async hasFeedFinal(sportEventId: string): Promise<boolean> {
    return (await this.prisma.sportEventSlot.findFirst({ where: { sportEventId, feedFinalAt: { not: null } }, select: { id: true } })) !== null;
  }

  async findStandings(sportEventId: string): Promise<FieldStanding[]> {
    const rows = await this.prisma.sportEventParticipantStanding.findMany({
      where: { sportEventParticipant: { sportEventId } },
      orderBy: { sportEventParticipantId: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id,
      sportEventParticipantId: row.sportEventParticipantId,
      position: row.position,
      displayPosition: row.displayPosition,
      status: row.status,
      asOf: row.asOf,
      total: row.total,
      scoreToPar: row.scoreToPar,
    }));
  }

  /**
   * In a fixed number of statements however big the field (#1252), and two more for each round
   * written (its Match's and Game's statuses): the rounds' Matches and Games are found or
   * created, a competitor new to a round gets its next side number, and the named competitors'
   * side results are deleted and inserted again.
   */
  async applyResults(sportEventId: string, apply: FieldResultsApply): Promise<void> {
    // A round named twice keeps the later write, and in it a competitor named twice the later result.
    const games = [...new Map(apply.games.map((game) => [game.roundNumber, game])).values()].map((game) => ({
      ...game,
      sides: [...new Map(game.sides.map((side) => [side.sportEventParticipantId, side])).values()],
    }));
    await this.prisma.$transaction(async (tx) => {
      if (games.length > 0) {
        const rounds = await findOrCreateFieldMatches(tx, sportEventId, games);
        for (const { match, game } of rounds) {
          // poolmaster-allow-query-in-loop: one status update per round written, never per competitor
          await tx.sportEventRoundMatch.update({ where: { id: match.id }, data: { status: game.status } });
          // poolmaster-allow-query-in-loop: one status update per round written, never per competitor
          await tx.sportEventRoundMatchGame.update({ where: { id: match.gameId }, data: { status: game.status, completedAt: game.completedAt } });
        }
        await writeSideResults(tx, sportEventId, rounds);
      }
      await rewriteStandings(tx, apply.standings.map(({ sportEventParticipantId, ...standing }) => ({ sportEventParticipantId, standing })));
      if (apply.feedFinalAt) await tx.sportEventSlot.updateMany({ where: { sportEventId, feedFinalAt: null }, data: { feedFinalAt: apply.feedFinalAt } });
      await insertBackgroundJobs(tx, apply.jobs ?? []);
    });
  }
}

/**
 * Each round's FIELD Match and its Game 1, in the order of `games`, created for a round that has
 * none yet: four statements at most. Ids are chosen here, so a new Match and Game go in one
 * insert each.
 */
async function findOrCreateFieldMatches(tx: Tx, sportEventId: string, games: readonly FieldGameWrite[]): Promise<Array<{ match: FieldMatch; game: FieldGameWrite }>> {
  const eventRounds = await tx.sportEventRound.findMany({
    where: { sportEventId, roundNumber: { in: games.map((game) => game.roundNumber) } },
    select: {
      id: true,
      roundNumber: true,
      sportEventSlotId: true,
      matches: {
        where: FIELD_MATCH_WHERE,
        orderBy: { matchNumber: 'asc' },
        take: 1,
        select: { id: true, games: { where: { gameNumber: 1 }, select: { id: true, gameNumber: true } }, sides: { select: { id: true, sideNumber: true, sportEventParticipantId: true } } },
      },
    },
  });
  const missing: number[] = [];
  const found: Array<{ round: (typeof eventRounds)[number]; game: FieldGameWrite }> = [];
  for (const game of games) {
    const round = eventRounds.find((candidate) => candidate.roundNumber === game.roundNumber);
    if (round) found.push({ round, game });
    else missing.push(game.roundNumber);
  }
  if (missing.length > 0) throw new Error(`Sport event ${sportEventId} has no round ${missing.join(', ')} to hold its results.`);

  // The round's first FIELD match holds its results; a round with none gets one, numbered after the round's last match.
  const toCreate: Array<{ round: (typeof eventRounds)[number]; game: FieldGameWrite; match: FieldMatch }> = [];
  const resolved = found.map(({ round, game }) => {
    // poolmaster-allow-position: the read takes the round's first FIELD match by matchNumber, the one that holds its results
    const existing = round.matches.at(0);
    if (!existing) {
      const match: FieldMatch = { id: randomUUID(), roundNumber: round.roundNumber, gameId: randomUUID(), sides: [] };
      toCreate.push({ round, game, match });
      return { game, match };
    }
    const gameOne = existing.games.find((candidate) => candidate.gameNumber === 1);
    if (!gameOne) throw new Error(`The FIELD match of round ${round.roundNumber} of sport event ${sportEventId} has no Game.`);
    return { game, match: { id: existing.id, roundNumber: round.roundNumber, gameId: gameOne.id, sides: existing.sides } };
  });
  if (toCreate.length > 0) {
    const lastMatchNumbers = await tx.sportEventRoundMatch.groupBy({
      by: ['sportEventRoundId'],
      where: { sportEventRoundId: { in: toCreate.map(({ round }) => round.id) } },
      _max: { matchNumber: true },
    });
    const lastMatchNumberOf = (roundId: string): number => Math.max(0, ...lastMatchNumbers
      .filter((group) => group.sportEventRoundId === roundId)
      .map((group) => group._max.matchNumber ?? 0));
    await tx.sportEventRoundMatch.createMany({
      data: toCreate.map(({ round, game, match }) => ({ id: match.id, sportEventId, sportEventRoundId: round.id, matchNumber: lastMatchNumberOf(round.id) + 1, status: game.status })),
    });
    await tx.sportEventRoundMatchGame.createMany({
      data: toCreate.map(({ round, game, match }) => ({ id: match.gameId, sportEventId, sportEventRoundMatchId: match.id, sportEventSlotId: round.sportEventSlotId, gameNumber: 1, status: game.status })),
    });
  }
  return resolved;
}

/** Every round's new sides, then its named side results deleted and inserted again: three statements at most. */
async function writeSideResults(tx: Tx, sportEventId: string, rounds: ReadonlyArray<{ match: FieldMatch; game: FieldGameWrite }>): Promise<void> {
  const added: Prisma.SportEventRoundMatchSideCreateManyInput[] = [];
  const results = rounds.flatMap(({ match, game }) => {
    let nextSideNumber = Math.max(0, ...match.sides.map((side) => side.sideNumber)) + 1;
    return game.sides.map((side) => {
      const existing = match.sides.find((candidate) => candidate.sportEventParticipantId === side.sportEventParticipantId);
      const sideId = existing?.id ?? randomUUID();
      if (!existing) added.push({ id: sideId, sportEventId, sportEventRoundMatchId: match.id, sideNumber: nextSideNumber++, sportEventParticipantId: side.sportEventParticipantId });
      return { match, side, sideId };
    });
  });
  if (results.length === 0) return;
  if (added.length > 0) await tx.sportEventRoundMatchSide.createMany({ data: added });
  await tx.sportEventRoundMatchGameSideResult.deleteMany({
    where: { sportEventRoundMatchGameId: { in: rounds.map(({ match }) => match.gameId) }, sportEventRoundMatchSideId: { in: results.map((result) => result.sideId) } },
  });
  await tx.sportEventRoundMatchGameSideResult.createMany({
    data: results.map(({ match, side, sideId }) => ({
      sportEventRoundMatchId: match.id,
      sportEventRoundMatchGameId: match.gameId,
      sportEventRoundMatchSideId: sideId,
      homeAway: HomeAway.NONE,
      score: side.score,
      scoreToPar: side.scoreToPar,
      periodsCompleted: side.periodsCompleted,
      position: side.position,
      startPosition: side.startPosition,
      status: side.status,
    })),
  });
}
