/**
 * Reseeded brackets (#722): the pure rules for a round whose teams are placed by seed rather
 * than by the links of the round before it. The NFL reseeds after Wild Card weekend: in each
 * conference the best seed left hosts the worst, and the other two meet.
 *
 * A round is reseeded when a match of the round before it names no next match. Its teams are
 * the winners of the round before plus any team placed straight into it (a bye), and each stays
 * in its own region. A side an earlier match's link fills keeps that winner.
 */

import { MatchSide, MatchStatus, type SportEventMatch } from '@poolmaster/shared/domain';

/** Both sides of one match of a reseeded round, as the admin sets them. */
export interface RoundMatchup {
  matchNumber: number;
  homeSportEventParticipantId: string;
  awaySportEventParticipantId: string;
}

/** One team entering a reseeded round: its field row, its seed and the region it plays in. */
interface EnteringTeam {
  sportEventParticipantId: string;
  seedNumber: number | null;
  regionLabel: string | null;
  /** The match and side it already holds in the round: a bye's, or a link's winner's. */
  fixedAt: { matchNumber: number; side: MatchSide } | null;
}

const SIDES = [MatchSide.HOME, MatchSide.AWAY] as const;

function sideOf(match: Pick<SportEventMatch, 'homeSportEventParticipantId' | 'awaySportEventParticipantId'>, side: MatchSide): string | null {
  return side === MatchSide.HOME ? match.homeSportEventParticipantId : match.awaySportEventParticipantId;
}

function winnerOf(match: SportEventMatch): string | null {
  return match.status === MatchStatus.COMPLETED && match.winnerSide !== null ? sideOf(match, match.winnerSide) : null;
}

/** The rounds whose teams are placed by reseeding: each after a round with a match that links nowhere, below the last. */
export function reseededRounds(bracket: readonly SportEventMatch[]): Set<number> {
  const lastRound = Math.max(0, ...bracket.map((match) => match.roundNumber));
  return new Set(bracket
    .filter((match) => match.advancesToMatchId === null && match.roundNumber < lastRound)
    .map((match) => match.roundNumber + 1));
}

/** One region of a reseeded round whose open places do not match the winners still to come into it. */
export interface ReseededPlaceGap {
  roundNumber: number;
  regionLabel: string | null;
  /** Sides of the round's matches in the region that nothing names and no link fills. */
  openPlaces: number;
  /** Matches of the round before in the region that link nowhere: their winners are placed by seed. */
  winnersToCome: number;
}

/**
 * Every region of a reseeded round, before release, whose open places differ from the winners
 * still to come from the round before: a bye team left out (more places) or a team too many named
 * (fewer). It counts the round before's matches, not its named teams, since in a round after a
 * reseeded round those are placed later too.
 */
export function findReseededPlaceGaps(bracket: readonly SportEventMatch[]): ReseededPlaceGap[] {
  const fedSides = new Set(bracket
    .filter((match) => match.advancesToMatchId !== null && match.advancesToSide !== null)
    .map((match) => `${match.advancesToMatchId}/${match.advancesToSide}`));
  const gaps: ReseededPlaceGap[] = [];
  for (const roundNumber of [...reseededRounds(bracket)].sort((left, right) => left - right)) {
    const round = bracket.filter((match) => match.roundNumber === roundNumber);
    const unlinkedBefore = bracket.filter((match) => match.roundNumber === roundNumber - 1 && match.advancesToMatchId === null);
    const regions = [...new Set([...round, ...unlinkedBefore].map((match) => match.regionLabel))];
    for (const regionLabel of regions) {
      const openPlaces = round
        .filter((match) => match.regionLabel === regionLabel)
        .flatMap((match) => SIDES.filter((side) => sideOf(match, side) === null && !fedSides.has(`${match.id}/${side}`)))
        .length;
      const winnersToCome = unlinkedBefore.filter((match) => match.regionLabel === regionLabel).length;
      if (openPlaces !== winnersToCome) gaps.push({ roundNumber, regionLabel, openPlaces, winnersToCome });
    }
  }
  return gaps;
}

/** "The best seed first": a team with no seed sorts after every seeded one. */
function bySeed(left: EnteringTeam, right: EnteringTeam): number {
  return (left.seedNumber ?? Number.MAX_SAFE_INTEGER) - (right.seedNumber ?? Number.MAX_SAFE_INTEGER);
}

/**
 * Why a reseeded round cannot be placed yet, or null: the round before has a match without a
 * result, or the round has started.
 */
export function roundPlacementBlocker(bracket: readonly SportEventMatch[], roundNumber: number): { code: 'BRACKET_ROUND_NOT_FINISHED' | 'BRACKET_ROUND_ALREADY_PLAYED'; reason: string } | null {
  const unfinished = bracket.filter((match) => match.roundNumber === roundNumber - 1 && match.status !== MatchStatus.COMPLETED);
  if (unfinished.length > 0) {
    return {
      code: 'BRACKET_ROUND_NOT_FINISHED',
      reason: `match${unfinished.length === 1 ? '' : 'es'} ${unfinished.map((match) => match.matchNumber).join(', ')} of round ${roundNumber - 1} ${unfinished.length === 1 ? 'has' : 'have'} no result yet`,
    };
  }
  // A game with a quarter score (#772) has started, though its status may still read SCHEDULED.
  const started = bracket.filter((match) => match.roundNumber === roundNumber
    && (match.status !== MatchStatus.SCHEDULED || match.periodScores.length > 0));
  if (started.length > 0) {
    return {
      code: 'BRACKET_ROUND_ALREADY_PLAYED',
      reason: `match${started.length === 1 ? '' : 'es'} ${started.map((match) => match.matchNumber).join(', ')} of round ${roundNumber} ${started.length === 1 ? 'has' : 'have'} started`,
    };
  }
  return null;
}

/**
 * Every team entering a reseeded round. The winners of the round before play in that match's
 * region; a team named in the round that did not play the round before is a bye, and a side a
 * link fills keeps its winner. Both hold their place.
 */
function enteringTeams(bracket: readonly SportEventMatch[], roundNumber: number, seedOf: ReadonlyMap<string, number | null>): EnteringTeam[] {
  const previous = bracket.filter((match) => match.roundNumber === roundNumber - 1);
  const round = bracket.filter((match) => match.roundNumber === roundNumber);
  const playedBefore = new Set(previous.flatMap((match) => SIDES.map((side) => sideOf(match, side))).filter((id): id is string => id !== null));
  const fedSides = new Set(previous
    .filter((match) => match.advancesToMatchId !== null && match.advancesToSide !== null)
    .map((match) => `${match.advancesToMatchId}/${match.advancesToSide}`));
  const fixed = new Map<string, EnteringTeam>();
  for (const match of round) {
    for (const side of SIDES) {
      const rowId = sideOf(match, side);
      if (rowId === null) continue;
      if (fedSides.has(`${match.id}/${side}`) || !playedBefore.has(rowId)) {
        fixed.set(rowId, { sportEventParticipantId: rowId, seedNumber: seedOf.get(rowId) ?? null, regionLabel: match.regionLabel, fixedAt: { matchNumber: match.matchNumber, side } });
      }
    }
  }
  const winners = previous
    .filter((match) => match.advancesToMatchId === null)
    .flatMap((match) => {
      const rowId = winnerOf(match);
      return rowId === null || fixed.has(rowId)
        ? []
        : [{ sportEventParticipantId: rowId, seedNumber: seedOf.get(rowId) ?? null, regionLabel: match.regionLabel, fixedAt: null }];
    });
  return [...fixed.values(), ...winners];
}

/**
 * The reseeded pairing the server proposes for a round, or the problems that stop one. In each
 * region the teams are paired best seed with worst, then second best with second worst; the
 * better seed hosts, unless the worse one already holds the home side. A pair with a team that
 * already holds its place goes to that match; the others fill the open matches in match-number
 * order.
 */
export function proposeRoundMatchups(
  bracket: readonly SportEventMatch[],
  roundNumber: number,
  seedOf: ReadonlyMap<string, number | null>,
): { matchups: RoundMatchup[]; problems: string[] } {
  const round = bracket.filter((match) => match.roundNumber === roundNumber).sort((left, right) => left.matchNumber - right.matchNumber);
  const teams = enteringTeams(bracket, roundNumber, seedOf);
  const problems: string[] = [];
  const placed = new Map<number, { home: string | null; away: string | null }>(round.map((match) => [match.matchNumber, { home: null, away: null }]));

  const regions = [...new Set(round.map((match) => match.regionLabel))];
  for (const region of regions) {
    const where = region === null ? `round ${roundNumber}` : `round ${roundNumber} in ${region}`;
    const matches = round.filter((match) => match.regionLabel === region);
    const regionTeams = teams.filter((team) => team.regionLabel === region).sort(bySeed);
    if (regionTeams.length !== matches.length * 2) {
      problems.push(`${where} has ${matches.length * 2} places for ${regionTeams.length} teams`);
      continue;
    }
    const open = matches.filter((match) => !regionTeams.some((team) => team.fixedAt?.matchNumber === match.matchNumber)).map((match) => match.matchNumber);
    for (let index = 0; index < matches.length; index += 1) {
      const pair = [regionTeams[index], regionTeams[regionTeams.length - 1 - index]] as const;
      const holders = pair.filter((team) => team.fixedAt !== null);
      if (holders.length === 2 && holders[0].fixedAt?.matchNumber !== holders[1].fixedAt?.matchNumber) {
        problems.push(`${where}: the teams in matches ${holders[0].fixedAt?.matchNumber} and ${holders[1].fixedAt?.matchNumber} would meet, but each already holds its place`);
        continue;
      }
      const holder = holders.at(0);
      const matchNumber = holder?.fixedAt?.matchNumber ?? open.shift();
      if (matchNumber === undefined) {
        problems.push(`${where} has no open match left for a pair`);
        continue;
      }
      const [better, worse] = pair;
      const other = holder === better ? worse : better;
      const [home, away] = holder === undefined ? [better, worse]
        : holder.fixedAt?.side === MatchSide.AWAY ? [other, holder] : [holder, other];
      placed.set(matchNumber, { home: home.sportEventParticipantId, away: away.sportEventParticipantId });
    }
  }
  const matchups = round.flatMap((match) => {
    const sides = placed.get(match.matchNumber);
    return sides?.home && sides.away
      ? [{ matchNumber: match.matchNumber, homeSportEventParticipantId: sides.home, awaySportEventParticipantId: sides.away }]
      : [];
  });
  return { matchups: problems.length > 0 ? [] : matchups, problems };
}

/**
 * Everything wrong with a reseeded round's matchups as the admin sets them; empty when they
 * can be saved. Every match of the round is set once and nothing else; each team entering the
 * round plays once, in its own region; a team holding its place (a bye, a link's winner) keeps it.
 */
export function findRoundMatchupProblems(
  bracket: readonly SportEventMatch[],
  roundNumber: number,
  matchups: readonly RoundMatchup[],
  seedOf: ReadonlyMap<string, number | null>,
): string[] {
  const problems: string[] = [];
  const round = bracket.filter((match) => match.roundNumber === roundNumber);
  const byNumber = new Map(round.map((match) => [match.matchNumber, match]));
  const given = new Map<number, RoundMatchup>();
  for (const matchup of matchups) {
    if (!byNumber.has(matchup.matchNumber)) problems.push(`match ${matchup.matchNumber} is not in round ${roundNumber}`);
    else if (given.has(matchup.matchNumber)) problems.push(`match ${matchup.matchNumber} is set more than once`);
    given.set(matchup.matchNumber, matchup);
  }
  const unset = round.filter((match) => !given.has(match.matchNumber)).map((match) => match.matchNumber);
  if (unset.length > 0) problems.push(`match${unset.length === 1 ? '' : 'es'} ${unset.join(', ')} of round ${roundNumber} ${unset.length === 1 ? 'is' : 'are'} not set`);

  const teams = new Map(enteringTeams(bracket, roundNumber, seedOf).map((team) => [team.sportEventParticipantId, team]));
  const seen = new Set<string>();
  for (const matchup of given.values()) {
    const match = byNumber.get(matchup.matchNumber);
    if (!match) continue;
    for (const side of SIDES) {
      const rowId = side === MatchSide.HOME ? matchup.homeSportEventParticipantId : matchup.awaySportEventParticipantId;
      const where = `match ${matchup.matchNumber} ${side.toLowerCase()}`;
      const team = teams.get(rowId);
      if (!team) {
        problems.push(`${where} names a team that is not left in round ${roundNumber}`);
        continue;
      }
      if (seen.has(rowId)) problems.push(`${where} names a team already placed`);
      seen.add(rowId);
      if (team.regionLabel !== match.regionLabel) {
        problems.push(`${where} names a team from ${team.regionLabel ?? 'no region'}, but the match is in ${match.regionLabel ?? 'no region'}`);
      }
      if (team.fixedAt && (team.fixedAt.matchNumber !== matchup.matchNumber || team.fixedAt.side !== side)) {
        problems.push(`${where} moves a team that holds match ${team.fixedAt.matchNumber} ${team.fixedAt.side.toLowerCase()}`);
      }
    }
  }
  const missing = [...teams.keys()].filter((rowId) => !seen.has(rowId)).length;
  if (missing > 0 && unset.length === 0) problems.push(`${missing} team${missing === 1 ? '' : 's'} left in round ${roundNumber} ${missing === 1 ? 'is' : 'are'} not placed`);
  return problems;
}
