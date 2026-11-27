/**
 * Bracket picks (#721, plans/knockout-and-pickem-design.md §5.2 Q5.3): an entry fills in the winner
 * of every game of a knockout before it starts, all the way to the final. The pure rules, all here:
 *
 * - **Which teams a game offers** is the entry's own earlier picks: a side a link fills holds the
 *   entry's pick of the game feeding it. In a reseeded round (the NFL after Wild Card weekend) the
 *   entry's picked winners are paired by seed, the same rule the admin's proposal follows
 *   (`proposeRoundMatchups`), so each entry sees its own predicted next games. A team placed straight
 *   into a later round (a bye) holds its side, and the first round's sides are the real teams.
 * - **A pick stands** only while it names a team the entry's picks put in its game. Changing an
 *   earlier pick strands the later picks that depended on it, and `resolveBracketPicks` drops them,
 *   round by round, so a stranded pick also strands the picks that followed from it.
 * - **The bracket is the contest's covered rounds** (#2014, `contestBracketGames`): an event's
 *   play-in, which a bracket template leaves out, takes no pick.
 * - **Scoring** reuses the knockout round points (`KnockoutRoundPointsSettings`): a pick in round N
 *   is correct when its team won its round-N game, wherever the reseeding placed that game, and earns
 *   the value of round N's place among the bracket's rounds (`coveredRoundValue`: `roundValues[0]`
 *   for its first round, whatever its number in the event) plus the upset bonus of the game it won. A pick whose team is out is
 *   busted. Max possible points (design Q3.10) adds the round value of every pick still pending; it
 *   is an upper bound, since two teams still in can meet before the round the entry picked them to win.
 * - **A team withdrawn after the draw** (#704) and replaced in its first-round place is no longer
 *   in its game, but a pick of it made before stands, and loses in the first round: busted from
 *   its first game on, as is every later pick of it. A new pick can't name it.
 * - **The tiebreaker** is the total points scored in the final, both teams together (design §5.2);
 *   the entry closest to it ranks first among entries with the same points.
 */
import {
  MatchSideOutcome,
  opposingSideOf,
  sideParticipantId,
  winningSide,
  MatchStatus,
  PickOutcome,
  SlotKind,
  finalRoundsOfMatches,
  coveredRoundValue,
  coversMatchRound,
  type ContestRoundCoverage,
  type KnockoutRoundPointsSettings,
  type SportEventRoundMatch,
} from '@poolmaster/shared/domain';
import { proposeRoundMatchups, reseededRounds } from '../../events/bracket-reseed';
import { gameTotalPoints, slotTiebreakerGame } from './game-picks';
import { byeEntries, upsetBonusFor } from './score-team';

/** One bracket pick: the team an entry says wins one game. */
export interface BracketPick {
  sportEventRoundMatchId: string;
  sportEventParticipantId: string;
}

/**
 * The teams an entry's picks put in one game, by side number (#2016): each of the game's sides,
 * with null until the picks that decide it are made.
 */
export type PredictedSides = ReadonlyMap<number, string | null>;

/** The team an entry's picks put on one side of a game, or null while none is. */
export function predictedOn(sides: PredictedSides | undefined, sideNumber: number): string | null {
  return sides?.get(sideNumber) ?? null;
}

/** The side number of a game an entry's picks put a team on, or null when they put it on neither. */
export function predictedSideOf(sides: PredictedSides | undefined, sportEventParticipantId: string): number | null {
  for (const [sideNumber, team] of sides ?? []) {
    if (team === sportEventParticipantId) return sideNumber;
  }
  return null;
}

/** A game's real teams as predicted sides: what a pick'em or survivor pick chooses between. */
export function realSides(match: Pick<SportEventRoundMatch, 'sides'>): PredictedSides {
  return new Map(match.sides.map((side) => [side.sideNumber, side.sportEventParticipantId]));
}

/** A game's lowest side number: side 1. */
function firstSideNumber(match: Pick<SportEventRoundMatch, 'sides'>): number {
  return Math.min(...match.sides.map((side) => side.sideNumber));
}

export interface ResolvedBracket<Pick extends BracketPick> {
  /** Each game's predicted sides, by match id. */
  sides: Map<string, PredictedSides>;
  /** The picks that stand. */
  kept: Pick[];
  /** The picks whose team the entry's earlier picks no longer put in the game. */
  stranded: Pick[];
}

/**
 * The games a bracket contest picks: every game of the rounds it covers (#2014), with cancelled
 * games left out. A play-in its template leaves out is no part of its bracket: its winner fills
 * a first covered round side, as a real team.
 */
export function contestBracketGames<Match extends Pick<SportEventRoundMatch, 'status' | 'slot'>>(
  matches: readonly Match[],
  coverage: ContestRoundCoverage,
): Match[] {
  return matches.filter((match) => match.status !== MatchStatus.CANCELLED && coversMatchRound(coverage, match));
}

/** A contest bracket's rounds by number, lowest first: the covered rounds `contestBracketGames` keeps. */
function bracketRoundNumbers(bracket: readonly Pick<SportEventRoundMatch, 'roundNumber'>[]): number[] {
  return [...new Set(bracket.map((match) => match.roundNumber))].sort((left, right) => left - right);
}

/** The game as the entry's picks play it: its predicted teams, and the side number the entry picked to win, if any. */
function withSides(match: SportEventRoundMatch, sides: PredictedSides, winnerNumber: number | null = null): SportEventRoundMatch {
  return {
    ...match,
    sides: match.sides.map((side) => ({
      ...side,
      sportEventParticipantId: predictedOn(sides, side.sideNumber),
      outcome: winnerNumber === null ? MatchSideOutcome.PENDING : side.sideNumber === winnerNumber ? MatchSideOutcome.WON : MatchSideOutcome.LOST,
    })),
  };
}

/**
 * Each game's predicted sides under the entry's picks, and which picks stand. `bracket` is the
 * event's games (cancelled ones left out); `seedOf` is the field's seeds (`knockoutSeeds`);
 * `withdrawn` the rows withdrawn after the draw (`withdrawnRowIds` in score-team), whose first-round picks stand.
 */
export function resolveBracketPicks<Pick extends BracketPick>(
  bracket: readonly SportEventRoundMatch[],
  picks: readonly Pick[],
  seedOf: ReadonlyMap<string, number | null>,
  withdrawn: ReadonlySet<string> = new Set(),
): ResolvedBracket<Pick> {
  const rounds = [...new Set(bracket.map((match) => match.roundNumber))].sort((left, right) => left - right);
  // poolmaster-allow-position: round numbers sorted ascending: the lowest is the first round
  const firstRound = rounds.at(0);
  const reseeded = reseededRounds(bracket);
  const pickByMatchId = new Map(picks.map((pick) => [pick.sportEventRoundMatchId, pick]));
  const feederOf = (matchId: string, sideNumber: number) => bracket.find((match) => match.advancesToMatchId === matchId && match.advancesToSideNumber === sideNumber);

  const sides = new Map<string, PredictedSides>();
  const kept: Pick[] = [];
  const stranded: Pick[] = [];
  // The bracket as the entry's picks play it: each game it picked is decided for its team.
  const predicted: SportEventRoundMatch[] = [];
  const keptTeamByMatchId = new Map<string, string>();
  const byes = byeEntries(bracket);

  for (const roundNumber of rounds) {
    const round = bracket
      .filter((match) => match.roundNumber === roundNumber)
      .sort((left, right) => left.matchNumber - right.matchNumber);
    const placeSides = (match: SportEventRoundMatch): PredictedSides => {
      const placed = new Map<number, string | null>();
      for (const { sideNumber } of match.sides) {
        const team = sideParticipantId(match, sideNumber);
        const feeder = feederOf(match.id, sideNumber);
        const value = roundNumber === firstRound
          ? team
          : feeder !== undefined
            ? keptTeamByMatchId.get(feeder.id) ?? null
            // A team the event placed here without playing an earlier round is a bye; any other
            // team on an unlinked side got there by results, which the entry predicts for itself.
            : team !== null && byes.get(team)?.entersAtRound === roundNumber ? team : null;
        placed.set(sideNumber, value);
      }
      return placed;
    };
    let placements = round.map((match) => ({ match, placed: placeSides(match) }));
    if (roundNumber !== firstRound && reseeded.has(roundNumber)) {
      const { matchups } = proposeRoundMatchups(
        [...predicted, ...placements.map(({ match, placed }) => withSides(match, placed))],
        roundNumber,
        seedOf,
      );
      placements = placements.map(({ match, placed }) => {
        const matchup = matchups.find((candidate) => candidate.matchNumber === match.matchNumber);
        return { match, placed: matchup === undefined ? placed : new Map(matchup.sides.map((each) => [each.sideNumber, each.sportEventParticipantId])) };
      });
    }
    for (const { match, placed } of placements) {
      sides.set(match.id, placed);
      const pick = pickByMatchId.get(match.id);
      const winnerSide = pick === undefined ? null : predictedSideOf(placed, pick.sportEventParticipantId);
      // A first-round pick of a team withdrawn from this game stands, and carries the team on.
      const pickedWithdrawn = pick !== undefined && roundNumber === firstRound && withdrawn.has(pick.sportEventParticipantId);
      if (pick !== undefined && (winnerSide !== null || pickedWithdrawn)) {
        kept.push(pick);
        keptTeamByMatchId.set(match.id, pick.sportEventParticipantId);
      } else if (pick !== undefined) {
        stranded.push(pick);
      }
      // A withdrawn team the entry picked wins its game in the entry's bracket, so reseeding moves it on.
      predicted.push(pickedWithdrawn
        ? { ...withSides(match, new Map([[firstSideNumber(match), pick.sportEventParticipantId]]), firstSideNumber(match)), status: MatchStatus.COMPLETED }
        : { ...withSides(match, placed, winnerSide), status: winnerSide === null ? MatchStatus.SCHEDULED : MatchStatus.COMPLETED });
    }
  }
  return { sides, kept, stranded };
}

/**
 * Why an event's games cannot be filled in as a bracket, or null when they can: every game must
 * offer two teams once the games before it are picked, so a first-round team still to be decided,
 * a later game no earlier game leads to, or a bracket without a single final is refused. Checked
 * by filling the bracket in with each game's side-1 team.
 */
export function findBracketProblem(
  bracket: readonly SportEventRoundMatch[],
  seedOf: ReadonlyMap<string, number | null>,
): string | null {
  if (bracket.length === 0) {
    return 'it has no games';
  }
  const rounds = [...new Set(bracket.map((match) => match.roundNumber))].sort((left, right) => left - right);
  // The final is the game of the final's round (#2006), never the last round's.
  const finalRounds = finalRoundsOfMatches(bracket);
  const finals = bracket.filter((match) => finalRounds.has(match.roundNumber));
  if (finals.length !== 1) {
    return `its final has ${finals.length} games, not one`;
  }
  const picks: BracketPick[] = [];
  for (const roundNumber of rounds) {
    const { sides } = resolveBracketPicks(bracket, picks, seedOf);
    for (const match of bracket.filter((candidate) => candidate.roundNumber === roundNumber)) {
      const placed = sides.get(match.id);
      const teams = match.sides.map((side) => predictedOn(placed, side.sideNumber));
      const first = predictedOn(placed, firstSideNumber(match));
      if (first === null || teams.some((team) => team === null)) {
        return `game ${match.matchNumber} of round ${roundNumber} has a team that no pick can decide`;
      }
      picks.push({ sportEventRoundMatchId: match.id, sportEventParticipantId: first });
    }
  }
  return null;
}

/**
 * Whether an event's games are a slate of one-off games (#2225): every game in one round of a
 * TOURNAMENT slot, none whose winner moves on, such as a season's bowl games. Each is its own
 * final, so knockout round points score a win at the round's one value. A regular-season week's
 * games are not one (#715), nor a knockout's first round placed before its later rounds are
 * linked: their slots are WEEK and knockout-round kinds.
 */
function isOneRoundSlate(games: ReadonlyArray<Pick<SportEventRoundMatch, 'roundNumber' | 'advancesToMatchId' | 'slot'>>): boolean {
  return games.length > 0
    && new Set(games.map((game) => game.roundNumber)).size === 1
    && games.every((game) => game.advancesToMatchId === null && game.slot.slotKind === SlotKind.TOURNAMENT);
}

/**
 * Why knockout round points cannot score an event's games, or null when they can (#2225): a
 * win scores its round's value, so the games must be a bracket (`findBracketProblem`) or a slate of
 * one-off games (`isOneRoundSlate`). A bracket pick'em still needs a bracket: its entry picks every
 * game to the one final.
 */
export function findKnockoutProblem(
  games: readonly SportEventRoundMatch[],
  seedOf: ReadonlyMap<string, number | null>,
): string | null {
  return isOneRoundSlate(games) ? null : findBracketProblem(games, seedOf);
}

/** One pick as the results score it. */
export interface ScoredBracketPick {
  outcome: PickOutcome;
  /** What it earned: null while pending, 0 when busted. */
  points: number | null;
}

export interface BracketScore {
  points: number;
  maxPossiblePoints: number;
  correctPickCount: number;
  /** Picks whose game or team is decided: correct or busted. */
  decidedPickCount: number;
  /** Each pick's outcome, by match id. */
  picks: Map<string, ScoredBracketPick>;
}

/**
 * Scores an entry's standing picks against the bracket's results. `bracket` holds the contest's
 * games (`contestBracketGames`), with each completed game's winner; a team in `withdrawn` lost in its first round.
 */
export function scoreBracketPicks(
  bracket: readonly SportEventRoundMatch[],
  picks: readonly BracketPick[],
  seedOf: ReadonlyMap<string, number | null>,
  settings: KnockoutRoundPointsSettings,
  withdrawn: ReadonlySet<string> = new Set(),
): BracketScore {
  const roundByMatchId = new Map(bracket.map((match) => [match.id, match.roundNumber]));
  const rounds = bracketRoundNumbers(bracket);
  /** For each team, the games it won by round (with the team it beat), and the round it lost in. */
  const wins = new Map<string, Map<number, string | null>>();
  const firstRound = Math.min(...bracket.map((match) => match.roundNumber));
  const lostIn = new Map<string, number>([...withdrawn].map((sportEventParticipantId) => [sportEventParticipantId, firstRound]));
  for (const match of bracket) {
    const winnerSide = winningSide(match);
    if (match.status !== MatchStatus.COMPLETED || winnerSide === null) continue;
    const winner = winnerSide.sportEventParticipantId;
    const loser = opposingSideOf(match, winnerSide.sideNumber).sportEventParticipantId;
    if (winner !== null) {
      const byRound = wins.get(winner) ?? new Map<number, string | null>();
      byRound.set(match.roundNumber, loser);
      wins.set(winner, byRound);
    }
    if (loser !== null) lostIn.set(loser, match.roundNumber);
  }

  const scored = new Map<string, ScoredBracketPick>();
  let points = 0;
  let pendingPoints = 0;
  let correctPickCount = 0;
  for (const pick of picks) {
    const roundNumber = roundByMatchId.get(pick.sportEventRoundMatchId);
    if (roundNumber === undefined) continue;
    const roundValue = coveredRoundValue(settings.roundValues, rounds, roundNumber) ?? 0;
    const beaten = wins.get(pick.sportEventParticipantId);
    const lostRound = lostIn.get(pick.sportEventParticipantId);
    if (beaten?.has(roundNumber)) {
      const earned = roundValue + upsetBonusFor(
        settings.upsetBonus,
        seedOf.get(pick.sportEventParticipantId) ?? null,
        seedOf.get(beaten.get(roundNumber) ?? '') ?? null,
      );
      scored.set(pick.sportEventRoundMatchId, { outcome: PickOutcome.CORRECT, points: earned });
      points += earned;
      correctPickCount += 1;
    } else if (lostRound !== undefined && lostRound <= roundNumber) {
      scored.set(pick.sportEventRoundMatchId, { outcome: PickOutcome.BUSTED, points: 0 });
    } else {
      scored.set(pick.sportEventRoundMatchId, { outcome: PickOutcome.PENDING, points: null });
      pendingPoints += roundValue;
    }
  }
  return {
    points,
    maxPossiblePoints: points + pendingPoints,
    correctPickCount,
    decidedPickCount: [...scored.values()].filter((pick) => pick.outcome !== PickOutcome.PENDING).length,
    picks: scored,
  };
}

/** The bracket's final, its one game of the final's round (#2006); null while that round has not one game. */
export function bracketFinal(bracket: readonly SportEventRoundMatch[]): SportEventRoundMatch | null {
  const finalRounds = finalRoundsOfMatches(bracket);
  const finals = bracket.filter((match) => finalRounds.has(match.roundNumber));
  return finals.length === 1 ? finals[0] : null;
}

/**
 * The bracket's tiebreaker game (#2048): the game its final's slot names as its tiebreaker, which
 * the slot rule makes the championship once it is scheduled. Null while that slot names none of
 * the final's round.
 */
export function bracketTiebreakerGame(bracket: readonly SportEventRoundMatch[]): SportEventRoundMatch | null {
  const finalRounds = finalRoundsOfMatches(bracket);
  return slotTiebreakerGame(bracket.filter((match) => finalRounds.has(match.roundNumber)));
}

/** The tiebreaker game's combined score, both teams together, once it is played: what the tiebreaker guesses. */
export function finalTotalPoints(bracket: readonly SportEventRoundMatch[]): number | null {
  return gameTotalPoints(bracketTiebreakerGame(bracket));
}

export interface PredictionStandingInput {
  entryId: string;
  points: number;
  tiebreakerValue: number | null;
}

export interface RankedPredictionStanding {
  entryId: string;
  position: number;
  displayPosition: string;
}

/**
 * Ranks a prediction contest's entries for one event, a bracket or a pick'em week (#717), by
 * points, most first. Among equal points, once the tiebreaker game's total is known (a bracket's
 * final, a week's last game) the entry whose tiebreaker is closest ranks first; an entry without
 * one ranks after those with one. Entries still level share a position ("T2"), as roster
 * standings do. Each standing comes back whole, with its place added, best first.
 */
export function rankPredictionStandings<Standing extends PredictionStandingInput>(
  standings: readonly Standing[],
  finalTotal: number | null,
): Array<Standing & RankedPredictionStanding> {
  const distance = (standing: PredictionStandingInput): number =>
    finalTotal === null ? 0
      : standing.tiebreakerValue === null ? Number.MAX_SAFE_INTEGER
        : Math.abs(standing.tiebreakerValue - finalTotal);
  const sorted = [...standings].sort((left, right) =>
    right.points - left.points || distance(left) - distance(right));
  const key = (standing: PredictionStandingInput) => `${standing.points}/${distance(standing)}`;
  const counts = new Map<string, number>();
  for (const standing of sorted) counts.set(key(standing), (counts.get(key(standing)) ?? 0) + 1);
  let lastKey: string | null = null;
  let lastPosition = 0;
  return sorted.map((standing, index) => {
    if (key(standing) !== lastKey) {
      lastKey = key(standing);
      lastPosition = index + 1;
    }
    const tied = (counts.get(key(standing)) ?? 1) > 1;
    return { ...standing, position: lastPosition, displayPosition: tied ? `T${lastPosition}` : String(lastPosition) };
  });
}
