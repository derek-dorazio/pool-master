/**
 * Knockout round points (#699, plans/knockout-and-pickem-design.md §3.2): a team's contest score is
 * the sum, over the matches it won, of that round's value plus the upset bonus. The family's rules,
 * all here:
 *
 * - A win in round N scores `roundValues[N - 1]`. Contest setup holds the table to one value per
 *   round of the event (design Q3.3), so a round with no value leaves the team unscored rather than
 *   scoring it 0.
 * - With the SEED_DIFFERENCE bonus on, a win by the worse seed (the higher number) adds the seed
 *   difference times the multiplier. No bonus for equal seeds or when the better seed wins.
 * - An unseeded team counts as the field's worst seed: the highest seed number on the field, which
 *   is locked from release (design Q3.1).
 * - A team placed straight into a later round (a bye) has no match in the round it skipped, so it
 *   scores nothing for it (design Q3.4).
 * - Until the bracket has a result, no team is scored: nobody has won or lost yet.
 */
import {
  MatchSide,
  MatchStatus,
  UpsetBonusRule,
  assertNever,
  type KnockoutRoundPointsSettings,
  type SportEventMatch,
  type UpsetBonus,
} from '@poolmaster/shared/domain';
import type { SportEventParticipantView } from '../../events/sport-event-participant-service';

/** How a team's knockout score came about: what a leaderboard pick shows beside its points. */
export interface KnockoutTeamRecord {
  /** Matches won. */
  wins: number;
  /** The part of the score that is upset bonus; 0 with the bonus off. */
  upsetBonusPoints: number;
  /** False once the team has lost a match. */
  isAlive: boolean;
}

export interface KnockoutTeamScore {
  score: number | null;
  record: KnockoutTeamRecord;
}

/** The field row on the winning or losing side of a completed match. */
function sideRowId(match: SportEventMatch, side: MatchSide): string | null {
  return side === MatchSide.HOME ? match.homeSportEventParticipantId : match.awaySportEventParticipantId;
}

function otherSide(side: MatchSide): MatchSide {
  return side === MatchSide.HOME ? MatchSide.AWAY : MatchSide.HOME;
}

/** What one win is worth as upset bonus under the contest's rule. */
export function upsetBonusFor(bonus: UpsetBonus, winnerSeed: number | null, loserSeed: number | null): number {
  switch (bonus.rule) {
    case UpsetBonusRule.NONE:
      return 0;
    case UpsetBonusRule.SEED_DIFFERENCE:
      if (winnerSeed === null || loserSeed === null || winnerSeed <= loserSeed) {
        return 0;
      }
      return (winnerSeed - loserSeed) * bonus.multiplier;
    default:
      return assertNever(bonus);
  }
}

/** Every field row's knockout score and record under one contest's settings, in field order. */
export function scoreKnockoutField(
  field: readonly SportEventParticipantView[],
  settings: KnockoutRoundPointsSettings,
): KnockoutTeamScore[] {
  const decided = new Map<string, SportEventMatch & { winnerSide: MatchSide }>();
  for (const row of field) {
    for (const match of row.matches) {
      if (match.status === MatchStatus.COMPLETED && match.winnerSide !== null) {
        decided.set(match.id, { ...match, winnerSide: match.winnerSide });
      }
    }
  }
  const seeds = field.flatMap((row) => (row.entry.seedNumber === undefined ? [] : [row.entry.seedNumber]));
  const worstSeed = seeds.length > 0 ? Math.max(...seeds) : null;
  const seedById = new Map(field.map((row) => [row.entry.id, row.entry.seedNumber ?? worstSeed]));

  return field.map((row) => {
    const results = row.matches.flatMap((match) => {
      const result = decided.get(match.id);
      return result ? [result] : [];
    });
    const won = results.filter((match) => sideRowId(match, match.winnerSide) === row.entry.id);
    const upsetBonusPoints = won.reduce((total, match) => total + upsetBonusFor(
      settings.upsetBonus,
      seedById.get(row.entry.id) ?? null,
      seedById.get(sideRowId(match, otherSide(match.winnerSide)) ?? '') ?? null,
    ), 0);
    const roundPoints = won.map((match) => settings.roundValues.at(match.roundNumber - 1));
    const record: KnockoutTeamRecord = {
      wins: won.length,
      upsetBonusPoints,
      isAlive: results.length === won.length,
    };
    const scoredRounds = roundPoints.filter((points): points is number => points !== undefined);
    if (decided.size === 0 || scoredRounds.length < roundPoints.length) {
      return { score: null, record };
    }
    return { score: scoredRounds.reduce((total, points) => total + points, 0) + upsetBonusPoints, record };
  });
}
