/**
 * Prisma adapter for the match port (#698): an event's bracket. Loading a bracket replaces every
 * match of the event in one transaction; the links between matches use ids the caller chose, so
 * the whole bracket is written in one insert and its foreign keys are checked once at its end.
 * Each match is written with its Game 1 (#2007), in the round's slot.
 *
 * The Game port (#2007) is here too: an event's Games with one provider's ids for them, and what
 * a score sync writes to them.
 */

import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import type {
  GamePeriodScoresWrite,
  GameSideScoreWrite,
  MatchResultApply,
  MatchSideTeam,
  MatchStatusWrite,
  ProviderMappedGame,
  SportEventRoundMatchGameRepository,
  SportEventRoundMatchGameSync,
  SportEventRoundMatchPatch,
  SportEventRoundMatchRepository,
  SportEventRoundMatchWrite,
} from '@poolmaster/shared/db';
import { MatchStatus, PeriodKind, UNPLAYED_MATCH_STATUSES } from '@poolmaster/shared/domain';
import type { BackgroundJobRequest, HomeAway, ProviderCode, SportEventRoundMatch, SportEventRoundMatchGame } from '@poolmaster/shared/domain';
import { ROUND_EVENT_SLOT_SELECT, toRoundSlot } from './season-slot-select';
import { rewriteStandings } from './prisma-standing-rewrite';
import { backgroundJobsInsert, insertBackgroundJobs } from './prisma-background-job-repository';

/** What a Game is read with (#2046): each side's result, with the side's number and its period scores in order. */
const GAME_SIDE_RESULTS_INCLUDE = {
  sideResults: {
    include: {
      side: { select: { sideNumber: true } },
      periodScores: { select: { kind: true, periodNumber: true, score: true }, orderBy: [{ kind: 'asc' }, { periodNumber: 'asc' }] },
    },
    orderBy: { side: { sideNumber: 'asc' } },
  },
} satisfies Prisma.SportEventRoundMatchGameInclude;

/** What a match is read with: its round's number and slot, its sides and its Games with their side results. */
export const MATCH_INCLUDE = {
  sportEventRound: { select: { roundNumber: true, eventSlot: ROUND_EVENT_SLOT_SELECT } },
  sides: { orderBy: { sideNumber: 'asc' } },
  games: { include: GAME_SIDE_RESULTS_INCLUDE, orderBy: { gameNumber: 'asc' } },
} satisfies Prisma.SportEventRoundMatchInclude;

type Db = Prisma.TransactionClient | PrismaClient;

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
      select: { id: true, roundNumber: true, sportEventSlotId: true },
    });
    const roundByNumber = new Map(rounds.map((round) => [round.roundNumber, round]));
    // Ids chosen here, so the sides, Games and side results go in one insert each.
    const data = matches.map(({ roundNumber, sides, isNeutralSite, ...match }) => {
      const round = roundByNumber.get(roundNumber);
      if (round === undefined) {
        throw new Error(`Sport event ${sportEventId} has no round ${roundNumber}`);
      }
      return {
        match: { ...match, sportEventId, sportEventRoundId: round.id },
        sportEventSlotId: round.sportEventSlotId,
        gameId: randomUUID(),
        isNeutralSite,
        sides: sides.map((side) => ({ ...side, id: randomUUID() })),
      };
    });
    await this.prisma.$transaction([
      this.prisma.sportEventRoundMatch.deleteMany({ where: { sportEventId } }),
      this.prisma.sportEventRoundMatch.createMany({ data: data.map((each) => each.match) }),
      this.prisma.sportEventRoundMatchSide.createMany({
        data: data.flatMap(({ match, sides }) => sides.map(({ homeAway: _homeAway, ...side }) => ({ ...side, sportEventId, sportEventRoundMatchId: match.id }))),
      }),
      // Every match has its Game 1 from the start, played in its round's slot, with both sides' results.
      this.prisma.sportEventRoundMatchGame.createMany({
        data: data.map(({ match, gameId, sportEventSlotId, isNeutralSite }) => ({ id: gameId, sportEventId, sportEventRoundMatchId: match.id, sportEventSlotId, gameNumber: 1, scheduledDate: match.scheduledDate, isNeutralSite })),
      }),
      this.prisma.sportEventRoundMatchGameSideResult.createMany({
        data: data.flatMap(({ match, gameId, sides }) => sides.map((side) => ({
          sportEventRoundMatchId: match.id, sportEventRoundMatchGameId: gameId, sportEventRoundMatchSideId: side.id, homeAway: side.homeAway,
        }))),
      }),
      ...(jobs.length > 0 ? [backgroundJobsInsert(this.prisma, jobs)] : []),
    ]);
  }

  async update(id: string, { sides = [], spread, gameOneHomeAway = [], isNeutralSite, ...patch }: SportEventRoundMatchPatch, jobs: readonly BackgroundJobRequest[] = []): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.sportEventRoundMatch.update({ where: { id }, data: patch }),
      ...sideTeamUpdates(this.prisma, id, sides),
      ...(isNeutralSite === undefined ? [] : [this.prisma.sportEventRoundMatchGame.updateMany({ where: { sportEventRoundMatchId: id, gameNumber: 1 }, data: { isNeutralSite } })]),
      // poolmaster-allow-query-in-loop: a match's two sides at most
      ...gameOneHomeAway.map(({ sideNumber, homeAway }) => this.prisma.sportEventRoundMatchGameSideResult.updateMany({
        where: { sportEventRoundMatchId: id, game: { gameNumber: 1 }, side: { sideNumber } },
        data: { homeAway },
      })),
      ...(spread === undefined ? [] : [this.prisma.sportEventRoundMatchSide.updateMany({ where: { sportEventRoundMatchId: id, sideNumber: 1 }, data: { spread } })]),
      ...(jobs.length > 0 ? [backgroundJobsInsert(this.prisma, jobs)] : []),
    ]);
  }

  async saveGamePeriodScores({ sportEventRoundMatchId, gameId, sides }: GamePeriodScoresWrite, jobs: readonly BackgroundJobRequest[] = []): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const results = await sideResultsOf(tx, [{ sportEventRoundMatchId, gameId, sideNumbers: sides.map((side) => side.sideNumber) }]);
      // A Game's periods of play are replaced together; its shoot-out stays.
      await tx.sportEventRoundMatchGameSideResultPeriodScore.deleteMany({
        where: { sportEventRoundMatchGameSideResultId: { in: [...(results.get(gameId)?.values() ?? [])] }, kind: { not: PeriodKind.SHOOTOUT } },
      });
      await tx.sportEventRoundMatchGameSideResultPeriodScore.createMany({
        data: sides.flatMap(({ sideNumber, periodScores }) => periodScores.map((period) => ({ ...period, sportEventRoundMatchGameSideResultId: requireResult(results, gameId, sideNumber) }))),
      });
      if (jobs.length > 0) await insertBackgroundJobs(tx, jobs);
    });
  }

  async applyStatuses(statuses: readonly MatchStatusWrite[]): Promise<void> {
    if (statuses.length === 0) return;
    await this.prisma.$transaction(
      // poolmaster-allow-query-in-loop: the games one sync found live (per-row values, one transaction)
      statuses.map(({ id, status }) => this.prisma.sportEventRoundMatch.updateMany({
        // A result entered since the sync read the match stands.
        where: { id, status: { in: [...UNPLAYED_MATCH_STATUSES, MatchStatus.IN_PROGRESS] } },
        data: { status },
      })),
    );
  }

  async placeSides(matches: readonly { id: string; sides: readonly MatchSideTeam[] }[], jobs: readonly BackgroundJobRequest[] = []): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // A team moving between two sides of one round is free first, so the unique team-per-match key holds.
      await tx.sportEventRoundMatchSide.updateMany({ where: { sportEventRoundMatchId: { in: matches.map((match) => match.id) } }, data: { sportEventParticipantId: null } });
      for (const { id, sides } of matches) await Promise.all(sideTeamUpdates(tx, id, sides));
      if (jobs.length > 0) await insertBackgroundJobs(tx, jobs);
    });
  }

  async applyResult({ result, sideFill, standings, jobs = [] }: MatchResultApply): Promise<void> {
    const { id, outcomes, gameOne, completedAt, ...values } = result;
    await this.prisma.$transaction(async (tx) => {
      await tx.sportEventRoundMatch.update({ where: { id }, data: values });
      // poolmaster-allow-query-in-loop: a match's two sides
      for (const { sideNumber, outcome } of outcomes) await tx.sportEventRoundMatchSide.updateMany({ where: { sportEventRoundMatchId: id, sideNumber }, data: { outcome } });
      if (gameOne !== null) {
        // A single game's Game 1 is the match: it takes the result's status and completion time.
        await tx.sportEventRoundMatchGame.update({ where: { id: gameOne.gameId }, data: { status: values.status, completedAt } });
        await writeSideScores(tx, [{ sportEventRoundMatchId: id, gameId: gameOne.gameId, scores: gameOne.scores }]);
      }
      if (sideFill) {
        await tx.sportEventRoundMatchSide.updateMany({
          where: { sportEventRoundMatchId: sideFill.id, sideNumber: sideFill.sideNumber },
          data: { sportEventParticipantId: sideFill.sportEventParticipantId },
        });
      }
      // Every team's standing in a fixed number of statements, however big the bracket (#1252).
      await rewriteStandings(tx, standings.map(({ sportEventParticipantId, ...standing }) => ({ sportEventParticipantId, standing })));
      if (jobs.length > 0) await insertBackgroundJobs(tx, jobs);
    });
  }
}

/** The statements setting each named side's team. */
function sideTeamUpdates(db: Db, sportEventRoundMatchId: string, sides: readonly MatchSideTeam[]) {
  // poolmaster-allow-query-in-loop: a match's two sides at most
  return sides.map(({ sideNumber, sportEventParticipantId }) => db.sportEventRoundMatchSide.updateMany({
    where: { sportEventRoundMatchId, sideNumber },
    data: { sportEventParticipantId },
  }));
}

/** One Game's side scores to write. */
interface GameSideScores {
  sportEventRoundMatchId: string;
  gameId: string;
  scores: readonly (GameSideScoreWrite & { homeAway?: HomeAway })[];
}

/**
 * Each Game's side result ids by side number, created where a side has none yet: one read and at
 * most one insert, however many Games, so a sync's batch costs the same reads for 2 games as 20.
 */
async function sideResultsOf(
  db: Prisma.TransactionClient,
  games: readonly { sportEventRoundMatchId: string; gameId: string; sideNumbers: readonly number[] }[],
): Promise<Map<string, Map<number, string>>> {
  const gameIds = games.map((game) => game.gameId);
  const sides = await db.sportEventRoundMatchSide.findMany({
    where: { sportEventRoundMatchId: { in: games.map((game) => game.sportEventRoundMatchId) } },
    select: {
      id: true, sideNumber: true, sportEventRoundMatchId: true,
      gameResults: { where: { sportEventRoundMatchGameId: { in: gameIds } }, select: { id: true, sportEventRoundMatchGameId: true } },
    },
  });
  const sidesOfMatch = (matchId: string) => sides.filter((side) => side.sportEventRoundMatchId === matchId);
  const missing = games.flatMap((game) => sidesOfMatch(game.sportEventRoundMatchId)
    .filter((side) => game.sideNumbers.includes(side.sideNumber) && !side.gameResults.some((result) => result.sportEventRoundMatchGameId === game.gameId))
    .map((side) => ({ sportEventRoundMatchId: game.sportEventRoundMatchId, sportEventRoundMatchGameId: game.gameId, sportEventRoundMatchSideId: side.id })));
  const created = missing.length === 0 ? [] : await db.sportEventRoundMatchGameSideResult.createManyAndReturn({
    data: missing,
    select: { id: true, sportEventRoundMatchSideId: true, sportEventRoundMatchGameId: true },
  });
  const results = [
    ...sides.flatMap((side) => side.gameResults.map((result) => ({ id: result.id, gameId: result.sportEventRoundMatchGameId, sideId: side.id }))),
    ...created.map((result) => ({ id: result.id, gameId: result.sportEventRoundMatchGameId, sideId: result.sportEventRoundMatchSideId })),
  ];
  return new Map(games.map((game) => [game.gameId, new Map(sidesOfMatch(game.sportEventRoundMatchId).flatMap((side) => {
    const result = results.find((each) => each.gameId === game.gameId && each.sideId === side.id);
    return result ? [[side.sideNumber, result.id] as const] : [];
  }))]));
}

function requireResult(results: ReadonlyMap<string, ReadonlyMap<number, string>>, gameId: string, sideNumber: number): string {
  const id = results.get(gameId)?.get(sideNumber);
  if (id === undefined) throw new Error(`Game ${gameId} has no side ${String(sideNumber)}`);
  return id;
}

/**
 * Writes each side's score in each Game, where it played when given, and its shoot-out, or none:
 * one read, one update per side result and a fixed number of shoot-out writes for the batch.
 */
async function writeSideScores(db: Prisma.TransactionClient, games: readonly GameSideScores[]): Promise<void> {
  if (games.length === 0) return;
  const results = await sideResultsOf(db, games.map(({ sportEventRoundMatchId, gameId, scores }) => ({ sportEventRoundMatchId, gameId, sideNumbers: scores.map((each) => each.sideNumber) })));
  const rows = games.flatMap(({ gameId, scores }) => scores.map((score) => ({ ...score, resultId: requireResult(results, gameId, score.sideNumber) })));
  // poolmaster-allow-query-in-loop: each scored side result (per-row values, one transaction)
  await Promise.all(rows.map(({ resultId, score, homeAway }) => db.sportEventRoundMatchGameSideResult.update({
    where: { id: resultId },
    data: { score, ...(homeAway !== undefined && { homeAway }) },
  })));
  await db.sportEventRoundMatchGameSideResultPeriodScore.deleteMany({ where: { sportEventRoundMatchGameSideResultId: { in: rows.map((row) => row.resultId) }, kind: PeriodKind.SHOOTOUT } });
  const shootouts = rows.flatMap(({ resultId, shootoutScore }) => (shootoutScore === null ? [] : [{
    sportEventRoundMatchGameSideResultId: resultId, kind: PeriodKind.SHOOTOUT, periodNumber: 1, score: shootoutScore,
  }]));
  if (shootouts.length > 0) await db.sportEventRoundMatchGameSideResultPeriodScore.createMany({ data: shootouts });
}

type GameRow = Prisma.SportEventRoundMatchGameGetPayload<{ include: typeof GAME_SIDE_RESULTS_INCLUDE }>;

function toGame({ sideResults, ...game }: GameRow): SportEventRoundMatchGame {
  return {
    ...game,
    sideResults: sideResults.map((result) => ({
      sportEventRoundMatchSideId: result.sportEventRoundMatchSideId,
      sideNumber: result.side.sideNumber,
      score: result.score,
      homeAway: result.homeAway,
      periodScores: result.periodScores,
    })),
  };
}

export function toSportEventRoundMatch(
  { sportEventRound, sportEventRoundId: _roundId, sides, games, ...row }: Prisma.SportEventRoundMatchGetPayload<{ include: typeof MATCH_INCLUDE }>,
): SportEventRoundMatch {
  return {
    ...row,
    roundNumber: sportEventRound.roundNumber,
    slot: toRoundSlot(sportEventRound.eventSlot),
    sides: sides.map((side) => ({
      id: side.id,
      sideNumber: side.sideNumber,
      sportEventParticipantId: side.sportEventParticipantId,
      spread: side.spread === null ? null : Number(side.spread),
      outcome: side.outcome,
    })),
    games: games.map(toGame),
  };
}

/** What a Game is read with: its provider ids at one provider. */
function gameInclude(providerCode: ProviderCode) {
  return {
    ...GAME_SIDE_RESULTS_INCLUDE,
    providerMappings: { where: { provider: { code: providerCode } }, select: { externalId: true } },
  } satisfies Prisma.SportEventRoundMatchGameInclude;
}

function toProviderMappedGame({ providerMappings, ...game }: Prisma.SportEventRoundMatchGameGetPayload<{ include: ReturnType<typeof gameInclude> }>): ProviderMappedGame {
  // A Game has at most one id at a provider (sportEventRoundMatchGameId, providerId is unique).
  return { game: toGame(game), externalId: providerMappings[0]?.externalId ?? null };
}

export class PrismaSportEventRoundMatchGameRepository implements SportEventRoundMatchGameRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findBySportEvent(sportEventId: string, providerCode: ProviderCode): Promise<ProviderMappedGame[]> {
    const rows = await this.prisma.sportEventRoundMatchGame.findMany({
      where: { sportEventId },
      include: gameInclude(providerCode),
      orderBy: [{ sportEventRoundMatchId: 'asc' }, { gameNumber: 'asc' }],
    });
    return rows.map(toProviderMappedGame);
  }

  async findByProviderExternalIds(providerCode: ProviderCode, externalIds: readonly string[]): Promise<ProviderMappedGame[]> {
    if (externalIds.length === 0) return [];
    const rows = await this.prisma.sportEventRoundMatchGame.findMany({
      where: { providerMappings: { some: { provider: { code: providerCode }, externalId: { in: [...externalIds] } } } },
      include: gameInclude(providerCode),
    });
    return rows.map(toProviderMappedGame);
  }

  async applySync({ providerCode, created, mapped, moved, scores }: SportEventRoundMatchGameSync, jobs: readonly BackgroundJobRequest[] = []): Promise<void> {
    if (created.length === 0 && mapped.length === 0 && moved.length === 0 && scores.length === 0) return;
    const provider = mapped.length === 0 ? null : await this.prisma.provider.findUniqueOrThrow({ where: { code: providerCode }, select: { id: true } });
    await this.prisma.$transaction(async (tx) => {
      if (created.length > 0) await tx.sportEventRoundMatchGame.createMany({ data: [...created] });
      if (provider !== null) {
        // A mapped id leaves the Game it was on (a moved game), and the Game's old id leaves it (a re-issued one).
        await tx.sportEventRoundMatchGameProviderMapping.deleteMany({
          where: {
            providerId: provider.id,
            OR: [
              { externalId: { in: mapped.map((each) => each.externalId) } },
              { sportEventRoundMatchGameId: { in: mapped.map((each) => each.sportEventRoundMatchGameId) } },
            ],
          },
        });
        await tx.sportEventRoundMatchGameProviderMapping.createMany({ data: mapped.map((each) => ({ ...each, providerId: provider.id })) });
      }
      // poolmaster-allow-query-in-loop: the Games one sync found moved (per-row values, one transaction)
      for (const { id, movedToGameId } of moved) await tx.sportEventRoundMatchGame.update({ where: { id }, data: { movedToGameId } });
      // poolmaster-allow-query-in-loop: the Games one sync scored (per-row values, one transaction)
      for (const { id, status, completedAt } of scores) await tx.sportEventRoundMatchGame.update({ where: { id }, data: { status, completedAt } });
      await writeSideScores(tx, scores.map(({ id, sportEventRoundMatchId, sides }) => ({ sportEventRoundMatchId, gameId: id, scores: sides })));
      if (jobs.length > 0) await backgroundJobsInsert(tx, jobs);
    });
  }

  async recordProviderNotification(gameIds: readonly string[], receivedAt: Date): Promise<void> {
    if (gameIds.length === 0) return;
    await this.prisma.sportEventRoundMatchGame.updateMany({ where: { id: { in: [...gameIds] } }, data: { lastProviderNotificationAt: receivedAt } });
  }
}
