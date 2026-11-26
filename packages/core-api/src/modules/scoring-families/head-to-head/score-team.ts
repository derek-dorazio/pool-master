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
 * - A bye counts as a win (#2170): a team placed straight into a later round scores the value of
 *   each round it skipped, as if it had won a match there, and the bye counts among its wins. The
 *   credit lands when the skipped round is decided (every one of its games has its result or was
 *   cancelled), the same moment that round's winners are scored. A bye earns no upset bonus,
 *   since nobody was beaten. `byeEntries` is the one reading of who had a bye, shared with
 *   bracket pick'em.
 * - A team withdrawn after the draw (#704) and replaced in its place has no match: it scores
 *   nothing and is out, a first-round loss.
 * - Until the bracket has a result, no team is scored: nobody has won or lost yet.
 */
import {
  matchParticipantIds,
  opposingSideOf,
  winningSide,
  MatchStatus,
  ParticipantInactiveReason,
  UpsetBonusRule,
  assertNever,
  type KnockoutRoundPointsSettings,
  type SportEventRoundMatch,
  type UpsetBonus,
} from '@poolmaster/shared/domain';
import type { SportEventParticipantView } from '../../events/sport-event-participant-service';
import { isMatchRoundDecided } from './finished-rounds';

/**
 * The field rows withdrawn after the draw and replaced (#704): inactive as WITHDRAWN, and named
 * by no match of `bracket`. A row inactivated while still in its place is not one of them.
 */
export function withdrawnRowIds(
  field: ReadonlyArray<{ id: string; isActive: boolean; inactiveReason?: ParticipantInactiveReason | null }>,
  bracket: ReadonlyArray<Pick<SportEventRoundMatch, 'id' | 'sides'>>,
): Set<string> {
  const named = new Set(bracket.flatMap(matchParticipantIds));
  return new Set(field
    .filter((row) => !row.isActive && row.inactiveReason === ParticipantInactiveReason.WITHDRAWN && !named.has(row.id))
    .map((row) => row.id));
}

/** A team placed straight into a later round of a bracket (a bye). */
export interface ByeEntry {
  /** The round of the team's first match. */
  entersAtRound: number;
  /** The bracket's rounds before it, which the team skipped, lowest first. */
  skippedRounds: number[];
}

/**
 * Every team on a bye, by field row id: a team whose first match in `bracket` comes after the
 * bracket's first round. The one reading of a bye, for team scoring here and for bracket pick'em,
 * where a bye team holds its side of its first game. It relies on `bracket` holding every game a
 * team was drawn into, cancelled ones included where the caller keeps them: a team whose first game
 * were missing from it would read as a bye.
 */
export function byeEntries(
  bracket: ReadonlyArray<Pick<SportEventRoundMatch, 'id' | 'roundNumber' | 'sides'>>,
): Map<string, ByeEntry> {
  const rounds = [...new Set(bracket.map((match) => match.roundNumber))].sort((left, right) => left - right);
  const firstMatchRound = new Map<string, number>();
  for (const match of bracket) {
    for (const team of matchParticipantIds(match)) {
      const seen = firstMatchRound.get(team);
      if (seen === undefined || match.roundNumber < seen) {
        firstMatchRound.set(team, match.roundNumber);
      }
    }
  }
  return new Map([...firstMatchRound].flatMap(([team, entersAtRound]) => {
    const skippedRounds = rounds.filter((roundNumber) => roundNumber < entersAtRound);
    return skippedRounds.length > 0 ? [[team, { entersAtRound, skippedRounds }] as const] : [];
  }));
}

/** How a team's knockout score came about: what a leaderboard pick shows beside its points. */
export interface KnockoutTeamRecord {
  /** Matches won, with each bye whose skipped round is decided counted as a win. */
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

/** A decided match's winning and losing field rows. */
interface DecidedMatch {
  match: SportEventRoundMatch;
  winner: string | null;
  loser: string | null;
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
  const decided = new Map<string, DecidedMatch>();
  for (const row of field) {
    for (const match of row.matches) {
      const winner = winningSide(match);
      if (match.status === MatchStatus.COMPLETED && winner !== null) {
        decided.set(match.id, { match, winner: winner.sportEventParticipantId, loser: opposingSideOf(match, winner.sideNumber).sportEventParticipantId });
      }
    }
  }
  const seedById = knockoutSeeds(field.map((row) => row.entry));
  // Each row carries the matches it is in; the bracket is every one of them, once.
  const bracket = [...new Map(field.flatMap((row) => row.matches).map((match) => [match.id, match])).values()];
  const withdrawn = withdrawnRowIds(field.map((row) => row.entry), bracket);
  const byes = byeEntries(bracket);

  return field.map((row) => {
    const results = row.matches.flatMap((match) => {
      const result = decided.get(match.id);
      return result ? [result] : [];
    });
    const won = results.filter((result) => result.winner === row.entry.id);
    const upsetBonusPoints = won.reduce((total, result) => total + upsetBonusFor(
      settings.upsetBonus,
      seedById.get(row.entry.id) ?? null,
      seedById.get(result.loser ?? '') ?? null,
    ), 0);
    const byeRounds = (byes.get(row.entry.id)?.skippedRounds ?? []).filter((roundNumber) => isMatchRoundDecided(bracket, roundNumber));
    const roundPoints = [...byeRounds, ...won.map((result) => result.match.roundNumber)]
      .map((roundNumber) => settings.roundValues.at(roundNumber - 1));
    const record: KnockoutTeamRecord = {
      wins: won.length + byeRounds.length,
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
