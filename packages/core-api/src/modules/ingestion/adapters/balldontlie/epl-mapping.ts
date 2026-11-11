/**
 * Pure mappings from BALLDONTLIE's Premier League responses to the provider port's shapes
 * (#1496). No I/O.
 *
 * PoolMaster's Premier League events are matchweeks, the pick'em event: one event per season
 * and matchweek (`epl-2026-matchweek-11`, played in November 2026), read from the vendor's
 * matches by their `round_number`. The season is the year it starts, as the vendor numbers it.
 * A match with no round number belongs to no matchweek and is left out. The scope id is the
 * event's externalId, as an NFL week's is.
 *
 * A match names its teams by id alone, so their names come from the season's teams list. Team
 * ids are prefixed (`epl-team-3`): a bare number would collide with another sport's. Each team
 * carries the league's keyword in `metadata.tour`, so it links by name only to the site's team
 * in the Premier League.
 *
 * A matchweek forms no bracket, so a drawn final is a result like any other.
 */

import { Sport } from '@poolmaster/shared/domain';
import type { GameScoreUpdate } from '@poolmaster/shared/dto';
import type { ProviderParticipant, SportEvent } from '../../core/provider-interface';
import { BalldontlieContractError } from './balldontlie-client';
import { CompetitionStatusState, eventStatusOf, GAME_STATE_BY_STATUS, hasStarted, PROGRESS_BY_STATE } from './competition-status';
import type { SoccerMatch, SoccerTeam } from './soccer-contract';
import { BALLDONTLIE_PROVIDER_ID } from './pga-mapping';

export const EPL_MATCHES_PATH = '/epl/v2/matches';
export const EPL_TEAMS_PATH = '/epl/v2/teams';

/**
 * The tour name events and teams carry in `metadata.tour`, matched against a sport league's
 * match keyword. Soccer's Premier League sport league is given it by migration.
 */
export const EPL_TOUR = 'EPL';

/** One Premier League matchweek. */
export interface EplScope {
  season: number;
  matchweek: number;
}

const SCOPE_ID_PATTERN = /^epl-(\d{4})-matchweek-([1-9]\d?)$/;

export function eplScopeId(scope: EplScope): string {
  return `epl-${String(scope.season)}-matchweek-${String(scope.matchweek)}`;
}

/** The scope an event id names, or null when it names no Premier League matchweek. */
export function parseEplScope(eventId: string): EplScope | null {
  const match = SCOPE_ID_PATTERN.exec(eventId);
  return match ? { season: Number(match[1]), matchweek: Number(match[2]) } : null;
}

export function eplTeamExternalId(teamId: number): string {
  return `epl-team-${String(teamId)}`;
}

/** A field the document leaves optional but without which a row cannot be used. */
function required<Value>(value: Value | null | undefined, path: string, row: string, field: string): Value {
  if (value === undefined || value === null) {
    throw new BalldontlieContractError(path, [`${row} has no ${field}`]);
  }
  return value;
}

const matchName = (match: SoccerMatch) => `match ${match.id === undefined ? '(no id)' : String(match.id)}`;

/** One event for a matchweek's matches, which must be at least one. */
export function toEplMatchweekEvent(scope: EplScope, matches: readonly SoccerMatch[], participantCount?: number): SportEvent {
  const times = matches.map((match) => Date.parse(required(match.date, EPL_MATCHES_PATH, matchName(match), 'date')));
  const status = eventStatusOf(matches.map((match) => PROGRESS_BY_STATE[match.status_state]), true);
  return {
    externalId: eplScopeId(scope),
    providerId: BALLDONTLIE_PROVIDER_ID,
    sport: Sport.SOCCER,
    name: `Premier League Matchweek ${String(scope.matchweek)}`,
    startDate: new Date(Math.min(...times)),
    endDate: new Date(Math.max(...times)),
    status,
    rounds: 1,
    participantCount,
    fieldLocked: status !== 'SCHEDULED' && status !== 'POSTPONED',
    metadata: { tour: EPL_TOUR, season: scope.season },
  };
}

/** A season's matches by matchweek, each matchweek's in the order the vendor lists them. */
export function matchesByMatchweek(matches: readonly SoccerMatch[]): Map<number, SoccerMatch[]> {
  const byMatchweek = new Map<number, SoccerMatch[]>();
  for (const match of matches) {
    const matchweek = match.round_number;
    if (matchweek === undefined || matchweek === null) continue;
    byMatchweek.set(matchweek, [...byMatchweek.get(matchweek) ?? [], match]);
  }
  return byMatchweek;
}

/** Every matchweek of a season's matches as one event each, earliest first. */
export function toEplMatchweekEvents(season: number, matches: readonly SoccerMatch[]): SportEvent[] {
  return [...matchesByMatchweek(matches)]
    .map(([matchweek, games]) => toEplMatchweekEvent({ season, matchweek }, games))
    .sort((left, right) => left.startDate.getTime() - right.startDate.getTime());
}

export function toEplTeamParticipant(team: SoccerTeam): ProviderParticipant {
  const id = required(team.id, EPL_TEAMS_PATH, 'a team', 'id');
  return {
    externalId: eplTeamExternalId(id),
    providerId: BALLDONTLIE_PROVIDER_ID,
    sport: Sport.SOCCER,
    name: required(team.name, EPL_TEAMS_PATH, `team ${String(id)}`, 'name'),
    active: true,
    metadata: { tour: EPL_TOUR, ...(team.abbreviation ? { abbreviation: team.abbreviation } : {}) },
  };
}

/**
 * The teams playing a matchweek's matches, each once, in the order they first appear, named
 * from the season's teams. A match's team the teams list does not name is refused.
 */
export function toEplFieldParticipants(matches: readonly SoccerMatch[], teams: readonly SoccerTeam[]): ProviderParticipant[] {
  const teamsById = new Map(teams.map((team) => [team.id, team]));
  const field = new Map<string, ProviderParticipant>();
  for (const match of matches) {
    for (const [side, teamId] of [['home_team_id', match.home_team_id], ['away_team_id', match.away_team_id]] as const) {
      const id = required(teamId, EPL_MATCHES_PATH, matchName(match), side);
      const team = teamsById.get(id);
      if (!team) throw new BalldontlieContractError(EPL_TEAMS_PATH, [`the season's teams do not list team ${String(id)} of ${matchName(match)}`]);
      const participant = toEplTeamParticipant(team);
      field.set(participant.externalId, participant);
    }
  }
  return [...field.values()];
}

/**
 * Each match's teams, state and score, for the GAME live-score category. A match whose state the
 * vendor calls `unknown` is left out.
 */
export function toEplGameScoreUpdates(matches: readonly SoccerMatch[]): GameScoreUpdate[] {
  return matches.flatMap((match) => {
    if (match.status_state === CompetitionStatusState.UNKNOWN) return [];
    const state = GAME_STATE_BY_STATUS[match.status_state];
    // A final with no score is passed on as one, and skipped there.
    const started = hasStarted(state);
    return [{
      externalGameId: String(required(match.id, EPL_MATCHES_PATH, 'a match', 'id')),
      homeTeamExternalId: eplTeamExternalId(required(match.home_team_id, EPL_MATCHES_PATH, matchName(match), 'home_team_id')),
      awayTeamExternalId: eplTeamExternalId(required(match.away_team_id, EPL_MATCHES_PATH, matchName(match), 'away_team_id')),
      state,
      homeScore: started ? match.home_score ?? null : null,
      awayScore: started ? match.away_score ?? null : null,
    }];
  });
}
