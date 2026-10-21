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
 * - **Scoring** reuses the knockout round points (`KnockoutRoundPointsSettings`): a pick in round N
 *   is correct when its team won its round-N game, wherever the reseeding placed that game, and earns
 *   `roundValues[N - 1]` plus the upset bonus of the game it won. A pick whose team is out is
 *   busted. Max possible points (design Q3.10) adds the round value of every pick still pending; it
 *   is an upper bound, since two teams still in can meet before the round the entry picked them to win.
 * - **A team withdrawn after the draw** (#704) and replaced in its first-round place is no longer
 *   in its game, but a pick of it made before stands, and loses in the first round: busted from
 *   its first game on, as is every later pick of it. A new pick can't name it.
 * - **The tiebreaker** is the total points scored in the final, both teams together (design §5.2);
 *   the entry closest to it ranks first among entries with the same points.
 */
import {
  MatchSide,
  MatchStatus,
  PickOutcome,
  type KnockoutRoundPointsSettings,
  type SportEventMatch,
} from '@poolmaster/shared/domain';
import { proposeRoundMatchups, reseededRounds } from '../../events/bracket-reseed';
import { gameTotalPoints } from './game-picks';
import { upsetBonusFor } from './score-team';

/** One bracket pick: the team an entry says wins one game. */
export interface BracketPick {
  sportEventMatchId: string;
  sportEventParticipantId: string;
}

/** The two teams an entry's picks put in one game; null until the picks that decide it are made. */
export interface PredictedSides {
  home: string | null;
  away: string | null;
}

export interface ResolvedBracket<Pick extends BracketPick> {
  /** Each game's predicted sides, by match id. */
  sides: Map<string, PredictedSides>;
  /** The picks that stand. */
  kept: Pick[];
  /** The picks whose team the entry's earlier picks no longer put in the game. */
  stranded: Pick[];
}

const SIDES = [MatchSide.HOME, MatchSide.AWAY] as const;

/**
 * The games a bracket contest picks: the event's games from the contest's starting round on, with
 * cancelled games left out. A second-chance bracket (`startsAtRound` after 1) begins at a round
 * whose teams the results have already decided, so everything below reads that round as its first
 * and its sides as the real teams.
 */
export function contestBracketGames<Match extends Pick<SportEventMatch, 'status' | 'roundNumber'>>(
  matches: readonly Match[],
  startsAtRound: number,
): Match[] {
  return matches.filter((match) => match.status !== MatchStatus.CANCELLED && match.roundNumber >= startsAtRound);
}

function storedSide(match: SportEventMatch, side: MatchSide): string | null {
  return side === MatchSide.HOME ? match.homeSportEventParticipantId : match.awaySportEventParticipantId;
}

function withSides(match: SportEventMatch, sides: PredictedSides): SportEventMatch {
  return { ...match, homeSportEventParticipantId: sides.home, awaySportEventParticipantId: sides.away };
}

/** The field rows withdrawn after the draw (#704): inactive, as no row still in a bracket is. */
export function withdrawnRowIds(field: ReadonlyArray<{ id: string; isActive: boolean }>): Set<string> {
  return new Set(field.filter((row) => !row.isActive).map((row) => row.id));
}

/**
 * Each game's predicted sides under the entry's picks, and which picks stand. `bracket` is the
 * event's games (cancelled ones left out); `seedOf` is the field's seeds (`knockoutSeeds`);
 * `withdrawn` the rows withdrawn after the draw (`withdrawnRowIds`), whose first-round picks stand.
 */
export function resolveBracketPicks<Pick extends BracketPick>(
  bracket: readonly SportEventMatch[],
  picks: readonly Pick[],
  seedOf: ReadonlyMap<string, number | null>,
  withdrawn: ReadonlySet<string> = new Set(),
): ResolvedBracket<Pick> {
  const rounds = [...new Set(bracket.map((match) => match.roundNumber))].sort((left, right) => left - right);
  const firstRound = rounds.at(0);
  const reseeded = reseededRounds(bracket);
  const pickByMatchId = new Map(picks.map((pick) => [pick.sportEventMatchId, pick]));
  const feederOf = new Map(bracket.flatMap((match) =>
    match.advancesToMatchId !== null && match.advancesToSide !== null
      ? [[`${match.advancesToMatchId}/${match.advancesToSide}`, match] as const]
      : []));

  const sides = new Map<string, PredictedSides>();
  const kept: Pick[] = [];
  const stranded: Pick[] = [];
  // The bracket as the entry's picks play it: each game it picked is decided for its team.
  const predicted: SportEventMatch[] = [];
  const keptTeamByMatchId = new Map<string, string>();
  const teamsBefore = new Set<string>();

  for (const roundNumber of rounds) {
    const round = bracket
      .filter((match) => match.roundNumber === roundNumber)
      .sort((left, right) => left.matchNumber - right.matchNumber);
    for (const match of round) {
      const placed: PredictedSides = { home: null, away: null };
      for (const side of SIDES) {
        const team = storedSide(match, side);
        const feeder = feederOf.get(`${match.id}/${side}`);
        const value = roundNumber === firstRound
          ? team
          : feeder !== undefined
            ? keptTeamByMatchId.get(feeder.id) ?? null
            // A team the event placed here without playing an earlier round is a bye; any other
            // team on an unlinked side got there by results, which the entry predicts for itself.
            : team !== null && !teamsBefore.has(team) ? team : null;
        if (side === MatchSide.HOME) placed.home = value;
        else placed.away = value;
      }
      sides.set(match.id, placed);
    }
    if (roundNumber !== firstRound && reseeded.has(roundNumber)) {
      const { matchups } = proposeRoundMatchups(
        [...predicted, ...round.map((match) => withSides(match, sides.get(match.id) ?? { home: null, away: null }))],
        roundNumber,
        seedOf,
      );
      for (const matchup of matchups) {
        const match = round.find((candidate) => candidate.matchNumber === matchup.matchNumber);
        if (match) {
          sides.set(match.id, { home: matchup.homeSportEventParticipantId, away: matchup.awaySportEventParticipantId });
        }
      }
    }
    for (const match of round) {
      const placed = sides.get(match.id) ?? { home: null, away: null };
      const pick = pickByMatchId.get(match.id);
      const winnerSide = pick === undefined ? null
        : pick.sportEventParticipantId === placed.home ? MatchSide.HOME
          : pick.sportEventParticipantId === placed.away ? MatchSide.AWAY
            : null;
      // A first-round pick of a team withdrawn from this game stands, and carries the team on.
      const pickedWithdrawn = pick !== undefined && roundNumber === firstRound && withdrawn.has(pick.sportEventParticipantId);
      if (pick !== undefined && (winnerSide !== null || pickedWithdrawn)) {
        kept.push(pick);
        keptTeamByMatchId.set(match.id, pick.sportEventParticipantId);
      } else if (pick !== undefined) {
        stranded.push(pick);
      }
      predicted.push({
        ...withSides(match, placed),
        status: winnerSide === null ? MatchStatus.SCHEDULED : MatchStatus.COMPLETED,
        winnerSide,
      });
      for (const side of SIDES) {
        const team = storedSide(match, side);
        if (team !== null) teamsBefore.add(team);
      }
    }
  }
  return { sides, kept, stranded };
}

/**
 * Why an event's games cannot be filled in as a bracket, or null when they can: every game must
 * offer two teams once the games before it are picked, so a first-round team still to be decided
 * (for a second-chance bracket, a team of its starting round that the results have not yet decided),
 * a later game no earlier game leads to, or a bracket without a single final is refused. Checked
 * by filling the bracket in with each game's home team.
 */
export function findBracketProblem(
  bracket: readonly SportEventMatch[],
  seedOf: ReadonlyMap<string, number | null>,
  startsAtRound = 1,
): string | null {
  if (bracket.length === 0) {
    return startsAtRound > 1 ? `it has no games from round ${startsAtRound} on` : 'it has no games';
  }
  const rounds = [...new Set(bracket.map((match) => match.roundNumber))].sort((left, right) => left - right);
  const finals = bracket.filter((match) => match.roundNumber === rounds.at(-1));
  if (finals.length !== 1) {
    return `its last round has ${finals.length} games, not one final`;
  }
  const picks: BracketPick[] = [];
  for (const roundNumber of rounds) {
    const { sides } = resolveBracketPicks(bracket, picks, seedOf);
    for (const match of bracket.filter((candidate) => candidate.roundNumber === roundNumber)) {
      const placed = sides.get(match.id);
      if (!placed?.home || !placed.away) {
        return `game ${match.matchNumber} of round ${roundNumber} has a team that no pick can decide`;
      }
      picks.push({ sportEventMatchId: match.id, sportEventParticipantId: placed.home });
    }
  }
  return null;
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
 * Scores an entry's standing picks against the bracket's results. `bracket` holds every game of
 * the event, with each completed game's winner; a team in `withdrawn` lost in its first round.
 */
export function scoreBracketPicks(
  bracket: readonly SportEventMatch[],
  picks: readonly BracketPick[],
  seedOf: ReadonlyMap<string, number | null>,
  settings: KnockoutRoundPointsSettings,
  withdrawn: ReadonlySet<string> = new Set(),
): BracketScore {
  const roundByMatchId = new Map(bracket.map((match) => [match.id, match.roundNumber]));
  /** For each team, the games it won by round (with the team it beat), and the round it lost in. */
  const wins = new Map<string, Map<number, string | null>>();
  const firstRound = Math.min(...bracket.map((match) => match.roundNumber));
  const lostIn = new Map<string, number>([...withdrawn].map((sportEventParticipantId) => [sportEventParticipantId, firstRound]));
  for (const match of bracket) {
    if (match.status !== MatchStatus.COMPLETED || match.winnerSide === null) continue;
    const winner = storedSide(match, match.winnerSide);
    const loser = storedSide(match, match.winnerSide === MatchSide.HOME ? MatchSide.AWAY : MatchSide.HOME);
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
    const roundNumber = roundByMatchId.get(pick.sportEventMatchId);
    if (roundNumber === undefined) continue;
    const roundValue = settings.roundValues.at(roundNumber - 1) ?? 0;
    const beaten = wins.get(pick.sportEventParticipantId);
    const lostRound = lostIn.get(pick.sportEventParticipantId);
    if (beaten?.has(roundNumber)) {
      const earned = roundValue + upsetBonusFor(
        settings.upsetBonus,
        seedOf.get(pick.sportEventParticipantId) ?? null,
        seedOf.get(beaten.get(roundNumber) ?? '') ?? null,
      );
      scored.set(pick.sportEventMatchId, { outcome: PickOutcome.CORRECT, points: earned });
      points += earned;
      correctPickCount += 1;
    } else if (lostRound !== undefined && lostRound <= roundNumber) {
      scored.set(pick.sportEventMatchId, { outcome: PickOutcome.BUSTED, points: 0 });
    } else {
      scored.set(pick.sportEventMatchId, { outcome: PickOutcome.PENDING, points: null });
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

/** The bracket's final, its one game of the last round; null while that round has not one game. */
export function bracketFinal(bracket: readonly SportEventMatch[]): SportEventMatch | null {
  const lastRound = Math.max(...bracket.map((match) => match.roundNumber));
  const finals = bracket.filter((match) => match.roundNumber === lastRound);
  return finals.length === 1 ? finals[0] ?? null : null;
}

/** The final's combined score, both teams together, once it is played: what the tiebreaker guesses. */
export function finalTotalPoints(bracket: readonly SportEventMatch[]): number | null {
  return gameTotalPoints(bracketFinal(bracket));
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
 * standings do.
 */
export function rankPredictionStandings(
  standings: readonly PredictionStandingInput[],
  finalTotal: number | null,
): RankedPredictionStanding[] {
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
    return { entryId: standing.entryId, position: lastPosition, displayPosition: tied ? `T${lastPosition}` : String(lastPosition) };
  });
}
