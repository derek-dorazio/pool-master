/**
 * Pure mappings from BALLDONTLIE's FIFA World Cup responses to the provider port's shapes
 * (#1496). No I/O.
 *
 * PoolMaster's World Cup event is an edition's knockout bracket (`fifa-wc-2026-knockout`): its
 * group stage is not a bracket, and a match with a group is left out. The vendor lists every
 * knockout match from the start, a side null until it is decided, so the bracket is complete
 * once every listed match is done. The play-off for third place is listed too; it fits no
 * match of the site's bracket, so its game links to none. The rounds are the sport league's own.
 *
 * A knockout match level after extra time is settled by a shoot-out, whose scores the vendor
 * gives apart from the match score (`home_score_penalties`); they go on the game for the writer
 * to name the winner by (#1532).
 *
 * Team ids are prefixed (`fifa-wc-team-12`): a bare number would collide with another sport's.
 * Each team carries the league's keyword in `metadata.tour`, so it links by name only to the
 * site's team in the World Cup.
 */

import { Sport } from '@poolmaster/shared/domain';
import type { GameScoreUpdate } from '@poolmaster/shared/dto';
import type { ProviderParticipant, SportEvent } from '../../core/provider-interface';
import { BalldontlieContractError } from './balldontlie-client';
import { CompetitionStatusState, eventStatusOf, GAME_STATE_BY_STATUS, hasStarted, PROGRESS_BY_STATE } from './competition-status';
import type { FifaMatch, FifaTeam } from './fifa-world-cup-contract';
import { BALLDONTLIE_PROVIDER_ID } from './pga-mapping';

export const FIFA_WC_MATCHES_PATH = '/fifa/worldcup/v1/matches';
export const FIFA_WC_TEAMS_PATH = '/fifa/worldcup/v1/teams';

/**
 * The tour name events and teams carry in `metadata.tour`, matched against a sport league's
 * match keyword. Soccer's FIFA World Cup sport league is given it by migration.
 */
export const FIFA_WC_TOUR = 'FIFAWC';

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

export function worldCupTeamExternalId(teamId: number): string {
  return `fifa-wc-team-${String(teamId)}`;
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

/** One event for an edition's knockout matches, which must be at least one. */
export function toWorldCupEvent(scope: WorldCupScope, matches: readonly FifaMatch[], participantCount?: number): SportEvent {
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
    participantCount,
    fieldLocked: status !== 'SCHEDULED' && status !== 'POSTPONED',
    metadata: { tour: FIFA_WC_TOUR, season: scope.season },
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
    externalId: worldCupTeamExternalId(id),
    providerId: BALLDONTLIE_PROVIDER_ID,
    sport: Sport.SOCCER,
    name: required(team.name, path, `team ${String(id)}`, 'name'),
    active: true,
    metadata: { tour: FIFA_WC_TOUR, ...(team.abbreviation ? { abbreviation: team.abbreviation } : {}) },
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
      homeTeamExternalId: worldCupTeamExternalId(required(match.home_team.id, FIFA_WC_MATCHES_PATH, matchName(match), 'home team id')),
      awayTeamExternalId: worldCupTeamExternalId(required(match.away_team.id, FIFA_WC_MATCHES_PATH, matchName(match), 'away team id')),
      state,
      homeScore: started ? match.home_score ?? null : null,
      awayScore: started ? match.away_score ?? null : null,
      homeShootoutScore: started ? match.home_score_penalties ?? null : null,
      awayShootoutScore: started ? match.away_score_penalties ?? null : null,
    }];
  });
}
