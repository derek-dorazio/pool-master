/**
 * StatLineService — one game's stat lines for an event of the composite family (#935): the
 * results-entry counterpart of the golf score corrections and the race result. The sport data
 * loader writes a game's box score through it, and an admin corrects one player's line on the
 * event's results page. Every value is stored exactly as sent and none is derived; the composite
 * is computed from the lines whenever a contest is scored, so a correction rescores every contest
 * on the event at its next read.
 *
 * Each row is a player's whole line for the game and replaces what is stored for them in it;
 * players not named keep theirs. A game's rows go in all or none.
 */
import type { FastifyBaseLogger } from 'fastify';
import type {
  SportEventParticipantRepository,
  SportEventParticipantStatLineRepository,
  SportEventRepository,
  SportEventRoundRepository,
} from '@poolmaster/shared/db';
import { eventSportDefinition, ScoringFamily, sportStatValueMin, type SportStat } from '@poolmaster/shared/domain';
import type { ApiErrorCode } from '@poolmaster/shared/dto';

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

export interface StatLineServiceDeps {
  events: Pick<SportEventRepository, 'findById'>;
  rounds: Pick<SportEventRoundRepository, 'findBySportEvent'>;
  field: Pick<SportEventParticipantRepository, 'findBySportEvent'>;
  statLines: Pick<SportEventParticipantStatLineRepository, 'replaceGameLines'>;
  now?: () => Date;
  logger?: FastifyBaseLogger;
}

export class StatLineService {
  constructor(private readonly deps: StatLineServiceDeps) {}

  /**
   * Stores the game's lines. Refuses an event not scored by the composite family, a game the
   * event does not schedule, and, naming every problem, a row whose player is not in the field or
   * is named twice, or whose stat is not one the sport's composite counts, is given twice, or is
   * below 0 when it is not yards.
   */
  async applyGameLines(sportEventId: string, roundNumber: number, rows: readonly GameStatLineRowInput[]): Promise<void> {
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
    const round = rounds.find((candidate) => candidate.roundNumber === roundNumber);
    if (!round) {
      throw new StatLineError(`${event.name} schedules no game ${roundNumber}.`, 'ROUND_BEYOND_SCHEDULE', 422);
    }

    const counted = new Set<SportStat>(definition.composite.stats);
    const entryIdByParticipantId = new Map(field.map((entry) => [entry.participantId, entry.id]));
    const named = new Set<string>();
    const problems: string[] = [];
    for (const row of rows) {
      if (!entryIdByParticipantId.has(row.participantId)) problems.push(`participant ${row.participantId} is not in the field`);
      if (named.has(row.participantId)) problems.push(`participant ${row.participantId} is named more than once`);
      named.add(row.participantId);
      const stats = row.stats.map((line) => line.stat);
      for (const stat of new Set(stats)) {
        if (!counted.has(stat)) problems.push(`participant ${row.participantId}: ${stat} is not a stat the ${definition.composite.name} counts`);
        if (stats.filter((candidate) => candidate === stat).length > 1) problems.push(`participant ${row.participantId}: ${stat} is given more than once`);
      }
      for (const line of row.stats) {
        if (line.value < sportStatValueMin(line.stat)) problems.push(`participant ${row.participantId}: ${line.stat} is ${line.value}; only yards go below 0`);
      }
    }
    if (problems.length > 0) {
      throw new StatLineError(`Game ${roundNumber}'s stat lines cannot be stored: ${problems.join('; ')}.`, 'STAT_LINE_ROWS_INVALID', 422);
    }

    const completedAt = (this.deps.now ?? (() => new Date()))();
    await this.deps.statLines.replaceGameLines(rows.map((row) => ({
      sportEventParticipantId: entryIdByParticipantId.get(row.participantId) as string,
      sportEventRoundId: round.id,
      stats: row.stats,
      completedAt,
    })));
    this.deps.logger?.info(
      { action: 'statLines.gameApplied', data: { sportEventId, roundNumber, players: rows.length } },
      'Stored a game\'s stat lines',
    );
  }
}
