/**
 * Writes a provider's game scores into an event's matches (#1496). A match takes its result from
 * the provider game an admin linked it to (`externalGameId`), and only once the provider calls
 * the game final. Every result goes through `MatchResultService.recordResult`, the admin's own
 * path, so its checks hold for a provider's result too: both teams known, scores that fit the
 * winner, no tie in a bracket, and a locked result once the next match has one.
 *
 * The provider lists its own home and away teams. Each is matched to a side of the match through
 * the team's provider mapping, so a game the provider lists the other way round from the match
 * still scores the right side, and a game whose teams are not the match's is refused.
 */
import { MatchSide, MatchStatus, ProviderGameState, type SportEventMatch } from '@poolmaster/shared/domain';
import type { GameScoreUpdate } from '@poolmaster/shared/dto';
import type { FastifyBaseLogger } from 'fastify';
import type { ParticipantProviderMappingRepository, SportEventMatchRepository, SportEventParticipantRepository } from '@poolmaster/shared/db';
import { SportEventError } from '../../events/errors';
import type { LiveScorePersistenceResult } from '../../ingestion/core/score-publisher';
import { summarizeSyncWriteRows, type SyncWriteDetailRow } from '../../ingestion/core/sync-write-diagnostics';
import type { MatchResultService } from './match-result-service';

export interface GameScoreWriterDeps {
  providerId: string;
  matches: Pick<SportEventMatchRepository, 'findBySportEvent'>;
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
}

/** Writes each final game linked to one of the event's matches; any other game writes nothing. */
export async function writeGameScores(
  deps: GameScoreWriterDeps,
  sportEventId: string,
  games: readonly GameScoreUpdate[],
): Promise<LiveScorePersistenceResult> {
  const matches = await deps.matches.findBySportEvent(sportEventId);
  const matchByGame = new Map(
    matches.flatMap((match) => (match.externalGameId === null ? [] : [[match.externalGameId, match] as const])),
  );
  const finals = games.flatMap((game) => {
    const match = matchByGame.get(game.externalGameId);
    return match !== undefined && game.state === ProviderGameState.FINAL ? [{ game, match }] : [];
  });
  const sidesOf = await participantsOfSides(deps, finals.map(({ match }) => match));
  const teamsOf = await participantsOfTeams(deps, finals.map(({ game }) => game));

  const rows: SyncWriteDetailRow[] = [];
  for (const { game, match } of finals) {
    const result = resultFromGame(game, match, sidesOf, teamsOf);
    if (result === null) {
      deps.logger?.warn(
        { action: 'liveScore.game.teamsDoNotFit', data: { sportEventId, matchNumber: match.matchNumber, externalGameId: game.externalGameId } },
        'Skipped a final game that cannot score the linked match: its teams are not the match\'s, or it has no score',
      );
      continue;
    }
    const before = { winnerSide: match.winnerSide, homeScore: match.homeScore, awayScore: match.awayScore };
    const row = { id: match.id, entityType: 'SportEventMatch', providerId: deps.providerId, externalId: game.externalGameId, internalId: match.id, name: `Match ${match.matchNumber}`, before, after: { ...result } };
    if (hasResult(match, result)) {
      rows.push({ ...row, disposition: 'UNCHANGED' });
      continue;
    }
    try {
      // One at a time, each reading the bracket the last wrote: a result can fill a later match's side.
      await deps.results.recordResult(sportEventId, match.matchNumber, result);
      rows.push({ ...row, disposition: 'UPDATED' });
    } catch (error) {
      if (!(error instanceof SportEventError)) throw error;
      deps.logger?.warn(
        { action: 'liveScore.game.refused', data: { sportEventId, matchNumber: match.matchNumber, externalGameId: game.externalGameId, code: error.code } },
        'The match refused a provider\'s final result',
      );
    }
  }

  const persisted = rows.filter((row) => row.disposition === 'UPDATED').length;
  return {
    updatesReturned: games.length,
    updatesPersisted: persisted,
    updatesSkipped: games.length - persisted,
    writeDiagnostics: summarizeSyncWriteRows(rows),
  };
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
 * still to be decided, an unmapped team, or a link to the wrong game). Level scores are a tie,
 * which only a game that forms no bracket accepts.
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

  let homeScore: number;
  let awayScore: number;
  if (gameHome === matchHome && gameAway === matchAway) {
    [homeScore, awayScore] = [game.homeScore, game.awayScore];
  } else if (gameHome === matchAway && gameAway === matchHome) {
    [homeScore, awayScore] = [game.awayScore, game.homeScore];
  } else {
    return null;
  }
  const winnerSide = homeScore > awayScore ? MatchSide.HOME : awayScore > homeScore ? MatchSide.AWAY : null;
  return { winnerSide, homeScore, awayScore };
}

/** Whether the match already holds this result, so a repeated sync writes nothing. */
function hasResult(match: SportEventMatch, result: MatchResultFromGame): boolean {
  return match.status === MatchStatus.COMPLETED
    && match.winnerSide === result.winnerSide
    && match.homeScore === result.homeScore
    && match.awayScore === result.awayScore;
}
