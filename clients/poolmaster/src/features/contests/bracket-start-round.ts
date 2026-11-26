import {
  SelectionType,
  type RoundName,
  formatBracketStartLabel,
  isSecondChanceBracket,
} from '@poolmaster/shared/domain';
import type { ContestManagementDetailDto } from '@/lib/api';

/** One round a bracket can start at, as the commissioner chooses it. */
export interface BracketStartRoundOption {
  roundNumber: number;
  /** The round's own name: "Sweet 16". */
  name: string;
  /** The choice as it reads: "Full bracket", "From the Sweet 16". */
  label: string;
}

/** The rounds a bracket can start at (the API's `startsAtRounds`), each named as the commissioner chooses it. */
export function bracketStartRoundOptions(roundNumbers: readonly number[], roundName: RoundName): BracketStartRoundOption[] {
  return roundNumbers.map((roundNumber) => ({
    roundNumber,
    name: roundName(roundNumber),
    label: formatBracketStartLabel(roundNumber, roundName),
  }));
}

/** A second-chance bracket's starting round by name, or null for a full bracket. */
export function secondChanceRoundName(startsAtRound: number, roundName: RoundName) {
  return isSecondChanceBracket(startsAtRound) ? roundName(startsAtRound) : null;
}

/**
 * The round a contest's second-chance bracket starts at, by name: null for a full bracket, any
 * other format, or a configuration not read yet. The contest page and the list's Open to league
 * both name it in the readiness checks.
 */
export function contestSecondChanceRoundName(
  configuration: ContestManagementDetailDto['configuration'] | undefined,
  roundName: RoundName,
) {
  return configuration?.selectionType === SelectionType.BRACKET
    ? secondChanceRoundName(configuration.startsAtRound, roundName)
    : null;
}
