/**
 * Writes a provider's box scores into a Clutch Card event's stat lines (#1497), through
 * `StatLineService`, the loader's and the admin's own path, so its checks hold for a provider's
 * lines too. The adapter numbers each game within the event (game N is round N, each series' Game
 * N sharing it) and maps the provider's stat fields to the stats the composite counts.
 *
 * A player is the provider's player id, matched to a star through the star's provider mapping,
 * made when the stars are loaded from the provider. A provider's box score lists every player who
 * played; the event's field holds only its stars, so a player with no mapping, or one mapped to
 * someone not in the field, is left out and counted, never created or guessed at.
 *
 * A final game's lines are stored COMPLETED; a live game's are stored IN_PROGRESS and rewritten
 * each sync, so standings move while it is played. A game not under way writes nothing: a player
 * keeps whatever line they have. A completed line is never reopened (the repository keeps it
 * COMPLETED if the provider flaps a final game back to live). A star the provider drops from a
 * later box score of a game keeps the line they had in it: only the players named are written, so
 * a vendor that fixes a line it gave the wrong player leaves that line for an admin to clear. The sync is authoritative: a later sync rewrites a line an admin
 * corrected, as admin entry is the stop gap for leagues with no feed (plan Q1, #1531).
 */
import { ParticipantRoundStatus, ProviderGameState } from '@poolmaster/shared/domain';
import type { StatLineGameUpdate } from '@poolmaster/shared/dto';
import type { FastifyBaseLogger } from 'fastify';
import type { GameStatLineStatus, ParticipantProviderMappingRepository, SportEventParticipantRepository } from '@poolmaster/shared/db';
import type { LiveScorePersistenceResult } from '../../ingestion/core/score-publisher';
import { emptySyncWriteDiagnostics, summarizeSyncWriteRows } from '../../ingestion/core/sync-write-diagnostics';
import type { LiveScoreTargetEvent } from '../scoring-family-module';
import { StatLineError, type GameStatLinesInput, type StatLineService } from './stat-line-service';

export interface StatLineWriterDeps {
  providerId: string;
  field: Pick<SportEventParticipantRepository, 'findBySportEvent'>;
  mappings: Pick<ParticipantProviderMappingRepository, 'findByProviderExternalIds'>;
  statLines: Pick<StatLineService, 'applyGames'>;
  logger?: FastifyBaseLogger;
}

/** The status a provider game's lines are stored at, or null for a game not under way. */
const LINE_STATUS: Readonly<Record<ProviderGameState, GameStatLineStatus | null>> = {
  [ProviderGameState.FINAL]: ParticipantRoundStatus.COMPLETED,
  [ProviderGameState.IN_PROGRESS]: ParticipantRoundStatus.IN_PROGRESS,
  [ProviderGameState.SCHEDULED]: null,
  [ProviderGameState.POSTPONED]: null,
  [ProviderGameState.CANCELLED]: null,
};

/**
 * Stores each live or final game's lines for the field's stars, in one write for the batch. A game
 * the event does not schedule is left out and logged; a batch `StatLineService` refuses is logged
 * and writes nothing, and the next sync tries again.
 */
export async function writeStatLineGames(
  deps: StatLineWriterDeps,
  event: LiveScoreTargetEvent,
  games: readonly StatLineGameUpdate[],
): Promise<LiveScorePersistenceResult> {
  const sportEventId = event.id;
  const scheduled = games.filter((game) => {
    if (event.rounds === null || game.gameNumber <= event.rounds) return true;
    deps.logger?.warn(
      { action: 'liveScore.statLines.gameBeyondSchedule', data: { sportEventId, externalGameId: game.externalGameId, gameNumber: game.gameNumber, rounds: event.rounds } },
      'Skipped a provider game numbered past the games the event schedules',
    );
    return false;
  });
  const underWay = scheduled.flatMap((game) => {
    const status = LINE_STATUS[game.state];
    return status === null ? [] : [{ game, status }];
  });
  const nothingWritten = (): LiveScorePersistenceResult => ({
    updatesReturned: games.length, updatesPersisted: 0, updatesSkipped: games.length, writeDiagnostics: emptySyncWriteDiagnostics(),
  });
  if (underWay.length === 0) return nothingWritten();

  // One read of the field and one of the players' mappings for the whole batch.
  const playerIds = [...new Set(underWay.flatMap(({ game }) => game.lines.map((line) => line.participantExternalId)))];
  const [field, mappings] = await Promise.all([
    deps.field.findBySportEvent(sportEventId),
    deps.mappings.findByProviderExternalIds(deps.providerId, playerIds),
  ]);
  const inField = new Set(field.map((entry) => entry.participantId));
  const starOf = new Map(mappings.flatMap((mapping) => (inField.has(mapping.participantId) ? [[mapping.externalId, mapping.participantId] as const] : [])));
  const playerIdOf = new Map([...starOf].map(([externalId, participantId]) => [participantId, externalId]));

  const inputs: GameStatLinesInput[] = underWay.map(({ game, status }) => ({
    roundNumber: game.gameNumber,
    status,
    rows: game.lines.flatMap((line) => {
      const participantId = starOf.get(line.participantExternalId);
      return participantId === undefined ? [] : [{ participantId, stats: line.stats }];
    }),
  }));
  const notStars = underWay.flatMap(({ game }) => game.lines.filter((line) => !starOf.has(line.participantExternalId)).map((line) => line.participantExternalId));
  if (notStars.length > 0) {
    deps.logger?.info(
      { action: 'liveScore.statLines.playersNotInField', data: { sportEventId, players: notStars.length } },
      'Left out box score lines of players who are not the event\'s stars, or not mapped to one',
    );
  }
  const withRows = inputs.filter((input) => input.rows.length > 0);
  if (withRows.length === 0) return nothingWritten();

  let outcomes;
  try {
    outcomes = await deps.statLines.applyGames(sportEventId, withRows);
  } catch (error) {
    if (!(error instanceof StatLineError)) throw error;
    deps.logger?.warn(
      { action: 'liveScore.statLines.refused', data: { sportEventId, code: error.code, message: error.message } },
      'The event refused a provider\'s box scores',
    );
    return nothingWritten();
  }

  const externalGameIdsOf = new Map<number, string>();
  for (const { game } of underWay) {
    const known = externalGameIdsOf.get(game.gameNumber);
    externalGameIdsOf.set(game.gameNumber, known === undefined ? game.externalGameId : `${known},${game.externalGameId}`);
  }
  const rows = outcomes.map((outcome) => ({
    id: `${outcome.sportEventParticipantId}:${outcome.sportEventRoundId}`,
    entityType: 'SportEventParticipantRound',
    providerId: deps.providerId,
    externalId: externalGameIdsOf.get(outcome.roundNumber),
    participantExternalId: playerIdOf.get(outcome.participantId),
    internalId: outcome.sportEventParticipantId,
    name: `Game ${outcome.roundNumber}`,
    disposition: outcome.disposition,
  }));
  const writtenGames = new Set(outcomes.filter((outcome) => outcome.disposition !== 'UNCHANGED').map((outcome) => outcome.roundNumber));
  const persisted = underWay.filter(({ game }) => writtenGames.has(game.gameNumber)).length;
  return {
    updatesReturned: games.length,
    updatesPersisted: persisted,
    updatesSkipped: games.length - persisted,
    writeDiagnostics: summarizeSyncWriteRows(rows),
  };
}
