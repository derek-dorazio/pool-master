import {
  eventSportDefinition,
  type SportComposite,
  type SportStat,
  type StatLine,
} from '@poolmaster/shared/domain';
import type { ParticipantRoundView, SportEventParticipantView } from '../../events/sport-event-participant-service';
import type { FieldScoringEvent } from '../scoring-family-module';

/** One game's composite, by the event's round number. */
interface CompositeGameScore {
  roundNumber: number;
  score: number;
}

/**
 * The composite the event's sport league plays. An event scored by this family is always in a
 * stat pool league of a sport with a composite (`sportLeagueDefinitionOf` refuses any other), so
 * a missing one is a broken invariant.
 */
export function compositeOf(event: FieldScoringEvent): SportComposite {
  const { composite } = eventSportDefinition(event);
  if (composite === null) {
    throw new Error(`A ${event.sport} event has no composite to score`);
  }
  return composite;
}

/** A round's stat lines as one line, by stat. */
function toStatLine(round: Pick<ParticipantRoundView, 'statLines'>): StatLine {
  const line: Partial<Record<SportStat, number>> = {};
  for (const statLine of round.statLines) {
    line[statLine.stat] = statLine.value;
  }
  return line;
}

/**
 * A player's games: each played game's composite in round order, their sum, and when the latest
 * line was written. A round with no lines is a game the player did not play, and is left out.
 */
export function scorePlayerGames(
  row: Pick<SportEventParticipantView, 'rounds'>,
  composite: SportComposite,
): { score: number; gameScores: CompositeGameScore[]; asOf: Date | null } {
  const played = row.rounds
    .filter((round) => round.statLines.length > 0)
    .sort((left, right) => left.round.roundNumber - right.round.roundNumber);
  const gameScores = played.map((round) => ({ roundNumber: round.round.roundNumber, score: composite.score(toStatLine(round)) }));
  const written = played.flatMap((round) => round.statLines.map((line) => line.updatedAt.getTime()));
  return {
    score: gameScores.reduce((total, game) => total + game.score, 0),
    gameScores,
    asOf: written.length === 0 ? null : new Date(Math.max(...written)),
  };
}
