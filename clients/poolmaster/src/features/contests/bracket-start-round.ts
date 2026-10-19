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
 * The rounds a bracket on an event can start at (#721). An event that hasn't started offers only
 * the full bracket: its later rounds have no teams yet, so the server refuses a bracket from one.
 * An event already under way offers each later round up to the one before the final, each a
 * second-chance bracket, since a bracket of the final alone is a single pick; whether that round
 * is still ahead is the server's to say when the contest is created.
 */
export function bracketStartRoundOptions(
  roundCount: number,
  roundName: RoundName,
  { isUnderWay }: { isUnderWay: boolean },
): BracketStartRoundOption[] {
  const option = (roundNumber: number): BracketStartRoundOption => ({
    roundNumber,
    name: roundName(roundNumber),
    label: formatBracketStartLabel(roundNumber, roundName),
  });
  if (!isUnderWay) {
    return [option(1)];
  }
  const lastStart = Math.min(roundCount - 1, KNOCKOUT_ROUND_VALUES_MAX_ROUNDS);
  const options: BracketStartRoundOption[] = [];
  for (let roundNumber = 2; roundNumber <= lastStart; roundNumber += 1) {
    options.push(option(roundNumber));
  }
  return options;
}

/** A second-chance bracket's starting round by name, or null for a full bracket. */
export function secondChanceRoundName(startsAtRound: number, roundName: RoundName) {
  return isSecondChanceBracket(startsAtRound) ? roundName(startsAtRound) : null;
}
