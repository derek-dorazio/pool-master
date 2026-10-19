import { KNOCKOUT_ROUND_VALUES_MAX_ROUNDS, getSportDefinition } from '@poolmaster/shared/domain';
import type { SportEventDto } from '@/lib/api';
import { formatBracketStartLabel, isSecondChanceBracket, type RoundName } from './contest-rules';

/** One round a bracket can start at, as the commissioner chooses it. */
export interface BracketStartRoundOption {
  roundNumber: number;
  /** The round's own name: "Sweet 16". */
  name: string;
  /** The choice as it reads: "Full bracket", "From the Sweet 16". */
  label: string;
}

/** How many rounds an event's bracket has: the event's own count, else its sport's default. */
export function bracketRoundCount(event: Pick<SportEventDto, 'rounds' | 'sport'>) {
  return event.rounds ?? getSportDefinition(event.sport).defaultRounds;
}

/**
 * Whether a knockout under way still has a round a second-chance bracket could start at: one
 * after the first and before the final.
 */
export function hasSecondChanceRound(roundCount: number) {
  return roundCount >= 3;
}

/**
 * The rounds a bracket on an event can start at (#721): the full bracket, then each later round
 * up to the one before the final, since a bracket of the final alone is a single pick. An event
 * already under way offers only the later rounds, each a second-chance bracket; whether that
 * round is still ahead is the server's to say when the contest is created.
 */
export function bracketStartRoundOptions(
  roundCount: number,
  roundName: RoundName,
  { isUnderWay }: { isUnderWay: boolean },
): BracketStartRoundOption[] {
  const firstStart = isUnderWay ? 2 : 1;
  // The full bracket is always a choice, even of a one-round event.
  const lastStart = Math.max(Math.min(roundCount - 1, KNOCKOUT_ROUND_VALUES_MAX_ROUNDS), isUnderWay ? 0 : 1);
  const options: BracketStartRoundOption[] = [];
  for (let roundNumber = firstStart; roundNumber <= lastStart; roundNumber += 1) {
    options.push({
      roundNumber,
      name: roundName(roundNumber),
      label: formatBracketStartLabel(roundNumber, roundName),
    });
  }
  return options;
}

/** A second-chance bracket's starting round by name, or null for a full bracket. */
export function secondChanceRoundName(startsAtRound: number, roundName: RoundName) {
  return isSecondChanceBracket(startsAtRound) ? roundName(startsAtRound) : null;
}
