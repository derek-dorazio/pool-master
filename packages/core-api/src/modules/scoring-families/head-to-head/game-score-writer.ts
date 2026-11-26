/**
 * Writes a provider's game scores into an event's matches (#1496) and their Games (#2007). A
 * provider game is the Game its id is mapped to (`SportEventRoundMatchGameProviderMapping`); the
 * Game holds the provider's score of that game, and the match takes its result from its Games,
 * only once the provider calls them final. Every result goes through
 * `MatchResultService.recordResult`, the admin's own path, so its checks hold for a provider's
 * result too: both teams known, scores that fit the winner, no tie in a bracket, and a locked
 * result once the next match has one. A result an admin entered stands (#1531): a provider's
 * different final is logged and not written. An admin who clears it hands the match back to the
 * provider.
 *
 * The provider lists its own home and away teams. Each is matched to a side of the match through
 * the team's provider mapping, so a game the provider lists the other way round from the match
 * still scores the right side, and a game whose teams are not the match's is refused.
 *
 * A bracket game level after extra time is settled by its shoot-out (#1532): a provider that
 * reports the shoot-out's scores names the winner by them, and the match keeps them apart from
 * its score, as an admin's result does.
 *
 * Nobody maps a game by hand. A provider game no Game is mapped to yet is placed by its match and
 * game number: the one match of the event with both sides known whose two teams are the game's,
 * and that match's Game of the game's number (`GameScoreUpdate.gameNumber`, 1 for a single game),
 * created when the match has none yet. In a single-game round two teams meet once in a week or a
 * playoff, and in a best-of series once a playoff. A game two matches would fit, or a Game two
 * games would, is left for a later sync, never guessed at. A match whose side a result fills is
 * placed on the next sync. Two changes the provider makes to its own ids raise a finding:
 * - A re-issued id (#2007): the Game the new id is placed at is mapped to another id the batch no
 *   longer carries. The mapping moves to the new id (GAME_ID_REISSUED).
 * - A moved game (#2007): the id is mapped to a Game of another event, a game the provider moved
 *   to another week. The old Game is kept, with whatever is tied to it, and marked moved to the
 *   Game it is placed at here; the mapping moves with it (GAME_MOVED). Voiding picks on the old
 *   Game is #2016's.
 *
 * A best-of series (#1545: the NBA's best of seven, its round's slot `seriesGames`) is one match
 * with a Game for each game played. Its score is games won, counted from its Games as this sync
 * leaves them: the series takes its result once a side has won more than half of its games.
 *
 * Each Game holds each side's score and where it played that game (#2046): HOME or AWAY as the
 * provider lists its teams, or NONE at a neutral site. The match's sides never move: a game the
 * provider lists the other way round only changes `homeAway`. The match's own status follows its
 * Games while it is played (in progress, back to scheduled, postponed); its score is its Games'.
 *
 * A play-in game (the First Four's) is a match of the bracket's first round like any other, and
 * its winner advances into the next round's side its match feeds (#2184).
 */
import { randomUUID } from 'node:crypto';
import {
  compareMatchPlaces,
  describeMatchPlace,
  matchPlaceOf,
  requireProviderCodeOfSourceId,
  HomeAway,
  MatchStatus,
  gameNumbered,
  gameScoreOf as storedGameScoreOf,
  gameWinnerSideNumber,
  homeAwayOf,
  isMatchUnplayed,
  shootoutScoreOf,
  winningSide,
  ProviderGameState,
  ProviderSyncFindingKind,
  seriesWinsNeeded,
  type SportEventRoundMatch,
  type SportEventRoundMatchGame,
  matchIsNeutralSite,
} from '@poolmaster/shared/domain';
import type { GameScoreUpdate } from '@poolmaster/shared/dto';
import type { FastifyBaseLogger } from 'fastify';
import type {
  GameSideScoreWrite,
  MatchStatusWrite,
  ParticipantProviderMappingRepository,
  ProviderMappedGame,
  SportEventRoundMatchGameCreate,
  SportEventRoundMatchGameRepository,
  SportEventRoundMatchGameScoreWrite,
  SportEventRoundMatchRepository,
  SportEventParticipantRepository,
} from '@poolmaster/shared/db';
import { SportEventError } from '../../events/errors';
import { combineJobsForWrite } from '../../background-jobs/background-job-queue';
import { DomainEventType, type DomainEvents } from '../../domain-events';
import type { LiveScoreGameFinding, LiveScorePersistenceResult } from '../../ingestion/core/score-publisher';
import { summarizeSyncWriteRows, type SyncWriteDetailRow } from '../../ingestion/core/sync-write-diagnostics';
import type { LiveScoreTargetEvent } from '../scoring-family-module';
import type { MatchResultService } from './match-result-service';

export interface GameScoreWriterDeps {
  providerId: string;
  matches: Pick<SportEventRoundMatchRepository, 'findBySportEvent' | 'applyStatuses'>;
  games: Pick<SportEventRoundMatchGameRepository, 'findBySportEvent' | 'findByProviderExternalIds' | 'applySync'>;
  eventParticipants: Pick<SportEventParticipantRepository, 'findByIds'>;
  mappings: Pick<ParticipantProviderMappingRepository, 'findByProviderExternalIds'>;
  results: Pick<MatchResultService, 'recordResult'>;
  /** What follows a Game moved out of its event (#2048): the app's one map. */
  domainEvents: Pick<DomainEvents, 'collect'>;
  now?: () => Date;
  logger?: FastifyBaseLogger;
}

/** One side's score in a provider game, where it played, and its shoot-out kicks. */
type FeedSideScore = GameSideScoreWrite & { score: number; homeAway: HomeAway };

/** A game's result on the match's sides: the side that won, or null when level and undecided. */
interface MatchResultFromGame {
  winnerSideNumber: number | null;
  sides: readonly FeedSideScore[];
}

/** A provider game placed at its Game: the Game's id, its number and its match. */
interface PlacedGame {
  feed: GameScoreUpdate;
  gameId: string;
  gameNumber: number;
  match: SportEventRoundMatch;
  /** The Game as stored, or null for one this sync creates. */
  stored: SportEventRoundMatchGame | null;
}

/**
 * Places each provider game at its Game, then writes each Game's provider score, each final
 * single-game match's result and each series a side has won, then each live game's score, and
 * each series' wins so far, on a match with no result yet (read-only: it decides nothing). A game
 * the provider says has not started, or was postponed or cancelled, takes a live score back off
 * its match; only an admin cancels a match.
 * Earlier rounds go first, and each result is read against the bracket the last one wrote, so a
 * semifinal and the final it feeds, both final in one sync, both record.
 */
export async function writeGameScores(
  deps: GameScoreWriterDeps,
  event: LiveScoreTargetEvent,
  games: readonly GameScoreUpdate[],
): Promise<LiveScorePersistenceResult> {
  const sportEventId = event.id;
  const providerCode = requireProviderCodeOfSourceId(deps.providerId);
  const [loaded, storedGames] = await Promise.all([
    deps.matches.findBySportEvent(sportEventId),
    deps.games.findBySportEvent(sportEventId, providerCode),
  ]);
  const mappedHere = new Map(storedGames.flatMap((each) => (each.externalId === null ? [] : [[each.externalId, each.game] as const])));
  const matchById = new Map(loaded.map((match) => [match.id, match]));
  const unmapped = games.filter((game) => !mappedHere.has(game.providerGameId));
  const elsewhere = new Map((await deps.games.findByProviderExternalIds(providerCode, unmapped.map((game) => game.providerGameId)))
    .flatMap((each) => (each.externalId === null || each.game.sportEventId === sportEventId ? [] : [[each.externalId, each.game] as const])));
  const sidedMatches = unmapped.length === 0 ? [] : loaded.filter(hasBothSides);
  // A final or live game has a score to place on its match's sides; a game not under way has none.
  const scoredOfMapped = games.filter((game) => SCORED_STATES.has(game.state) && mappedHere.has(game.providerGameId));
  const matchesOfScored = [...new Set(scoredOfMapped.flatMap((game) => {
    const match = matchById.get(mappedHere.get(game.providerGameId)?.sportEventRoundMatchId ?? '');
    return match === undefined ? [] : [match];
  }))];
  // One read of the sides and one of the team mappings for the whole batch.
  const sidesOf = await participantsOfSides(deps, [...matchesOfScored, ...sidedMatches]);
  const teamsOf = await participantsOfTeams(deps, sportEventId, [...scoredOfMapped, ...(sidedMatches.length === 0 ? [] : unmapped)]);

  const placement = placeUnmappedGames(unmapped, sidedMatches, storedGames, new Set(games.map((game) => game.providerGameId)), elsewhere, sidesOf, teamsOf, sportEventId);
  for (const skipped of placement.ambiguous) {
    deps.logger?.warn(
      { action: 'liveScore.game.ambiguous', data: { sportEventId, providerGameId: skipped.providerGameId } },
      'Left a provider game unplaced: two matches or two games fit it, so a later sync or an admin settles it',
    );
  }
  for (const { feed, match, gameNumber } of placement.placed) {
    deps.logger?.info(
      { action: 'liveScore.game.linked', data: { sportEventId, ...matchPlaceOf(match), gameNumber, providerGameId: feed.providerGameId } },
      'Linked a provider game to the Game its teams play',
    );
  }
  const placed: PlacedGame[] = [
    ...games.flatMap((feed) => {
      const stored = mappedHere.get(feed.providerGameId);
      const match = stored === undefined ? undefined : matchById.get(stored.sportEventRoundMatchId);
      return stored === undefined || match === undefined ? [] : [{ feed, gameId: stored.id, gameNumber: stored.gameNumber, match, stored }];
    }),
    ...placement.placed,
  ];

  const now = deps.now?.() ?? new Date();
  const scored = placed.flatMap(({ feed, gameId, match, stored }) => {
    const score = gameScoreOf(feed, match, sidesOf, teamsOf, stored, now);
    if (score === null) return [];
    const { winnerSideNumber, ...write } = score;
    return [{ write: { id: gameId, ...write }, winnerSideNumber }];
  });
  const scores = scored.map((each) => each.write);
  // A Game made in a slot, or moved out of one, changes the games its event's slots choose their tiebreaker games from.
  const gamesChanged = combineJobsForWrite(...await Promise.all([...placement.gamesChangedEventIds]
    .map((changedEventId) => deps.domainEvents.collect({ type: DomainEventType.SPORT_EVENT_GAMES_CHANGED, sportEventId: changedEventId }))));
  await deps.games.applySync({ providerCode, created: placement.created, mapped: placement.mapped, moved: placement.moved, scores }, gamesChanged.jobs);
  gamesChanged.queued();

  const series = seriesStandings(deps, sportEventId, placed, placement.overLength, storedGames, scored);
  const finals: FinalResult[] = [
    ...placed.flatMap(({ feed, match }) => (match.slot.seriesGames === 1 && feed.state === ProviderGameState.FINAL
      ? [{ match, externalId: feed.providerGameId, resultOn: (current: SportEventRoundMatch) => resultFromGame(feed, current, sidesOf, teamsOf) }]
      : [])),
    ...series.flatMap((each) => {
      if (each.winnerSideNumber === null) return [];
      const result: MatchResultFromGame = {
        winnerSideNumber: each.winnerSideNumber,
        sides: [...each.wins].map(([sideNumber, wins]) => ({ sideNumber, score: wins, shootoutScore: null, homeAway: HomeAway.NONE })),
      };
      return [{ match: each.match, externalId: each.externalId, resultOn: () => result }];
    }),
  ].sort((left, right) => compareMatchPlaces(left.match, right.match));
  /** Each match as the latest result in this batch wrote it. */
  const rewritten = new Map<string, SportEventRoundMatch>();

  const rows: SyncWriteDetailRow[] = [];
  for (const final of finals) {
    const { externalId } = final;
    const match = rewritten.get(final.match.id) ?? final.match;
    const result = final.resultOn(match);
    if (result === null) {
      deps.logger?.warn(
        { action: 'liveScore.game.teamsDoNotFit', data: { sportEventId, ...matchPlaceOf(match), providerGameId: externalId } },
        'Skipped a final game that cannot score the linked match: its teams are not the match\'s, or it has no score',
      );
      continue;
    }
    const before = { winnerSideNumber: winningSide(match)?.sideNumber ?? null, sides: resultSidesOf(match, result) };
    const row = { id: match.id, entityType: 'SportEventRoundMatch', providerId: deps.providerId, externalId, internalId: match.id, name: describeMatchPlace(match, { sentenceStart: true }), before, after: { ...result } };
    if (hasResult(match, result)) {
      rows.push({ ...row, disposition: 'UNCHANGED' });
      continue;
    }
    try {
      // One at a time: the bracket each result writes is the one the next is read against.
      const bracket = await deps.results.recordResult(sportEventId, matchPlaceOf(match), {
        winnerSideNumber: result.winnerSideNumber,
        sides: result.sides.map(({ sideNumber, score, shootoutScore }) => ({ sideNumber, score, shootoutScore })),
      });
      for (const each of bracket) rewritten.set(each.id, each);
      rows.push({ ...row, disposition: 'UPDATED' });
    } catch (error) {
      if (!(error instanceof SportEventError)) throw error;
      deps.logger?.warn(
        { action: 'liveScore.game.refused', data: { sportEventId, ...matchPlaceOf(match), providerGameId: externalId, code: error.code } },
        'The match refused a provider\'s final result',
      );
    }
  }

  const scoredGameIds = new Set(scores.map((score) => score.id));
  const liveStatuses = [
    ...placed.flatMap(({ feed, gameId, match: placedMatch }) => {
      if (placedMatch.slot.seriesGames !== 1 || feed.state === ProviderGameState.FINAL) return [];
      const match = rewritten.get(placedMatch.id) ?? placedMatch;
      return [{ match, externalId: feed.providerGameId, status: liveStatusOf(feed, match, sidesOf, teamsOf), gameScored: scoredGameIds.has(gameId) }];
    }),
    ...series.flatMap((each) => {
      if (each.winnerSideNumber !== null) return [];
      const match = rewritten.get(each.match.id) ?? each.match;
      return [{ match, externalId: each.externalId, status: seriesLiveStatusOf(each, match), gameScored: each.gameIds.some((id) => scoredGameIds.has(id)) }];
    }),
  ];
  const live: MatchStatusWrite[] = [];
  for (const { match, externalId, status, gameScored } of liveStatuses) {
    if (status === null && !gameScored) continue;
    const statusChanges = status !== null && status !== match.status;
    if (statusChanges) live.push({ id: match.id, status });
    // The live score is the Game's, written with the sync's Games above.
    rows.push({
      id: match.id, entityType: 'SportEventRoundMatch', providerId: deps.providerId, externalId, internalId: match.id, name: describeMatchPlace(match, { sentenceStart: true }),
      before: { status: match.status }, after: { status: status ?? match.status }, disposition: statusChanges || gameScored ? 'UPDATED' : 'UNCHANGED',
    });
  }
  await deps.matches.applyStatuses(live);

  const persisted = rows.filter((row) => row.disposition === 'UPDATED').length;
  return {
    updatesReturned: games.length,
    updatesPersisted: persisted,
    updatesSkipped: games.length - persisted,
    writeDiagnostics: summarizeSyncWriteRows(rows),
    gameFindings: placement.findings,
  };
}

/** A match's final result in this batch, read against the match as the batch last wrote it. */
interface FinalResult {
  match: SportEventRoundMatch;
  /** The provider game it comes from; a series' games, comma-separated. */
  externalId: string;
  resultOn(match: SportEventRoundMatch): MatchResultFromGame | null;
}

/** What placing the unmapped games writes, and the findings it raises. */
interface GamePlacement {
  placed: PlacedGame[];
  created: SportEventRoundMatchGameCreate[];
  mapped: { sportEventRoundMatchGameId: string; externalId: string }[];
  moved: { id: string; movedToGameId: string }[];
  /** The events a Game was made in or moved out of: their slots choose their tiebreaker games again (#2048). */
  gamesChangedEventIds: Set<string>;
  findings: LiveScoreGameFinding[];
  ambiguous: GameScoreUpdate[];
  /** Each series' games numbered past its length, by match: the feed and the bracket disagree. */
  overLength: Map<string, GameScoreUpdate[]>;
}

/**
 * Each unmapped game at the Game of its number in the one match with both sides known whose two
 * teams are its own, where no other game of the batch claims that Game. A Game mapped to another
 * id the batch does not carry takes the new id (re-issued); a game mapped to a Game of another
 * event marks that Game moved to this one.
 */
function placeUnmappedGames(
  games: readonly GameScoreUpdate[],
  matches: readonly SidedMatch[],
  storedGames: readonly ProviderMappedGame[],
  batchIds: ReadonlySet<string>,
  elsewhere: ReadonlyMap<string, SportEventRoundMatchGame>,
  sidesOf: ReadonlyMap<string, string>,
  teamsOf: ReadonlyMap<string, string>,
  sportEventId: string,
): GamePlacement {
  const placement: GamePlacement = { placed: [], created: [], mapped: [], moved: [], gamesChangedEventIds: new Set(), findings: [], ambiguous: [], overLength: new Map() };
  if (games.length === 0) return placement;
  const matchesByTeams = groupByTeams(matches, (match) => {
    const [first, second] = match.sides.map((side) => (side.sportEventParticipantId === null ? undefined : sidesOf.get(side.sportEventParticipantId)));
    return [first, second];
  });
  const gamesByTeams = groupByTeams(games, (game) => [teamsOf.get(game.homeTeamExternalId), teamsOf.get(game.awayTeamExternalId)]);
  const storedByPlace = new Map(storedGames.map((each) => [gamePlaceKey(each.game.sportEventRoundMatchId, each.game.gameNumber), each]));
  for (const [teams, fitting] of gamesByTeams) {
    const candidates = matchesByTeams.get(teams) ?? [];
    for (const feed of fitting) {
      const gameNumber = feed.gameNumber ?? 1;
      const claimants = fitting.filter((other) => (other.gameNumber ?? 1) === gameNumber);
      const targets = candidates.filter((match) => gameNumber <= match.slot.seriesGames);
      const [onlyCandidate] = candidates;
      if (candidates.length === 1 && targets.length === 0 && onlyCandidate.slot.seriesGames > 1) {
        placement.overLength.set(onlyCandidate.id, [...(placement.overLength.get(onlyCandidate.id) ?? []), feed]);
        continue;
      }
      if (targets.length !== 1 || claimants.length !== 1) {
        if (targets.length > 1 || claimants.length > 1) placement.ambiguous.push(feed);
        continue;
      }
      const [match] = targets;
      const stored = storedByPlace.get(gamePlaceKey(match.id, gameNumber));
      // The Game's own id is still in the feed: two provider games for one Game.
      if (stored?.externalId != null && batchIds.has(stored.externalId)) {
        placement.ambiguous.push(feed);
        continue;
      }
      const gameId = stored?.game.id ?? randomUUID();
      if (stored === undefined) {
        placement.created.push({ id: gameId, sportEventId, sportEventRoundMatchId: match.id, sportEventSlotId: slotOfMatch(match, storedGames), gameNumber, isNeutralSite: matchIsNeutralSite(match) });
        placement.gamesChangedEventIds.add(sportEventId);
      }
      placement.mapped.push({ sportEventRoundMatchGameId: gameId, externalId: feed.providerGameId });
      placement.placed.push({ feed, gameId, gameNumber, match, stored: stored?.game ?? null });
      const movedFrom = elsewhere.get(feed.providerGameId);
      if (movedFrom !== undefined) {
        placement.moved.push({ id: movedFrom.id, movedToGameId: gameId });
        placement.gamesChangedEventIds.add(movedFrom.sportEventId);
        placement.findings.push({ kind: ProviderSyncFindingKind.GAME_MOVED, providerValue: feed.providerGameId });
      } else if (stored?.externalId != null) {
        placement.findings.push({ kind: ProviderSyncFindingKind.GAME_ID_REISSUED, providerValue: feed.providerGameId });
      }
    }
  }
  return placement;
}

function gamePlaceKey(sportEventRoundMatchId: string, gameNumber: number): string {
  return JSON.stringify([sportEventRoundMatchId, gameNumber]);
}

/** The slot a match is played in, as its Games carry it: every match has its Game 1. */
function slotOfMatch(match: SportEventRoundMatch, storedGames: readonly ProviderMappedGame[]): string {
  const game = storedGames.find((each) => each.game.sportEventRoundMatchId === match.id);
  if (game === undefined) throw new Error(`Match ${match.id} has no Game: every match is loaded with its Game 1.`);
  return game.game.sportEventSlotId;
}

/** A best-of series this batch scored: each side's Games won, and its winner once decided. */
interface SeriesStanding {
  match: SportEventRoundMatch;
  externalId: string;
  /** Games won, by side number. */
  wins: ReadonlyMap<number, number>;
  /** The side that has won more than half of the series' games, or null while it is still on. */
  winnerSideNumber: number | null;
  /** Whether any of its games has started. */
  started: boolean;
  /** The series' Games this batch placed a game at. */
  gameIds: readonly string[];
}

/** A Game's status and winner, as stored or as this sync writes it. */
interface GameState {
  id: string;
  status: MatchStatus;
  winnerSideNumber: number | null;
}

/**
 * Each series match this batch placed a game at, from its Games as this sync leaves them: stored,
 * with this sync's scores over them. A series with more decided games than it can have (more than
 * its length, or a side past the wins it takes) is left alone: the feed and the bracket disagree,
 * and an admin settles it.
 */
function seriesStandings(
  deps: GameScoreWriterDeps,
  sportEventId: string,
  placed: readonly PlacedGame[],
  overLength: ReadonlyMap<string, readonly GameScoreUpdate[]>,
  storedGames: readonly ProviderMappedGame[],
  scored: readonly ScoredGameWrite[],
): SeriesStanding[] {
  const seriesMatches = new Map(placed.filter(({ match }) => match.slot.seriesGames > 1).map(({ match }) => [match.id, match]));
  const scoreOf = new Map(scored.map(({ write, winnerSideNumber }): [string, GameState] => [write.id, { id: write.id, status: write.status, winnerSideNumber }]));
  const gamesOf = new Map<string, GameState[]>();
  const add = (matchId: string, game: GameState) => {
    gamesOf.set(matchId, [...(gamesOf.get(matchId) ?? []).filter((each) => each.id !== game.id), scoreOf.get(game.id) ?? game]);
  };
  for (const { game } of storedGames) {
    if (seriesMatches.has(game.sportEventRoundMatchId)) add(game.sportEventRoundMatchId, { id: game.id, status: game.status, winnerSideNumber: gameWinnerSideNumber(game) });
  }
  for (const each of placed) if (seriesMatches.has(each.match.id) && each.stored === null) add(each.match.id, { id: each.gameId, status: MatchStatus.SCHEDULED, winnerSideNumber: null });
  return [...seriesMatches.values()].flatMap((match) => {
    const length = match.slot.seriesGames;
    const seriesGames = gamesOf.get(match.id) ?? [];
    const winners = seriesGames.flatMap((game) => (game.status === MatchStatus.COMPLETED && game.winnerSideNumber !== null ? [game.winnerSideNumber] : []));
    const placedHere = placed.filter((each) => each.match.id === match.id);
    const externalId = [...placedHere.map((each) => each.feed), ...(overLength.get(match.id) ?? [])]
      .map((feed) => feed.providerGameId).join(',');
    const wins = new Map(match.sides.map(({ sideNumber }) => [sideNumber, winners.filter((winner) => winner === sideNumber).length]));
    const needed = seriesWinsNeeded(length);
    // A game counted after the series was won (5-0 in a best of seven) is as wrong as one too many.
    if (overLength.has(match.id) || winners.length > length || Math.max(...wins.values()) > needed) {
      deps.logger?.warn(
        { action: 'liveScore.series.tooManyGames', data: { sportEventId, ...matchPlaceOf(match), providerGameIds: externalId, length } },
        'Skipped a series whose feed has more decided games than the series can have',
      );
      return [];
    }
    const winnerSideNumber = [...wins].find(([, won]) => won >= needed)?.[0] ?? null;
    const started = seriesGames.some((game) => game.status === MatchStatus.IN_PROGRESS || game.status === MatchStatus.COMPLETED);
    return [{ match, externalId, wins, winnerSideNumber, started, gameIds: placedHere.map((each) => each.gameId) }];
  });
}

/** A side's score in a played game, and its shoot-out. */
interface ScoredSide {
  sideNumber: number;
  score: number;
  shootoutScore: number | null;
}

/** A Game's score as this sync writes it, with the side that won it: null until it is final, or when level. */
interface ScoredGameWrite {
  write: SportEventRoundMatchGameScoreWrite;
  winnerSideNumber: number | null;
}

/** The side number with the higher score, or on a level score the higher shoot-out; null when level. */
function winnerOfScores(first: ScoredSide, second: ScoredSide): number | null {
  if (first.score !== second.score) return first.score > second.score ? first.sideNumber : second.sideNumber;
  if (first.shootoutScore === null || second.shootoutScore === null || first.shootoutScore === second.shootoutScore) return null;
  return first.shootoutScore > second.shootoutScore ? first.sideNumber : second.sideNumber;
}

/** Items by their two teams, in either order; an item with a team not known is left out. */
function groupByTeams<T>(items: readonly T[], teamsOf: (item: T) => readonly [string | undefined, string | undefined]): Map<string, T[]> {
  const byTeams = new Map<string, T[]>();
  for (const item of items) {
    const [first, second] = teamsOf(item);
    if (first === undefined || second === undefined) continue;
    const key = [first, second].sort().join('|');
    byTeams.set(key, [...(byTeams.get(key) ?? []), item]);
  }
  return byTeams;
}

/**
 * The status a series puts on its match while no side has won it: in progress once a game has
 * started, scheduled again while none has. Null when there is nothing to write.
 */
function seriesLiveStatusOf(series: SeriesStanding, match: SportEventRoundMatch): MatchStatusWrite['status'] | null {
  if (!isMatchUnplayed(match.status) && match.status !== MatchStatus.IN_PROGRESS) return null;
  if (!series.started) return match.status === MatchStatus.IN_PROGRESS ? MatchStatus.SCHEDULED : null;
  return MatchStatus.IN_PROGRESS;
}

/** A match with both sides known. */
type SidedMatch = SportEventRoundMatch;

function hasBothSides(match: SportEventRoundMatch): match is SidedMatch {
  return match.sides.length > 0 && match.sides.every((side) => side.sportEventParticipantId !== null);
}

/** The participant behind each match side, by event-participant id. */
async function participantsOfSides(deps: GameScoreWriterDeps, matches: readonly SportEventRoundMatch[]): Promise<Map<string, string>> {
  const ids = [...new Set(matches.flatMap((match) => match.sides.flatMap((side) => (side.sportEventParticipantId === null ? [] : [side.sportEventParticipantId]))))];
  if (ids.length === 0) return new Map();
  const rows = await deps.eventParticipants.findByIds(ids);
  return new Map(rows.map((row) => [row.id, row.participantId]));
}

/** The participant each provider team is mapped to in the event's sport league, by the provider's team id. */
async function participantsOfTeams(deps: GameScoreWriterDeps, sportEventId: string, games: readonly GameScoreUpdate[]): Promise<Map<string, string>> {
  const ids = [...new Set(games.flatMap((game) => [game.homeTeamExternalId, game.awayTeamExternalId]))];
  if (ids.length === 0) return new Map();
  const mappings = await deps.mappings.findByProviderExternalIds(requireProviderCodeOfSourceId(deps.providerId), { sportEventId }, ids);
  return new Map(mappings.map((mapping) => [mapping.externalId, mapping.participantId]));
}

/**
 * The game's result on the match's sides, or null when its teams are not the match's two (a side
 * still to be decided, an unmapped team, or a link to the wrong game). The provider's home team's
 * side played at HOME and the other AWAY, or both NONE at a neutral site. Level scores with a
 * shoot-out go to the shoot-out's winner; level scores without one are a tie, which only a game
 * that can end level accepts.
 */
function resultFromGame(
  game: GameScoreUpdate,
  match: SportEventRoundMatch,
  sidesOf: ReadonlyMap<string, string>,
  teamsOf: ReadonlyMap<string, string>,
): MatchResultFromGame | null {
  if (game.homeScore === null || game.awayScore === null) return null;
  const gameHome = teamsOf.get(game.homeTeamExternalId);
  const gameAway = teamsOf.get(game.awayTeamExternalId);
  const teamOf = (side: SportEventRoundMatch['sides'][number]) => (side.sportEventParticipantId === null ? undefined : sidesOf.get(side.sportEventParticipantId));
  const homeSide = match.sides.find((side) => gameHome !== undefined && teamOf(side) === gameHome);
  const awaySide = match.sides.find((side) => gameAway !== undefined && teamOf(side) === gameAway);
  if (homeSide === undefined || awaySide === undefined || homeSide.sideNumber === awaySide.sideNumber) return null;
  const shootout = game.homeShootoutScore === undefined || game.homeShootoutScore === null
    || game.awayShootoutScore === undefined || game.awayShootoutScore === null
    ? null
    : { home: game.homeShootoutScore, away: game.awayShootoutScore };
  // A shoot-out decides only a level game; a provider's shoot-out beside a decided score is ignored.
  const level = game.homeScore === game.awayScore;
  const home: ScoredSide = { sideNumber: homeSide.sideNumber, score: game.homeScore, shootoutScore: level && shootout ? shootout.home : null };
  const away: ScoredSide = { sideNumber: awaySide.sideNumber, score: game.awayScore, shootoutScore: level && shootout ? shootout.away : null };
  const sides: FeedSideScore[] = [
    { ...home, homeAway: matchIsNeutralSite(match) ? HomeAway.NONE : HomeAway.HOME },
    { ...away, homeAway: matchIsNeutralSite(match) ? HomeAway.NONE : HomeAway.AWAY },
  ].sort((left, right) => left.sideNumber - right.sideNumber);
  return { winnerSideNumber: winnerOfScores(home, away), sides };
}

const SCORED_STATES: ReadonlySet<ProviderGameState> = new Set([ProviderGameState.FINAL, ProviderGameState.IN_PROGRESS]);

/** The Game's status for each state the provider reports a game in. */
const GAME_STATUS_BY_STATE: Readonly<Record<ProviderGameState, MatchStatus>> = {
  [ProviderGameState.SCHEDULED]: MatchStatus.SCHEDULED,
  [ProviderGameState.IN_PROGRESS]: MatchStatus.IN_PROGRESS,
  [ProviderGameState.FINAL]: MatchStatus.COMPLETED,
  [ProviderGameState.POSTPONED]: MatchStatus.POSTPONED,
  [ProviderGameState.CANCELLED]: MatchStatus.CANCELLED,
};

/**
 * The provider's score of the game as its Game holds it, on the match's sides: a played game's
 * score, where each side played and its shoot-out; none for one not under way. Null when there is
 * nothing to write: the Game already holds it, a played game has no score or teams that are not
 * the match's, or the Game is a single game's that the result writes (a final, or a match decided
 * or cancelled). A final Game carries the side that won it, for its series.
 */
function gameScoreOf(
  game: GameScoreUpdate,
  match: SportEventRoundMatch,
  sidesOf: ReadonlyMap<string, string>,
  teamsOf: ReadonlyMap<string, string>,
  stored: SportEventRoundMatchGame | null,
  now: Date,
): Omit<SportEventRoundMatchGameScoreWrite, 'id'> & Pick<ScoredGameWrite, 'winnerSideNumber'> | null {
  const status = GAME_STATUS_BY_STATE[game.state];
  // A single game's Game 1 is its match: its final score is the result's to write (recordResult),
  // and a match with a result, or cancelled, takes no live score.
  if (match.slot.seriesGames === 1 && (status === MatchStatus.COMPLETED || (!isMatchUnplayed(match.status) && match.status !== MatchStatus.IN_PROGRESS))) return null;
  const played = status === MatchStatus.IN_PROGRESS || status === MatchStatus.COMPLETED;
  const score = played ? resultFromGame(game, match, sidesOf, teamsOf) : null;
  if (played && score === null) return null;
  // A game not under way keeps where its sides play, and has no score.
  const sides = score?.sides ?? match.sides.map(({ sideNumber }) => ({
    sideNumber, score: null, shootoutScore: null, homeAway: stored === null ? defaultHomeAway(match, sideNumber) : homeAwayOf(stored, sideNumber),
  }));
  const unchanged = stored !== null && stored.status === status && sides.every((side) => storedGameScoreOf(stored, side.sideNumber) === side.score
    && shootoutScoreOf(stored, side.sideNumber) === side.shootoutScore && homeAwayOf(stored, side.sideNumber) === side.homeAway);
  if (unchanged) return null;
  const completed = status === MatchStatus.COMPLETED;
  return { sportEventRoundMatchId: match.id, status, sides, completedAt: completed ? now : null, winnerSideNumber: completed && score !== null ? score.winnerSideNumber : null };
}

/** Where a side plays a new Game of its match before the provider says: as it played Game 1. */
function defaultHomeAway(match: SportEventRoundMatch, sideNumber: number): HomeAway {
  const gameOne = gameNumbered(match, 1);
  return gameOne === null ? HomeAway.NONE : homeAwayOf(gameOne, sideNumber);
}

/**
 * The status a game puts on a match that has no result: in progress while it is played, scheduled
 * again once the provider says it has not started, POSTPONED (#1791) when the provider postpones
 * it, and scheduled again once the provider says so. Null when there is nothing to write: the
 * match has a result or was cancelled, a live game has no score yet or teams that are not the
 * match's, or a game not under way meets a match already in its state.
 */
function liveStatusOf(
  game: GameScoreUpdate,
  match: SportEventRoundMatch,
  sidesOf: ReadonlyMap<string, string>,
  teamsOf: ReadonlyMap<string, string>,
): MatchStatusWrite['status'] | null {
  if (!isMatchUnplayed(match.status) && match.status !== MatchStatus.IN_PROGRESS) return null;
  if (game.state === ProviderGameState.POSTPONED) return match.status === MatchStatus.POSTPONED ? null : MatchStatus.POSTPONED;
  if (game.state !== ProviderGameState.IN_PROGRESS) {
    const backToScheduled = match.status === MatchStatus.IN_PROGRESS
      || (match.status === MatchStatus.POSTPONED && game.state === ProviderGameState.SCHEDULED);
    return backToScheduled ? MatchStatus.SCHEDULED : null;
  }
  if (resultFromGame(game, match, sidesOf, teamsOf) === null) return null;
  return match.status === MatchStatus.IN_PROGRESS ? null : MatchStatus.IN_PROGRESS;
}

/** Each side's score and shoot-out in the match as stored, for the sides a result names. */
function resultSidesOf(match: SportEventRoundMatch, result: MatchResultFromGame): { sideNumber: number; score: number | null; shootoutScore: number | null }[] {
  const gameOne = gameNumbered(match, 1);
  return result.sides.map(({ sideNumber }) => ({
    sideNumber,
    score: match.slot.seriesGames === 1 ? (gameOne === null ? null : storedGameScoreOf(gameOne, sideNumber)) : seriesWinsOf(match, sideNumber),
    shootoutScore: match.slot.seriesGames === 1 && gameOne !== null ? shootoutScoreOf(gameOne, sideNumber) : null,
  }));
}

/** A series side's Games won, as stored. */
function seriesWinsOf(match: SportEventRoundMatch, sideNumber: number): number {
  return match.games.filter((game) => gameWinnerSideNumber(game) === sideNumber).length;
}

/** Whether the match already holds this result, so a repeated sync writes nothing. */
function hasResult(match: SportEventRoundMatch, result: MatchResultFromGame): boolean {
  if (match.status !== MatchStatus.COMPLETED || (winningSide(match)?.sideNumber ?? null) !== result.winnerSideNumber) return false;
  const stored = resultSidesOf(match, result);
  return result.sides.every((side) => {
    const before = stored.find((each) => each.sideNumber === side.sideNumber);
    return before?.score === side.score && (match.slot.seriesGames !== 1 || before.shootoutScore === side.shootoutScore);
  });
}
