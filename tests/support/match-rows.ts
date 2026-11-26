import type { PrismaClient } from '@prisma/client';
import type { MatchResultWrite } from '@poolmaster/shared/db';
import { HomeAway, MatchEnding, MatchSideOutcome, MatchStatus, PeriodKind, gameNumbered } from '@poolmaster/shared/domain';
import type { SportEventRoundMatch } from '@poolmaster/shared/domain';

// Matches written straight to the database (#2046), for seeds below the repositories: each with
// its two sides and its Game 1, and a decided one with its outcomes and Game 1's side scores.

/** A decided single-game match: the side number that won (null for a draw) and each side's score, side 1's first. */
export interface MatchRowResult {
  winnerSideNumber: number | null;
  scores: readonly [number, number];
  completedAt?: Date;
}

export interface MatchRowCreate {
  sportEventId: string;
  sportEventRoundId: string;
  /** The slot the round is played in, which its Game 1 takes. */
  sportEventSlotId: string;
  matchNumber: number;
  /** Side 1's team then side 2's; the sync puts the away team on side 1 and the home team on side 2. */
  teams: readonly [string | null, string | null];
  isNeutralSite: boolean;
  scheduledDate?: Date | null;
  result?: MatchRowResult;
  /** A match under way without a result: IN_PROGRESS, its Game 1 too, scored from its periods. */
  inProgress?: boolean;
  /** Game 1's periods of play in order, each side 1's then side 2's own points. */
  periods?: readonly (readonly [number, number])[];
  /** Created on Game 1 with it: a provider's id for the game. */
  providerMapping?: { providerId: string; externalId: string };
}

/** A match row with its two sides, by side number, as a raw seed reads it. */
export interface MatchRowWithSides {
  id: string;
  sides: readonly { sideNumber: number; sportEventParticipantId: string | null }[];
}

/** The team on one side of a match row read with its sides; null while the side is empty. */
export function rowSideTeam(match: Pick<MatchRowWithSides, 'sides'>, sideNumber: number): string | null {
  return match.sides.find((side) => side.sideNumber === sideNumber)?.sportEventParticipantId ?? null;
}

/** The id of one side of a match row read with its sides. */
export function rowSideId(match: { sides: readonly { id: string; sideNumber: number }[] }, sideNumber: number): string {
  const side = match.sides.find((each) => each.sideNumber === sideNumber);
  if (!side) throw new Error(`The match has no side ${String(sideNumber)}`);
  return side.id;
}

/** One match with its two sides and its Game 1, decided when a result is given. */
export async function createMatchRow(prisma: PrismaClient, input: MatchRowCreate) {
  const { sportEventId, sportEventRoundId, sportEventSlotId, matchNumber, teams, isNeutralSite, scheduledDate = null, result, inProgress = false, periods = [], providerMapping } = input;
  const completedAt = result ? (result.completedAt ?? new Date()) : null;
  const status = result ? MatchStatus.COMPLETED : (inProgress ? MatchStatus.IN_PROGRESS : MatchStatus.SCHEDULED);
  const scoreOf = (sideNumber: number) => {
    if (result) return result.scores[sideNumber - 1] ?? null;
    if (periods.length === 0) return null;
    return periods.reduce((total, period) => total + (period[sideNumber - 1] ?? 0), 0);
  };
  const outcomeOf = (sideNumber: number) => {
    if (!result) return MatchSideOutcome.PENDING;
    if (result.winnerSideNumber === null) return MatchSideOutcome.TIED;
    return result.winnerSideNumber === sideNumber ? MatchSideOutcome.WON : MatchSideOutcome.LOST;
  };
  const homeAwayOf = (sideNumber: number) => {
    if (isNeutralSite) return HomeAway.NONE;
    return sideNumber === 1 ? HomeAway.AWAY : HomeAway.HOME;
  };
  const match = await prisma.sportEventRoundMatch.create({
    data: {
      sportEventId,
      sportEventRoundId,
      matchNumber,
      isNeutralSite,
      scheduledDate,
      status,
      completedAt,
    },
  });
  const sides = await prisma.sportEventRoundMatchSide.createManyAndReturn({
    data: teams.map((sportEventParticipantId, index) => ({ sportEventId, sportEventRoundMatchId: match.id, sideNumber: index + 1, sportEventParticipantId, outcome: outcomeOf(index + 1) })),
  });
  const game = await prisma.sportEventRoundMatchGame.create({
    data: {
      sportEventId,
      sportEventRoundMatchId: match.id,
      sportEventSlotId,
      gameNumber: 1,
      scheduledDate,
      status,
      completedAt,
      ...(providerMapping ? { providerMappings: { create: providerMapping } } : {}),
    },
  });
  const sideResults = await prisma.sportEventRoundMatchGameSideResult.createManyAndReturn({
    data: sides.map((side) => ({
      sportEventRoundMatchId: match.id,
      sportEventRoundMatchGameId: game.id,
      sportEventRoundMatchSideId: side.id,
      homeAway: homeAwayOf(side.sideNumber),
      score: scoreOf(side.sideNumber),
    })),
    include: { side: { select: { sideNumber: true } } },
  });
  if (periods.length > 0) {
    await prisma.sportEventRoundMatchGameSideResultPeriodScore.createMany({
      data: sideResults.flatMap((sideResult) => periods.map((period, index) => ({
        sportEventRoundMatchGameSideResultId: sideResult.id,
        kind: PeriodKind.REGULAR,
        periodNumber: index + 1,
        score: period[sideResult.side.sideNumber - 1] ?? 0,
      }))),
    });
  }
  return { ...match, sides: [...sides].sort((one, two) => one.sideNumber - two.sideNumber) };
}

/** A single-game match's COMPLETED result as the result writer writes it: each side's outcome (both TIED in a draw) and Game 1's side scores. */
export function singleGameResult(match: Pick<SportEventRoundMatch, 'id' | 'games'>, { winnerSideNumber, scores, completedAt = new Date() }: MatchRowResult): MatchResultWrite {
  const gameOne = gameNumbered(match, 1);
  if (!gameOne) throw new Error(`Match ${match.id} has no Game 1`);
  return {
    id: match.id,
    status: MatchStatus.COMPLETED,
    ending: MatchEnding.PLAYED,
    completedAt,
    outcomes: [1, 2].map((sideNumber) => ({
      sideNumber,
      outcome: winnerSideNumber === null ? MatchSideOutcome.TIED : sideNumber === winnerSideNumber ? MatchSideOutcome.WON : MatchSideOutcome.LOST,
    })),
    gameOne: { gameId: gameOne.id, scores: scores.map((score, index) => ({ sideNumber: index + 1, score, shootoutScore: null })) },
  };
}
