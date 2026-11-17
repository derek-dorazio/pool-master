/**
 * A best-of-series playoffs' games and bracket for the event's matches (ADR 0011, #1728): each
 * series is one game of the slate, and a league whose bracket is fixed by seed (the NBA's, the
 * WNBA's) also gets its whole bracket. Pure mappings, no I/O, shared the way `series-playoffs.ts`
 * is.
 *
 * The vendor names no seed on a game, so the bracket is built from the first round's series and
 * the league's seed ranks: in each first-round series the better-ranked team's rank is its seed
 * `s`, and its opponent is seed `n + 1 - s`, `n` being the group's teams. That holds for the NBA,
 * whose standings rank the 7 and 8 seeds by record, not by the play-in that seeds them, because
 * only the 1 and 2 seeds meet a play-in team and their ranks are their seeds.
 *
 * Each group (a conference; the WNBA has none) runs 1 v n, n/2 v n/2 + 1 and so on down from the
 * top, the winners of each two consecutive matches meeting next, so the 1 seed meets the 4/5
 * winner and the 2 seed the 3/6 winner. Each later match's home side is the half holding the
 * better seed (the first half where they tie, as in the final), groups in the league's order.
 */

import { MatchSide } from '@poolmaster/shared/domain';
import type { ProviderBracketMatch, ProviderScheduledGame } from '../../core/provider-interface';
import { playoffSeries, type PlayoffSeries } from './series-playoff-rounds';
import { BracketShapeKind, playoffsTeamExternalId, type DivisionBracketConference, type PlayoffGame, type PlayoffsLeague, type PlayoffTeam } from './series-playoffs';

/** A team's seed rank within its group (a conference, or the whole league), by its vendor id. */
export type PlayoffSeedRanks = ReadonlyMap<number, number>;

/**
 * A group's first-round matches by their top seeds, top to bottom: 1, 4, 3, 2 for eight teams
 * (1 v 8, 4 v 5, 3 v 6, 2 v 7), each half of the bracket holding the seeds that meet in it.
 */
export function firstRoundOrder(teams: number): number[] {
  let order = [1];
  while (order.length * 2 <= teams / 2) {
    const size = order.length * 2;
    order = order.flatMap((seed, index) => (index % 2 === 0 ? [seed, size + 1 - seed] : [size + 1 - seed, seed]));
  }
  return order;
}

/** Whether the games hold the first round's every series, without which no bracket can be seeded. */
export function hasWholeFirstRound(league: PlayoffsLeague, games: readonly PlayoffGame[]): boolean {
  return playoffSeries(games).filter((series) => series.round === 1).length === league.rounds[0].seriesCount;
}

/** One first-round match as the bracket places it: its two teams, its region, and the rank that heads its half. */
interface FirstRoundSlot {
  top: PlayoffTeam;
  bottom: PlayoffTeam;
  regionLabel: string | null;
  /** The better team's rank: the lower, the better; the half holding the lower hosts the next match. */
  bestSeed: number;
  series: PlayoffSeries;
}

function metadataText(team: PlayoffTeam, key: string): string | null {
  const value = team.metadata[key];
  return typeof value === 'string' ? value : null;
}

/** A first-round series with its better-ranked team on top; null when the ranks name neither. */
function ranked(series: PlayoffSeries, ranks: PlayoffSeedRanks): { top: PlayoffTeam; bottom: PlayoffTeam; topRank: number } | null {
  const { home, away } = series.games[0];
  const homeRank = ranks.get(home.id);
  const awayRank = ranks.get(away.id);
  if (homeRank === undefined && awayRank === undefined) return null;
  const homeIsTop = homeRank !== undefined && (awayRank === undefined || homeRank < awayRank);
  return homeIsTop ? { top: home, bottom: away, topRank: homeRank } : { top: away, bottom: home, topRank: awayRank ?? Number.MAX_SAFE_INTEGER };
}

/**
 * A league seeded within each group (the NBA's conferences, or the WNBA as one): each group's
 * first round by its top seeds' order, 1 v n down; null unless every group has its full first
 * round, each top seed once.
 */
function seededSlots(league: PlayoffsLeague, groups: readonly string[] | null, firstRound: readonly PlayoffSeries[], ranks: PlayoffSeedRanks): FirstRoundSlot[] | null {
  const groupList = groups ?? [null];
  const teamsPerGroup = (league.rounds[0].seriesCount * 2) / groupList.length;
  const groupOf = (team: PlayoffTeam) => {
    const conference = metadataText(team, 'conference');
    return groups === null ? null : conference !== null && groups.includes(conference) ? conference : undefined;
  };
  const seeded: Array<{ group: string | null; topSeed: number; slot: FirstRoundSlot }> = [];
  for (const series of firstRound) {
    const sides = ranked(series, ranks);
    if (sides === null || sides.topRank > teamsPerGroup / 2) return null;
    const group = groupOf(sides.top);
    if (group === undefined || groupOf(sides.bottom) !== group) return null;
    if (seeded.some((other) => other.group === group && other.topSeed === sides.topRank)) return null;
    seeded.push({ group, topSeed: sides.topRank, slot: { top: sides.top, bottom: sides.bottom, regionLabel: group, bestSeed: sides.topRank, series } });
  }
  return groupList.flatMap((group) => firstRoundOrder(teamsPerGroup).map((topSeed) => {
    const entry = seeded.find((each) => each.group === group && each.topSeed === topSeed);
    if (entry === undefined) throw new Error(`The seeded first round has no ${String(topSeed)} seed in ${String(group)}.`);
    return entry.slot;
  }));
}

/**
 * A league seeded by division (the NHL's): in each conference, each division's winner meets a
 * wild card and its second and third teams meet each other, the two winners meeting in the next
 * round. A division's winner and second are the better-ranked teams of its two series; the
 * winner's series is listed first, divisions and conferences in the league's order. Null unless
 * every conference has its full first round, each division two series headed by its own teams and
 * its second meeting its third.
 */
function divisionSlots(league: PlayoffsLeague, conferences: DivisionBracketConference[], firstRound: readonly PlayoffSeries[], ranks: PlayoffSeedRanks): FirstRoundSlot[] | null {
  const sides = firstRound.map((series) => ({ series, sides: ranked(series, ranks) }));
  if (sides.some((each) => each.sides === null)) return null;
  const slots: FirstRoundSlot[] = [];
  for (const conference of conferences) {
    const inConference = sides.filter((each) => each.sides !== null && metadataText(each.sides.top, 'conference') === conference.name);
    if (inConference.length * conferences.length !== league.rounds[0].seriesCount) return null;
    for (const division of conference.divisions) {
      const headed = inConference
        .filter((each) => each.sides !== null && metadataText(each.sides.top, 'division') === division)
        .sort((left, right) => (left.sides?.topRank ?? 0) - (right.sides?.topRank ?? 0));
      const [winner, second] = headed;
      if (headed.length !== 2 || winner.sides === null || second.sides === null) return null;
      if (metadataText(second.sides.bottom, 'division') !== division) return null;
      for (const { series, sides: each } of [winner, second]) {
        if (each === null) return null;
        slots.push({ top: each.top, bottom: each.bottom, regionLabel: conference.label, bestSeed: each.topRank, series });
      }
    }
  }
  return slots.length === league.rounds[0].seriesCount ? slots : null;
}

/**
 * The playoffs' whole bracket, every series from the first round to the final, the first round's
 * sides by seed and every later side empty; null for a league with no bracket shape, or until the
 * ranks place the whole first round.
 */
export function toPlayoffsBracket(league: PlayoffsLeague, games: readonly PlayoffGame[], ranks: PlayoffSeedRanks): ProviderBracketMatch[] | null {
  const shape = league.bracket;
  if (shape === undefined) return null;
  const firstRound = playoffSeries(games).filter((series) => series.round === 1);
  if (firstRound.length !== league.rounds[0].seriesCount) return null;
  const slots = shape.kind === BracketShapeKind.SEEDED
    ? seededSlots(league, shape.groups, firstRound, ranks)
    : divisionSlots(league, shape.conferences, firstRound, ranks);
  return slots === null ? null : linkBracket(league, slots);
}

/** The first round's matches numbered in order, each two consecutive ones' winners meeting next, to the final. */
function linkBracket(league: PlayoffsLeague, slots: readonly FirstRoundSlot[]): ProviderBracketMatch[] {
  const team = (each: PlayoffTeam) => playoffsTeamExternalId(league, each.id);
  /** Each match with the best seed in the half it heads, to say which side hosts the next. */
  let previous: Array<{ match: ProviderBracketMatch; bestSeed: number }> = slots.map((slot, index) => ({
    bestSeed: slot.bestSeed,
    match: {
      matchNumber: index + 1,
      roundNumber: 1,
      homeTeamExternalId: team(slot.top),
      awayTeamExternalId: team(slot.bottom),
      isNeutralSite: false,
      scheduledAt: new Date(slot.series.games[0].start),
      advancesTo: null,
      regionLabel: slot.regionLabel,
    },
  }));
  const bracket = previous.map((entry) => entry.match);
  while (previous.length > 1) {
    const round: typeof previous = [];
    for (let index = 0; index + 1 < previous.length; index += 2) {
      const [left, right] = [previous[index], previous[index + 1]];
      // Where the halves' best seeds tie (the NBA Finals, two 1 seeds) the first half is home:
      // home court there goes to the better record, which is not modelled, and a side is display
      // only, since nothing in a series is neutral or scored by side.
      const homeIsLeft = left.bestSeed <= right.bestSeed;
      const matchNumber = bracket.length + 1;
      left.match.advancesTo = { matchNumber, side: homeIsLeft ? MatchSide.HOME : MatchSide.AWAY };
      right.match.advancesTo = { matchNumber, side: homeIsLeft ? MatchSide.AWAY : MatchSide.HOME };
      const match: ProviderBracketMatch = {
        matchNumber,
        roundNumber: left.match.roundNumber + 1,
        homeTeamExternalId: null,
        awayTeamExternalId: null,
        isNeutralSite: false,
        scheduledAt: null,
        advancesTo: null,
        regionLabel: left.match.regionLabel === right.match.regionLabel ? left.match.regionLabel : null,
      };
      bracket.push(match);
      round.push({ match, bestSeed: Math.min(left.bestSeed, right.bestSeed) });
    }
    previous = round;
  }
  return bracket;
}

/**
 * Each series as one game of the slate, at its Game 1 tip-off, numbered by the vendor's Game 1 id.
 * Given the bracket, a later round's series takes the sides the bracket gives it (the team from
 * its home half at home), whoever has home court, since its sides come from the links and the
 * slate would otherwise read a swap; without one, Game 1's home team is at home.
 */
export function toPlayoffSeriesGames(league: PlayoffsLeague, games: readonly PlayoffGame[], bracket: readonly ProviderBracketMatch[] | null): ProviderScheduledGame[] {
  const sideOf = bracketSides(bracket ?? []);
  return playoffSeries(games).map((series) => {
    const first = series.games[0];
    const home = playoffsTeamExternalId(league, first.home.id);
    const away = playoffsTeamExternalId(league, first.away.id);
    const flip = series.round > 1 && sideOf(series.round, home) === MatchSide.AWAY && sideOf(series.round, away) === MatchSide.HOME;
    return {
      externalGameId: String(first.id),
      roundNumber: series.round,
      homeTeamExternalId: flip ? away : home,
      awayTeamExternalId: flip ? home : away,
      scheduledAt: new Date(first.start),
      isNeutralSite: false,
    };
  });
}

/** The side a first-round team would take in a round's match, following the links; null off the bracket. */
function bracketSides(bracket: readonly ProviderBracketMatch[]): (roundNumber: number, teamExternalId: string) => MatchSide | null {
  const byNumber = new Map(bracket.map((match) => [match.matchNumber, match]));
  return (roundNumber, teamExternalId) => {
    let match = bracket.find((each) => each.roundNumber === 1 && (each.homeTeamExternalId === teamExternalId || each.awayTeamExternalId === teamExternalId));
    while (match?.advancesTo) {
      const next = byNumber.get(match.advancesTo.matchNumber);
      if (next?.roundNumber === roundNumber) return match.advancesTo.side;
      match = next;
    }
    return null;
  };
}
