/**
 * StatLineService — one game's stat lines for an event of the composite family (#935): the
 * results-entry counterpart of the golf score corrections and the race result. The sport data
 * loader writes a game's box score through it, an admin corrects one player's line on the
 * event's results page, and a provider's box scores arrive through it, several games at once,
 * live ones included (#1497). Every value is stored exactly as sent and none is derived; the composite
 * is computed from the lines whenever a contest is scored, so a correction rescores every contest
 * on the event at its next read.
 *
 * Each row is a player's whole line for the game and replaces what is stored for them in it;
 * players not named keep theirs. A batch's rows go in all or none.
 */
import type { FastifyBaseLogger } from 'fastify';
import type {
  GameStatLineStatus,
  GameStatLineWriteOutcome,
  SportEventParticipantRepository,
  SportEventParticipantStatLineRepository,
  SportEventRepository,
  SportEventRoundRepository,
} from '@poolmaster/shared/db';
import { eventSportDefinition, ParticipantRoundStatus, ScoringFamily, sportStatValueMin, type SportStat } from '@poolmaster/shared/domain';
import type { ApiErrorCode } from '@poolmaster/shared/dto';
import { NO_JOBS_FOR_WRITE } from '../../background-jobs/background-job-queue';
import type { LeaderboardRebuilds } from '../../contests/leaderboard-snapshots';

export class StatLineError extends Error {
  constructor(
    message: string,
    readonly code: ApiErrorCode,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'StatLineError';
  }
}

/** One player's line for the game, as sent. */
export interface GameStatLineRowInput {
  participantId: string;
  stats: ReadonlyArray<{ stat: SportStat; value: number }>;
}

/**
 * One game's lines, as a provider sends them: the event's game (its round number) and where the
 * game stands. Two inputs may name one game: in a round of two series (a conference finals) each
 * series' Game N is the event's game N, and each arrives as its own provider game.
 */
export interface GameStatLinesInput {
  roundNumber: number;
  status: GameStatLineStatus;
  rows: readonly GameStatLineRowInput[];
}

/** What a batch did to each player's stored line, by their field row and the event's game. */
export interface StatLineOutcome extends GameStatLineWriteOutcome {
  roundNumber: number;
  participantId: string;
}

export interface StatLineServiceDeps {
  events: Pick<SportEventRepository, 'findById'>;
  rounds: Pick<SportEventRoundRepository, 'findBySportEvent'>;
  field: Pick<SportEventParticipantRepository, 'findBySportEvent'>;
  statLines: Pick<SportEventParticipantStatLineRepository, 'replaceGameLines'>;
  /** The event's leaderboard rebuild, written with the game's lines (#1466); none without it. */
  leaderboards?: Pick<LeaderboardRebuilds, 'forEvent'>;
  now?: () => Date;
  logger?: FastifyBaseLogger;
}

export class StatLineService {
  constructor(private readonly deps: StatLineServiceDeps) {}

  /** Stores one completed game's lines, as the loader and an admin send them. See `applyGames`. */
  async applyGameLines(sportEventId: string, roundNumber: number, rows: readonly GameStatLineRowInput[]): Promise<void> {
    await this.applyGames(sportEventId, [{ roundNumber, status: ParticipantRoundStatus.COMPLETED, rows }]);
  }

  /**
   * Stores the games' lines in one write. Refuses an event not scored by the composite family, a
   * game the event does not schedule, and, naming every problem, a row whose player is not in the
   * field or is named twice in one game, or whose stat is not one the sport's composite counts, is
   * given twice, or is below 0 when it is not yards. A completed game's lines are stamped now; a
   * live game's have no completion time yet.
   */
  async applyGames(sportEventId: string, games: readonly GameStatLinesInput[]): Promise<StatLineOutcome[]> {
    const event = await this.deps.events.findById(sportEventId);
    if (!event) {
      throw new StatLineError(`Sport event ${sportEventId} was not found.`, 'SPORT_EVENT_NOT_FOUND', 404);
    }
    const definition = eventSportDefinition(event);
    if (definition.scoringFamily !== ScoringFamily.COMPOSITE || definition.composite === null) {
      throw new StatLineError(`${event.name} is not scored from stat lines (its scoring family is ${definition.scoringFamily}).`, 'EVENT_SCORING_FAMILY_MISMATCH', 422);
    }
    const [rounds, field] = await Promise.all([
      this.deps.rounds.findBySportEvent(sportEventId),
      this.deps.field.findBySportEvent(sportEventId),
    ]);
    const roundIdByNumber = new Map(rounds.map((round) => [round.roundNumber, round.id]));
    const unscheduled = [...new Set(games.map((game) => game.roundNumber).filter((roundNumber) => !roundIdByNumber.has(roundNumber)))];
    if (unscheduled.length > 0) {
      throw new StatLineError(`${event.name} schedules no game ${unscheduled.join(' or ')}.`, 'ROUND_BEYOND_SCHEDULE', 422);
    }

    const counted = new Set<SportStat>(definition.composite.stats);
    const entryIdByParticipantId = new Map(field.map((entry) => [entry.participantId, entry.id]));
    const namedInGame = new Set<string>();
    const problems: string[] = [];
    for (const { roundNumber, rows } of games) {
      for (const row of rows) {
        if (!entryIdByParticipantId.has(row.participantId)) problems.push(`participant ${row.participantId} is not in the field`);
        const key = `${roundNumber}:${row.participantId}`;
        if (namedInGame.has(key)) problems.push(`participant ${row.participantId} is named more than once in game ${roundNumber}`);
        namedInGame.add(key);
        const stats = row.stats.map((line) => line.stat);
        for (const stat of new Set(stats)) {
          if (!counted.has(stat)) problems.push(`participant ${row.participantId}: ${stat} is not a stat the ${definition.composite.name} counts`);
          if (stats.filter((candidate) => candidate === stat).length > 1) problems.push(`participant ${row.participantId}: ${stat} is given more than once`);
        }
        for (const line of row.stats) {
          if (line.value < sportStatValueMin(line.stat)) problems.push(`participant ${row.participantId}: ${line.stat} is ${line.value}; only yards go below 0`);
        }
      }
    }
    const roundNumbers = [...new Set(games.map((game) => game.roundNumber))].sort((left, right) => left - right);
    if (problems.length > 0) {
      throw new StatLineError(`Game ${roundNumbers.join(', ')}'s stat lines cannot be stored: ${problems.join('; ')}.`, 'STAT_LINE_ROWS_INVALID', 422);
    }

    const now = (this.deps.now ?? (() => new Date()))();
    const writes = games.flatMap(({ roundNumber, status, rows }) => rows.map((row) => ({
      participantId: row.participantId,
      roundNumber,
      write: {
        sportEventParticipantId: entryIdByParticipantId.get(row.participantId) as string,
        sportEventRoundId: roundIdByNumber.get(roundNumber) as string,
        stats: row.stats,
        status,
        completedAt: status === ParticipantRoundStatus.COMPLETED ? now : null,
      },
    })));
    const rebuild = this.deps.leaderboards?.forEvent(sportEventId) ?? NO_JOBS_FOR_WRITE;
    const outcomes = await this.deps.statLines.replaceGameLines(writes.map(({ write }) => write), rebuild.jobs);
    rebuild.queued();
    this.deps.logger?.info(
      { action: 'statLines.gamesApplied', data: { sportEventId, roundNumbers, players: writes.length } },
      'Stored games\' stat lines',
    );
    return outcomes.map((outcome, index) => ({ ...outcome, roundNumber: writes[index].roundNumber, participantId: writes[index].participantId }));
  }
}
