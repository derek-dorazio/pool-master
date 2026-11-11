/**
 * Writes a provider's game scores into an event's matches (#1496). A match takes its result from
 * the provider game it is linked to (`externalGameId`), and only once the provider calls the game
 * final. Every result goes through `MatchResultService.recordResult`, the admin's own path, so its
 * checks hold for a provider's result too: both teams known, scores that fit the winner, no tie in
 * a bracket, and a locked result once the next match has one. A result an admin entered stands
 * (#1531): a provider's different final is logged and not written. An admin who clears it hands
 * the match back to the provider.
 *
 * The provider lists its own home and away teams. Each is matched to a side of the match through
 * the team's provider mapping, so a game the provider lists the other way round from the match
 * still scores the right side, and a game whose teams are not the match's is refused.
 *
 * A bracket game level after extra time is settled by its shoot-out (#1532): a provider that
 * reports the shoot-out's scores names the winner by them, and the match keeps them apart from
 * its score, as an admin's result does.
 *
 * Nobody links a game by hand. A game no match is linked to yet is linked to the one match of the
 * event, unlinked and with both sides known, whose two teams are the game's: in a single-game
 * round, two teams meet once in a week or a playoff. A best-of series is one match of several
 * games, which this rule does not fit (#1545). A game two matches would fit, or a match two games
 * would, is left for a later sync, never guessed at. A match whose side a result fills is linked
 * on the next sync.
 */
import { MatchResultSource, MatchSide, MatchStatus, ProviderGameState, type SportEventMatch } from '@poolmaster/shared/domain';
import type { GameScoreUpdate } from '@poolmaster/shared/dto';
import type { FastifyBaseLogger } from 'fastify';
import type { MatchLiveScoreWrite, ParticipantProviderMappingRepository, SportEventMatchRepository, SportEventParticipantRepository } from '@poolmaster/shared/db';
import { SportEventError } from '../../events/errors';
import type { LiveScorePersistenceResult } from '../../ingestion/core/score-publisher';
import { summarizeSyncWriteRows, type SyncWriteDetailRow } from '../../ingestion/core/sync-write-diagnostics';
import type { MatchResultService } from './match-result-service';

export interface GameScoreWriterDeps {
  providerId: string;
  matches: Pick<SportEventMatchRepository, 'findBySportEvent' | 'linkGames' | 'applyLiveScores'>;
  eventParticipants: Pick<SportEventParticipantRepository, 'findByIds'>;
  mappings: Pick<ParticipantProviderMappingRepository, 'findByProviderExternalIds'>;
  results: Pick<MatchResultService, 'recordResult'>;
  logger?: FastifyBaseLogger;
}

/** A final game's result, from the match's side. */
interface MatchResultFromGame {
  winnerSide: MatchSide | null;
  homeScore: number;
  awayScore: number;
  /** Both or neither (left out is neither): a level game's shoot-out, from the match's side. */
  homeShootoutScore?: number;
  awayShootoutScore?: number;
}

/**
 * Links each game that fits one match, then writes each final game linked to one of the event's
 * matches, then each live game's score on a match with no result yet (read-only: it decides
 * nothing). A game the provider says has not started, or was postponed or cancelled, takes a
 * live score back off its match; only an admin cancels a match.
 * Earlier rounds go first, and each result is read against the bracket the last one wrote, so a
 * semifinal and the final it feeds, both final in one sync, both record.
 */
export async function writeGameScores(
  deps: GameScoreWriterDeps,
  sportEventId: string,
  games: readonly GameScoreUpdate[],
): Promise<LiveScorePersistenceResult> {
  const loaded = await deps.matches.findBySportEvent(sportEventId);
  const linkedGameIds = new Set(loaded.flatMap((match) => (match.externalGameId === null ? [] : [match.externalGameId])));
  const unlinkedGames = games.filter((game) => !linkedGameIds.has(game.externalGameId));
  const openMatches = unlinkedGames.length === 0 ? [] : loaded.filter(isOpenMatch);
  // A final or live game has a score to place on its match's sides.
  const scoredOfLinked = games.filter((game) => SCORED_STATES.has(game.state) && linkedGameIds.has(game.externalGameId));
  const scoredGameIds = new Set(scoredOfLinked.map((game) => game.externalGameId));
  const linkedMatchesOfScored = loaded.filter((match) => match.externalGameId !== null && scoredGameIds.has(match.externalGameId));
  // One read of the sides and one of the team mappings for the whole batch.
  const sidesOf = await participantsOfSides(deps, [...linkedMatchesOfScored, ...openMatches]);
  const teamsOf = await participantsOfTeams(deps, [...scoredOfLinked, ...(openMatches.length === 0 ? [] : unlinkedGames)]);

  const links = gamesToLink(unlinkedGames, openMatches, sidesOf, teamsOf);
  await deps.matches.linkGames(links.map(({ game, match }) => ({ id: match.id, externalGameId: game.externalGameId })));
  for (const { game, match } of links) {
    deps.logger?.info(
      { action: 'liveScore.game.linked', data: { sportEventId, matchNumber: match.matchNumber, externalGameId: game.externalGameId } },
      'Linked a provider game to the match its teams play',
    );
  }
  const linkedGameOf = new Map(links.map(({ game, match }) => [match.id, game.externalGameId]));
  const matches = loaded.map((match) => {
    const externalGameId = linkedGameOf.get(match.id);
    return externalGameId === undefined ? match : { ...match, externalGameId };
  });

  const matchByGame = new Map(
    matches.flatMap((match) => (match.externalGameId === null ? [] : [[match.externalGameId, match] as const])),
  );
  const finals = games
    .flatMap((game) => {
      const match = matchByGame.get(game.externalGameId);
      return match !== undefined && game.state === ProviderGameState.FINAL ? [{ game, match }] : [];
    })
    .sort((left, right) => left.match.roundNumber - right.match.roundNumber || left.match.matchNumber - right.match.matchNumber);
  /** Each match as the latest result in this batch wrote it. */
  const rewritten = new Map<string, SportEventMatch>();

  const rows: SyncWriteDetailRow[] = [];
  for (const final of finals) {
    const { game } = final;
    const match = rewritten.get(final.match.id) ?? final.match;
    const result = resultFromGame(game, match, sidesOf, teamsOf);
    if (result === null) {
      deps.logger?.warn(
        { action: 'liveScore.game.teamsDoNotFit', data: { sportEventId, matchNumber: match.matchNumber, externalGameId: game.externalGameId } },
        'Skipped a final game that cannot score the linked match: its teams are not the match\'s, or it has no score',
      );
      continue;
    }
    const before = {
      winnerSide: match.winnerSide,
      homeScore: match.homeScore,
      awayScore: match.awayScore,
      homeShootoutScore: match.homeShootoutScore,
      awayShootoutScore: match.awayShootoutScore,
    };
    const row = { id: match.id, entityType: 'SportEventMatch', providerId: deps.providerId, externalId: game.externalGameId, internalId: match.id, name: `Match ${match.matchNumber}`, before, after: { ...result } };
    if (hasResult(match, result)) {
      rows.push({ ...row, disposition: 'UNCHANGED' });
      continue;
    }
    // An admin's result stands (#1531): the provider's different final is logged, not written.
    if (match.resultSource === MatchResultSource.ADMIN) {
      deps.logger?.warn(
        { action: 'liveScore.game.adminResultKept', data: { sportEventId, matchNumber: match.matchNumber, externalGameId: game.externalGameId, before, provider: result } },
        'Kept an admin\'s match result that the provider\'s final disagrees with',
      );
      rows.push({ ...row, disposition: 'UNCHANGED' });
      continue;
    }
    try {
      // One at a time: the bracket each result writes is the one the next is read against.
      const bracket = await deps.results.recordResult(sportEventId, match.matchNumber, result, MatchResultSource.PROVIDER);
      for (const each of bracket) rewritten.set(each.id, each);
      rows.push({ ...row, disposition: 'UPDATED' });
    } catch (error) {
      if (!(error instanceof SportEventError)) throw error;
      deps.logger?.warn(
        { action: 'liveScore.game.refused', data: { sportEventId, matchNumber: match.matchNumber, externalGameId: game.externalGameId, code: error.code } },
        'The match refused a provider\'s final result',
      );
    }
  }

  const live: MatchLiveScoreWrite[] = [];
  for (const game of games) {
    const linkedMatch = game.state === ProviderGameState.FINAL ? undefined : matchByGame.get(game.externalGameId);
    if (linkedMatch === undefined) continue;
    const match = rewritten.get(linkedMatch.id) ?? linkedMatch;
    const score = liveScoreOf(game, match, sidesOf, teamsOf);
    if (score === null) continue;
    const before = { status: match.status, homeScore: match.homeScore, awayScore: match.awayScore };
    const unchanged = before.status === score.status && before.homeScore === score.homeScore && before.awayScore === score.awayScore;
    if (!unchanged) live.push({ id: match.id, ...score });
    rows.push({
      id: match.id, entityType: 'SportEventMatch', providerId: deps.providerId, externalId: game.externalGameId, internalId: match.id, name: `Match ${match.matchNumber}`,
      before, after: { ...score }, disposition: unchanged ? 'UNCHANGED' : 'UPDATED',
    });
  }
  await deps.matches.applyLiveScores(live);

  const persisted = rows.filter((row) => row.disposition === 'UPDATED').length;
  return {
    updatesReturned: games.length,
    updatesPersisted: persisted,
    updatesSkipped: games.length - persisted,
    writeDiagnostics: summarizeSyncWriteRows(rows),
  };
}

/** A match with no game linked yet and both sides known. */
type OpenMatch = SportEventMatch & { externalGameId: null; homeSportEventParticipantId: string; awaySportEventParticipantId: string };

function isOpenMatch(match: SportEventMatch): match is OpenMatch {
  return match.externalGameId === null && match.homeSportEventParticipantId !== null && match.awaySportEventParticipantId !== null;
}

/**
 * Each unlinked game with the one open match its two teams play, where neither has another
 * candidate. Two games fitting one match, or one game fitting two, link nothing.
 */
function gamesToLink(
  games: readonly GameScoreUpdate[],
  matches: readonly OpenMatch[],
  sidesOf: ReadonlyMap<string, string>,
  teamsOf: ReadonlyMap<string, string>,
): Array<{ game: GameScoreUpdate; match: OpenMatch }> {
  const teamsKey = (first: string | undefined, second: string | undefined) =>
    first === undefined || second === undefined ? null : [first, second].sort().join('|');
  const matchesByTeams = new Map<string, OpenMatch[]>();
  for (const match of matches) {
    const key = teamsKey(sidesOf.get(match.homeSportEventParticipantId), sidesOf.get(match.awaySportEventParticipantId));
    if (key !== null) matchesByTeams.set(key, [...(matchesByTeams.get(key) ?? []), match]);
  }
  const fits = games.flatMap((game) => {
    const key = teamsKey(teamsOf.get(game.homeTeamExternalId), teamsOf.get(game.awayTeamExternalId));
    const candidates = key === null ? [] : matchesByTeams.get(key) ?? [];
    return candidates.length === 1 ? [{ game, match: candidates[0] }] : [];
  });
  const gamesPerMatch = new Map<string, number>();
  for (const { match } of fits) gamesPerMatch.set(match.id, (gamesPerMatch.get(match.id) ?? 0) + 1);
  return fits.filter(({ match }) => gamesPerMatch.get(match.id) === 1);
}

/** The participant behind each match side, by event-participant id. */
async function participantsOfSides(deps: GameScoreWriterDeps, matches: readonly SportEventMatch[]): Promise<Map<string, string>> {
  const ids = [...new Set(matches.flatMap((match) => [match.homeSportEventParticipantId, match.awaySportEventParticipantId].filter((id) => id !== null)))];
  if (ids.length === 0) return new Map();
  const rows = await deps.eventParticipants.findByIds(ids);
  return new Map(rows.map((row) => [row.id, row.participantId]));
}

/** The participant each provider team is mapped to, by the provider's team id. */
async function participantsOfTeams(deps: GameScoreWriterDeps, games: readonly GameScoreUpdate[]): Promise<Map<string, string>> {
  const ids = [...new Set(games.flatMap((game) => [game.homeTeamExternalId, game.awayTeamExternalId]))];
  if (ids.length === 0) return new Map();
  const mappings = await deps.mappings.findByProviderExternalIds(deps.providerId, ids);
  return new Map(mappings.map((mapping) => [mapping.externalId, mapping.participantId]));
}

/**
 * The game's result from the match's side, or null when its teams are not the match's two (a side
 * still to be decided, an unmapped team, or a link to the wrong game). Level scores with a
 * shoot-out go to the shoot-out's winner; level scores without one are a tie, which only a game
 * that forms no bracket accepts.
 */
function resultFromGame(
  game: GameScoreUpdate,
  match: SportEventMatch,
  sidesOf: ReadonlyMap<string, string>,
  teamsOf: ReadonlyMap<string, string>,
): MatchResultFromGame | null {
  if (game.homeScore === null || game.awayScore === null) return null;
  const matchHome = match.homeSportEventParticipantId === null ? undefined : sidesOf.get(match.homeSportEventParticipantId);
  const matchAway = match.awaySportEventParticipantId === null ? undefined : sidesOf.get(match.awaySportEventParticipantId);
  const gameHome = teamsOf.get(game.homeTeamExternalId);
  const gameAway = teamsOf.get(game.awayTeamExternalId);
  if (matchHome === undefined || matchAway === undefined || gameHome === undefined || gameAway === undefined) return null;

  const gameShootout = game.homeShootoutScore === undefined || game.homeShootoutScore === null
    || game.awayShootoutScore === undefined || game.awayShootoutScore === null
    ? null
    : [game.homeShootoutScore, game.awayShootoutScore] as const;
  let homeScore: number;
  let awayScore: number;
  let shootout: readonly [number, number] | null;
  if (gameHome === matchHome && gameAway === matchAway) {
    [homeScore, awayScore] = [game.homeScore, game.awayScore];
    shootout = gameShootout;
  } else if (gameHome === matchAway && gameAway === matchHome) {
    [homeScore, awayScore] = [game.awayScore, game.homeScore];
    shootout = gameShootout && [gameShootout[1], gameShootout[0]];
  } else {
    return null;
  }
  // A shoot-out decides only a level game; a provider's shoot-out beside a decided score is ignored.
  if (homeScore === awayScore && shootout) {
    const [homeShootoutScore, awayShootoutScore] = shootout;
    return { winnerSide: sideAhead(homeShootoutScore, awayShootoutScore), homeScore, awayScore, homeShootoutScore, awayShootoutScore };
  }
  return { winnerSide: sideAhead(homeScore, awayScore), homeScore, awayScore };
}

/** The side with more, or null when level. */
function sideAhead(home: number, away: number): MatchSide | null {
  return home > away ? MatchSide.HOME : away > home ? MatchSide.AWAY : null;
}

const SCORED_STATES: ReadonlySet<ProviderGameState> = new Set([ProviderGameState.FINAL, ProviderGameState.IN_PROGRESS]);

/**
 * The live score a game puts on a match that has no result: its score from the match's sides
 * while it is played, or none once the provider says it has not started. Null when there is
 * nothing to write: the match has a result or was cancelled, a live game has no score yet or
 * teams that are not the match's, or a game not under way meets a match with no live score.
 */
function liveScoreOf(
  game: GameScoreUpdate,
  match: SportEventMatch,
  sidesOf: ReadonlyMap<string, string>,
  teamsOf: ReadonlyMap<string, string>,
): Omit<MatchLiveScoreWrite, 'id'> | null {
  if (match.status !== MatchStatus.SCHEDULED && match.status !== MatchStatus.IN_PROGRESS) return null;
  if (game.state !== ProviderGameState.IN_PROGRESS) {
    return match.status === MatchStatus.IN_PROGRESS ? { status: MatchStatus.SCHEDULED, homeScore: null, awayScore: null } : null;
  }
  const score = resultFromGame(game, match, sidesOf, teamsOf);
  return score === null ? null : { status: MatchStatus.IN_PROGRESS, homeScore: score.homeScore, awayScore: score.awayScore };
}

/** Whether the match already holds this result, so a repeated sync writes nothing. */
function hasResult(match: SportEventMatch, result: MatchResultFromGame): boolean {
  return match.status === MatchStatus.COMPLETED
    && match.winnerSide === result.winnerSide
    && match.homeScore === result.homeScore
    && match.awayScore === result.awayScore
    && match.homeShootoutScore === (result.homeShootoutScore ?? null)
    && match.awayShootoutScore === (result.awayShootoutScore ?? null);
}
