/**
 * How a bracket contest's games are laid out on screen (#721): by round, first round first, and
 * within a round by region in the order the bracket lists them. The later rounds, where the
 * regions meet (a Final Four, a Super Bowl), carry no region, so they read as one group after the
 * regional rounds. Everything here is derived from the game-pick read; nothing is stored.
 */
import { PickOutcome } from '@poolmaster/shared/domain';
import { GAME_PICKS_TIEBREAKER_MAX } from '@poolmaster/shared/dto';
import type { GamePicksResponse } from '@/lib/api';
import type { StatusBadgeProps } from '@/features/shared/ui';

export type BracketGame = GamePicksResponse['games'][number];
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
 * What a side shows before the entry's earlier picks fill it: whose winner it waits for. The
 * first round's teams are the bracket's own, so only a later round waits.
 */
export function describeOpenSide(round: Pick<BracketRound, 'roundNumber'>, rounds: readonly BracketRound[]): string {
  const previous = rounds.find((candidate) => candidate.roundNumber === round.roundNumber - 1);
  return previous ? `${previous.label} winner` : 'To be decided';
}

/** The two teams a game offers the entry: the ones its own earlier picks sent there. */
export function offeredTeams(game: BracketGame): [BracketTeam | null, BracketTeam | null] {
  return [game.predictedHome, game.predictedAway];
}

/** The team the entry picked in a game, among the teams it offers, or null. */
export function pickedTeam(game: BracketGame): BracketTeam | null {
  const pickedId = game.pick?.sportEventParticipantId;
  if (!pickedId) {
    return null;
  }
  return offeredTeams(game).find((team) => team?.sportEventParticipantId === pickedId) ?? null;
}

const OUTCOME_LABELS: Record<PickOutcome, string> = {
  CORRECT: 'Correct',
  BUSTED: 'Busted',
  PENDING: 'Pending',
};

const OUTCOME_TONES: Record<PickOutcome, NonNullable<StatusBadgeProps['tone']>> = {
  CORRECT: 'success',
  BUSTED: 'danger',
  PENDING: 'neutral',
};

/** How a pick stands against the results, as its mark reads: "Correct · 4 pts", "Busted", "Pending". */
export function describePickOutcome(pick: NonNullable<BracketGame['pick']>): { label: string; tone: NonNullable<StatusBadgeProps['tone']> } | null {
  if (pick.outcome === null) {
    return null;
  }
  const label = pick.outcome === PickOutcome.CORRECT && pick.points !== null
    ? `${OUTCOME_LABELS[pick.outcome]} · ${formatPoints(pick.points)}`
    : OUTCOME_LABELS[pick.outcome];
  return { label, tone: OUTCOME_TONES[pick.outcome] };
}

/** "1 pt", "12 pts". */
export function formatPoints(points: number): string {
  return `${points} ${points === 1 ? 'pt' : 'pts'}`;
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
