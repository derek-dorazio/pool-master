/**
 * Pure mappings from BALLDONTLIE's FIFA World Cup responses to the provider port's shapes
 * (#1496). No I/O.
 *
 * PoolMaster's World Cup event is an edition's knockout bracket (`fifa-wc-2026-knockout`): its
 * group stage is not a bracket, and a match with a group is left out. The vendor lists every
 * knockout match from the start, a side null until it is decided, so the bracket is complete
 * once every listed match is done. The play-off for third place is listed too; it fits no
 * match of the site's bracket, so its game links to none and it is no round.
 *
 * The bracket and its games come from the feed (#1728). The rounds are the knockout stages in the
 * vendor's stage order, the first knockout stage round 1: the round of 32 from 2026, the round of
 * 16 before. Each later match names the earlier matches its sides come from
 * (`home_team_source`, "Winner of Match 89") until a side is decided, when the source goes and the
 * team stands there instead, so a side links to the match its source names or, once decided, to
 * the match its team won the round before.
 *
 * A knockout match level after extra time is settled by a shoot-out, whose scores the vendor
 * gives apart from the match score (`home_score_penalties`); they go on the game for the writer
 * to name the winner by (#1532).
 *
 * Team ids are the provider's own (`participantFeedId`, #2040), mapped per sport league.
 */

import { MatchSide, Sport } from '@poolmaster/shared/domain';
import type { GameScoreUpdate } from '@poolmaster/shared/dto';
import type { ProviderBracketMatch, ProviderParticipant, ProviderScheduledGame, SportEvent } from '../../core/provider-interface';
import { BalldontlieContractError } from './balldontlie-client';
import { CompetitionStatusState, eventStatusOf, GAME_STATE_BY_STATUS, hasStarted, PROGRESS_BY_STATE } from './competition-status';
import type { FifaMatch, FifaMatchTeamSource, FifaTeam } from './fifa-world-cup-contract';
import { BALLDONTLIE_PROVIDER_ID } from './pga-mapping';
import { participantFeedId } from './participant-feed-id';
import { ProviderSeasonType, providerSlotCode, slotPlaysOf } from './provider-slot-codes';

export const FIFA_WC_MATCHES_PATH = '/fifa/worldcup/v1/matches';
export const FIFA_WC_TEAMS_PATH = '/fifa/worldcup/v1/teams';


/** One World Cup edition's knockout bracket, by the edition's year. */
export interface WorldCupScope {
  season: number;
}

const SCOPE_ID_PATTERN = /^fifa-wc-(\d{4})-knockout$/;

export function worldCupScopeId(scope: WorldCupScope): string {
  return `fifa-wc-${String(scope.season)}-knockout`;
}

/** The scope an event id names, or null when it names no World Cup bracket. */
export function parseWorldCupScope(eventId: string): WorldCupScope | null {
  const match = SCOPE_ID_PATTERN.exec(eventId);
  return match ? { season: Number(match[1]) } : null;
}


/** A field the document leaves optional but without which a row cannot be used. */
function required<Value>(value: Value | null | undefined, path: string, row: string, field: string): Value {
  if (value === undefined || value === null) {
    throw new BalldontlieContractError(path, [`${row} has no ${field}`]);
  }
  return value;
}

const matchName = (match: FifaMatch) => `match ${match.id === undefined ? '(no id)' : String(match.id)}`;

/** The knockout matches: every match with no group. */
export function knockoutMatchesOf(matches: readonly FifaMatch[]): FifaMatch[] {
  return matches.filter((match) => match.group === undefined || match.group === null);
}

/** The vendor's mark on the play-off for third place, its stage name or a side from a semifinal's loser. */
const THIRD_PLACE_STAGE = /third/i;
const LOSER_SOURCE = 'loser';
const WINNER_SOURCE = 'winner';

function isThirdPlace(match: FifaMatch): boolean {
  return THIRD_PLACE_STAGE.test(match.stage?.name ?? '')
    || match.home_team_source?.type === LOSER_SOURCE
    || match.away_team_source?.type === LOSER_SOURCE;
}

/** The knockout matches of the site's bracket: every one but the play-off for third place. */
export function bracketMatchesOf(knockout: readonly FifaMatch[]): FifaMatch[] {
  return knockout.filter((match) => !isThirdPlace(match));
}

/**
 * Each bracket match's round: its stage's place among the bracket's stages, the first knockout
 * stage round 1. Null when a partial listing cannot tell the rounds: a knockout match names no
 * stage order, the knockout stages skip one, or the bracket's matches are not one fewer than two
 * to the power of its rounds.
 */
function roundsOf(knockout: readonly FifaMatch[]): { count: number; of: (match: FifaMatch) => number } | null {
  const orders = knockout.flatMap((match) => (match.stage?.order === undefined ? [] : [match.stage.order]));
  const allStages = new Set(orders);
  if (orders.length !== knockout.length || Math.max(...allStages) - Math.min(...allStages) + 1 !== allStages.size) return null;
  const bracketMatches = bracketMatchesOf(knockout);
  const stages = [...new Set(bracketMatches.map((match) => match.stage?.order ?? Number.NaN))].sort((left, right) => left - right);
  if (bracketMatches.length !== 2 ** stages.length - 1) return null;
  return { count: stages.length, of: (match) => stages.indexOf(match.stage?.order ?? Number.NaN) + 1 };
}

/** One event for an edition's knockout matches, which must be at least one. */
export function toWorldCupEvent(scope: WorldCupScope, matches: readonly FifaMatch[], participantCount?: number): SportEvent {
  const rounds = roundsOf(matches)?.count;
  const times = matches.map((match) => Date.parse(required(match.datetime, FIFA_WC_MATCHES_PATH, matchName(match), 'datetime')));
  const status = eventStatusOf(matches.map((match) => PROGRESS_BY_STATE[match.status_state]), true);
  return {
    externalId: worldCupScopeId(scope),
    providerId: BALLDONTLIE_PROVIDER_ID,
    sport: Sport.SOCCER,
    name: 'FIFA World Cup',
    startDate: new Date(Math.min(...times)),
    endDate: new Date(Math.max(...times)),
    status,
    ...(rounds !== undefined && { rounds }),
    participantCount,
    fieldLocked: status !== 'SCHEDULED' && status !== 'POSTPONED',
    // A knockout match's code is its stage's place in the vendor's order of the edition's stages.
    providerSlots: slotPlaysOf(matches.flatMap((match, index) => (match.stage?.order === undefined
      ? []
      : [{ code: providerSlotCode(ProviderSeasonType.POSTSEASON, match.stage.order), start: times[index] }]))),
  };
}

/** Each edition's knockout bracket among the matches, as one event each, earliest first. */
export function toWorldCupEvents(matches: readonly FifaMatch[]): SportEvent[] {
  const bySeason = new Map<number, FifaMatch[]>();
  for (const match of knockoutMatchesOf(matches)) {
    const season = required(match.season?.year, FIFA_WC_MATCHES_PATH, matchName(match), 'season year');
    bySeason.set(season, [...bySeason.get(season) ?? [], match]);
  }
  return [...bySeason]
    .map(([season, knockout]) => toWorldCupEvent({ season }, knockout))
    .sort((left, right) => left.startDate.getTime() - right.startDate.getTime());
}

export function toWorldCupTeamParticipant(team: FifaTeam, path: string): ProviderParticipant {
  const id = required(team.id, path, 'a team', 'id');
  return {
    externalId: participantFeedId(id),
    providerId: BALLDONTLIE_PROVIDER_ID,
    sport: Sport.SOCCER,
    name: required(team.name, path, `team ${String(id)}`, 'name'),
    active: true,
    metadata: team.abbreviation ? { abbreviation: team.abbreviation } : {},
  };
}

/** The teams of the knockout matches decided so far, each once, in the order they first appear. */
export function toWorldCupFieldParticipants(matches: readonly FifaMatch[]): ProviderParticipant[] {
  const field = new Map<string, ProviderParticipant>();
  for (const match of matches) {
    for (const team of [match.home_team, match.away_team]) {
      if (!team) continue;
      const participant = toWorldCupTeamParticipant(team, FIFA_WC_MATCHES_PATH);
      field.set(participant.externalId, participant);
    }
  }
  return [...field.values()];
}

/**
 * Each knockout match with both teams decided, with its state, its score and any shoot-out's,
 * for the GAME live-score category. A match whose state the vendor calls `unknown` is left out.
 */
export function toWorldCupGameScoreUpdates(matches: readonly FifaMatch[]): GameScoreUpdate[] {
  return matches.flatMap((match) => {
    if (match.status_state === CompetitionStatusState.UNKNOWN || !match.home_team || !match.away_team) return [];
    const state = GAME_STATE_BY_STATUS[match.status_state];
    // A final with no score is passed on as one, and skipped there.
    const started = hasStarted(state);
    return [{
      externalGameId: String(required(match.id, FIFA_WC_MATCHES_PATH, 'a match with both teams', 'id')),
      homeTeamExternalId: participantFeedId(required(match.home_team.id, FIFA_WC_MATCHES_PATH, matchName(match), 'home team id')),
      awayTeamExternalId: participantFeedId(required(match.away_team.id, FIFA_WC_MATCHES_PATH, matchName(match), 'away team id')),
      state,
      homeScore: started ? match.home_score ?? null : null,
      awayScore: started ? match.away_score ?? null : null,
      homeShootoutScore: started ? match.home_score_penalties ?? null : null,
      awayShootoutScore: started ? match.away_score_penalties ?? null : null,
    }];
  });
}

type DecidedTeam = FifaTeam & { id: number };

const decided = (team: FifaTeam | null | undefined): DecidedTeam | null => (team?.id === undefined ? null : team as DecidedTeam);

/**
 * The bracket's matches with both teams decided, each in its round (#1728), for a synced event's
 * matches to take their kickoffs from. Every one is at a neutral site, the hosts' included, as an
 * admin loads them. None while the rounds cannot be told (`roundsOf`).
 */
export function toWorldCupScheduledGames(knockout: readonly FifaMatch[]): ProviderScheduledGame[] {
  const bracketMatches = bracketMatchesOf(knockout);
  const rounds = roundsOf(knockout);
  if (!rounds) return [];
  return bracketMatches.flatMap((match) => {
    const home = decided(match.home_team);
    const away = decided(match.away_team);
    if (!home || !away || match.id === undefined) return [];
    return [{
      externalGameId: String(match.id),
      roundNumber: rounds.of(match),
      homeTeamExternalId: participantFeedId(home.id),
      awayTeamExternalId: participantFeedId(away.id),
      scheduledAt: match.datetime ? new Date(match.datetime) : null,
      isNeutralSite: true,
    }];
  });
}

/**
 * The edition's whole knockout bracket (#1728), numbered as an admin loads it: the first round's
 * matches in bracket order, each two consecutive ones' winners meeting next, then each later
 * round below them the same way, to the final. The order is read back from the final, each match
 * placing the match its home side comes from before the one its away side comes from, and each
 * side keeps the vendor's home and away. Every match is at a neutral site, with no region.
 *
 * Null until the first round's teams are all decided, and whenever the matches do not make one
 * bracket: rounds that cannot be told (`roundsOf`), a round not half the one before, or a side
 * that links to no match of the round before.
 */
export function toWorldCupBracket(knockout: readonly FifaMatch[]): ProviderBracketMatch[] | null {
  const bracketMatches = bracketMatchesOf(knockout);
  const rounds = roundsOf(knockout);
  if (!rounds) return null;
  const byRound = new Map<number, FifaMatch[]>();
  for (const match of bracketMatches) byRound.set(rounds.of(match), [...byRound.get(rounds.of(match)) ?? [], match]);
  for (let round = 1; round <= rounds.count; round += 1) {
    if (byRound.get(round)?.length !== 2 ** (rounds.count - round)) return null;
  }
  const firstRound = byRound.get(1) ?? [];
  if (firstRound.some((match) => !decided(match.home_team) || !decided(match.away_team))) return null;

  /** The match of the round before that a side comes from: its source's, or the one its team won. */
  const feeder = (match: FifaMatch, team: FifaTeam | null | undefined, source: FifaMatchTeamSource | null | undefined): FifaMatch | null => {
    const before = byRound.get(rounds.of(match) - 1) ?? [];
    const sourceNumber = source?.type === WINNER_SOURCE ? source.source_match_number : null;
    if (sourceNumber !== null && sourceNumber !== undefined) return before.find((each) => each.match_number === sourceNumber) ?? null;
    const id = decided(team)?.id;
    return id === undefined ? null : before.find((each) => each.home_team?.id === id || each.away_team?.id === id) ?? null;
  };

  // Each round's order, from the final back to the first round.
  const levels: FifaMatch[][] = [byRound.get(rounds.count) ?? []];
  for (let round = rounds.count; round > 1; round -= 1) {
    const level: FifaMatch[] = [];
    for (const match of levels[0]) {
      const home = feeder(match, match.home_team, match.home_team_source);
      const away = feeder(match, match.away_team, match.away_team_source);
      if (!home || !away) return null;
      level.push(home, away);
    }
    if (new Set(level).size !== level.length) return null;
    levels.unshift(level);
  }

  // Each match is numbered within its round (#2161), in the draw's order.
  return levels.flatMap((level, index) => level.map((match, position): ProviderBracketMatch => {
    const next = index + 1 < levels.length ? levels[index + 1][Math.floor(position / 2)] : null;
    const home = index === 0 ? decided(match.home_team) : null;
    const away = index === 0 ? decided(match.away_team) : null;
    return {
      roundNumber: index + 1,
      matchNumber: position + 1,
      homeTeamExternalId: home ? participantFeedId(home.id) : null,
      awayTeamExternalId: away ? participantFeedId(away.id) : null,
      isNeutralSite: true,
      scheduledAt: match.datetime ? new Date(match.datetime) : null,
      advancesTo: next ? { roundNumber: index + 2, matchNumber: Math.floor(position / 2) + 1, side: position % 2 === 0 ? MatchSide.HOME : MatchSide.AWAY } : null,
      regionLabel: null,
    };
  }));
}
