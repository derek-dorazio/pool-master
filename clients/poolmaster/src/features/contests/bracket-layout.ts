/**
 * How a bracket contest's games are laid out on screen (#721): by round, first round first (a
 * second-chance bracket's first round is a later one, still named for where it falls), and
 * within a round by region in the order the bracket lists them. The later rounds, where the
 * regions meet (a Final Four, a Super Bowl), carry no region, so they read as one group after the
 * regional rounds. Everything here is derived from the game-pick read; nothing is stored.
 */
import { PickOutcome } from '@poolmaster/shared/domain';
import { GAME_PICKS_TIEBREAKER_MAX } from '@poolmaster/shared/dto';
import { enumLabel } from '@poolmaster/shared/display-strings';
import type { StatusBadgeProps } from '@/features/shared/ui';
import type { PickEmGame } from './pick-em-week';

export type BracketGame = PickEmGame;
export type BracketTeam = NonNullable<BracketGame['predictedHome']>;

export interface BracketRegionGroup {
  /** The region's name ("East"), or null for the games where the regions meet. */
  regionLabel: string | null;
  games: BracketGame[];
}

export interface BracketRound {
  roundNumber: number;
  /** The round's name in the sport's or its league's words: "Sweet 16", "Super Bowl". */
  label: string;
  regions: BracketRegionGroup[];
}

/** A round's name from its number and the bracket's round count. */
export type BracketRoundLabel = (roundNumber: number, roundCount: number) => string;

/** The bracket's games by round and region, in the order the bracket lists them. */
export function buildBracketRounds(games: readonly BracketGame[], roundLabel: BracketRoundLabel): BracketRound[] {
  const ordered = [...games].sort((left, right) => left.roundNumber - right.roundNumber || left.matchNumber - right.matchNumber);
  const roundCount = ordered.at(-1)?.roundNumber ?? 0;
  const rounds = new Map<number, BracketRound>();
  for (const game of ordered) {
    let round = rounds.get(game.roundNumber);
    if (!round) {
      round = { roundNumber: game.roundNumber, label: roundLabel(game.roundNumber, roundCount), regions: [] };
      rounds.set(game.roundNumber, round);
    }
    let region = round.regions.find((candidate) => candidate.regionLabel === game.regionLabel);
    if (!region) {
      region = { regionLabel: game.regionLabel, games: [] };
      round.regions.push(region);
    }
    region.games.push(game);
  }
  return [...rounds.values()];
}

/**
 * When the bracket's picks close, for a sentence: the event's start ("the opening tip-off") for a
 * full bracket, or for a second-chance bracket, whose games start at a later round (#721), that
 * round's first game ("the first game of the Sweet 16").
 */
export function describeBracketClose(rounds: readonly BracketRound[], eventStart: string): string {
  const first = rounds.at(0);
  return first && first.roundNumber > 1 ? `the first game of the ${first.label}` : `the ${eventStart}`;
}

/**
 * What a side shows before the entry's earlier picks fill it: whose winner it waits for. The
 * first round's teams are the bracket's own, so only a later round waits.
 */
export function describeOpenSide(round: Pick<BracketRound, 'roundNumber'>, rounds: readonly BracketRound[]): string {
  const previous = rounds.find((candidate) => candidate.roundNumber === round.roundNumber - 1);
  return previous ? `${previous.label} winner` : 'To be decided';
}

const OUTCOME_TONES: Record<PickOutcome, NonNullable<StatusBadgeProps['tone']>> = {
  CORRECT: 'success',
  BUSTED: 'danger',
  PUSH: 'neutral',
  PENDING: 'neutral',
};

/** How a pick stands against the results, as its mark reads: "Correct · 4 pts", "Busted", "Pending". */
export function describePickOutcome(pick: NonNullable<BracketGame['pick']>): { label: string; tone: NonNullable<StatusBadgeProps['tone']> } | null {
  if (pick.outcome === null) {
    return null;
  }
  const label = pick.outcome === PickOutcome.CORRECT && pick.points !== null
    ? `${enumLabel('PickOutcome', pick.outcome)} · ${formatPoints(pick.points)}`
    : enumLabel('PickOutcome', pick.outcome);
  return { label, tone: OUTCOME_TONES[pick.outcome] };
}

/** "1 pt", "12 pts". */
export function formatPoints(points: number): string {
  return `${points} ${points === 1 ? 'pt' : 'pts'}`;
}

/** A locked bracket's tiebreaker, under its middle: "Tiebreaker: 148 total points in the final." */
export function describeBracketTiebreaker(value: number | null, scoreUnit: string): string {
  return value === null ? 'No tiebreaker was saved.' : `Tiebreaker: ${value} total ${scoreUnit} in the final.`;
}

/** "41 of 63 picked". */
export function formatPickProgress(pickedCount: number, gameCount: number): string {
  return `${pickedCount} of ${gameCount} picked`;
}

/** A tiebreaker as typed: a whole number of total points from 0 to the most the server takes, or null. */
export function parseBracketTiebreaker(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const value = Number(trimmed);
  return value <= GAME_PICKS_TIEBREAKER_MAX ? value : null;
}
