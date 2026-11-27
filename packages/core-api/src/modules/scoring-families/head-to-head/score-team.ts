/**
 * Knockout round points (#699, plans/knockout-and-pickem-design.md §3.2): a team's contest score is
 * the sum, over the matches it won, of that round's value plus the upset bonus. The family's rules,
 * all here:
 *
 * - Only the rounds the contest covers count (#2014): the rounds whose slot its template lists. A
 *   win in a covered round scores the value of that round's place among the covered rounds
 *   (`coveredRoundValue`), so a contest covering the round of 64 on scores a round of 64 win at
 *   `roundValues[0]` though the play-in is the event's round 1, and a play-in win scores nothing.
 *   Contest setup holds the table to one value per covered round (#2177), so a covered round with
 *   no value leaves the team unscored rather than scoring it 0. A loss in any round still puts the
 *   team out.
 * - With the SEED_DIFFERENCE bonus on, a win by the worse seed (the higher number) adds the seed
 *   difference times the multiplier. No bonus for equal seeds or when the better seed wins.
 * - An unseeded team counts as the field's worst seed: the highest seed number on the field, which
 *   is locked from release (design Q3.1).
 * - A bye counts as a win (#2170): a team placed straight into a later covered round scores the
 *   value of each covered round it skipped, as if it had won a match there, and the bye counts among its wins. The
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
  SportEventParticipantStatus,
  UpsetBonusRule,
  assertNever,
  coveredRoundNumbers,
  coveredRoundValue,
  coversMatchRound,
  playsKnockoutRounds,
  type ContestRoundCoverage,
  type KnockoutRoundPointsSettings,
  type SportEventRoundMatch,
  type UpsetBonus,
  type SportEventParticipant,
} from '@poolmaster/shared/domain';
import type { SportEventParticipantView } from '../../events/sport-event-participant-service';
import { isMatchRoundDecided } from './finished-rounds';

/**
 * The field rows withdrawn after the draw and replaced (#704): inactive as WITHDRAWN, and named
 * by no match of `bracket`. A row inactivated while still in its place is not one of them.
 */
export function withdrawnRowIds(
  field: ReadonlyArray<Pick<SportEventParticipant, 'id' | 'status'>>,
  bracket: ReadonlyArray<Pick<SportEventRoundMatch, 'id' | 'sides'>>,
): Set<string> {
  const named = new Set(bracket.flatMap(matchParticipantIds));
  return new Set(field
    .filter((row) => row.status === SportEventParticipantStatus.WITHDRAWN && !named.has(row.id))
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

/**
 * The field rows a group stage put out (#2241): once the knockout's first round has every side
 * drawn, a team that played group matchdays and is named by no knockout match is out. A field with
 * no group stage puts nobody out here.
 */
function leftOutOfKnockout(
  field: readonly SportEventParticipantView[],
  knockout: ReadonlyArray<Pick<SportEventRoundMatch, 'id' | 'roundNumber' | 'sides'>>,
): Set<string> {
  if (knockout.length === 0) return new Set();
  const firstRound = Math.min(...knockout.map((match) => match.roundNumber));
  const drawn = knockout.filter((match) => match.roundNumber === firstRound).every((match) => match.sides.every((side) => side.sportEventParticipantId !== null));
  if (!drawn) return new Set();
  const named = new Set(knockout.flatMap(matchParticipantIds));
  return new Set(field
    .filter((row) => !named.has(row.entry.id) && row.matches.some((match) => !playsKnockoutRounds(match.slot.slotKind)))
    .map((row) => row.entry.id));
}

/** How a team's knockout score came about: what a leaderboard pick shows beside its points. */
export interface KnockoutTeamRecord {
  /** Matches won in covered rounds, with each bye whose skipped round is decided counted as a win. */
  wins: number;
  /** The part of the score that is upset bonus; 0 with the bonus off. */
  upsetBonusPoints: number;
  /** False once the team has lost a knockout match, or a group stage left it out of the knockout. */
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

/**
 * Every field row's knockout score and record under one contest's settings and coverage, in field
 * order.
 */
export function scoreKnockoutField(
  field: readonly SportEventParticipantView[],
  settings: KnockoutRoundPointsSettings,
  coverage: ContestRoundCoverage,
): KnockoutTeamScore[] {
  // Only knockout rounds score or put a team out (#2241): a group matchday or the third-place
  // play-off is no round of the bracket.
  const knockoutMatches = (row: SportEventParticipantView) => row.matches.filter((match) => playsKnockoutRounds(match.slot.slotKind));
  const decided = new Map<string, DecidedMatch>();
  for (const row of field) {
    for (const match of knockoutMatches(row)) {
      const winner = winningSide(match);
      if (match.status === MatchStatus.COMPLETED && winner !== null) {
        decided.set(match.id, { match, winner: winner.sportEventParticipantId, loser: opposingSideOf(match, winner.sideNumber).sportEventParticipantId });
      }
    }
  }
  const seedById = knockoutSeeds(field.map((row) => row.entry));
  // Each row carries the matches it is in; the bracket is every knockout one of them, once.
  const bracket = [...new Map(field.flatMap(knockoutMatches).map((match) => [match.id, match])).values()];
  const withdrawn = withdrawnRowIds(field.map((row) => row.entry), bracket);
  const leftOut = leftOutOfKnockout(field, bracket);
  // The contest's own bracket is its covered rounds: a bye is a skipped covered round, and only a
  // covered round's result is scored.
  const covered = bracket.filter((match) => coversMatchRound(coverage, match));
  const coveredRounds = coveredRoundNumbers(coverage, bracket);
  const byes = byeEntries(covered);
  const anyCoveredResult = [...decided.values()].some((result) => coversMatchRound(coverage, result.match));

  return field.map((row) => {
    const results = knockoutMatches(row).flatMap((match) => {
      const result = decided.get(match.id);
      return result ? [result] : [];
    });
    const won = results.filter((result) => result.winner === row.entry.id);
    const wonCovered = won.filter((result) => coversMatchRound(coverage, result.match));
    const upsetBonusPoints = wonCovered.reduce((total, result) => total + upsetBonusFor(
      settings.upsetBonus,
      seedById.get(row.entry.id) ?? null,
      seedById.get(result.loser ?? '') ?? null,
    ), 0);
    const byeRounds = (byes.get(row.entry.id)?.skippedRounds ?? []).filter((roundNumber) => isMatchRoundDecided(covered, roundNumber));
    const roundPoints = [...byeRounds, ...wonCovered.map((result) => result.match.roundNumber)]
      .map((roundNumber) => coveredRoundValue(settings.roundValues, coveredRounds, roundNumber));
    const record: KnockoutTeamRecord = {
      wins: wonCovered.length + byeRounds.length,
      upsetBonusPoints,
      isAlive: !withdrawn.has(row.entry.id) && !leftOut.has(row.entry.id) && results.length === won.length,
    };
    const scoredRounds = roundPoints.filter((points): points is number => points !== undefined);
    if (!anyCoveredResult || scoredRounds.length < roundPoints.length) {
      return { score: null, record };
    }
    return { score: scoredRounds.reduce((total, points) => total + points, 0) + upsetBonusPoints, record };
  });
}
