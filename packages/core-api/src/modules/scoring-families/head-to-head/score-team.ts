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
 * - A team withdrawn after the draw (#704) and replaced in its place has no match: it scores
 *   nothing and is out, a first-round loss.
 * - Until the bracket has a result, no team is scored: nobody has won or lost yet.
 */
import {
  MatchSide,
  MatchStatus,
  ParticipantInactiveReason,
  UpsetBonusRule,
  assertNever,
  type KnockoutRoundPointsSettings,
  type SportEventMatch,
  type UpsetBonus,
} from '@poolmaster/shared/domain';
import type { SportEventParticipantView } from '../../events/sport-event-participant-service';

/**
 * The field rows withdrawn after the draw and replaced (#704): inactive as WITHDRAWN, and named
 * by no match of `bracket`. A row inactivated while still in its place is not one of them.
 */
export function withdrawnRowIds(
  field: ReadonlyArray<{ id: string; isActive: boolean; inactiveReason?: ParticipantInactiveReason | null }>,
  bracket: ReadonlyArray<Pick<SportEventMatch, 'homeSportEventParticipantId' | 'awaySportEventParticipantId'>>,
): Set<string> {
  const named = new Set(bracket.flatMap((match) => [match.homeSportEventParticipantId, match.awaySportEventParticipantId]));
  return new Set(field
    .filter((row) => !row.isActive && row.inactiveReason === ParticipantInactiveReason.WITHDRAWN && !named.has(row.id))
    .map((row) => row.id));
}

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

/**
 * Each field row's seed as the upset bonus reads it, by field row id: an unseeded team counts as
 * the field's worst seed, and with no seeds at all every team is null.
 */
export function knockoutSeeds(field: ReadonlyArray<{ id: string; seedNumber?: number }>): Map<string, number | null> {
  const seeds = field.flatMap((row) => (row.seedNumber === undefined ? [] : [row.seedNumber]));
  const worstSeed = seeds.length > 0 ? Math.max(...seeds) : null;
  return new Map(field.map((row) => [row.id, row.seedNumber ?? worstSeed]));
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
  const seedById = knockoutSeeds(field.map((row) => row.entry));
  const withdrawn = withdrawnRowIds(field.map((row) => row.entry), field.flatMap((row) => row.matches));

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
      isAlive: !withdrawn.has(row.entry.id) && results.length === won.length,
    };
    const scoredRounds = roundPoints.filter((points): points is number => points !== undefined);
    if (decided.size === 0 || scoredRounds.length < roundPoints.length) {
      return { score: null, record };
    }
    return { score: scoredRounds.reduce((total, points) => total + points, 0) + upsetBonusPoints, record };
  });
}
